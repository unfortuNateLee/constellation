import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';

/**
 * Export: download the selected / all contacts as vCard or Markdown.
 *
 * vCard is always a single .vcf (photos embedded, per the spec). Markdown
 * externalizes embedded photos into separate, human-readably-named image files
 * written alongside the .md — via the File System Access API directory picker
 * where available, otherwise as individual downloads.
 */
class ExportMixin {
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

  _exportTsv(ids, filename) {
    this._exportWithAdapter(this.tsvAdapter, ids, filename);
  }

  /** Download a blank TSV with all columns (in order) plus a worked example row. */
  _downloadTsvTemplate() {
    const blob = new Blob([this.tsvAdapter.templateText()], { type: this.tsvAdapter.mimeType });
    this._downloadBlob(blob, 'contacts-template.tsv');
    this._showToast('Downloaded TSV template', 'success');
  }

  _exportWithAdapter(adapter, ids, filename) {
    const blob = adapter.exportBlob(this.contacts, ids);
    if (!blob) {
      this._showToast('No exportable contacts found', 'error');
      return;
    }
    this._downloadBlob(blob, filename);
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

  /**
   * Export the given contacts as Markdown. A photo-free export is a single .md;
   * if any contact has a photo, the .md and the externalized image files are
   * written as separate files alongside each other.
   * @param {Set<string>|Array<string>|null} ids
   * @param {string} baseName  base filename (no extension)
   */
  async _exportMarkdownScope(ids, baseName) {
    const { markdown, images } = this.markdownAdapter.serializeBundle(this.contacts, ids);
    if (!markdown) {
      this._showToast('No exportable contacts found', 'error');
      return;
    }
    const mdBlob = new Blob([markdown], { type: this.markdownAdapter.mimeType });

    if (images.length === 0) {
      this._downloadBlob(mdBlob, `${baseName}.md`);
      this._showToast('Exported as Markdown', 'success');
      return;
    }

    const files = [
      { name: `${baseName}.md`, blob: mdBlob },
      ...images.map((image) => ({ name: image.name, blob: this._dataUrlToBlob(image.dataUrl) })),
    ];
    const status = await this._saveFilesSeparately(files);
    if (status === 'cancelled') return;
    const verb = status === 'saved' ? 'Saved' : 'Downloaded';
    this._showToast(
      `${verb} Markdown + ${images.length} image${images.length !== 1 ? 's' : ''}`,
      'success',
    );
  }

  /**
   * Write each file as its own file. Prefers the File System Access API so the
   * files land together in a user-chosen folder; falls back to individual
   * downloads. Returns 'saved' | 'downloaded' | 'cancelled'.
   */
  async _saveFilesSeparately(files) {
    if (window.showDirectoryPicker) {
      let dir = null;
      try {
        dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'constellation-export' });
      } catch (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
        console.warn('[export] directory picker unavailable; downloading instead', err);
      }
      if (dir) {
        try {
          for (const file of files) {
            const handle = await dir.getFileHandle(file.name, { create: true });
            const writable = await handle.createWritable();
            await writable.write(file.blob);
            await writable.close();
          }
          return 'saved';
        } catch (err) {
          console.warn('[export] directory write failed; downloading instead', err);
        }
      }
    }
    // Fallback: download each file separately (a small gap avoids the browser
    // coalescing them).
    for (const file of files) {
      this._downloadBlob(file.blob, file.name);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return 'downloaded';
  }

  // Local date as YYYY-MM-DD, for appending to bulk export filenames.
  _dateStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  _dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, comma);
    const mime = (header.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
}

applyMixin(ContactRelationshipApp.prototype, ExportMixin);
