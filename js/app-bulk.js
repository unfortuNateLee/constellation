import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';
import { makeSearchable } from './searchable-select.js';

/**
 * Bulk-normalize rule engine.
 *
 * Three parts:
 *   IF    — a nested AND/OR condition builder → selects which CONTACTS to touch.
 *   THEN  — set / append / clear / remove on a target field.
 *   WHERE — for multi-instance target fields (email, phone, address, url,
 *           relationship), a per-instance filter → selects which INSTANCES
 *           within each matched contact to change. Without a WHERE the user
 *           must explicitly opt into "all instances".
 *
 * Single-instance (scalar) target fields have exactly one value, so they have
 * no WHERE — they just set/append/clear.
 */
class BulkMixin {
  _openBulkNormalizeModal() {
    if (!this.contacts.length) {
      this._showToast('Load a VCF file first', 'error');
      return;
    }
    this._bulkRuleState = {
      root: this._newBulkRuleGroup(),
      action: {
        type: 'set',
        field: 'org',
        value: '',
        // WHERE applies only when `field` targets a multi-instance entity.
        where: { op: 'AND', conditions: [] },
        applyTo: 'matching', // 'matching' | 'all'
      },
    };
    this._renderBulkActionFieldOptions();
    this._renderBulkRuleBuilder();
    document.getElementById('bulk-confirm-risk').checked = false;
    document.getElementById('bulk-normalize-modal').classList.remove('hidden');
  }

  _closeBulkNormalizeModal() {
    document.getElementById('bulk-normalize-modal').classList.add('hidden');
  }

  _newBulkRuleGroup() {
    return {
      id: `bulk-group-${++this._bulkRuleIdCounter}`,
      type: 'group',
      op: 'AND',
      children: [this._newBulkRuleCondition()],
    };
  }

  _newBulkRuleCondition() {
    return {
      id: `bulk-condition-${++this._bulkRuleIdCounter}`,
      type: 'condition',
      field: 'org',
      operator: 'equals',
      value: '',
    };
  }

