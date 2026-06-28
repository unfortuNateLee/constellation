import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The app source is now native ES modules; import the classes directly.
// Importing app-notes for its side effect (it mixes methods into the prototype).
import { VCardUtils } from '../../js/vcard-utils.js';
import { Palette } from '../../js/palette.js';
import { ContactRecord } from '../../js/contact-record.js';
import { RelationshipTaxonomy } from '../../js/relationship-taxonomy.js';
import { VCFParser } from '../../js/vcf-parser.js';
import { VCardAdapter } from '../../js/vcard-adapter.js';
import { MarkdownAdapter } from '../../js/markdown-adapter.js';
import { TsvAdapter } from '../../js/tsv-adapter.js';
import { RelationshipBuilder } from '../../js/relationship-builder.js';
import { ContactRelationshipApp } from '../../js/app-controller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const realConsole = console;

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

/**
 * Install fake browser globals and return the app classes plus the fakes.
 * Modules resolve `document`/`window`/`console`/`indexedDB` against globalThis
 * at call time, so re-installing fresh fakes per call keeps tests isolated.
 * (Blob, URL, TextEncoder, setTimeout already exist as Node globals.)
 */
export function loadBrowserClasses() {
  const document = createFakeDocument();
  const consoleFake = { ...realConsole, warn() {} };
  const windowFake = {
    confirm: () => true,
    setTimeout,
    clearTimeout,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
  };
  const indexedDB = {
    open() {
      throw new Error('IndexedDB is not available in unit tests');
    },
  };

  globalThis.document = document;
  globalThis.window = windowFake;
  globalThis.console = consoleFake;
  globalThis.indexedDB = indexedDB;

  return {
    VCardUtils,
    Palette,
    ContactRecord,
    RelationshipTaxonomy,
    VCFParser,
    VCardAdapter,
    MarkdownAdapter,
    TsvAdapter,
    RelationshipBuilder,
    ContactRelationshipApp,
    document,
    window: windowFake,
    console: consoleFake,
  };
}

export function fixturePath(name) {
  return path.join(root, 'test', 'fixtures', name);
}

export function readFixture(name) {
  return fs.readFileSync(fixturePath(name), 'utf8');
}

export function makeTestApp(context, contacts) {
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
