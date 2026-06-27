/**
 * Format-neutral contact record helpers.
 *
 * Phase 1 keeps the existing contact object shape as the app-facing model while
 * attaching a canonical record beside it. Future import/export adapters can
 * target ContactRecord without forcing graph/detail/table code to know the
 * original file format.
 */
class ContactRecord {
  static CURRENT_VERSION = 1;

  static fromLegacyContact(contact, options = {}) {
    const source = this._sourceDocument(contact, options);
    return {
      schema: 'contactgraph.contact',
      version: this.CURRENT_VERSION,
      id: contact.id || '',
      uid: contact.uid || null,
      displayName: contact.fn || '',
      standard: this._standardFields(contact),
      fields: this._clone(contact.customFields || {}),
      sourceDocuments: source ? [source] : [],
    };
  }

  static attachToLegacyContact(contact, options = {}) {
    if (!contact) return contact;
    const existingFields = contact.record?.fields || contact.customFields || {};
    contact.customFields = this._clone(existingFields);
    contact.record = this.fromLegacyContact(contact, {
      ...options,
      fields: contact.customFields,
    });
    contact.sourceDocuments = contact.record.sourceDocuments;
    return contact;
  }

  static refreshLegacyContact(contact, options = {}) {
    if (!contact) return contact;
    const previousFields = contact.customFields || contact.record?.fields || {};
    const previousSources = contact.sourceDocuments || contact.record?.sourceDocuments || [];
    contact.customFields = this._clone(previousFields);
    contact.record = this.fromLegacyContact(contact, {
      ...options,
      fields: contact.customFields,
      previousSources,
    });
    contact.sourceDocuments = contact.record.sourceDocuments;
    return contact;
  }

  static _standardFields(contact) {
    return {
      fn: contact.fn || '',
      name: this._clone(
        contact.name || {
          family: '',
          given: '',
          additional: '',
          prefix: '',
          suffix: '',
        },
      ),
      org: contact.org || '',
      title: contact.title || '',
      isCompany: !!contact.isCompany,
      emails: this._clone(contact.emails || []),
      phones: this._clone(contact.phones || []),
      addresses: this._clone(contact.addresses || []),
      birthday: contact.birthday || null,
      anniversary: contact.anniversary || null,
      notes: this._clone(contact.notes || []),
      related: this._clone(contact.related || []),
      urls: this._clone(contact.urls || []),
      photo: contact.photo || null,
      tags: this._clone(contact.tags || []),
      noteTags: this._clone(contact.noteTags || []),
    };
  }

  static _sourceDocument(contact, options = {}) {
    const previous = (options.previousSources || [])[0] || {};
    const format = options.format || previous.format || 'vcard';
    const raw =
      options.raw != null
        ? options.raw
        : contact.rawVCard != null
          ? contact.rawVCard
          : previous.raw || '';
    if (!format && !raw) return null;
    return {
      format,
      raw,
      index: options.index ?? previous.index ?? null,
      dirty: options.dirty ?? previous.dirty ?? false,
    };
  }

  static _clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Assign a deterministic, stable id to a contact based on its UID (preferred)
   * or display name. The same source contact yields the same id across reparses,
   * so in-memory references (selection, graph node identity) survive reload.
   *
   * `usedIds` and `basisCounts` are caller-owned per-parse accumulators that keep
   * ids unique: duplicate-named contacts with no UID get a stable occurrence
   * suffix (#2, #3, …) in file order rather than colliding.
   */
  static assignStableId(contact, usedIds, basisCounts) {
    const base = contact.uid
      ? `uid:${String(contact.uid).trim()}`
      : `fn:${String(contact.fn || '')
          .trim()
          .toLowerCase()}`;
    const occurrence = (basisCounts.get(base) || 0) + 1;
    basisCounts.set(base, occurrence);
    const basis = occurrence === 1 ? base : `${base}#${occurrence}`;

    let id = `c_${this._hash(basis)}`;
    let probe = 0;
    while (usedIds.has(id)) {
      probe += 1;
      id = `c_${this._hash(`${basis}~${probe}`)}`;
    }
    usedIds.add(id);
    contact.id = id;
    return id;
  }

  // FNV-1a 32-bit hash → base36. Deterministic and dependency-free.
  static _hash(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }
}
