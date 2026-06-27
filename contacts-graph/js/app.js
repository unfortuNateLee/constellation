import { VCardAdapter } from './vcard-adapter.js';
import { MarkdownAdapter } from './markdown-adapter.js';
import { RelationshipBuilder } from './relationship-builder.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';
import { Palette } from './palette.js';
import { ContactGraph } from './graph.js';
import { VCardUtils } from './vcard-utils.js';
import { ContactRecord } from './contact-record.js';

/**
 * Main application controller
 * Orchestrates: VCF import → parse → build graph data → render
 */
export class ContactRelationshipApp {
  constructor() {
    this.vcardAdapter = new VCardAdapter();
    this.markdownAdapter = new MarkdownAdapter();
    this.formatAdapters = [this.vcardAdapter, this.markdownAdapter];
    this._activeFormatId = 'vcard';
    this.parser = this.vcardAdapter.parser;
    this.builder = null;
    this.graph = null;
    this._storageKey = 'contacts-graph:last-session';
    this._dbName = 'contacts-graph-db';
    this._dbStoreName = 'sessions';
    this._dbPromise = null;

    this.contacts = [];
    this.graphData = { nodes: [], edges: [] };
    this.allCategories = [];
    this._contactById = new Map();
    this._contactsByUid = new Map();
    this._contactsByFn = new Map();
    this._nodeById = new Map();
    this._edgesByNodeId = new Map();
    this._relatedRefsByTargetId = new Map();

    this._activeFilters = new Set();
    this._showInferred = true;
    this._showLikelyFamily = false;
    this._showLikelyConnections = true;
    this._showIsolated = true;
    this._searchQuery = '';
    this._contactSortMode = 'first-last';
    this._graphMode = 'connections';
    this._mainViewMode = 'graph';
    this._tableSort = { key: 'name', dir: 'asc' };
    this._bulkRuleIdCounter = 0;
    this._bulkRuleState = null;
    this._selectedForExport = new Set();
    this._dismissedSuggestions = new Set();
    this._selfContactId = null;
    this._editingContactId = null;
    this._sidebarControlsCollapsed = false;
    this._inlineNotesSaveTimer = null;
    this._notesAutocomplete = {
      textarea: null,
      matches: [],
      selectedIndex: 0,
      start: -1,
      end: -1,
    };

    this._init();
  }

