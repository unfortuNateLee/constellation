import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';

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
    if (isTable) {
      this._renderTableMode();
    } else {
      // The editable table builds a very heavy DOM (~hundreds of elements per row:
      // inputs, type checkboxes, add/remove controls). Leaving it in the document
      // while the graph is shown — even display:none — measurably slows the graph
      // (style recalc / simulation ticks scale with total DOM). Drop it on exit; it
      // fully re-renders on the next entry to the table view.
      this._clearTableMode();
      this._renderGraphIfStale();
    }
    this._scheduleGraphResize();
  }

  /** Tear down the table DOM (heavy) so it doesn't burden other views. */
  _clearTableMode() {
    const head = document.getElementById('contacts-table-head');
    const body = document.getElementById('contacts-table-body');
    const colgroup = document.getElementById('contacts-table')?.querySelector('colgroup');
    if (head) head.innerHTML = '';
    if (body) body.innerHTML = '';
    if (colgroup) colgroup.remove();
  }

  /**
   * Column registry for the table view — the single place that defines order,
   * default widths, sortability, and how each cell renders. Adding a field is one
   * entry here. Widths are user-resizable (persisted) via the colgroup + handles.
   */
  _tableColumns() {
    const input =
      (key, field, opts = {}) =>
      (c) =>
        this._tableInputCell(c, field, c[field] || '', { multiline: false, ...opts });
    return [
      { key: 'name', label: 'Name', width: 170, sortable: true, render: input('name', 'fn') },
      {
        key: 'nickname',
        label: 'Nickname',
        width: 120,
        sortable: true,
        render: input('nickname', 'nickname'),
      },
      {
        key: 'org',
        label: 'Organization',
        width: 180,
        sortable: true,
        render: input('org', 'org'),
      },
      {
        key: 'department',
        label: 'Department',
        width: 150,
        sortable: true,
        render: input('department', 'department'),
      },
      { key: 'title', label: 'Title', width: 160, sortable: true, render: input('title', 'title') },
      {
        key: 'emails',
        label: 'Emails',
        width: 240,
        render: (c) => this._tableCollectionCell(c, 'email', c.emails || [], (e) => e.value),
      },
      {
        key: 'phones',
        label: 'Phones',
        width: 240,
        render: (c) => this._tableCollectionCell(c, 'phone', c.phones || [], (e) => e.value),
      },
      {
        key: 'ims',
        label: 'Instant Messages',
        width: 220,
        render: (c) => this._tableImCell(c),
      },
      {
        key: 'socialProfiles',
        label: 'Social Profiles',
        width: 220,
        render: (c) => this._tableSocialCell(c),
      },
      {
        key: 'urls',
        label: 'Websites',
        width: 220,
        render: (c) =>
          this._tableCollectionCell(c, 'url', c.urls || [], (e) =>
            typeof e === 'string' ? e : e.value,
          ),
      },
      {
        key: 'addresses',
        label: 'Addresses',
        width: 260,
        render: (c) => this._tableAddressCell(c),
      },
      {
        key: 'birthday',
        label: 'Birthday',
        width: 130,
        sortable: true,
        render: input('birthday', 'birthday', { type: 'date' }),
      },
      {
        key: 'anniversary',
        label: 'Anniversary',
        width: 130,
        render: input('anniversary', 'anniversary', { type: 'date' }),
      },
      {
        key: 'related',
        label: 'Relationships',
        width: 200,
        render: (c) => this._tableRelationshipsCell(c),
      },
      { key: 'dates', label: 'Other Dates', width: 160, render: (c) => this._tableDatesCell(c) },
      { key: 'tags', label: 'Tags', width: 150, render: (c) => this._tableTagsCell(c) },
      {
        key: 'notes',
        label: 'Notes',
        width: 260,
        render: (c) =>
          this._tableInputCell(c, 'notes', this._notesText(c.notes), { multiline: true }),
      },
      { key: 'actions', label: '', width: 84, render: (c) => this._tableActionsCell(c) },
    ];
  }

  _renderTableMode() {
    if (this._mainViewMode !== 'table') return;
    const head = document.getElementById('contacts-table-head');
    const body = document.getElementById('contacts-table-body');
    const table = document.getElementById('contacts-table');
    if (!head || !body) return;

    const columns = this._tableColumns();
    const widths = this._tableColumnWidths();

    head.innerHTML = '';
    body.innerHTML = '';

    // <colgroup> drives per-column widths (table-layout: fixed honors these).
    let colgroup = table?.querySelector('colgroup');
    if (colgroup) colgroup.remove();
    colgroup = document.createElement('colgroup');
    for (const col of columns) {
      const colEl = document.createElement('col');
      colEl.dataset.key = col.key;
      colEl.style.width = `${widths[col.key] || col.width}px`;
      colgroup.appendChild(colEl);
    }
    table?.insertBefore(colgroup, head);

    const headerRow = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      th.dataset.key = col.key;
      if (col.sortable) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const active = this._tableSort.key === col.key;
        btn.textContent = col.label + (active ? (this._tableSort.dir === 'asc' ? ' ↑' : ' ↓') : '');
        btn.addEventListener('click', () => this._setTableSort(col.key));
        th.appendChild(btn);
      } else if (col.label) {
        th.textContent = col.label;
      }
      // Drag handle to resize this column.
      const handle = document.createElement('div');
      handle.className = 'table-col-resizer';
      handle.addEventListener('mousedown', (e) => this._startTableColumnResize(e, col.key));
      th.appendChild(handle);
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

    // Each table row carries ~17 cells with live inputs/checkboxes, so rendering
    // thousands at once is heavy. Cap the rendered rows and show a clear notice —
    // refine the search/filters to narrow (no silent truncation).
    const CAP = 250;
    const shown = contacts.slice(0, CAP);
    for (const contact of shown) {
      const tr = document.createElement('tr');
      tr.dataset.id = contact.id;
      for (const col of columns) tr.appendChild(col.render(contact));
      body.appendChild(tr);
    }
    if (contacts.length > CAP) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns.length;
      td.className = 'table-empty';
      td.textContent = `Showing the first ${CAP} of ${contacts.length} contacts — refine the search or filters to narrow the list.`;
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }

  // ── Column width persistence + drag-to-resize ──────────────────────
  _tableColumnWidths() {
    if (this._tableColWidths) return this._tableColWidths;
    try {
      this._tableColWidths = JSON.parse(localStorage.getItem('constellation:table-col-w') || '{}');
    } catch {
      this._tableColWidths = {};
    }
    return this._tableColWidths;
  }

  _startTableColumnResize(e, key) {
    e.preventDefault();
    e.stopPropagation();
    const table = document.getElementById('contacts-table');
    const colEl = table?.querySelector(`col[data-key="${key}"]`);
    if (!colEl) return;
    const startX = e.clientX;
    const startW = parseInt(colEl.style.width, 10) || 120;
    const onMove = (ev) => {
      const next = Math.max(60, startW + (ev.clientX - startX));
      colEl.style.width = `${next}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-col');
      const widths = this._tableColumnWidths();
      widths[key] = parseInt(colEl.style.width, 10) || startW;
      try {
        localStorage.setItem('constellation:table-col-w', JSON.stringify(widths));
      } catch {
        /* storage unavailable — width still applied for this session */
      }
    };
    document.body.classList.add('resizing-col');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
        case 'nickname':
          return contact.nickname || '';
        case 'department':
          return contact.department || '';
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

  /** Editable IM cell: handle + service per row (scheme/types/label preserved). */
  _tableImCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-metadata-list';
    const save = () => {
      const entries = [...wrap.querySelectorAll('.table-metadata-item')]
        .map((item) => {
          const handle = item.querySelector('[data-role="im-value"]')?.value.trim() || '';
          if (!handle) return null;
          const scheme = item.querySelector('[data-role="im-scheme"]')?.value || '';
          let types = [];
          try {
            types = JSON.parse(item.querySelector('[data-role="im-types"]')?.value || '[]');
          } catch {
            types = [];
          }
          return {
            value: scheme + handle,
            service: item.querySelector('[data-role="im-service"]')?.value.trim() || '',
            label: item.querySelector('[data-role="im-label"]')?.value || '',
            types,
          };
        })
        .filter(Boolean);
      this._applyTableEdit(contact.id, 'ims', entries);
    };
    const addItem = (entry = null) => {
      const { scheme, handle } = this._splitUriScheme(entry?.value || '');
      const item = document.createElement('div');
      item.className = 'table-metadata-item';
      const value = this._tableMetaInput('im-value', handle, 'Handle');
      const service = this._tableMetaInput('im-service', entry?.service || '', 'Service');
      const schemeStash = this._tableHidden('im-scheme', scheme);
      const labelStash = this._tableHidden('im-label', entry?.label || '');
      const typesStash = this._tableHidden('im-types', JSON.stringify(entry?.types || []));
      const remove = this._tableRemoveBtn(() => {
        item.remove();
        save();
      });
      value.addEventListener('change', save);
      service.addEventListener('change', save);
      item.append(value, service, schemeStash, labelStash, typesStash, remove);
      wrap.appendChild(item);
    };
    (contact.ims || []).forEach(addItem);
    const add = this._tableAddBtn('+ Add IM', () => addItem());
    td.append(wrap, add);
    return td;
  }

  /** Editable social cell: handle + service per row (scheme/username/label preserved). */
  _tableSocialCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-metadata-list';
    const save = () => {
      const entries = [...wrap.querySelectorAll('.table-metadata-item')]
        .map((item) => {
          const handle = item.querySelector('[data-role="social-url"]')?.value.trim() || '';
          if (!handle) return null;
          const scheme = item.querySelector('[data-role="social-scheme"]')?.value || '';
          return {
            url: scheme + handle,
            service: item.querySelector('[data-role="social-service"]')?.value.trim() || '',
            username: item.querySelector('[data-role="social-username"]')?.value || '',
            label: item.querySelector('[data-role="social-label"]')?.value || '',
          };
        })
        .filter(Boolean);
      this._applyTableEdit(contact.id, 'socialProfiles', entries);
    };
    const addItem = (entry = null) => {
      const { scheme, handle } = this._splitUriScheme(entry?.url || '');
      const item = document.createElement('div');
      item.className = 'table-metadata-item';
      const url = this._tableMetaInput('social-url', handle, 'URL or handle');
      const service = this._tableMetaInput('social-service', entry?.service || '', 'Service');
      const schemeStash = this._tableHidden('social-scheme', scheme);
      const userStash = this._tableHidden('social-username', entry?.username || '');
      const labelStash = this._tableHidden('social-label', entry?.label || '');
      const remove = this._tableRemoveBtn(() => {
        item.remove();
        save();
      });
      url.addEventListener('change', save);
      service.addEventListener('change', save);
      item.append(url, service, schemeStash, userStash, labelStash, remove);
      wrap.appendChild(item);
    };
    (contact.socialProfiles || []).forEach(addItem);
    const add = this._tableAddBtn('+ Add Social', () => addItem());
    td.append(wrap, add);
    return td;
  }

  /** Read-only relationships summary (edit in the contact card). */
  /**
   * Editable relationships cell: per row a name input + a type picker (the
   * relationship taxonomy; a custom/unknown type is preserved as its own option).
   * The target's UID, when present, is stashed so name-independent resolution
   * survives. Note: reciprocal updates on the *other* contact are handled in the
   * detail card, not here.
   */
  _tableRelationshipsCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-metadata-list';
    const save = () => {
      const entries = [...wrap.querySelectorAll('.table-metadata-item')]
        .map((item) => {
          const name = item.querySelector('[data-role="rel-name"]')?.value.trim() || '';
          if (!name) return null;
          const type = item.querySelector('[data-role="rel-type"]')?.value || 'other';
          const uid = item.querySelector('[data-role="rel-uid"]')?.value || '';
          return { name, type, rawType: this._typeToVCardLabel(type), ...(uid ? { uid } : {}) };
        })
        .filter(Boolean);
      this._applyTableEdit(contact.id, 'related', entries);
    };
    const addItem = (rel = null) => {
      const item = document.createElement('div');
      item.className = 'table-metadata-item';
      const name = this._tableMetaInput('rel-name', rel?.name || '', 'Name');
      const select = document.createElement('select');
      select.className = 'table-cell-input';
      select.dataset.role = 'rel-type';
      select.innerHTML = RelationshipTaxonomy.optionsHtml(rel?.type || '', false);
      // Preserve a custom/unknown relationship type as its own selected option.
      if (rel?.type && ![...select.options].some((o) => o.value === rel.type)) {
        const opt = document.createElement('option');
        opt.value = rel.type;
        opt.textContent = this._friendlyRelType(rel);
        opt.selected = true;
        select.insertBefore(opt, select.firstChild);
      }
      const uidStash = this._tableHidden('rel-uid', rel?.uid || '');
      const remove = this._tableRemoveBtn(() => {
        item.remove();
        save();
      });
      name.addEventListener('change', save);
      select.addEventListener('change', save);
      item.append(name, select, uidStash, remove);
      wrap.appendChild(item);
    };
    (contact.related || []).forEach(addItem);
    const add = this._tableAddBtn('+ Add Relationship', () => addItem());
    td.append(wrap, add);
    return td;
  }

  _friendlyRelType(rel) {
    try {
      return this.builder ? this.builder._friendlyType(rel.type) : rel.type || 'related';
    } catch {
      return rel.type || 'related';
    }
  }

  /** Editable custom-dates cell: per row a label input + a date value (text, to
   *  allow Apple's partial/odd date formats), plus add/remove. */
  _tableDatesCell(contact) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'table-metadata-list';
    const save = () => {
      const entries = [...wrap.querySelectorAll('.table-metadata-item')]
        .map((item) => {
          const value = item.querySelector('[data-role="date-value"]')?.value.trim() || '';
          if (!value) return null;
          const label = item.querySelector('[data-role="date-label"]')?.value.trim() || '';
          return { label: label || 'Date', value };
        })
        .filter(Boolean);
      this._applyTableEdit(contact.id, 'dates', entries);
    };
    const addItem = (d = null) => {
      const item = document.createElement('div');
      item.className = 'table-metadata-item';
      const label = this._tableMetaInput('date-label', d?.label || '', 'Label');
      const value = this._tableMetaInput('date-value', d?.value || '', 'YYYY-MM-DD');
      const remove = this._tableRemoveBtn(() => {
        item.remove();
        save();
      });
      label.addEventListener('change', save);
      value.addEventListener('change', save);
      item.append(label, value, remove);
      wrap.appendChild(item);
    };
    (contact.dates || []).forEach(addItem);
    const add = this._tableAddBtn('+ Add Date', () => addItem());
    td.append(wrap, add);
    return td;
  }

  // Small shared builders for the compact metadata cells above.
  _tableMetaInput(role, value, placeholder) {
    const input = document.createElement('input');
    input.className = 'table-cell-input';
    input.dataset.role = role;
    input.value = value || '';
    input.placeholder = placeholder || '';
    return input;
  }

  _tableHidden(role, value) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.dataset.role = role;
    input.value = value || '';
    return input;
  }

  _tableRemoveBtn(onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-xs';
    btn.type = 'button';
    btn.textContent = 'Remove';
    btn.addEventListener('click', onClick);
    return btn;
  }

  _tableAddBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-xs table-add-metadata';
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  _applyTableEdit(contactId, field, rawValue) {
    const contact = this._contact(contactId);
    if (!contact) return;
    const value = String(rawValue ?? '');

    // Only edits that change graph topology, clustering, or the sidebar list need
    // the full builder + graph + list/table rebuild. Name (label + surname
    // cluster), org (org cluster + list sub-line), and relationships (edges) do;
    // notes do only when their #hashtags change (those feed clusters + filters).
    // Everything else is "graph-neutral": regenerate the card + sync the node.
    const needsFullRebuild = field === 'fn' || field === 'org' || field === 'related';
    let hashtagsChanged = false;

    if (field === 'fn') {
      contact.fn = value.trim();
      contact.name = this._namePartsFromDisplayName(contact.fn || '');
    } else if (field === 'org') {
      contact.org = value.trim();
    } else if (field === 'nickname') {
      contact.nickname = value.trim();
    } else if (field === 'department') {
      contact.department = value.trim();
    } else if (field === 'title') {
      contact.title = value.trim();
    } else if (field === 'ims') {
      contact.ims = Array.isArray(rawValue) ? rawValue : [];
    } else if (field === 'socialProfiles') {
      contact.socialProfiles = Array.isArray(rawValue) ? rawValue : [];
    } else if (field === 'dates') {
      contact.dates = Array.isArray(rawValue) ? rawValue : [];
    } else if (field === 'related') {
      contact.related = Array.isArray(rawValue) ? rawValue : [];
    } else if (field === 'birthday') {
      contact.birthday = value || null;
    } else if (field === 'anniversary') {
      contact.anniversary = value || null;
    } else if (field === 'emails') {
      contact.emails = this._ensureSinglePreferred(Array.isArray(rawValue) ? rawValue : []);
    } else if (field === 'phones') {
      contact.phones = this._ensureSinglePreferred(Array.isArray(rawValue) ? rawValue : []);
    } else if (field === 'urls') {
      contact.urls = this._ensureSinglePreferred(Array.isArray(rawValue) ? rawValue : []);
    } else if (field === 'addresses') {
      contact.addresses = this._ensureSinglePreferred(Array.isArray(rawValue) ? rawValue : []);
    } else if (field === 'notes') {
      const prevTags = (contact.noteTags || []).join('');
      contact.notes = this._splitNotes(value);
      contact.noteTags = this.parser._extractHashtags(contact.notes);
      contact.tags = this.parser._inferTags(contact);
      if ((contact.noteTags || []).join('') !== prevTags) hashtagsChanged = true;
    }

    this._rewriteEditableFields(contact);

    if (hashtagsChanged) {
      // Hashtags feed clusters + the tag filters/legend/list colors, but not the
      // relationship index, sort order, or other rows. Reuse the builder (names
      // unchanged), refresh the tag-dependent UI, and re-render ONLY this row
      // instead of the whole table (the dominant cost on large sets).
      this._rebuildGraph({ skipTableRender: true });
      this._refreshTableRow(contactId);
    } else if (needsFullRebuild) {
      this.builder = new RelationshipBuilder(this.contacts);
      this._rebuildGraph();
    } else {
      // Fast path: no relationship/cluster/list change — just keep the graph node
      // (and the detail panel that reads it) in sync. Skips the full re-render of
      // the table/list/graph that dominated edit latency.
      this._syncNodeFromContact(contact);
    }
    void this._persistSession();
  }

  /** Re-render a single contact's table row in place (cheap; used for surgical
   *  updates like a hashtag change that only affects that row's Tags cell). */
  _refreshTableRow(contactId) {
    if (this._mainViewMode !== 'table') return;
    const row = document.querySelector(`#contacts-table-body tr[data-id="${contactId}"]`);
    const contact = this._contact(contactId);
    if (!row || !contact) return;
    row.innerHTML = '';
    for (const col of this._tableColumns()) row.appendChild(col.render(contact));
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
