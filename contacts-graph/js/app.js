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

  // ── Contact List ───────────────────────────────────────────────

  _renderContactList() {
    const list = document.getElementById('contact-list');
    list.innerHTML = '';
    const contacts = this._filteredContactsForSidebar();

    const frag = document.createDocumentFragment();
    for (const c of contacts) {
      const item = document.createElement('div');
      item.className = `contact-item category-${c.category}`;
      item.dataset.id = c.id;
      const tagColors = this._contactListColors(c);
      const accent = tagColors[0] || '#8395a7';
      const soft = this._withAlpha(accent, 0.18);
      item.style.setProperty('--contact-accent', accent);
      item.style.setProperty('--contact-accent-soft', soft);

      // Checkbox for multi-select export
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'contact-export-cb';
      cb.checked = this._selectedForExport.has(c.id);
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        if (cb.checked) this._selectedForExport.add(c.id);
        else this._selectedForExport.delete(c.id);
        this._updateExportBar();
      });
      cb.addEventListener('click', (e) => e.stopPropagation());

      const dot = document.createElement('span');
      dot.className = 'contact-dot';
      dot.style.background = this._contactListDotFill(tagColors);

      const info = document.createElement('div');
      info.className = 'contact-info';

      const name = document.createElement('div');
      name.className = 'contact-name';
      name.textContent = this._formatContactListName(c);

      const sub = document.createElement('div');
      sub.className = 'contact-sub';
      sub.textContent = c.org || c.category;

      info.appendChild(name);
      info.appendChild(sub);
      item.appendChild(cb);
      item.appendChild(dot);
      item.appendChild(info);

      item.addEventListener('click', () => {
        this.graph.highlightContact(c.id);
        this._onNodeSelect(c);
      });

      frag.appendChild(item);
    }

    list.appendChild(frag);

    document.getElementById('list-count').textContent =
      `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`;
  }

  _filteredContactsForSidebar() {
    let contacts = this.graphData.nodes
      .filter((n) => !n.isVirtual && !n.isGroupNode)
      .sort((a, b) => this._contactListSortKey(a).localeCompare(this._contactListSortKey(b)));

    if (this._searchQuery) {
      const q = this._searchQuery;
      contacts = contacts.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          this._formatContactListName(c, 'last-first').toLowerCase().includes(q) ||
          (c.org || '').toLowerCase().includes(q) ||
          (c.title || '').toLowerCase().includes(q) ||
          (c.notes || []).join('\n').toLowerCase().includes(q),
      );
    }

    if (this._activeFilters.size > 0) {
      contacts = contacts.filter((c) =>
        (c.filterTags || []).some((tag) => this._activeFilters.has(tag)),
      );
    }
    return contacts;
  }

  _applyMainViewMode() {
    const graphContainer = document.getElementById('graph-container');
    const tableMode = document.getElementById('table-mode');
    const legend = document.getElementById('graph-legend');
    const graphBtn = document.getElementById('btn-view-graph');
    const tableBtn = document.getElementById('btn-view-table');
    const isTable = this._mainViewMode === 'table';
    tableMode?.classList.toggle('hidden', !isTable);
    graphContainer?.classList.toggle('hidden', isTable);
    legend?.classList.toggle('hidden', isTable);
    graphBtn?.classList.toggle('active', !isTable);
    tableBtn?.classList.toggle('active', isTable);
    if (isTable) this._renderTableMode();
    this._scheduleGraphResize();
  }

  _renderTableMode() {
    if (this._mainViewMode !== 'table') return;
    const head = document.getElementById('contacts-table-head');
    const body = document.getElementById('contacts-table-body');
    if (!head || !body) return;

    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'org', label: 'Organization' },
      { key: 'title', label: 'Title' },
      { key: 'emails', label: 'Emails' },
      { key: 'phones', label: 'Phones' },
      { key: 'urls', label: 'Websites' },
      { key: 'addresses', label: 'Addresses' },
      { key: 'birthday', label: 'Birthday' },
      { key: 'anniversary', label: 'Anniversary' },
      { key: 'tags', label: 'Tags' },
      { key: 'notes', label: 'Notes' },
      { key: 'actions', label: 'Actions' },
    ];

    head.innerHTML = '';
    body.innerHTML = '';

    const headerRow = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      if (col.key === 'actions') {
        th.textContent = col.label;
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        const active = this._tableSort.key === col.key;
        btn.textContent = col.label + (active ? (this._tableSort.dir === 'asc' ? ' ↑' : ' ↓') : '');
        btn.addEventListener('click', () => this._setTableSort(col.key));
        th.appendChild(btn);
      }
      headerRow.appendChild(th);
    }
    head.appendChild(headerRow);

    const contacts = this._filteredContactsForSidebar()
      .map((node) => this._contact(node.id))
      .filter(Boolean)
      .sort((a, b) => this._compareTableContacts(a, b));

    if (contacts.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns.length;
      td.className = 'table-empty';
      td.textContent = 'No contacts match the current search and filters.';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    for (const contact of contacts) {
      const tr = document.createElement('tr');
      tr.dataset.id = contact.id;
      tr.appendChild(this._tableInputCell(contact, 'fn', contact.fn || '', { multiline: false }));
      tr.appendChild(this._tableInputCell(contact, 'org', contact.org || '', { multiline: false }));
      tr.appendChild(
        this._tableInputCell(contact, 'title', contact.title || '', { multiline: false }),
      );
      tr.appendChild(
        this._tableCollectionCell(contact, 'email', contact.emails || [], (entry) => entry.value),
      );
      tr.appendChild(
        this._tableCollectionCell(contact, 'phone', contact.phones || [], (entry) => entry.value),
      );
      tr.appendChild(
        this._tableCollectionCell(contact, 'url', contact.urls || [], (entry) =>
          typeof entry === 'string' ? entry : entry.value,
        ),
      );
      tr.appendChild(this._tableAddressCell(contact));
      tr.appendChild(
        this._tableInputCell(contact, 'birthday', contact.birthday || '', {
          multiline: false,
          type: 'date',
        }),
      );
      tr.appendChild(
        this._tableInputCell(contact, 'anniversary', contact.anniversary || '', {
          multiline: false,
          type: 'date',
        }),
      );
      tr.appendChild(this._tableTagsCell(contact));
      tr.appendChild(
        this._tableInputCell(contact, 'notes', this._notesText(contact.notes), { multiline: true }),
      );
      tr.appendChild(this._tableActionsCell(contact));
      body.appendChild(tr);
    }
  }

  _setTableSort(key) {
    if (this._tableSort.key === key) {
      this._tableSort.dir = this._tableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      this._tableSort = { key, dir: 'asc' };
    }
    this._renderTableMode();
  }

  _compareTableContacts(a, b) {
    const dir = this._tableSort.dir === 'desc' ? -1 : 1;
    const key = this._tableSort.key;
    const get = (contact) => {
      switch (key) {
        case 'name':
          return contact.fn || '';
        case 'org':
          return contact.org || '';
        case 'title':
          return contact.title || '';
        case 'emails':
          return (contact.emails || []).map((e) => e.value).join(' ');
        case 'phones':
          return (contact.phones || []).map((p) => p.value).join(' ');
        case 'urls':
          return (contact.urls || []).map((u) => (typeof u === 'string' ? u : u.value)).join(' ');
        case 'addresses':
          return (contact.addresses || [])
            .map((a) => [a.street, a.city, a.state, a.zip, a.country].filter(Boolean).join(' '))
            .join(' ');
        case 'birthday':
          return contact.birthday || '';
        case 'anniversary':
          return contact.anniversary || '';
        case 'tags':
          return (contact.noteTags || []).join(' ');
        case 'notes':
          return this._notesText(contact.notes);
        default:
          return contact.fn || '';
      }
    };
    return get(a).localeCompare(get(b), undefined, { sensitivity: 'base' }) * dir;
  }

  _tableInputCell(contact, field, value, { multiline = false, type = 'text' } = {}) {
    const td = document.createElement('td');
    const input = multiline ? document.createElement('textarea') : document.createElement('input');
    input.className = multiline ? 'table-cell-textarea' : 'table-cell-input';
    if (!multiline) input.type = type;
    input.value = value || '';
    input.addEventListener('change', () => this._applyTableEdit(contact.id, field, input.value));
    if (multiline && field === 'notes') {
      this._bindNotesAutocomplete(input, false, contact.id);
    }
    td.appendChild(input);
    return td;
  }

  _tableCollectionCell(contact, kind, entries, getValue) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-metadata-list';

    const save = () => {
      const nextEntries = [...wrap.querySelectorAll('.table-metadata-item')]
        .map((item) => {
          const value = item.querySelector('[data-role="value"]')?.value.trim() || '';
          if (!value) return null;
          const typeSelect = item.querySelector('select[data-role="types-select"]');
          const typesInput = item.querySelector('input[data-role="types-custom"]');
          return {
            value,
            types: this._normalizeStoredTypes(
              kind,
              this._selectedTypesFromEditor(
                kind,
                typeSelect?.value || this._defaultTypeOption(kind),
                typesInput?.value || '',
              ),
              !!item.querySelector('input[data-role="preferred"]')?.checked,
            ),
          };
        })
        .filter(Boolean);
      this._applyTableEdit(contact.id, kind === 'url' ? 'urls' : `${kind}s`, nextEntries);
    };

    const addItem = (entry = null) => {
      const item = document.createElement('div');
      item.className = 'table-metadata-item';
      item.dataset.kind = kind;

      const valueInput = document.createElement('input');
      valueInput.className = 'table-cell-input';
      valueInput.dataset.role = 'value';
      valueInput.value = entry ? getValue(entry) : '';
      valueInput.placeholder = this._tableCollectionPlaceholder(kind);

      const typeState = this._typeSelectionState(kind, entry?.types || []);
      const typeSelect = this._typeSelect(kind, typeState.selected);
      typeSelect.classList.add('table-type-select');
      const typeInput = this._customTypeInput(
        kind,
        'types-custom',
        typeState.customValue,
        typeState.selected === 'custom',
      );
      typeInput.classList.add('table-type-input');
      this._bindTypeEditor(typeSelect, typeInput);

      const metaRow = document.createElement('div');
      metaRow.className = 'table-metadata-meta';
      metaRow.appendChild(typeSelect);
      metaRow.appendChild(typeInput);

      const footer = document.createElement('div');
      footer.className = 'table-metadata-footer';
      footer.appendChild(
        this._tablePreferredRadio(contact.id, kind, this._isPreferred(entry?.types || [])),
      );

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        item.remove();
        save();
      });
      footer.appendChild(removeBtn);

      [valueInput, typeSelect, typeInput].forEach((el) => {
        el.addEventListener('change', save);
      });
      footer.querySelector('input[data-role="preferred"]').addEventListener('change', save);

      item.appendChild(valueInput);
      item.appendChild(metaRow);
      item.appendChild(footer);
      wrap.appendChild(item);
    };

    if (entries.length > 0) entries.forEach(addItem);
    else addItem();

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs table-add-metadata';
    addBtn.type = 'button';
    addBtn.textContent = `+ Add ${this._tableCollectionLabel(kind)}`;
    addBtn.addEventListener('click', () => addItem());

    td.appendChild(wrap);
    td.appendChild(addBtn);
    return td;
  }

  _tableAddressCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-metadata-list';

    const save = () => {
      const nextAddresses = [...wrap.querySelectorAll('.table-address-item')]
        .map((item) => {
          const street = item.querySelector('[data-addr="street"]')?.value.trim() || '';
          const city = item.querySelector('[data-addr="city"]')?.value.trim() || '';
          const state = item.querySelector('[data-addr="state"]')?.value.trim() || '';
          const zip = item.querySelector('[data-addr="zip"]')?.value.trim() || '';
          const country = item.querySelector('[data-addr="country"]')?.value.trim() || '';
          if (!street && !city && !state && !zip && !country) return null;
          return {
            pobox: '',
            ext: '',
            street,
            city,
            state,
            zip,
            country,
            types: this._normalizeStoredTypes(
              'address',
              this._selectedTypesFromEditor(
                'address',
                item.querySelector('select[data-addr="type-select"]')?.value ||
                  this._defaultTypeOption('address'),
                item.querySelector('[data-addr="types"]')?.value || '',
              ),
              !!item.querySelector('input[data-role="preferred"]')?.checked,
            ),
          };
        })
        .filter(Boolean);
      this._applyTableEdit(contact.id, 'addresses', nextAddresses);
    };

    const addItem = (address = null) => {
      const item = document.createElement('div');
      item.className = 'table-metadata-item table-address-item';

      const fields = document.createElement('div');
      fields.className = 'table-address-grid';
      for (const [label, key, value] of [
        ['Street', 'street', address?.street || ''],
        ['City', 'city', address?.city || ''],
        ['State', 'state', address?.state || ''],
        ['ZIP', 'zip', address?.zip || ''],
        ['Country', 'country', address?.country || ''],
      ]) {
        const input = document.createElement('input');
        input.className = 'table-cell-input';
        input.placeholder = label;
        input.dataset.addr = key;
        input.value = value;
        input.addEventListener('change', save);
        fields.appendChild(input);
      }

      const typeState = this._typeSelectionState('address', address?.types || []);
      const typeSelect = this._typeSelect('address', typeState.selected, 'addr-type-select');
      typeSelect.classList.add('table-type-select');
      const typeInput = this._customTypeInput(
        'address',
        'types',
        typeState.customValue,
        typeState.selected === 'custom',
      );
      typeInput.classList.add('table-type-input');
      this._bindTypeEditor(typeSelect, typeInput);

      const metaRow = document.createElement('div');
      metaRow.className = 'table-metadata-meta';
      metaRow.appendChild(typeSelect);
      metaRow.appendChild(typeInput);

      const footer = document.createElement('div');
      footer.className = 'table-metadata-footer';
      footer.appendChild(
        this._tablePreferredRadio(contact.id, 'address', this._isPreferred(address?.types || [])),
      );

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        item.remove();
        save();
      });
      footer.appendChild(removeBtn);

      [typeSelect, typeInput].forEach((el) => el.addEventListener('change', save));
      footer.querySelector('input[data-role="preferred"]').addEventListener('change', save);

      item.appendChild(fields);
      item.appendChild(metaRow);
      item.appendChild(footer);
      wrap.appendChild(item);
    };

    if ((contact.addresses || []).length > 0) contact.addresses.forEach(addItem);
    else addItem();

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs table-add-metadata';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Address';
    addBtn.addEventListener('click', () => addItem());

    td.appendChild(wrap);
    td.appendChild(addBtn);
    return td;
  }

  _tableCollectionPlaceholder(kind) {
    const labels = {
      email: 'Email address',
      phone: 'Phone number',
      url: 'Website',
    };
    return labels[kind] || 'Value';
  }

  _tableCollectionLabel(kind) {
    const labels = {
      email: 'Email',
      phone: 'Phone',
      url: 'Website',
    };
    return labels[kind] || 'Value';
  }

  _tablePreferredRadio(contactId, kind, checked) {
    const label = document.createElement('label');
    label.className = 'table-preferred-toggle';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `table-preferred-${kind}-${contactId}`;
    input.dataset.role = 'preferred';
    input.checked = !!checked;

    const text = document.createElement('span');
    text.textContent = 'Preferred';

    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  _tableTagsCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-cell-tags';
    const tags = (contact.noteTags || []).length ? contact.noteTags : [];
    if (!tags.length) {
      const none = document.createElement('span');
      none.className = 'table-tag';
      none.textContent = 'None';
      wrap.appendChild(none);
    } else {
      for (const tag of tags) {
        const el = document.createElement('span');
        el.className = 'table-tag';
        el.textContent = `#${tag}`;
        wrap.appendChild(el);
      }
    }
    td.appendChild(wrap);
    return td;
  }

  _tableActionsCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-row-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-ghost btn-xs';
    openBtn.type = 'button';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => {
      const node = this._node(contact.id);
      if (!node) return;
      this._selectedNodeId = node.id;
      this._mainViewMode = 'graph';
      this._applyMainViewMode();
      this.graph.highlightContact(node.id);
      this._onNodeSelect(node);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-ghost btn-xs';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => this._deleteContact(contact.id));

    wrap.appendChild(openBtn);
    wrap.appendChild(deleteBtn);
    td.appendChild(wrap);
    return td;
  }

  _applyTableEdit(contactId, field, rawValue) {
    const contact = this._contact(contactId);
    if (!contact) return;
    const value = String(rawValue ?? '');
    if (field === 'fn') {
      contact.fn = value.trim();
      contact.name = this._namePartsFromDisplayName(contact.fn || '');
    } else if (field === 'org') {
      contact.org = value.trim();
    } else if (field === 'title') {
      contact.title = value.trim();
    } else if (field === 'birthday') {
      contact.birthday = value || null;
    } else if (field === 'anniversary') {
      contact.anniversary = value || null;
    } else if (field === 'emails') {
      contact.emails = this._ensureSinglePreferred(
        Array.isArray(rawValue) ? rawValue : [],
        'email',
      );
    } else if (field === 'phones') {
      contact.phones = this._ensureSinglePreferred(
        Array.isArray(rawValue) ? rawValue : [],
        'phone',
      );
    } else if (field === 'urls') {
      contact.urls = this._ensureSinglePreferred(Array.isArray(rawValue) ? rawValue : [], 'url');
    } else if (field === 'addresses') {
      contact.addresses = this._ensureSinglePreferred(
        Array.isArray(rawValue) ? rawValue : [],
        'address',
      );
    } else if (field === 'notes') {
      contact.notes = this._splitNotes(value);
      contact.noteTags = this.parser._extractHashtags(contact.notes);
      contact.tags = this.parser._inferTags(contact);
    }
    this._rewriteEditableFields(contact);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
  }

  _addContactFromTable() {
    const contact = {
      id: this.parser._generateId(),
      uid: null,
      fn: 'New Contact',
      name: this._namePartsFromDisplayName('New Contact'),
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
      noteTags: [],
      rawVCard: '',
    };
    contact.rawVCard = this._joinVCardLines([
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${this._vCardEscape(contact.fn)}`,
      `N:${this._vCardEscape(contact.name.family)};${this._vCardEscape(contact.name.given)};${this._vCardEscape(contact.name.additional)};${this._vCardEscape(contact.name.prefix)};${this._vCardEscape(contact.name.suffix)}`,
      'END:VCARD',
    ]);
    this.contacts.push(contact);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    this._mainViewMode = 'table';
    this._applyMainViewMode();
    void this._persistSession();
  }

  _deleteContact(contactId) {
    const contact = this._contact(contactId);
    if (!contact) return;
    const ok = window.confirm(
      `Delete ${contact.fn || 'this contact'} from the current working dataset?`,
    );
    if (!ok) return;
    this.contacts = this.contacts.filter((c) => c.id !== contactId);
    this.builder = new RelationshipBuilder(this.contacts);
    if (this._selectedNodeId === contactId) {
      this._selectedNodeId = null;
      this._editingContactId = null;
      this._onNodeDeselect();
    }
    this._rebuildGraph();
    void this._persistSession();
  }

  _contactListColors(contact) {
    const preferredOrder = ['family', 'company', 'virtual', 'other'];
    const tags = Array.from(new Set(contact.filterTags || []));
    tags.sort((a, b) => {
      const ai = preferredOrder.indexOf(a);
      const bi = preferredOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }
      return a.localeCompare(b);
    });
    const colors = tags.map((tag) => this._tagColor(tag)).filter(Boolean);
    return colors.length ? colors.slice(0, 4) : ['#8395a7'];
  }

  _contactListDotFill(colors) {
    if (!colors || colors.length === 0) return '#8395a7';
    if (colors.length === 1) return colors[0];
    const stops = colors.map((color, idx) => {
      const start = Math.round((idx / colors.length) * 100);
      const end = Math.round(((idx + 1) / colors.length) * 100);
      return `${color} ${start}% ${end}%`;
    });
    return `linear-gradient(135deg, ${stops.join(', ')})`;
  }

  _tagColor(tag) {
    // Known categories come from the shared CSS palette (single source).
    if (['family', 'company', 'virtual', 'other'].includes(tag)) {
      return Palette.category(tag);
    }

    // Stable color for user hashtags.
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    const sat = 58 + (hash % 14);
    const light = 58 + ((hash >> 3) % 10);
    return `hsl(${hue}deg ${sat}% ${light}%)`;
  }

  _withAlpha(color, alpha) {
    if (!color) return `rgba(131, 149, 167, ${alpha})`;
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const normalized =
        hex.length === 3
          ? hex
              .split('')
              .map((ch) => ch + ch)
              .join('')
          : hex.padEnd(6, '0').slice(0, 6);
      const int = parseInt(normalized, 16);
      const r = (int >> 16) & 255;
      const g = (int >> 8) & 255;
      const b = int & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    const hslMatch = color.match(/^hsl\(\s*([0-9.]+)(?:deg)?\s+([0-9.]+)%\s+([0-9.]+)%\s*\)$/i);
    if (hslMatch) {
      return `hsla(${hslMatch[1]}deg ${hslMatch[2]}% ${hslMatch[3]}% / ${alpha})`;
    }
    return color;
  }

  _bestTextColor(color) {
    const rgb = this._colorToRgb(color);
    if (!rgb) return '#fff';
    const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    return luminance > 0.66 ? '#111' : '#fff';
  }

  _colorToRgb(color) {
    if (!color) return null;
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const normalized =
        hex.length === 3
          ? hex
              .split('')
              .map((ch) => ch + ch)
              .join('')
          : hex.padEnd(6, '0').slice(0, 6);
      const int = parseInt(normalized, 16);
      return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255,
      };
    }
    const hslMatch = color.match(/^hsl\(\s*([0-9.]+)(?:deg)?\s+([0-9.]+)%\s+([0-9.]+)%\s*\)$/i);
    if (!hslMatch) return null;
    const h = Number(hslMatch[1]) % 360;
    const s = Number(hslMatch[2]) / 100;
    const l = Number(hslMatch[3]) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0,
      g1 = 0,
      b1 = 0;
    if (h < 60) [r1, g1, b1] = [c, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, c, 0];
    else if (h < 180) [r1, g1, b1] = [0, c, x];
    else if (h < 240) [r1, g1, b1] = [0, x, c];
    else if (h < 300) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
    };
  }

  // ── Export ─────────────────────────────────────────────────────

  _updateExportBar() {
    const bar = document.getElementById('export-bar');
    const n = this._selectedForExport.size;
    if (n === 0) {
      bar.classList.add('hidden');
    } else {
      bar.classList.remove('hidden');
      document.getElementById('export-bar-count').textContent =
        `${n} contact${n !== 1 ? 's' : ''} selected`;
    }
  }

  _exportVCF(ids, filename) {
    this._exportWithAdapter(this.vcardAdapter, ids, filename);
  }

  _exportMarkdown(ids, filename) {
    this._exportWithAdapter(this.markdownAdapter, ids, filename);
  }

  _exportWithAdapter(adapter, ids, filename) {
    const blob = adapter.exportBlob(this.contacts, ids);
    if (!blob) {
      this._showToast('No exportable contacts found', 'error');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const selectedIds = ids ? new Set(ids) : null;
    const exportedCount = this.contacts.filter((contact) => {
      if (selectedIds && !selectedIds.has(contact.id)) return false;
      if (adapter.id === 'vcard') return !!contact.rawVCard;
      return true;
    }).length;
    this._showToast(
      `Exported ${exportedCount} contact${exportedCount !== 1 ? 's' : ''} as ${adapter.label}`,
      'success',
    );
  }

  // ── Category Filters ───────────────────────────────────────────

  _renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    container.innerHTML = '';

    const CATEGORY_LABELS = {
      family: 'My Family',
      company: 'Company',
      virtual: 'Virtual',
      other: 'None',
    };

    const counts = {};
    for (const n of this.graphData.nodes) {
      for (const tag of n.filterTags || []) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }

    for (const cat of this.allCategories) {
      const label = CATEGORY_LABELS[cat] || `#${cat}`;
      const count = counts[cat] || 0;
      const accent = this._tagColor(cat);

      const btn = document.createElement('button');
      btn.className = `filter-btn category-${cat}`;
      btn.dataset.cat = cat;
      btn.style.setProperty('--filter-accent', accent);
      btn.style.setProperty('--filter-active-fg', this._bestTextColor(accent));
      btn.innerHTML = `<span class="filter-dot"></span>${label} <span class="filter-count">${count}</span>`;
      if (this._activeFilters.has(cat)) btn.classList.add('active');
      if (cat === 'family' && !this._selfContactId) btn.title = 'Choose "me" to enable My Family';

      btn.addEventListener('click', () => {
        if (cat === 'family' && !this._selfContactId) {
          this._showToast('Choose "me" first to use My Family', 'error');
          return;
        }
        if (this._activeFilters.has(cat)) {
          this._activeFilters.delete(cat);
          btn.classList.remove('active');
        } else {
          this._activeFilters.add(cat);
          btn.classList.add('active');
        }
        this.graph.setFilterCategories(Array.from(this._activeFilters));
        this._renderContactList();
      });

      container.appendChild(btn);
    }
  }

  _availableFilterTags(nodes) {
    const system = ['family', 'company', 'virtual', 'other'];
    const available = new Set(system);
    const dynamic = new Set();

    for (const n of nodes) {
      for (const tag of n.filterTags || []) {
        if (system.includes(tag)) available.add(tag);
        else dynamic.add(tag);
      }
    }
    return [...system, ...Array.from(dynamic).sort((a, b) => a.localeCompare(b))];
  }

  _renderSelfContactPicker() {
    const select = document.getElementById('self-contact-select');
    const help = document.getElementById('self-contact-help');
    const prev = this._selfContactId || '';

    select.innerHTML = '<option value="">Choose "me" contact…</option>';
    const sorted = [...this.contacts].sort((a, b) => a.fn.localeCompare(b.fn));
    for (const c of sorted) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.fn;
      select.appendChild(opt);
    }

    if (prev && this._contact(prev)) {
      select.value = prev;
      const me = this._contact(prev);
      help.textContent = me
        ? `My Family is the explicit relationship network connected to ${me.fn}.`
        : 'My Family includes any contact connected to "me" by explicit relationships at any distance.';
    } else {
      this._selfContactId = null;
      select.value = '';
      help.textContent =
        'My Family includes any contact connected to "me" by explicit relationships at any distance.';
    }
  }

  _pruneActiveFilters() {
    const allowed = new Set(this.allCategories);
    for (const tag of [...this._activeFilters]) {
      if (!allowed.has(tag) || (tag === 'family' && !this._selfContactId)) {
        this._activeFilters.delete(tag);
      }
    }
  }

  // ── Stats ──────────────────────────────────────────────────────

  _renderStats(stats) {
    document.getElementById('stat-contacts').textContent = stats.totalContacts;
    document.getElementById('stat-nodes').textContent = stats.visibleNodes;
    document.getElementById('stat-edges').textContent = stats.edges;

    const explicitEdges = (this.graphData.edges || []).reduce(
      (count, edge) => count + (edge.inferred ? 0 : 1),
      0,
    );
    document.getElementById('stat-explicit').textContent = explicitEdges;
  }

  _renderLegend() {
    const itemsEl = document.getElementById('legend-items');
    if (!itemsEl) return;
    itemsEl.innerHTML = '';

    let items = this.graph.getLegend(this._graphMode);
    if (this._graphMode === 'connections') {
      if (!this._showLikelyFamily) {
        items = items.filter((item) => item.label !== 'Likely family');
      }
      if (!this._showLikelyConnections) {
        items = items.filter((item) => item.label !== 'Likely connection');
      }
      if (!this._showLikelyFamily && !this._showLikelyConnections) {
        items = items.filter((item) => item.label !== 'Likely cluster hull');
      }
      if (!this._showInferred) {
        items = items.filter((item) => item.label !== 'Organization cluster');
      }
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'legend-item';
      const swatch = document.createElement('span');
      swatch.className = item.type === 'line' ? 'legend-line' : 'legend-dot';
      if (item.type === 'hull') swatch.className = 'legend-hull';
      if (item.style) swatch.style.cssText = item.style;
      else if (item.color) swatch.style.background = item.color;
      row.appendChild(swatch);
      row.appendChild(document.createTextNode(item.label));
      itemsEl.appendChild(row);
    }
  }

  _syncGraphModeControls() {
    const modeSelect = document.getElementById('graph-mode-select');
    const inferredToggle = document.getElementById('toggle-inferred');
    const inferredLabel = document.querySelector('label[for="toggle-inferred"]');
    if (modeSelect) modeSelect.value = this._graphMode;
    if (!inferredToggle) return;
    const likelyFamilyToggle = document.getElementById('toggle-likely-family');
    const likelyConnectionsToggle = document.getElementById('toggle-likely-connections');
    const orgEnabled = this._graphMode === 'connections';
    inferredToggle.disabled = !orgEnabled;
    const orgRow = inferredToggle.closest('.toggle-row');
    if (orgRow) orgRow.classList.toggle('disabled', !orgEnabled);
    if (likelyFamilyToggle) {
      likelyFamilyToggle.disabled = !orgEnabled;
      const likelyFamilyRow = likelyFamilyToggle.closest('.toggle-row');
      if (likelyFamilyRow) likelyFamilyRow.classList.toggle('disabled', !orgEnabled);
    }
    if (likelyConnectionsToggle) {
      likelyConnectionsToggle.disabled = !orgEnabled;
      const likelyConnectionsRow = likelyConnectionsToggle.closest('.toggle-row');
      if (likelyConnectionsRow) likelyConnectionsRow.classList.toggle('disabled', !orgEnabled);
    }
  }

  _applySidebarCollapseState() {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.getElementById('btn-toggle-sidebar-controls');
    const icon = btn?.querySelector('.sidebar-collapse-icon');
    if (sidebar) sidebar.classList.toggle('collapsed', this._sidebarControlsCollapsed);
    if (btn) {
      const collapsed = this._sidebarControlsCollapsed;
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('title', collapsed ? 'Expand settings panel' : 'Collapse settings panel');
      btn.setAttribute(
        'aria-label',
        collapsed ? 'Expand settings panel' : 'Collapse settings panel',
      );
    }
    if (icon) icon.textContent = this._sidebarControlsCollapsed ? '›' : '‹';
    this._scheduleGraphResize();
  }

  _scheduleGraphResize() {
    window.dispatchEvent(new Event('resize'));
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
  }

  // ── Detail Panel ───────────────────────────────────────────────

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

    // Notes
    const notesEl = document.getElementById('detail-notes');
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

  // ── Relationship Suggestions ────────────────────────────────────

  _findRelationshipSuggestions(node) {
    const suggestions = [];
    const seen = new Set();

    // ── Type 1: Mutual — A lists B but B doesn't list A back ──────────
    for (const rel of node.related || []) {
      const targetContact = this.builder.findContact(rel.name);
      if (!targetContact) continue; // virtual node, can't edit
      const targetNode = this._node(targetContact.id);
      if (!targetNode) continue;

      const alreadyListed = (targetNode.related || []).some((r) => {
        const rc = this.builder.findContact(r.name);
        if (rc && rc.id === node.id) return true;
        return r.name.toLowerCase().trim() === node.name.toLowerCase().trim();
      });

      if (!alreadyListed) {
        const reciprocal = this._reciprocalType(rel.type);
        const key = `${targetContact.id}→${node.name}:${reciprocal}`;
        if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
          seen.add(key);
          const typeLabel = this.builder._friendlyType(rel.type);
          suggestions.push({
            key,
            kind: 'mutual',
            targetId: targetContact.id,
            targetName: targetContact.fn,
            relName: node.name,
            relType: reciprocal,
            reason: `${node.name} lists ${targetContact.fn} as their ${typeLabel}, but ${targetContact.fn}'s card doesn't list ${node.name} back.`,
          });
        }
      }
    }

    // ── Type 2: Outward — node's children should appear on spouse's card ─
    const spouseRelsOut = (node.related || []).filter((r) =>
      ['spouse', 'husband', 'wife', 'partner'].includes(r.type),
    );
    for (const spouseRel of spouseRelsOut) {
      const spouseContact = this.builder.findContact(spouseRel.name);
      if (!spouseContact) continue;
      const spouseNode = this._node(spouseContact.id);
      if (!spouseNode) continue;

      const childTypes = [
        'son',
        'daughter',
        'child',
        'stepson',
        'stepdaughter',
        'stepchild',
        'step-child',
      ];
      for (const child of (node.related || []).filter((r) => childTypes.includes(r.type))) {
        const childContact = this.builder.findContact(child.name);
        if (!childContact) continue;

        const spouseHasChild = (spouseNode.related || []).some((r) => {
          const rc = this.builder.findContact(r.name);
          return rc && rc.id === childContact.id;
        });

        if (!spouseHasChild) {
          const key = `${spouseContact.id}→${childContact.fn}:${child.type}`;
          if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
            seen.add(key);
            const bond = spouseRel.type === 'spouse' ? 'married' : 'partners';
            suggestions.push({
              key,
              kind: 'shared-child',
              targetId: spouseContact.id,
              targetName: spouseContact.fn,
              relName: child.name,
              relType: child.type,
              reason: `${node.name} and ${spouseContact.fn} are ${bond}; ${child.name} may be ${spouseContact.fn}'s ${child.type} too.`,
            });
          }
        }
      }
    }

    // ── Type 3: Inward transitive — walk two-hop family chains ───────────
    // Rules: if node has [pivotTypes] rel with P, and P has [bridgeTypes] rel
    // with T (T ≠ node), then suggest adding [inferredType] rel (T) to node's card.
    // inferredType = null means "use the same type as the bridge rel".
    const INWARD_TRANSITIONS = [
      // Via spouse/partner → shared children
      {
        pivotTypes: ['spouse', 'husband', 'wife', 'partner'],
        bridgeTypes: [
          'son',
          'daughter',
          'child',
          'stepson',
          'stepdaughter',
          'stepchild',
          'step-child',
        ],
        inferredType: null,
      },
      // Via parent → siblings (parent's other children); gender-specific when known
      {
        pivotTypes: [
          'parent',
          'mother',
          'father',
          'stepmother',
          'stepfather',
          'stepparent',
          'step-parent',
        ],
        bridgeTypes: [
          'son',
          'daughter',
          'child',
          'stepson',
          'stepdaughter',
          'stepchild',
          'step-child',
        ],
        typeMapper: (bt) =>
          bt === 'son' || bt === 'stepson'
            ? 'brother'
            : bt === 'daughter' || bt === 'stepdaughter'
              ? 'sister'
              : 'sibling',
      },
      // Via parent → grandparents (parent's parents)
      {
        pivotTypes: ['parent', 'mother', 'father'],
        bridgeTypes: ['parent', 'mother', 'father', 'grandmother', 'grandfather', 'grandparent'],
        typeMapper: (bt) =>
          bt === 'mother' || bt === 'grandmother'
            ? 'grandmother'
            : bt === 'father' || bt === 'grandfather'
              ? 'grandfather'
              : 'grandparent',
      },
      // Via parent → uncle/aunt (parent's siblings); gender-specific
      {
        pivotTypes: ['parent', 'mother', 'father'],
        bridgeTypes: ['sibling', 'brother', 'sister'],
        typeMapper: (bt) => (bt === 'brother' ? 'uncle' : bt === 'sister' ? 'aunt' : 'uncle'),
      },
      // Via child → grandchildren (child's children)
      {
        pivotTypes: ['son', 'daughter', 'child'],
        bridgeTypes: ['son', 'daughter', 'child'],
        typeMapper: (bt) =>
          bt === 'son' ? 'grandson' : bt === 'daughter' ? 'granddaughter' : 'grandchild',
      },
      // Via sibling → nephew/niece (sibling's children); gender-specific
      {
        pivotTypes: ['sibling', 'brother', 'sister'],
        bridgeTypes: ['son', 'daughter', 'child'],
        typeMapper: (bt) => (bt === 'son' ? 'nephew' : bt === 'daughter' ? 'niece' : 'nephew'),
      },
      // Via sibling → parent (sibling's parents = node's parents)
      {
        pivotTypes: ['sibling', 'brother', 'sister'],
        bridgeTypes: ['parent', 'mother', 'father', 'grandmother', 'grandfather'],
        typeMapper: (bt) =>
          bt === 'mother' || bt === 'grandmother'
            ? 'mother'
            : bt === 'father' || bt === 'grandfather'
              ? 'father'
              : 'parent',
      },
      // Via uncle/aunt → cousins (uncle/aunt's children)
      {
        pivotTypes: ['uncle', 'aunt', 'uncle/aunt'],
        bridgeTypes: ['son', 'daughter', 'child'],
        inferredType: 'cousin',
      },
      // Via grandparent → uncle/aunt (grandparent's other children); gender-specific
      {
        pivotTypes: ['grandmother', 'grandfather', 'grandparent'],
        bridgeTypes: ['son', 'daughter', 'child'],
        typeMapper: (bt) => (bt === 'son' ? 'uncle' : bt === 'daughter' ? 'aunt' : 'uncle'),
      },
      // Via nephew/niece → sibling (nephew/niece's parent = node's sibling); gender-specific
      {
        pivotTypes: ['nephew', 'niece', 'nephew/niece'],
        bridgeTypes: ['parent', 'mother', 'father'],
        typeMapper: (bt) => (bt === 'mother' ? 'sister' : bt === 'father' ? 'brother' : 'sibling'),
      },
      // Via cousin → uncle/aunt (cousin's parent = node's uncle/aunt); gender-specific
      {
        pivotTypes: ['cousin'],
        bridgeTypes: ['parent', 'mother', 'father'],
        typeMapper: (bt) => (bt === 'mother' ? 'aunt' : bt === 'father' ? 'uncle' : 'uncle'),
      },
      // Via grandchild → child (grandchild's parent = node's child); gender-specific
      {
        pivotTypes: ['grandson', 'granddaughter', 'grandchild'],
        bridgeTypes: ['parent', 'mother', 'father'],
        typeMapper: (bt) => (bt === 'mother' ? 'daughter' : bt === 'father' ? 'son' : 'child'),
      },
      // Via nephew/niece → nephew/niece's siblings are also my nephew/niece; gender-specific
      {
        pivotTypes: ['nephew', 'niece', 'nephew/niece'],
        bridgeTypes: ['sibling', 'brother', 'sister'],
        typeMapper: (bt) => (bt === 'brother' ? 'nephew' : bt === 'sister' ? 'niece' : 'nephew'),
      },
      // Via grandchild → grandchild's siblings are also my grandchild; gender-specific
      {
        pivotTypes: ['grandson', 'granddaughter', 'grandchild'],
        bridgeTypes: ['sibling', 'brother', 'sister'],
        typeMapper: (bt) =>
          bt === 'brother' ? 'grandson' : bt === 'sister' ? 'granddaughter' : 'grandchild',
      },
      // Via cousin → cousin's siblings are also my cousin
      {
        pivotTypes: ['cousin'],
        bridgeTypes: ['sibling', 'brother', 'sister'],
        inferredType: 'cousin',
      },
    ];

    for (const rule of INWARD_TRANSITIONS) {
      const pivotRels = (node.related || []).filter((r) => rule.pivotTypes.includes(r.type));
      for (const pivotRel of pivotRels) {
        const pivotContact = this.builder.findContact(pivotRel.name);
        if (!pivotContact) continue;
        const pivotNode = this._node(pivotContact.id);
        if (!pivotNode) continue;

        const bridgeRels = (pivotNode.related || []).filter((r) =>
          rule.bridgeTypes.includes(r.type),
        );
        for (const bridgeRel of bridgeRels) {
          const thirdContact = this.builder.findContact(bridgeRel.name);
          if (!thirdContact) continue;
          if (thirdContact.id === node.id) continue; // skip self

          const inferredType = rule.typeMapper
            ? rule.typeMapper(bridgeRel.type)
            : rule.inferredType || bridgeRel.type;

          // Skip if node already lists this person in any role
          const alreadyHas = (node.related || []).some((r) => {
            const rc = this.builder.findContact(r.name);
            if (!rc) return false;
            if (rc.id === thirdContact.id) return true;
            // Also match by name string directly in case findContact misses due to format difference
            return r.name.toLowerCase().trim() === thirdContact.fn.toLowerCase().trim();
          });
          if (alreadyHas) continue;

          const key = `${node.id}→${thirdContact.fn}:${inferredType}`;
          if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
            seen.add(key);
            const pivotLabel = this.builder._friendlyType(pivotRel.type).toLowerCase();
            const bridgeLabel = this.builder._friendlyType(bridgeRel.type).toLowerCase();
            const inferredLabel = this.builder._friendlyType(inferredType).toLowerCase();
            suggestions.push({
              key,
              kind: 'transitive',
              targetId: node.id,
              targetName: node.name,
              relName: thirdContact.fn,
              relType: inferredType,
              reason: `Your ${pivotLabel} ${pivotContact.fn} lists ${thirdContact.fn} as their ${bridgeLabel}, making them your likely ${inferredLabel}.`,
            });
          }
        }
      }
    }

    // ── Pre-build inbound reference index (shared by Types 4 and 5) ────────
    // Find every contact that references this node, plus which rel entry points to it.
    // This avoids O(n) re-scans in both Type 4 and Type 5.
    const childRelTypes = new Set([
      'son',
      'daughter',
      'child',
      'stepson',
      'stepdaughter',
      'stepchild',
      'step-child',
    ]);
    const inboundRefs = []; // { contact, rel } for all rels pointing at node
    for (const otherContact of this.contacts) {
      if (otherContact.id === node.id) continue;
      for (const rel of otherContact.related || []) {
        let points = rel.name.toLowerCase().trim() === node.name.toLowerCase().trim();
        if (!points) {
          const rc = this.builder.findContact(rel.name);
          points = !!(rc && rc.id === node.id);
        }
        if (points) inboundRefs.push({ contact: otherContact, rel });
      }
    }

    // ── Type 4: Reverse-parent → siblings ────────────────────────────────
    // Find every contact that lists THIS node as their child, then suggest
    // that contact's other children as this node's siblings.
    // (Works even when the child hasn't listed their parent back.)
    const parentContacts = inboundRefs
      .filter(({ rel }) => childRelTypes.has(rel.type))
      .map(({ contact }) => contact);
    // Deduplicate (a parent might be found via multiple matching rel entries)
    const uniqueParents = [...new Map(parentContacts.map((c) => [c.id, c])).values()];

    for (const otherContact of uniqueParents) {
      // otherContact is a parent — check their other children
      for (const childRel of (otherContact.related || []).filter((r) =>
        childRelTypes.has(r.type),
      )) {
        const sibContact = this.builder.findContact(childRel.name);
        if (!sibContact) continue;
        if (sibContact.id === node.id) continue; // skip self

        const alreadyHas = (node.related || []).some((r) => {
          const rc = this.builder.findContact(r.name);
          if (rc && rc.id === sibContact.id) return true;
          return r.name.toLowerCase().trim() === sibContact.fn.toLowerCase().trim();
        });
        if (alreadyHas) continue;

        const sibType =
          childRel.type === 'son' ? 'brother' : childRel.type === 'daughter' ? 'sister' : 'sibling';
        const key = `${node.id}→${sibContact.fn}:${sibType}`;
        if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
          seen.add(key);
          suggestions.push({
            key,
            kind: 'transitive',
            targetId: node.id,
            targetName: node.name,
            relName: sibContact.fn,
            relType: sibType,
            reason: `${otherContact.fn} lists both you and ${sibContact.fn} as their ${childRel.type}.`,
          });
        }
      }
    }

    // ── Type 5: Inbound reciprocal ────────────────────────────────────────
    // Use the pre-built inbound index to find anyone who lists node as a
    // relative but node doesn't list them back.
    for (const { contact: otherContact, rel } of inboundRefs) {
      // Does node already list otherContact back in any role?
      const alreadyHas = (node.related || []).some((r) => {
        const rc = this.builder.findContact(r.name);
        if (rc && rc.id === otherContact.id) return true;
        return r.name.toLowerCase().trim() === otherContact.fn.toLowerCase().trim();
      });
      if (alreadyHas) continue;

      const recipType = this._reciprocalType(rel.type);
      const key = `${node.id}→${otherContact.fn}:${recipType}:inbound`;
      if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
        seen.add(key);
        suggestions.push({
          key,
          kind: 'mutual',
          targetId: node.id,
          targetName: node.name,
          relName: otherContact.fn,
          relType: recipType,
          reason: `${otherContact.fn} lists you as their ${this.builder._friendlyType(rel.type).toLowerCase()}, but your card doesn't list them back.`,
        });
      }
    }

    // ── Type 6: Likely-connections cluster peers ────────────────────────
    if (
      this._graphMode === 'connections' ||
      this._graphMode === 'likely-connections' ||
      this._graphMode === 'likely-family'
    ) {
      const clustered = new Map();
      for (const e of this.graphData.edges || []) {
        if (!['likely-surname', 'likely-tag', 'likely-family'].includes(e.edgeKind)) continue;
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        const sourceNode = this._node(s);
        const targetNode = this._node(t);

        if (sourceNode?.isGroupNode && t === node.id) {
          for (const memberId of sourceNode.memberIds || []) {
            if (memberId === node.id) continue;
            if (!clustered.has(memberId)) clustered.set(memberId, []);
            clustered.get(memberId).push(sourceNode);
          }
        } else if (targetNode?.isGroupNode && s === node.id) {
          for (const memberId of targetNode.memberIds || []) {
            if (memberId === node.id) continue;
            if (!clustered.has(memberId)) clustered.set(memberId, []);
            clustered.get(memberId).push(targetNode);
          }
        }
      }

      for (const [clusteredId, reasons] of clustered.entries()) {
        const otherNode = this._node(clusteredId);
        if (otherNode?.isGroupNode) continue;
        if (!otherNode) continue;

        const alreadyHas = (node.related || []).some((r) => {
          const rc = this.builder.findContact(r.name);
          if (rc && rc.id === clusteredId) return true;
          return r.name.toLowerCase().trim() === otherNode.name.toLowerCase().trim();
        });
        if (alreadyHas) continue;

        const reasonText = reasons.map((group) => {
          if (group.groupKind === 'likely-tag') return `shared hashtag ${group.name}`;
          if (group.groupKind === 'likely-surname')
            return `shared surname "${group.name.replace(/ family$/i, '')}"`;
          return group.name;
        });
        const uniqueReasons = Array.from(new Set(reasonText));
        const key = `${node.id}→${otherNode.name}:relative:likely-connections:${uniqueReasons.join('|')}`;
        if (!seen.has(key) && !this._dismissedSuggestions.has(key)) {
          seen.add(key);
          suggestions.push({
            key,
            kind: 'likely-connections',
            targetId: node.id,
            targetName: node.name,
            relName: otherNode.name,
            relType: 'relative',
            reason: `${otherNode.name} is grouped with ${node.name} in Connections because of ${uniqueReasons.join(' and ')}.`,
          });
        }
      }
    }

    return suggestions;
  }

  _renderSuggestions(node) {
    const section = document.getElementById('suggestions-section');
    const el = document.getElementById('detail-suggestions');
    el.innerHTML = '';

    const suggestions = this._findRelationshipSuggestions(node);
    if (suggestions.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    document.getElementById('suggestions-badge').textContent = suggestions.length;

    for (const s of suggestions) {
      const item = document.createElement('div');
      item.className = 'suggestion-item';

      item.innerHTML = `
        <div class="suggestion-body">
          <div class="suggestion-action">
            Add <strong>${this._escapeHtml(s.relName)}</strong>
            as <select class="suggestion-type-select">${this._relTypeOptionsHtml(s.relType)}</select>
            to <strong>${this._escapeHtml(s.targetName)}</strong>'s card
          </div>
          <div class="suggestion-reason">${this._escapeHtml(s.reason)}</div>
        </div>
        <div class="suggestion-btns">
          <button class="btn btn-primary btn-xs s-add">Add</button>
          <button class="btn btn-ghost btn-xs s-dismiss">✕</button>
        </div>
      `;

      const typeSelect = item.querySelector('.suggestion-type-select');
      const isCustomSelected = !this._isKnownRelationshipType(s.relType);

      // Freeform input for suggestions (shown when "Custom…" is chosen)
      const suggCustomInput = document.createElement('input');
      suggCustomInput.type = 'text';
      suggCustomInput.className = 'rel-custom-input';
      suggCustomInput.placeholder = 'e.g. mentor…';
      suggCustomInput.style.display = isCustomSelected ? 'inline-block' : 'none';
      if (isCustomSelected) suggCustomInput.value = s.relType || '';
      typeSelect.insertAdjacentElement('afterend', suggCustomInput);

      typeSelect.addEventListener('change', () => {
        const isCustom = typeSelect.value === '__custom__';
        suggCustomInput.style.display = isCustom ? 'inline-block' : 'none';
        if (isCustom) {
          suggCustomInput.value = '';
          suggCustomInput.focus();
        }
      });

      item.querySelector('.s-add').addEventListener('click', () => {
        let relType =
          typeSelect.value === '__custom__'
            ? suggCustomInput.value.trim().toLowerCase()
            : typeSelect.value || s.relType;
        if (!relType || relType === '__custom__') return;
        s.relType = relType;
        this._applyRelationshipSuggestion(s, node);
      });
      item.querySelector('.s-dismiss').addEventListener('click', () => {
        this._dismissedSuggestions.add(s.key);
        item.remove();
        const remaining = el.querySelectorAll('.suggestion-item').length;
        if (remaining === 0) section.classList.add('hidden');
        else document.getElementById('suggestions-badge').textContent = remaining;
      });

      el.appendChild(item);
    }
  }

  _applyRelationshipSuggestion(suggestion, currentNode) {
    const contact = this._contact(suggestion.targetId);
    if (!contact || !contact.rawVCard) {
      this._showToast(`Cannot modify ${suggestion.targetName}: no raw VCard data`, 'error');
      return;
    }

    // Find highest item number already in use
    const usedItems = [...contact.rawVCard.matchAll(/^item(\d+)\./gim)].map((m) => parseInt(m[1]));
    const nextItem = usedItems.length > 0 ? Math.max(...usedItems) + 1 : 1;

    const label = this._typeToVCardLabel(suggestion.relType);
    const newLines = this._joinVCardLines([
      `item${nextItem}.X-ABRELATEDNAMES:${this._vCardEscape(suggestion.relName)}`,
      `item${nextItem}.X-ABLabel:${label}`,
    ]);
    contact.rawVCard = this._insertBeforeEndVCard(contact.rawVCard, newLines);

    // Update parsed data
    contact.related.push({ name: suggestion.relName, type: suggestion.relType, rawType: label });

    // Mark dismissed so it won't reappear
    this._dismissedSuggestions.add(suggestion.key);

    // Rebuild graph
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();

    // Re-render the detail panel for the current node
    const refreshedNode = this._node(currentNode.id);
    if (refreshedNode) this._onNodeSelect(refreshedNode);

    this._showToast(
      `Added ${this.builder._friendlyType(suggestion.relType)} to ${suggestion.targetName}'s card`,
      'success',
    );
  }

  _reciprocalType(type) {
    return RelationshipTaxonomy.reciprocal(type);
  }

  /**
   * Returns true when `candidate` is less specific than `existing`.
   * Prevents overwriting a precise reciprocal (e.g. "son") with a generic one
   * (e.g. "child") when the user makes the *other* side more specific
   * (e.g. "parent" → "mother" computes reciprocal "child", but "son" already exists).
   */
  _isReciprocalDowngrade(candidate, existing) {
    return RelationshipTaxonomy.isReciprocalDowngrade(candidate, existing);
  }

  _typeToVCardLabel(type) {
    return RelationshipTaxonomy.vcardLabel(type);
  }

  _isKnownRelationshipType(type) {
    return RelationshipTaxonomy.isKnown(type);
  }

  _getOrgForNode(node) {
    const contact = this._contact(node.id);
    return contact?.org || node.org || '';
  }

  /**
   * Escape a plain-text string for embedding as a vCard property value (RFC 6350 §4).
   * Parsing already un-escapes these sequences; writes must re-escape them so that
   * names containing commas, semicolons, or backslashes round-trip correctly.
   */
  _vCardEscape(str) {
    return VCardUtils.encodeValue(str);
  }

  _decodeVCardValue(str) {
    return VCardUtils.decodeValue(str);
  }

  _joinVCardLines(lines) {
    return VCardUtils.foldLines(lines);
  }

  _insertBeforeEndVCard(rawVCard, foldedLines) {
    const block = String(foldedLines || '').replace(/\r\n$/, '');
    return String(rawVCard || '').replace(/END:VCARD/i, `${block}\r\nEND:VCARD`);
  }

  _findRelatedItemPrefix(rawVCard, relName) {
    if (!rawVCard || !relName) return null;

    for (const line of VCardUtils.unfold(rawVCard).split(/\r\n|\n/)) {
      const m = line.match(/^(item\d+)\.X-ABRELATEDNAMES(?:;[^:]*)?:(.*)$/i);
      if (!m) continue;
      const [, prefix, rawValue] = m;
      if (this._decodeVCardValue(rawValue).trim() === relName.trim()) {
        return prefix;
      }
    }

    return null;
  }

  _findRelatedItemPrefixByIndex(rawVCard, relIdx) {
    if (!rawVCard || relIdx == null) return null;
    let currentIdx = -1;
    for (const line of VCardUtils.unfold(rawVCard).split(/\r\n|\n/)) {
      const m = line.match(/^(item\d+)\.X-ABRELATEDNAMES(?:;[^:]*)?:/i);
      if (!m) continue;
      currentIdx += 1;
      if (currentIdx === relIdx) return m[1];
    }
    return null;
  }

  _escapeRegExp(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _removeItemGroup(rawVCard, prefix) {
    if (!rawVCard || !prefix) return rawVCard;
    const prefixRe = new RegExp(`^${this._escapeRegExp(prefix)}\\..*$`, 'i');
    return VCardUtils.unfold(rawVCard)
      .split(/\r\n|\n/)
      .filter((line) => !prefixRe.test(line))
      .join('\r\n');
  }

  _renderAddRelationshipAction() {
    const actions = document.createElement('div');
    actions.className = 'detail-section-actions';
    const button = document.createElement('button');
    button.className = 'btn btn-ghost';
    button.type = 'button';
    button.textContent = '+ Add Relationship';
    button.addEventListener('click', () => this._showAddRelationshipModal());
    actions.appendChild(button);
    return actions;
  }

  _replaceItemProperty(rawVCard, prefix, propName, newValue) {
    if (!rawVCard || !prefix || !propName) return rawVCard;
    const prefixEsc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const propEsc = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${prefixEsc}\\.${propEsc}(?:;[^:]*)?:.*$`, 'im');
    return VCardUtils.unfold(rawVCard).replace(
      pattern,
      this._joinVCardLines([`${prefix}.${propName}:${newValue}`]),
    );
  }

  _syncDetailEditButtons(node, hasContact, isEditing) {
    const isVirtual = !!node?.isVirtual;
    const isGroup = !!node?.isGroupNode;
    document
      .getElementById('btn-create-contact')
      .classList.toggle('hidden', !isVirtual || isEditing);
    document
      .getElementById('btn-edit-contact')
      .classList.toggle('hidden', !hasContact || isEditing || isVirtual || isGroup);
    document.getElementById('btn-save-contact').classList.toggle('hidden', !isEditing);
    document.getElementById('btn-cancel-edit').classList.toggle('hidden', !isEditing);
    document
      .getElementById('btn-delete-contact')
      .classList.toggle('hidden', isEditing || !hasContact || isVirtual || isGroup);
    document
      .getElementById('btn-add-rel')
      .classList.toggle('hidden', isEditing || !hasContact || isVirtual || isGroup);
    document
      .getElementById('btn-export-contact')
      .classList.toggle('hidden', isEditing || !hasContact || isVirtual || isGroup);
  }

  _createContactFromVirtual() {
    if (!this._selectedNodeId) return;
    const node = this._node(this._selectedNodeId);
    if (!node || !node.isVirtual) return;

    const existing = this._contactsByFn.get((node.name || '').toLowerCase().trim());
    if (existing) {
      this._showToast('A real contact with that name already exists', 'error');
      return;
    }

    const structuredName = this._namePartsFromDisplayName(node.name || 'New Contact');
    const contact = {
      id: this.parser._generateId(),
      uid: null,
      fn: node.name || 'New Contact',
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

    this.contacts.push(contact);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();

    const createdNode = this._node(contact.id);
    if (createdNode) {
      this._selectedNodeId = createdNode.id;
      this._editingContactId = createdNode.id;
      this.graph.highlightContact(createdNode.id);
      this._onNodeSelect(createdNode);
    }

    this._showToast(`Created real contact for ${contact.fn}`, 'success');
  }

  _renderReadOnlyContactInfo(contactInfo, node) {
    contactInfo.innerHTML = '';

    contactInfo.appendChild(this._detailRow('👤', this._escapeHtml(node.name), 'Full Name'));
    if (node.org)
      contactInfo.appendChild(this._detailRow('🏢', this._escapeHtml(node.org), 'Organization'));
    if (node.title)
      contactInfo.appendChild(this._detailRow('💼', this._escapeHtml(node.title), 'Title'));

    for (const email of node.emails || []) {
      const emailValue = String(email.value || '').replace(/[\r\n]/g, '');
      const row = this._detailRow(
        '✉',
        `<a href="mailto:${this._escapeHtml(emailValue)}">${this._escapeHtml(emailValue)}</a>`,
        email.types.filter((t) => !['INTERNET', 'PREF'].includes(t)).join(', ') || 'Email',
      );
      contactInfo.appendChild(row);
    }

    for (const phone of node.phones || []) {
      const row = this._detailRow(
        '📞',
        this._escapeHtml(phone.value),
        phone.types.filter((t) => !['VOICE', 'PREF'].includes(t)).join(', ') || 'Phone',
      );
      contactInfo.appendChild(row);
    }

    for (const address of node.addresses || []) {
      const lines = [
        address.street,
        [address.city, address.state, address.zip].filter(Boolean).join(', '),
        address.country,
      ].filter(Boolean);
      const html = `<div class="address-lines">${lines.map((line) => `<div>${this._escapeHtml(line)}</div>`).join('')}</div>`;
      contactInfo.appendChild(
        this._detailRow(
          '📍',
          html,
          this._visibleTypes('address', address.types || []).join(', ') || 'Address',
        ),
      );
    }

    for (const urlEntry of node.urls || []) {
      const urlValue = typeof urlEntry === 'string' ? urlEntry : urlEntry.value;
      if (!urlValue) continue;
      const safeUrl = this._escapeHtml(urlValue);
      const safeHref = this._safeExternalHref(urlValue);
      const types =
        typeof urlEntry === 'string' ? [] : this._visibleTypes('url', urlEntry.types || []);
      contactInfo.appendChild(
        this._detailRow(
          '🔗',
          safeHref
            ? `<a href="${this._escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`
            : safeUrl,
          types.join(', ') || 'Website',
        ),
      );
    }

    if (node.birthday)
      contactInfo.appendChild(
        this._detailRow('🎂', this._formatBirthday(node.birthday), 'Birthday'),
      );
    if (node.anniversary)
      contactInfo.appendChild(
        this._detailRow('💍', this._formatDateWithYears(node.anniversary), 'Anniversary'),
      );
    this._renderReadOnlyCustomFields(contactInfo, node);
  }

  _detailField(label, value) {
    return this._detailRow('•', this._escapeHtml(value), label);
  }

  _renderReadOnlyCustomFields(container, contact) {
    const entries = this._customFieldEntries(contact);
    if (entries.length === 0) return;

    for (const [key, rawField] of entries) {
      const field = this._normalizeCustomField(rawField);
      container.appendChild(
        this._detailRow(
          '◆',
          this._escapeHtml(this._customFieldDisplayValue(field)),
          `Custom: ${this._customFieldLabel(key)}`,
        ),
      );
    }
  }

  _renderEditableContactInfo(contactInfo, notesEl, contact) {
    contactInfo.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'detail-edit-grid';
    grid.appendChild(this._editPhotoField(contact));
    grid.appendChild(this._editField('Display Name', 'edit-fn', contact.fn || ''));
    grid.appendChild(this._editField('First Name', 'edit-name-given', contact.name?.given || ''));
    grid.appendChild(
      this._editField('Middle Name', 'edit-name-additional', contact.name?.additional || ''),
    );
    grid.appendChild(this._editField('Last Name', 'edit-name-family', contact.name?.family || ''));
    grid.appendChild(this._editField('Prefix', 'edit-name-prefix', contact.name?.prefix || ''));
    grid.appendChild(this._editField('Suffix', 'edit-name-suffix', contact.name?.suffix || ''));
    grid.appendChild(
      this._editCheckboxField(
        'Treat as Company',
        'edit-is-company',
        !!contact.isCompany,
        'Export as X-ABSHOWAS: COMPANY',
      ),
    );
    grid.appendChild(this._editField('Organization', 'edit-org', contact.org || ''));
    grid.appendChild(this._editField('Title', 'edit-title', contact.title || ''));
    grid.appendChild(this._editField('Birthday', 'edit-bday', contact.birthday || '', 'date'));
    grid.appendChild(
      this._editField('Anniversary', 'edit-anniversary', contact.anniversary || '', 'date'),
    );
    grid.appendChild(
      this._editCollectionField('Emails', 'email', contact.emails || [], (entry) => entry.value),
    );
    grid.appendChild(
      this._editCollectionField('Phones', 'phone', contact.phones || [], (entry) => entry.value),
    );
    grid.appendChild(this._editAddressField(contact.addresses || []));
    grid.appendChild(
      this._editCollectionField('Websites', 'url', contact.urls || [], (entry) =>
        typeof entry === 'string' ? entry : entry.value,
      ),
    );
    grid.appendChild(this._editCustomFields(contact.customFields || contact.record?.fields || {}));

    contactInfo.appendChild(grid);
    notesEl.parentElement.classList.remove('hidden');
  }

  _editPhotoField(contact) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row';
    wrap.innerHTML = `<div class="detail-edit-label">Photo</div>`;

    const block = document.createElement('div');
    block.className = 'photo-edit-block';

    const preview = document.createElement('div');
    preview.className = 'photo-edit-preview';
    preview.id = 'edit-photo-preview';

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'edit-photo-data';
    hidden.value = contact.photo || '';

    const remove = document.createElement('input');
    remove.type = 'hidden';
    remove.id = 'edit-photo-remove';
    remove.value = '0';

    const applyPreview = (dataUrl) => {
      if (dataUrl) preview.style.backgroundImage = `url(${dataUrl})`;
      else preview.style.backgroundImage = 'none';
    };
    applyPreview(contact.photo || '');

    const actions = document.createElement('div');
    actions.className = 'photo-edit-actions';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'hidden';
    fileInput.id = 'edit-photo-file';

    const chooseBtn = document.createElement('button');
    chooseBtn.className = 'btn btn-ghost btn-xs';
    chooseBtn.type = 'button';
    chooseBtn.textContent = contact.photo ? 'Change Photo' : 'Add Photo';
    chooseBtn.addEventListener('click', () => fileInput.click());

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-ghost btn-xs';
    clearBtn.type = 'button';
    clearBtn.textContent = 'Remove Photo';
    clearBtn.disabled = !contact.photo;
    clearBtn.addEventListener('click', () => {
      hidden.value = '';
      remove.value = '1';
      applyPreview('');
      clearBtn.disabled = true;
      chooseBtn.textContent = 'Add Photo';
      const detailPhoto = document.getElementById('detail-photo');
      if (detailPhoto) {
        detailPhoto.style.backgroundImage = 'none';
        detailPhoto.textContent = this._initials(contact.fn || '');
      }
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl) return;
        hidden.value = dataUrl;
        remove.value = '0';
        applyPreview(dataUrl);
        clearBtn.disabled = false;
        chooseBtn.textContent = 'Change Photo';
        const detailPhoto = document.getElementById('detail-photo');
        if (detailPhoto) {
          detailPhoto.style.backgroundImage = `url(${dataUrl})`;
          detailPhoto.textContent = '';
        }
      };
      reader.readAsDataURL(file);
    });

    actions.appendChild(chooseBtn);
    actions.appendChild(clearBtn);
    actions.appendChild(fileInput);
    actions.appendChild(hidden);
    actions.appendChild(remove);

    block.appendChild(preview);
    block.appendChild(actions);
    wrap.appendChild(block);
    return wrap;
  }

  _editField(label, id, value, type = 'text') {
    const row = document.createElement('div');
    row.className = 'detail-edit-row';
    row.innerHTML = `
      <label class="detail-edit-label" for="${id}">${label}</label>
      <input class="form-control" type="${type}" id="${id}">
    `;
    row.querySelector('input').value = value || '';
    return row;
  }

  _editCheckboxField(label, id, checked, helpText = '') {
    const row = document.createElement('div');
    row.className = 'detail-edit-row';

    const labelEl = document.createElement('label');
    labelEl.className = 'detail-edit-checkbox';
    labelEl.setAttribute('for', id);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;

    const text = document.createElement('div');
    text.innerHTML = `
      <div class="detail-edit-checkbox-title">${this._escapeHtml(label)}</div>
      ${helpText ? `<div class="detail-edit-help">${this._escapeHtml(helpText)}</div>` : ''}
    `;

    labelEl.appendChild(input);
    labelEl.appendChild(text);
    row.appendChild(labelEl);
    return row;
  }

  _editCollectionField(label, kind, entries, getValue) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row';
    wrap.innerHTML = `<div class="detail-edit-label">${label}</div>`;

    const multi = document.createElement('div');
    multi.className = 'detail-edit-multi';
    wrap.appendChild(multi);

    const addItem = (entry = null) => {
      const item = document.createElement('div');
      item.className = 'detail-edit-item';
      item.dataset.kind = kind;

      const input = document.createElement('input');
      input.className = 'form-control';
      input.dataset.role = 'value';
      input.value = entry ? getValue(entry) : '';
      input.placeholder = label.slice(0, -1);

      const typeState = this._typeSelectionState(kind, entry?.types || []);
      const typeSelect = this._typeSelect(kind, typeState.selected);
      const typeInput = this._customTypeInput(
        kind,
        'types-custom',
        typeState.customValue,
        typeState.selected === 'custom',
      );
      this._bindTypeEditor(typeSelect, typeInput);
      const preferred = this._preferredRadio(kind, this._isPreferred(entry?.types || []));

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => item.remove());

      const valueRow = document.createElement('div');
      valueRow.className = 'detail-edit-stack';
      valueRow.appendChild(input);

      const metaRow = document.createElement('div');
      metaRow.className = 'detail-edit-inline detail-edit-meta';

      const footerRow = document.createElement('div');
      footerRow.className = 'detail-edit-inline detail-edit-footer';

      const help = document.createElement('div');
      help.className = 'detail-edit-help';
      help.textContent = 'Choose a type. Select Custom to enter your own.';

      metaRow.appendChild(typeSelect);
      metaRow.appendChild(typeInput);
      footerRow.appendChild(preferred);
      footerRow.appendChild(removeBtn);
      item.appendChild(valueRow);
      item.appendChild(metaRow);
      item.appendChild(help);
      item.appendChild(footerRow);
      multi.appendChild(item);
    };

    if (entries.length > 0) entries.forEach(addItem);
    else addItem();

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs';
    addBtn.type = 'button';
    addBtn.textContent = `+ Add ${label.slice(0, -1)}`;
    addBtn.addEventListener('click', () => addItem());
    wrap.appendChild(addBtn);

    return wrap;
  }

  _editCustomFields(fields) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row detail-edit-custom-fields';
    const label = document.createElement('div');
    label.className = 'detail-edit-label';
    label.textContent = 'Custom Fields';
    wrap.appendChild(label);

    const entries = Object.entries(fields || {});
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'detail-edit-help';
      empty.textContent = 'No custom fields on this contact.';
      wrap.appendChild(empty);
      return wrap;
    }

    const multi = document.createElement('div');
    multi.className = 'detail-edit-multi';
    for (const [key, rawField] of entries) {
      const field = this._normalizeCustomField(rawField);
      const item = document.createElement('div');
      item.className = 'detail-edit-item custom-field-item';
      item.dataset.kind = 'custom-field';
      item.dataset.fieldKey = key;
      item.dataset.fieldType = field.type || 'unknown';

      const title = document.createElement('div');
      title.className = 'detail-edit-checkbox-title';
      title.textContent = this._customFieldLabel(key);

      const help = document.createElement('div');
      help.className = 'detail-edit-help';
      help.textContent = `Type: ${field.type || 'unknown'}`;

      item.appendChild(title);
      item.appendChild(this._customFieldEditor(field));
      item.appendChild(help);
      multi.appendChild(item);
    }
    wrap.appendChild(multi);
    return wrap;
  }

  _customFieldEditor(field) {
    if (field.type === 'list' && Array.isArray(field.value)) {
      return this._customListFieldEditor(field.value);
    }
    if (this._isEditableCustomScalar(field)) {
      return this._customScalarFieldEditor(field);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'form-control';
    textarea.value = this._customFieldDisplayValue(field);
    textarea.disabled = true;
    return textarea;
  }

  _customScalarFieldEditor(field) {
    const input = document.createElement('input');
    input.className = 'form-control';
    input.dataset.role = 'custom-value';
    if (field.type === 'boolean') {
      input.type = 'checkbox';
      input.checked = field.value === true;
      return input;
    }
    input.type =
      field.type === 'number'
        ? 'number'
        : field.type === 'date'
          ? 'date'
          : field.type === 'color'
            ? 'color'
            : 'text';
    input.value = field.value == null ? '' : String(field.value);
    return input;
  }

  _customListFieldEditor(values) {
    const block = document.createElement('div');
    block.className = 'detail-edit-stack';
    const list = document.createElement('div');
    list.className = 'detail-edit-multi';
    const addItem = (value = '') => {
      const row = document.createElement('div');
      row.className = 'detail-edit-inline';
      const input = document.createElement('input');
      input.className = 'form-control';
      input.dataset.role = 'custom-list-value';
      input.value = value == null ? '' : String(value);
      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost btn-xs';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => row.remove());
      row.append(input, remove);
      list.appendChild(row);
    };
    if (values.length) values.forEach(addItem);
    else addItem();
    const add = document.createElement('button');
    add.className = 'btn btn-ghost btn-xs';
    add.type = 'button';
    add.textContent = '+ Add Value';
    add.addEventListener('click', () => addItem());
    block.append(list, add);
    return block;
  }

  _editAddressField(addresses) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row';
    wrap.innerHTML = `<div class="detail-edit-label">Addresses</div>`;

    const multi = document.createElement('div');
    multi.className = 'detail-edit-multi';
    wrap.appendChild(multi);

    const addItem = (address = null) => {
      const item = document.createElement('div');
      item.className = 'detail-edit-item';
      item.dataset.kind = 'address';
      const grid = document.createElement('div');
      grid.className = 'detail-edit-grid';

      const street = this._addressInput('Street', 'street', address?.street || '');
      const city = this._addressInput('City', 'city', address?.city || '');
      const state = this._addressInput('State', 'state', address?.state || '');
      const zip = this._addressInput('ZIP', 'zip', address?.zip || '');
      const country = this._addressInput('Country', 'country', address?.country || '');
      const typeState = this._typeSelectionState('address', address?.types || []);
      const typeSelect = this._typeSelect('address', typeState.selected, 'addr-type-select');
      const typeInput = this._customTypeInput(
        'address',
        'types',
        typeState.customValue,
        typeState.selected === 'custom',
      );
      this._bindTypeEditor(typeSelect, typeInput);

      const metaRow = document.createElement('div');
      metaRow.className = 'detail-edit-inline detail-edit-meta detail-edit-grid-span';
      const footerRow = document.createElement('div');
      footerRow.className = 'detail-edit-inline detail-edit-footer detail-edit-grid-span';
      const preferred = this._preferredRadio('address', this._isPreferred(address?.types || []));
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove Address';
      removeBtn.addEventListener('click', () => item.remove());

      metaRow.appendChild(typeSelect);
      metaRow.appendChild(typeInput);
      footerRow.appendChild(preferred);
      footerRow.appendChild(removeBtn);

      grid.appendChild(street);
      grid.appendChild(city);
      grid.appendChild(state);
      grid.appendChild(zip);
      grid.appendChild(country);
      grid.appendChild(metaRow);
      item.appendChild(grid);

      const help = document.createElement('div');
      help.className = 'detail-edit-help';
      help.textContent = 'Choose a type. Select Custom to enter your own.';
      item.appendChild(help);
      item.appendChild(footerRow);
      multi.appendChild(item);
    };

    if (addresses.length > 0) addresses.forEach(addItem);
    else addItem();

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Address';
    addBtn.addEventListener('click', () => addItem());
    wrap.appendChild(addBtn);

    return wrap;
  }

  _saveDetailEdits() {
    if (!this._editingContactId) return;
    const contact = this._contact(this._editingContactId);
    if (!contact) return;

    this._commitOpenRelationshipEditors(contact);

    contact.name = {
      given: document.getElementById('edit-name-given')?.value.trim() || '',
      additional: document.getElementById('edit-name-additional')?.value.trim() || '',
      family: document.getElementById('edit-name-family')?.value.trim() || '',
      prefix: document.getElementById('edit-name-prefix')?.value.trim() || '',
      suffix: document.getElementById('edit-name-suffix')?.value.trim() || '',
    };
    const explicitDisplayName = document.getElementById('edit-fn')?.value.trim() || '';
    contact.fn = explicitDisplayName || this._composeDisplayName(contact.name) || contact.fn;
    contact.isCompany = !!document.getElementById('edit-is-company')?.checked;
    contact.org = document.getElementById('edit-org')?.value.trim() || '';
    contact.title = document.getElementById('edit-title')?.value.trim() || '';
    contact.birthday = document.getElementById('edit-bday')?.value || null;
    contact.anniversary = document.getElementById('edit-anniversary')?.value || null;
    if (document.getElementById('edit-photo-remove')?.value === '1') {
      contact.photo = null;
    } else {
      contact.photo = document.getElementById('edit-photo-data')?.value || null;
    }
    contact.notes = this._splitNotes(document.getElementById('edit-notes')?.value || '');
    contact.emails = this._collectEditedCollection('email').map((entry) => ({
      value: entry.value,
      types: entry.types,
    }));
    contact.phones = this._collectEditedCollection('phone').map((entry) => ({
      value: entry.value,
      types: entry.types,
    }));
    contact.urls = this._collectEditedCollection('url').map((entry) => ({
      value: entry.value,
      types: entry.types,
    }));
    contact.addresses = this._collectEditedAddresses();
    contact.customFields = this._collectEditedCustomFields(
      contact.customFields || contact.record?.fields || {},
    );
    contact.noteTags = this.parser._extractHashtags(contact.notes);
    contact.tags = this.parser._inferTags(contact);
    this._rewriteEditableFields(contact);

    this.builder = new RelationshipBuilder(this.contacts);
    this._editingContactId = null;
    this._rebuildGraph();
    void this._persistSession();

    const refreshed = this._node(contact.id);
    if (refreshed) this._onNodeSelect(refreshed);
    this._showToast('Contact details updated', 'success');
  }

  _collectEditedCollection(kind) {
    const entries = [...document.querySelectorAll(`.detail-edit-item[data-kind="${kind}"]`)]
      .map((item) => {
        const valueInput = item.querySelector('input[data-role="value"]');
        const typesInput = item.querySelector('input[data-role="types-custom"]');
        return {
          value: valueInput?.value.trim() || '',
          types: this._normalizeStoredTypes(
            kind,
            this._selectedTypesFromEditor(
              kind,
              item.querySelector('select[data-role="types-select"]')?.value ||
                this._defaultTypeOption(kind),
              typesInput?.value || '',
            ),
            !!item.querySelector('input[data-role="preferred"]')?.checked,
          ),
        };
      })
      .filter((entry) => entry.value);
    return this._ensureSinglePreferred(entries, kind);
  }

  _collectEditedAddresses() {
    const entries = [...document.querySelectorAll('.detail-edit-item[data-kind="address"]')]
      .map((item) => {
        const street = item.querySelector('[data-addr="street"]');
        if (!street) return null;
        return {
          pobox: '',
          ext: '',
          street: street.value.trim(),
          city: item.querySelector('[data-addr="city"]').value.trim(),
          state: item.querySelector('[data-addr="state"]').value.trim(),
          zip: item.querySelector('[data-addr="zip"]').value.trim(),
          country: item.querySelector('[data-addr="country"]').value.trim(),
          types: this._normalizeStoredTypes(
            'address',
            this._selectedTypesFromEditor(
              'address',
              item.querySelector('select[data-addr="type-select"]')?.value ||
                this._defaultTypeOption('address'),
              item.querySelector('[data-addr="types"]')?.value || '',
            ),
            !!item.querySelector('input[data-role="preferred"]')?.checked,
          ),
        };
      })
      .filter(
        (addr) => addr && (addr.street || addr.city || addr.state || addr.zip || addr.country),
      );
    return this._ensureSinglePreferred(entries, 'address');
  }

  _collectEditedCustomFields(existingFields = {}) {
    const fields = JSON.parse(JSON.stringify(existingFields || {}));
    for (const item of [
      ...document.querySelectorAll('.detail-edit-item[data-kind="custom-field"]'),
    ]) {
      const key = item.dataset.fieldKey;
      if (!key || !fields[key]) continue;
      const field = this._normalizeCustomField(fields[key]);
      if (field.type === 'list' && Array.isArray(field.value)) {
        fields[key] = {
          ...field,
          value: [...item.querySelectorAll('input[data-role="custom-list-value"]')]
            .map((input) => input.value.trim())
            .filter(Boolean),
        };
      } else if (this._isEditableCustomScalar(field)) {
        const input = item.querySelector('input[data-role="custom-value"]');
        if (!input) continue;
        fields[key] = {
          ...field,
          value: this._coerceCustomScalarValue(input, field.type),
        };
      }
    }
    return fields;
  }

  _splitNotes(text) {
    return text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  _buildTypeParams(types = []) {
    return VCardUtils.buildTypeParams(types);
  }

  _photoLines(dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:')) return [];
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return [];

    const mime = m[1].toLowerCase();
    const base64 = m[2].replace(/\s+/g, '');
    const type = mime === 'image/png' ? 'PNG' : mime === 'image/gif' ? 'GIF' : 'JPEG';
    const firstChunk = base64.slice(0, 72);
    const rest = base64.slice(72);
    const lines = [`PHOTO;ENCODING=b;TYPE=${type}:${firstChunk}`];
    for (let i = 0; i < rest.length; i += 72) {
      lines.push(` ${rest.slice(i, i + 72)}`);
    }
    return lines;
  }

  _rewriteEditableFields(contact) {
    if (!contact.rawVCard) return;

    const lines = VCardUtils.unfold(contact.rawVCard).split(/\r\n|\n/);
    const keptSimple = [];
    const itemGroups = new Map();
    let begin = 'BEGIN:VCARD';
    let end = 'END:VCARD';
    let version = null;
    let nextItem = 1;

    for (const line of lines) {
      if (!line) continue;
      if (/^BEGIN:VCARD/i.test(line)) {
        begin = line;
        continue;
      }
      if (/^END:VCARD/i.test(line)) {
        end = line;
        continue;
      }
      if (/^VERSION:/i.test(line)) {
        version = line;
        continue;
      }

      const itemMatch = line.match(/^(item\d+)\./i);
      if (itemMatch) {
        const key = itemMatch[1];
        nextItem = Math.max(nextItem, parseInt(key.replace(/^item/i, ''), 10) + 1);
        if (!itemGroups.has(key)) itemGroups.set(key, []);
        itemGroups.get(key).push(line);
        continue;
      }

      const prop = line.split(':', 1)[0].split(';', 1)[0].toUpperCase();
      if (
        [
          'FN',
          'N',
          'ORG',
          'TITLE',
          'EMAIL',
          'TEL',
          'ADR',
          'BDAY',
          'NOTE',
          'URL',
          'PHOTO',
          'X-ABSHOWAS',
        ].includes(prop)
      )
        continue;
      keptSimple.push(line);
    }

    const keptItemLines = [];
    for (const groupLines of itemGroups.values()) {
      const props = new Set(
        groupLines.map((line) => {
          const lhs = line.split(':', 1)[0];
          const m = lhs.match(/^item\d+\.(.+)$/i);
          return m ? m[1].split(';', 1)[0].toUpperCase() : '';
        }),
      );
      const editableContactGroup =
        props.has('EMAIL') || props.has('TEL') || props.has('ADR') || props.has('URL');
      const anniversaryGroup = props.has('X-ABDATE') && this._isAnniversaryItemGroup(groupLines);
      if ((!editableContactGroup && !anniversaryGroup) || props.has('X-ABRELATEDNAMES')) {
        keptItemLines.push(...groupLines);
      }
    }

    const generated = [];
    const name = contact.name || this._namePartsFromDisplayName(contact.fn || '');
    generated.push(`FN:${this._vCardEscape(contact.fn || '')}`);
    generated.push(
      `N:${this._vCardEscape(name.family || '')};${this._vCardEscape(name.given || '')};${this._vCardEscape(name.additional || '')};${this._vCardEscape(name.prefix || '')};${this._vCardEscape(name.suffix || '')}`,
    );
    if (contact.isCompany) generated.push('X-ABSHOWAS:COMPANY');
    if (contact.org) generated.push(`ORG:${this._vCardEscape(contact.org)}`);
    if (contact.title) generated.push(`TITLE:${this._vCardEscape(contact.title)}`);
    generated.push(...this._photoLines(contact.photo));
    for (const email of contact.emails || []) {
      generated.push(
        `EMAIL${this._buildTypeParams(email.types)}:${this._vCardEscape(email.value)}`,
      );
    }
    for (const phone of contact.phones || []) {
      generated.push(`TEL${this._buildTypeParams(phone.types)}:${this._vCardEscape(phone.value)}`);
    }
    for (const address of contact.addresses || []) {
      const params = this._buildTypeParams(address.types);
      generated.push(
        `ADR${params}:;;${this._vCardEscape(address.street || '')};${this._vCardEscape(address.city || '')};${this._vCardEscape(address.state || '')};${this._vCardEscape(address.zip || '')};${this._vCardEscape(address.country || '')}`,
      );
    }
    for (const urlEntry of contact.urls || []) {
      const urlValue = typeof urlEntry === 'string' ? urlEntry : urlEntry.value;
      const urlTypes = typeof urlEntry === 'string' ? [] : urlEntry.types || [];
      if (!urlValue) continue;
      generated.push(`URL${this._buildTypeParams(urlTypes)}:${this._vCardEscape(urlValue)}`);
    }
    if (contact.birthday) generated.push(`BDAY:${contact.birthday}`);
    for (const note of contact.notes || []) {
      generated.push(`NOTE:${this._vCardEscape(note)}`);
    }
    if (contact.anniversary) {
      generated.push(`item${nextItem}.X-ABDATE:${contact.anniversary}`);
      generated.push(`item${nextItem}.X-ABLabel:_$!<Anniversary>!$_`);
    }

    const body = [
      begin,
      version || 'VERSION:3.0',
      ...keptSimple,
      ...generated,
      ...keptItemLines,
      end,
    ];
    contact.rawVCard = this._joinVCardLines(body);
    this._syncContactRecord(contact);
  }

  _composeDisplayName(name) {
    if (!name) return '';
    return [name.prefix, name.given, name.additional, name.family, name.suffix]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _isAnniversaryItemGroup(groupLines) {
    for (const line of groupLines || []) {
      const parsed = VCardUtils.parseContentLine(line);
      if (!parsed || parsed.name !== 'X-ABLABEL') continue;
      if (this._decodeVCardValue(parsed.value).toLowerCase().includes('anniversary')) return true;
    }
    return false;
  }

  _customFieldEntries(contact) {
    return Object.entries(contact?.customFields || contact?.record?.fields || {})
      .filter(([, field]) => field != null)
      .sort(([a], [b]) => a.localeCompare(b));
  }

  _normalizeCustomField(field) {
    if (
      field &&
      typeof field === 'object' &&
      !Array.isArray(field) &&
      'type' in field &&
      'value' in field
    ) {
      return field;
    }
    return { type: this._customFieldType(field), value: field };
  }

  _customFieldType(value) {
    if (Array.isArray(value)) return 'list';
    if (value == null) return 'unknown';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }

  _customFieldLabel(key) {
    return (
      String(key || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase()) || 'Custom Field'
    );
  }

  _customFieldDisplayValue(fieldInput) {
    const field = this._normalizeCustomField(fieldInput);
    if (field.value == null) return '';
    if (Array.isArray(field.value))
      return field.value.map((value) => this._customFieldDisplayValue(value)).join(', ');
    if (typeof field.value === 'object') return JSON.stringify(field.value, null, 2);
    if (typeof field.value === 'boolean') return field.value ? 'Yes' : 'No';
    return String(field.value);
  }

  _isEditableCustomScalar(field) {
    return (
      ['string', 'number', 'boolean', 'date', 'color', 'markdown', 'unknown'].includes(
        field.type || 'unknown',
      ) &&
      (field.value == null || typeof field.value !== 'object')
    );
  }

  _coerceCustomScalarValue(input, type) {
    if (type === 'boolean') return !!input.checked;
    if (type === 'number') return input.value === '' ? null : Number(input.value);
    return input.value;
  }

  _namePartsFromDisplayName(displayName) {
    const parts = String(displayName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) {
      return { family: '', given: '', additional: '', prefix: '', suffix: '' };
    }
    if (parts.length === 1) {
      return { family: '', given: parts[0], additional: '', prefix: '', suffix: '' };
    }
    return {
      family: parts[parts.length - 1],
      given: parts[0],
      additional: parts.slice(1, -1).join(' '),
      prefix: '',
      suffix: '',
    };
  }

  _typePlaceholder(kind) {
    const examples = {
      email: 'custom email type',
      phone: 'custom phone type',
      address: 'custom address type',
      url: 'custom website type',
    };
    return examples[kind] || 'custom type';
  }

  _preferredRadio(kind, checked) {
    const label = document.createElement('label');
    label.className = 'detail-preferred-toggle';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `preferred-${kind}`;
    input.dataset.role = 'preferred';
    input.checked = !!checked;

    const text = document.createElement('span');
    text.textContent = 'Preferred';

    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  _typeSelect(kind, selectedValue, role = 'types-select') {
    const select = document.createElement('select');
    select.className = 'form-control detail-type-select';
    select.dataset.role = role;
    if (role === 'addr-type-select') {
      select.dataset.addr = 'type-select';
    }

    for (const option of this._typeOptions(kind)) {
      const el = document.createElement('option');
      el.value = option;
      el.textContent = this._typeOptionLabel(option);
      select.appendChild(el);
    }
    select.value = selectedValue || this._defaultTypeOption(kind);

    return select;
  }

  _typeOptions(kind) {
    const options = {
      email: ['home', 'work', 'school', 'icloud', 'other', 'custom'],
      phone: ['mobile', 'iphone', 'home', 'work', 'main', 'fax', 'other', 'custom'],
      address: ['home', 'work', 'mailing', 'billing', 'other', 'custom'],
      url: ['home', 'work', 'profile', 'blog', 'portfolio', 'other', 'custom'],
    };
    return options[kind] || ['home', 'work', 'other', 'custom'];
  }

  _addressInput(placeholder, key, value) {
    const input = document.createElement('input');
    input.className = 'form-control';
    input.placeholder = placeholder;
    input.dataset.addr = key;
    input.value = value;
    return input;
  }

  _customTypeInput(kind, roleOrAddr, value, isVisible) {
    const input = document.createElement('input');
    input.className = 'form-control detail-type-input';
    input.placeholder = this._typePlaceholder(kind);
    input.value = value || '';
    if (!isVisible) input.classList.add('hidden');
    if (roleOrAddr === 'types-custom') {
      input.dataset.role = roleOrAddr;
    } else {
      input.dataset.addr = roleOrAddr;
    }
    return input;
  }

  _visibleTypes(kind, types = []) {
    const hidden = new Set(this._hiddenTypes(kind));
    return (types || []).filter((type) => !hidden.has(String(type || '').toUpperCase()));
  }

  _typeSelectionState(kind, types = []) {
    const visible = this._visibleTypes(kind, types);
    if (visible.length === 0) {
      return { selected: this._defaultTypeOption(kind), customValue: '' };
    }
    if (visible.length === 1) {
      const normalized = String(visible[0]).trim().toLowerCase();
      if (this._typeOptions(kind).includes(normalized) && normalized !== 'custom') {
        return { selected: normalized, customValue: '' };
      }
    }
    return { selected: 'custom', customValue: visible.join(', ') };
  }

  _defaultTypeOption(kind) {
    return this._typeOptions(kind).includes('other') ? 'other' : this._typeOptions(kind)[0];
  }

  _selectedTypesFromEditor(kind, selectedValue, customValue) {
    if (selectedValue === 'custom') {
      return String(customValue || '')
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean)
        .filter(
          (type, index, arr) =>
            arr.findIndex((other) => other.toLowerCase() === type.toLowerCase()) === index,
        );
    }
    return selectedValue ? [selectedValue] : [this._defaultTypeOption(kind)];
  }

  _typeOptionLabel(value) {
    if (value === 'icloud') return 'iCloud';
    if (value === 'custom') return 'Custom';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  _bindTypeEditor(select, customInput) {
    const sync = () => {
      const isCustom = select.value === 'custom';
      customInput.classList.toggle('hidden', !isCustom);
      if (!isCustom) customInput.value = '';
    };
    select.addEventListener('change', sync);
    sync();
  }

  _hiddenTypes(kind) {
    const hidden = {
      email: ['PREF', 'INTERNET'],
      phone: ['PREF', 'VOICE'],
      address: ['PREF'],
      url: ['PREF'],
    };
    return hidden[kind] || ['PREF'];
  }

  _defaultHiddenTypes(kind) {
    const defaults = {
      email: ['INTERNET'],
      phone: ['VOICE'],
      address: [],
      url: [],
    };
    return defaults[kind] || [];
  }

  _isPreferred(types = []) {
    return (types || []).some((type) => String(type || '').toUpperCase() === 'PREF');
  }

  _normalizeStoredTypes(kind, visibleTypes = [], preferred = false) {
    const allTypes = [
      ...this._defaultHiddenTypes(kind),
      ...visibleTypes,
      ...(preferred ? ['PREF'] : []),
    ];

    return allTypes
      .map((type) => String(type || '').trim())
      .filter(Boolean)
      .filter((type, index, arr) => {
        const upper = type.toUpperCase();
        return (
          arr.findIndex(
            (other) =>
              String(other || '')
                .trim()
                .toUpperCase() === upper,
          ) === index
        );
      });
  }

  _ensureSinglePreferred(entries, kind) {
    if (!entries.length) return entries;

    let preferredFound = false;
    for (const entry of entries) {
      const isPreferred = this._isPreferred(entry.types);
      if (isPreferred && !preferredFound) {
        preferredFound = true;
        continue;
      }
      if (isPreferred && preferredFound) {
        entry.types = entry.types.filter((type) => String(type || '').toUpperCase() !== 'PREF');
      }
    }

    if (!preferredFound) {
      entries[0].types = this._normalizeStoredTypes(
        kind,
        this._visibleTypes(kind, entries[0].types),
        true,
      );
    }

    return entries;
  }

  // ── Edit Relationship Type ─────────────────────────────────────

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

    if (contact.rawVCard) {
      const pfx =
        this._findRelatedItemPrefixByIndex(contact.rawVCard, relIdx) ||
        this._findRelatedItemPrefix(contact.rawVCard, oldName);
      if (pfx) {
        contact.rawVCard = this._replaceItemProperty(
          contact.rawVCard,
          pfx,
          'X-ABLabel',
          this._typeToVCardLabel(newType),
        );
        contact.rawVCard = this._replaceItemProperty(
          contact.rawVCard,
          pfx,
          'X-ABRELATEDNAMES',
          this._vCardEscape(newName),
        );
      }
    }

    const reciprocalType = this._reciprocalType(newType);
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

        if (this._isReciprocalDowngrade(reciprocalType, backRel.type)) {
        } else {
          backRel.type = reciprocalType;
          backRel.rawType = this._typeToVCardLabel(reciprocalType);
          recipUpdated = true;

          if (otherContact.rawVCard) {
            const pfx2 = this._findRelatedItemPrefix(otherContact.rawVCard, contact.fn || '');
            if (pfx2) {
              otherContact.rawVCard = this._replaceItemProperty(
                otherContact.rawVCard,
                pfx2,
                'X-ABLabel',
                this._typeToVCardLabel(reciprocalType),
              );
            }
          }
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

    if (contact.rawVCard) {
      const pfx =
        this._findRelatedItemPrefixByIndex(contact.rawVCard, relIdx) ||
        this._findRelatedItemPrefix(contact.rawVCard, rel.name);
      if (pfx) {
        contact.rawVCard = this._removeItemGroup(contact.rawVCard, pfx);
      }
    }

    contact.related.splice(relIdx, 1);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
    const refreshed = this._node(currentNode.id);
    if (refreshed) this._onNodeSelect(refreshed);
    this._showToast(`Deleted relationship to ${rel.name}`, 'success');
  }

  // ── Add Relationship Modal ─────────────────────────────────────

  _showAddRelationshipModal() {
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

    document.getElementById('modal-target-mode').value = 'existing';
    document.getElementById('modal-target-select-row').classList.remove('hidden');
    document.getElementById('modal-manual-name-row').classList.add('hidden');
    document.getElementById('modal-create-mode-row').classList.add('hidden');
    document.getElementById('modal-target-name').value = '';
    document.getElementById('modal-create-mode').value = 'virtual';
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
