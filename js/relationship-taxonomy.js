/**
 * RelationshipTaxonomy — single source of truth for relationship types.
 *
 * Before this module the same ~40-type taxonomy was duplicated across the
 * parser (label normalization), the relationship builder (friendly labels,
 * edge category, valid-reciprocal pairs) and the controller (reciprocal type,
 * vCard label, known-type set, reciprocal-downgrade groups, dropdown options).
 * Those maps had to be hand-kept in sync. They now all derive from `TYPES`
 * plus the small data tables below; the old methods are thin delegators.
 *
 * Each entry in TYPES:
 *   label      display / friendly label (e.g. "Husband")
 *   category   edge category: family | friend | work | neighbor | other
 *   reciprocal canonical key of the (generic) reciprocal type
 *   generic    for a gendered/specific type, its generic parent (husband→spouse);
 *              used to detect reciprocal "downgrades"
 *   vcardLabel optional override for the X-ABLabel text (defaults to label)
 */
export class RelationshipTaxonomy {
  static TYPES = {
    // Spouse / partner
    spouse: { label: 'Spouse', category: 'family', reciprocal: 'spouse' },
    husband: { label: 'Husband', category: 'family', reciprocal: 'wife', generic: 'spouse' },
    wife: { label: 'Wife', category: 'family', reciprocal: 'husband', generic: 'spouse' },
    partner: { label: 'Partner', category: 'family', reciprocal: 'partner' },
    // Parents
    mother: { label: 'Mother', category: 'family', reciprocal: 'child', generic: 'parent' },
    father: { label: 'Father', category: 'family', reciprocal: 'child', generic: 'parent' },
    parent: { label: 'Parent', category: 'family', reciprocal: 'child' },
    stepmother: {
      label: 'Stepmother',
      category: 'family',
      reciprocal: 'stepchild',
      generic: 'stepparent',
    },
    stepfather: {
      label: 'Stepfather',
      category: 'family',
      reciprocal: 'stepchild',
      generic: 'stepparent',
    },
    stepparent: { label: 'Stepparent', category: 'family', reciprocal: 'stepchild' },
    // Children
    son: { label: 'Son', category: 'family', reciprocal: 'parent', generic: 'child' },
    daughter: { label: 'Daughter', category: 'family', reciprocal: 'parent', generic: 'child' },
    child: { label: 'Child', category: 'family', reciprocal: 'parent' },
    stepson: {
      label: 'Stepson',
      category: 'family',
      reciprocal: 'stepparent',
      generic: 'stepchild',
    },
    stepdaughter: {
      label: 'Stepdaughter',
      category: 'family',
      reciprocal: 'stepparent',
      generic: 'stepchild',
    },
    stepchild: { label: 'Stepchild', category: 'family', reciprocal: 'stepparent' },
    // Siblings
    brother: { label: 'Brother', category: 'family', reciprocal: 'sibling', generic: 'sibling' },
    sister: { label: 'Sister', category: 'family', reciprocal: 'sibling', generic: 'sibling' },
    sibling: { label: 'Sibling', category: 'family', reciprocal: 'sibling' },
    // Grandparents
    grandmother: {
      label: 'Grandmother',
      category: 'family',
      reciprocal: 'grandchild',
      generic: 'grandparent',
    },
    grandfather: {
      label: 'Grandfather',
      category: 'family',
      reciprocal: 'grandchild',
      generic: 'grandparent',
    },
    grandparent: { label: 'Grandparent', category: 'family', reciprocal: 'grandchild' },
    // Grandchildren
    grandson: {
      label: 'Grandson',
      category: 'family',
      reciprocal: 'grandparent',
      generic: 'grandchild',
    },
    granddaughter: {
      label: 'Granddaughter',
      category: 'family',
      reciprocal: 'grandparent',
      generic: 'grandchild',
    },
    grandchild: { label: 'Grandchild', category: 'family', reciprocal: 'grandparent' },
    // Extended family
    uncle: { label: 'Uncle', category: 'family', reciprocal: 'nephew' },
    aunt: { label: 'Aunt', category: 'family', reciprocal: 'niece' },
    nephew: { label: 'Nephew', category: 'family', reciprocal: 'uncle' },
    niece: { label: 'Niece', category: 'family', reciprocal: 'aunt' },
    cousin: { label: 'Cousin', category: 'family', reciprocal: 'cousin' },
    // Social / professional
    friend: { label: 'Friend', category: 'friend', reciprocal: 'friend' },
    neighbor: { label: 'Neighbor', category: 'neighbor', reciprocal: 'neighbor' },
    colleague: { label: 'Colleague', category: 'work', reciprocal: 'colleague' },
    manager: { label: 'Manager', category: 'work', reciprocal: 'assistant' },
    assistant: { label: 'Assistant', category: 'work', reciprocal: 'manager' },
    // Backward-compat combined / hyphenated forms (recognized, not offered in the picker)
    'step-parent': { label: 'Stepparent', category: 'family', reciprocal: 'stepchild' },
    'step-child': { label: 'Stepchild', category: 'family', reciprocal: 'stepparent' },
    'uncle/aunt': {
      label: 'Uncle/Aunt',
      vcardLabel: 'Uncle',
      category: 'family',
      reciprocal: 'nephew/niece',
    },
    'nephew/niece': {
      label: 'Nephew/Niece',
      vcardLabel: 'Nephew',
      category: 'family',
      reciprocal: 'uncle/aunt',
    },
  };

