const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserClasses, readFixture } = require('./helpers/load-app.cjs');

test('createEmptyContact returns the full standard shape at defaults', () => {
  const { ContactRecord } = loadBrowserClasses();
  const c = ContactRecord.createEmptyContact();

  assert.equal(c.id, '');
  assert.equal(c.uid, null);
  assert.deepEqual(JSON.parse(JSON.stringify(c.name)), {
    family: '',
    given: '',
    additional: '',
    prefix: '',
    suffix: '',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(c.emails)), []);
  assert.equal(c.isCompany, false);
  assert.equal(c.photo, null);
  assert.deepEqual(JSON.parse(JSON.stringify(c.customFields)), {});

  // Every registry field is present on a fresh contact.
  for (const { key } of ContactRecord.STANDARD_FIELDS) {
    assert.ok(key in c, `missing standard field "${key}"`);
  }
});

test('default factories return fresh (non-shared) references each call', () => {
  const { ContactRecord } = loadBrowserClasses();
  const a = ContactRecord.createEmptyContact();
  const b = ContactRecord.createEmptyContact();
  a.emails.push({ value: 'x@example.com', types: [] });
  a.name.given = 'Mutated';
  assert.equal(b.emails.length, 0, 'array defaults must not be shared between contacts');
  assert.equal(b.name.given, '', 'object defaults must not be shared between contacts');
});

test('the registry covers exactly the standard fields the vCard parser emits', () => {
  const ctx = loadBrowserClasses();
  const { ContactRecord } = ctx;
  const jane = new ctx.VCFParser()
    .parse(readFixture('comprehensive.vcf'))
    .find((c) => c.uid === 'jane-doe-smith');

  const registryKeys = ContactRecord.STANDARD_FIELDS.map((f) => f.key);
  // record.standard is built from the registry, so its keys are exactly the registry keys.
  assert.deepEqual(Object.keys(jane.record.standard).sort(), [...registryKeys].sort());
});
