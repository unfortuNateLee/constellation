import { VCardAdapter } from './vcard-adapter.js';
import { MarkdownAdapter } from './markdown-adapter.js';
import { TsvAdapter } from './tsv-adapter.js';
import { RelationshipBuilder } from './relationship-builder.js';
import { ConstellationGraph } from './graph.js';
import { ContactRecord } from './contact-record.js';
import { makeSearchable } from './searchable-select.js';
import { attachMenu } from './menu-button.js';

/**
 * Main application controller
 * Orchestrates: VCF import → parse → build graph data → render
 */
export class ContactRelationshipApp {
  constructor() {
    this.vcardAdapter = new VCardAdapter();
    this.markdownAdapter = new MarkdownAdapter();
    this.tsvAdapter = new TsvAdapter();
    this.formatAdapters = [this.vcardAdapter, this.markdownAdapter, this.tsvAdapter];
    this._activeFormatId = 'vcard';
    this.parser = this.vcardAdapter.parser;
    this.builder = null;
    this.graph = null;
    this._storageKey = 'constellation:last-session';
    this._dbName = 'constellation-db';
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

    // Populate the add-relationship modal's type picker from the taxonomy
    // (single source of truth) rather than a hand-maintained option list.
    const modalRelType = document.getElementById('modal-rel-type');
    modalRelType.insertAdjacentHTML('beforeend', this._relTypeOptionsHtml(''));
    makeSearchable(modalRelType, { placeholder: 'Search relationship types…' });

    // Graph container
    const graphContainer = document.getElementById('graph-container');
    this.graph = new ConstellationGraph(graphContainer);

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
        this._showToast('Please drop a .vcf, .md, or .tsv file', 'error');
      }
    });

    // Search — debounced so typing doesn't re-render the (potentially large)
    // list + table on every keystroke.
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      this._searchQuery = e.target.value.toLowerCase();
      clearTimeout(this._searchDebounceTimer);
      this._searchDebounceTimer = setTimeout(() => {
        this._renderContactList();
        this._renderTableMode();
      }, 120);
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

    // Focus on Me — center on AND select the chosen "me" contact. Disabled when
    // no "me" is chosen (see _syncFocusMeButton).
    document.getElementById('btn-focus-me').addEventListener('click', () => {
      if (!this._selfContactId) return;
      const node = this._node(this._selfContactId);
      if (!node) return;
      this.graph.highlightContact(this._selfContactId);
      this._onNodeSelect(node);
    });

    // Session menu — restore last / clear saved.
    attachMenu(document.getElementById('btn-session-menu'), [
      { label: 'Restore Last Session', onSelect: () => this._restorePersistedSession() },
      {
        label: 'Clear Saved Session',
        danger: true,
        onSelect: () => this._clearPersistedSession(true),
      },
    ]);

    document.getElementById('btn-bulk-normalize').addEventListener('click', () => {
      this._openBulkNormalizeModal();
    });

    // Center the graph on the currently displayed contact
    document.getElementById('btn-center-contact').addEventListener('click', () => {
      if (this._selectedNodeId) this.graph.centerOnContact(this._selectedNodeId);
    });

    // Graph zoom/fit controls (overlay buttons; D3 wheel/drag zoom still works).
    document
      .getElementById('btn-graph-zoom-in')
      ?.addEventListener('click', () => this.graph.zoomBy(1.3));
    document
      .getElementById('btn-graph-zoom-out')
      ?.addEventListener('click', () => this.graph.zoomBy(1 / 1.3));
    document.getElementById('btn-graph-fit')?.addEventListener('click', () => this.graph.fitView());
    document
      .getElementById('btn-graph-reset')
      ?.addEventListener('click', () => this.graph.resetView());

    // Close detail panel
    document.getElementById('btn-close-detail').addEventListener('click', () => {
      this._onNodeDeselect();
    });

    // Import menu — vCard (active), Markdown (placeholder), TSV, and the template.
    const pickFiles = (accept) => {
      const input = document.getElementById('file-input');
      input.accept = accept;
      input.click();
    };
    attachMenu(document.getElementById('btn-import-menu'), [
      { label: 'Import vCard', onSelect: () => pickFiles('.vcf,.vcard') },
      { label: 'Import Markdown', onSelect: () => pickFiles('.md,.markdown') },
      { label: 'Import TSV', onSelect: () => pickFiles('.tsv') },
      { separator: true },
      { label: 'Download TSV Template', onSelect: () => this._downloadTsvTemplate() },
    ]);

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

    // Export All menu (bulk filenames carry the date, e.g. "contacts 2026-06-26")
    attachMenu(document.getElementById('btn-export-all-menu'), [
      {
        label: 'Export All as vCard',
        onSelect: () =>
          this._exportVCF(
            new Set(this.contacts.map((c) => c.id)),
            `contacts ${this._dateStamp()}.vcf`,
          ),
      },
      {
        label: 'Export All as Markdown',
        onSelect: () =>
          void this._exportMarkdownScope(
            new Set(this.contacts.map((c) => c.id)),
            `contacts ${this._dateStamp()}`,
          ),
      },
      {
        label: 'Export All as TSV',
        onSelect: () =>
          this._exportTsv(
            new Set(this.contacts.map((c) => c.id)),
            `contacts ${this._dateStamp()}.tsv`,
          ),
      },
    ]);

    // Export Selected menu (sidebar selection bar)
    attachMenu(document.getElementById('btn-export-selected-menu'), [
      {
        label: 'Export Selected as vCard',
        onSelect: () =>
          this._exportVCF(this._selectedForExport, `selected-contacts ${this._dateStamp()}.vcf`),
      },
      {
        label: 'Export Selected as Markdown',
        onSelect: () =>
          void this._exportMarkdownScope(
            this._selectedForExport,
            `selected-contacts ${this._dateStamp()}`,
          ),
      },
      {
        label: 'Export Selected as TSV',
        onSelect: () =>
          this._exportTsv(this._selectedForExport, `selected-contacts ${this._dateStamp()}.tsv`),
      },
    ]);

    // Delete selected (confirms first)
    document.getElementById('btn-delete-selected').addEventListener('click', () => {
      this._deleteSelectedContacts();
    });

    // Clear selection
    document.getElementById('btn-clear-selection').addEventListener('click', () => {
      this._selectedForExport.clear();
      this._updateExportBar();
      this._renderContactList();
    });

    // Export Contact menu (detail panel)
    attachMenu(document.getElementById('btn-export-contact-menu'), [
      {
        label: 'Export Contact as vCard',
        onSelect: () => {
          if (!this._selectedNodeId) return;
          const node = this._node(this._selectedNodeId);
          if (!node) return;
          const safe = (node.name || 'contact').replace(/[^a-zA-Z0-9_-]/g, '_');
          this._exportVCF(new Set([this._selectedNodeId]), `${safe}.vcf`);
        },
      },
      {
        label: 'Export Contact as Markdown',
        onSelect: () => {
          if (!this._selectedNodeId) return;
          const contact = this._contact(this._selectedNodeId);
          const base = this.markdownAdapter._slugFor(contact || { fn: 'contact' });
          void this._exportMarkdownScope(new Set([this._selectedNodeId]), base);
        },
      },
      {
        label: 'Export Contact as TSV',
        onSelect: () => {
          if (!this._selectedNodeId) return;
          const contact = this._contact(this._selectedNodeId);
          const base = this.markdownAdapter._slugFor(contact || { fn: 'contact' });
          this._exportTsv(new Set([this._selectedNodeId]), `${base}.tsv`);
        },
      },
    ]);

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
    this._initCollapsiblePanels();
    this._initModalA11y();
    this._initSidebarResizer();
    this._syncGraphModeControls();
    this._renderLegend();
    this._applyMainViewMode();
  }

  /**
   * Make the contact/search list horizontally resizable by dragging the handle
   * on the sidebar's right edge. The chosen width drives --sidebar-list-w and
   * persists across reloads.
   */
  _initSidebarResizer() {
    const handle = document.getElementById('sidebar-resizer');
    if (!handle) return;
    const root = document.documentElement;
    const MIN = 220;
    const MAX = 520;
    const STORAGE_KEY = 'constellation:sidebar-list-w';

    const apply = (px) => root.style.setProperty('--sidebar-list-w', `${px}px`);
    const current = () =>
      parseInt(getComputedStyle(root).getPropertyValue('--sidebar-list-w'), 10) || MIN;

    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved >= MIN && saved <= MAX) apply(saved);

    let startX = 0;
    let startW = 0;
    const onMove = (e) => {
      const next = Math.min(MAX, Math.max(MIN, startW + (e.clientX - startX)));
      apply(next);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-sidebar');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(STORAGE_KEY, String(current()));
      } catch {
        /* storage unavailable — width still applied for this session */
      }
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = current();
      document.body.classList.add('resizing-sidebar');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /**
   * Modal accessibility: Escape closes the open modal, Tab is trapped inside it.
   * Pairs with role="dialog"/aria-modal in the markup and _focusModal on open.
   */
  _initModalA11y() {
    document.addEventListener('keydown', (e) => {
      const modal = document.querySelector('.modal-backdrop:not(.hidden)');
      if (!modal) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (modal.id === 'bulk-normalize-modal') this._closeBulkNormalizeModal();
        else modal.classList.add('hidden');
      } else if (e.key === 'Tab') {
        const focusables = [
          ...modal.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  /** Move focus to the first useful, visible control inside a freshly-opened modal. */
  _focusModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const candidates = modal.querySelectorAll(
      'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    );
    // Skip controls that are hidden (e.g. the native <select> behind a searchable
    // combobox) — pick the first one that's actually visible/focusable.
    const target = [...candidates].find(
      (el) => el.offsetParent !== null && el.getAttribute('aria-hidden') !== 'true',
    );
    if (target) target.focus();
  }

  /** Make sidebar section titles and the graph legend title click-to-collapse. */
  _initCollapsiblePanels() {
    document
      .querySelectorAll('.sidebar-controls .sidebar-section > .sidebar-title')
      .forEach((title) => {
        title.classList.add('collapsible');
        title.addEventListener('click', () => title.parentElement.classList.toggle('collapsed'));
      });
    const legendTitle = document.querySelector('#graph-legend .legend-title');
    if (legendTitle) {
      legendTitle.classList.add('collapsible');
      legendTitle.addEventListener('click', () =>
        document.getElementById('graph-legend').classList.toggle('collapsed'),
      );
    }
  }

  // ── File Loading ───────────────────────────────────────────────

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
      document.getElementById('btn-export-all-menu').classList.remove('hidden');
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
    this._syncFocusMeButton();

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

  /** Enable "Focus on Me" only when a "me" contact is chosen and in the graph. */
  _syncFocusMeButton() {
    const btn = document.getElementById('btn-focus-me');
    if (!btn) return;
    const hasMe = !!this._selfContactId && !!this._nodeById?.get(this._selfContactId);
    btn.disabled = !hasMe;
  }

  _reindexContacts() {
    this._contactById = new Map();
    this._contactsByUid = new Map();
    this._contactsByFn = new Map();
    for (const contact of this.contacts || []) {
      this._syncContactRecord(contact);
      this._contactById.set(contact.id, contact);
      if (contact.uid) this._contactsByUid.set(contact.uid, contact);
      // Index by display name as a UID-less fallback. On duplicate names keep the
      // FIRST (file order) rather than letting a later duplicate silently win —
      // deterministic, and UID resolution already takes precedence where present.
      const fnKey = contact.fn ? contact.fn.toLowerCase().trim() : '';
      if (fnKey && !this._contactsByFn.has(fnKey)) this._contactsByFn.set(fnKey, contact);
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

  /**
   * The single factory for a new, empty contact seeded from a display name.
   * Built on ContactRecord.createEmptyContact() so it always carries every
   * STANDARD_FIELD. Used by the detail "Create Contact", table "Add Contact",
   * and create-from-virtual flows.
   */
  _makeMinimalContact(displayName) {
    const contact = ContactRecord.createEmptyContact();
    contact.id = this.parser._generateId();
    contact.uid = null;
    contact.fn = displayName || 'New Contact';
    contact.name = this._namePartsFromDisplayName(contact.fn);
    contact.tags = ['other'];

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

  /**
   * A labeled detail row. `text` is treated as PLAIN TEXT and escaped — the safe
   * default. Callers that need to inject markup (links, multi-line address) must
   * use `_detailRowHtml` with content they have escaped themselves.
   */
  _detailRow(icon, text, label) {
    return this._detailRowHtml(icon, this._escapeHtml(text), label);
  }

  _detailRowHtml(icon, html, label) {
    const row = document.createElement('div');
    row.className = 'detail-row';
    row.innerHTML = `
      <span class="detail-icon">${icon}</span>
      <div class="detail-field">
        ${label ? `<div class="detail-label">${this._escapeHtml(label)}</div>` : ''}
        <div class="detail-value">${html}</div>
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

  /**
   * Safely embed a (data:) URL in a CSS `url(...)` context. Strips characters
   * that could break out of the quoted url() — quotes, parens, backslashes,
   * whitespace — so a crafted PHOTO value can't inject CSS. Returns 'none' when
   * empty. Base64 data URLs contain none of the stripped characters.
   */
  _cssUrl(value) {
    const safe = String(value || '').replace(/["'()\\\s]/g, '');
    return safe ? `url("${safe}")` : 'none';
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
    } catch {
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

  _showToast(msg, type = 'info', action = null) {
    const toast = document.getElementById('toast');
    toast.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    toast.appendChild(span);
    if (action && action.label) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        toast.classList.remove('show');
        action.onClick();
      });
      toast.appendChild(btn);
    }
    toast.className = `toast toast-${type} show`;
    clearTimeout(this._toastTimer);
    // Give actionable toasts longer to be clicked.
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), action ? 8000 : 3500);
  }

  _nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 16));
  }
}