  /**
   * Field registry — the single source of truth for IF conditions, THEN
   * targets, and WHERE subfields.
   *
   * Scalar fields (`entity: null`) expose `setScalar(contact, value)`.
   * Multi-instance fields carry an `entity` key and `get(contact, instance)` /
   * `setInst(contact, instance, value)` operating on one instance. Relationship
   * subfields are set specially (via `_applyRelationshipEdit`, to keep
   * reciprocals consistent), so they have no `setInst`.
   */
  _bulkRuleFieldDefs() {
    const splitNotes = (v) => this._splitNotes(v || '');
    return [
      // ── Scalar (single-value) contact fields ──────────────────────────
      {
        key: 'fn',
        label: 'Display Name',
        entity: null,
        valueType: 'text',
        get: (c) => c.fn || '',
        setScalar: (c, v) => {
          c.fn = v;
        },
      },
      {
        key: 'name-given',
        label: 'First Name',
        entity: null,
        valueType: 'text',
        get: (c) => c.name?.given || '',
        setScalar: (c, v) => {
          c.name.given = v;
        },
      },
      {
        key: 'name-additional',
        label: 'Middle Name',
        entity: null,
        valueType: 'text',
        get: (c) => c.name?.additional || '',
        setScalar: (c, v) => {
          c.name.additional = v;
        },
      },
      {
        key: 'name-family',
        label: 'Last Name',
        entity: null,
        valueType: 'text',
        get: (c) => c.name?.family || '',
        setScalar: (c, v) => {
          c.name.family = v;
        },
      },
      {
        key: 'name-prefix',
        label: 'Prefix',
        entity: null,
        valueType: 'text',
        get: (c) => c.name?.prefix || '',
        setScalar: (c, v) => {
          c.name.prefix = v;
        },
      },
      {
        key: 'name-suffix',
        label: 'Suffix',
        entity: null,
        valueType: 'text',
        get: (c) => c.name?.suffix || '',
        setScalar: (c, v) => {
          c.name.suffix = v;
        },
      },
      {
        key: 'org',
        label: 'Organization',
        entity: null,
        valueType: 'text',
        get: (c) => c.org || '',
        setScalar: (c, v) => {
          c.org = v;
        },
      },
      {
        key: 'title',
        label: 'Title',
        entity: null,
        valueType: 'text',
        get: (c) => c.title || '',
        setScalar: (c, v) => {
          c.title = v;
        },
      },
      {
        key: 'notes',
        label: 'Notes',
        entity: null,
        valueType: 'text',
        get: (c) => (c.notes || []).join('\n\n'),
        setScalar: (c, v) => {
          c.notes = splitNotes(v);
        },
      },
      {
        key: 'birthday',
        label: 'Birthday',
        entity: null,
        valueType: 'date',
        get: (c) => c.birthday || '',
        setScalar: (c, v) => {
          c.birthday = v || null;
        },
      },
      {
        key: 'anniversary',
        label: 'Anniversary',
        entity: null,
        valueType: 'date',
        get: (c) => c.anniversary || '',
        setScalar: (c, v) => {
          c.anniversary = v || null;
        },
      },

      // ── Multi-instance entity subfields ───────────────────────────────
      {
        key: 'email-value',
        label: 'Address',
        group: 'Email',
        entity: 'email',
        valueType: 'text',
        get: (_c, e) => (e ? (typeof e === 'string' ? e : e.value || '') : ''),
        setInst: (_c, e, v) => {
          if (typeof e !== 'string') e.value = v;
        },
      },
      {
        key: 'email-label',
        label: 'Custom Label',
        group: 'Email',
        entity: 'email',
        valueType: 'text',
        get: (_c, e) => (e && typeof e !== 'string' ? e.label || '' : ''),
        setInst: (_c, e, v) => {
          if (typeof e !== 'string') e.label = v;
        },
      },
      {
        key: 'phone-value',
        label: 'Number',
        group: 'Phone',
        entity: 'phone',
        valueType: 'text',
        get: (_c, p) => p?.value || '',
        setInst: (_c, p, v) => {
          p.value = v;
        },
      },
      {
        key: 'phone-label',
        label: 'Custom Label',
        group: 'Phone',
        entity: 'phone',
        valueType: 'text',
        get: (_c, p) => p?.label || '',
        setInst: (_c, p, v) => {
          p.label = v;
        },
      },
      {
        key: 'url-value',
        label: 'Address',
        group: 'Website',
        entity: 'url',
        valueType: 'text',
        get: (_c, u) => (u ? (typeof u === 'string' ? u : u.value || '') : ''),
        setInst: (_c, u, v) => {
          if (typeof u !== 'string') u.value = v;
        },
      },
      {
        key: 'url-label',
        label: 'Custom Label',
        group: 'Website',
        entity: 'url',
        valueType: 'text',
        get: (_c, u) => (u && typeof u !== 'string' ? u.label || '' : ''),
        setInst: (_c, u, v) => {
          if (typeof u !== 'string') u.label = v;
        },
      },
      {
        key: 'address-street',
        label: 'Street',
        group: 'Address',
        entity: 'address',
        valueType: 'text',
        get: (_c, a) => a?.street || '',
        setInst: (_c, a, v) => {
          a.street = v;
        },
      },
      {
        key: 'address-city',
        label: 'City',
        group: 'Address',
        entity: 'address',
        valueType: 'text',
        get: (_c, a) => a?.city || '',
        setInst: (_c, a, v) => {
          a.city = v;
        },
      },
      {
        key: 'address-state',
        label: 'State / Province',
        group: 'Address',
        entity: 'address',
        valueType: 'text',
        get: (_c, a) => a?.state || '',
        setInst: (_c, a, v) => {
          a.state = v;
        },
      },
      {
        key: 'address-zip',
        label: 'Postal Code',
        group: 'Address',
        entity: 'address',
        valueType: 'text',
        get: (_c, a) => a?.zip || '',
        setInst: (_c, a, v) => {
          a.zip = v;
        },
      },
      {
        key: 'address-country',
        label: 'Country',
        group: 'Address',
        entity: 'address',
        valueType: 'text',
        get: (_c, a) => a?.country || '',
        setInst: (_c, a, v) => {
          a.country = v;
        },
      },
      {
        key: 'address-label',
        label: 'Custom Label',
        group: 'Address',
        entity: 'address',
        valueType: 'text',
        get: (_c, a) => a?.label || '',
        setInst: (_c, a, v) => {
          a.label = v;
        },
      },
      {
        key: 'relationship-type',
        label: 'Type',
        group: 'Relationship',
        entity: 'related',
        valueType: 'relType',
        isRelType: true,
        get: (_c, r) => (r ? RelationshipTaxonomy.label(r.type) : ''),
      },
      {
        key: 'relationship-name',
        label: 'Name',
        group: 'Relationship',
        entity: 'related',
        valueType: 'text',
        get: (_c, r) => r?.name || '',
      },
      {
        key: 'date-label',
        label: 'Label',
        group: 'Date',
        entity: 'date',
        valueType: 'text',
        get: (_c, d) => d?.label || '',
        setInst: (_c, d, v) => {
          d.label = v;
        },
      },
      {
        key: 'date-value',
        label: 'Value',
        group: 'Date',
        entity: 'date',
        valueType: 'date',
        get: (_c, d) => d?.value || '',
        setInst: (_c, d, v) => {
          d.value = v;
        },
      },
      {
        key: 'im-value',
        label: 'Handle',
        group: 'Instant Message',
        entity: 'im',
        valueType: 'text',
        get: (_c, i) => i?.value || '',
        setInst: (_c, i, v) => {
          i.value = v;
        },
      },
      {
        key: 'im-service',
        label: 'Service',
        group: 'Instant Message',
        entity: 'im',
        valueType: 'text',
        get: (_c, i) => i?.service || '',
        setInst: (_c, i, v) => {
          i.service = v;
        },
      },
      {
        key: 'im-label',
        label: 'Custom Label',
        group: 'Instant Message',
        entity: 'im',
        valueType: 'text',
        get: (_c, i) => i?.label || '',
        setInst: (_c, i, v) => {
          i.label = v;
        },
      },
      {
        key: 'social-url',
        label: 'URL',
        group: 'Social Profile',
        entity: 'social',
        valueType: 'text',
        get: (_c, s) => s?.url || '',
        setInst: (_c, s, v) => {
          s.url = v;
        },
      },
      {
        key: 'social-service',
        label: 'Service',
        group: 'Social Profile',
        entity: 'social',
        valueType: 'text',
        get: (_c, s) => s?.service || '',
        setInst: (_c, s, v) => {
          s.service = v;
        },
      },
      {
        key: 'social-username',
        label: 'Username',
        group: 'Social Profile',
        entity: 'social',
        valueType: 'text',
        get: (_c, s) => s?.username || '',
        setInst: (_c, s, v) => {
          s.username = v;
        },
      },
      {
        key: 'social-label',
        label: 'Custom Label',
        group: 'Social Profile',
        entity: 'social',
        valueType: 'text',
        get: (_c, s) => s?.label || '',
        setInst: (_c, s, v) => {
          s.label = v;
        },
      },
    ];
  }

