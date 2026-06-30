import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';
import { makeSearchable } from './searchable-select.js';

/**
 * Inline relationship editing: the type picker, inline rel-item editor, and
 * add / edit / delete / commit of a contact's relationships (with reciprocal
 * updates) plus the add-relationship modal. Extracted from app.js verbatim.
 */
class RelationshipEditMixin {
  /** Returns <option> HTML for all known relationship types, with selectedType pre-selected. */
  _relTypeOptionsHtml(selectedType) {
    return RelationshipTaxonomy.optionsHtml(selectedType);
  }

  /** Turns a rel-item into an inline editor for relationship name + type. */
  _startInlineRelEdit(item, contact, relIdx, node) {
    if (item.querySelector('.rel-type-select')) return;
    item.classList.add('rel-item-editing');

    const currentRel = contact.related[relIdx];
    const currentType = currentRel.type;
    const currentName = currentRel.name;
    const typeSpan = item.querySelector('.rel-type');
    const nameSpan = item.querySelector('.rel-name');
    const editBtn = item.querySelector('.btn-edit-rel');

    const select = document.createElement('select');
    select.className = 'rel-type-select';
    select.innerHTML = this._relTypeOptionsHtml(currentType);
    typeSpan.replaceWith(select);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'rel-name-input';
    nameInput.value = currentName;
    nameInput.placeholder = 'Related person';
    const nameListId = `rel-name-options-${contact.id}-${relIdx}`;
    nameInput.setAttribute('list', nameListId);
    nameSpan.replaceWith(nameInput);

    const nameOptions = document.createElement('datalist');
    nameOptions.id = nameListId;
    for (const otherContact of [...this.contacts].sort((a, b) => a.fn.localeCompare(b.fn))) {
      if (otherContact.id === contact.id) continue;
      const option = document.createElement('option');
      option.value = otherContact.fn;
      nameOptions.appendChild(option);
    }

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'rel-custom-input';
    customInput.placeholder = 'e.g. mentor…';
    customInput.value = select.value === '__custom__' ? currentType : '';
    customInput.style.display = select.value === '__custom__' ? 'inline-block' : 'none';
    select.insertAdjacentElement('afterend', customInput);

    if (editBtn) editBtn.style.display = 'none';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn-edit-confirm';
    confirmBtn.title = 'Save';
    confirmBtn.textContent = '✓';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-edit-cancel';
    cancelBtn.title = 'Cancel';
    cancelBtn.textContent = '✕';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-edit-delete';
    deleteBtn.title = 'Delete relationship';
    deleteBtn.textContent = '🗑';

    const nameRow = document.createElement('div');
    nameRow.className = 'rel-edit-name-row';
    nameInput.replaceWith(nameRow);
    nameRow.appendChild(nameInput);
    nameRow.appendChild(nameOptions);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'rel-edit-actions';
    actionsRow.appendChild(confirmBtn);
    actionsRow.appendChild(deleteBtn);
    actionsRow.appendChild(cancelBtn);
    nameRow.appendChild(actionsRow);

    [select, nameInput, customInput, confirmBtn, deleteBtn, cancelBtn].forEach((el) => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('mousedown', (e) => e.stopPropagation());
    });

    select.addEventListener('change', () => {
      const isCustom = select.value === '__custom__';
      customInput.style.display = isCustom ? 'inline-block' : 'none';
      if (isCustom) {
        customInput.value = '';
        customInput.focus();
      }
    });

    confirmBtn.addEventListener('click', () => {
      const newName = nameInput.value.trim();
      let newType =
        select.value === '__custom__' ? customInput.value.trim().toLowerCase() : select.value;
      if (newName && newType && newType !== '__custom__') {
        this._editRelationship(contact, relIdx, newName, newType, node);
      }
    });

    deleteBtn.addEventListener('click', () => {
      this._deleteRelationship(contact, relIdx, node);
    });

    cancelBtn.addEventListener('click', () => {
      this._onNodeSelect(node);
    });

