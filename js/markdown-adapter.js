/**
 * Markdown contact adapter — human-readable, hand-editable Markdown.
 *
 * Each contact is an `##` heading: simple identity fields as a bullet list under
 * the name, each multi-value field group as its own `###` section, with a uniform
 * `- **<label>:** <value>` line for every entry. A bundle is just several `##`
 * contacts in one file (an optional `# Title` H1 is ignored). Designed to read and
 * edit cleanly while round-tripping; the vCard adapter remains the byte-exact path.
 */
import { ContactRecord } from './contact-record.js';
import { VCFParser } from './vcf-parser.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';
import { typesToLabel, labelToTypes } from './contact-types.js';

// Identity bullets shown under the name, in order: [display label, contact key].
// `name.*` keys are projected to/from the structured name object.
const IDENTITY_FIELDS = [
  ['UID', 'uid'],
  ['First Name', 'name.given'],
  ['Middle Name', 'name.additional'],
  ['Last Name', 'name.family'],
  ['Prefix', 'name.prefix'],
  ['Suffix', 'name.suffix'],
  ['Nickname', 'nickname'],
  ['Maiden Name', 'maidenName'],
  ['Phonetic First', 'phoneticFirst'],
  ['Phonetic Last', 'phoneticLast'],
  ['Organization', 'org'],
  ['Department', 'department'],
  ['Phonetic Org', 'phoneticOrg'],
  ['Title', 'title'],
  ['Gender', 'gender'],
];
const IDENTITY_BY_LABEL = new Map(
  IDENTITY_FIELDS.map(([label, key]) => [label.toLowerCase(), key]),
);

// Human-readable gender labels in Markdown; stored as vCard sex codes ('M'/'F').
const GENDER_TO_LABEL = { M: 'Male', F: 'Female' };
const GENDER_FROM_LABEL = { male: 'M', m: 'M', female: 'F', f: 'F' };

// IM service → URI scheme, to reconstruct the stored value from a readable handle.
const IM_SCHEMES = {
  skype: 'skype:',
  jabber: 'xmpp:',
  googletalk: 'xmpp:',
  'google talk': 'xmpp:',
  facebook: 'xmpp:',
  aim: 'aim:',
  icq: 'aim:',
  yahoo: 'ymsgr:',
  msn: 'msnim:',
  qq: 'x-apple:',
  gadugadu: 'x-apple:',
};

const RESERVED_DATE_LABELS = {
  birthday: 'birthday',
  anniversary: 'anniversary',
  'alternate birthday': 'altBirthday',
};

export class MarkdownAdapter {
  constructor() {
    this.id = 'markdown';
    this.label = 'Markdown';
    this.extensions = ['md', 'markdown'];
    this.mimeType = 'text/markdown;charset=utf-8';
  }

  canImportFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return this.extensions.some((ext) => name.endsWith(`.${ext}`));
  }

  // ── Parse ──────────────────────────────────────────────────────

  parse(text, options = {}) {
    const blocks = this._splitContacts(text);
    const contacts = [];
    const idContext = { usedIds: new Set(), basisCounts: new Map() };
    for (let i = 0; i < blocks.length; i++) {
      try {
        const contact = this._parseContactBlock(
          blocks[i],
          {
            index: options.startIndex != null ? options.startIndex + i : i,
            photoMap: options.photoMap || null,
          },
          idContext,
        );
        if (contact) contacts.push(contact);
      } catch (err) {
        console.warn(`[MarkdownAdapter] Skipping malformed contact at index ${i}: ${err.message}`);
      }
    }
    return contacts;
  }

  /** Split a document into per-contact blocks at each `## ` heading. */
  _splitContacts(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const lines = source.split(/\r?\n/);
    const blocks = [];
    let cur = null;
    for (const line of lines) {
      if (/^##\s+/.test(line)) {
        if (cur) blocks.push(cur.join('\n'));
        cur = [line];
      } else if (cur) {
        cur.push(line);
      }
      // lines before the first `## ` (e.g. a `# Title`) are ignored
    }
    if (cur) blocks.push(cur.join('\n'));
    return blocks;
  }

  _parseContactBlock(block, source, idContext) {
    const lines = block.split(/\r?\n/);
    const fn = (lines[0].match(/^##\s+(.*)$/)?.[1] || '').trim();
    if (!fn) return null;

    // Group the body into the intro (identity bullets) + named `###` sections.
    const intro = [];
    const sections = [];
    let current = null;
    for (let i = 1; i < lines.length; i++) {
      const h3 = lines[i].match(/^###\s+(.*)$/);
      if (h3) {
        current = { name: h3[1].trim().toLowerCase(), lines: [] };
        sections.push(current);
      } else if (current) {
        current.lines.push(lines[i]);
      } else {
        intro.push(lines[i]);
      }
    }

    const contact = ContactRecord.createEmptyContact();
    contact.fn = fn;
    const customFields = {};

    // Identity bullets.
    let uid = null;
    let sawNameBullet = false;
    for (const line of intro) {
      const m = line.match(/^-\s+\*\*(.+?):\*\*\s?(.*)$/);
      if (!m) continue;
      const label = m[1].trim();
      const value = m[2].trim();
      const key = IDENTITY_BY_LABEL.get(label.toLowerCase());
      if (label.toLowerCase() === 'company') {
        contact.isCompany = /^(yes|true)$/i.test(value);
      } else if (label.toLowerCase() === 'photo') {
        contact.photo = this._resolveImportedPhoto(value, source.photoMap);
        contact._photoRef = value;
      } else if (key === 'uid') {
        uid = value || null;
      } else if (key && key.startsWith('name.')) {
        contact.name[key.slice(5)] = value;
        sawNameBullet = true;
      } else if (key === 'gender') {
        contact.gender = GENDER_FROM_LABEL[value.toLowerCase()] || '';
      } else if (key) {
        contact[key] = value;
      } else if (value) {
        // Unknown identity bullet → preserve as a custom field.
        customFields[label] = { type: 'string', value };
      }
    }
    contact.uid = uid;
    if (!sawNameBullet) contact.name = this._namePartsFromDisplayName(fn);

    // Sections.
    for (const section of sections) {
      switch (section.name) {
        case 'email':
          contact.emails = this._parseMethodSection('email', section.lines);
          break;
        case 'phone':
        case 'phones':
          contact.phones = this._parseMethodSection('phone', section.lines);
          break;
        case 'website':
        case 'websites':
        case 'url':
        case 'urls':
          contact.urls = this._parseMethodSection('url', section.lines);
          break;
        case 'address':
        case 'addresses':
          contact.addresses = this._parseAddressSection(section.lines);
          break;
        case 'instant messages':
        case 'ims':
        case 'im':
          contact.ims = this._parseImSection(section.lines);
          break;
        case 'social profiles':
        case 'social':
          contact.socialProfiles = this._parseSocialSection(section.lines);
          break;
        case 'dates':
        case 'other dates':
          this._parseDatesSection(section.lines, contact);
          break;
        case 'relationships':
          contact.related = this._parseRelationshipsSection(section.lines);
          break;
        case 'tags':
          contact.tags = this._parseTagsSection(section.lines);
          break;
        case 'notes':
          contact.notes = this._parseNotesSection(section.lines);
          break;
        case 'other fields':
        case 'custom fields':
          Object.assign(customFields, this._parseOtherFieldsSection(section.lines));
          break;
        default:
          break;
      }
    }

    contact.id = this._resolveId(null, { uid, fn }, idContext);
    contact.customFields = customFields;
    contact.rawVCard = '';
    contact._photoUnresolved =
      !contact.photo && typeof contact._photoRef === 'string' && contact._photoRef.length > 0;
    delete contact._photoRef;

    contact.noteTags = this._extractHashtags(contact.notes || []);
    if (!contact.tags.length && contact.isCompany) contact.tags = ['company'];
    ContactRecord.refreshLegacyContact(contact, {
      format: this.id,
      raw: '',
      index: source.index,
    });
    return contact;
  }

  _bulletLines(lines) {
    const out = [];
    for (const line of lines) {
      const m = line.match(/^-\s+\*\*(.+?):\*\*\s?(.*)$/);
      if (m) out.push({ label: m[1].trim(), value: m[2].trim(), raw: line });
    }
    return out;
  }

  _parseMethodSection(kind, lines) {
    const out = [];
    for (const { label, value } of this._bulletLines(lines)) {
      if (!value) continue;
      const { types, label: custom } = labelToTypes(kind, label);
      out.push({ value, types, label: custom });
    }
    return out;
  }

  _parseAddressSection(lines) {
    const out = [];
    let cur = null;
    const flush = () => {
      if (cur) out.push(this._finishAddress(cur));
      cur = null;
    };
    for (const line of lines) {
      const head = line.match(/^-\s+\*\*(.+?):\*\*\s*$/);
      if (head) {
        flush();
        cur = { ...labelToTypes('address', head[1].trim()), lines: [] };
      } else if (cur && /^\s{2,}\S/.test(line)) {
        cur.lines.push(line.trim());
      }
    }
    flush();
    return out;
  }

  _finishAddress(cur) {
    const addr = {
      pobox: '',
      ext: '',
      street: '',
      city: '',
      state: '',
      zip: '',
      country: '',
      types: cur.types,
      label: cur.label,
    };
    // Block lines are, in order: street(s); a "City, State Zip" line; country.
    // Country = a trailing comma-free line; the city line = the last line with a
    // comma (so a comma in the street stays street); the remainder is street.
    const ls = cur.lines.slice();
    if (ls.length >= 2 && !ls[ls.length - 1].includes(',')) addr.country = ls.pop();
    let cityIdx = -1;
    for (let i = ls.length - 1; i >= 0; i--) {
      if (ls[i].includes(',')) {
        cityIdx = i;
        break;
      }
    }
    if (cityIdx === -1) {
      addr.street = ls.join(', ');
    } else {
      addr.street = ls.slice(0, cityIdx).join(', ');
      const line = ls[cityIdx];
      const comma = line.lastIndexOf(',');
      addr.city = line.slice(0, comma).trim();
      const rest = line.slice(comma + 1).trim();
      const sp = rest.lastIndexOf(' ');
      if (sp !== -1) {
        addr.state = rest.slice(0, sp).trim();
        addr.zip = rest.slice(sp + 1).trim();
      } else {
        addr.state = rest;
      }
    }
    return addr;
  }

  _parseImSection(lines) {
    const out = [];
    for (const { label, value } of this._bulletLines(lines)) {
      if (!value) continue;
      const scheme = IM_SCHEMES[label.toLowerCase()] || '';
      out.push({ value: scheme + value, service: label, types: [], label: '' });
    }
    return out;
  }

  _parseSocialSection(lines) {
    const out = [];
    for (const { label, value } of this._bulletLines(lines)) {
      if (!value) continue;
      out.push({ url: value, service: label, username: '', label: '' });
    }
    return out;
  }

  _parseDatesSection(lines, contact) {
    for (const { label, value } of this._bulletLines(lines)) {
      if (!value) continue;
      const reserved = RESERVED_DATE_LABELS[label.toLowerCase()];
      if (reserved) contact[reserved] = value;
      else contact.dates.push({ label, value });
    }
  }

  _parseRelationshipsSection(lines) {
    const out = [];
    for (const { label, value } of this._bulletLines(lines)) {
      if (!value) continue;
      out.push({ name: value, type: RelationshipTaxonomy.normalize(label) });
    }
    return out;
  }

  _parseTagsSection(lines) {
    const text = lines.join(' ');
    const tags = [];
    for (const m of text.matchAll(/#([\w-]+)/g)) tags.push(m[1]);
    // Also accept a bare comma list without '#'.
    if (!tags.length) {
      for (const part of text
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)) {
        tags.push(part.replace(/^#/, ''));
      }
    }
    return [...new Set(tags)];
  }

  _parseNotesSection(lines) {
    const text = lines.join('\n').trim();
    if (!text) return [];
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  _parseOtherFieldsSection(lines) {
    const fields = {};
    let i = 0;
    while (i < lines.length) {
      const m = lines[i].match(/^-\s+\*\*(.+?):\*\*\s?(.*)$/);
      if (!m) {
        i += 1;
        continue;
      }
      const key = m[1].trim();
      const inline = m[2].trim();
      i += 1;

      if (!inline && /^\s*```/.test(lines[i] || '')) {
        // Fenced ```json block → the verbatim {type, value} envelope.
        i += 1; // opening fence
        const json = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) json.push(lines[i++]);
        if (i < lines.length) i += 1; // closing fence
        try {
          fields[key] = this._normalizeField(JSON.parse(json.join('\n')));
        } catch {
          fields[key] = { type: 'string', value: json.join('\n') };
        }
        continue;
      }

      if (!inline && /^\s{2,}-\s+/.test(lines[i] || '')) {
        // Sub-bullet list.
        const items = [];
        while (i < lines.length && /^\s{2,}-\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s{2,}-\s+/, '').trim());
          i += 1;
        }
        fields[key] = { type: 'list', value: items.map((v) => this._coerceScalar(v)) };
        continue;
      }

      fields[key] = { type: this._inferScalarType(inline), value: this._coerceScalar(inline) };
    }
    return fields;
  }

  _normalizeField(parsed) {
    if (parsed && typeof parsed === 'object' && 'type' in parsed && 'value' in parsed)
      return parsed;
    return { type: Array.isArray(parsed) ? 'list' : typeof parsed, value: parsed };
  }

  _inferScalarType(raw) {
    if (/^(true|false)$/i.test(raw)) return 'boolean';
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return 'number';
    return 'string';
  }

  _coerceScalar(raw) {
    if (/^true$/i.test(raw)) return true;
    if (/^false$/i.test(raw)) return false;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }

  // ── Serialize ──────────────────────────────────────────────────

  serialize(contacts, ids = null) {
    const selectedIds = ids ? new Set(ids) : null;
    const selected = (contacts || []).filter((c) => !selectedIds || selectedIds.has(c.id));
    if (selected.length === 0) return '';
    return `${selected.map((c) => this._serializeContact(c)).join('\n\n')}\n`;
  }

  exportBlob(contacts, ids = null) {
    const content = this.serialize(contacts, ids);
    if (!content) return null;
    return new Blob([content], { type: this.mimeType });
  }

  /**
   * Serialize the selected contacts to one Markdown document, externalizing each
   * embedded photo to a sibling image filename referenced from the contact (so the
   * markdown stays clean). Returns { markdown, images } for the caller to bundle.
   */
  serializeBundle(contacts, ids = null) {
    const selectedIds = ids ? new Set(ids) : null;
    const selected = (contacts || []).filter((c) => !selectedIds || selectedIds.has(c.id));
    if (selected.length === 0) return { markdown: '', images: [] };

    const usedNames = new Set();
    const images = [];
    const docs = selected.map((contact) => {
      const image = this._photoImage(contact);
      let photoOverride;
      if (image) {
        const slug = this._slugFor(contact);
        let name = `${slug}.${image.ext}`;
        let i = 2;
        while (usedNames.has(name)) name = `${slug}-${i++}.${image.ext}`;
        usedNames.add(name);
        images.push({ name, dataUrl: image.dataUrl });
        photoOverride = name;
      }
      return this._serializeContact(contact, { photoOverride });
    });

    return { markdown: `${docs.join('\n\n')}\n`, images };
  }

  _serializeContact(contact, options = {}) {
    const lines = [`## ${contact.fn || 'Contact'}`, ''];

    const name = contact.name || {};
    const idBullets = [];
    if (contact.uid) idBullets.push(['UID', contact.uid]);
    for (const [label, key] of IDENTITY_FIELDS) {
      if (key === 'uid') continue;
      let value = key.startsWith('name.') ? name[key.slice(5)] : contact[key];
      if (key === 'gender') value = GENDER_TO_LABEL[value] || ''; // 'M'/'F' → Male/Female
      if (value) idBullets.push([label, value]);
    }
    if (contact.isCompany) idBullets.push(['Company', 'Yes']);
    const photoVal =
      options.photoOverride || (typeof contact.photo === 'string' ? contact.photo : '');
    if (photoVal) idBullets.push(['Photo', photoVal]);
    for (const [label, value] of idBullets) lines.push(`- **${label}:** ${value}`);

    this._emitMethodSection(lines, 'Email', 'email', contact.emails, (e) => e.value);
    this._emitMethodSection(lines, 'Phone', 'phone', contact.phones, (e) => e.value);
    this._emitMethodSection(lines, 'Website', 'url', contact.urls, (e) =>
      typeof e === 'string' ? e : e.value,
    );
    this._emitAddressSection(lines, contact.addresses);
    this._emitImSection(lines, contact.ims);
    this._emitSocialSection(lines, contact.socialProfiles);
    this._emitDatesSection(lines, contact);
    this._emitRelationshipsSection(lines, contact.related);
    this._emitTagsSection(lines, contact.tags);
    this._emitNotesSection(lines, contact.notes);
    this._emitOtherFieldsSection(lines, contact.customFields);

    return lines.join('\n').replace(/\n+$/, '');
  }

  _emitMethodSection(lines, heading, kind, entries, getValue) {
    const items = [];
    for (const e of entries || []) {
      const value = getValue(e);
      if (!value) continue;
      const entry = typeof e === 'string' ? { value: e, types: [], label: '' } : e;
      const label = typesToLabel(kind, entry.types || [], entry.label || '') || 'Other';
      items.push(`- **${label}:** ${value}`);
    }
    if (items.length) lines.push('', `### ${heading}`, ...items);
  }

  _emitAddressSection(lines, addresses) {
    const addrs = (addresses || []).filter(
      (a) => a && (a.street || a.city || a.state || a.zip || a.country),
    );
    if (!addrs.length) return;
    lines.push('', '### Address');
    for (const a of addrs) {
      const label = typesToLabel('address', a.types || [], a.label || '') || 'Other';
      lines.push(`- **${label}:**`);
      if (a.street) lines.push(`  ${a.street}`);
      const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ');
      if (cityLine) lines.push(`  ${cityLine}`);
      if (a.country) lines.push(`  ${a.country}`);
    }
  }

  _emitImSection(lines, ims) {
    const items = [];
    for (const im of ims || []) {
      if (!im || !im.value) continue;
      const label = im.service || im.label || 'IM';
      items.push(`- **${label}:** ${this._stripScheme(im.value)}`);
    }
    if (items.length) lines.push('', '### Instant Messages', ...items);
  }

  _emitSocialSection(lines, profiles) {
    const items = [];
    for (const sp of profiles || []) {
      if (!sp || !sp.url) continue;
      const label = sp.service || sp.label || 'Profile';
      const value = /^https?:/i.test(sp.url) ? sp.url : this._stripScheme(sp.url) || sp.url;
      items.push(`- **${label}:** ${value}`);
    }
    if (items.length) lines.push('', '### Social Profiles', ...items);
  }

  _emitDatesSection(lines, contact) {
    const items = [];
    if (contact.birthday) items.push(`- **Birthday:** ${contact.birthday}`);
    if (contact.anniversary) items.push(`- **Anniversary:** ${contact.anniversary}`);
    if (contact.altBirthday) items.push(`- **Alternate Birthday:** ${contact.altBirthday}`);
    for (const d of contact.dates || []) {
      if (d && d.value) items.push(`- **${d.label || 'Date'}:** ${d.value}`);
    }
    if (items.length) lines.push('', '### Dates', ...items);
  }

  _emitRelationshipsSection(lines, related) {
    const items = [];
    for (const rel of related || []) {
      if (!rel || !rel.name) continue;
      items.push(`- **${RelationshipTaxonomy.label(rel.type)}:** ${rel.name}`);
    }
    if (items.length) lines.push('', '### Relationships', ...items);
  }

  _emitTagsSection(lines, tags) {
    const derived = new Set(['company', 'virtual', 'other']);
    const user = (tags || []).filter((t) => t && !derived.has(t));
    if (user.length) lines.push('', '### Tags', user.map((t) => `#${t}`).join(', '));
  }

  _emitNotesSection(lines, notes) {
    const text = (notes || []).filter(Boolean).join('\n\n').trim();
    if (text) lines.push('', '### Notes', text);
  }

  _emitOtherFieldsSection(lines, customFields) {
    const entries = Object.entries(customFields || {}).filter(([key]) => key !== 'markdown_body');
    if (!entries.length) return;
    const body = [];
    for (const [key, raw] of entries) {
      const field = this._normalizeField(raw);
      const value = field.value;
      if (Array.isArray(value) && value.every((v) => v == null || typeof v !== 'object')) {
        body.push(`- **${key}:**`);
        for (const item of value) body.push(`  - ${item}`);
      } else if (value != null && typeof value === 'object') {
        // Nested/complex → a visible, verbatim JSON block.
        body.push(`- **${key}:**`);
        body.push('  ```json');
        for (const l of JSON.stringify(field, null, 2).split('\n')) body.push(`  ${l}`);
        body.push('  ```');
      } else {
        body.push(`- **${key}:** ${this._formatScalarValue(value)}`);
      }
    }
    if (body.length) lines.push('', '### Other Fields', ...body);
  }

  _formatScalarValue(value) {
    if (value == null) return '';
    return String(value);
  }

  _stripScheme(value) {
    const str = String(value || '');
    const m = str.match(/^([a-z][a-z0-9.+-]*:)(.*)$/i);
    if (!m || /^https?:/i.test(m[1])) return str;
    return m[2];
  }

  // ── Shared helpers (unchanged behavior) ────────────────────────

  _photoImage(contact) {
    const photo = contact?.photo;
    if (typeof photo !== 'string' || !photo.startsWith('data:image/')) return null;
    const match = photo.match(/^data:image\/([a-z0-9.+-]+)/i);
    const subtype = (match && match[1] ? match[1] : 'jpeg').toLowerCase();
    const ext = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/g, '') || 'img';
    return { ext, dataUrl: photo };
  }

  _slugFor(contact) {
    const base = String(contact?.fn || contact?.uid || 'contact')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base || 'contact';
  }

  _resolveImportedPhoto(photo, photoMap = null) {
    if (typeof photo !== 'string' || !photo) return null;
    if (photo.startsWith('data:')) return photo;
    if (photoMap) {
      const key = photo.toLowerCase();
      if (photoMap[key]) return photoMap[key];
    }
    return null;
  }

  _array(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  _extractHashtags(notes = []) {
    return new VCFParser()._extractHashtags(notes);
  }

  _namePartsFromDisplayName(displayName) {
    const parts = String(displayName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0)
      return { family: '', given: '', additional: '', prefix: '', suffix: '' };
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

  _resolveId(providedId, basisContact, idContext) {
    if (providedId) {
      if (idContext) idContext.usedIds.add(providedId);
      return providedId;
    }
    if (idContext && ContactRecord.assignStableId) {
      return ContactRecord.assignStableId(basisContact, idContext.usedIds, idContext.basisCounts);
    }
    return this._generateId();
  }

  _generateId() {
    return `c_${Math.random().toString(36).substring(2, 11)}`;
  }
}