  // Alternate labels (post Apple-wrapper strip + lowercase) → canonical key.
  static ALIASES = {
    'domestic partner': 'partner',
    'step mother': 'stepmother',
    'step father': 'stepfather',
    'step parent': 'stepparent',
    'step-parent': 'stepparent',
    'step son': 'stepson',
    'step daughter': 'stepdaughter',
    'step child': 'stepchild',
    'step-child': 'stepchild',
    'grand mother': 'grandmother',
    'grand father': 'grandfather',
    'grand parent': 'grandparent',
    'grand son': 'grandson',
    'grand daughter': 'granddaughter',
    'grand child': 'grandchild',
    'best friend': 'friend',
    coworker: 'colleague',
    'co-worker': 'colleague',
    boss: 'manager',
  };

  // Sensible reciprocal pairs (checked in both directions). Listed once.
  static VALID_RECIPROCAL_PAIRS = [
    ['spouse', 'spouse'],
    ['husband', 'wife'],
    ['husband', 'spouse'],
    ['wife', 'spouse'],
    ['partner', 'partner'],
    ['friend', 'friend'],
    ['colleague', 'colleague'],
    ['neighbor', 'neighbor'],
    ['cousin', 'cousin'],
    ['manager', 'assistant'],
    ['mother', 'son'],
    ['mother', 'daughter'],
    ['mother', 'child'],
    ['father', 'son'],
    ['father', 'daughter'],
    ['father', 'child'],
    ['parent', 'son'],
    ['parent', 'daughter'],
    ['parent', 'child'],
    ['stepmother', 'stepson'],
    ['stepmother', 'stepdaughter'],
    ['stepmother', 'stepchild'],
    ['stepfather', 'stepson'],
    ['stepfather', 'stepdaughter'],
    ['stepfather', 'stepchild'],
    ['stepparent', 'stepson'],
    ['stepparent', 'stepdaughter'],
    ['stepparent', 'stepchild'],
    ['step-parent', 'step-child'],
    ['step-parent', 'stepson'],
    ['step-parent', 'stepdaughter'],
    ['step-parent', 'stepchild'],
    ['stepparent', 'step-child'],
    ['brother', 'brother'],
    ['brother', 'sister'],
    ['brother', 'sibling'],
    ['sister', 'sister'],
    ['sister', 'sibling'],
    ['sibling', 'sibling'],
    ['grandmother', 'grandson'],
    ['grandmother', 'granddaughter'],
    ['grandmother', 'grandchild'],
    ['grandfather', 'grandson'],
    ['grandfather', 'granddaughter'],
    ['grandfather', 'grandchild'],
    ['grandparent', 'grandson'],
    ['grandparent', 'granddaughter'],
    ['grandparent', 'grandchild'],
    ['uncle', 'nephew'],
    ['uncle', 'niece'],
    ['aunt', 'nephew'],
    ['aunt', 'niece'],
    ['uncle/aunt', 'nephew/niece'],
    ['uncle/aunt', 'nephew'],
    ['uncle/aunt', 'niece'],
  ];

