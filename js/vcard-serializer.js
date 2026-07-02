import { VCardUtils } from './vcard-utils.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';

/**
 * VCardSerializer — the single model-driven vCard serializer.
 *
 * Two entry points share one body generator (`_modelLines`):
 *
 * - `rewriteVCard(contact)` — for vCard-origin contacts (`contact.rawVCard`
 *   present). Hybrid raw preservation: lines the app doesn't model (PRODID,
 *   REV, obscure Apple item groups, …) are kept verbatim; modeled properties
 *   are regenerated from the contact. Within the modeled contact methods,
 *   an *untouched* instance (its `VCardUtils.contactMethodKey` still maps to
 *   original raw line(s) in `contact._rawByKey`) is re-emitted byte-for-byte —
 *   preserving Apple's exact TYPE casing/order — and only edited instances
 *   are regenerated.
 *
 * - `generateVCard(contact)` — full regeneration for contacts with no raw
 *   card (Markdown/TSV imports, in-app creations). Also emits UID and
 *   CATEGORIES (from non-system tags), which the rewrite path instead keeps
 *   verbatim from the original card.
 *
 * Every write path must go through this module — the detail/table edit
 * rewrite, the export fallback, and relationship suggestions all delegate
 * here so the formats can't drift apart again.
 */
export class VCardSerializer {
  /** Export-time serialization: the raw card is the source of truth when present. */
  static serializeContact(contact) {
    if (!contact) return '';
    return contact.rawVCard || this.generateVCard(contact);
  }

  /**
   * Regenerate a raw vCard's modeled properties from the contact, preserving
   * everything else verbatim. Returns the new raw string (does not mutate).
   */
  static rewriteVCard(contact) {
    if (!contact?.rawVCard) return '';

    const lines = VCardUtils.unfold(contact.rawVCard).split(/\r\n|\n/);
    const keptSimple = [];
    const itemGroups = new Map();
    let begin = 'BEGIN:VCARD';
    let end = 'END:VCARD';
    let version = null;
    let nextItem = 1;

    for (const line of lines) {
      if (!line) continue;
      if (/^BEGIN:VCARD/i.test(line)) {
        begin = line;
        continue;
      }
      if (/^END:VCARD/i.test(line)) {
        end = line;
        continue;
      }
      if (/^VERSION:/i.test(line)) {
        version = line;
        continue;
      }

      const itemMatch = line.match(/^(item\d+)\./i);
      if (itemMatch) {
        const key = itemMatch[1];
        nextItem = Math.max(nextItem, parseInt(key.replace(/^item/i, ''), 10) + 1);
        if (!itemGroups.has(key)) itemGroups.set(key, []);
        itemGroups.get(key).push(line);
        continue;
      }

      const prop = line.split(':', 1)[0].split(';', 1)[0].toUpperCase();
      if (VCardSerializer.MODELED_PROPS.has(prop)) continue;
      keptSimple.push(line);
    }

    const keptItemLines = [];
    for (const groupLines of itemGroups.values()) {
      const props = new Set(
        groupLines.map((line) => {
          const lhs = line.split(':', 1)[0];
          const m = lhs.match(/^item\d+\.(.+)$/i);
          return m ? m[1].split(';', 1)[0].toUpperCase() : '';
        }),
      );
      const editableContactGroup =
        props.has('EMAIL') ||
        props.has('TEL') ||
        props.has('ADR') ||
        props.has('URL') ||
        props.has('IMPP') ||
        props.has('X-SOCIALPROFILE');
      const dateGroup = props.has('X-ABDATE');
      const relatedGroup = props.has('X-ABRELATEDNAMES');
      // Drop the groups we regenerate from the model below (editable contact
      // fields, dates, relationships); keep everything else (obscure Apple item
      // groups) verbatim.
      if (!editableContactGroup && !dateGroup && !relatedGroup) {
        keptItemLines.push(...groupLines);
      }
    }

    const generated = this._modelLines(contact, {
      mode: 'rewrite',
      rawByKey: contact._rawByKey || {},
      nextItem,
    });

    const body = [
      begin,
      version || 'VERSION:3.0',
      ...keptSimple,
      ...generated,
      ...keptItemLines,
      end,
    ];
    return VCardUtils.foldLines(body);
  }

  /** Full regeneration for a contact with no raw card. */
  static generateVCard(contact) {
    if (!contact) return '';
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    if (contact.uid) lines.push(`UID:${this._esc(contact.uid)}`);
    lines.push(...this._modelLines(contact, { mode: 'generate' }));
    lines.push('END:VCARD');
    return VCardUtils.foldLines(lines);
  }