    nameInput.focus();
  }

  /** Persists a relationship name/type change to in-memory data and rawVCard. */
  _editRelationship(contact, relIdx, newName, newType, currentNode) {
    const result = this._applyRelationshipEdit(contact, relIdx, newName, newType);
    if (!result) return;

    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
    const refreshed = this._node(currentNode.id);
    if (refreshed) this._onNodeSelect(refreshed);

    const newLabel = this.builder._friendlyType(newType);
    const recipLabel = this.builder._friendlyType(result.reciprocalType);
    const toastMsg = result.recipUpdated
      ? `Updated relationship to ${newName} (${newLabel}) and set their side to "${recipLabel}"`
      : `Updated relationship to ${newName} (${newLabel})`;
    this._showToast(toastMsg, 'success');
  }

  _applyRelationshipEdit(contact, relIdx, newName, newType) {
    const rel = contact.related[relIdx];
    if (!rel) return null;
    const oldName = rel.name;
    const oldTarget = this.builder.findContact(oldName);
    const newTarget = this.builder.findContact(newName);

    rel.name = newName;
    rel.type = newType;
    rel.rawType = this._typeToVCardLabel(newType);
    // Regenerate the raw vCard from the (now-updated) model rather than patching
    // the X-ABRELATEDNAMES item group by hand — contact.related is the source.
    this._rewriteEditableFields(contact);

    // The reciprocal is the contact's own role on the related person's card, so
    // gender it by the contact's gender (e.g. contact is Male + relates a child →
    // "Father"; relates a niece → "Uncle"). Unknown gender → neutral/canonical.
    const reciprocalType = this._reciprocalType(newType, contact.gender);
    const sameTarget =
      (oldTarget && newTarget && oldTarget.id === newTarget.id) ||
      oldName.trim().toLowerCase() === newName.trim().toLowerCase();
    const otherContact = sameTarget ? newTarget || oldTarget : null;
    let recipUpdated = false;

    if (otherContact) {
      const myFn = (contact.fn || '').toLowerCase().trim();
      const myFnStrip = myFn
        .replace(/["'][^"']*["']/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const backRelIdx = (otherContact.related || []).findIndex((r) => {
        const rn = r.name.toLowerCase().trim();
        if (rn === myFn || rn === myFnStrip) return true;
        const rc = this.builder.findContact(r.name);
        return !!(rc && rc.id === contact.id);
      });

      if (backRelIdx !== -1) {
        const backRel = otherContact.related[backRelIdx];

        // Keep the stronger existing label — only upgrade, never downgrade.
        if (!this._isReciprocalDowngrade(reciprocalType, backRel.type)) {
          backRel.type = reciprocalType;
          backRel.rawType = this._typeToVCardLabel(reciprocalType);
          recipUpdated = true;
          this._rewriteEditableFields(otherContact);
        }
      }
    }
    return { reciprocalType, recipUpdated };
  }

  _commitOpenRelationshipEditors(contact) {
    const items = [...document.querySelectorAll('#detail-relationships .rel-item[data-rel-idx]')];
    for (const item of items) {
      const select = item.querySelector('.rel-type-select');
      const nameInput = item.querySelector('.rel-name-input');
      if (!select || !nameInput) continue;

      const relIdx = parseInt(item.dataset.relIdx || '', 10);
      if (!Number.isInteger(relIdx)) continue;

      const newName = nameInput.value.trim();
      const customInput = item.querySelector('.rel-custom-input');
      const newType =
        select.value === '__custom__'
          ? customInput?.value.trim().toLowerCase() || ''
          : select.value;

      if (!newName || !newType || newType === '__custom__') continue;
      this._applyRelationshipEdit(contact, relIdx, newName, newType);
    }
  }

  _deleteRelationship(contact, relIdx, currentNode) {
    const rel = contact.related[relIdx];
    if (!rel) return;

    contact.related.splice(relIdx, 1);
    // Regenerate the raw vCard from the updated model (single source of truth).
    this._rewriteEditableFields(contact);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
    const refreshed = this._node(currentNode.id);
    if (refreshed) this._onNodeSelect(refreshed);
    this._showToast(`Deleted relationship to ${rel.name}`, 'success');
  }

  // ── Add Relationship Modal ─────────────────────────────────────

  _showAddRelationshipModal() {
    // If a contact is being edited, flush the in-progress form into the model
    // first — the add-relationship save regenerates the card from the model, so
    // this prevents unsaved field edits from being discarded. Edit mode stays on.
    if (this._editingContactId) {
      const editing = this._contact(this._editingContactId);
      if (editing) this._commitEditFormToModel(editing);
    }

    const modal = document.getElementById('add-rel-modal');
    modal.classList.remove('hidden');

    const node = this._node(this._selectedNodeId);
    if (node) {
      document.getElementById('modal-from-name').textContent = node.name;
    }

    // Populate contact picker
    const select = document.getElementById('modal-target-select');
    select.innerHTML = '<option value="">— Select contact —</option>';
    const sorted = this.contacts
      .filter((c) => c.id !== this._selectedNodeId)
      .sort((a, b) => a.fn.localeCompare(b.fn));
    for (const c of sorted) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.fn;
      select.appendChild(opt);
    }
    makeSearchable(select, { placeholder: 'Search contacts…' });

    document.getElementById('modal-target-mode').value = 'existing';
    document.getElementById('modal-target-select-row').classList.remove('hidden');
    document.getElementById('modal-manual-name-row').classList.add('hidden');
    document.getElementById('modal-create-mode-row').classList.add('hidden');
    document.getElementById('modal-target-name').value = '';
    document.getElementById('modal-create-mode').value = 'virtual';
    this._focusModal('add-rel-modal');
  }

  /**
   * Commit the Add-Relationship modal: read its fields, resolve the target
   * (existing contact, manual virtual name, or a newly-created real contact),
   * append the relationship, regenerate the card, and re-render. Lives on the
   * controller (not bootstrap) so all relationship CRUD is in one place.
   */
  _saveAddRelationshipModal() {
    const fromId = this._selectedNodeId;
    const targetMode = document.getElementById('modal-target-mode').value;
    const toId = document.getElementById('modal-target-select').value;
    const manualName = document.getElementById('modal-target-name').value.trim();
    const createMode = document.getElementById('modal-create-mode').value;
    const relType = document.getElementById('modal-rel-type').value;
    const custom = document.getElementById('modal-rel-custom').value.trim();

    if (!fromId || !relType || (targetMode === 'existing' ? !toId : !manualName)) {
      this._showToast('Please fill in all fields', 'error');
      return;
    }

    const finalType = relType === RelationshipTaxonomy.CUSTOM_OPTION_VALUE ? custom : relType;
    if (!finalType) {
      this._showToast('Please enter a relationship type', 'error');
      return;
    }

    const fromContact = this._contact(fromId);
    if (!fromContact) return;

    let relName = '';
    let targetUid = null; // stored on the relation so it resolves by UID (rename-proof)
    let createdRealContact = false;
    if (targetMode === 'existing') {
      const toNode = this._node(toId);
      if (!toNode) return;
      relName = toNode.name;
      targetUid = this._contact(toId)?.uid || null;
    } else {
      relName = manualName;
      if (createMode === 'real') {
        const existing = this._contactsByFn.get(manualName.toLowerCase().trim());
        if (existing) {
          relName = existing.fn;
          targetUid = existing.uid || null;
        } else {
          const contact = this._makeMinimalContact(manualName);
          this.contacts.push(contact);
          relName = contact.fn;
          targetUid = contact.uid || null;
          createdRealContact = true;
        }
      }
    }

    const vcardLabel = this._typeToVCardLabel(finalType);
    fromContact.related.push({
      name: relName,
      type: finalType,
      rawType: vcardLabel,
      ...(targetUid ? { uid: targetUid } : {}),
    });
    // Regenerate the raw vCard from the model (single source of truth) instead
    // of hand-inserting the X-ABRELATEDNAMES item group.
    this._rewriteEditableFields(fromContact);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
    const toastMsg = createdRealContact
      ? `Added ${this.builder._friendlyType(finalType)} to ${relName} and created a real contact`
      : `Added ${this.builder._friendlyType(finalType)} to ${relName}`;
    this._showToast(toastMsg, 'success');

    document.getElementById('add-rel-modal').classList.add('hidden');

    // Re-select the now-updated node so the detail panel refreshes.
    const updatedNode = this._node(fromId);
    if (updatedNode) {
      this.graph.highlightContact(fromId);
      this._onNodeSelect(updatedNode);
    }
  }
}

applyMixin(ContactRelationshipApp.prototype, RelationshipEditMixin);
