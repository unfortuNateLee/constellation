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
}