  /**
   * Simple (non-item-group) properties the model owns: the rewrite path drops
   * these from the original card and regenerates them below. Anything not
   * listed here is kept verbatim (UID, CATEGORIES, PRODID, REV, X-* …).
   */
  static MODELED_PROPS = new Set([
    'FN',
    'N',
    'NICKNAME',
    'X-MAIDENNAME',
    'X-PHONETIC-FIRST-NAME',
    'X-PHONETIC-LAST-NAME',
    'X-PHONETIC-ORG',
    'ORG',
    'TITLE',
    'GENDER',
    'EMAIL',
    'TEL',
    'ADR',
    'BDAY',
    'NOTE',
    'URL',
    'IMPP',
    'X-SOCIALPROFILE',
    'PHOTO',
    'X-ABSHOWAS',
    'X-CONSTELLATION-FIELD',
  ]);

  /**
   * The model-driven card body, FN through custom fields, shared by both
   * paths. `mode: 'generate'` additionally emits CATEGORIES (the rewrite path
   * keeps the original CATEGORIES line verbatim instead, so inferred tags are
   * never written into an Apple-origin card).
   */
  static _modelLines(contact, { mode, rawByKey = {}, nextItem = 1 }) {
    const esc = (v) => this._esc(v);
    const lines = [];

    if (mode === 'rewrite') {
      const name = contact.name || this._namePartsFromDisplayName(contact.fn || '');
      lines.push(`FN:${esc(contact.fn || '')}`);
      lines.push(this._nLine(name));
    } else {
      const name = contact.name || {};
      lines.push(`FN:${esc(contact.fn || this._composeDisplayName(name) || 'Contact')}`);
      lines.push(this._nLine(name));
    }
    if (contact.nickname) lines.push(`NICKNAME:${esc(contact.nickname)}`);
    if (contact.maidenName) lines.push(`X-MAIDENNAME:${esc(contact.maidenName)}`);
    if (contact.phoneticFirst) lines.push(`X-PHONETIC-FIRST-NAME:${esc(contact.phoneticFirst)}`);
    if (contact.phoneticLast) lines.push(`X-PHONETIC-LAST-NAME:${esc(contact.phoneticLast)}`);
    if (contact.isCompany) lines.push('X-ABSHOWAS:COMPANY');
    if (contact.org || contact.department) {
      const orgValue = contact.department
        ? `${esc(contact.org || '')};${esc(contact.department)}`
        : esc(contact.org || '');
      lines.push(`ORG:${orgValue}`);
    }
    if (contact.phoneticOrg) lines.push(`X-PHONETIC-ORG:${esc(contact.phoneticOrg)}`);
    if (contact.title) lines.push(`TITLE:${esc(contact.title)}`);
    if (contact.gender) lines.push(`GENDER:${esc(contact.gender)}`);
    lines.push(...this._photoLines(contact.photo));

    if (mode === 'generate') {
      // Non-system tags (markdown / in-app) → standard CATEGORIES so they
      // aren't dropped on export. 'company' is already X-ABSHOWAS.
      const categories = (contact.tags || []).filter((tag) => tag && tag !== 'company');
      if (categories.length) {
        lines.push(`CATEGORIES:${categories.map((tag) => esc(tag)).join(',')}`);
      }
    }

    // Emit a contact field as a plain line, or — when the entry carries an
    // Apple custom label — as an item group with an X-ABLabel.
    const pushLabeledField = (prop, params, value, label) => {
      if (label) {
        lines.push(`item${nextItem}.${prop}${params}:${value}`);
        lines.push(`item${nextItem}.X-ABLabel:${this._wrapLabel(label)}`);
        nextItem += 1;
      } else {
        lines.push(`${prop}${params}:${value}`);
      }
    };
    // Hybrid raw preservation (rewrite mode): an unchanged instance re-emits
    // its original bytes; only edited instances regenerate. In generate mode
    // rawByKey is empty, so everything regenerates.
    const pushMethod = (kind, entry, regenerate) => {
      const raw = rawByKey[VCardUtils.contactMethodKey(kind, entry)];
      if (raw && raw.length) lines.push(...raw);
      else regenerate();
    };

    for (const email of contact.emails || []) {
      if (!email?.value) continue;
      pushMethod('email', email, () =>
        pushLabeledField('EMAIL', this._typeParams(email.types), esc(email.value), email.label),
      );
    }
    for (const phone of contact.phones || []) {
      if (!phone?.value) continue;
      pushMethod('phone', phone, () =>
        pushLabeledField('TEL', this._typeParams(phone.types), esc(phone.value), phone.label),
      );
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
      pushMethod('address', address, () => {
        const value = `${esc(address.pobox || '')};${esc(address.ext || '')};${esc(address.street || '')};${esc(address.city || '')};${esc(address.state || '')};${esc(address.zip || '')};${esc(address.country || '')}`;
        pushLabeledField('ADR', this._typeParams(address.types), value, address.label);
      });
    }
    for (const urlEntry of contact.urls || []) {
      const entry =
        typeof urlEntry === 'string' ? { value: urlEntry, types: [], label: '' } : urlEntry;
      if (!entry?.value) continue;
      pushMethod('url', entry, () =>
        pushLabeledField('URL', this._typeParams(entry.types || []), esc(entry.value), entry.label),
      );
    }
    for (const im of contact.ims || []) {
      if (!im?.value) continue;
      pushMethod('im', im, () => {
        const svc = im.service ? `;X-SERVICE-TYPE=${VCardUtils.encodeParamValue(im.service)}` : '';
        const params = svc + this._typeParams(im.types || []);
        pushLabeledField('IMPP', params, esc(im.value), im.label);
      });
    }
    for (const sp of contact.socialProfiles || []) {
      if (!sp?.url) continue;
      pushMethod('social', sp, () => {
        let params = '';
        if (sp.service) params += `;TYPE=${VCardUtils.encodeParamValue(sp.service)}`;
        if (sp.username) params += `;X-USER=${VCardUtils.encodeParamValue(sp.username)}`;
        pushLabeledField('X-SOCIALPROFILE', params, esc(sp.url), sp.label);
      });
    }

    if (contact.birthday) lines.push(`BDAY:${esc(contact.birthday)}`);
    for (const note of contact.notes || []) {
      if (note) lines.push(`NOTE:${esc(note)}`);
    }

    if (contact.anniversary) {
      lines.push(`item${nextItem}.X-ABDATE:${esc(contact.anniversary)}`);
      lines.push(`item${nextItem}.X-ABLabel:_$!<Anniversary>!$_`);
      nextItem += 1;
    }
    for (const dateEntry of contact.dates || []) {
      if (!dateEntry?.value) continue;
      lines.push(`item${nextItem}.X-ABDATE:${esc(dateEntry.value)}`);
      lines.push(`item${nextItem}.X-ABLabel:${this._wrapLabel(dateEntry.label || 'Date')}`);
      nextItem += 1;
    }

    // Relationships regenerated from the model — contact.related is the single
    // source of truth; the raw X-ABRELATEDNAMES groups are derived, not patched.
    for (const rel of contact.related || []) {
      if (!rel?.name) continue;
      const label = rel.rawType || RelationshipTaxonomy.vcardLabel(rel.type);
      lines.push(`item${nextItem}.X-ABRELATEDNAMES:${esc(rel.name)}`);
      lines.push(`item${nextItem}.X-ABLabel:${label}`);
      nextItem += 1;
    }

    // Format-neutral custom fields round-trip via X-CONSTELLATION-FIELD (read
    // back by VCFParser). The markdown body is already carried as NOTE.
    const customFields = contact.customFields || contact.record?.fields || {};
    for (const [key, field] of Object.entries(customFields)) {
      if (key === 'markdown_body') continue;
      const payload = JSON.stringify({ key, type: field?.type, value: field?.value });
      lines.push(`X-CONSTELLATION-FIELD:${esc(payload)}`);
    }

    return lines;
  }

