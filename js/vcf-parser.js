import { VCardUtils } from './vcard-utils.js';
import { ContactRecord } from './contact-record.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';

/**
 * VCF / vCard parser
 * Handles vCard 3.0 and 4.0 with Apple-specific extensions
 */
export class VCFParser {
  parse(text) {
    // Pre-extract raw blocks and photos as ordered arrays (one entry per vCard, in file order).
    // Keying by position instead of FN avoids silent overwrites when two contacts share a
    // display name — the i-th parsed contact always gets the i-th raw block.
    const rawBlocks = []; // index → original raw vCard string
    const photos = []; // index → data URI or null

    const rawVcardRe = /BEGIN:VCARD[\s\S]*?END:VCARD/gi;
    let rawMatch;
    while ((rawMatch = rawVcardRe.exec(text)) !== null) {
      const rawBlock = rawMatch[0];
      rawBlocks.push(rawBlock);

      const photoM = rawBlock.match(/^(PHOTO[^\r\n]*)\r?\n((?:[ \t][^\r\n]*\r?\n)*)/m);
      if (!photoM) {
        photos.push(null);
        continue;
      }

      const firstLine = photoM[1];
      const contLines = photoM[2];
      const colonIdx = firstLine.indexOf(':');
      if (colonIdx === -1) {
        photos.push(null);
        continue;
      }

      let b64 = firstLine.substring(colonIdx + 1);
      for (const line of contLines.split(/\r?\n/)) {
        if (line.match(/^[ \t]/)) b64 += line.substring(1);
      }
      b64 = b64.trim();
      if (!b64) {
        photos.push(null);
        continue;
      }

      const mimeType = /TYPE=PNG/i.test(firstLine) ? 'image/png' : 'image/jpeg';
      photos.push(`data:${mimeType};base64,${b64}`);
    }

    // Strip large binary blocks before unfolding for performance
    text = text.replace(/^PHOTO[^\n]*\n(?:[ \t][^\n]*\n)*/gm, 'PHOTO:__stripped__\n');

    // Unfold continuation lines per RFC 6350 §3.2:
    // A CRLF (or bare LF) immediately followed by a space or tab is a fold marker —
    // remove both the line break AND the leading whitespace character.
    const unfolded = VCardUtils.unfold(text);

    const contacts = [];
    const vcardPattern = /BEGIN:VCARD[\s\S]*?END:VCARD/gi;
    const blocks = unfolded.match(vcardPattern) || [];

    // Per-parse accumulators for deterministic, collision-free ids.
    const usedIds = new Set();
    const basisCounts = new Map();

    // Parse each block and attach its corresponding raw block + photo by index.
    // blocks[i] (unfolded) always corresponds to rawBlocks[i] (original) because
    // folding never adds or removes BEGIN:/END:VCARD markers.
    for (let i = 0; i < blocks.length; i++) {
      // Isolate malformed records: one bad block is skipped with a warning
      // instead of aborting the whole import.
      try {
        const contact = this._parseVCard(blocks[i]);
        if (!contact) continue;
        if (i < rawBlocks.length) {
          contact.rawVCard = rawBlocks[i];
          if (photos[i]) contact.photo = photos[i];
        }
        this._assignStableId(contact, usedIds, basisCounts);
        ContactRecord.attachToLegacyContact(contact, {
          format: 'vcard',
          raw: contact.rawVCard || '',
          index: i,
        });
        contacts.push(contact);
      } catch (err) {
        console.warn(`[VCFParser] Skipping malformed vCard at index ${i}: ${err.message}`);
      }
    }

    return contacts;
  }

  _assignStableId(contact, usedIds, basisCounts) {
    ContactRecord.assignStableId(contact, usedIds, basisCounts);
  }

