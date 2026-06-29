import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';

/**
 * Table view: the editable spreadsheet-style contact table (render, sortable
 * columns, per-cell editors, add/delete rows) and the graph/table view switch.
 * Extracted from app.js verbatim.
 */
class TableMixin {
  _applyMainViewMode() {
    const graphContainer = document.getElementById('graph-container');
    const tableMode = document.getElementById('table-mode');
    const legend = document.getElementById('graph-legend');
    const graphBtn = document.getElementById('btn-view-graph');
    const tableBtn = document.getElementById('btn-view-table');
    const isTable = this._mainViewMode === 'table';
    tableMode?.classList.toggle('hidden', !isTable);
    graphContainer?.classList.toggle('hidden', isTable);
    legend?.classList.toggle('hidden', isTable);
    graphBtn?.classList.toggle('active', !isTable);
    tableBtn?.classList.toggle('active', isTable);
    if (isTable) this._renderTableMode();
    this._scheduleGraphResize();
  }

  _renderTableMode() {
    if (this._mainViewMode !== 'table') return;
    const head = document.getElementById('contacts-table-head');
    const body = document.getElementById('contacts-table-body');
    if (!head || !body) return;

    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'org', label: 'Organization' },
      { key: 'title', label: 'Title' },
      { key: 'emails', label: 'Emails' },
      { key: 'phones', label: 'Phones' },
      { key: 'urls', label: 'Websites' },
      { key: 'addresses', label: 'Addresses' },
      { key: 'birthday', label: 'Birthday' },
      { key: 'anniversary', label: 'Anniversary' },
      { key: 'tags', label: 'Tags' },
      { key: 'notes', label: 'Notes' },
      { key: 'actions', label: 'Actions' },
    ];

    head.innerHTML = '';
    body.innerHTML = '';

    const headerRow = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      if (col.key === 'actions') {
        th.textContent = col.label;
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        const active = this._tableSort.key === col.key;
        btn.textContent = col.label + (active ? (this._tableSort.dir === 'asc' ? ' ↑' : ' ↓') : '');
        btn.addEventListener('click', () => this._setTableSort(col.key));
        th.appendChild(btn);
      }
      headerRow.appendChild(th);
    }
    head.appendChild(headerRow);

    const contacts = this._filteredContactsForSidebar()
      .map((node) => this._contact(node.id))
      .filter(Boolean)
      .sort((a, b) => this._compareTableContacts(a, b));

    if (contacts.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns.length;
      td.className = 'table-empty';
      td.textContent = 'No contacts match the current search and filters.';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    for (const contact of contacts) {
      const tr = document.createElement('tr');
      tr.dataset.id = contact.id;
      tr.appendChild(this._tableInputCell(contact, 'fn', contact.fn || '', { multiline: false }));
      tr.appendChild(this._tableInputCell(contact, 'org', contact.org || '', { multiline: false }));
      tr.appendChild(
        this._tableInputCell(contact, 'title', contact.title || '', { multiline: false }),
      );
      tr.appendChild(
        this._tableCollectionCell(contact, 'email', contact.emails || [], (entry) => entry.value),
      );
      tr.appendChild(
        this._tableCollectionCell(contact, 'phone', contact.phones || [], (entry) => entry.value),
      );
      tr.appendChild(
        this._tableCollectionCell(contact, 'url', contact.urls || [], (entry) =>
          typeof entry === 'string' ? entry : entry.value,
        ),
      );
      tr.appendChild(this._tableAddressCell(contact));
      tr.appendChild(
        this._tableInputCell(contact, 'birthday', contact.birthday || '', {
          multiline: false,
          type: 'date',
        }),
      );
      tr.appendChild(
        this._tableInputCell(contact, 'anniversary', contact.anniversary || '', {
          multiline: false,
          type: 'date',
        }),
      );
      tr.appendChild(this._tableTagsCell(contact));
      tr.appendChild(
        this._tableInputCell(contact, 'notes', this._notesText(contact.notes), { multiline: true }),
      );
      tr.appendChild(this._tableActionsCell(contact));
      body.appendChild(tr);
    }
  }

  _setTableSort(key) {
    if (this._tableSort.key === key) {
      this._tableSort.dir = this._tableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      this._tableSort = { key, dir: 'asc' };
    }
    this._renderTableMode();
  }

  _compareTableContacts(a, b) {
    const dir = this._tableSort.dir === 'desc' ? -1 : 1;
    const key = this._tableSort.key;
    const get = (contact) => {
      switch (key) {
        case 'name':
          return contact.fn || '';
        case 'org':
          return contact.org || '';
        case 'title':
          return contact.title || '';
        case 'emails':
          return (contact.emails || []).map((e) => e.value).join(' ');
        case 'phones':
          return (contact.phones || []).map((p) => p.value).join(' ');
        case 'urls':
          return (contact.urls || []).map((u) => (typeof u === 'string' ? u : u.value)).join(' ');
        case 'addresses':
          return (contact.addresses || [])
            .map((a) => [a.street, a.city, a.state, a.zip, a.country].filter(Boolean).join(' '))
            .join(' ');
        case 'birthday':
          return contact.birthday || '';
        case 'anniversary':
          return contact.anniversary || '';
        case 'tags':
          return (contact.noteTags || []).join(' ');
        case 'notes':
          return this._notesText(contact.notes);
        default:
          return contact.fn || '';
      }
    };
    return get(a).localeCompare(get(b), undefined, { sensitivity: 'base' }) * dir;
  }

  _tableInputCell(contact, field, value, { multiline = false, type = 'text' } = {}) {
    const td = document.createElement('td');
    const input = multiline ? document.createElement('textarea') : document.createElement('input');
    input.className = multiline ? 'table-cell-textarea' : 'table-cell-input';
    if (!multiline) input.type = type;
    input.value = value || '';
    input.addEventListener('change', () => this._applyTableEdit(contact.id, field, input.value));
    if (multiline && field === 'notes') {
      this._bindNotesAutocomplete(input, false, contact.id);
    }
    td.appendChild(input);
    return td;
  }

  _tableCollectionCell(contact, kind, entries, getValue) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-metadata-list';

    const save = () => {
      const nextEntries = [...wrap.querySelectorAll('.table-metadata-item')]
        .map((item) => {
          const value = item.querySelector('[data-role="value"]')?.value.trim() || '';
          if (!value) return null;
          const { types, label } = this._collectTypesFromItem(item);
          return { value, types, label };
        })
        .filter(Boolean);
      this._ensureSinglePreferred(nextEntries);
      this._applyTableEdit(contact.id, kind === 'url' ? 'urls' : `${kind}s`, nextEntries);
    };

    const addItem = (entry = null) => {
      const item = document.createElement('div');
      item.className = 'table-metadata-item';
      item.dataset.kind = kind;

      const valueInput = document.createElement('input');
      valueInput.className = 'table-cell-input';
      valueInput.dataset.role = 'value';
      valueInput.value = entry ? getValue(entry) : '';
      valueInput.placeholder = this._tableCollectionPlaceholder(kind);

      const typeControls = this._renderTypeControls(kind, entry);
      typeControls.classList.add('table-type-controls');

      const metaRow = document.createElement('div');
      metaRow.className = 'table-metadata-meta';
      metaRow.appendChild(typeControls);

      const footer = document.createElement('div');
      footer.className = 'table-metadata-footer';
      footer.appendChild(
        this._tablePreferredRadio(contact.id, kind, this._isPreferred(entry?.types || [])),
      );

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        item.remove();
        save();
      });
      footer.appendChild(removeBtn);

      valueInput.addEventListener('change', save);
      typeControls.addEventListener('change', save);
      footer.querySelector('input[data-role="preferred"]').addEventListener('change', save);

      item.appendChild(valueInput);
      item.appendChild(metaRow);
      item.appendChild(footer);
      wrap.appendChild(item);
    };

    if (entries.length > 0) entries.forEach(addItem);
    else addItem();

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs table-add-metadata';
    addBtn.type = 'button';
    addBtn.textContent = `+ Add ${this._tableCollectionLabel(kind)}`;
    addBtn.addEventListener('click', () => addItem());

    td.appendChild(wrap);
    td.appendChild(addBtn);
    return td;
  }

  _tableAddressCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-metadata-list';

    const save = () => {
      const nextAddresses = [...wrap.querySelectorAll('.table-address-item')]
        .map((item) => {
          const street = item.querySelector('[data-addr="street"]')?.value.trim() || '';
          const city = item.querySelector('[data-addr="city"]')?.value.trim() || '';
          const state = item.querySelector('[data-addr="state"]')?.value.trim() || '';
          const zip = item.querySelector('[data-addr="zip"]')?.value.trim() || '';
          const country = item.querySelector('[data-addr="country"]')?.value.trim() || '';
          if (!street && !city && !state && !zip && !country) return null;
          const { types, label } = this._collectTypesFromItem(item);
          return { pobox: '', ext: '', street, city, state, zip, country, types, label };
        })
        .filter(Boolean);
      this._ensureSinglePreferred(nextAddresses);
      this._applyTableEdit(contact.id, 'addresses', nextAddresses);
    };

    const addItem = (address = null) => {
      const item = document.createElement('div');
      item.className = 'table-metadata-item table-address-item';

      const fields = document.createElement('div');
      fields.className = 'table-address-grid';
      for (const [label, key, value] of [
        ['Street', 'street', address?.street || ''],
        ['City', 'city', address?.city || ''],
        ['State', 'state', address?.state || ''],
        ['ZIP', 'zip', address?.zip || ''],
        ['Country', 'country', address?.country || ''],
      ]) {
        const input = document.createElement('input');
        input.className = 'table-cell-input';
        input.placeholder = label;
        input.dataset.addr = key;
        input.value = value;
        input.addEventListener('change', save);
        fields.appendChild(input);
      }

      const typeControls = this._renderTypeControls('address', address);
      typeControls.classList.add('table-type-controls');

      const metaRow = document.createElement('div');
      metaRow.className = 'table-metadata-meta';
      metaRow.appendChild(typeControls);

      const footer = document.createElement('div');
      footer.className = 'table-metadata-footer';
      footer.appendChild(
        this._tablePreferredRadio(contact.id, 'address', this._isPreferred(address?.types || [])),
      );

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        item.remove();
        save();
      });
      footer.appendChild(removeBtn);

      typeControls.addEventListener('change', save);
      footer.querySelector('input[data-role="preferred"]').addEventListener('change', save);

      item.appendChild(fields);
      item.appendChild(metaRow);
      item.appendChild(footer);
      wrap.appendChild(item);
    };

    if ((contact.addresses || []).length > 0) contact.addresses.forEach(addItem);
    else addItem();

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-xs table-add-metadata';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Address';
    addBtn.addEventListener('click', () => addItem());

    td.appendChild(wrap);
    td.appendChild(addBtn);
    return td;
  }

  _tableCollectionPlaceholder(kind) {
    const labels = {
      email: 'Email address',
      phone: 'Phone number',
      url: 'Website',
    };
    return labels[kind] || 'Value';
  }

  _tableCollectionLabel(kind) {
    const labels = {
      email: 'Email',
      phone: 'Phone',
      url: 'Website',
    };
    return labels[kind] || 'Value';
  }

  _tablePreferredRadio(contactId, kind, checked) {
    const label = document.createElement('label');
    label.className = 'table-preferred-toggle';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `table-preferred-${kind}-${contactId}`;
    input.dataset.role = 'preferred';
    input.checked = !!checked;

    const text = document.createElement('span');
    text.textContent = 'Preferred';

    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  _tableTagsCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-cell-tags';
    const tags = (contact.noteTags || []).length ? contact.noteTags : [];
    if (!tags.length) {
      const none = document.createElement('span');
      none.className = 'table-tag';
      none.textContent = 'None';
      wrap.appendChild(none);
    } else {
      for (const tag of tags) {
        const el = document.createElement('span');
        el.className = 'table-tag';
        el.textContent = `#${tag}`;
        wrap.appendChild(el);
      }
    }
    td.appendChild(wrap);
    return td;
  }

  _tableActionsCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-row-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-ghost btn-xs';
    openBtn.type = 'button';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => {
      const node = this._node(contact.id);
      if (!node) return;
      this._selectedNodeId = node.id;
      this._mainViewMode = 'graph';
      this._applyMainViewMode();
      this.graph.highlightContact(node.id);
      this._onNodeSelect(node);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-ghost btn-xs';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => this._deleteContact(contact.id));

    wrap.appendChild(openBtn);
    wrap.appendChild(deleteBtn);
    td.appendChild(wrap);
    return td;
  }

  _applyTableEdit(contactId, field, rawValue) {
    const contact = this._contact(contactId);
    if (!contact) return;
    const value = String(rawValue ?? '');
    if (field === 'fn') {
      contact.fn = value.trim();
      contact.name = this._namePartsFromDisplayName(contact.fn || '');
    } else if (field === 'org') {
      contact.org = value.trim();
    } else if (field === 'title') {
      contact.title = value.trim();
    } else if (field === 'birthday') {
      contact.birthday = value || null;
    } else if (field === 'anniversary') {
      contact.anniversary = value || null;
    } else if (field === 'emails') {
      contact.emails = this._ensureSinglePreferred(
        Array.isArray(rawValue) ? rawValue : [],
        'email',
      );
    } else if (field === 'phones') {
      contact.phones = this._ensureSinglePreferred(
        Array.isArray(rawValue) ? rawValue : [],
        'phone',
      );
    } else if (field === 'urls') {
      contact.urls = this._ensureSinglePreferred(Array.isArray(rawValue) ? rawValue : [], 'url');
    } else if (field === 'addresses') {
      contact.addresses = this._ensureSinglePreferred(
        Array.isArray(rawValue) ? rawValue : [],
        'address',
      );
    } else if (field === 'notes') {
      contact.notes = this._splitNotes(value);
      contact.noteTags = this.parser._extractHashtags(contact.notes);
      contact.tags = this.parser._inferTags(contact);
    }
    this._rewriteEditableFields(contact);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
  }

  _addContactFromTable() {
    const contact = this._makeMinimalContact('New Contact');
    this.contacts.push(contact);
    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    this._mainViewMode = 'table';
    this._applyMainViewMode();
    void this._persistSession();
  }

  _deleteContact(contactId) {
    const contact = this._contact(contactId);
    if (!contact) return;
    const ok = window.confirm(
      `Delete ${contact.fn || 'this contact'} from the current working dataset?`,
    );
    if (!ok) return;
    this.contacts = this.contacts.filter((c) => c.id !== contactId);
    this.builder = new RelationshipBuilder(this.contacts);
    if (this._selectedNodeId === contactId) {
      this._selectedNodeId = null;
      this._editingContactId = null;
      this._onNodeDeselect();
    }
    this._rebuildGraph();
    void this._persistSession();
  }

  /** Delete every contact currently checked in the sidebar selection (confirms first). */
  _deleteSelectedContacts() {
    const ids = [...this._selectedForExport];
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Delete ${ids.length} selected contact${ids.length !== 1 ? 's' : ''} from the current working dataset?`,
    );
    if (!ok) return;
    const idSet = new Set(ids);
    this.contacts = this.contacts.filter((c) => !idSet.has(c.id));
    this.builder = new RelationshipBuilder(this.contacts);
    if (this._selectedNodeId && idSet.has(this._selectedNodeId)) {
      this._selectedNodeId = null;
      this._editingContactId = null;
      this._onNodeDeselect();
    }
    this._selectedForExport.clear();
    this._updateExportBar();
    this._rebuildGraph();
    void this._persistSession();
  }
}

applyMixin(ContactRelationshipApp.prototype, TableMixin);