  _init() {
    // Apply the saved theme before the graph reads its colors.
    this._applyInitialTheme();
    document
      .getElementById('btn-theme-toggle')
      .addEventListener('click', () => this._toggleTheme());

    // Graph container
    const graphContainer = document.getElementById('graph-container');
    this.graph = new ContactGraph(graphContainer);

    this.graph
      .on('nodeSelect', (node) => this._onNodeSelect(node))
      .on('nodeDeselect', () => this._onNodeDeselect());

    // File input
    document.getElementById('file-input').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length) this._loadFiles(files);
    });

    // Drag & drop on the entire app
    const dropZone = document.getElementById('drop-zone');
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length && files.every((file) => this._adapterForFile(file))) {
        this._loadFiles(files);
      } else {
        this._showToast('Please drop a .vcf or .md file', 'error');
      }
    });

    // Search
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      this._searchQuery = e.target.value.toLowerCase();
      this._renderContactList();
      this._renderTableMode();
    });

    document.getElementById('contact-sort-mode').addEventListener('change', (e) => {
      this._contactSortMode = e.target.value === 'last-first' ? 'last-first' : 'first-last';
      this._renderContactList();
      this._renderTableMode();
      void this._persistSession();
    });

    document.getElementById('graph-mode-select').addEventListener('change', (e) => {
      this._graphMode = e.target.value || 'connections';
      this._syncGraphModeControls();
      this._rebuildGraph();
      void this._persistSession();
    });

    document.getElementById('self-contact-select').addEventListener('change', (e) => {
      this._selfContactId = e.target.value || null;
      this._rebuildGraph();
      void this._persistSession();
    });

    document.getElementById('btn-use-selected-contact').addEventListener('click', () => {
      if (!this._selectedNodeId) {
        this._showToast('Open a contact card first', 'error');
        return;
      }
      const node = this._node(this._selectedNodeId);
      if (!node || node.isVirtual) {
        this._showToast('Choose a real contact card', 'error');
        return;
      }
      this._selfContactId = node.id;
      document.getElementById('self-contact-select').value = node.id;
      this._rebuildGraph();
      void this._persistSession();
    });

    document.getElementById('btn-clear-self-contact').addEventListener('click', () => {
      this._selfContactId = null;
      document.getElementById('self-contact-select').value = '';
      this._rebuildGraph();
      void this._persistSession();
    });

    document.getElementById('btn-toggle-sidebar-controls').addEventListener('click', () => {
      this._sidebarControlsCollapsed = !this._sidebarControlsCollapsed;
      this._applySidebarCollapseState();
      void this._persistSession();
    });

    // Inferred toggle
    document.getElementById('toggle-inferred').addEventListener('change', (e) => {
      this._showInferred = e.target.checked;
      this.graph.setShowInferred(this._showInferred);
      this._rebuildGraph();
      void this._persistSession();
    });

    document.getElementById('toggle-likely-family').addEventListener('change', (e) => {
      this._showLikelyFamily = e.target.checked;
      this._rebuildGraph();
      void this._persistSession();
    });

    document.getElementById('toggle-likely-connections').addEventListener('change', (e) => {
      this._showLikelyConnections = e.target.checked;
      this._rebuildGraph();
      void this._persistSession();
    });

    // Isolated toggle
    document.getElementById('toggle-isolated').addEventListener('change', (e) => {
      this._showIsolated = e.target.checked;
      this._rebuildGraph();
      void this._persistSession();
    });

    // Reset view
    document.getElementById('btn-reset-view').addEventListener('click', () => {
      this.graph.resetView();
    });

    document.getElementById('btn-restore-session').addEventListener('click', () => {
      this._restorePersistedSession();
    });

    document.getElementById('btn-clear-session').addEventListener('click', () => {
      this._clearPersistedSession(true);
    });

    document.getElementById('btn-bulk-normalize').addEventListener('click', () => {
      this._openBulkNormalizeModal();
    });

    // Close detail panel
    document.getElementById('btn-close-detail').addEventListener('click', () => {
      this._onNodeDeselect();
    });

    // Import button
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });

    // Add relationship button (in detail panel)
    document.getElementById('btn-add-rel').addEventListener('click', () => {
      this._showAddRelationshipModal();
    });

    document.getElementById('btn-edit-contact').addEventListener('click', () => {
      if (!this._selectedNodeId) return;
      const contact = this._contact(this._selectedNodeId);
      if (!contact) return;
      this._editingContactId = contact.id;
      const node = this._node(contact.id);
      if (node) this._onNodeSelect(node);
    });

    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
      if (!this._selectedNodeId) return;
      this._editingContactId = null;
      const node = this._node(this._selectedNodeId);
      if (node) this._onNodeSelect(node);
    });

    document.getElementById('btn-save-contact').addEventListener('click', () => {
      this._saveDetailEdits();
    });

    document.getElementById('btn-create-contact').addEventListener('click', () => {
      this._createContactFromVirtual();
    });

    // Export All
    document.getElementById('btn-export-all').addEventListener('click', () => {
      const ids = new Set(this.contacts.map((c) => c.id));
      this._exportVCF(ids, 'all-contacts.vcf');
    });

    document.getElementById('btn-export-md-all').addEventListener('click', () => {
      const ids = new Set(this.contacts.map((c) => c.id));
      this._exportMarkdown(ids, 'all-contacts.md');
    });

    // Export Selected
    document.getElementById('btn-export-selected').addEventListener('click', () => {
      this._exportVCF(this._selectedForExport, 'selected-contacts.vcf');
    });

    // Clear selection
    document.getElementById('btn-clear-selection').addEventListener('click', () => {
      this._selectedForExport.clear();
      this._updateExportBar();
      this._renderContactList();
    });

    // Export Individual (detail panel)
    document.getElementById('btn-export-contact').addEventListener('click', () => {
      if (!this._selectedNodeId) return;
      const node = this._node(this._selectedNodeId);
      if (!node) return;
      const safe = (node.name || 'contact').replace(/[^a-zA-Z0-9_-]/g, '_');
      this._exportVCF(new Set([this._selectedNodeId]), `${safe}.vcf`);
    });

    document.getElementById('btn-delete-contact').addEventListener('click', () => {
      if (!this._selectedNodeId) return;
      this._deleteContact(this._selectedNodeId);
    });

    document.getElementById('btn-view-graph').addEventListener('click', () => {
      this._mainViewMode = 'graph';
      this._applyMainViewMode();
      void this._persistSession();
    });

    document.getElementById('btn-view-table').addEventListener('click', () => {
      this._mainViewMode = 'table';
      this._applyMainViewMode();
      void this._persistSession();
    });

    document.getElementById('btn-table-add-contact').addEventListener('click', () => {
      this._addContactFromTable();
    });

    this._applySidebarCollapseState();
    this._syncGraphModeControls();
    this._renderLegend();
    this._applyMainViewMode();
  }

  // ── File Loading ───────────────────────────────────────────────

  async _loadFile(file) {
    return this._loadFiles([file]);
  }

  async _loadFiles(filesInput) {
    const files = Array.from(filesInput || []).filter(Boolean);
    if (files.length === 0) return;

    const badFile = files.find((file) => !this._adapterForFile(file));
    if (badFile) {
      this._showToast(`Unsupported file type: ${badFile.name}`, 'error');
      return;
    }

    const label = files.length === 1 ? files[0].name : `${files.length} files`;
    this._showLoading(true, `Reading ${label}…`);

    try {
      const contacts = [];
      let activeFormatId = null;

      for (const file of files) {
        const text = await file.text();
        const adapter = this._adapterForFile(file) || this.vcardAdapter;
        this._showLoading(true, `Parsing ${file.name}…`);

        // Parse in next tick to let UI update
        await this._nextTick();
        const parsed = adapter.parse(text, { startIndex: contacts.length });
        contacts.push(...parsed);
        activeFormatId = activeFormatId && activeFormatId !== adapter.id ? 'mixed' : adapter.id;
      }
      this._activeFormatId = activeFormatId === 'markdown' ? 'markdown' : 'vcard';

      this._showLoading(true, `Building relationship graph…`);
      await this._nextTick();

      this.contacts = contacts;
      this.builder = new RelationshipBuilder(contacts);
      this._rebuildGraph();

      document.getElementById('file-label').textContent = label;
      document.getElementById('btn-export-all').classList.remove('hidden');
      document.getElementById('btn-export-md-all').classList.remove('hidden');
      this._selectedForExport.clear();
      this._updateExportBar();
      void this._persistSession({ fileLabel: label });
      this._showToast(`Loaded ${contacts.length} contacts`, 'success');
      document.getElementById('drop-zone').classList.add('hidden');
    } catch (err) {
      console.error(err);
      this._showToast('Failed to parse file: ' + err.message, 'error');
    } finally {
      this._showLoading(false);
    }
  }

  _rebuildGraph() {
    if (!this.builder) return;
    this._reindexContacts();

    const priorSelectionId = this._selectedNodeId;
    const data = this.builder.build({
      mode: this._graphMode,
      includeInferred: this._showInferred,
      includeLikelyFamily: this._showLikelyFamily,
      includeLikelyConnections: this._showLikelyConnections,
      includeIsolated: this._showIsolated,
      rootContactId: this._selfContactId,
    });

    this.graphData = data;
    this._reindexGraphData();

    // Collect all categories
    this.allCategories = this._availableFilterTags(data.nodes);
    this._pruneActiveFilters();
    this._renderSelfContactPicker();
    this._renderCategoryFilters();

    // Update stats
    const stats = this.builder.getStats(data.nodes, data.edges);
    this._renderStats(stats);
    this._renderLegend();
    this._syncGraphModeControls();

    // Render graph
    this.graph.render(data.nodes, data.edges, { mode: this._graphMode, hulls: data.hulls || [] });
    this.graph.setFilterCategories(Array.from(this._activeFilters));

    // Render contact list
    this._renderContactList();
    this._renderTableMode();

    if (priorSelectionId) {
      const selected = this._nodeById.get(priorSelectionId);
      if (selected) this._onNodeSelect(selected);
      else this._onNodeDeselect();
    }
  }

  _reindexContacts() {
    this._contactById = new Map();
    this._contactsByUid = new Map();
    this._contactsByFn = new Map();
    for (const contact of this.contacts || []) {
      this._syncContactRecord(contact);
      this._contactById.set(contact.id, contact);
      if (contact.uid) this._contactsByUid.set(contact.uid, contact);
      if (contact.fn) this._contactsByFn.set(contact.fn.toLowerCase().trim(), contact);
    }
  }

  _syncContactRecord(contact) {
    if (!contact || typeof ContactRecord === 'undefined') return contact;
    return ContactRecord.refreshLegacyContact(contact, {
      format: contact.sourceDocuments?.[0]?.format || 'vcard',
      raw: contact.rawVCard || contact.sourceDocuments?.[0]?.raw || '',
    });
  }

  _adapterForFile(file) {
    return this.formatAdapters.find((adapter) => adapter.canImportFile(file)) || null;
  }

  _adapterById(id) {
    return this.formatAdapters.find((adapter) => adapter.id === id) || null;
  }

  _reindexGraphData() {
    const nodes = this.graphData.nodes || [];
    const edges = this.graphData.edges || [];
    this._nodeById = new Map(nodes.map((node) => [node.id, node]));
    this._edgesByNodeId = new Map();
    const addEdge = (id, edge) => {
      if (!this._edgesByNodeId.has(id)) this._edgesByNodeId.set(id, []);
      this._edgesByNodeId.get(id).push(edge);
    };
    for (const edge of edges) {
      const source = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const target = typeof edge.target === 'object' ? edge.target.id : edge.target;
      addEdge(source, edge);
      addEdge(target, edge);
    }
    this._relatedRefsByTargetId = this._buildRelatedRefsByTargetId();
  }

  _buildRelatedRefsByTargetId() {
    const refs = new Map();
    const add = (targetId, ref) => {
      if (!refs.has(targetId)) refs.set(targetId, []);
      refs.get(targetId).push(ref);
    };
    for (const otherContact of this.contacts || []) {
      for (const rel of otherContact.related || []) {
        const target = this.builder?.findContact(rel.name);
        const targetId = target ? target.id : `virtual__${rel.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        add(targetId, {
          rel,
          fromContact: otherContact,
          fromNode: this._nodeById.get(otherContact.id),
        });
      }
    }
    return refs;
  }

  _contact(id) {
    return this._contactById.get(id) || null;
  }

  _node(id) {
    return this._nodeById.get(id) || null;
  }

  _edgesForNode(id) {
    return this._edgesByNodeId.get(id) || [];
  }

  _makeMinimalContact(displayName) {
    const structuredName = this._namePartsFromDisplayName(displayName || 'New Contact');
    const contact = {
      id: this.parser._generateId(),
      uid: null,
      fn: displayName || 'New Contact',
      name: structuredName,
      org: '',
      title: '',
      isCompany: false,
      emails: [],
      phones: [],
      addresses: [],
      birthday: null,
      anniversary: null,
      notes: [],
      related: [],
      urls: [],
      photo: null,
      tags: ['other'],
      rawVCard: '',
    };

    contact.rawVCard = this._joinVCardLines([
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${this._vCardEscape(contact.fn)}`,
      `N:${this._vCardEscape(contact.name.family)};${this._vCardEscape(contact.name.given)};${this._vCardEscape(contact.name.additional)};${this._vCardEscape(contact.name.prefix)};${this._vCardEscape(contact.name.suffix)}`,
      'END:VCARD',
    ]);
    return contact;
  }

  // ── Helpers ────────────────────────────────────────────────────

  _initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  _notesText(notes) {
    if (Array.isArray(notes)) return notes.join('\n\n');
    return String(notes || '');
  }

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return dateStr;
    const [, y, mo, d] = m;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const year = y === '1604' ? '' : y;
    return `${months[parseInt(mo) - 1]} ${parseInt(d)}${year ? ', ' + year : ''}`;
  }

  _formatBirthday(dateStr) {
    const formatted = this._formatDate(dateStr);
    const age = this._ageFromDate(dateStr);
    return age == null ? formatted : `${formatted} (${age})`;
  }

  _formatDateWithYears(dateStr) {
    const formatted = this._formatDate(dateStr);
    const years = this._ageFromDate(dateStr);
    return years == null ? formatted : `${formatted} (${years})`;
  }

  _renderGroupNodeDetail(node, contactInfo, notesEl, relsEl) {
    contactInfo.innerHTML = '';
    relsEl.innerHTML = '';
    notesEl.parentElement.classList.add('hidden');

    const memberNames = (node.memberIds || [])
      .map((id) => this._node(id))
      .filter(Boolean)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const rows = [
      this._detailField('Group Type', this._groupKindLabel(node.groupKind)),
      this._detailField('Members', String(memberNames.length)),
    ];
    if (node.groupDepth) {
      rows.push(this._detailField('Hierarchy Level', String(node.groupDepth)));
    }
    contactInfo.append(...rows);

    if (memberNames.length > 0) {
      const header = document.createElement('div');
      header.className = 'rel-section-header';
      header.textContent = 'Members';
      relsEl.appendChild(header);

      for (const member of memberNames) {
        const item = document.createElement('div');
        item.className = `rel-item rel-${member.category}`;
        item.innerHTML = `
          <span class="rel-type">Member</span>
          <span class="rel-name">${this._escapeHtml(member.name)}</span>
        `;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          this.graph.highlightContact(member.id);
          this._onNodeSelect(member);
        });
        relsEl.appendChild(item);
      }
    } else {
      relsEl.innerHTML = '<div class="rel-empty">No contacts in this group</div>';
    }
  }

  _groupKindLabel(kind) {
    const labels = {
      'likely-family': 'Likely connections cluster',
      'likely-surname': 'Likely shared-surname cluster',
      'likely-tag': 'Likely shared-tag cluster',
      'geo-country': 'Country group',
      'geo-state': 'State / province group',
      'geo-city': 'City group',
      'geo-street': 'Street group',
    };
    return labels[kind] || 'Group';
  }

  _structuredNameFor(entity) {
    if (entity?.structuredName && typeof entity.structuredName === 'object')
      return entity.structuredName;
    if (entity?.name && typeof entity.name === 'object') return entity.name;
    return null;
  }

  _formatContactListName(entity, mode = this._contactSortMode) {
    const fallback = String(entity?.fn || entity?.name || '').trim();
    const structured = this._structuredNameFor(entity);
    if (!structured) return fallback;

    const family = String(structured.family || '').trim();
    const given = String(structured.given || '').trim();
    const additional = String(structured.additional || '').trim();
    const prefix = String(structured.prefix || '').trim();
    const suffix = String(structured.suffix || '').trim();

    if (mode !== 'last-first') {
      return fallback || this._composeDisplayName(structured);
    }

    if (!family || !given) {
      return fallback || this._composeDisplayName(structured);
    }

    const trailing = [prefix, given, additional, suffix]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return trailing ? `${family}, ${trailing}` : family;
  }

  _contactListSortKey(entity) {
    const fallback = this._formatContactListName(entity, 'first-last').toLowerCase();
    const structured = this._structuredNameFor(entity);
    if (this._contactSortMode !== 'last-first' || !structured) {
      return fallback;
    }

    const family = String(structured.family || '')
      .trim()
      .toLowerCase();
    const given = String(structured.given || '')
      .trim()
      .toLowerCase();
    const additional = String(structured.additional || '')
      .trim()
      .toLowerCase();
    const prefix = String(structured.prefix || '')
      .trim()
      .toLowerCase();
    const suffix = String(structured.suffix || '')
      .trim()
      .toLowerCase();

    if (!family || !given) {
      return fallback;
    }

    return [family, given, additional, prefix, suffix].filter(Boolean).join('\u0000');
  }

  _ageFromDate(dateStr) {
    const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (!year || year === 1604) return null;

    const today = new Date();
    let age = today.getFullYear() - year;
    if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) {
      age -= 1;
    }
    return age >= 0 ? age : null;
  }

  _detailRow(icon, content, label) {
    const row = document.createElement('div');
    row.className = 'detail-row';
    row.innerHTML = `
      <span class="detail-icon">${icon}</span>
      <div class="detail-field">
        <div class="detail-value">${content}</div>
        ${label ? `<div class="detail-label">${this._escapeHtml(label)}</div>` : ''}
      </div>
    `;
    return row;
  }

  _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _safeExternalHref(value) {
    const raw = String(value || '')
      .trim()
      .replace(/[\r\n]/g, '');
    if (!raw) return '';
    try {
      const base = window.location?.href || 'https://example.invalid/';
      const url = new URL(raw, base);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch (_) {
      return '';
    }
    return '';
  }

  _showLoading(show, msg = '') {
    const el = document.getElementById('loading-overlay');
    if (show) {
      el.querySelector('.loading-msg').textContent = msg;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  _showToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast toast-${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  _nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 16));
  }
}