  static _nLine(name = {}) {
    const esc = (v) => this._esc(v);
    return `N:${esc(name.family || '')};${esc(name.given || '')};${esc(name.additional || '')};${esc(name.prefix || '')};${esc(name.suffix || '')}`;
  }

  static _photoLines(dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:')) return [];
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return [];

    const mime = m[1].toLowerCase();
    const base64 = m[2].replace(/\s+/g, '');
    const type =
      {
        'image/png': 'PNG',
        'image/gif': 'GIF',
        'image/webp': 'WEBP',
        'image/heic': 'HEIC',
        'image/heif': 'HEIF',
        'image/bmp': 'BMP',
        'image/tiff': 'TIFF',
      }[mime] || 'JPEG';
    const firstChunk = base64.slice(0, 72);
    const rest = base64.slice(72);
    const lines = [`PHOTO;ENCODING=b;TYPE=${type}:${firstChunk}`];
    for (let i = 0; i < rest.length; i += 72) {
      lines.push(` ${rest.slice(i, i + 72)}`);
    }
    return lines;
  }

  static _namePartsFromDisplayName(displayName) {
    const parts = String(displayName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) {
      return { family: '', given: '', additional: '', prefix: '', suffix: '' };
    }
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

  static _composeDisplayName(name = {}) {
    return [name.prefix, name.given, name.additional, name.family, name.suffix]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static _esc(value) {
    return VCardUtils.encodeValue(value);
  }

  static _typeParams(types = []) {
    return VCardUtils.buildTypeParams(types);
  }

  static _wrapLabel(label) {
    return VCardUtils.formatXABLabel(label);
  }
}