  _parseVCard(block) {
    const lines = block.split(/\r\n|\n/);

    // Shape comes from the single ContactRecord definition; parse() assigns the
    // final stable id afterward. related: [{ name, type, rawType }]; photo: base64
    // data URL; tags: reserved system tags; noteTags: hashtags parsed from notes;
    // customFields: format-neutral extras (e.g. round-tripped via X-CONSTELLATION-FIELD).
    const contact = ContactRecord.createEmptyContact();

    const items = {}; // item1, item2, etc.
    const itemInstances = {}; // itemKey → the email/phone/address/url entry it labels
    const itemRawLines = {}; // itemKey → original (unfolded) source lines, for raw preservation
    const categories = []; // CATEGORIES values → merged into tags below

    for (const line of lines) {
      if (!line || line === 'BEGIN:VCARD' || line === 'END:VCARD') continue;

      const parsedLine = VCardUtils.parseContentLine(line);
      if (!parsedLine) continue;

      const propName = parsedLine.name;
      const itemKey = parsedLine.group;
      const value = parsedLine.value;

      // Store in items map
      if (itemKey) {
        if (!items[itemKey]) items[itemKey] = {};
        items[itemKey][propName] = value;
        items[itemKey]._params = items[itemKey]._params || {};
        items[itemKey]._params[propName] = parsedLine.params;
        (itemRawLines[itemKey] = itemRawLines[itemKey] || []).push(line);
      }

      // Parse types from params
      const types = this._parseTypes(parsedLine.params);

      // Skip photo data (stripped before parsing for performance)
      if (propName === 'PHOTO') continue;

      switch (propName) {
        case 'FN':
          contact.fn = this._decode(value);
          break;

        case 'N': {
          const parts = VCardUtils.splitEscaped(value, ';');
          contact.name = {
            family: this._decode(parts[0] || '').trim(),
            given: this._decode(parts[1] || '').trim(),
            additional: this._decode(parts[2] || '').trim(),
            prefix: this._decode(parts[3] || '').trim(),
            suffix: this._decode(parts[4] || '').trim(),
          };
          break;
        }

        case 'ORG': {
          const orgParts = VCardUtils.splitEscaped(value, ';');
          contact.org = this._decode(orgParts[0]).trim();
          contact.department = this._decode(orgParts[1] || '').trim();
          break;
        }

        case 'NICKNAME':
          contact.nickname = this._decode(value).trim();
          break;

        case 'X-MAIDENNAME':
          contact.maidenName = this._decode(value).trim();
          break;

        case 'X-PHONETIC-FIRST-NAME':
          contact.phoneticFirst = this._decode(value).trim();
          break;

        case 'X-PHONETIC-LAST-NAME':
          contact.phoneticLast = this._decode(value).trim();
          break;

        case 'X-PHONETIC-ORG':
          contact.phoneticOrg = this._decode(value).trim();
          break;

        case 'X-ALTBDAY':
          // Display + preserve only; the raw line (incl. CALSCALE) is kept verbatim.
          contact.altBirthday = this._decode(value).trim();
          break;

        case 'TITLE':
          contact.title = this._decode(value);
          break;

        case 'GENDER': {
          // vCard 4.0 GENDER: a sex component (M/F/O/N/U) optionally followed by
          // ";text". We model only Male/Female/unknown → map M→M, F→F, else ''.
          const sex = this._decode(value).split(';')[0].trim().toUpperCase();
          contact.gender = sex === 'M' ? 'M' : sex === 'F' ? 'F' : '';
          break;
        }

        case 'X-ABSHOWAS':
          if (value.toUpperCase() === 'COMPANY') contact.isCompany = true;
          break;

        case 'EMAIL':
          if (value && !value.startsWith('/9j/')) {
            const entry = {
              value: this._decode(value).trim(),
              types,
              __raw: itemKey ? null : [line],
            };
            contact.emails.push(entry);
            if (itemKey) itemInstances[itemKey] = entry;
          }
          break;

        case 'TEL':
          if (value) {
            const entry = {
              value: this._decode(value).trim(),
              types,
              __raw: itemKey ? null : [line],
            };
            contact.phones.push(entry);
            if (itemKey) itemInstances[itemKey] = entry;
          }
          break;

        case 'ADR': {
          const parts = VCardUtils.splitEscaped(value, ';');
          const entry = {
            pobox: this._decode(parts[0] || ''),
            ext: this._decode(parts[1] || ''),
            street: this._decode(parts[2] || ''),
            city: this._decode(parts[3] || ''),
            state: this._decode(parts[4] || ''),
            zip: this._decode(parts[5] || ''),
            country: this._decode(parts[6] || ''),
            types,
            __raw: itemKey ? null : [line],
          };
          contact.addresses.push(entry);
          if (itemKey) itemInstances[itemKey] = entry;
          break;
        }

        case 'BDAY':
          if (value && !value.startsWith('//')) {
            contact.birthday = value;
          }
          break;

        case 'NOTE':
          if (value) contact.notes.push(this._decode(value));
          break;

        case 'URL':
          if (value) {
            const entry = {
              value: this._decode(value).trim(),
              types,
              __raw: itemKey ? null : [line],
            };
            contact.urls.push(entry);
            if (itemKey) itemInstances[itemKey] = entry;
          }
          break;

        case 'IMPP':
          if (value) {
            const entry = {
              value: this._decode(value).trim(),
              service: this._paramValue(parsedLine.params, 'X-SERVICE-TYPE'),
              types,
              __raw: itemKey ? null : [line],
            };
            contact.ims.push(entry);
            if (itemKey) itemInstances[itemKey] = entry;
          }
          break;

        case 'X-SOCIALPROFILE':
          if (value) {
            const entry = {
              url: this._decode(value).trim(),
              service: this._paramValue(parsedLine.params, 'TYPE'),
              username: this._paramValue(parsedLine.params, 'X-USER'),
              __raw: itemKey ? null : [line],
            };
            contact.socialProfiles.push(entry);
            if (itemKey) itemInstances[itemKey] = entry;
          }
          break;

        case 'UID':
          contact.uid = value;
          break;

        case 'CATEGORIES':
          for (const cat of VCardUtils.splitEscaped(value, ',')) {
            const decoded = this._decode(cat);
            if (decoded) categories.push(decoded);
          }
          break;

        case 'X-CONSTELLATION-FIELD': {
          // Round-tripped format-neutral custom field, JSON-encoded as
          // {key, type, value}. Emitted by VCardAdapter when a non-vCard-origin
          // contact (e.g. Markdown) is exported to vCard.
          try {
            const obj = JSON.parse(this._decode(value));
            if (obj && obj.key) {
              contact.customFields[obj.key] = {
                type: obj.type || 'unknown',
                value: obj.value,
              };
            }
          } catch {
            // Ignore an unparseable custom-field payload rather than failing the contact.
          }
          break;
        }

        case 'X-ABRELATEDNAMES':
          // Will be processed via items map below
          break;
      }
    }

    // Process item groups → related contacts, dates, and custom field labels.
    for (const [key, data] of Object.entries(items)) {
      if (data['X-ABRELATEDNAMES'] && data['X-ABLABEL']) {
        const rawType = data['X-ABLABEL'];
        const relType = this._normalizeRelType(rawType);
        const name = this._decode(data['X-ABRELATEDNAMES']).trim();
        if (name) {
          contact.related.push({ name, type: relType, rawType });
        }
      } else if (data['X-ABDATE']) {
        const label = this._unwrapLabel(data['X-ABLABEL'] || '');
        if (label.toLowerCase().includes('anniversary')) {
          contact.anniversary = data['X-ABDATE'];
        } else {
          // Any other Apple custom-labeled date is modeled in dates[].
          contact.dates.push({ label: label || 'Date', value: data['X-ABDATE'] });
        }
      } else if (data['X-ABLABEL'] && itemInstances[key]) {
        // Apple custom label on an email/phone/address/url/im item group.
        itemInstances[key].label = this._unwrapLabel(data['X-ABLABEL']);
      }
      // An item-grouped IMPP may carry its service as a sibling property.
      if (itemInstances[key] && data['X-SERVICE-TYPE'] && !itemInstances[key].service) {
        itemInstances[key].service = data['X-SERVICE-TYPE'];
      }
    }

    // Index every contact-method instance by its content key → original raw
    // line(s), so the serializer can re-emit untouched instances byte-for-byte
    // (hybrid raw preservation). Grouped instances pick up their full item group
    // (value + X-ABLabel + X-SERVICE-TYPE siblings). `__raw` is a temporary
    // capture and is stripped from the model here.
    for (const [key, entry] of Object.entries(itemInstances)) {
      if (entry && entry.__raw == null) entry.__raw = itemRawLines[key] || null;
    }
    contact._rawByKey = {};
    const methodArrays = [
      ['email', contact.emails],
      ['phone', contact.phones],
      ['address', contact.addresses],
      ['url', contact.urls],
      ['im', contact.ims],
      ['social', contact.socialProfiles],
    ];
    for (const [kind, arr] of methodArrays) {
      for (const entry of arr || []) {
        const raw = entry.__raw;
        delete entry.__raw;
        if (raw && raw.length) {
          contact._rawByKey[VCardUtils.contactMethodKey(kind, entry)] = raw;
        }
      }
    }

    if (!contact.fn) {
      contact.fn = this._composeDisplayName(contact.name);
    }
    if (!contact.fn) return null;

    // Infer tags, then merge any CATEGORIES (user/markdown tags) round-tripped in.
    contact.noteTags = this._extractHashtags(contact.notes);
    contact.tags = Array.from(new Set([...this._inferTags(contact), ...categories]));

    return contact;
  }

