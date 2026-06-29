/**
 * Markdown contact adapter.
 *
 * Uses YAML-style frontmatter for structured contact data and preserves the
 * Markdown body as a typed custom field. This parser intentionally supports the
 * practical YAML subset the app writes: maps, nested maps, arrays, arrays of
 * maps, quoted strings, numbers, booleans, and null.
 */
import { ContactRecord } from './contact-record.js';
import { VCFParser } from './vcf-parser.js';

export class MarkdownAdapter {
  constructor() {
    this.id = 'markdown';
    this.label = 'Markdown';
    this.extensions = ['md', 'markdown'];
    this.mimeType = 'text/markdown;charset=utf-8';
    this.bundleDelimiter = '<!-- CONSTELLATION:CONTACT -->';
  }

  canImportFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return this.extensions.some((ext) => name.endsWith(`.${ext}`));
  }

  parse(text, options = {}) {
    const docs = this._splitDocuments(text);
    const contacts = [];
    // Per-parse accumulators for deterministic, collision-free ids.
    const idContext = { usedIds: new Set(), basisCounts: new Map() };
    for (let i = 0; i < docs.length; i++) {
      // Isolate malformed documents: a single bad contact is skipped with a
      // warning instead of aborting the whole import.
      try {
        const parsed = this._parseDocument(docs[i]);
        if (!parsed) continue;
        contacts.push(
          this._contactFromDocument(
            parsed.data,
            parsed.body,
            {
              raw: docs[i],
              index: options.startIndex != null ? options.startIndex + i : i,
            },
            idContext,
          ),
        );
      } catch (err) {
        console.warn(`[MarkdownAdapter] Skipping malformed contact at index ${i}: ${err.message}`);
      }
    }
    return contacts;
  }

  serialize(contacts, ids = null) {
    const selectedIds = ids ? new Set(ids) : null;
    const selected = (contacts || []).filter(
      (contact) => !selectedIds || selectedIds.has(contact.id),
    );
    if (selected.length === 0) return '';
    const docs = selected.map((contact) => this._serializeContact(contact));
    if (docs.length === 1) return `${docs[0]}\n`;
    return `${docs.map((doc) => `${this.bundleDelimiter}\n\n${doc}`).join('\n\n')}\n`;
  }

  exportBlob(contacts, ids = null) {
    const content = this.serialize(contacts, ids);
    if (!content) return null;
    return new Blob([content], { type: this.mimeType });
  }

  _splitDocuments(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    if (!source.includes(this.bundleDelimiter)) return [source];
    return source
      .split(this.bundleDelimiter)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  _parseDocument(text) {
    const source = String(text || '').trim();
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
    if (!match) return null;
    return {
      data: this._parseYaml(match[1]),
      body: match[2] || '',
    };
  }

  _contactFromDocument(data, body, source, idContext = null) {
    // Document-level keys handled explicitly; the rest of the standard contact
    // shape comes from the single ContactRecord field registry.
    const known = new Set([
      'constellation',
      'id',
      'uid',
      'fields',
      ...ContactRecord.STANDARD_FIELDS.map((field) => field.key),
    ]);
    const customFields = this._normalizeFields(data.fields || {});
    for (const [key, value] of Object.entries(data)) {
      if (!known.has(key)) customFields[key] = this._typedField(value);
    }
    const bodyText = String(body || '').trimEnd();
    if (bodyText) {
      customFields.markdown_body = { type: 'markdown', value: bodyText };
    }

    const fn = String(
      data.fn || data.name?.display || data.name?.given || data.uid || 'Markdown Contact',
    );
    const uid = data.uid || null;
    const contact = {
      id: this._resolveId(data.id, { uid, fn }, idContext),
      uid,
      fn,
      name: {
        family: data.name?.family || '',
        given: data.name?.given || '',
        additional: data.name?.additional || '',
        prefix: data.name?.prefix || '',
        suffix: data.name?.suffix || '',
      },
      org: data.org || '',
      title: data.title || '',
      isCompany: data.isCompany === true,
      emails: this._array(data.emails),
      phones: this._array(data.phones),
      addresses: this._array(data.addresses),
      birthday: data.birthday || null,
      anniversary: data.anniversary || null,
      dates: this._array(data.dates),
      ims: this._array(data.ims),
      socialProfiles: this._array(data.socialProfiles),
      notes: this._notes(data.notes, bodyText),
      related: this._array(data.related),
      urls: this._array(data.urls),
      photo: this._resolveImportedPhoto(data.photo),
      tags: this._array(data.tags),
      noteTags: [],
      customFields,
      rawVCard: '',
    };

    contact.noteTags = this._extractHashtags(contact.notes);
    if (!contact.tags.length && contact.isCompany) contact.tags = ['company'];
    if (typeof ContactRecord !== 'undefined') {
      ContactRecord.refreshLegacyContact(contact, {
        format: this.id,
        raw: source.raw || '',
        index: source.index,
      });
    }
    return contact;
  }

  _serializeContact(contact, options = {}) {
    const fields = { ...(contact.customFields || contact.record?.fields || {}) };
    const body = fields.markdown_body?.value || (contact.notes || []).join('\n\n');
    delete fields.markdown_body;

    const data = {
      constellation: 1,
      id: contact.id || '',
      uid: contact.uid || null,
      fn: contact.fn || '',
      name: contact.name || {},
      org: contact.org || '',
      title: contact.title || '',
      isCompany: !!contact.isCompany,
      emails: contact.emails || [],
      phones: contact.phones || [],
      addresses: contact.addresses || [],
      birthday: contact.birthday || null,
      anniversary: contact.anniversary || null,
      dates: contact.dates || [],
      ims: contact.ims || [],
      socialProfiles: contact.socialProfiles || [],
      notes: contact.notes || [],
      related: contact.related || [],
      urls: contact.urls || [],
      // photoOverride (a filename) is used when exporting a bundle that writes
      // the image to a sibling file; otherwise the photo is embedded inline.
      photo: options.photoOverride || contact.photo || null,
      tags: contact.tags || [],
      noteTags: contact.noteTags || [],
      fields,
    };

    const frontmatter = this._stringifyYaml(this._dropEmpty(data));
    return `---\n${frontmatter}---\n${String(body || '').trimEnd()}`;
  }

  /**
   * Serialize the selected contacts to one Markdown document, but externalize
   * embedded photos: each photo becomes a human-readable, unique image filename
   * referenced from the frontmatter, returned alongside the markdown for the
   * caller to bundle (e.g. into a .zip). Contacts without a photo are unaffected.
   *
   * @returns {{ markdown: string, images: Array<{name: string, dataUrl: string}> }}
   */
  serializeBundle(contacts, ids = null) {
    const selectedIds = ids ? new Set(ids) : null;
    const selected = (contacts || []).filter(
      (contact) => !selectedIds || selectedIds.has(contact.id),
    );
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

    const markdown =
      docs.length === 1
        ? `${docs[0]}\n`
        : `${docs.map((doc) => `${this.bundleDelimiter}\n\n${doc}`).join('\n\n')}\n`;
    return { markdown, images };
  }

  // A base-64 data-URL photo → { ext, dataUrl }, or null if there's no embedded image.
  _photoImage(contact) {
    const photo = contact?.photo;
    if (typeof photo !== 'string' || !photo.startsWith('data:image/')) return null;
    const match = photo.match(/^data:image\/([a-z0-9.+-]+)/i);
    const subtype = (match && match[1] ? match[1] : 'jpeg').toLowerCase();
    const ext = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/g, '') || 'img';
    return { ext, dataUrl: photo };
  }

  // Human-readable, filesystem-safe slug from the display name (or uid).
  _slugFor(contact) {
    const base = String(contact?.fn || contact?.uid || 'contact')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base || 'contact';
  }

  // Embedded data URLs are used as-is; an externalized filename reference (from a
  // bundle export, with no inline data) is dropped rather than rendered broken.
  _resolveImportedPhoto(photo) {
    return typeof photo === 'string' && photo.startsWith('data:') ? photo : null;
  }

  _parseYaml(text) {
    const lines = String(text || '').split(/\r?\n/);
    const parsed = this._parseBlock(lines, 0, 0);
    return parsed.value && !Array.isArray(parsed.value) ? parsed.value : {};
  }

  _parseBlock(lines, start, indent) {
    let i = this._skipEmpty(lines, start);
    if (i >= lines.length) return { value: {}, next: i };
    const currentIndent = this._indent(lines[i]);
    if (currentIndent < indent) return { value: {}, next: i };
    return lines[i].slice(currentIndent).startsWith('- ')
      ? this._parseSeq(lines, i, currentIndent)
      : this._parseMap(lines, i, currentIndent);
  }

  _parseMap(lines, start, indent) {
    const obj = {};
    let i = start;
    while (i < lines.length) {
      i = this._skipEmpty(lines, i);
      if (i >= lines.length || this._indent(lines[i]) < indent) break;
      if (this._indent(lines[i]) > indent) break;
      const trimmed = lines[i].slice(indent);
      if (trimmed.startsWith('- ')) break;
      const match = trimmed.match(/^([^:]+):(.*)$/);
      if (!match) {
        i += 1;
        continue;
      }
      const key = match[1].trim();
      const rest = match[2].trim();
      if (rest) {
        obj[key] = this._parseScalar(rest);
        i += 1;
      } else {
        const nested = this._parseBlock(lines, i + 1, indent + 2);
        obj[key] = nested.value;
        i = nested.next;
      }
    }
    return { value: obj, next: i };
  }

  _parseSeq(lines, start, indent) {
    const arr = [];
    let i = start;
    while (i < lines.length) {
      i = this._skipEmpty(lines, i);
      if (i >= lines.length || this._indent(lines[i]) < indent) break;
      if (this._indent(lines[i]) !== indent) break;
      const trimmed = lines[i].slice(indent);
      if (!trimmed.startsWith('- ')) break;
      const rest = trimmed.slice(2).trim();
      if (!rest) {
        const nested = this._parseBlock(lines, i + 1, indent + 2);
        arr.push(nested.value);
        i = nested.next;
        continue;
      }
      const mapEntry = rest.match(/^([^:]+):(.*)$/);
      if (mapEntry) {
        const obj = {};
        const key = mapEntry[1].trim();
        const value = mapEntry[2].trim();
        if (value) {
          obj[key] = this._parseScalar(value);
          const nested = this._parseMap(lines, i + 1, indent + 2);
          arr.push({ ...obj, ...nested.value });
          i = nested.next;
        } else {
          const nestedValue = this._parseBlock(lines, i + 1, indent + 4);
          obj[key] = nestedValue.value;
          const nestedMap = this._parseMap(lines, nestedValue.next, indent + 2);
          arr.push({ ...obj, ...nestedMap.value });
          i = nestedMap.next;
        }
      } else {
        arr.push(this._parseScalar(rest));
        i += 1;
      }
    }
    return { value: arr, next: i };
  }

  _stringifyYaml(value, indent = 0) {
    const pad = ' '.repeat(indent);
    if (Array.isArray(value)) {
      if (value.length === 0) return `${pad}[]\n`;
      return value
        .map((item) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const keys = Object.keys(item);
            if (keys.length === 0) return `${pad}- {}\n`;
            const [first, ...rest] = keys;
            let out = `${pad}- ${first}: ${this._inlineOrNested(item[first], indent + 4)}`;
            for (const key of rest)
              out += `${pad}  ${key}: ${this._inlineOrNested(item[key], indent + 4)}`;
            return out;
          }
          return `${pad}- ${this._formatScalar(item)}\n`;
        })
        .join('');
    }
    let out = '';
    for (const [key, item] of Object.entries(value || {})) {
      out += `${pad}${key}: ${this._inlineOrNested(item, indent + 2)}`;
    }
    return out;
  }

  _inlineOrNested(value, indent) {
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]\n';
      return `\n${this._stringifyYaml(value, indent)}`;
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value).length === 0) return '{}\n';
      return `\n${this._stringifyYaml(value, indent)}`;
    }
    return `${this._formatScalar(value)}\n`;
  }

  _formatScalar(value) {
    if (value == null) return 'null';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    const str = String(value);
    if (/^-?\d+(?:\.\d+)?$/.test(str)) return JSON.stringify(str);
    if (
      /^[A-Za-z0-9_@./:+-]+(?: [A-Za-z0-9_@./:+-]+)*$/.test(str) &&
      !/^(true|false|null)$/i.test(str)
    ) {
      return str;
    }
    return JSON.stringify(str);
  }

  _parseScalar(value) {
    const raw = String(value || '').trim();
    if (raw === '[]') return [];
    if (raw === '{}') return {};
    if (raw === 'null' || raw === '~') return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const inner = raw.slice(1, -1).trim();
      if (!inner) return [];
      return this._splitInline(inner).map((part) => this._parseScalar(part));
    }
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      try {
        return JSON.parse(raw);
      } catch (_) {
        return raw.slice(1, -1);
      }
    }
    return raw;
  }

  _splitInline(value) {
    const parts = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if ((ch === '"' || ch === "'") && value[i - 1] !== '\\')
        quote = quote === ch ? null : quote || ch;
      if (ch === ',' && !quote) {
        parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  _dropEmpty(value, preserve = false) {
    if (Array.isArray(value)) return value.map((item) => this._dropEmpty(item, preserve));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const next = this._dropEmpty(item, preserve || key === 'fields');
      if (!preserve) {
        if (next == null || next === '') continue;
        if (Array.isArray(next) && next.length === 0) continue;
        if (typeof next === 'object' && !Array.isArray(next) && Object.keys(next).length === 0)
          continue;
      }
      out[key] = next;
    }
    return out;
  }

  _normalizeFields(fields) {
    const out = {};
    for (const [key, value] of Object.entries(fields || {})) out[key] = this._typedField(value);
    return out;
  }

  _typedField(value) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'type' in value &&
      'value' in value
    ) {
      return value;
    }
    return { type: this._typeOf(value), value };
  }

  _typeOf(value) {
    if (Array.isArray(value)) return 'list';
    if (value == null) return 'unknown';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }

  _notes(notes, body) {
    if (Array.isArray(notes)) return notes.map((note) => String(note));
    if (notes) return [String(notes)];
    return body ? [body] : [];
  }

  _array(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  _extractHashtags(notes = []) {
    if (typeof VCFParser !== 'undefined') return new VCFParser()._extractHashtags(notes);
    const tags = new Set();
    const pattern = /(^|[\s([{,;])#([A-Za-z0-9][A-Za-z0-9_-]*)/g;
    for (const note of notes || []) {
      let match;
      while ((match = pattern.exec(String(note || ''))) !== null) tags.add(match[2].toLowerCase());
    }
    return Array.from(tags).sort();
  }

  _skipEmpty(lines, index) {
    let i = index;
    while (i < lines.length && !String(lines[i]).trim()) i += 1;
    return i;
  }

  _indent(line) {
    return String(line || '').match(/^ */)[0].length;
  }

  // Prefer an id stored in frontmatter (preserves Markdown round-trips); otherwise
  // derive a deterministic id from UID/FN so reparses stay stable.
  _resolveId(providedId, basisContact, idContext) {
    if (providedId) {
      if (idContext) idContext.usedIds.add(providedId);
      return providedId;
    }
    if (idContext && typeof ContactRecord !== 'undefined' && ContactRecord.assignStableId) {
      return ContactRecord.assignStableId(basisContact, idContext.usedIds, idContext.basisCounts);
    }
    return this._generateId();
  }

  _generateId() {
    return `c_${Math.random().toString(36).substring(2, 11)}`;
  }
}