  /** Multi-instance entities: how to read/replace their per-contact list. */
  _bulkEntityDefs() {
    return {
      email: {
        singular: 'email',
        plural: 'emails',
        getList: (c) => c.emails || [],
        setList: (c, a) => {
          c.emails = a;
        },
      },
      phone: {
        singular: 'phone',
        plural: 'phones',
        getList: (c) => c.phones || [],
        setList: (c, a) => {
          c.phones = a;
        },
      },
      url: {
        singular: 'website',
        plural: 'websites',
        getList: (c) => c.urls || [],
        setList: (c, a) => {
          c.urls = a;
        },
      },
      address: {
        singular: 'address',
        plural: 'addresses',
        getList: (c) => c.addresses || [],
        setList: (c, a) => {
          c.addresses = a;
        },
      },
      related: {
        singular: 'relationship',
        plural: 'relationships',
        getList: (c) => c.related || [],
        setList: (c, a) => {
          c.related = a;
        },
      },
      date: {
        singular: 'date',
        plural: 'dates',
        getList: (c) => c.dates || [],
        setList: (c, a) => {
          c.dates = a;
        },
      },
      im: {
        singular: 'IM',
        plural: 'IMs',
        getList: (c) => c.ims || [],
        setList: (c, a) => {
          c.ims = a;
        },
      },
      social: {
        singular: 'social profile',
        plural: 'social profiles',
        getList: (c) => c.socialProfiles || [],
        setList: (c, a) => {
          c.socialProfiles = a;
        },
      },
    };
  }

  /**
   * The live instance array for an entity on a contact. URLs may be stored as
   * bare strings; when `normalize` is set (apply path) they're upgraded to
   * `{value, types}` objects in place so per-instance setters can mutate them.
   */
  _bulkEntityInstances(contact, entity, normalize = false) {
    const eDef = this._bulkEntityDefs()[entity];
    let list = eDef.getList(contact);
    if (entity === 'url' && normalize && list.some((u) => typeof u === 'string')) {
      list = list.map((u) => (typeof u === 'string' ? { value: u, types: [] } : u));
      eDef.setList(contact, list);
    }
    return list;
  }

  _bulkFieldDef(fieldKey) {
    return (
      this._bulkRuleFieldDefs().find((def) => def.key === fieldKey) || this._bulkRuleFieldDefs()[0]
    );
  }

  _bulkFieldDisplayLabel(def) {
    return def.group ? `${def.group} ▸ ${def.label}` : def.label;
  }

  /** Which THEN actions make sense for a given target field. */
  _bulkAllowedActions(def) {
    if (!def.entity) return ['set', 'append', 'clear'];
    if (def.key === 'relationship-type') return ['set', 'remove'];
    if (def.key === 'relationship-name') return ['set', 'append', 'remove'];
    return ['set', 'append', 'clear', 'remove'];
  }

  /**
   * Operators for a field. `context` is 'if' (contact scope — "has any
   * instance…") or 'where' (instance scope — "this instance…"). Relationship
   * type uses has/has-not at contact scope but is/is-not at instance scope.
   */
  _bulkOperatorsForField(fieldKey, context = 'if') {
    const def = this._bulkFieldDef(fieldKey);
    if (def.isRelType) {
      return context === 'where'
        ? [
            ['equals', 'is'],
            ['not-equals', 'is not'],
          ]
        : [
            ['has', 'has type'],
            ['has-not', 'does not have type'],
          ];
    }
    if (def.valueType === 'date') {
      return [
        ['is-empty', 'is empty'],
        ['is-not-empty', 'is not empty'],
        ['equals', 'equals'],
        ['not-equals', 'does not equal'],
      ];
    }
    return [
      ['is-empty', 'is empty'],
      ['is-not-empty', 'is not empty'],
      ['equals', 'equals'],
      ['not-equals', 'does not equal'],
      ['contains', 'contains'],
      ['not-contains', 'does not contain'],
      ['starts-with', 'starts with'],
      ['ends-with', 'ends with'],
    ];
  }

  _bulkOperatorNeedsValue(operator) {
    return !['is-empty', 'is-not-empty'].includes(operator);
  }

  _renderBulkActionFieldOptions() {
    const select = document.getElementById('bulk-action-field');
    if (!select) return;
    select.innerHTML = '';
    for (const def of this._bulkRuleFieldDefs()) {
      const opt = document.createElement('option');
      opt.value = def.key;
      opt.textContent = this._bulkFieldDisplayLabel(def);
      select.appendChild(opt);
    }
    if (this._bulkRuleState?.action?.field) select.value = this._bulkRuleState.action.field;
    makeSearchable(select, { placeholder: 'Search fields…' });
  }

  _renderBulkRuleBuilder() {
    const rootEl = document.getElementById('bulk-rule-builder');
    if (!rootEl || !this._bulkRuleState) return;
    rootEl.innerHTML = '';
    rootEl.appendChild(this._renderBulkRuleGroup(this._bulkRuleState.root, true));
    this._syncBulkActionControls();
    this._updateBulkNormalizePreview();
  }

