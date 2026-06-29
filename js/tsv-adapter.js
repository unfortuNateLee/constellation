import { ContactRecord } from './contact-record.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';

/**
 * TSV (tab-separated) contact adapter — a flat, spreadsheet-friendly format for
 * bulk editing. One contact per row; the header row names the columns (see
 * COLUMNS for the order). Multi-valued fields (emails, phones, urls,
 * relationships) are a `' | '`-joined list where each item may carry a type in
 * brackets, e.g. `[home] jane@x.com | [work] jane@y.com`. A single address is
 * spread across street/city/state/zip/country/address_type columns.
 *
 * TSV is intentionally simplified (one address, a single type per value, no
 * photo) — vCard / Markdown remain the lossless formats.
 */
export class TsvAdapter {
  constructor() {
    this.id = 'tsv';
    this.label = 'TSV';
    this.extensions = ['tsv'];
    this.mimeType = 'text/tab-separated-values;charset=utf-8';
    // Header order = the order columns must be provided in.
    this.COLUMNS = [
      'uid',
      'prefix',
      'first',
      'middle',
      'last',
      'suffix',
      'display_name',
      'organization',
      'title',
      'is_company',
      'emails',
      'phones',
      'street',
      'city',
      'state',
      'zip',
      'country',
      'address_type',
      'birthday',
      'anniversary',
      'urls',
      'relationships',
      'tags',
      'notes',
    ];
  }

  canImportFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return this.extensions.some((ext) => name.endsWith(`.${ext}`));
  }

  // ── Import ──────────────────────────────────────────────────────
  parse(text, options = {}) {
    const lines = String(text || '')
      .replace(/^\uFEFF/, '')
      .split(/\r\n|\n/);
    let h = 0;
    while (h < lines.length && !lines[h].trim()) h += 1;
    if (h >= lines.length) return [];

    const headers = lines[h].split('\t').map((name) => name.trim().toLowerCase());
    const contacts = [];
    const idContext = { usedIds: new Set(), basisCounts: new Map() };
    for (let i = h + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try {
        const cells = lines[i].split('\t');
        const row = {};
        headers.forEach((name, idx) => {
          row[name] = this._unescape(cells[idx] ?? '');
        });
        const index = (options.startIndex != null ? options.startIndex : 0) + contacts.length;
        contacts.push(this._contactFromRow(row, index, idContext));
      } catch (err) {
        console.warn(`[TsvAdapter] Skipping malformed row ${i}: ${err.message}`);
      }
    }
    return contacts;
  }

  _contactFromRow(row, index, idContext) {
    const contact = ContactRecord.createEmptyContact();
    contact.uid = row.uid || null;
    contact.name = {
      prefix: row.prefix || '',
      given: row.first || '',
      additional: row.middle || '',
      family: row.last || '',
      suffix: row.suffix || '',
    };
    contact.fn = row.display_name || this._composeDisplayName(contact.name) || row.uid || 'Contact';
    contact.org = row.organization || '';
    contact.title = row.title || '';
    contact.isCompany = /^(true|yes|1)$/i.test(row.is_company || '');
    contact.emails = this._parseTypedList(row.emails).map((e) => ({
      value: e.value,
      types: e.types,
    }));
    contact.phones = this._parseTypedList(row.phones).map((e) => ({
      value: e.value,
      types: e.types,
    }));
    contact.urls = this._parseTypedList(row.urls).map((e) => ({ value: e.value, types: e.types }));
    contact.related = this._parseTypedList(row.relationships).map((e) => {
      const type = RelationshipTaxonomy.normalize(e.types[0] ? e.types[0].toLowerCase() : '');
      return { name: e.value, type, rawType: RelationshipTaxonomy.vcardLabel(type) };
    });
    const address = this._addressFromRow(row);
    if (address) contact.addresses = [address];
    contact.birthday = row.birthday || null;
    contact.anniversary = row.anniversary || null;
    // Multiple notes are joined with a blank line on export (see serialize); split
    // them back so N notes round-trip. A single note with internal newlines stays
    // intact (only a blank-line separator splits).
    contact.notes = row.notes ? row.notes.split('\n\n') : [];
    contact.tags = (row.tags || '')
      .split('|')
      .map((t) => t.trim())
      .filter(Boolean);
    contact.noteTags = this._extractHashtags(contact.notes);
    if (!contact.tags.length && contact.isCompany) contact.tags = ['company'];

    this._assignId(contact, idContext);
    ContactRecord.refreshLegacyContact(contact, { format: this.id, raw: '', index });
    return contact;
  }

  _addressFromRow(row) {
    const hasAddress = row.street || row.city || row.state || row.zip || row.country;
    if (!hasAddress) return null;
    return {
      pobox: '',
      ext: '',
      street: row.street || '',
      city: row.city || '',
      state: row.state || '',
      zip: row.zip || '',
      country: row.country || '',
      types: row.address_type ? [row.address_type.toUpperCase()] : [],
    };
  }

  // ── Export ──────────────────────────────────────────────────────
  serialize(contacts, ids = null) {
    const selectedIds = ids ? new Set(ids) : null;
    const selected = (contacts || []).filter(
      (contact) => !selectedIds || selectedIds.has(contact.id),
    );
    const rows = selected.map((contact) => this._rowFor(contact));
    return [this.COLUMNS.join('\t'), ...rows].join('\n') + '\n';
  }

  exportBlob(contacts, ids = null) {
    const content = this.serialize(contacts, ids);
    return new Blob([content], { type: this.mimeType });
  }

  /** Header row plus one example row showing the expected format. */
  templateText() {
    const example = {
      uid: '',
      prefix: 'Dr.',
      first: 'Jane',
      middle: 'Q.',
      last: 'Doe',
      suffix: 'PhD',
      display_name: 'Dr. Jane Q. Doe',
      organization: 'Example Labs',
      title: 'Principal',
      is_company: 'FALSE',
      emails: '[home] jane@example.com | [work] jane@work.example',
      phones: '[cell] 555-0100 | [home] 555-0101',
      street: '123 Main St',
      city: 'Springfield',
      state: 'CA',
      zip: '90210',
      country: 'USA',
      address_type: 'home',
      birthday: '1990-04-15',
      anniversary: '2015-06-20',
      urls: '[work] https://example.com/jane',
      relationships: '[spouse] John Doe | [child] Sam Doe',
      tags: 'vip | lead',
      notes: 'Met at the conference. #vip',
    };
    const exampleRow = this.COLUMNS.map((col) => this._escape(example[col] ?? '')).join('\t');
    return `${this.COLUMNS.join('\t')}\n${exampleRow}\n`;
  }

  _rowFor(contact) {
    const name = contact.name || {};
    const addr = this._preferredAddress(contact.addresses || []);
    const cell = {
      uid: contact.uid || '',
      prefix: name.prefix || '',
      first: name.given || '',
      middle: name.additional || '',
      last: name.family || '',
      suffix: name.suffix || '',
      display_name: contact.fn || '',
      organization: contact.org || '',
      title: contact.title || '',
      is_company: contact.isCompany ? 'TRUE' : 'FALSE',
      emails: this._formatTypedList(contact.emails),
      phones: this._formatTypedList(contact.phones),
      street: addr.street || '',
      city: addr.city || '',
      state: addr.state || '',
      zip: addr.zip || '',
      country: addr.country || '',
      address_type: this._primaryType(addr.types),
      birthday: contact.birthday || '',
      anniversary: contact.anniversary || '',
      urls: this._formatTypedList(contact.urls),
      relationships: (contact.related || [])
        .filter((r) => r && r.name)
        .map((r) => (r.type ? `[${r.type}] ${r.name}` : r.name))
        .join(' | '),
      tags: (contact.tags || []).join(' | '),
      // Blank-line separator so multiple notes survive the round-trip (a single
      // note keeps its own internal newlines).
      notes: (contact.notes || []).join('\n\n'),
    };
    return this.COLUMNS.map((col) => this._escape(cell[col] ?? '')).join('\t');
  }

  // ── Helpers ─────────────────────────────────────────────────────
  _parseTypedList(value) {
    return String(value || '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const m = part.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (m) return { value: m[2].trim(), types: m[1].trim() ? [m[1].trim().toUpperCase()] : [] };
        return { value: part, types: [] };
      })
      .filter((entry) => entry.value);
  }

  _formatTypedList(entries) {
    return (entries || [])
      .map((entry) => {
        const value = typeof entry === 'string' ? entry : entry.value;
        if (!value) return null;
        const type = typeof entry === 'string' ? '' : this._primaryType(entry.types);
        return type ? `[${type}] ${value}` : value;
      })
      .filter(Boolean)
      .join(' | ');
  }

  // Pick the human-meaningful label from a vCard type list (skip protocol noise).
  _primaryType(types) {
    for (const type of types || []) {
      const upper = String(type).toUpperCase();
      if (upper === 'INTERNET' || upper === 'VOICE' || upper === 'PREF') continue;
      return String(type).toLowerCase();
    }
    return '';
  }

  _preferredAddress(addresses) {
    if (!addresses.length) return {};
    const score = (a) => {
      const types = (a.types || []).map((t) => String(t).toLowerCase());
      if (types.includes('home')) return 0;
      if (types.includes('work')) return 1;
      return 2;
    };
    return [...addresses].sort((a, b) => score(a) - score(b))[0] || {};
  }

  _composeDisplayName(name) {
    return [name.prefix, name.given, name.additional, name.family, name.suffix]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractHashtags(notes) {
    const tags = new Set();
    const pattern = /(^|[\s([{,;])#([A-Za-z0-9][A-Za-z0-9_-]*)/g;
    for (const note of notes || []) {
      let match;
      while ((match = pattern.exec(String(note || ''))) !== null) tags.add(match[2].toLowerCase());
    }
    return Array.from(tags).sort();
  }

  _assignId(contact, idContext) {
    if (idContext) {
      return ContactRecord.assignStableId(contact, idContext.usedIds, idContext.basisCounts);
    }
    contact.id = `c_${ContactRecord._hash(`fn:${contact.fn}`)}`;
    return contact.id;
  }

  // TSV cells can't contain raw tabs / newlines — escape them (and backslash).
  _escape(value) {
    return String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/\r?\n/g, '\\n');
  }

  _unescape(value) {
    const s = String(value ?? '');
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) {
        const next = s[++i];
        out += next === 't' ? '\t' : next === 'n' ? '\n' : next;
      } else {
        out += c;
      }
    }
    return out;
  }
}
