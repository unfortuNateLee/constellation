import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';

/**
 * Session persistence (IndexedDB), current-state serialization, and the
 * "me" self-contact reference resolution. Extracted from app.js verbatim.
 */
class SessionMixin {
  _serializeCurrentVCF() {
    return this.vcardAdapter.serialize(this.contacts);
  }

  _serializeCurrentSource() {
    const adapter = this._adapterById(this._activeFormatId) || this.vcardAdapter;
    return adapter.serialize(this.contacts);
  }

  _selfContactRef() {
    if (!this._selfContactId) return null;
    const contact = this._contact(this._selfContactId);
    if (!contact) return null;
    return {
      uid: contact.uid || null,
      fn: contact.fn || null,
    };
  }

  _resolveSelfContactId(ref) {
    if (!ref) return null;
    if (ref.uid) {
      const byUid = this._contactsByUid.get(ref.uid);
      if (byUid) return byUid.id;
    }
    if (ref.fn) {
      const byFn = this._contactsByFn.get(String(ref.fn).toLowerCase().trim());
      if (byFn) return byFn.id;
    }
    return null;
  }

  _getDb() {
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this._dbStoreName)) {
          db.createObjectStore(this._dbStoreName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this._dbPromise;
  }

  async _readPersistedSession() {
    try {
      const db = await this._getDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this._dbStoreName, 'readonly');
        const req = tx.objectStore(this._dbStoreName).get(this._storageKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[session] Failed to read saved session', err);
      return null;
    }
  }

  async _persistSession(overrides = {}) {
    if (!this.contacts.length) return;
    try {
      const payload = {
        fileLabel:
          overrides.fileLabel ||
          document.getElementById('file-label').textContent ||
          'restored-session.vcf',
        formatId: this._activeFormatId,
        content: this._serializeCurrentSource(),
        savedAt: new Date().toISOString(),
        selfContactRef: this._selfContactRef(),
        showInferred: this._showInferred,
        showLikelyFamily: this._showLikelyFamily,
        showLikelyConnections: this._showLikelyConnections,
        showIsolated: this._showIsolated,
        sidebarControlsCollapsed: this._sidebarControlsCollapsed,
        contactSortMode: this._contactSortMode,
        graphMode: this._graphMode,
        mainViewMode: this._mainViewMode,
      };
      const db = await this._getDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this._dbStoreName, 'readwrite');
        tx.objectStore(this._dbStoreName).put(payload, this._storageKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      await this._updateSessionButtons(payload);
    } catch (err) {
      console.warn('[session] Failed to save session', err);
      this._showToast('Could not save browser session', 'error');
    }
  }

  async _restorePersistedSession() {
    const saved = await this._readPersistedSession();
    if (!saved || !saved.content) {
      this._showToast('No saved browser session found', 'error');
      await this._updateSessionButtons(null);
      return;
    }

    try {
      const adapter = this._adapterById(saved.formatId || 'vcard') || this.vcardAdapter;
      const contacts = adapter.parse(saved.content);
      this.contacts = contacts;
      this._activeFormatId = adapter.id;
      this.builder = new RelationshipBuilder(contacts);
      this._reindexContacts();
      this._showInferred = saved.showInferred !== false;
      this._showLikelyFamily =
        saved.showLikelyFamily === true ||
        (saved.showLikelyFamily == null && saved.showLikely === true);
      this._showLikelyConnections =
        saved.showLikelyConnections !== false && saved.showLikely !== false;
      this._showIsolated = saved.showIsolated !== false;
      this._sidebarControlsCollapsed = saved.sidebarControlsCollapsed === true;
      this._contactSortMode = saved.contactSortMode === 'last-first' ? 'last-first' : 'first-last';
      this._mainViewMode = saved.mainViewMode === 'table' ? 'table' : 'graph';
      const savedMode = saved.graphMode || 'family-explicit';
      if (
        savedMode === 'family-explicit' ||
        savedMode === 'likely-family' ||
        savedMode === 'likely-connections'
      ) {
        this._graphMode = 'connections';
      } else {
        this._graphMode = savedMode;
      }
      this._selfContactId = this._resolveSelfContactId(saved.selfContactRef);
      document.getElementById('toggle-inferred').checked = this._showInferred;
      document.getElementById('toggle-likely-family').checked = this._showLikelyFamily;
      document.getElementById('toggle-likely-connections').checked = this._showLikelyConnections;
      document.getElementById('toggle-isolated').checked = this._showIsolated;
      document.getElementById('contact-sort-mode').value = this._contactSortMode;
      document.getElementById('graph-mode-select').value = this._graphMode;
      this._applySidebarCollapseState();
      this._applyMainViewMode();
      document.getElementById('file-label').textContent =
        `${saved.fileLabel || 'restored-session.vcf'} (restored)`;
      document.getElementById('btn-export-all-menu').classList.remove('hidden');
      document.getElementById('drop-zone').classList.add('hidden');
      this._selectedForExport.clear();
      this._updateExportBar();
      this._rebuildGraph();
      this._showToast('Restored last saved browser session', 'success');
      await this._updateSessionButtons(saved);
    } catch (err) {
      console.error(err);
      this._showToast('Failed to restore saved session: ' + err.message, 'error');
    }
  }

  async _clearPersistedSession(showToast = false) {
    try {
      const db = await this._getDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this._dbStoreName, 'readwrite');
        tx.objectStore(this._dbStoreName).delete(this._storageKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[session] Failed to clear session', err);
    }
    await this._updateSessionButtons(null);
    if (showToast) this._showToast('Cleared saved browser session', 'success');
  }

  async _updateSessionButtons(saved = undefined) {
    const data = saved === undefined ? await this._readPersistedSession() : saved;
    const hasSaved = !!(data && data.content);
    this._hasSavedSession = hasSaved;

    // Restore Last / Clear Saved now live in the Session menu; disable the whole
    // menu trigger when there's nothing saved to act on.
    const sessionMenu = document.getElementById('btn-session-menu');
    if (sessionMenu) {
      sessionMenu.disabled = !hasSaved;
      sessionMenu.title =
        hasSaved && data.savedAt
          ? `Saved-session actions (last saved ${new Date(data.savedAt).toLocaleString()})`
          : 'No saved browser session available';
    }

    // Surface restore on the first/empty screen when a session is available.
    const restoreDrop = document.getElementById('btn-restore-session-drop');
    if (restoreDrop) {
      restoreDrop.classList.toggle('hidden', !hasSaved);
      if (hasSaved && data.savedAt) {
        restoreDrop.title = `Last saved ${new Date(data.savedAt).toLocaleString()}`;
      }
    }
  }
}

applyMixin(ContactRelationshipApp.prototype, SessionMixin);
