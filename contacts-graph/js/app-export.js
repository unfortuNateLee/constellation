import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';

/**
 * Export: builds the export selection bar and downloads the selected (or all)
 * contacts via the active format adapter (vCard / Markdown). Extracted from
 * app.js verbatim.
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
}

applyMixin(ContactRelationshipApp.prototype, ExportMixin);
