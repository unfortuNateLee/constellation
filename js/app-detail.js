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
    const canShowAddRelationship = !!contact && !node.isVirtual && !node.isGroupNode;
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

    // Relationships — a collapsible master section holding this contact's own
    // relationships plus the inferred (org-based) subsection. The "Referenced
    // in Others' Cards" and "Suggested Additions" sections are siblings of the
    // master, appended directly to detail-relationships at the same hierarchy
    // level.
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

    const master = this._makeCollapsible('Relationships', {
      collapsed: this._relSectionCollapsed,
      onToggle: (c) => {
        this._relSectionCollapsed = c;
      },
    });
    relsEl.appendChild(master.section);
    const body = master.body;

    // ── Render own relationships ──────────────────────────────────────
    if (ownRelated.length > 0) {
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
          <span class="rel-connector">is</span>
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
        body.appendChild(item);
        if (isEditing && contact) {
          this._startInlineRelEdit(item, contact, relIdx, node);
        }
      }

      if (canShowAddRelationship) body.appendChild(this._renderAddRelationshipAction());
    }

    // ── Top-level section: back-references (collapsible) ──────────────
    // A sibling of the Relationships master, not nested inside it.
    if (referencedBy.length > 0) {
      const refSub = this._makeCollapsible("Referenced in Others' Cards", {
        collapsed: this._refSectionCollapsed,
        onToggle: (c) => {
          this._refSectionCollapsed = c;
        },
        badgeText: String(referencedBy.length),
      });
      relsEl.appendChild(refSub.section);
      const refBody = refSub.body;

      for (const { rel, fromNode } of referencedBy) {
        const category = this.builder._edgeCategory(rel.type);
        const label = this.builder._friendlyType(rel.type);

        const item = document.createElement('div');
        item.className = `rel-item rel-${category} rel-referenced`;
        item.title = `This relationship is listed in ${fromNode.name}'s contact card, not this one`;
        item.innerHTML = `
          <span class="rel-type">${this._escapeHtml(label)}</span>
          <span class="rel-connector">of</span>
          <span class="rel-name">${this._escapeHtml(fromNode.name)}</span>
        `;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          this.graph.highlightContact(fromNode.id);
          this._onNodeSelect(fromNode);
        });
        refBody.appendChild(item);
      }
    }

    // ── Subsection: inferred (org-based) ──────────────────────────────
    if (inferredRels.length > 0) {
      body.appendChild(
        this._makeRelSubheader(`From "${this._getOrgForNode(node)}" (inferred)`, 'inferred'),
      );

      // Build one inferred-colleague row; `before` lets the reveal link insert
      // the remaining rows ahead of itself.
      const renderInferredItem = (e, before = null) => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        const otherId = s === node.id ? t : s;
        const other = this._node(otherId);
        if (!other) return;

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
        if (before) before.before(item);
        else body.appendChild(item);
      };

      const LIMIT = 8;
      inferredRels.slice(0, LIMIT).forEach((e) => renderInferredItem(e));

      if (inferredRels.length > LIMIT) {
        const remaining = inferredRels.length - LIMIT;
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'rel-more rel-more-link';
        more.textContent = `+ ${remaining} more colleague${remaining !== 1 ? 's' : ''}`;
        more.addEventListener('click', () => {
          inferredRels.slice(LIMIT).forEach((e) => renderInferredItem(e, more));
          more.remove();
        });
        body.appendChild(more);
      }
    }

    // Emptiness now reflects only the Relationships section's own content
    // (own + inferred); back-references live in their own sibling section.
    if (ownRelated.length === 0 && inferredRels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rel-empty';
      empty.textContent = 'No relationships found';
      body.appendChild(empty);
      if (canShowAddRelationship) body.appendChild(this._renderAddRelationshipAction());
    } else if (ownRelated.length === 0 && canShowAddRelationship) {
      body.prepend(this._renderAddRelationshipAction());
    }

    // ── Top-level section: Suggested Additions (its own collapsible) ──
    // A sibling of the Relationships master, not nested inside it.
    this._renderSuggestions(node, relsEl);

    // Store for add-relationship modal
    this._selectedNodeId = node.id;
  }

  /** A plain (non-collapsible) subsection header inside the Relationships body. */
  _makeRelSubheader(text, extraClass = '') {
    const header = document.createElement('div');
    header.className = `rel-section-header rel-subheader${extraClass ? ' ' + extraClass : ''}`;
    header.textContent = text;
    return header;
  }

  /**
   * Build a collapsible section: a clickable header (with chevron and optional
   * badge) that toggles a body. Returns { section, header, body, setBadge }.
   * Collapse state is owned by the caller via the `collapsed` flag + onToggle.
   */
  _makeCollapsible(
    title,
    { collapsed = false, onToggle = null, badgeText = '', badgeClass = '' } = {},
  ) {
    const section = document.createElement('div');
    section.className = 'rel-collapse';
    if (collapsed) section.classList.add('collapsed');

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'rel-collapse-header';

    const chevron = document.createElement('span');
    chevron.className = 'rel-collapse-chevron';
    chevron.textContent = '▸';

    const titleEl = document.createElement('span');
    titleEl.className = 'rel-collapse-title';
    titleEl.textContent = title;

    header.append(chevron, titleEl);

    let badgeEl = null;
    if (badgeText) {
      badgeEl = document.createElement('span');
      badgeEl.className = badgeClass || 'rel-collapse-badge';
      badgeEl.textContent = badgeText;
      header.appendChild(badgeEl);
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'rel-collapse-body';

    header.addEventListener('click', () => {
      const isCollapsed = section.classList.toggle('collapsed');
      if (onToggle) onToggle(isCollapsed);
    });

    section.append(header, bodyEl);
    return {
      section,
      header,
      body: bodyEl,
      setBadge: (t) => {
        if (badgeEl) badgeEl.textContent = t;
      },
    };
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
