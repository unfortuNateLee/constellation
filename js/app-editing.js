import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';
import { VCardUtils } from './vcard-utils.js';

/**
 * Detail-panel editing: read-only/editable field rendering, per-field editors
 * (text, photo, collections, addresses, custom fields, type pickers), saving
 * edits back to the model, and the raw-vCard string surgery + type/custom-field
 * helpers that support it. Extracted from app.js verbatim.
 */
class EditingMixin {
  /**
   * Escape a plain-text string for embedding as a vCard property value (RFC 6350 §4).
   * Parsing already un-escapes these sequences; writes must re-escape them so that
   * names containing commas, semicolons, or backslashes round-trip correctly.
   */
  _vCardEscape(str) {
    return VCardUtils.encodeValue(str);
  }

  _decodeVCardValue(str) {
    return VCardUtils.decodeValue(str);
  }

  _joinVCardLines(lines) {
    return VCardUtils.foldLines(lines);
  }

  _insertBeforeEndVCard(rawVCard, foldedLines) {
    const block = String(foldedLines || '').replace(/\r\n$/, '');
    return String(rawVCard || '').replace(/END:VCARD/i, `${block}\r\nEND:VCARD`);
  }

  _findRelatedItemPrefix(rawVCard, relName) {
    if (!rawVCard || !relName) return null;

    for (const line of VCardUtils.unfold(rawVCard).split(/\r\n|\n/)) {
      const m = line.match(/^(item\d+)\.X-ABRELATEDNAMES(?:;[^:]*)?:(.*)$/i);
      if (!m) continue;
      const [, prefix, rawValue] = m;
      if (this._decodeVCardValue(rawValue).trim() === relName.trim()) {
        return prefix;
      }
    }

    return null;
  }

  _findRelatedItemPrefixByIndex(rawVCard, relIdx) {
    if (!rawVCard || relIdx == null) return null;
    let currentIdx = -1;
    for (const line of VCardUtils.unfold(rawVCard).split(/\r\n|\n/)) {
      const m = line.match(/^(item\d+)\.X-ABRELATEDNAMES(?:;[^:]*)?:/i);
      if (!m) continue;
      currentIdx += 1;
      if (currentIdx === relIdx) return m[1];
    }
    return null;
  }

  _escapeRegExp(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _removeItemGroup(rawVCard, prefix) {
    if (!rawVCard || !prefix) return rawVCard;
    const prefixRe = new RegExp(`^${this._escapeRegExp(prefix)}\\..*$`, 'i');
    return VCardUtils.unfold(rawVCard)
      .split(/\r\n|\n/)
      .filter((line) => !prefixRe.test(line))
      .join('\r\n');
  }

  _renderAddRelationshipAction() {
    const actions = document.createElement('div');
    actions.className = 'detail-section-actions';
    const button = document.createElement('button');
    button.className = 'btn btn-ghost';
    button.type = 'button';
    button.textContent = '+ Add Relationship';
    button.addEventListener('click', () => this._showAddRelationshipModal());
    actions.appendChild(button);
    return actions;
  }

  _replaceItemProperty(rawVCard, prefix, propName, newValue) {
    if (!rawVCard || !prefix || !propName) return rawVCard;
    const prefixEsc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const propEsc = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${prefixEsc}\\.${propEsc}(?:;[^:]*)?:.*$`, 'im');
    return VCardUtils.unfold(rawVCard).replace(
      pattern,
      this._joinVCardLines([`${prefix}.${propName}:${newValue}`]),
    );
  }

  _syncDetailEditButtons(node, hasContact, isEditing) {
    const isVirtual = !!node?.isVirtual;
    const isGroup = !!node?.isGroupNode;
    document
      .getElementById('btn-create-contact')
      .classList.toggle('hidden', !isVirtual || isEditing);
    document
      .getElementById('btn-edit-contact')
      .classList.toggle('hidden', !hasContact || isEditing || isVirtual || isGroup);
    document.getElementById('btn-save-contact').classList.toggle('hidden', !isEditing);
    document.getElementById('btn-cancel-edit').classList.toggle('hidden', !isEditing);
    document
      .getElementById('btn-delete-contact')
      .classList.toggle('hidden', isEditing || !hasContact || isVirtual || isGroup);
    document
      .getElementById('btn-export-contact-menu')
      .classList.toggle('hidden', isEditing || !hasContact || isVirtual || isGroup);
  }

  _createContactFromVirtual() {
    if (!this._selectedNodeId) return;
    const node = this._node(this._selectedNodeId);
    if (!node || !node.isVirtual) return;

    const existing = this._contactsByFn.get((node.name || '').toLowerCase().trim());
    if (existing) {
      this._showToast('A real contact with that name already exists', 'error');
      return;
    }

    const structuredName = this._namePartsFromDisplayName(node.name || 'New Contact');
    const contact = {
      id: this.parser._generateId(),
      uid: null,
      fn: node.name || 'New Contact',
      name: structuredName,
      org: '',
      title: '',
      isCompany: false,
      emails: [],
      phones: [],
      addresses: [],
      birthday: null,
      anniversary: null,
      notes: [],
      related: [],
      urls: [],
      photo: null,
      tags: ['other'],
      rawVCard: '',
    };

    contact.rawVCard = this._joinVCardLines([
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${this._vCardEscape(contact.fn)}`,
      `N:${this._vCardEscape(contact.name.family)};${this._vCardEscape(contact.name.given)};${this._vCardEscape(contact.name.additional)};${this._vCardEscape(contact.name.prefix)};${this._vCardEscape(contact.name.suffix)}`,
      'END:VCARD',
    ]);

