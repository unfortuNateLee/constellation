/**
 * Shared contact-method TYPE taxonomy — the single source for the user-facing
 * standard types of emails / phones / urls / addresses, as ordered
 * { value: <vCard TYPE>, label: <display> } pairs. Consumed by the detail/table
 * type editor (app-editing.js) and the Markdown adapter (which renders/parses a
 * type label string). `CELL` shows as "Mobile"; the FAX combos render as
 * "Home Fax"/"Work Fax".
 */
const TAXONOMY = {
  phone: [
    ['CELL', 'Mobile'],
    ['IPHONE', 'iPhone'],
    ['APPLEWATCH', 'Apple Watch'],
    ['HOME', 'Home'],
    ['WORK', 'Work'],
    ['MAIN', 'Main'],
    ['FAX', 'Fax'],
    ['PAGER', 'Pager'],
    ['OTHER', 'Other'],
  ],
  email: [
    ['HOME', 'Home'],
    ['WORK', 'Work'],
    ['SCHOOL', 'School'],
    ['ICLOUD', 'iCloud'],
    ['OTHER', 'Other'],
  ],
  url: [
    ['HOME', 'Home'],
    ['WORK', 'Work'],
    ['OTHER', 'Other'],
  ],
  address: [
    ['HOME', 'Home'],
    ['WORK', 'Work'],
    ['OTHER', 'Other'],
  ],
};

// Types that are structural/implied and never shown as a user label.
const HIDDEN_TYPES = new Set(['PREF', 'VOICE', 'INTERNET']);

/** Ordered { value, label } type options for a kind (default: address set). */
export function typeTaxonomy(kind) {
  return (TAXONOMY[kind] || TAXONOMY.address).map(([value, label]) => ({ value, label }));
}

/**
 * Render a type set + optional custom label to a single human label string, the
 * way the Markdown format and read-only UI show it: a custom label wins; else the
 * visible types as Title-Case words (FAX combos collapse to "Home Fax" etc.),
 * with "Preferred" appended when PREF is set.
 */
export function typesToLabel(kind, types = [], customLabel = '') {
  if (customLabel) return customLabel;
  const up = (types || []).map((t) => String(t || '').toUpperCase());
  const preferred = up.includes('PREF');
  let label;
  if (kind === 'phone' && up.includes('FAX')) {
    label = up.includes('HOME')
      ? 'Home Fax'
      : up.includes('WORK')
        ? 'Work Fax'
        : up.includes('OTHER')
          ? 'Other Fax'
          : 'Fax';
  } else {
    const labelOf = Object.fromEntries(typeTaxonomy(kind).map((t) => [t.value, t.label]));
    const parts = up
      .filter((t) => !HIDDEN_TYPES.has(t))
      .map((t) => labelOf[t] || t.charAt(0) + t.slice(1).toLowerCase());
    label = parts.join(', ');
  }
  if (preferred) label = label ? `${label}, Preferred` : 'Preferred';
  return label;
}

/**
 * Parse a human label string back to { types[], label }. Every comma-separated
 * token must be a known type (or "preferred", or a FAX combo) to be treated as
 * types; otherwise the whole string is taken as a custom X-ABLabel. Case-insensitive.
 */
export function labelToTypes(kind, labelStr) {
  const raw = String(labelStr || '').trim();
  if (!raw) return { types: [], label: '' };

  const tokenToType = new Map();
  for (const { value, label } of typeTaxonomy(kind)) {
    tokenToType.set(value.toLowerCase(), value);
    tokenToType.set(label.toLowerCase(), value);
  }
  const composites = {
    'home fax': ['HOME', 'FAX'],
    'work fax': ['WORK', 'FAX'],
    'other fax': ['OTHER', 'FAX'],
  };

  const tokens = raw.split(',').map((t) => t.trim().toLowerCase());
  const types = [];
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok === 'preferred' || tok === 'pref') {
      types.push('PREF');
    } else if (composites[tok]) {
      types.push(...composites[tok]);
    } else if (tokenToType.has(tok)) {
      types.push(tokenToType.get(tok));
    } else {
      // An unrecognized token → the whole label is a custom X-ABLabel.
      return { types: [], label: raw };
    }
  }
  return { types: [...new Set(types)], label: '' };
}
