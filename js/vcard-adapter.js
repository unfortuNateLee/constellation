import { VCFParser } from './vcf-parser.js';
import { ContactRecord } from './contact-record.js';
import { VCardUtils } from './vcard-utils.js';

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
      if (typeof ContactRecord !== 'undefined') {
        ContactRecord.refreshLegacyContact(contact, {
          format: this.id,
          raw: contact.rawVCard || '',
          index: options.startIndex != null ? options.startIndex + i : i,
        });
      }
    }
    return contacts;
  }

  serialize(contacts, ids = null) {
    const selectedIds = ids ? new Set(ids) : null;
    const blocks = [];
    for (const contact of contacts || []) {
      if (selectedIds && !selectedIds.has(contact.id)) continue;
      const block = contact.rawVCard || this._serializeContactFallback(contact);
      if (block) blocks.push(block.trim());
    }
    return blocks.length ? `${blocks.join('\r\n')}\r\n` : '';
  }

  exportBlob(contacts, ids = null) {
    const content = this.serialize(contacts, ids);
    if (!content) return null;
    return new Blob([content], { type: this.mimeType });
  }

  _serializeContactFallback(contact) {
    if (!contact) return '';
    const name = contact.name || {};
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];

    if (contact.uid) lines.push(`UID:${this._escape(contact.uid)}`);
    lines.push(`FN:${this._escape(contact.fn || this._composeDisplayName(name) || 'Contact')}`);
    lines.push(
      `N:${this._escape(name.family || '')};${this._escape(name.given || '')};${this._escape(name.additional || '')};${this._escape(name.prefix || '')};${this._escape(name.suffix || '')}`,
    );
    if (contact.isCompany) lines.push('X-ABSHOWAS:COMPANY');
    if (contact.org) lines.push(`ORG:${this._escape(contact.org)}`);
    if (contact.title) lines.push(`TITLE:${this._escape(contact.title)}`);

    // Non-system tags (markdown / in-app) → standard CATEGORIES so they aren't
    // dropped on export. 'company' is already represented by X-ABSHOWAS.
    const categories = (contact.tags || []).filter((tag) => tag && tag !== 'company');
    if (categories.length) {
      lines.push(`CATEGORIES:${categories.map((tag) => this._escape(tag)).join(',')}`);
    }

    // Emit a contact field as a plain line, or — when it has an Apple custom
    // label — as an item group with an X-ABLabel. itemIndex is shared with the
    // anniversary/relationship groups below.
    let itemIndex = 1;
    const pushLabeled = (prop, params, value, label) => {
      if (label) {
        lines.push(`item${itemIndex}.${prop}${params}:${value}`);
        lines.push(`item${itemIndex}.X-ABLabel:${this._wrapLabel(label)}`);
        itemIndex += 1;
      } else {
        lines.push(`${prop}${params}:${value}`);
      }
    };

    for (const email of contact.emails || []) {
      if (email?.value)
        pushLabeled('EMAIL', this._typeParams(email.types), this._escape(email.value), email.label);
    }
    for (const phone of contact.phones || []) {
      if (phone?.value)
        pushLabeled('TEL', this._typeParams(phone.types), this._escape(phone.value), phone.label);
    }
    for (const address of contact.addresses || []) {
      if (!address) continue;
      const hasAddress =
        address.pobox ||
        address.ext ||
        address.street ||
        address.city ||
        address.state ||
        address.zip ||
        address.country;
      if (!hasAddress) continue;
      const value = `${this._escape(address.pobox || '')};${this._escape(address.ext || '')};${this._escape(address.street || '')};${this._escape(address.city || '')};${this._escape(address.state || '')};${this._escape(address.zip || '')};${this._escape(address.country || '')}`;
      pushLabeled('ADR', this._typeParams(address.types), value, address.label);
    }
    for (const urlEntry of contact.urls || []) {
      const value = typeof urlEntry === 'string' ? urlEntry : urlEntry?.value;
      const types = typeof urlEntry === 'string' ? [] : urlEntry?.types;
      const label = typeof urlEntry === 'string' ? '' : urlEntry?.label;
      if (value) pushLabeled('URL', this._typeParams(types), this._escape(value), label);
    }
    for (const im of contact.ims || []) {
      if (!im?.value) continue;
      const svc = im.service ? `;X-SERVICE-TYPE=${im.service}` : '';
      pushLabeled('IMPP', svc + this._typeParams(im.types || []), this._escape(im.value), im.label);
    }
    for (const sp of contact.socialProfiles || []) {
      if (!sp?.url) continue;
      let params = '';
      if (sp.service) params += `;TYPE=${sp.service}`;
      if (sp.username) params += `;X-USER=${sp.username}`;
      pushLabeled('X-SOCIALPROFILE', params, this._escape(sp.url), sp.label);
    }
    if (contact.birthday) lines.push(`BDAY:${this._escape(contact.birthday)}`);
    for (const note of contact.notes || []) {
      if (note) lines.push(`NOTE:${this._escape(note)}`);
    }

    if (contact.anniversary) {
      lines.push(`item${itemIndex}.X-ABDATE:${this._escape(contact.anniversary)}`);
      lines.push(`item${itemIndex}.X-ABLabel:_$!<Anniversary>!$_`);
      itemIndex += 1;
    }
    for (const dateEntry of contact.dates || []) {
      if (!dateEntry?.value) continue;
      lines.push(`item${itemIndex}.X-ABDATE:${this._escape(dateEntry.value)}`);
      lines.push(`item${itemIndex}.X-ABLabel:${this._wrapLabel(dateEntry.label || 'Date')}`);
      itemIndex += 1;
    }
    for (const rel of contact.related || []) {
      if (!rel?.name) continue;
      lines.push(`item${itemIndex}.X-ABRELATEDNAMES:${this._escape(rel.name)}`);
      lines.push(
        `item${itemIndex}.X-ABLabel:${this._relationshipLabel(rel.type || rel.rawType || 'related')}`,
      );
      itemIndex += 1;
    }

    // Preserve format-neutral custom fields so non-vCard-origin contacts
    // (e.g. Markdown imports) don't silently lose data on vCard export. The
    // markdown body is already carried as NOTE, so it's skipped here. These
    // are read back by VCFParser's X-CONSTELLATION-FIELD case.
    const customFields = contact.customFields || contact.record?.fields || {};
    for (const [key, field] of Object.entries(customFields)) {
      if (key === 'markdown_body') continue;
      const payload = JSON.stringify({ key, type: field?.type, value: field?.value });
      lines.push(`X-CONSTELLATION-FIELD:${this._escape(payload)}`);
    }

    lines.push('END:VCARD');
    return typeof VCardUtils !== 'undefined' ? VCardUtils.foldLines(lines) : lines.join('\r\n');
  }

  _escape(value) {
    return typeof VCardUtils !== 'undefined'
      ? VCardUtils.encodeValue(value)
      : String(value || '')
          .replace(/\\/g, '\\\\')
          .replace(/\n/g, '\\n')
          .replace(/;/g, '\\;')
          .replace(/,/g, '\\,');
  }

  _typeParams(types = []) {
    return typeof VCardUtils !== 'undefined' ? VCardUtils.buildTypeParams(types) : '';
  }

  _wrapLabel(label) {
    return `_$!<${this._escape(label)}>!$_`;
  }

  _relationshipLabel(type) {
    const raw = String(type || 'related').trim();
    if (/^_\$!<.+>!\$_$/.test(raw)) return raw;
    const friendly =
      raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) || 'Related';
    return `_$!<${this._escape(friendly)}>!$_`;
  }

  _composeDisplayName(name = {}) {
    return [name.prefix, name.given, name.additional, name.family, name.suffix]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
