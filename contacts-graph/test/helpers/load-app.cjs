const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');

function createFakeDocument() {
  const elements = new Map();
  return {
    elements,
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    createElement(tagName) {
      return {
        tagName: String(tagName || '').toUpperCase(),
        children: [],
        className: '',
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains() {
            return false;
          },
        },
        dataset: {},
        style: {},
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        append(...children) {
          this.children.push(...children);
        },
        setAttribute(name, value) {
          this[name] = value;
        },
        addEventListener() {},
        removeEventListener() {},
        replaceWith() {},
        insertAdjacentElement() {},
      };
    },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id,
          value: '',
          checked: false,
          disabled: false,
          textContent: '',
          innerHTML: '',
          classList: {
            add() {},
            remove() {},
            toggle() {},
            contains() {
              return false;
            },
          },
          style: {},
          appendChild() {},
          append() {},
          addEventListener() {},
          querySelectorAll() {
            return [];
          },
          querySelector() {
            return null;
          },
        });
      }
      return elements.get(id);
    },
    __setElement(id, element) {
      elements.set(id, element);
      return element;
    },
  };
}

function loadBrowserClasses() {
  const document = createFakeDocument();
  const context = {
    console: {
      ...console,
      warn() {},
    },
    Blob,
    URL,
    TextEncoder,
    setTimeout,
    clearTimeout,
    document,
    window: {
      confirm: () => true,
      setTimeout,
      clearTimeout,
      innerWidth: 1200,
      innerHeight: 800,
      addEventListener() {},
    },
    indexedDB: {
      open() {
        throw new Error('IndexedDB is not available in unit tests');
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);

  const files = [
    'js/vcard-utils.js',
    'js/palette.js',
    'js/contact-record.js',
    'js/relationship-taxonomy.js',
    'js/vcf-parser.js',
    'js/vcard-adapter.js',
    'js/markdown-adapter.js',
    'js/relationship-builder.js',
    'js/app.js',
    'js/app-notes.js',
  ];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n\n');
  vm.runInContext(
    `${source}
this.VCardUtils = VCardUtils;
this.Palette = Palette;
this.ContactRecord = ContactRecord;
this.RelationshipTaxonomy = RelationshipTaxonomy;
this.VCFParser = VCFParser;
this.VCardAdapter = VCardAdapter;
this.MarkdownAdapter = MarkdownAdapter;
this.RelationshipBuilder = RelationshipBuilder;
this.ContactRelationshipApp = ContactRelationshipApp;`,
    context,
  );
  return context;
}

function fixturePath(name) {
  return path.join(root, 'test', 'fixtures', name);
}

function readFixture(name) {
  return fs.readFileSync(fixturePath(name), 'utf8');
}

function makeTestApp(context, contacts) {
  const app = Object.create(context.ContactRelationshipApp.prototype);
  app.vcardAdapter = new context.VCardAdapter();
  app.markdownAdapter = new context.MarkdownAdapter();
  app.formatAdapters = [app.vcardAdapter, app.markdownAdapter];
  app._activeFormatId = 'vcard';
  app.parser = app.vcardAdapter.parser;
  app.contacts = contacts;
  app.builder = new context.RelationshipBuilder(app.contacts);
  app.graphData = { nodes: [], edges: [], hulls: [] };
  app.allCategories = [];
  app._activeFilters = new Set();
  app._showInferred = true;
  app._showLikelyFamily = false;
  app._showLikelyConnections = true;
  app._showIsolated = true;
  app._graphMode = 'connections';
  app._selfContactId = null;
  app._selectedNodeId = null;
  app._editingContactId = null;
  app._dismissedSuggestions = new Set();
  app._selectedForExport = new Set();
  app._contactById = new Map();
  app._contactsByUid = new Map();
  app._contactsByFn = new Map();
  app._nodeById = new Map();
  app._edgesByNodeId = new Map();
  app._relatedRefsByTargetId = new Map();
  app._inlineNotesSaveTimer = null;
  app._notesAutocomplete = {
    textarea: null,
    matches: [],
    selectedIndex: 0,
    start: -1,
    end: -1,
  };
  app.graph = {
    render() {},
    setFilterCategories() {},
    highlightContact() {},
  };
  app._showToast = () => {};
  app._persistSession = async () => {};
  app._closeBulkNormalizeModal = () => {};
  app._onNodeSelect = () => {};
  app._onNodeDeselect = () => {};
  app._renderContactList = () => {};
  app._renderTableMode = () => {};
  app._renderSelfContactPicker = () => {};
  app._renderCategoryFilters = () => {};
  app._renderStats = () => {};
  app._renderLegend = () => {};
  app._syncGraphModeControls = () => {};
  app._pruneActiveFilters = () => {};
  app._applyMainViewMode = () => {};
  app._updateExportBar = () => {};

  app._rebuildGraph = function rebuildForTest() {
    this._reindexContacts();
    this.graphData = this.builder.build({
      mode: this._graphMode,
      includeInferred: this._showInferred,
      includeLikelyFamily: this._showLikelyFamily,
      includeLikelyConnections: this._showLikelyConnections,
      includeIsolated: this._showIsolated,
      rootContactId: this._selfContactId,
    });
    this._reindexGraphData();
  };
  app._rebuildGraph();
  return app;
}

module.exports = {
  fixturePath,
  loadBrowserClasses,
  makeTestApp,
  readFixture,
};