  _normalizeRelType(label) {
    return RelationshipTaxonomy.normalize(label);
  }

  /** First value of a named vCard parameter (e.g. X-SERVICE-TYPE), or ''. */
  _paramValue(params, name) {
    if (!Array.isArray(params)) return '';
    const found = params.find((p) => p && p.name === name);
    return found && found.values ? found.values[0] || '' : '';
  }

  /** Strip Apple's _$!<…>!$_ wrapper from an X-ABLabel and decode it. */
  _unwrapLabel(label) {
    const match = String(label || '').match(/^_\$!<(.*)>!\$_$/);
    return this._decode(match ? match[1] : String(label || ''));
  }

  _inferTags(contact) {
    const tags = new Set();
    if (contact.isCompany) tags.add('company');

    return Array.from(tags);
  }

  _extractHashtags(notes = []) {
    const tags = new Set();
    const pattern = /(^|[\s([{,;])#([A-Za-z0-9][A-Za-z0-9_-]*)/g;
    for (const note of notes || []) {
      const text = String(note || '');
      let match;
      while ((match = pattern.exec(text)) !== null) {
        tags.add(match[2].toLowerCase());
      }
    }
    return Array.from(tags).sort();
  }

  _parseTypes(paramStr) {
    if (Array.isArray(paramStr)) return VCardUtils.typesFromParams(paramStr);
    return VCardUtils.typesFromParams(
      VCardUtils.parseParams(
        String(paramStr || '')
          .split(';')
          .filter(Boolean),
      ),
    );
  }

  _decode(value) {
    return VCardUtils.decodeValue(value).trim();
  }

  _generateId() {
    return 'c_' + Math.random().toString(36).substring(2, 11);
  }

  _composeDisplayName(name) {
    if (!name) return '';
    return [name.prefix, name.given, name.additional, name.family, name.suffix]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
