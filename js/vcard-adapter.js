import { VCFParser } from './vcf-parser.js';
import { ContactRecord } from './contact-record.js';
import { VCardSerializer } from './vcard-serializer.js';

/**
 * vCard format adapter.
 *
 * This wraps the existing parser and raw-vCard serialization rules behind the
 * same shape future file formats can implement. The app still edits legacy
 * contact objects for now; this adapter is the format boundary.
 */
export class VCardAdapter {
  constructor(parser = new VCFParser()) {
    this.id = 'vcard';
    this.label = 'vCard';
    this.extensions = ['vcf', 'vcard'];
    this.mimeType = 'text/vcard;charset=utf-8';
    this.parser = parser;
  }

  canImportFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return this.extensions.some((ext) => name.endsWith(`.${ext}`));
  }

  parse(text, options = {}) {
    const contacts = this.parser.parse(text);
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      ContactRecord.refreshLegacyContact(contact, {
        format: this.id,
        raw: contact.rawVCard || '',
        index: options.startIndex != null ? options.startIndex + i : i,
      });
    }
    return contacts;
  }

  serialize(contacts, ids = null) {
    const selectedIds = ids ? new Set(ids) : null;
    const blocks = [];
    for (const contact of contacts || []) {
      if (selectedIds && !selectedIds.has(contact.id)) continue;
      // The raw card (kept in sync by the edit paths) is the source of truth;
      // contacts without one (Markdown/TSV imports) are generated from the
      // model by the shared serializer.
      const block = VCardSerializer.serializeContact(contact);
      if (block) blocks.push(block.trim());
    }
    return blocks.length ? `${blocks.join('\r\n')}\r\n` : '';
  }

  exportBlob(contacts, ids = null) {
    const content = this.serialize(contacts, ids);
    if (!content) return null;
    return new Blob([content], { type: this.mimeType });
  }
}
