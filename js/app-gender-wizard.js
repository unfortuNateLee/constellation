import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';

/**
 * Gender Assignment Wizard.
 *
 * Three columns — Male | Unknown | Female — with one draggable tile per contact,
 * placed in the column for its current gender. Tiles can be dragged between
 * columns, or selected (click / ⌘-Ctrl-click / checkbox) and reassigned with the
 * keyboard (m = Male, f = Female, u = Unknown/clear). All changes are QUEUED in a
 * pending map; nothing is written to contacts until "Commit Changes". "Reset"
 * restores every tile to its real gender; "Clear Selection" deselects.
 *
 * Gender values are vCard sex codes: 'M' | 'F' | '' (unknown).
 */
const GENDERS = ['M', '', 'F'];

class GenderWizardMixin {
  _openGenderWizard() {
    if (!this.contacts.length) {
      this._showToast('Load contacts first', 'error');
      return;
    }
    // Snapshot current ("real") gender and seed the pending map from it.
    const real = new Map();
    const pending = new Map();
    for (const c of this.contacts) {
      const g = c.gender === 'M' || c.gender === 'F' ? c.gender : '';
      real.set(c.id, g);
      pending.set(c.id, g);
    }
    this._genderWizard = { real, pending, selected: new Set(), dragging: [], tileEls: new Map() };

    this._wireGenderWizardDropzones();
    this._renderGenderWizard();
    document.getElementById('gender-wizard-modal').classList.remove('hidden');
    this._focusModal('gender-wizard-modal');
  }

  _closeGenderWizard() {
    document.getElementById('gender-wizard-modal').classList.add('hidden');
  }

