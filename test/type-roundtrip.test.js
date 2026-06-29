import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses } from './helpers/load-app.js';

// Hybrid raw preservation hinges on this invariant: an UNTOUCHED contact-method
// instance, after being rendered into the editor and collected back from the DOM,
// must produce the SAME content key it was parsed with — so the serializer
// re-emits its original bytes (e.g. Apple's iPhone TEL;type=IPHONE;type=CELL;...).

// Minimal stand-in for a collection item's DOM, matching the selectors that
// _collectTypesFromItem queries.
function fakeItem({ types = [], label = '', preferred = false }, taxonomyValues) {
  const known = new Set(taxonomyValues);
  const upper = types.map((t) => t.toUpperCase());
  const checked = upper.filter((t) => known.has(t));
  const structural = upper.filter((t) => !known.has(t) && t !== 'PREF');
  return {
    querySelectorAll(sel) {
      if (sel.includes('type-check')) return checked.map((value) => ({ value }));
      return [];
    },
    querySelector(sel) {
      if (sel.includes('type-structural')) return { value: JSON.stringify(structural) };
      if (sel.includes('preferred')) return { checked: preferred };
      if (sel.includes('type-label')) return { value: label };
      return null;
    },
  };
}

test('collecting an untouched type set reproduces its content key (all Apple phone perms)', () => {
  const ctx = loadBrowserClasses();
  const app = Object.create(ctx.ContactRelationshipApp.prototype);
  const { VCardUtils } = ctx;
  const taxonomy = app._typeTaxonomy('phone').map((t) => t.value);

  const cases = [
    ['IPHONE', 'CELL', 'VOICE', 'PREF'], // iPhone bundle
    ['CELL', 'VOICE'],
    ['APPLEWATCH', 'CELL', 'VOICE'],
    ['HOME', 'VOICE'],
    ['MAIN'],
    ['HOME', 'FAX'],
    ['WORK', 'FAX'],
    ['OTHER', 'FAX'],
    ['PAGER'],
  ];

  for (const types of cases) {
    const entry = { value: '12345678901', types, label: '' };
    const preferred = types.includes('PREF');
    const item = fakeItem({ types, preferred }, taxonomy);
    const collected = app._collectTypesFromItem(item);
    const collectedEntry = { value: '12345678901', types: collected.types, label: collected.label };
    assert.equal(
      VCardUtils.contactMethodKey('phone', collectedEntry),
      VCardUtils.contactMethodKey('phone', entry),
      `phone types ${types.join('+')} should round-trip through the editor unchanged`,
    );
  }
});

test('custom-labeled phone (no standard types) round-trips its key', () => {
  const ctx = loadBrowserClasses();
  const app = Object.create(ctx.ContactRelationshipApp.prototype);
  const { VCardUtils } = ctx;
  const taxonomy = app._typeTaxonomy('phone').map((t) => t.value);

  const entry = { value: '12345678901', types: [], label: 'a_custom_value' };
  const item = fakeItem({ types: [], label: 'a_custom_value' }, taxonomy);
  const collected = app._collectTypesFromItem(item);
  assert.equal(
    VCardUtils.contactMethodKey('phone', { value: '12345678901', ...collected }),
    VCardUtils.contactMethodKey('phone', entry),
  );
});
