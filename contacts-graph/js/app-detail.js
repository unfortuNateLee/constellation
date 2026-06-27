import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';

/**
 * Detail panel: node selection → rendering the selected contact's info,
 * relationships, and inline notes editor; node deselection. Extracted from
 * app.js verbatim.
 */
class DetailMixin {
  _onNodeSelect(node) {
    const panel = document.getElementById('detail-panel');
    panel.classList.remove('hidden');

    // Highlight in contact list
    document.querySelectorAll('.contact-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === node.id);
    });

    // Photo
    const photoEl = document.getElementById('detail-photo');
    if (node.photo) {
      photoEl.style.backgroundImage = `url(${node.photo})`;
      photoEl.textContent = '';
    } else {
      photoEl.style.backgroundImage = 'none';
      photoEl.textContent = this._initials(node.name);
    }
    photoEl.className = `detail-avatar category-${node.category}`;

    // Basic info
    document.getElementById('detail-name').textContent = node.name;
    document.getElementById('detail-org').textContent = node.org || '';
    document.getElementById('detail-title-text').textContent = node.title || '';
    document.getElementById('detail-category-badge').textContent = node.isGroupNode
      ? 'group'
      : node.category;
    document.getElementById('detail-category-badge').className =
      `category-badge category-${node.isGroupNode ? 'other' : node.category}`;

    const contact = this._contact(node.id);
    const isEditing = !!contact && this._editingContactId === contact.id;
    const canShowAddRelationship = !!contact && !isEditing && !node.isVirtual && !node.isGroupNode;
    this._syncDetailEditButtons(node, !!contact, isEditing);

    // Contact info
    const contactInfo = document.getElementById('detail-contact-info');
    contactInfo.innerHTML = '';

    // Notes. This is one persistent <textarea> whose id toggles between
    // 'detail-notes' (read-only) and 'edit-notes' (edit mode), so look it up by
    // either — otherwise, re-selecting a node after an edit finds null and throws.
    const notesEl =
      document.getElementById('detail-notes') || document.getElementById('edit-notes');
    notesEl.value = '';
    const suggestionsSection = document.getElementById('suggestions-section');
    suggestionsSection.classList.add('hidden');

    if (node.isGroupNode) {
      this._renderGroupNodeDetail(
        node,
        contactInfo,
        notesEl,
        document.getElementById('detail-relationships'),
      );
      this._selectedNodeId = node.id;
      return;
    }

    if (isEditing) {
      this._renderEditableContactInfo(contactInfo, notesEl, contact);
      notesEl.parentElement.classList.remove('hidden');
    } else {
      this._renderReadOnlyContactInfo(contactInfo, node);
      notesEl.parentElement.classList.remove('hidden');
      this._renderInlineNotesEditor(notesEl, contact);
    }

    if (isEditing) {
      notesEl.className = 'form-control detail-notes-editing';
      notesEl.id = 'edit-notes';
      notesEl.rows = 6;
      notesEl.readOnly = false;
      notesEl.disabled = false;
      notesEl.value = (contact.notes || []).join('\n\n');
      this._bindNotesAutocomplete(notesEl, false, contact.id);
    }

    // Relationships
    const relsEl = document.getElementById('detail-relationships');
    relsEl.innerHTML = '';

    // ── 1. Own relationships: directly from this contact's data ──────
    const ownRelated = node.related || [];

    // ── 2. Back-references: other contacts whose data lists this person
    const referencedBy = (this._relatedRefsByTargetId.get(node.id) || [])
      .map((ref) => ({ rel: ref.rel, fromNode: ref.fromNode || this._node(ref.fromContact?.id) }))
      .filter((ref) => ref.fromNode && ref.fromNode.id !== node.id && !ref.fromNode.isVirtual);

    // ── 3. Inferred (org-based) edges ─────────────────────────────────
    const inferredRels = this._edgesForNode(node.id).filter((e) => e.inferred);

