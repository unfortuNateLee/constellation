import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses } from './helpers/load-app.js';

test('taxonomy is the single source of truth that the legacy methods delegate to', () => {
  const ctx = loadBrowserClasses();
  const T = ctx.RelationshipTaxonomy;
  const builder = new ctx.RelationshipBuilder([]);
  const parser = new ctx.VCFParser();
  const app = ctx.ContactRelationshipApp.prototype;

  // Each old method now returns exactly what the taxonomy says.
  assert.equal(builder._friendlyType('husband'), T.label('husband'));
  assert.equal(builder._edgeCategory('colleague'), T.category('colleague'));
  assert.equal(builder._isValidReciprocal('mother', 'son'), T.isValidReciprocal('mother', 'son'));
  assert.equal(parser._normalizeRelType('co-worker'), T.normalize('co-worker'));
  // _reciprocalType now genders the reciprocal by the holder's gender; with no
  // gender it returns the neutral reciprocal where one exists ('husband' → 'spouse').
  assert.equal(app._reciprocalType.call(null, 'husband'), T.genderedReciprocal('husband'));
  assert.equal(app._reciprocalType.call(null, 'husband'), 'spouse');
  assert.equal(app._reciprocalType.call(null, 'child', 'M'), 'father');
  assert.equal(app._typeToVCardLabel.call(null, 'uncle/aunt'), T.vcardLabel('uncle/aunt'));
  assert.equal(app._isKnownRelationshipType.call(null, 'cousin'), T.isKnown('cousin'));
});

test('taxonomy core lookups behave as expected', () => {
  const { RelationshipTaxonomy: T } = loadBrowserClasses();

  // Labels and vCard labels
  assert.equal(T.label('husband'), 'Husband');
  assert.equal(T.label('unknown-thing'), 'Unknown-thing');
  assert.equal(T.label(''), 'Related');
  assert.equal(T.vcardLabel('uncle/aunt'), '_$!<Uncle>!$_');
  assert.equal(T.vcardLabel('friend'), '_$!<Friend>!$_');

  // Categories
  assert.equal(T.category('mother'), 'family');
  assert.equal(T.category('manager'), 'work');
  assert.equal(T.category('neighbor'), 'neighbor');
  assert.equal(T.category('mystery'), 'other');

  // Normalization (Apple wrapper, aliases, passthrough)
  assert.equal(T.normalize('_$!<Husband>!$_'), 'husband');
  assert.equal(T.normalize('Best Friend'), 'friend');
  assert.equal(T.normalize('coworker'), 'colleague');
  assert.equal(T.normalize('Pastor'), 'pastor');

  // Reciprocals and validity
  assert.equal(T.reciprocal('husband'), 'wife');
  assert.equal(T.reciprocal('mother'), 'child');
  assert.equal(T.isValidReciprocal('husband', 'wife'), true);
  assert.equal(T.isValidReciprocal('husband', 'cousin'), false);

  // Reciprocal downgrade: generic 'parent' is a downgrade of specific 'mother'
  assert.equal(T.isReciprocalDowngrade('parent', 'mother'), true);
  assert.equal(T.isReciprocalDowngrade('parent', 'son'), false);

  // Known set
  assert.equal(T.isKnown('grandson'), true);
  assert.equal(T.isKnown('totally-made-up'), false);
});

test('every reciprocal and generic reference points at a known type', () => {
  const { RelationshipTaxonomy: T } = loadBrowserClasses();
  for (const [key, entry] of Object.entries(T.TYPES)) {
    assert.ok(
      T.TYPES[entry.reciprocal],
      `${key}: reciprocal "${entry.reciprocal}" must be a known type`,
    );
    if (entry.generic) {
      assert.ok(T.TYPES[entry.generic], `${key}: generic "${entry.generic}" must be a known type`);
    }
  }
});

test('option HTML lists selectable types and a custom escape hatch', () => {
  const { RelationshipTaxonomy: T } = loadBrowserClasses();
  const html = T.optionsHtml('husband');
  // Generic parents are plain, top-level options (no "(generic)" suffix)…
  assert.match(html, /<option value="spouse">Spouse<\/option>/);
  assert.doesNotMatch(html, /\(generic\)/);
  // …and gendered/specific subtypes are indented beneath them (no <optgroup>).
  assert.match(html, /<option value="husband" selected>[^<]*Husband<\/option>/);
  assert.doesNotMatch(html, /<optgroup/);
  assert.match(html, /value="__custom__"/);

  // pickerOptions() exposes the flat structure with depth for the combobox.
  const opts = T.pickerOptions();
  assert.deepEqual(opts[0], { value: 'spouse', label: 'Spouse', depth: 0 });
  assert.deepEqual(opts[1], { value: 'husband', label: 'Husband', depth: 1 });

  // An unknown type pre-selects the custom option.
  assert.match(T.optionsHtml('pastor'), /value="__custom__" selected/);
});