  _renderBulkRuleGroup(group, isRoot = false) {
    const wrap = document.createElement('div');
    wrap.className = 'bulk-rule-group';
    wrap.dataset.groupId = group.id;

    const header = document.createElement('div');
    header.className = 'bulk-group-header';
    const opWrap = document.createElement('div');
    opWrap.className = 'bulk-operator-inline';
    const label = document.createElement('span');
    label.textContent = 'Match';
    const select = document.createElement('select');
    select.className = 'form-control';
    select.innerHTML = `
      <option value="AND">ALL of these</option>
      <option value="OR">ANY of these</option>
    `;
    select.value = group.op;
    select.addEventListener('change', () => {
      group.op = select.value;
      this._updateBulkNormalizePreview();
    });
    opWrap.append(label, select);
    header.appendChild(opWrap);

    if (!isRoot) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-xs';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove Group';
      removeBtn.addEventListener('click', () => {
        this._removeBulkRuleNode(this._bulkRuleState.root, group.id);
        this._renderBulkRuleBuilder();
      });
      header.appendChild(removeBtn);
    }
    wrap.appendChild(header);

    const children = document.createElement('div');
    children.className = 'bulk-group-children';
    for (const child of group.children) {
      children.appendChild(
        child.type === 'group'
          ? this._renderBulkRuleGroup(child, false)
          : this._renderBulkRuleCondition(child),
      );
    }
    wrap.appendChild(children);

