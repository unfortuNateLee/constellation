import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses, makeTestApp, readFixture } from './helpers/load-app.js';

// End-to-end Apple-field fidelity against the 2-card torture fixture:
// import → edit an unrelated field (forces a full rewrite) → export → reparse,
// asserting nothing is lost and untouched instances stay byte-identical.

function parseFixture(ctx) {
  return new ctx.VCardAdapter().parse(readFixture('apple-full-fields.vcf'));
}

test('every Apple field parses off the torture fixture', () => {
  const ctx = loadBrowserClasses();
  const [person, company] = parseFixture(ctx);

  // Identity
  assert.equal(person.nickname, 'Testy');
  assert.equal(person.maidenName, 'Beta');
  assert.equal(person.phoneticFirst, 'TESS-TEE');
  assert.equal(person.phoneticLast, 'MICK-TESS-TER-SEN');
  assert.equal(person.org, 'ACME Inc.');
  assert.equal(person.department, 'Development');
  assert.equal(person.phoneticOrg, 'ACK-MEE INK');
  assert.equal(person.altBirthday, '0071-0815');

  // Multi-instance
  assert.equal(person.phones.length, 12);
  assert.equal(person.emails.length, 4);
  assert.equal(person.addresses.length, 5);
  assert.equal(person.urls.length, 5);
  assert.equal(person.socialProfiles.length, 8);
  assert.ok(person.ims.length >= 9);
  assert.equal(person.related.length, 15);
  assert.ok(person.photo && person.photo.startsWith('data:image'));

  // The iPhone retains its full multi-type set.
  const iphone = person.phones.find((p) => (p.types || []).includes('IPHONE'));
  assert.deepEqual([...iphone.types].sort(), ['CELL', 'IPHONE', 'PREF', 'VOICE']);

  // Company flag
  assert.equal(company.isCompany, true);
  assert.equal(person.isCompany, false);
});

test('editing an unrelated field preserves all Apple fields + untouched raw lines', () => {
  const ctx = loadBrowserClasses();
  const contacts = parseFixture(ctx);
  const app = makeTestApp(ctx, contacts);
  const person = contacts[0];

  // Edit something unrelated to phones, forcing a full card rewrite.
  person.title = 'Chief Tester';
  app._rewriteEditableFields(person);

  // Untouched multi-type phone lines survive byte-for-byte (Apple casing/order).
  assert.match(person.rawVCard, /TEL;type=IPHONE;type=CELL;type=VOICE;type=pref:12345678901/);
  assert.match(person.rawVCard, /TEL;type=APPLEWATCH;type=CELL;type=VOICE:1 \(234\) 567-8901/);
  assert.match(person.rawVCard, /TEL;type=HOME;type=FAX:/);
  // Preserved-verbatim exotic fields.
  assert.match(person.rawVCard, /X-ALTBDAY;CALSCALE=gregorian:0071-0815/);
  // Regenerated identity fields reflect the model.
  assert.match(person.rawVCard, /NICKNAME:Testy/);
  assert.match(person.rawVCard, /ORG:ACME Inc\.;Development/);
  assert.match(person.rawVCard, /TITLE:Chief Tester/);

  // Reparse and confirm counts + key fields are intact.
  const re = new ctx.VCardAdapter().parse(person.rawVCard)[0];
  assert.equal(re.phones.length, 12);
  assert.equal(re.emails.length, 4);
  assert.equal(re.addresses.length, 5);
  assert.equal(re.urls.length, 5);
  assert.equal(re.socialProfiles.length, 8);
  assert.equal(re.related.length, 15);
  assert.equal(re.department, 'Development');
  assert.equal(re.maidenName, 'Beta');
  assert.equal(re.altBirthday, '0071-0815');
  assert.ok(re.photo && re.photo.startsWith('data:image'));
  const reIphone = re.phones.find((p) => (p.types || []).includes('IPHONE'));
  assert.deepEqual([...reIphone.types].sort(), ['CELL', 'IPHONE', 'PREF', 'VOICE']);
});
