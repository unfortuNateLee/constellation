import { ContactRelationshipApp } from './app.js';
import { applyMixin } from './apply-mixin.js';
import { RelationshipBuilder } from './relationship-builder.js';
import { RelationshipTaxonomy } from './relationship-taxonomy.js';
import { makeSearchable } from './searchable-select.js';

/**
 * Bulk-normalize rule engine: a nested AND/OR condition builder plus actions
 * (set / append / clear) applied across the contact set, with live preview.
 * Extracted from app.js verbatim.
 */
class BulkMixin {
  _openBulkNormalizeModal() {
    if (!this.contacts.length) {
      this._showToast('Load a VCF file first', 'error');
      return;
    }
    const firstRelType = RelationshipTaxonomy.pickerOptions()[0].value;
    this._bulkRuleState = {
      root: this._newBulkRuleGroup(),
      action: {
        type: 'set',
        field: 'address-country',
        value: '',
        // Used only when the action field is the relationship-type retype.
        fromType: firstRelType,
        toType: firstRelType,
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
      field: 'address-country',
      operator: 'equals',
      value: '',
    };
  }

  _bulkRuleFieldDefs() {
    return [
      {
        key: 'fn',
        label: 'Display Name',
        scope: 'contact',
        get: (c) => c.fn || '',
        set: (c, v) => {
          c.fn = v;
        },
      },
      {
        key: 'name-given',
        label: 'First Name',
        scope: 'contact',
        get: (c) => c.name?.given || '',
        set: (c, v) => {
          c.name.given = v;
        },
      },
      {
        key: 'name-additional',
        label: 'Middle Name',
        scope: 'contact',
        get: (c) => c.name?.additional || '',
        set: (c, v) => {
          c.name.additional = v;
        },
      },
      {
        key: 'name-family',
        label: 'Last Name',
        scope: 'contact',
        get: (c) => c.name?.family || '',
        set: (c, v) => {
          c.name.family = v;
        },
      },
      {
        key: 'name-prefix',
        label: 'Prefix',
        scope: 'contact',
        get: (c) => c.name?.prefix || '',
        set: (c, v) => {
          c.name.prefix = v;
        },
      },
      {
        key: 'name-suffix',
        label: 'Suffix',
        scope: 'contact',
        get: (c) => c.name?.suffix || '',
        set: (c, v) => {
          c.name.suffix = v;
        },
      },
      {
        key: 'org',
        label: 'Organization',
        scope: 'contact',
        get: (c) => c.org || '',
        set: (c, v) => {
          c.org = v;
        },
      },
      {
        key: 'title',
        label: 'Title',
        scope: 'contact',
        get: (c) => c.title || '',
        set: (c, v) => {
          c.title = v;
        },
      },
      {
        key: 'notes',
        label: 'Notes',
        scope: 'contact',
        get: (c) => (c.notes || []).join('\n\n'),
        set: (c, v) => {
          c.notes = this._splitNotes(v || '');
        },
      },
      {
        key: 'birthday',
        label: 'Birthday',
        scope: 'contact',
        type: 'date',
        get: (c) => c.birthday || '',
        set: (c, v) => {
          c.birthday = v || null;
        },
      },
      {
        key: 'anniversary',
        label: 'Anniversary',
        scope: 'contact',
        type: 'date',
        get: (c) => c.anniversary || '',
        set: (c, v) => {
          c.anniversary = v || null;
        },
      },
      {
        key: 'email',
        label: 'Email Address',
        scope: 'email',
        get: (_c, e) => e?.value || '',
        set: null,
      },
      {
        key: 'address-country',
        label: 'Address Country',
        scope: 'address',
        get: (_c, a) => a?.country || '',
        set: (_c, a, v) => {
          a.country = v;
        },
      },
      {
        key: 'address-state',
        label: 'Address State / Province',
        scope: 'address',
        get: (_c, a) => a?.state || '',
        set: (_c, a, v) => {
          a.state = v;
        },
      },
      {
        key: 'address-city',
        label: 'Address City',
        scope: 'address',
        get: (_c, a) => a?.city || '',
        set: (_c, a, v) => {
          a.city = v;
        },
      },
      {
        key: 'address-street',
        label: 'Address Street',
        scope: 'address',
        get: (_c, a) => a?.street || '',
        set: (_c, a, v) => {
          a.street = v;
        },
      },
      {
        // Relationships are a per-contact list of { type, name, uid }, not a flat
        // field — handled specially in evaluation (condition) and apply (retype).
        key: 'relationship-type',
        label: 'Relationship Type',
        scope: 'related',
        isRelType: true,
        get: (c) => (c.related || []).map((r) => RelationshipTaxonomy.label(r.type)).join(', '),
        set: null,
      },
    ];
  }

  _bulkFieldDef(fieldKey) {
    return (
      this._bulkRuleFieldDefs().find((def) => def.key === fieldKey) || this._bulkRuleFieldDefs()[0]
    );
  }

  _bulkOperatorsForField(fieldKey) {
    const def = this._bulkFieldDef(fieldKey);
    if (def.isRelType) {
      return [
        ['has', 'has type'],
        ['has-not', 'does not have type'],
      ];
    }
    if (def.type === 'date') {
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
    // Editable fields: those with a setter, plus the special relationship retype.
    for (const def of this._bulkRuleFieldDefs().filter((def) => !!def.set || def.isRelType)) {
      const opt = document.createElement('option');
      opt.value = def.key;
      opt.textContent = def.label;
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

  _renderBulkRuleCondition(condition) {
    const row = document.createElement('div');
    row.className = 'bulk-condition-row';

    const fieldSelect = document.createElement('select');
    fieldSelect.className = 'form-control';
    for (const def of this._bulkRuleFieldDefs()) {
      const opt = document.createElement('option');
      opt.value = def.key;
      opt.textContent = def.label;
      fieldSelect.appendChild(opt);
    }
    fieldSelect.value = condition.field;

    const operatorSelect = document.createElement('select');
    operatorSelect.className = 'form-control';
    const fillOperators = () => {
      operatorSelect.innerHTML = '';
      for (const [value, label] of this._bulkOperatorsForField(condition.field)) {
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

    // The value control is a relationship-type picker for the relationship field,
    // otherwise a plain text / date input.
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
      valueInput.type = def.type === 'date' ? 'date' : 'text';
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
      // Crossing the relationship/plain boundary changes the value control's
      // shape, so reset the value and re-render the builder.
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
    // For the relationship picker the value control is wrapped by makeSearchable,
    // so append its wrapper (parent) rather than the now-hidden native select.
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
    const retypeEl = document.getElementById('bulk-rel-retype');

    fieldEl.value = action.field;
    if (![...fieldEl.options].some((opt) => opt.value === action.field)) {
      action.field = 'notes';
      fieldEl.value = 'notes';
    }
    if (fieldEl._searchable) fieldEl._searchable.refresh();

    // Coerce to a real boolean — classList.toggle(cls, undefined) *flips*
    // instead of setting, which made the THEN controls alternate on reopen.
    const isRelType = !!this._bulkFieldDef(action.field).isRelType;
    // Relationship retype swaps the set/append/clear + value controls for a
    // "from type → to type" pair.
    typeEl.classList.toggle('hidden', isRelType);
    valueEl.classList.toggle('hidden', isRelType);
    retypeEl.classList.toggle('hidden', !isRelType);

    if (isRelType) {
      this._populateBulkRelRetypeSelect('bulk-rel-from', action.fromType);
      this._populateBulkRelRetypeSelect('bulk-rel-to', action.toType);
      return;
    }

    typeEl.value = action.type;
    valueEl.value = action.value || '';
    valueEl.type = this._bulkFieldDef(action.field).type === 'date' ? 'date' : 'text';
    // "Clear Field" removes the value, so the value box is unnecessary — hide it.
    valueEl.classList.toggle('hidden', action.type === 'clear');
  }

  /** Fill one of the relationship retype <select>s and make it searchable.
   *  Change handling is wired once in app-bootstrap against live state. */
  _populateBulkRelRetypeSelect(id, selectedType) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = RelationshipTaxonomy.optionsHtml(selectedType, false);
    if (selectedType) select.value = selectedType;
    makeSearchable(select, { placeholder: 'Search types…' });
  }

  _bulkRuleUsesAddressFields(node = this._bulkRuleState?.root) {
    if (!node) return false;
    if (node.type === 'condition') return this._bulkFieldDef(node.field).scope === 'address';
    return node.children.some((child) => this._bulkRuleUsesAddressFields(child));
  }

  _evaluateBulkCondition(condition, contact, address) {
    const def = this._bulkFieldDef(condition.field);
    const raw = String(def.get(contact, address) || '').trim();
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

  /** Condition match for the relationship-type field (scope 'related'). */
  _evaluateBulkRelationshipCondition(condition, contact) {
    const want = RelationshipTaxonomy.normalize(condition.value || '');
    if (!want) return false;
    const has = (contact.related || []).some(
      (r) => RelationshipTaxonomy.normalize(r.type) === want,
    );
    return condition.operator === 'has-not' ? !has : has;
  }

  _evaluateBulkRuleNode(node, contact, address) {
    if (node.type === 'condition') {
      const def = this._bulkFieldDef(node.field);
      if (def.scope === 'related') {
        return this._evaluateBulkRelationshipCondition(node, contact);
      }
      if (def.scope === 'address') {
        return (contact.addresses || []).some((addr) =>
          this._evaluateBulkCondition(node, contact, addr),
        );
      }
      if (def.scope === 'email') {
        return (contact.emails || []).some((email) =>
          this._evaluateBulkCondition(node, contact, email),
        );
      }
      return this._evaluateBulkCondition(node, contact, address || null);
    }
    const results = node.children.map((child) =>
      this._evaluateBulkRuleNode(child, contact, address),
    );
    return node.op === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }

  _contactMatchesBulkRule(contact) {
    if (!this._bulkRuleState?.root) return false;
    return this._evaluateBulkRuleNode(this._bulkRuleState.root, contact, null);
  }

  _bulkRulePreview() {
    if (!this._bulkRuleState?.root) {
      return { contacts: [], fieldChanges: 0 };
    }
    const actionDef = this._bulkFieldDef(this._bulkRuleState.action.field);
    const affected = [];
    let fieldChanges = 0;

    for (const contact of this.contacts) {
      const matched = this._contactMatchesBulkRule(contact);
      if (!matched) continue;
      affected.push(contact);

      if (actionDef.isRelType) {
        const from = RelationshipTaxonomy.normalize(this._bulkRuleState.action.fromType);
        for (const r of contact.related || []) {
          if (RelationshipTaxonomy.normalize(r.type) === from) fieldChanges += 1;
        }
        continue;
      }
      if (actionDef.scope === 'contact') {
        fieldChanges += 1;
        continue;
      }
      const addresses = contact.addresses || [];
      for (const address of addresses) {
        const shouldChange = this._bulkRuleUsesAddressFields()
          ? this._evaluateBulkRuleNode(this._bulkRuleState.root, contact, address)
          : true;
        if (shouldChange) fieldChanges += 1;
      }
    }

    return { contacts: affected, fieldChanges };
  }

  _describeBulkRuleNode(node) {
    if (node.type === 'condition') {
      const def = this._bulkFieldDef(node.field);
      const opLabels = Object.fromEntries(this._bulkOperatorsForField(node.field));
      if (!this._bulkOperatorNeedsValue(node.operator)) {
        return `${def.label} ${opLabels[node.operator]}`;
      }
      return `${def.label} ${opLabels[node.operator]} "${node.value || ''}"`;
    }
    const joiner = node.op === 'OR' ? ' OR ' : ' AND ';
    return `(${node.children.map((child) => this._describeBulkRuleNode(child)).join(joiner)})`;
  }

  _describeBulkAction() {
    const action = this._bulkRuleState?.action;
    if (!action) return '';
    const def = this._bulkFieldDef(action.field);
    if (def.isRelType) {
      return `change relationships of type "${RelationshipTaxonomy.label(
        action.fromType,
      )}" to "${RelationshipTaxonomy.label(action.toType)}"`;
    }
    const field = def.label;
    if (action.type === 'clear') return `clear ${field}`;
    if (action.type === 'append') return `append "${action.value || ''}" to ${field}`;
    return `set ${field} to "${action.value || ''}"`;
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

    const preview = this._bulkRulePreview();
    summaryEl.textContent = `If ${this._describeBulkRuleNode(this._bulkRuleState.root)}, then ${this._describeBulkAction()}.`;

    if (preview.contacts.length === 0) {
      previewEl.textContent = 'This rule does not currently match any contacts.';
      samplesWrap.classList.add('hidden');
      applyBtn.disabled = true;
      applyBtn.textContent = 'Apply Rule to 0 Contacts';
      return;
    }

    previewEl.textContent = `This rule would affect ${preview.contacts.length} contact${preview.contacts.length !== 1 ? 's' : ''} and update ${preview.fieldChanges} field value${preview.fieldChanges !== 1 ? 's' : ''}.`;
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

  _applyBulkNormalize() {
    if (!this._bulkRuleState) return;
    if (!document.getElementById('bulk-confirm-risk').checked) {
      this._showToast('Please confirm that you understand this bulk rule', 'error');
      return;
    }

    const action = this._bulkRuleState.action;
    const actionDef = this._bulkFieldDef(action.field);
    const preview = this._bulkRulePreview();
    if (preview.contacts.length === 0) {
      this._showToast('This rule does not match any contacts', 'error');
      return;
    }

    const touchedContacts = new Set();
    let changeCount = 0;
    for (const contact of this.contacts) {
      if (!this._contactMatchesBulkRule(contact)) continue;

      if (actionDef.isRelType) {
        // Retype every relationship of the chosen "from" type to the "to" type.
        // _applyRelationshipEdit also updates the reciprocal on the other card.
        const from = RelationshipTaxonomy.normalize(action.fromType);
        (contact.related || []).forEach((rel, idx) => {
          if (RelationshipTaxonomy.normalize(rel.type) !== from) return;
          this._applyRelationshipEdit(contact, idx, rel.name, action.toType);
          touchedContacts.add(contact.id);
          changeCount += 1;
        });
        continue;
      }

      if (actionDef.scope === 'contact') {
        if (action.type === 'append') {
          const currentValue = actionDef.get(contact, null);
          const nextValue = this._bulkAppendValue(currentValue, action.value, actionDef.key);
          actionDef.set(contact, nextValue);
        } else {
          const nextValue = action.type === 'clear' ? '' : action.value;
          actionDef.set(contact, nextValue);
        }
        if (actionDef.key === 'fn') {
          contact.name = this._namePartsFromDisplayName(contact.fn || '');
        } else if (actionDef.key.startsWith('name-')) {
          contact.fn = this._composeDisplayName(contact.name) || contact.fn;
        }
        touchedContacts.add(contact.id);
        changeCount += 1;
        continue;
      }

      const addresses = contact.addresses || [];
      for (const address of addresses) {
        const shouldChange = this._bulkRuleUsesAddressFields()
          ? this._evaluateBulkRuleNode(this._bulkRuleState.root, contact, address)
          : true;
        if (!shouldChange) continue;
        if (action.type === 'append') {
          const currentValue = actionDef.get(contact, address);
          const nextValue = this._bulkAppendValue(currentValue, action.value, actionDef.key);
          actionDef.set(contact, address, nextValue);
        } else {
          actionDef.set(contact, address, action.type === 'clear' ? '' : action.value);
        }
        touchedContacts.add(contact.id);
        changeCount += 1;
      }
    }

    if (!changeCount) {
      this._showToast('No matching values found to change', 'error');
      return;
    }

    for (const contact of this.contacts) {
      if (!touchedContacts.has(contact.id)) continue;
      contact.noteTags = this.parser._extractHashtags(contact.notes);
      contact.tags = this.parser._inferTags(contact);
      this._rewriteEditableFields(contact);
    }

    this.builder = new RelationshipBuilder(this.contacts);
    this._rebuildGraph();
    void this._persistSession();
    this._closeBulkNormalizeModal();
    this._showToast(
      `Applied rule to ${touchedContacts.size} contact${touchedContacts.size !== 1 ? 's' : ''} and updated ${changeCount} value${changeCount !== 1 ? 's' : ''}`,
      'success',
    );
  }
}

applyMixin(ContactRelationshipApp.prototype, BulkMixin);