    const actions = document.createElement('div');
    actions.className = 'bulk-group-actions';
    const addCondition = document.createElement('button');
    addCondition.className = 'btn btn-ghost btn-xs';
    addCondition.type = 'button';
    addCondition.textContent = '+ Add Condition';
    addCondition.addEventListener('click', () => {
      group.children.push(this._newBulkRuleCondition());
      this._renderBulkRuleBuilder();
    });
    const addGroup = document.createElement('button');
    addGroup.className = 'btn btn-ghost btn-xs';
    addGroup.type = 'button';
    addGroup.textContent = '+ Add Group';
    addGroup.addEventListener('click', () => {
      group.children.push(this._newBulkRuleGroup());
      this._renderBulkRuleBuilder();
    });
    actions.append(addCondition, addGroup);
    wrap.appendChild(actions);
    return wrap;
  }

  /** A searchable <select> of known relationship types (no Custom… option). */
  _buildBulkRelTypeSelect(selectedType, onChange) {
    const select = document.createElement('select');
    select.className = 'form-control';
    select.innerHTML = RelationshipTaxonomy.optionsHtml(selectedType, false);
    if (selectedType) select.value = selectedType;
    select.addEventListener('change', () => onChange(select.value));
    makeSearchable(select, { placeholder: 'Search types…' });
    return select;
  }

  /** One IF condition row (contact-scope). */
  _renderBulkRuleCondition(condition) {
    const row = document.createElement('div');
    row.className = 'bulk-condition-row';

    const fieldSelect = document.createElement('select');
    fieldSelect.className = 'form-control';
    for (const def of this._bulkRuleFieldDefs()) {
      const opt = document.createElement('option');
      opt.value = def.key;
      opt.textContent = this._bulkFieldDisplayLabel(def);
      fieldSelect.appendChild(opt);
    }
    fieldSelect.value = condition.field;

    const operatorSelect = document.createElement('select');
    operatorSelect.className = 'form-control';
    const fillOperators = () => {
      operatorSelect.innerHTML = '';
      for (const [value, label] of this._bulkOperatorsForField(condition.field, 'if')) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        operatorSelect.appendChild(opt);
      }
      if (![...operatorSelect.options].some((opt) => opt.value === condition.operator)) {
        condition.operator = operatorSelect.options[0]?.value || 'equals';
      }
      operatorSelect.value = condition.operator;
    };
    fillOperators();

    const def = this._bulkFieldDef(condition.field);

    let valueControl;
    if (def.isRelType) {
      if (!RelationshipTaxonomy.isKnown(condition.value)) {
        condition.value = RelationshipTaxonomy.pickerOptions()[0].value;
      }
      valueControl = this._buildBulkRelTypeSelect(condition.value, (val) => {
        condition.value = val;
        this._updateBulkNormalizePreview();
      });
    } else {
      const valueInput = document.createElement('input');
      valueInput.className = 'form-control';
      valueInput.type = def.valueType === 'date' ? 'date' : 'text';
      valueInput.value = condition.value || '';
      valueInput.placeholder = 'Value';
      valueInput.classList.toggle('hidden', !this._bulkOperatorNeedsValue(condition.operator));
      valueInput.addEventListener('input', () => {
        condition.value = valueInput.value;
        this._updateBulkNormalizePreview();
      });
      valueControl = valueInput;
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-ghost btn-xs';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';

    fieldSelect.addEventListener('change', () => {
      const wasRel = this._bulkFieldDef(condition.field).isRelType;
      condition.field = fieldSelect.value;
      if (this._bulkFieldDef(condition.field).isRelType !== wasRel) condition.value = '';
      this._renderBulkRuleBuilder();
    });
    operatorSelect.addEventListener('change', () => {
      condition.operator = operatorSelect.value;
      if (valueControl.tagName === 'INPUT') {
        valueControl.classList.toggle('hidden', !this._bulkOperatorNeedsValue(condition.operator));
      }
      this._updateBulkNormalizePreview();
    });
    removeBtn.addEventListener('click', () => {
      this._removeBulkRuleNode(this._bulkRuleState.root, condition.id);
      this._renderBulkRuleBuilder();
    });

    row.append(fieldSelect, operatorSelect);
    row.append(def.isRelType ? valueControl.parentNode : valueControl, removeBtn);
    makeSearchable(fieldSelect, { placeholder: 'Search fields…' });
    return row;
  }

  _removeBulkRuleNode(group, nodeId) {
    group.children = group.children.filter((child) => child.id !== nodeId);
    for (const child of group.children) {
      if (child.type === 'group') this._removeBulkRuleNode(child, nodeId);
    }
    if (group.children.length === 0) group.children.push(this._newBulkRuleCondition());
  }

  _syncBulkActionControls() {
    if (!this._bulkRuleState) return;
    const action = this._bulkRuleState.action;
    const typeEl = document.getElementById('bulk-action-type');
    const fieldEl = document.getElementById('bulk-action-field');
    const valueEl = document.getElementById('bulk-action-value');
    const relEl = document.getElementById('bulk-action-rel');
    const whereEl = document.getElementById('bulk-where');

    if (![...fieldEl.options].some((opt) => opt.value === action.field)) action.field = 'org';
    fieldEl.value = action.field;
    if (fieldEl._searchable) fieldEl._searchable.refresh();

    const def = this._bulkFieldDef(action.field);
    const isEntity = !!def.entity;

    // THEN action-type options depend on the target field.
    const allowed = this._bulkAllowedActions(def);
    if (!allowed.includes(action.type)) action.type = allowed[0];
    const typeLabels = { set: 'Set', append: 'Append to', clear: 'Clear', remove: 'Remove' };
    typeEl.innerHTML = '';
    for (const t of allowed) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = typeLabels[t];
      typeEl.appendChild(opt);
    }
    typeEl.value = action.type;

    // Value control: plain text/date input OR a relationship-type picker OR none.
    const needsValue = !['clear', 'remove'].includes(action.type);
    const isRelTypeValue = def.valueType === 'relType';

    valueEl.classList.toggle('hidden', !needsValue || isRelTypeValue);
    if (needsValue && !isRelTypeValue) {
      valueEl.type = def.valueType === 'date' ? 'date' : 'text';
      valueEl.value = action.value || '';
    }

    relEl.classList.toggle('hidden', !needsValue || !isRelTypeValue);
    if (needsValue && isRelTypeValue) {
      if (!RelationshipTaxonomy.isKnown(action.value)) {
        action.value = RelationshipTaxonomy.pickerOptions()[0].value;
      }
      relEl.innerHTML = RelationshipTaxonomy.optionsHtml(action.value, false);
      relEl.value = action.value;
      makeSearchable(relEl, { placeholder: 'Search types…' });
    }

    // WHERE block only for multi-instance targets.
    whereEl.classList.toggle('hidden', !isEntity);
    if (isEntity) {
      // Drop WHERE conditions left over from a different entity.
      action.where.conditions = action.where.conditions.filter(
        (c) => this._bulkFieldDef(c.field).entity === def.entity,
      );
      this._renderBulkWhere(def.entity);
    }
  }

  _newBulkWhereCondition(entity) {
    const sub = this._bulkRuleFieldDefs().find((d) => d.entity === entity);
    return {
      id: `bulk-where-${++this._bulkRuleIdCounter}`,
      field: sub.key,
      operator: 'equals',
      value: sub.isRelType ? RelationshipTaxonomy.pickerOptions()[0].value : '',
    };
  }

  /** Render the WHERE block (conditions + apply-to scope) for an entity target. */
  _renderBulkWhere(entity) {
    const action = this._bulkRuleState.action;
    const eDef = this._bulkEntityDefs()[entity];

    const opEl = document.getElementById('bulk-where-op');
    opEl.value = action.where.op;
    document.getElementById('bulk-scope-plural-a').textContent = eDef.plural;
    document.getElementById('bulk-scope-plural-b').textContent = eDef.plural;
    for (const r of document.querySelectorAll('input[name="bulk-apply-to"]')) {
      r.checked = r.value === action.applyTo;
    }
    document
      .getElementById('bulk-where-warning')
      .classList.toggle('hidden', action.applyTo !== 'all');

    const matching = action.applyTo === 'matching';
    const cont = document.getElementById('bulk-where-conditions');
    cont.innerHTML = '';
    cont.classList.toggle('hidden', !matching);
    document.getElementById('bulk-where-add').classList.toggle('hidden', !matching);
    document.getElementById('bulk-where-row').classList.toggle('hidden', !matching);

    if (matching) {
      for (const cond of action.where.conditions) {
        cont.appendChild(this._renderBulkWhereCondition(cond, entity));
      }
      if (action.where.conditions.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'bulk-where-hint';
        hint.textContent = `Add a condition to choose which ${eDef.plural} to change — or switch to “all ${eDef.plural}”.`;
        cont.classList.remove('hidden');
        cont.appendChild(hint);
      }
    }
  }

  /** One WHERE condition row (instance-scope, restricted to the entity). */
  _renderBulkWhereCondition(cond, entity) {
    const row = document.createElement('div');
    row.className = 'bulk-condition-row';
    const subfields = this._bulkRuleFieldDefs().filter((d) => d.entity === entity);

    const fieldSelect = document.createElement('select');
    fieldSelect.className = 'form-control';
    for (const d of subfields) {
      const opt = document.createElement('option');
      opt.value = d.key;
      opt.textContent = d.label;
      fieldSelect.appendChild(opt);
    }
    fieldSelect.value = cond.field;

    const operatorSelect = document.createElement('select');
    operatorSelect.className = 'form-control';
    const fillOperators = () => {
      operatorSelect.innerHTML = '';
      for (const [value, label] of this._bulkOperatorsForField(cond.field, 'where')) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        operatorSelect.appendChild(opt);
      }
      if (![...operatorSelect.options].some((opt) => opt.value === cond.operator)) {
        cond.operator = operatorSelect.options[0]?.value || 'equals';
      }
      operatorSelect.value = cond.operator;
    };
    fillOperators();

    const def = this._bulkFieldDef(cond.field);

    let valueControl;
    if (def.isRelType) {
      if (!RelationshipTaxonomy.isKnown(cond.value)) {
        cond.value = RelationshipTaxonomy.pickerOptions()[0].value;
      }
      valueControl = this._buildBulkRelTypeSelect(cond.value, (val) => {
        cond.value = val;
        this._updateBulkNormalizePreview();
      });
    } else {
      const input = document.createElement('input');
      input.className = 'form-control';
      input.type = def.valueType === 'date' ? 'date' : 'text';
      input.value = cond.value || '';
      input.placeholder = 'Value';
      input.classList.toggle('hidden', !this._bulkOperatorNeedsValue(cond.operator));
      input.addEventListener('input', () => {
        cond.value = input.value;
        this._updateBulkNormalizePreview();
      });
      valueControl = input;
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-ghost btn-xs';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';

    fieldSelect.addEventListener('change', () => {
      const wasRel = this._bulkFieldDef(cond.field).isRelType;
      cond.field = fieldSelect.value;
      if (this._bulkFieldDef(cond.field).isRelType !== wasRel) cond.value = '';
      this._renderBulkWhere(entity);
      this._updateBulkNormalizePreview();
    });
    operatorSelect.addEventListener('change', () => {
      cond.operator = operatorSelect.value;
      if (valueControl.tagName === 'INPUT') {
        valueControl.classList.toggle('hidden', !this._bulkOperatorNeedsValue(cond.operator));
      }
      this._updateBulkNormalizePreview();
    });
    removeBtn.addEventListener('click', () => {
      this._bulkRuleState.action.where.conditions =
        this._bulkRuleState.action.where.conditions.filter((c) => c.id !== cond.id);
      this._renderBulkWhere(entity);
      this._updateBulkNormalizePreview();
    });

    row.append(fieldSelect, operatorSelect);
    row.append(def.isRelType ? valueControl.parentNode : valueControl, removeBtn);
    makeSearchable(fieldSelect, { placeholder: 'Search fields…' });
    return row;
  }

  // ── Evaluation ──────────────────────────────────────────────────────

  /** Compare one (instance or scalar) value against a condition. */
  _evaluateBulkCondition(condition, contact, instance) {
    const def = this._bulkFieldDef(condition.field);
    const raw = String(def.get(contact, instance) || '').trim();
    const actual = raw.toLowerCase();
    const expected = String(condition.value || '')
      .trim()
      .toLowerCase();

    switch (condition.operator) {
      case 'is-empty':
        return !raw;
      case 'is-not-empty':
        return !!raw;
      case 'equals':
        return actual === expected;
      case 'not-equals':
        return actual !== expected;
      case 'contains':
        return !!expected && actual.includes(expected);
      case 'not-contains':
        return !!expected && !actual.includes(expected);
      case 'starts-with':
        return !!expected && actual.startsWith(expected);
      case 'ends-with':
        return !!expected && actual.endsWith(expected);
      default:
        return false;
    }
  }

  /** IF condition for the relationship-type field (contact scope: has/has-not). */
  _evaluateBulkRelationshipCondition(condition, contact) {
    const want = RelationshipTaxonomy.normalize(condition.value || '');
    if (!want) return false;
    const has = (contact.related || []).some(
      (r) => RelationshipTaxonomy.normalize(r.type) === want,
    );
    return condition.operator === 'has-not' ? !has : has;
  }

  _evaluateBulkRuleNode(node, contact) {
    if (node.type === 'condition') {
      const def = this._bulkFieldDef(node.field);
      if (def.isRelType) {
        return this._evaluateBulkRelationshipCondition(node, contact);
      }
      if (def.entity) {
        // Contact matches if ANY instance of the entity satisfies the condition.
        return this._bulkEntityDefs()
          [def.entity].getList(contact)
          .some((inst) => this._evaluateBulkCondition(node, contact, inst));
      }
      return this._evaluateBulkCondition(node, contact, null);
    }
    const results = node.children.map((child) => this._evaluateBulkRuleNode(child, contact));
    return node.op === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }

  _contactMatchesBulkRule(contact) {
    if (!this._bulkRuleState?.root) return false;
    return this._evaluateBulkRuleNode(this._bulkRuleState.root, contact);
  }

  /** Does this single instance satisfy the WHERE filter? */
  _instanceMatchesWhere(contact, action, instance) {
    const where = action.where;
    if (!where || where.conditions.length === 0) return false;
    const results = where.conditions.map((cond) =>
      this._evaluateInstanceCondition(contact, instance, cond),
    );
    return where.op === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }

  _evaluateInstanceCondition(contact, instance, cond) {
    const def = this._bulkFieldDef(cond.field);
    if (def.isRelType) {
      const want = RelationshipTaxonomy.normalize(cond.value || '');
      if (!want) return false;
      const have = RelationshipTaxonomy.normalize(instance?.type || '');
      return cond.operator === 'not-equals' ? have !== want : have === want;
    }
    return this._evaluateBulkCondition(cond, contact, instance);
  }

  /** Indices of the instances the action targets on one contact. */
  _bulkSelectedInstances(contact, action, normalize = false) {
    const def = this._bulkFieldDef(action.field);
    const list = this._bulkEntityInstances(contact, def.entity, normalize);
    const idx =
      action.applyTo === 'all'
        ? list.map((_, i) => i)
        : list.map((_, i) => i).filter((i) => this._instanceMatchesWhere(contact, action, list[i]));
    return { list, idx };
  }

  /** A WHERE in 'matching' mode needs at least one usable condition. */
  _bulkWhereComplete(action) {
    if (action.applyTo === 'all') return true;
    return (action.where?.conditions || []).some(
      (c) => !this._bulkOperatorNeedsValue(c.operator) || String(c.value || '').trim() !== '',
    );
  }

  // ── Preview ─────────────────────────────────────────────────────────

  _bulkRulePreview() {
    if (!this._bulkRuleState?.root) return { contacts: [], fieldChanges: 0 };
    const action = this._bulkRuleState.action;
    const def = this._bulkFieldDef(action.field);
    const affected = [];
    let fieldChanges = 0;

    for (const contact of this.contacts) {
      if (!this._contactMatchesBulkRule(contact)) continue;

      if (!def.entity) {
        affected.push(contact);
        fieldChanges += 1;
        continue;
      }
      const { idx } = this._bulkSelectedInstances(contact, action, false);
      if (idx.length === 0) continue;
      affected.push(contact);
      fieldChanges += idx.length;
    }

    return { contacts: affected, fieldChanges };
  }

  _describeBulkRuleNode(node) {
    if (node.type === 'condition') {
      const def = this._bulkFieldDef(node.field);
      const opLabels = Object.fromEntries(this._bulkOperatorsForField(node.field, 'if'));
      const name = this._bulkFieldDisplayLabel(def);
      if (!this._bulkOperatorNeedsValue(node.operator)) {
        return `${name} ${opLabels[node.operator]}`;
      }
      return `${name} ${opLabels[node.operator]} "${node.value || ''}"`;
    }
    const joiner = node.op === 'OR' ? ' OR ' : ' AND ';
    return `(${node.children.map((child) => this._describeBulkRuleNode(child)).join(joiner)})`;
  }

  _describeBulkWhere(entity) {
    const action = this._bulkRuleState.action;
    const conds = (action.where?.conditions || []).filter(
      (c) => !this._bulkOperatorNeedsValue(c.operator) || String(c.value || '').trim() !== '',
    );
    const joiner = action.where.op === 'OR' ? ' OR ' : ' AND ';
    return conds
      .map((c) => {
        const def = this._bulkFieldDef(c.field);
        const opLabels = Object.fromEntries(this._bulkOperatorsForField(c.field, 'where'));
        if (!this._bulkOperatorNeedsValue(c.operator))
          return `${def.label} ${opLabels[c.operator]}`;
        const val = def.isRelType ? RelationshipTaxonomy.label(c.value) : c.value || '';
        return `${def.label} ${opLabels[c.operator]} "${val}"`;
      })
      .join(joiner);
  }

  _describeBulkAction() {
    const action = this._bulkRuleState?.action;
    if (!action) return '';
    const def = this._bulkFieldDef(action.field);
    const valueDisplay = def.isRelType
      ? RelationshipTaxonomy.label(action.value)
      : action.value || '';

    if (!def.entity) {
      const field = def.label;
      if (action.type === 'clear') return `clear ${field}`;
      if (action.type === 'append') return `append "${valueDisplay}" to ${field}`;
      return `set ${field} to "${valueDisplay}"`;
    }

    const eDef = this._bulkEntityDefs()[def.entity];
    const target = this._bulkFieldDisplayLabel(def);
    let base;
    if (action.type === 'remove') base = `remove ${eDef.plural}`;
    else if (action.type === 'clear') base = `clear ${target}`;
    else if (action.type === 'append') base = `append "${valueDisplay}" to ${target}`;
    else base = `set ${target} to "${valueDisplay}"`;

    const scope =
      action.applyTo === 'all'
        ? ` (all ${eDef.plural})`
        : ` where ${this._describeBulkWhere(def.entity) || '…'}`;
    return base + scope;
  }

  _bulkAppendValue(currentValue, appendValue, fieldKey) {
    const current = String(currentValue || '');
    const addition = String(appendValue || '');
    if (!current) return addition;
    if (!addition) return current;
    if (fieldKey === 'notes') return `${current}\n${addition}`;
    return `${current}${addition}`;
  }

  _updateBulkNormalizePreview() {
    if (!this._bulkRuleState) return;
    const summaryEl = document.getElementById('bulk-summary');
    const previewEl = document.getElementById('bulk-preview');
    const samplesWrap = document.getElementById('bulk-samples-wrap');
    const samplesEl = document.getElementById('bulk-samples');
    const applyBtn = document.getElementById('bulk-apply');

    const action = this._bulkRuleState.action;
    const def = this._bulkFieldDef(action.field);

    summaryEl.textContent = `If ${this._describeBulkRuleNode(this._bulkRuleState.root)}, then ${this._describeBulkAction()}.`;

    // A multi-instance target with no usable WHERE (and not "all") is incomplete.
    if (def.entity && !this._bulkWhereComplete(action)) {
      const eDef = this._bulkEntityDefs()[def.entity];
      previewEl.textContent = `Add a “where” condition to choose which ${eDef.plural} to change, or switch to “all ${eDef.plural}”.`;
      samplesWrap.classList.add('hidden');
      applyBtn.disabled = true;
      applyBtn.textContent = 'Apply Rule';
      return;
    }

    const preview = this._bulkRulePreview();
    if (preview.contacts.length === 0) {
      previewEl.textContent = 'This rule does not currently match any contacts.';
      samplesWrap.classList.add('hidden');
      applyBtn.disabled = true;
      applyBtn.textContent = 'Apply Rule to 0 Contacts';
      return;
    }

    const valueWord = def.entity ? 'instance' : 'field';
    previewEl.textContent = `This rule would affect ${preview.contacts.length} contact${preview.contacts.length !== 1 ? 's' : ''} and update ${preview.fieldChanges} ${valueWord} value${preview.fieldChanges !== 1 ? 's' : ''}.`;
    samplesEl.innerHTML = '';
    for (const contact of preview.contacts.slice(0, 8)) {
      const pill = document.createElement('span');
      pill.className = 'bulk-sample-pill';
      pill.textContent = contact.fn;
      samplesEl.appendChild(pill);
    }
    if (preview.contacts.length > 8) {
      const pill = document.createElement('span');
      pill.className = 'bulk-sample-pill';
      pill.textContent = `+${preview.contacts.length - 8} more`;
      samplesEl.appendChild(pill);
    }
    samplesWrap.classList.remove('hidden');
    applyBtn.disabled = false;
    const n = preview.contacts.length;
    applyBtn.textContent = `Apply Rule to ${n} Contact${n !== 1 ? 's' : ''}`;
  }

  // ── Apply ───────────────────────────────────────────────────────────

  _applyBulkNormalize() {
    if (!this._bulkRuleState) return;
    if (!document.getElementById('bulk-confirm-risk').checked) {
      this._showToast('Please confirm that you understand this bulk rule', 'error');
      return;
    }

    const action = this._bulkRuleState.action;
    const def = this._bulkFieldDef(action.field);

    if (def.entity && !this._bulkWhereComplete(action)) {
      this._showToast('Add a “where” condition or choose “all instances”', 'error');
      return;
    }

    const preview = this._bulkRulePreview();
    if (preview.contacts.length === 0) {
      this._showToast('This rule does not match any contacts', 'error');
      return;
    }

    const touched = new Set();
    let changeCount = 0;

    for (const contact of this.contacts) {
      if (!this._contactMatchesBulkRule(contact)) continue;

      // ── Scalar (single-value) target ──
      if (!def.entity) {
        if (action.type === 'append') {
          def.setScalar(contact, this._bulkAppendValue(def.get(contact), action.value, def.key));
        } else {
          def.setScalar(contact, action.type === 'clear' ? '' : action.value);
        }
        if (def.key === 'fn') {
          contact.name = this._namePartsFromDisplayName(contact.fn || '');
        } else if (def.key.startsWith('name-')) {
          contact.fn = this._composeDisplayName(contact.name) || contact.fn;
        }
        touched.add(contact.id);
        changeCount += 1;
        continue;
      }

      // ── Multi-instance target ──
      const { list, idx } = this._bulkSelectedInstances(contact, action, true);
      if (idx.length === 0) continue;

      if (def.entity === 'related') {
        if (action.type === 'remove') {
          const drop = new Set(idx);
          contact.related = list.filter((_, i) => !drop.has(i));
          touched.add(contact.id);
          changeCount += idx.length;
        } else {
          // Route through _applyRelationshipEdit so the reciprocal on the other
          // card stays consistent. Indices are stable (no splicing here).
          for (const i of idx) {
            const rel = list[i];
            if (def.key === 'relationship-type') {
              this._applyRelationshipEdit(
                contact,
                i,
                rel.name,
                RelationshipTaxonomy.normalize(action.value),
              );
            } else {
              const newName =
                action.type === 'append'
                  ? this._bulkAppendValue(rel.name, action.value, def.key)
                  : action.value;
              this._applyRelationshipEdit(contact, i, newName, rel.type);
            }
            touched.add(contact.id);
            changeCount += 1;
          }
        }
        continue;
      }

      // email / phone / url / address subfields
      if (action.type === 'remove') {
        const drop = new Set(idx);
        this._bulkEntityDefs()[def.entity].setList(
          contact,
          list.filter((_, i) => !drop.has(i)),
        );
        touched.add(contact.id);
        changeCount += idx.length;
      } else {
        for (const i of idx) {
          const inst = list[i];
          if (action.type === 'append') {
            def.setInst(
              contact,
              inst,
              this._bulkAppendValue(def.get(contact, inst), action.value, def.key),
            );
          } else {
            def.setInst(contact, inst, action.type === 'clear' ? '' : action.value);
          }
          touched.add(contact.id);
          changeCount += 1;
        }
      }
    }

    if (!changeCount) {
      this._showToast('No matching values found to change', 'error');
      return;
    }

    for (const contact of this.contacts) {
      if (!touched.has(contact.id)) continue;
      contact.noteTags = this.parser._extractHashtags(contact.notes);
      contact.tags = this.parser._inferTags(contact);
      this._rewriteEditableFields(contact);
    }

    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
    this._closeBulkNormalizeModal();
    this._showToast(
      `Applied rule to ${touched.size} contact${touched.size !== 1 ? 's' : ''} and updated ${changeCount} value${changeCount !== 1 ? 's' : ''}`,
      'success',
    );
  }
}

applyMixin(ContactRelationshipApp.prototype, BulkMixin);