  // Attach drag-over/drop to the three column bodies once (they persist across
  // re-renders; only their tiles are replaced).
  _wireGenderWizardDropzones() {
    if (this._genderWizardWired) return;
    this._genderWizardWired = true;
    for (const body of document.querySelectorAll('#gender-wizard-modal .gender-col-body')) {
      body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        body.classList.add('drag-over');
      });
      body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
      body.addEventListener('drop', (e) => {
        e.preventDefault();
        body.classList.remove('drag-over');
        const ids = this._genderWizard?.dragging || [];
        if (ids.length) this._genderWizardAssign(body.dataset.gender, ids);
        this._genderWizard.dragging = [];
      });
    }
  }

  _renderGenderWizard() {
    const w = this._genderWizard;
    w.tileEls = new Map();
    const byGender = { M: [], '': [], F: [] };
    for (const c of this.contacts) byGender[w.pending.get(c.id) ?? ''].push(c);

    for (const body of document.querySelectorAll('#gender-wizard-modal .gender-col-body')) {
      const g = body.dataset.gender;
      const list = byGender[g].sort((a, b) => (a.fn || '').localeCompare(b.fn || ''));
      body.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const c of list) frag.appendChild(this._makeGenderTile(c));
      body.appendChild(frag);
    }
    this._updateGenderWizardSummary();
  }

  _makeGenderTile(contact) {
    const w = this._genderWizard;
    const id = contact.id;
    const tile = document.createElement('div');
    tile.className = 'gender-tile';
    tile.dataset.id = id;
    tile.draggable = true;
    if (w.selected.has(id)) tile.classList.add('selected');
    if (w.pending.get(id) !== w.real.get(id)) tile.classList.add('changed');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'gender-tile-cb';
    cb.checked = w.selected.has(id);
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => this._genderWizardSelect(id, true, cb.checked));

    const name = document.createElement('span');
    name.className = 'gender-tile-name';
    name.textContent = contact.fn || '(no name)';

    tile.appendChild(cb);
    tile.appendChild(name);

    tile.addEventListener('click', (e) => {
      // Plain click = select only this; ⌘/Ctrl-click = toggle within selection.
      if (e.metaKey || e.ctrlKey) this._genderWizardSelect(id, true, !w.selected.has(id));
      else this._genderWizardSelectOnly(id);
    });
    tile.addEventListener('dragstart', (e) => {
      // Drag the whole selection if this tile is part of it; else just this tile.
      w.dragging = w.selected.has(id) && w.selected.size ? [...w.selected] : [id];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    });

    w.tileEls.set(id, tile);
    return tile;
  }

  // ── Selection ──────────────────────────────────────────────────
  _genderWizardSelectOnly(id) {
    this._genderWizard.selected = new Set([id]);
    this._refreshGenderWizardSelectionStyles();
  }

  _genderWizardSelect(id, additive, on) {
    const sel = this._genderWizard.selected;
    if (!additive) sel.clear();
    if (on) sel.add(id);
    else sel.delete(id);
    this._refreshGenderWizardSelectionStyles();
  }

  _genderWizardClearSelection() {
    this._genderWizard.selected.clear();
    this._refreshGenderWizardSelectionStyles();
  }

  // In-place class/checkbox sync (avoids a full re-render on every selection click).
  _refreshGenderWizardSelectionStyles() {
    const w = this._genderWizard;
    for (const [id, tile] of w.tileEls) {
      const on = w.selected.has(id);
      tile.classList.toggle('selected', on);
      const cb = tile.querySelector('.gender-tile-cb');
      if (cb) cb.checked = on;
    }
    this._updateGenderWizardSummary();
  }

  // ── Assignment (queued) ─────────────────────────────────────────
  _genderWizardAssign(gender, ids) {
    const g = gender === 'M' || gender === 'F' ? gender : '';
    for (const id of ids) this._genderWizard.pending.set(id, g);
    this._renderGenderWizard();
  }

  // Keyboard m/f/u apply to the current selection (active only while the wizard is
  // open and focus isn't in a text field). Wired once in app-bootstrap.
  _genderWizardKeydown(e) {
    const modal = document.getElementById('gender-wizard-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    // Only ignore the hotkeys inside real text-entry fields — a focused tile
    // checkbox (after ticking it) must NOT swallow m/f/u.
    const el = e.target;
    const tag = (el.tagName || '').toLowerCase();
    const isTextEntry =
      tag === 'textarea' ||
      tag === 'select' ||
      (tag === 'input' && !['checkbox', 'radio', 'button'].includes(el.type));
    if (isTextEntry) return;
    const map = { m: 'M', f: 'F', u: '' };
    if (!(e.key.toLowerCase() in map)) return;
    e.preventDefault();
    const ids = [...this._genderWizard.selected];
    if (!ids.length) {
      this._showToast('Select one or more contacts first', 'info');
      return;
    }
    this._genderWizardAssign(map[e.key.toLowerCase()], ids);
  }

  // ── Footer actions ──────────────────────────────────────────────
  _genderWizardReset() {
    const w = this._genderWizard;
    w.pending = new Map(w.real);
    w.selected.clear();
    this._renderGenderWizard();
  }

  _genderWizardPendingCount() {
    const w = this._genderWizard;
    let n = 0;
    for (const [id, g] of w.pending) if (g !== w.real.get(id)) n += 1;
    return n;
  }

  _updateGenderWizardSummary() {
    const w = this._genderWizard;
    const counts = { M: 0, '': 0, F: 0 };
    for (const g of w.pending.values()) counts[g] += 1;
    const labelOf = { M: 'M', '': 'U', F: 'F' };
    for (const g of GENDERS) {
      const el = document.querySelector(
        `#gender-wizard-modal .gender-col-count[data-count="${labelOf[g]}"]`,
      );
      if (el) el.textContent = String(counts[g]);
    }
    const pending = this._genderWizardPendingCount();
    const pendingEl = document.getElementById('gender-wizard-pending');
    if (pendingEl) {
      pendingEl.textContent = pending ? `${pending} change${pending !== 1 ? 's' : ''} queued` : '';
    }
    const commit = document.getElementById('gender-wizard-commit');
    if (commit) commit.disabled = pending === 0;
  }

  _genderWizardCommit() {
    const w = this._genderWizard;
    const changed = [];
    for (const c of this.contacts) {
      const next = w.pending.get(c.id) ?? '';
      if (next !== (c.gender || '')) {
        c.gender = next;
        changed.push(c);
      }
    }
    if (!changed.length) {
      this._closeGenderWizard();
      return;
    }
    for (const c of changed) this._rewriteEditableFields(c);
    // Gender feeds gendered relationship reciprocals/suggestions, so rebuild.
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
    this._closeGenderWizard();
    this._showToast(
      `Updated gender for ${changed.length} contact${changed.length !== 1 ? 's' : ''}`,
      'success',
    );
  }
}

applyMixin(ContactRelationshipApp.prototype, GenderWizardMixin);