  // Picker tree — the order and nesting shown in the relationship-type picker.
  // Each top-level entry is a selectable type; a generic parent (e.g. `spouse`)
  // carries its gendered / more-specific subtypes, which render indented beneath
  // it. The user can select either the generic parent or any subtype. Stored
  // values are always the canonical keys below.
  static PICKER_TREE = [
    { key: 'spouse', subtypes: ['husband', 'wife', 'partner'] },
    { key: 'parent', subtypes: ['mother', 'father'] },
    { key: 'stepparent', subtypes: ['stepmother', 'stepfather'] },
    { key: 'child', subtypes: ['son', 'daughter'] },
    { key: 'stepchild', subtypes: ['stepson', 'stepdaughter'] },
    { key: 'sibling', subtypes: ['brother', 'sister'] },
    { key: 'grandparent', subtypes: ['grandmother', 'grandfather'] },
    { key: 'grandchild', subtypes: ['grandson', 'granddaughter'] },
    { key: 'uncle' },
    { key: 'aunt' },
    { key: 'nephew' },
    { key: 'niece' },
    { key: 'cousin' },
    { key: 'friend' },
    { key: 'neighbor' },
    { key: 'colleague' },
    { key: 'manager' },
    { key: 'assistant' },
  ];

  static CUSTOM_OPTION_VALUE = '__custom__';

  static _cap(type) {
    const s = String(type || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  /** Apple-wrapper strip + lowercase + alias resolution → canonical key. */
  static normalize(label) {
    const cleaned = String(label || '')
      .replace(/^_\$!<(.+)>!\$_$/, '$1')
      .toLowerCase()
      .trim();
    return this.ALIASES[cleaned] || cleaned;
  }

  /** Friendly display label, e.g. "Husband". Falls back to capitalized input. */
  static label(type) {
    const entry = this.TYPES[type];
    if (entry) return entry.label;
    return type ? this._cap(type) : 'Related';
  }

  /** Apple X-ABLabel text wrapped in the `_$!<…>!$_` marker. */
  static vcardLabel(type) {
    const entry = this.TYPES[type];
    const text = entry ? entry.vcardLabel || entry.label : this._cap(type);
    return `_$!<${text}>!$_`;
  }

  /** Edge category: family | friend | work | neighbor | other. */
  static category(type) {
    return this.TYPES[type]?.category || 'other';
  }

  /** Canonical (generic) reciprocal type; returns input unchanged if unknown. */
  static reciprocal(type) {
    return this.TYPES[type]?.reciprocal || type;
  }

  static isKnown(type) {
    return Object.prototype.hasOwnProperty.call(this.TYPES, String(type || '').toLowerCase());
  }

  static isValidReciprocal(typeA, typeB) {
    for (const [a, b] of this.VALID_RECIPROCAL_PAIRS) {
      if ((typeA === a && typeB === b) || (typeA === b && typeB === a)) return true;
    }
    return false;
  }

  /** True when `candidate` (a generic) is less specific than the existing type. */
  static isReciprocalDowngrade(candidate, existing) {
    return this.TYPES[existing]?.generic === candidate;
  }

  /**
   * Flat, ordered picker options derived from PICKER_TREE.
   * Each: { value, label, depth } where depth 1 marks an indented subtype.
   * Shared by optionsHtml() (native <select>) and the searchable combobox.
   */
  static pickerOptions() {
    const opts = [];
    for (const node of this.PICKER_TREE) {
      opts.push({ value: node.key, label: this.label(node.key), depth: 0 });
      for (const sub of node.subtypes || []) {
        opts.push({ value: sub, label: this.label(sub), depth: 1 });
      }
    }
    return opts;
  }

  /** Indentation prefix (non-breaking spaces) used to nest subtype options. */
  static PICKER_INDENT = '   ';

  /** Flat <option> HTML for the relationship-type picker. Subtypes are indented
   *  under their generic parent (no <optgroup>). Pass includeCustom=false to omit
   *  the "Custom…" escape hatch (e.g. for pickers that must yield a known type). */
  static optionsHtml(selectedType, includeCustom = true) {
    let html = '';
    const selectable = [];
    for (const { value, label, depth } of this.pickerOptions()) {
      selectable.push(value);
      const text = depth > 0 ? this.PICKER_INDENT + label : label;
      html += `<option value="${value}"${value === selectedType ? ' selected' : ''}>${text}</option>`;
    }
    if (includeCustom) {
      const isUnknown = selectedType && !selectable.includes(selectedType);
      html += `<option value="${this.CUSTOM_OPTION_VALUE}"${isUnknown ? ' selected' : ''}>Custom…</option>`;
    }
    return html;
  }
}