    this.contacts.push(contact);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();

    const createdNode = this._node(contact.id);
    if (createdNode) {
      this._selectedNodeId = createdNode.id;
      this._editingContactId = createdNode.id;
      this.graph.highlightContact(createdNode.id);
      this._onNodeSelect(createdNode);
    }

    this._showToast(`Created real contact for ${contact.fn}`, 'success');
  }

  _renderReadOnlyContactInfo(contactInfo, node) {
    contactInfo.innerHTML = '';

    contactInfo.appendChild(this._detailRow('👤', this._escapeHtml(node.name), 'Full Name'));
    if (node.org)
      contactInfo.appendChild(this._detailRow('🏢', this._escapeHtml(node.org), 'Organization'));
    if (node.title)
      contactInfo.appendChild(this._detailRow('💼', this._escapeHtml(node.title), 'Title'));

    for (const email of node.emails || []) {
      const emailValue = String(email.value || '').replace(/[\r\n]/g, '');
      const row = this._detailRow(
        '✉️',
        `<a href="mailto:${this._escapeHtml(emailValue)}">${this._escapeHtml(emailValue)}</a>`,
        email.types.filter((t) => !['INTERNET', 'PREF'].includes(t)).join(', ') || 'Email',
      );
      contactInfo.appendChild(row);
    }

    for (const phone of node.phones || []) {
      const row = this._detailRow(
        '📞',
        this._escapeHtml(phone.value),
        phone.types.filter((t) => !['VOICE', 'PREF'].includes(t)).join(', ') || 'Phone',
      );
      contactInfo.appendChild(row);
    }

    for (const address of node.addresses || []) {
      const lines = [
        address.street,
        [address.city, address.state, address.zip].filter(Boolean).join(', '),
        address.country,
      ].filter(Boolean);
      const html = `<div class="address-lines">${lines.map((line) => `<div>${this._escapeHtml(line)}</div>`).join('')}</div>`;
      contactInfo.appendChild(
        this._detailRow(
          '📍',
          html,
          this._visibleTypes('address', address.types || []).join(', ') || 'Address',
        ),
      );
    }

    for (const urlEntry of node.urls || []) {
      const urlValue = typeof urlEntry === 'string' ? urlEntry : urlEntry.value;
      if (!urlValue) continue;
      const safeUrl = this._escapeHtml(urlValue);
      const safeHref = this._safeExternalHref(urlValue);
      const types =
        typeof urlEntry === 'string' ? [] : this._visibleTypes('url', urlEntry.types || []);
      contactInfo.appendChild(
        this._detailRow(
          '🔗',
          safeHref
            ? `<a href="${this._escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`
            : safeUrl,
          types.join(', ') || 'Website',
        ),
      );
    }

    if (node.birthday)
      contactInfo.appendChild(
        this._detailRow('🎂', this._formatBirthday(node.birthday), 'Birthday'),
      );
    if (node.anniversary)
      contactInfo.appendChild(
        this._detailRow('💍', this._formatDateWithYears(node.anniversary), 'Anniversary'),
      );
    this._renderReadOnlyCustomFields(contactInfo, node);
  }

  _detailField(label, value) {
    return this._detailRow('•', this._escapeHtml(value), label);
  }

  _renderReadOnlyCustomFields(container, contact) {
    const entries = this._customFieldEntries(contact);
    if (entries.length === 0) return;

    for (const [key, rawField] of entries) {
      const field = this._normalizeCustomField(rawField);
      container.appendChild(
        this._detailRow(
          '◆',
          this._escapeHtml(this._customFieldDisplayValue(field)),
          `Custom: ${this._customFieldLabel(key)}`,
        ),
      );
    }
  }

  _renderEditableContactInfo(contactInfo, notesEl, contact) {
    contactInfo.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'detail-edit-grid';
    grid.appendChild(this._editPhotoField(contact));
    grid.appendChild(this._editField('Display Name', 'edit-fn', contact.fn || ''));
    grid.appendChild(this._editField('First Name', 'edit-name-given', contact.name?.given || ''));
    grid.appendChild(
      this._editField('Middle Name', 'edit-name-additional', contact.name?.additional || ''),
    );
    grid.appendChild(this._editField('Last Name', 'edit-name-family', contact.name?.family || ''));
    grid.appendChild(this._editField('Prefix', 'edit-name-prefix', contact.name?.prefix || ''));
    grid.appendChild(this._editField('Suffix', 'edit-name-suffix', contact.name?.suffix || ''));
    grid.appendChild(
      this._editCheckboxField(
        'Treat as Company',
        'edit-is-company',
        !!contact.isCompany,
        'Export as X-ABSHOWAS: COMPANY',
      ),
    );
    grid.appendChild(this._editField('Organization', 'edit-org', contact.org || ''));
    grid.appendChild(this._editField('Title', 'edit-title', contact.title || ''));
    grid.appendChild(this._editField('Birthday', 'edit-bday', contact.birthday || '', 'date'));
    grid.appendChild(
      this._editField('Anniversary', 'edit-anniversary', contact.anniversary || '', 'date'),
    );
    grid.appendChild(
      this._editCollectionField('Emails', 'email', contact.emails || [], (entry) => entry.value),
    );
    grid.appendChild(
      this._editCollectionField('Phones', 'phone', contact.phones || [], (entry) => entry.value),
    );
    grid.appendChild(this._editAddressField(contact.addresses || []));
    grid.appendChild(
      this._editCollectionField('Websites', 'url', contact.urls || [], (entry) =>
        typeof entry === 'string' ? entry : entry.value,
      ),
    );
    grid.appendChild(this._editCustomFields(contact.customFields || contact.record?.fields || {}));

    contactInfo.appendChild(grid);
    notesEl.parentElement.classList.remove('hidden');
  }

  _editPhotoField(contact) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row';
    wrap.innerHTML = `<div class="detail-edit-label">Photo</div>`;

    const block = document.createElement('div');
    block.className = 'photo-edit-block';

    const preview = document.createElement('div');
    preview.className = 'photo-edit-preview';
    preview.id = 'edit-photo-preview';

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'edit-photo-data';
    hidden.value = contact.photo || '';

    const remove = document.createElement('input');
    remove.type = 'hidden';
    remove.id = 'edit-photo-remove';
    remove.value = '0';

    const applyPreview = (dataUrl) => {
      if (dataUrl) preview.style.backgroundImage = `url(${dataUrl})`;
      else preview.style.backgroundImage = 'none';
    };
    applyPreview(contact.photo || '');

    const actions = document.createElement('div');
    actions.className = 'photo-edit-actions';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'hidden';
    fileInput.id = 'edit-photo-file';

    const chooseBtn = document.createElement('button');
    chooseBtn.className = 'btn btn-ghost btn-xs';
    chooseBtn.type = 'button';
    chooseBtn.textContent = contact.photo ? 'Change Photo' : 'Add Photo';
    chooseBtn.addEventListener('click', () => fileInput.click());

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-ghost btn-xs';
    clearBtn.type = 'button';
    clearBtn.textContent = 'Remove Photo';
    clearBtn.disabled = !contact.photo;
    clearBtn.addEventListener('click', () => {
      hidden.value = '';
      remove.value = '1';
      applyPreview('');
      clearBtn.disabled = true;
      chooseBtn.textContent = 'Add Photo';
      const detailPhoto = document.getElementById('detail-photo');
      if (detailPhoto) {
        detailPhoto.style.backgroundImage = 'none';
        detailPhoto.textContent = this._initials(contact.fn || '');
      }
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl) return;
        hidden.value = dataUrl;
        remove.value = '0';
        applyPreview(dataUrl);
        clearBtn.disabled = false;
        chooseBtn.textContent = 'Change Photo';
        const detailPhoto = document.getElementById('detail-photo');
        if (detailPhoto) {
          detailPhoto.style.backgroundImage = `url(${dataUrl})`;
          detailPhoto.textContent = '';
        }
      };
      reader.readAsDataURL(file);
    });

    actions.appendChild(chooseBtn);
    actions.appendChild(clearBtn);
    actions.appendChild(fileInput);
    actions.appendChild(hidden);
    actions.appendChild(remove);

    block.appendChild(preview);
    block.appendChild(actions);
    wrap.appendChild(block);
    return wrap;
  }

  _editField(label, id, value, type = 'text') {
    const row = document.createElement('div');
    row.className = 'detail-edit-row';
    row.innerHTML = `
      <label class="detail-edit-label" for="${id}">${label}</label>
      <input class="form-control" type="${type}" id="${id}">
    `;
    row.querySelector('input').value = value || '';
    return row;
  }

  _editCheckboxField(label, id, checked, helpText = '') {
    const row = document.createElement('div');
    row.className = 'detail-edit-row';

    const labelEl = document.createElement('label');
    labelEl.className = 'detail-edit-checkbox';
    labelEl.setAttribute('for', id);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;

    const text = document.createElement('div');
    text.innerHTML = `
      <div class="detail-edit-checkbox-title">${this._escapeHtml(label)}</div>
      ${helpText ? `<div class="detail-edit-help">${this._escapeHtml(helpText)}</div>` : ''}
    `;

    labelEl.appendChild(input);
    labelEl.appendChild(text);
    row.appendChild(labelEl);
    return row;
  }

  _editCollectionField(label, kind, entries, getValue) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row';
    wrap.innerHTML = `<div class="detail-edit-label">${label}</div>`;

    const multi = document.createElement('div');
    multi.className = 'detail-edit-multi';
    wrap.appendChild(multi);

    const addItem = (entry = null) => {
      const item = document.createElement('div');
      item.className = 'detail-edit-item';
      item.dataset.kind = kind;

      const input = document.createElement('input');
      input.className = 'form-control';
      input.dataset.role = 'value';
      input.value = entry ? getValue(entry) : '';
      input.placeholder = label.slice(0, -1);

      const typeState = this._typeSelectionState(kind, entry?.types || []);
      const typeSelect = this._typeSelect(kind, typeState.selected);
      const typeInput = this._customTypeInput(
        kind,
        'types-custom',
        typeState.customValue,
        typeState.selected === 'custom',
      );
      this._bindTypeEditor(typeSelect, typeInput);
      const preferred = this._preferredRadio(kind, this._isPreferred(entry?.types || []));

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => item.remove());

      const valueRow = document.createElement('div');
      valueRow.className = 'detail-edit-stack';
      valueRow.appendChild(input);

      const metaRow = document.createElement('div');
      metaRow.className = 'detail-edit-inline detail-edit-meta';

      const footerRow = document.createElement('div');
      footerRow.className = 'detail-edit-inline detail-edit-footer';

      const help = document.createElement('div');
      help.className = 'detail-edit-help';
      help.textContent = 'Choose a type. Select Custom to enter your own.';

      metaRow.appendChild(typeSelect);
      metaRow.appendChild(typeInput);
      footerRow.appendChild(preferred);
      footerRow.appendChild(removeBtn);
      item.appendChild(valueRow);
      item.appendChild(metaRow);
      item.appendChild(help);
      item.appendChild(footerRow);
      multi.appendChild(item);
    };

    if (entries.length > 0) entries.forEach(addItem);
    else addItem();

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs';
    addBtn.type = 'button';
    addBtn.textContent = `+ Add ${label.slice(0, -1)}`;
    addBtn.addEventListener('click', () => addItem());
    wrap.appendChild(addBtn);

    return wrap;
  }

  _editCustomFields(fields) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row detail-edit-custom-fields';
    const label = document.createElement('div');
    label.className = 'detail-edit-label';
    label.textContent = 'Custom Fields';
    wrap.appendChild(label);

    const entries = Object.entries(fields || {});
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'detail-edit-help';
      empty.textContent = 'No custom fields on this contact.';
      wrap.appendChild(empty);
      return wrap;
    }

    const multi = document.createElement('div');
    multi.className = 'detail-edit-multi';
    for (const [key, rawField] of entries) {
      const field = this._normalizeCustomField(rawField);
      const item = document.createElement('div');
      item.className = 'detail-edit-item custom-field-item';
      item.dataset.kind = 'custom-field';
      item.dataset.fieldKey = key;
      item.dataset.fieldType = field.type || 'unknown';

      const title = document.createElement('div');
      title.className = 'detail-edit-checkbox-title';
      title.textContent = this._customFieldLabel(key);

      const help = document.createElement('div');
      help.className = 'detail-edit-help';
      help.textContent = `Type: ${field.type || 'unknown'}`;

      item.appendChild(title);
      item.appendChild(this._customFieldEditor(field));
      item.appendChild(help);
      multi.appendChild(item);
    }
    wrap.appendChild(multi);
    return wrap;
  }

  _customFieldEditor(field) {
    if (field.type === 'list' && Array.isArray(field.value)) {
      return this._customListFieldEditor(field.value);
    }
    if (this._isEditableCustomScalar(field)) {
      return this._customScalarFieldEditor(field);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'form-control';
    textarea.value = this._customFieldDisplayValue(field);
    textarea.disabled = true;
    return textarea;
  }

  _customScalarFieldEditor(field) {
    const input = document.createElement('input');
    input.className = 'form-control';
    input.dataset.role = 'custom-value';
    if (field.type === 'boolean') {
      input.type = 'checkbox';
      input.checked = field.value === true;
      return input;
    }
    input.type =
      field.type === 'number'
        ? 'number'
        : field.type === 'date'
          ? 'date'
          : field.type === 'color'
            ? 'color'
            : 'text';
    input.value = field.value == null ? '' : String(field.value);
    return input;
  }

  _customListFieldEditor(values) {
    const block = document.createElement('div');
    block.className = 'detail-edit-stack';
    const list = document.createElement('div');
    list.className = 'detail-edit-multi';
    const addItem = (value = '') => {
      const row = document.createElement('div');
      row.className = 'detail-edit-inline';
      const input = document.createElement('input');
      input.className = 'form-control';
      input.dataset.role = 'custom-list-value';
      input.value = value == null ? '' : String(value);
      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost btn-xs';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => row.remove());
      row.append(input, remove);
      list.appendChild(row);
    };
    if (values.length) values.forEach(addItem);
    else addItem();
    const add = document.createElement('button');
    add.className = 'btn btn-ghost btn-xs';
    add.type = 'button';
    add.textContent = '+ Add Value';
    add.addEventListener('click', () => addItem());
    block.append(list, add);
    return block;
  }

  _editAddressField(addresses) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row';
    wrap.innerHTML = `<div class="detail-edit-label">Addresses</div>`;

    const multi = document.createElement('div');
    multi.className = 'detail-edit-multi';
    wrap.appendChild(multi);

    const addItem = (address = null) => {
      const item = document.createElement('div');
      item.className = 'detail-edit-item';
      item.dataset.kind = 'address';
      const grid = document.createElement('div');
      grid.className = 'detail-edit-grid';

      const street = this._addressInput('Street', 'street', address?.street || '');
      const city = this._addressInput('City', 'city', address?.city || '');
      const state = this._addressInput('State', 'state', address?.state || '');
      const zip = this._addressInput('ZIP', 'zip', address?.zip || '');
      const country = this._addressInput('Country', 'country', address?.country || '');
      const typeState = this._typeSelectionState('address', address?.types || []);
      const typeSelect = this._typeSelect('address', typeState.selected, 'addr-type-select');
      const typeInput = this._customTypeInput(
        'address',
        'types',
        typeState.customValue,
        typeState.selected === 'custom',
      );
      this._bindTypeEditor(typeSelect, typeInput);

      const metaRow = document.createElement('div');
      metaRow.className = 'detail-edit-inline detail-edit-meta detail-edit-grid-span';
      const footerRow = document.createElement('div');
      footerRow.className = 'detail-edit-inline detail-edit-footer detail-edit-grid-span';
      const preferred = this._preferredRadio('address', this._isPreferred(address?.types || []));
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove Address';
      removeBtn.addEventListener('click', () => item.remove());

      metaRow.appendChild(typeSelect);
      metaRow.appendChild(typeInput);
      footerRow.appendChild(preferred);
      footerRow.appendChild(removeBtn);

      grid.appendChild(street);
      grid.appendChild(city);
      grid.appendChild(state);
      grid.appendChild(zip);
      grid.appendChild(country);
      grid.appendChild(metaRow);
      item.appendChild(grid);

      const help = document.createElement('div');
      help.className = 'detail-edit-help';
      help.textContent = 'Choose a type. Select Custom to enter your own.';
      item.appendChild(help);
      item.appendChild(footerRow);
      multi.appendChild(item);
    };

    if (addresses.length > 0) addresses.forEach(addItem);
    else addItem();

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Address';
    addBtn.addEventListener('click', () => addItem());
    wrap.appendChild(addBtn);

    return wrap;
  }

  /**
   * Read the current edit-form DOM state into the contact model (including any
   * open inline relationship editors). Shared by Save and by the "Add
   * Relationship" flow so adding a relationship mid-edit doesn't discard
   * in-progress field edits. Does NOT exit edit mode or rebuild.
   */
  _commitEditFormToModel(contact) {
    this._commitOpenRelationshipEditors(contact);

    contact.name = {
      given: document.getElementById('edit-name-given')?.value.trim() || '',
      additional: document.getElementById('edit-name-additional')?.value.trim() || '',
      family: document.getElementById('edit-name-family')?.value.trim() || '',
      prefix: document.getElementById('edit-name-prefix')?.value.trim() || '',
      suffix: document.getElementById('edit-name-suffix')?.value.trim() || '',
    };
    const explicitDisplayName = document.getElementById('edit-fn')?.value.trim() || '';
    contact.fn = explicitDisplayName || this._composeDisplayName(contact.name) || contact.fn;
    contact.isCompany = !!document.getElementById('edit-is-company')?.checked;
    contact.org = document.getElementById('edit-org')?.value.trim() || '';
    contact.title = document.getElementById('edit-title')?.value.trim() || '';
    contact.birthday = document.getElementById('edit-bday')?.value || null;
    contact.anniversary = document.getElementById('edit-anniversary')?.value || null;
    if (document.getElementById('edit-photo-remove')?.value === '1') {
      contact.photo = null;
    } else {
      contact.photo = document.getElementById('edit-photo-data')?.value || null;
    }
    contact.notes = this._splitNotes(document.getElementById('edit-notes')?.value || '');
    contact.emails = this._collectEditedCollection('email').map((entry) => ({
      value: entry.value,
      types: entry.types,
    }));
    contact.phones = this._collectEditedCollection('phone').map((entry) => ({
      value: entry.value,
      types: entry.types,
    }));
    contact.urls = this._collectEditedCollection('url').map((entry) => ({
      value: entry.value,
      types: entry.types,
    }));
    contact.addresses = this._collectEditedAddresses();
    contact.customFields = this._collectEditedCustomFields(
      contact.customFields || contact.record?.fields || {},
    );
    contact.noteTags = this.parser._extractHashtags(contact.notes);
    contact.tags = this.parser._inferTags(contact);
    this._rewriteEditableFields(contact);
  }

  _saveDetailEdits() {
    if (!this._editingContactId) return;
    const contact = this._contact(this._editingContactId);
    if (!contact) return;

    this._commitEditFormToModel(contact);

    this.builder = new RelationshipBuilder(this.contacts);
    this._editingContactId = null;
    this._rebuildGraph();
    void this._persistSession();

    const refreshed = this._node(contact.id);
    if (refreshed) this._onNodeSelect(refreshed);
    this._showToast('Contact details updated', 'success');
  }

  _collectEditedCollection(kind) {
    const entries = [...document.querySelectorAll(`.detail-edit-item[data-kind="${kind}"]`)]
      .map((item) => {
        const valueInput = item.querySelector('input[data-role="value"]');
        const typesInput = item.querySelector('input[data-role="types-custom"]');
        return {
          value: valueInput?.value.trim() || '',
          types: this._normalizeStoredTypes(
            kind,
            this._selectedTypesFromEditor(
              kind,
              item.querySelector('select[data-role="types-select"]')?.value ||
                this._defaultTypeOption(kind),
              typesInput?.value || '',
            ),
            !!item.querySelector('input[data-role="preferred"]')?.checked,
          ),
        };
      })
      .filter((entry) => entry.value);
    return this._ensureSinglePreferred(entries, kind);
  }

  _collectEditedAddresses() {
    const entries = [...document.querySelectorAll('.detail-edit-item[data-kind="address"]')]
      .map((item) => {
        const street = item.querySelector('[data-addr="street"]');
        if (!street) return null;
        return {
          pobox: '',
          ext: '',
          street: street.value.trim(),
          city: item.querySelector('[data-addr="city"]').value.trim(),
          state: item.querySelector('[data-addr="state"]').value.trim(),
          zip: item.querySelector('[data-addr="zip"]').value.trim(),
          country: item.querySelector('[data-addr="country"]').value.trim(),
          types: this._normalizeStoredTypes(
            'address',
            this._selectedTypesFromEditor(
              'address',
              item.querySelector('select[data-addr="type-select"]')?.value ||
                this._defaultTypeOption('address'),
              item.querySelector('[data-addr="types"]')?.value || '',
            ),
            !!item.querySelector('input[data-role="preferred"]')?.checked,
          ),
        };
      })
      .filter(
        (addr) => addr && (addr.street || addr.city || addr.state || addr.zip || addr.country),
      );
    return this._ensureSinglePreferred(entries, 'address');
  }

  _collectEditedCustomFields(existingFields = {}) {
    const fields = JSON.parse(JSON.stringify(existingFields || {}));
    for (const item of [
      ...document.querySelectorAll('.detail-edit-item[data-kind="custom-field"]'),
    ]) {
      const key = item.dataset.fieldKey;
      if (!key || !fields[key]) continue;
      const field = this._normalizeCustomField(fields[key]);
      if (field.type === 'list' && Array.isArray(field.value)) {
        fields[key] = {
          ...field,
          value: [...item.querySelectorAll('input[data-role="custom-list-value"]')]
            .map((input) => input.value.trim())
            .filter(Boolean),
        };
      } else if (this._isEditableCustomScalar(field)) {
        const input = item.querySelector('input[data-role="custom-value"]');
        if (!input) continue;
        fields[key] = {
          ...field,
          value: this._coerceCustomScalarValue(input, field.type),
        };
      }
    }
    return fields;
  }

  _splitNotes(text) {
    return text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  _buildTypeParams(types = []) {
    return VCardUtils.buildTypeParams(types);
  }

  _photoLines(dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:')) return [];
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return [];

    const mime = m[1].toLowerCase();
    const base64 = m[2].replace(/\s+/g, '');
    const type = mime === 'image/png' ? 'PNG' : mime === 'image/gif' ? 'GIF' : 'JPEG';
    const firstChunk = base64.slice(0, 72);
    const rest = base64.slice(72);
    const lines = [`PHOTO;ENCODING=b;TYPE=${type}:${firstChunk}`];
    for (let i = 0; i < rest.length; i += 72) {
      lines.push(` ${rest.slice(i, i + 72)}`);
    }
    return lines;
  }

  _rewriteEditableFields(contact) {
    if (!contact.rawVCard) return;

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
      if (
        [
          'FN',
          'N',
          'ORG',
          'TITLE',
          'EMAIL',
          'TEL',
          'ADR',
          'BDAY',
          'NOTE',
          'URL',
          'PHOTO',
          'X-ABSHOWAS',
        ].includes(prop)
      )
        continue;
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
        props.has('EMAIL') || props.has('TEL') || props.has('ADR') || props.has('URL');
      const anniversaryGroup = props.has('X-ABDATE') && this._isAnniversaryItemGroup(groupLines);
      const relatedGroup = props.has('X-ABRELATEDNAMES');
      // Drop the groups we regenerate from the model below (editable contact
      // fields, anniversary, relationships); keep everything else (obscure
      // Apple item groups) verbatim.
      if (!editableContactGroup && !anniversaryGroup && !relatedGroup) {
        keptItemLines.push(...groupLines);
      }
    }

    const generated = [];
    const name = contact.name || this._namePartsFromDisplayName(contact.fn || '');
    generated.push(`FN:${this._vCardEscape(contact.fn || '')}`);
    generated.push(
      `N:${this._vCardEscape(name.family || '')};${this._vCardEscape(name.given || '')};${this._vCardEscape(name.additional || '')};${this._vCardEscape(name.prefix || '')};${this._vCardEscape(name.suffix || '')}`,
    );
    if (contact.isCompany) generated.push('X-ABSHOWAS:COMPANY');
    if (contact.org) generated.push(`ORG:${this._vCardEscape(contact.org)}`);
    if (contact.title) generated.push(`TITLE:${this._vCardEscape(contact.title)}`);
    generated.push(...this._photoLines(contact.photo));
    for (const email of contact.emails || []) {
      generated.push(
        `EMAIL${this._buildTypeParams(email.types)}:${this._vCardEscape(email.value)}`,
      );
    }
    for (const phone of contact.phones || []) {
      generated.push(`TEL${this._buildTypeParams(phone.types)}:${this._vCardEscape(phone.value)}`);
    }
    for (const address of contact.addresses || []) {
      const params = this._buildTypeParams(address.types);
      generated.push(
        `ADR${params}:;;${this._vCardEscape(address.street || '')};${this._vCardEscape(address.city || '')};${this._vCardEscape(address.state || '')};${this._vCardEscape(address.zip || '')};${this._vCardEscape(address.country || '')}`,
      );
    }
    for (const urlEntry of contact.urls || []) {
      const urlValue = typeof urlEntry === 'string' ? urlEntry : urlEntry.value;
      const urlTypes = typeof urlEntry === 'string' ? [] : urlEntry.types || [];
      if (!urlValue) continue;
      generated.push(`URL${this._buildTypeParams(urlTypes)}:${this._vCardEscape(urlValue)}`);
    }
    if (contact.birthday) generated.push(`BDAY:${contact.birthday}`);
    for (const note of contact.notes || []) {
      generated.push(`NOTE:${this._vCardEscape(note)}`);
    }
    if (contact.anniversary) {
      generated.push(`item${nextItem}.X-ABDATE:${contact.anniversary}`);
      generated.push(`item${nextItem}.X-ABLabel:_$!<Anniversary>!$_`);
      nextItem += 1;
    }
    // Relationships regenerated from the model — contact.related is the single
    // source of truth; the raw X-ABRELATEDNAMES groups are derived, not patched.
    for (const rel of contact.related || []) {
      if (!rel || !rel.name) continue;
      const label = rel.rawType || this._typeToVCardLabel(rel.type);
      generated.push(`item${nextItem}.X-ABRELATEDNAMES:${this._vCardEscape(rel.name)}`);
      generated.push(`item${nextItem}.X-ABLabel:${label}`);
      nextItem += 1;
    }

    const body = [
      begin,
      version || 'VERSION:3.0',
      ...keptSimple,
      ...generated,
      ...keptItemLines,
      end,
    ];
    contact.rawVCard = this._joinVCardLines(body);
    this._syncContactRecord(contact);
  }

  _composeDisplayName(name) {
    if (!name) return '';
    return [name.prefix, name.given, name.additional, name.family, name.suffix]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _isAnniversaryItemGroup(groupLines) {
    for (const line of groupLines || []) {
      const parsed = VCardUtils.parseContentLine(line);
      if (!parsed || parsed.name !== 'X-ABLABEL') continue;
      if (this._decodeVCardValue(parsed.value).toLowerCase().includes('anniversary')) return true;
    }
    return false;
  }

  _customFieldEntries(contact) {
    return Object.entries(contact?.customFields || contact?.record?.fields || {})
      .filter(([, field]) => field != null)
      .sort(([a], [b]) => a.localeCompare(b));
  }

  _normalizeCustomField(field) {
    if (
      field &&
      typeof field === 'object' &&
      !Array.isArray(field) &&
      'type' in field &&
      'value' in field
    ) {
      return field;
    }
    return { type: this._customFieldType(field), value: field };
  }

  _customFieldType(value) {
    if (Array.isArray(value)) return 'list';
    if (value == null) return 'unknown';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }

  _customFieldLabel(key) {
    return (
      String(key || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase()) || 'Custom Field'
    );
  }

  _customFieldDisplayValue(fieldInput) {
    const field = this._normalizeCustomField(fieldInput);
    if (field.value == null) return '';
    if (Array.isArray(field.value))
      return field.value.map((value) => this._customFieldDisplayValue(value)).join(', ');
    if (typeof field.value === 'object') return JSON.stringify(field.value, null, 2);
    if (typeof field.value === 'boolean') return field.value ? 'Yes' : 'No';
    return String(field.value);
  }

  _isEditableCustomScalar(field) {
    return (
      ['string', 'number', 'boolean', 'date', 'color', 'markdown', 'unknown'].includes(
        field.type || 'unknown',
      ) &&
      (field.value == null || typeof field.value !== 'object')
    );
  }

  _coerceCustomScalarValue(input, type) {
    if (type === 'boolean') return !!input.checked;
    if (type === 'number') return input.value === '' ? null : Number(input.value);
    return input.value;
  }

  _namePartsFromDisplayName(displayName) {
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

  _typePlaceholder(kind) {
    const examples = {
      email: 'custom email type',
      phone: 'custom phone type',
      address: 'custom address type',
      url: 'custom website type',
    };
    return examples[kind] || 'custom type';
  }

  _preferredRadio(kind, checked) {
    const label = document.createElement('label');
    label.className = 'detail-preferred-toggle';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `preferred-${kind}`;
    input.dataset.role = 'preferred';
    input.checked = !!checked;

    const text = document.createElement('span');
    text.textContent = 'Preferred';

    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  _typeSelect(kind, selectedValue, role = 'types-select') {
    const select = document.createElement('select');
    select.className = 'form-control detail-type-select';
    select.dataset.role = role;
    if (role === 'addr-type-select') {
      select.dataset.addr = 'type-select';
    }

    for (const option of this._typeOptions(kind)) {
      const el = document.createElement('option');
      el.value = option;
      el.textContent = this._typeOptionLabel(option);
      select.appendChild(el);
    }
    select.value = selectedValue || this._defaultTypeOption(kind);

    return select;
  }

  _typeOptions(kind) {
    const options = {
      email: ['home', 'work', 'school', 'icloud', 'other', 'custom'],
      phone: ['mobile', 'iphone', 'home', 'work', 'main', 'fax', 'other', 'custom'],
      address: ['home', 'work', 'mailing', 'billing', 'other', 'custom'],
      url: ['home', 'work', 'profile', 'blog', 'portfolio', 'other', 'custom'],
    };
    return options[kind] || ['home', 'work', 'other', 'custom'];
  }

  _addressInput(placeholder, key, value) {
    const input = document.createElement('input');
    input.className = 'form-control';
    input.placeholder = placeholder;
    input.dataset.addr = key;
    input.value = value;
    return input;
  }

  _customTypeInput(kind, roleOrAddr, value, isVisible) {
    const input = document.createElement('input');
    input.className = 'form-control detail-type-input';
    input.placeholder = this._typePlaceholder(kind);
    input.value = value || '';
    if (!isVisible) input.classList.add('hidden');
    if (roleOrAddr === 'types-custom') {
      input.dataset.role = roleOrAddr;
    } else {
      input.dataset.addr = roleOrAddr;
    }
    return input;
  }

  _visibleTypes(kind, types = []) {
    const hidden = new Set(this._hiddenTypes(kind));
    return (types || []).filter((type) => !hidden.has(String(type || '').toUpperCase()));
  }

  _typeSelectionState(kind, types = []) {
    const visible = this._visibleTypes(kind, types);
    if (visible.length === 0) {
      return { selected: this._defaultTypeOption(kind), customValue: '' };
    }
    if (visible.length === 1) {
      const normalized = String(visible[0]).trim().toLowerCase();
      if (this._typeOptions(kind).includes(normalized) && normalized !== 'custom') {
        return { selected: normalized, customValue: '' };
      }
    }
    return { selected: 'custom', customValue: visible.join(', ') };
  }

  _defaultTypeOption(kind) {
    return this._typeOptions(kind).includes('other') ? 'other' : this._typeOptions(kind)[0];
  }

  _selectedTypesFromEditor(kind, selectedValue, customValue) {
    if (selectedValue === 'custom') {
      return String(customValue || '')
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean)
        .filter(
          (type, index, arr) =>
            arr.findIndex((other) => other.toLowerCase() === type.toLowerCase()) === index,
        );
    }
    return selectedValue ? [selectedValue] : [this._defaultTypeOption(kind)];
  }

  _typeOptionLabel(value) {
    if (value === 'icloud') return 'iCloud';
    if (value === 'custom') return 'Custom';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  _bindTypeEditor(select, customInput) {
    const sync = () => {
      const isCustom = select.value === 'custom';
      customInput.classList.toggle('hidden', !isCustom);
      if (!isCustom) customInput.value = '';
    };
    select.addEventListener('change', sync);
    sync();
  }

  _hiddenTypes(kind) {
    const hidden = {
      email: ['PREF', 'INTERNET'],
      phone: ['PREF', 'VOICE'],
      address: ['PREF'],
      url: ['PREF'],
    };
    return hidden[kind] || ['PREF'];
  }

  _defaultHiddenTypes(kind) {
    const defaults = {
      email: ['INTERNET'],
      phone: ['VOICE'],
      address: [],
      url: [],
    };
    return defaults[kind] || [];
  }

  _isPreferred(types = []) {
    return (types || []).some((type) => String(type || '').toUpperCase() === 'PREF');
  }

  _normalizeStoredTypes(kind, visibleTypes = [], preferred = false) {
    const allTypes = [
      ...this._defaultHiddenTypes(kind),
      ...visibleTypes,
      ...(preferred ? ['PREF'] : []),
    ];

    return allTypes
      .map((type) => String(type || '').trim())
      .filter(Boolean)
      .filter((type, index, arr) => {
        const upper = type.toUpperCase();
        return (
          arr.findIndex(
            (other) =>
              String(other || '')
                .trim()
                .toUpperCase() === upper,
          ) === index
        );
      });
  }

  _ensureSinglePreferred(entries, kind) {
    if (!entries.length) return entries;

    let preferredFound = false;
    for (const entry of entries) {
      const isPreferred = this._isPreferred(entry.types);
      if (isPreferred && !preferredFound) {
        preferredFound = true;
        continue;
      }
      if (isPreferred && preferredFound) {
        entry.types = entry.types.filter((type) => String(type || '').toUpperCase() !== 'PREF');
      }
    }

    if (!preferredFound) {
      entries[0].types = this._normalizeStoredTypes(
        kind,
        this._visibleTypes(kind, entries[0].types),
        true,
      );
    }

    return entries;
  }
}

applyMixin(ContactRelationshipApp.prototype, EditingMixin);