    // ── Render own relationships ──────────────────────────────────────
    if (ownRelated.length > 0) {
      const header = document.createElement('div');
      header.className = 'rel-section-header';
      header.textContent = 'Relationships';
      relsEl.appendChild(header);

      for (let relIdx = 0; relIdx < ownRelated.length; relIdx++) {
        const rel = ownRelated[relIdx];
        const target = this.builder.findContact(rel.name);
        const targetId = target ? target.id : `virtual__${rel.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const other = this._node(targetId);
        const displayName = other ? other.name : rel.name;
        const category = this.builder._edgeCategory(rel.type);
        const label = this.builder._friendlyType(rel.type);

        const item = document.createElement('div');
        item.className = `rel-item rel-${category}`;
        item.dataset.relIdx = String(relIdx);
        item.innerHTML = `
          <span class="rel-type">${this._escapeHtml(label)}</span>
          <span class="rel-name">${this._escapeHtml(displayName)}</span>
          ${contact ? '<button class="btn-edit-rel" title="Edit relationship type">✎</button>' : ''}
        `;
        if (other && !isEditing) {
          item.style.cursor = 'pointer';
          item.addEventListener('click', () => {
            this.graph.highlightContact(targetId);
            this._onNodeSelect(other);
          });
        }
        if (contact) {
          item.querySelector('.btn-edit-rel').addEventListener('click', (e) => {
            e.stopPropagation();
            this._startInlineRelEdit(item, contact, relIdx, node);
          });
        }
        relsEl.appendChild(item);
        if (isEditing && contact) {
          this._startInlineRelEdit(item, contact, relIdx, node);
        }
      }

      if (canShowAddRelationship) relsEl.appendChild(this._renderAddRelationshipAction());
    }

    // ── Render back-references ────────────────────────────────────────
    if (referencedBy.length > 0) {
      const header = document.createElement('div');
      header.className = 'rel-section-header rel-referenced-header';
      header.textContent = "Referenced in Others' Cards";
      relsEl.appendChild(header);

      for (const { rel, fromNode } of referencedBy) {
        const category = this.builder._edgeCategory(rel.type);
        const label = this.builder._friendlyType(rel.type);
        const firstName = fromNode.name.split(' ')[0];

        const item = document.createElement('div');
        item.className = `rel-item rel-${category} rel-referenced`;
        item.innerHTML = `
          <span class="rel-type">${this._escapeHtml(label)}</span>
          <span class="rel-name">${this._escapeHtml(fromNode.name)}</span>
          <span class="rel-via" title="This relationship is listed in ${this._escapeHtml(fromNode.name)}'s contact card, not this one">via ${this._escapeHtml(firstName)}</span>
        `;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          this.graph.highlightContact(fromNode.id);
          this._onNodeSelect(fromNode);
        });
        relsEl.appendChild(item);
      }
    }

    // ── Render inferred (org-based) ───────────────────────────────────
    if (inferredRels.length > 0) {
      const header = document.createElement('div');
      header.className = 'rel-section-header inferred';
      header.textContent = `From "${this._getOrgForNode(node)}" (inferred)`;
      relsEl.appendChild(header);

      const shown = inferredRels.slice(0, 8);
      for (const e of shown) {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        const otherId = s === node.id ? t : s;
        const other = this._node(otherId);
        if (!other) continue;

        const item = document.createElement('div');
        item.className = 'rel-item rel-work rel-inferred';
        item.innerHTML = `
          <span class="rel-type">Colleague</span>
          <span class="rel-name">${this._escapeHtml(other.name)}</span>
        `;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          this.graph.highlightContact(otherId);
          this._onNodeSelect(other);
        });
        relsEl.appendChild(item);
      }

      if (inferredRels.length > 8) {
        const more = document.createElement('div');
        more.className = 'rel-more';
        more.textContent = `+ ${inferredRels.length - 8} more colleagues`;
        relsEl.appendChild(more);
      }
    }

    if (ownRelated.length === 0 && referencedBy.length === 0 && inferredRels.length === 0) {
      relsEl.innerHTML = '<div class="rel-empty">No relationships found</div>';
      if (canShowAddRelationship) relsEl.appendChild(this._renderAddRelationshipAction());
    } else if (ownRelated.length === 0 && canShowAddRelationship) {
      const header = document.createElement('div');
      header.className = 'rel-section-header';
      header.textContent = 'Relationships';
      relsEl.prepend(header);

      const actions = this._renderAddRelationshipAction();
      header.insertAdjacentElement('afterend', actions);
    }

    // ── Suggested Additions ───────────────────────────────────────────
    this._renderSuggestions(node);

    // Store for add-relationship modal
    this._selectedNodeId = node.id;
  }

  _renderInlineNotesEditor(notesEl, contact) {
    notesEl.id = 'detail-notes';
    notesEl.className = 'detail-notes-inline';
    notesEl.rows = 6;
    notesEl.readOnly = !contact;
    notesEl.disabled = !contact;
    notesEl.value = this._notesText(contact?.notes || []);
    notesEl.oninput = null;
    notesEl.onblur = null;
    notesEl.onkeydown = null;
    if (!contact) return;
    this._bindNotesAutocomplete(notesEl, true, contact.id);
  }

  _onNodeDeselect() {
    document.getElementById('detail-panel').classList.add('hidden');
    document.querySelectorAll('.contact-item').forEach((el) => el.classList.remove('active'));
    this._selectedNodeId = null;
    this._editingContactId = null;
  }
}

applyMixin(ContactRelationshipApp.prototype, DetailMixin);
