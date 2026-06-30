import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';
import { VCardUtils } from './vcard-utils.js';
import { typeTaxonomy } from './contact-types.js';

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

  _joinVCardLines(lines) {
    return VCardUtils.foldLines(lines);
  }

  _insertBeforeEndVCard(rawVCard, foldedLines) {
    const block = String(foldedLines || '').replace(/\r\n$/, '');
    return String(rawVCard || '').replace(/END:VCARD/i, `${block}\r\nEND:VCARD`);
  }

  /**
   * Split a leading URI scheme off an IM/social value so the UI can show just the
   * handle while the scheme is preserved for round-trip. `xmpp:Nathan.Lee` →
   * { scheme: 'xmpp:', handle: 'Nathan.Lee' }; `x-apple:edifyyo` → { 'x-apple:',
   * 'edifyyo' }. Real web URLs (http/https) are left whole (scheme '').
   */
  _splitUriScheme(value) {
    const str = String(value || '');
    const m = str.match(/^([a-z][a-z0-9.+-]*:)(.*)$/i);
    if (!m || /^https?:/i.test(m[1])) return { scheme: '', handle: str };
    return { scheme: m[1], handle: m[2] };
  }

  _imHandle(value) {
    return this._splitUriScheme(value).handle;
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

    const contact = this._makeMinimalContact(node.name || 'New Contact');

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

    contactInfo.appendChild(this._detailRow('👤', node.name, 'Full Name'));
    if (node.nickname) contactInfo.appendChild(this._detailRow('🙂', node.nickname, 'Nickname'));
    if (node.maidenName)
      contactInfo.appendChild(this._detailRow('👤', node.maidenName, 'Maiden Name'));
    if (node.phoneticFirst || node.phoneticLast)
      contactInfo.appendChild(
        this._detailRow(
          '🔤',
          [node.phoneticFirst, node.phoneticLast].filter(Boolean).join(' '),
          'Phonetic Name',
        ),
      );
    if (node.org) contactInfo.appendChild(this._detailRow('🏢', node.org, 'Organization'));
    if (node.department)
      contactInfo.appendChild(this._detailRow('🏬', node.department, 'Department'));
    if (node.phoneticOrg)
      contactInfo.appendChild(this._detailRow('🔤', node.phoneticOrg, 'Phonetic Org'));
    if (node.title) contactInfo.appendChild(this._detailRow('💼', node.title, 'Title'));

    for (const email of node.emails || []) {
      const emailValue = String(email.value || '').replace(/[\r\n]/g, '');
      const row = this._detailRowHtml(
        '✉️',
        `<a href="mailto:${this._escapeHtml(emailValue)}">${this._escapeHtml(emailValue)}</a>`,
        email.label ||
          (email.types || []).filter((t) => !['INTERNET', 'PREF'].includes(t)).join(', ') ||
          'Email',
      );
      contactInfo.appendChild(row);
    }

    for (const phone of node.phones || []) {
      const row = this._detailRow(
        '📞',
        phone.value,
        phone.label ||
          (phone.types || []).filter((t) => !['VOICE', 'PREF'].includes(t)).join(', ') ||
          'Phone',
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
        this._detailRowHtml(
          '📍',
          html,
          address.label ||
            this._visibleTypes('address', address.types || []).join(', ') ||
            'Address',
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
      const urlLabel = typeof urlEntry === 'string' ? '' : urlEntry.label;
      contactInfo.appendChild(
        this._detailRowHtml(
          '🔗',
          safeHref
            ? `<a href="${this._escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`
            : safeUrl,
          urlLabel || types.join(', ') || 'Website',
        ),
      );
    }

    for (const im of node.ims || []) {
      if (!im?.value) continue;
      // Show the handle (scheme stripped) and surface the service as the label —
      // a custom label, if any, is appended so neither is hidden.
      const imLabel = [im.service, im.label].filter(Boolean).join(' · ') || 'Instant Message';
      contactInfo.appendChild(this._detailRow('💬', this._imHandle(im.value), imLabel));
    }

    for (const sp of node.socialProfiles || []) {
      if (!sp?.url) continue;
      const safeHref = this._safeExternalHref(sp.url);
      // Prefer the explicit username; otherwise show the handle (scheme stripped).
      const handle = sp.username || this._splitUriScheme(sp.url).handle;
      const safeHandle = this._escapeHtml(handle);
      const spLabel = [sp.service, sp.label].filter(Boolean).join(' · ') || 'Social Profile';
      contactInfo.appendChild(
        safeHref
          ? this._detailRowHtml(
              '🌐',
              `<a href="${this._escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${safeHandle}</a>`,
              spLabel,
            )
          : this._detailRow('🌐', handle, spLabel),
      );
    }

    if (node.birthday)
      contactInfo.appendChild(
        this._detailRow('🎂', this._formatBirthday(node.birthday), 'Birthday'),
      );
    if (node.altBirthday)
      contactInfo.appendChild(this._detailRow('🌙', node.altBirthday, 'Alternate Birthday'));
    if (node.anniversary)
      contactInfo.appendChild(
        this._detailRow('💍', this._formatDateWithYears(node.anniversary), 'Anniversary'),
      );
    for (const dateEntry of node.dates || []) {
      if (!dateEntry?.value) continue;
      contactInfo.appendChild(
        this._detailRow(
          '📅',
          this._formatDateWithYears(dateEntry.value),
          dateEntry.label || 'Date',
        ),
      );
    }
    this._renderReadOnlyCustomFields(contactInfo, node);
  }

  _detailField(label, value) {
    return this._detailRow('•', value, label);
  }

  _renderReadOnlyCustomFields(container, contact) {
    const entries = this._customFieldEntries(contact);
    if (entries.length === 0) return;

    for (const [key, rawField] of entries) {
      const field = this._normalizeCustomField(rawField);
      container.appendChild(
        this._detailRow(
          '◆',
          this._customFieldDisplayValue(field),
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
    grid.appendChild(this._editField('Nickname', 'edit-nickname', contact.nickname || ''));
    grid.appendChild(this._editField('Maiden Name', 'edit-maiden-name', contact.maidenName || ''));
    grid.appendChild(
      this._editField('Phonetic First', 'edit-phonetic-first', contact.phoneticFirst || ''),
    );
    grid.appendChild(
      this._editField('Phonetic Last', 'edit-phonetic-last', contact.phoneticLast || ''),
    );
    grid.appendChild(
      this._editCheckboxField('Treat as Company', 'edit-is-company', !!contact.isCompany),
    );
    grid.appendChild(this._editField('Organization', 'edit-org', contact.org || ''));
    grid.appendChild(this._editField('Department', 'edit-department', contact.department || ''));
    grid.appendChild(
      this._editField('Phonetic Org', 'edit-phonetic-org', contact.phoneticOrg || ''),
    );
    grid.appendChild(this._editField('Title', 'edit-title', contact.title || ''));
    grid.appendChild(this._editGenderField(contact.gender || ''));
    grid.appendChild(this._editField('Birthday', 'edit-bday', contact.birthday || '', 'date'));
    grid.appendChild(
      this._editField('Anniversary', 'edit-anniversary', contact.anniversary || '', 'date'),
    );
    grid.appendChild(this._editDatesField(contact.dates || []));
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
    grid.appendChild(this._editImField(contact.ims || []));
    grid.appendChild(this._editSocialField(contact.socialProfiles || []));
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
      preview.style.backgroundImage = this._cssUrl(dataUrl);
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
          detailPhoto.style.backgroundImage = this._cssUrl(dataUrl);
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

  // Gender select — vCard sex code stored as the option value ('M'/'F'/'').
  _editGenderField(value) {
    const row = document.createElement('div');
    row.className = 'detail-edit-row';
    const sel = (v) => (value === v ? ' selected' : '');
    row.innerHTML = `
      <label class="detail-edit-label" for="edit-gender">Gender</label>
      <select class="form-control" id="edit-gender">
        <option value=""${sel('')}>Unspecified</option>
        <option value="M"${sel('M')}>Male</option>
        <option value="F"${sel('F')}>Female</option>
      </select>
    `;
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

      const typeControls = this._renderTypeControls(kind, entry);
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
      help.textContent =
        'Check all that apply, or add a custom label. Note that Apple Contacts will pick one label to display.';

      metaRow.appendChild(typeControls);
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

  /** Editor for additional custom-labeled dates (label + date pairs). */
  _editDatesField(dates) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row';
    wrap.innerHTML = `<div class="detail-edit-label">Other Dates</div>`;

    const multi = document.createElement('div');
    multi.className = 'detail-edit-multi';
    wrap.appendChild(multi);

    const addItem = (entry = null) => {
      const item = document.createElement('div');
      item.className = 'detail-edit-item';
      item.dataset.kind = 'date';

      const labelInput = document.createElement('input');
      labelInput.className = 'form-control';
      labelInput.dataset.role = 'date-label';
      labelInput.placeholder = 'Label (e.g. First met)';
      labelInput.value = entry?.label || '';

      const valueInput = document.createElement('input');
      valueInput.className = 'form-control';
      valueInput.type = 'date';
      valueInput.dataset.role = 'date-value';
      valueInput.value = entry?.value || '';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => item.remove());

      const row = document.createElement('div');
      row.className = 'detail-edit-inline';
      row.append(labelInput, valueInput, removeBtn);
      item.appendChild(row);
      multi.appendChild(item);
    };

    if (dates.length > 0) dates.forEach(addItem);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Date';
    addBtn.addEventListener('click', () => addItem());
    wrap.appendChild(addBtn);

    return wrap;
  }

  _collectEditedDates() {
    return [...document.querySelectorAll('.detail-edit-item[data-kind="date"]')]
      .map((item) => ({
        label: item.querySelector('input[data-role="date-label"]')?.value.trim() || '',
        value: item.querySelector('input[data-role="date-value"]')?.value || '',
      }))
      .filter((entry) => entry.value)
      .map((entry) => ({ label: entry.label || 'Date', value: entry.value }));
  }

  /** Editor for instant-message handles (handle + service + optional label). */
  _editImField(ims) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row';
    wrap.innerHTML = `<div class="detail-edit-label">Instant Messages</div>`;

    const multi = document.createElement('div');
    multi.className = 'detail-edit-multi';
    wrap.appendChild(multi);

    const addItem = (entry = null) => {
      const item = document.createElement('div');
      item.className = 'detail-edit-item';
      item.dataset.kind = 'im';

      const { scheme, handle } = this._splitUriScheme(entry?.value || '');
      const valueInput = document.createElement('input');
      valueInput.className = 'form-control';
      valueInput.dataset.role = 'im-value';
      valueInput.placeholder = 'Handle';
      valueInput.value = handle;

      // Preserve the original URI scheme (xmpp:/aim:/x-apple:…) and TYPE params
      // (HOME/WORK/PREF) that the editor doesn't surface, so an untouched IM
      // round-trips byte-for-byte.
      const schemeStash = document.createElement('input');
      schemeStash.type = 'hidden';
      schemeStash.dataset.role = 'im-scheme';
      schemeStash.value = scheme;
      const typesStash = document.createElement('input');
      typesStash.type = 'hidden';
      typesStash.dataset.role = 'im-types';
      typesStash.value = JSON.stringify(entry?.types || []);

      const serviceInput = document.createElement('input');
      serviceInput.className = 'form-control';
      serviceInput.dataset.role = 'im-service';
      serviceInput.placeholder = 'Service (e.g. Skype)';
      serviceInput.value = entry?.service || '';

      const labelInput = document.createElement('input');
      labelInput.className = 'form-control';
      labelInput.dataset.role = 'im-label';
      labelInput.placeholder = 'Custom label (optional)';
      labelInput.value = entry?.label || '';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => item.remove());

      const valueRow = document.createElement('div');
      valueRow.className = 'detail-edit-stack';
      valueRow.append(valueInput, schemeStash, typesStash);
      const metaRow = document.createElement('div');
      metaRow.className = 'detail-edit-inline detail-edit-meta';
      metaRow.append(serviceInput, labelInput);
      const footerRow = document.createElement('div');
      footerRow.className = 'detail-edit-inline detail-edit-footer';
      footerRow.appendChild(removeBtn);

      item.append(valueRow, metaRow, footerRow);
      multi.appendChild(item);
    };

    if (ims.length > 0) ims.forEach(addItem);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Instant Message';
    addBtn.addEventListener('click', () => addItem());
    wrap.appendChild(addBtn);

    return wrap;
  }

  _collectEditedIms() {
    return [...document.querySelectorAll('.detail-edit-item[data-kind="im"]')]
      .map((item) => {
        const handle = item.querySelector('input[data-role="im-value"]')?.value.trim() || '';
        const scheme = item.querySelector('input[data-role="im-scheme"]')?.value || '';
        let types = [];
        try {
          types = JSON.parse(item.querySelector('input[data-role="im-types"]')?.value || '[]');
        } catch {
          types = [];
        }
        return {
          value: handle ? scheme + handle : '',
          service: item.querySelector('input[data-role="im-service"]')?.value.trim() || '',
          label: item.querySelector('input[data-role="im-label"]')?.value.trim() || '',
          types,
        };
      })
      .filter((im) => im.value);
  }

  /** Editor for social profiles (URL + service + username + optional label). */
  _editSocialField(profiles) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-edit-row';
    wrap.innerHTML = `<div class="detail-edit-label">Social Profiles</div>`;

    const multi = document.createElement('div');
    multi.className = 'detail-edit-multi';
    wrap.appendChild(multi);

    const addItem = (entry = null) => {
      const item = document.createElement('div');
      item.className = 'detail-edit-item';
      item.dataset.kind = 'social';

      const { scheme: urlScheme, handle: urlHandle } = this._splitUriScheme(entry?.url || '');
      const urlInput = document.createElement('input');
      urlInput.className = 'form-control';
      urlInput.dataset.role = 'social-url';
      urlInput.placeholder = 'Profile URL or handle';
      urlInput.value = urlHandle;

      // Preserve a custom URI scheme (e.g. x-apple:) so the handle shows cleanly
      // but the original value round-trips. Web URLs keep their full value here.
      const urlSchemeStash = document.createElement('input');
      urlSchemeStash.type = 'hidden';
      urlSchemeStash.dataset.role = 'social-scheme';
      urlSchemeStash.value = urlScheme;

      const serviceInput = document.createElement('input');
      serviceInput.className = 'form-control';
      serviceInput.dataset.role = 'social-service';
      serviceInput.placeholder = 'Service (e.g. Twitter)';
      serviceInput.value = entry?.service || '';

      const userInput = document.createElement('input');
      userInput.className = 'form-control';
      userInput.dataset.role = 'social-username';
      userInput.placeholder = 'Username (optional)';
      userInput.value = entry?.username || '';

      const labelInput = document.createElement('input');
      labelInput.className = 'form-control';
      labelInput.dataset.role = 'social-label';
      labelInput.placeholder = 'Custom label (optional)';
      labelInput.value = entry?.label || '';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => item.remove());

      const valueRow = document.createElement('div');
      valueRow.className = 'detail-edit-stack';
      valueRow.append(urlInput, urlSchemeStash);
      const metaRow = document.createElement('div');
      metaRow.className = 'detail-edit-inline detail-edit-meta';
      metaRow.append(serviceInput, userInput, labelInput);
      const footerRow = document.createElement('div');
      footerRow.className = 'detail-edit-inline detail-edit-footer';
      footerRow.appendChild(removeBtn);

      item.append(valueRow, metaRow, footerRow);
      multi.appendChild(item);
    };

    if (profiles.length > 0) profiles.forEach(addItem);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Social Profile';
    addBtn.addEventListener('click', () => addItem());
    wrap.appendChild(addBtn);

    return wrap;
  }

  _collectEditedSocialProfiles() {
    return [...document.querySelectorAll('.detail-edit-item[data-kind="social"]')]
      .map((item) => {
        const handle = item.querySelector('input[data-role="social-url"]')?.value.trim() || '';
        const scheme = item.querySelector('input[data-role="social-scheme"]')?.value || '';
        return {
          url: handle ? scheme + handle : '',
          service: item.querySelector('input[data-role="social-service"]')?.value.trim() || '',
          username: item.querySelector('input[data-role="social-username"]')?.value.trim() || '',
          label: item.querySelector('input[data-role="social-label"]')?.value.trim() || '',
        };
      })
      .filter((sp) => sp.url);
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
      const typeControls = this._renderTypeControls('address', address);

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

      metaRow.appendChild(typeControls);
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
      help.textContent =
        'Check all that apply, or add a custom label. Note that Apple Contacts will pick one label to display.';
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
    contact.nickname = document.getElementById('edit-nickname')?.value.trim() || '';
    contact.maidenName = document.getElementById('edit-maiden-name')?.value.trim() || '';
    contact.phoneticFirst = document.getElementById('edit-phonetic-first')?.value.trim() || '';
    contact.phoneticLast = document.getElementById('edit-phonetic-last')?.value.trim() || '';
    contact.org = document.getElementById('edit-org')?.value.trim() || '';
    contact.department = document.getElementById('edit-department')?.value.trim() || '';
    contact.phoneticOrg = document.getElementById('edit-phonetic-org')?.value.trim() || '';
    contact.title = document.getElementById('edit-title')?.value.trim() || '';
    contact.gender = document.getElementById('edit-gender')?.value || '';
    contact.birthday = document.getElementById('edit-bday')?.value || null;
    contact.anniversary = document.getElementById('edit-anniversary')?.value || null;
    contact.dates = this._collectEditedDates();
    contact.ims = this._collectEditedIms();
    contact.socialProfiles = this._collectEditedSocialProfiles();
    if (document.getElementById('edit-photo-remove')?.value === '1') {
      contact.photo = null;
    } else {
      contact.photo = document.getElementById('edit-photo-data')?.value || null;
    }
    contact.notes = this._splitNotes(document.getElementById('edit-notes')?.value || '');
    contact.emails = this._collectEditedCollection('email');
    contact.phones = this._collectEditedCollection('phone');
    contact.urls = this._collectEditedCollection('url');
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
        const { types, label } = this._collectTypesFromItem(item);
        return { value: valueInput?.value.trim() || '', types, label };
      })
      .filter((entry) => entry.value);
    return this._ensureSinglePreferred(entries);
  }

  _collectEditedAddresses() {
    const entries = [...document.querySelectorAll('.detail-edit-item[data-kind="address"]')]
      .map((item) => {
        const street = item.querySelector('[data-addr="street"]');
        if (!street) return null;
        const { types, label } = this._collectTypesFromItem(item);
        return {
          pobox: '',
          ext: '',
          street: street.value.trim(),
          city: item.querySelector('[data-addr="city"]').value.trim(),
          state: item.querySelector('[data-addr="state"]').value.trim(),
          zip: item.querySelector('[data-addr="zip"]').value.trim(),
          country: item.querySelector('[data-addr="country"]').value.trim(),
          types,
          label,
        };
      })
      .filter(
        (addr) => addr && (addr.street || addr.city || addr.state || addr.zip || addr.country),
      );
    return this._ensureSinglePreferred(entries);
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
          'NICKNAME',
          'X-MAIDENNAME',
          'X-PHONETIC-FIRST-NAME',
          'X-PHONETIC-LAST-NAME',
          'X-PHONETIC-ORG',
          'ORG',
          'TITLE',
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

    const generated = [];
    const name = contact.name || this._namePartsFromDisplayName(contact.fn || '');
    generated.push(`FN:${this._vCardEscape(contact.fn || '')}`);
    generated.push(
      `N:${this._vCardEscape(name.family || '')};${this._vCardEscape(name.given || '')};${this._vCardEscape(name.additional || '')};${this._vCardEscape(name.prefix || '')};${this._vCardEscape(name.suffix || '')}`,
    );
    if (contact.nickname) generated.push(`NICKNAME:${this._vCardEscape(contact.nickname)}`);
    if (contact.maidenName) generated.push(`X-MAIDENNAME:${this._vCardEscape(contact.maidenName)}`);
    if (contact.phoneticFirst)
      generated.push(`X-PHONETIC-FIRST-NAME:${this._vCardEscape(contact.phoneticFirst)}`);
    if (contact.phoneticLast)
      generated.push(`X-PHONETIC-LAST-NAME:${this._vCardEscape(contact.phoneticLast)}`);
    if (contact.isCompany) generated.push('X-ABSHOWAS:COMPANY');
    if (contact.org || contact.department) {
      const orgValue = contact.department
        ? `${this._vCardEscape(contact.org || '')};${this._vCardEscape(contact.department)}`
        : this._vCardEscape(contact.org || '');
      generated.push(`ORG:${orgValue}`);
    }
    if (contact.phoneticOrg)
      generated.push(`X-PHONETIC-ORG:${this._vCardEscape(contact.phoneticOrg)}`);
    if (contact.title) generated.push(`TITLE:${this._vCardEscape(contact.title)}`);
    if (contact.gender) generated.push(`GENDER:${this._vCardEscape(contact.gender)}`);
    generated.push(...this._photoLines(contact.photo));
    // Emit a contact field as a plain line, or — when the entry carries an Apple
    // custom label — as an item group with an X-ABLabel (so the label survives).
    const pushLabeledField = (prop, params, value, label) => {
      if (label) {
        generated.push(`item${nextItem}.${prop}${params}:${value}`);
        generated.push(`item${nextItem}.X-ABLabel:${this._wrapLabel(label)}`);
        nextItem += 1;
      } else {
        generated.push(`${prop}${params}:${value}`);
      }
    };
    // Hybrid raw preservation: if this instance is unchanged since parse (its
    // content key still maps to original raw line(s)), re-emit those bytes
    // verbatim — preserving Apple's exact TYPE casing/order (e.g. the
    // iPhone TEL;type=IPHONE;type=CELL;type=VOICE;type=pref line). Only edited
    // instances are regenerated from the model.
    const rawByKey = contact._rawByKey || {};
    const pushMethod = (kind, entry, regenerate) => {
      const raw = rawByKey[VCardUtils.contactMethodKey(kind, entry)];
      if (raw && raw.length) generated.push(...raw);
      else regenerate();
    };
    for (const email of contact.emails || []) {
      pushMethod('email', email, () =>
        pushLabeledField(
          'EMAIL',
          this._buildTypeParams(email.types),
          this._vCardEscape(email.value),
          email.label,
        ),
      );
    }
    for (const phone of contact.phones || []) {
      pushMethod('phone', phone, () =>
        pushLabeledField(
          'TEL',
          this._buildTypeParams(phone.types),
          this._vCardEscape(phone.value),
          phone.label,
        ),
      );
    }
    for (const address of contact.addresses || []) {
      pushMethod('address', address, () => {
        const params = this._buildTypeParams(address.types);
        const value = `;;${this._vCardEscape(address.street || '')};${this._vCardEscape(address.city || '')};${this._vCardEscape(address.state || '')};${this._vCardEscape(address.zip || '')};${this._vCardEscape(address.country || '')}`;
        pushLabeledField('ADR', params, value, address.label);
      });
    }
    for (const urlEntry of contact.urls || []) {
      const entry =
        typeof urlEntry === 'string' ? { value: urlEntry, types: [], label: '' } : urlEntry;
      if (!entry.value) continue;
      pushMethod('url', entry, () =>
        pushLabeledField(
          'URL',
          this._buildTypeParams(entry.types || []),
          this._vCardEscape(entry.value),
          entry.label,
        ),
      );
    }
    for (const im of contact.ims || []) {
      if (!im || !im.value) continue;
      pushMethod('im', im, () => {
        const svc = im.service ? `;X-SERVICE-TYPE=${VCardUtils.encodeParamValue(im.service)}` : '';
        const params = svc + this._buildTypeParams(im.types || []);
        pushLabeledField('IMPP', params, this._vCardEscape(im.value), im.label);
      });
    }
    for (const sp of contact.socialProfiles || []) {
      if (!sp || !sp.url) continue;
      pushMethod('social', sp, () => {
        let params = '';
        if (sp.service) params += `;TYPE=${VCardUtils.encodeParamValue(sp.service)}`;
        if (sp.username) params += `;X-USER=${VCardUtils.encodeParamValue(sp.username)}`;
        pushLabeledField('X-SOCIALPROFILE', params, this._vCardEscape(sp.url), sp.label);
      });
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
    for (const dateEntry of contact.dates || []) {
      if (!dateEntry || !dateEntry.value) continue;
      generated.push(`item${nextItem}.X-ABDATE:${dateEntry.value}`);
      generated.push(`item${nextItem}.X-ABLabel:${this._wrapLabel(dateEntry.label || 'Date')}`);
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

  /**
   * Format an X-ABLabel: Apple's predefined labels are wrapped in `_$!<…>!$_`,
   * custom labels are written plain (so Apple doesn't show the literal markers).
   */
  _wrapLabel(label) {
    return VCardUtils.formatXABLabel(label);
  }

  _composeDisplayName(name) {
    if (!name) return '';
    return [name.prefix, name.given, name.additional, name.family, name.suffix]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
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

  /**
   * The user-facing standard TYPE set per kind ({ value, label } pairs) — from the
   * shared taxonomy in contact-types.js so the type editor and the Markdown adapter
   * stay in sync. Multi-type lines (e.g. iPhone = IPHONE+CELL) are expressed by
   * checking more than one box; structural types (VOICE/INTERNET) and PREF are not
   * listed here.
   */
  _typeTaxonomy(kind) {
    return typeTaxonomy(kind);
  }

  /**
   * Multi-select type controls for one collection item: a checkbox per standard
   * TYPE (pre-checked from the entry), a free-text custom-label (Apple X-ABLabel),
   * and a hidden stash of "structural" types (VOICE/INTERNET/anything exotic) and
   * PREF so collection reproduces the entry's exact type set. The full set drives
   * hybrid raw preservation: an untouched entry collects back to the same content
   * key and is re-emitted byte-for-byte.
   */
  _renderTypeControls(kind, entry) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-type-controls';

    const taxonomy = this._typeTaxonomy(kind);
    const known = new Set(taxonomy.map((t) => t.value));
    const entryTypes = (entry?.types || []).map((t) => String(t || '').toUpperCase());
    const checked = new Set(entryTypes.filter((t) => known.has(t)));
    // Structural = present types that aren't a checkbox and aren't PREF (kept verbatim).
    const structural = entryTypes.filter((t) => !known.has(t) && t !== 'PREF');

    const checks = document.createElement('div');
    checks.className = 'detail-type-checks';
    for (const { value, label } of taxonomy) {
      const box = document.createElement('label');
      box.className = 'detail-type-check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.role = 'type-check';
      input.value = value;
      input.checked = checked.has(value);
      const span = document.createElement('span');
      span.textContent = label;
      box.appendChild(input);
      box.appendChild(span);
      checks.appendChild(box);
    }
    wrap.appendChild(checks);

    const labelInput = document.createElement('input');
    labelInput.className = 'form-control detail-type-input';
    labelInput.dataset.role = 'type-label';
    labelInput.placeholder = 'Custom label (optional)';
    labelInput.value = entry?.label || '';
    wrap.appendChild(labelInput);

    const stash = document.createElement('input');
    stash.type = 'hidden';
    stash.dataset.role = 'type-structural';
    stash.value = JSON.stringify(structural);
    wrap.appendChild(stash);

    return wrap;
  }

  /** Read the type set + custom label back out of one collection item's DOM. */
  _collectTypesFromItem(item) {
    const checked = [...item.querySelectorAll('input[data-role="type-check"]:checked')].map(
      (c) => c.value,
    );
    let structural = [];
    try {
      structural = JSON.parse(
        item.querySelector('input[data-role="type-structural"]')?.value || '[]',
      );
    } catch {
      structural = [];
    }
    const preferred = !!item.querySelector('input[data-role="preferred"]')?.checked;
    const label = (item.querySelector('input[data-role="type-label"]')?.value || '').trim();
    const types = [...structural, ...checked, ...(preferred ? ['PREF'] : [])]
      .map((t) => String(t || '').toUpperCase())
      .filter((t, i, arr) => t && arr.indexOf(t) === i);
    return { types, label };
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

  _addressInput(placeholder, key, value) {
    const input = document.createElement('input');
    input.className = 'form-control';
    input.placeholder = placeholder;
    input.dataset.addr = key;
    input.value = value;
    return input;
  }

  _visibleTypes(kind, types = []) {
    const hidden = new Set(this._hiddenTypes(kind));
    return (types || []).filter((type) => !hidden.has(String(type || '').toUpperCase()));
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

  _isPreferred(types = []) {
    return (types || []).some((type) => String(type || '').toUpperCase() === 'PREF');
  }

  /**
   * Keep at most one preferred (PREF) entry: if several are marked, the first
   * wins and the rest are de-preferred. Unlike the old behavior, this does NOT
   * invent a preferred when none is set — leaving "no preferred" intact so an
   * untouched contact round-trips exactly.
   */
  _ensureSinglePreferred(entries) {
    let preferredFound = false;
    for (const entry of entries) {
      if (!this._isPreferred(entry.types)) continue;
      if (!preferredFound) {
        preferredFound = true;
      } else {
        entry.types = entry.types.filter((type) => String(type || '').toUpperCase() !== 'PREF');
      }
    }
    return entries;
  }
}

applyMixin(ContactRelationshipApp.prototype, EditingMixin);
