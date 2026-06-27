/**
 * VCF / vCard parser
 * Handles vCard 3.0 and 4.0 with Apple-specific extensions
 */
class VCFParser {
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
        if (typeof ContactRecord !== 'undefined') {
          ContactRecord.attachToLegacyContact(contact, {
            format: 'vcard',
            raw: contact.rawVCard || '',
            index: i,
          });
        }
        contacts.push(contact);
      } catch (err) {
        console.warn(`[VCFParser] Skipping malformed vCard at index ${i}: ${err.message}`);
      }
    }

    return contacts;
  }

  _assignStableId(contact, usedIds, basisCounts) {
    if (typeof ContactRecord !== 'undefined' && ContactRecord.assignStableId) {
      ContactRecord.assignStableId(contact, usedIds, basisCounts);
    } else {
      contact.id = this._generateId();
      usedIds.add(contact.id);
    }
  }

  _parseVCard(block) {
    const lines = block.split(/\r\n|\n/);

    const contact = {
      id: this._generateId(),
      uid: null,
      fn: '',
      name: {
        family: '',
        given: '',
        additional: '',
        prefix: '',
        suffix: '',
      },
      org: '',
      title: '',
      isCompany: false,
      emails: [],
      phones: [],
      addresses: [],
      birthday: null,
      anniversary: null,
      notes: [],
      related: [], // [{ name, type, rawType }]
      urls: [],
      photo: null, // base64 data URL if present
      tags: [], // reserved system tags
      noteTags: [], // hashtags parsed from notes
      customFields: {}, // format-neutral extras (e.g. round-tripped via X-CONTACTGRAPH-FIELD)
    };

    const items = {}; // item1, item2, etc.

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
          break;
        }

        case 'TITLE':
          contact.title = this._decode(value);
          break;

        case 'X-ABSHOWAS':
          if (value.toUpperCase() === 'COMPANY') contact.isCompany = true;
          break;

        case 'EMAIL':
          if (value && !value.startsWith('/9j/')) {
            contact.emails.push({ value: this._decode(value).trim(), types });
          }
          break;

        case 'TEL':
          if (value) {
            contact.phones.push({ value: this._decode(value).trim(), types });
          }
          break;

        case 'ADR': {
          const parts = VCardUtils.splitEscaped(value, ';');
          contact.addresses.push({
            pobox: this._decode(parts[0] || ''),
            ext: this._decode(parts[1] || ''),
            street: this._decode(parts[2] || ''),
            city: this._decode(parts[3] || ''),
            state: this._decode(parts[4] || ''),
            zip: this._decode(parts[5] || ''),
            country: this._decode(parts[6] || ''),
            types,
          });
          break;
        }

        case 'BDAY':
          if (value && !value.startsWith('//')) {
            contact.birthday = value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2-$3');
          }
          break;

        case 'NOTE':
          if (value) contact.notes.push(this._decode(value));
          break;

        case 'URL':
          if (value) {
            contact.urls.push({ value: this._decode(value).trim(), types });
          }
          break;

        case 'UID':
          contact.uid = value;
          break;

        case 'X-CONTACTGRAPH-FIELD': {
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

    // Process item groups → related contacts, dates
    for (const [, data] of Object.entries(items)) {
      if (data['X-ABRELATEDNAMES'] && data['X-ABLABEL']) {
        const rawType = data['X-ABLABEL'];
        const relType = this._normalizeRelType(rawType);
        const name = this._decode(data['X-ABRELATEDNAMES']).trim();
        if (name) {
          contact.related.push({ name, type: relType, rawType });
        }
      }
      if (data['X-ABDATE'] && data['X-ABLABEL']) {
        const label = data['X-ABLABEL'].toLowerCase();
        if (label.includes('anniversary')) {
          contact.anniversary = data['X-ABDATE'];
        }
      }
    }

    if (!contact.fn) {
      contact.fn = this._composeDisplayName(contact.name);
    }
    if (!contact.fn) return null;

    // Infer tags
    contact.noteTags = this._extractHashtags(contact.notes);
    contact.tags = this._inferTags(contact);

    return contact;
  }

  _normalizeRelType(label) {
    const cleaned = label
      .replace(/^_\$!<(.+)>!\$_$/, '$1')
      .toLowerCase()
      .trim();

    const map = {
      // Spouse
      spouse: 'spouse',
      husband: 'husband',
      wife: 'wife',
      partner: 'partner',
      'domestic partner': 'partner',
      // Parent
      mother: 'mother',
      father: 'father',
      parent: 'parent',
      // Step-parent (gendered, no hyphens)
      stepmother: 'stepmother',
      stepfather: 'stepfather',
      'step mother': 'stepmother',
      'step father': 'stepfather',
      stepparent: 'stepparent',
      'step parent': 'stepparent',
      'step-parent': 'stepparent', // old hyphenated → no-hyphen
      // Child
      son: 'son',
      daughter: 'daughter',
      child: 'child',
      // Step-child (gendered, no hyphens)
      stepson: 'stepson',
      stepdaughter: 'stepdaughter',
      'step son': 'stepson',
      'step daughter': 'stepdaughter',
      stepchild: 'stepchild',
      'step child': 'stepchild', // FIXES ROUND-TRIP BUG
      'step-child': 'stepchild', // old hyphenated → no-hyphen
      // Sibling
      brother: 'brother',
      sister: 'sister',
      sibling: 'sibling',
      // Grandparent (gendered)
      grandmother: 'grandmother',
      grandfather: 'grandfather',
      'grand mother': 'grandmother',
      'grand father': 'grandfather',
      grandparent: 'grandparent',
      'grand parent': 'grandparent',
      // Grandchild (gendered)
      grandson: 'grandson',
      granddaughter: 'granddaughter',
      'grand son': 'grandson',
      'grand daughter': 'granddaughter',
      grandchild: 'grandchild',
      'grand child': 'grandchild',
      // Uncle / Aunt (split)
      uncle: 'uncle',
      aunt: 'aunt',
      'uncle/aunt': 'uncle/aunt', // backward compat — kept as-is
      // Nephew / Niece (split)
      nephew: 'nephew',
      niece: 'niece',
      'nephew/niece': 'nephew/niece', // backward compat — kept as-is
      // Other family
      cousin: 'cousin',
      // Social / professional
      friend: 'friend',
      'best friend': 'friend',
      colleague: 'colleague',
      coworker: 'colleague',
      'co-worker': 'colleague',
      manager: 'manager',
      boss: 'manager',
      assistant: 'assistant',
      neighbor: 'neighbor',
    };

    return map[cleaned] || cleaned;
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
