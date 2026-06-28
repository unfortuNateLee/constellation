import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses, readFixture } from './helpers/load-app.js';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function byUid(contacts, uid) {
  const contact = contacts.find((c) => c.uid === uid);
  assert.ok(contact, `missing contact with UID ${uid}`);
  return contact;
}

// The app runs inside a vm sandbox with its own console, so warnings must be
// captured on the sandbox context's console, not the test realm's.
function captureWarnings(context) {
  const messages = [];
  context.console.warn = (...args) => messages.push(args.join(' '));
  return messages;
}

test('vCard ids are deterministic and stable across reparses (UID-based)', () => {
  const { VCFParser } = loadBrowserClasses();
  const text = readFixture('comprehensive.vcf');

  const first = new VCFParser().parse(text);
  const second = new VCFParser().parse(text);

  const idsFirst = first.map((c) => c.id);
  const idsSecond = second.map((c) => c.id);
  assert.deepEqual(idsSecond, idsFirst, 'same source must yield the same ids every parse');

  assert.match(byUid(first, 'jane-doe-smith').id, /^c_/);
  // Distinct UIDs (even with identical display names) get distinct ids.
  assert.notEqual(byUid(first, 'duplicate-a').id, byUid(first, 'duplicate-b').id);
});

test('contacts without UID but identical names get stable, distinct ids', () => {
  const { VCFParser } = loadBrowserClasses();
  const text =
    'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Sam Same\r\nEND:VCARD\r\n' +
    'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Sam Same\r\nEND:VCARD\r\n';

  const a = new VCFParser().parse(text);
  const b = new VCFParser().parse(text);

  assert.equal(a.length, 2);
  assert.notEqual(a[0].id, a[1].id, 'duplicate-name records must not collide');
  assert.deepEqual(
    b.map((c) => c.id),
    a.map((c) => c.id),
    'occurrence-based ids must be stable across reparses',
  );
});

test('a malformed vCard record is skipped without aborting the whole import', () => {
  const context = loadBrowserClasses();
  const text =
    'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:a\r\nFN:Alpha\r\nEND:VCARD\r\n' +
    'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:b\r\nFN:Beta\r\nEND:VCARD\r\n' +
    'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c\r\nFN:Gamma\r\nEND:VCARD\r\n';

  const parser = new context.VCFParser();
  const original = parser._parseVCard.bind(parser);
  let seen = 0;
  parser._parseVCard = (block) => {
    seen += 1;
    if (seen === 2) throw new Error('simulated parse failure');
    return original(block);
  };

  const warnings = captureWarnings(context);
  const contacts = parser.parse(text);

  assert.deepEqual(
    plain(contacts.map((c) => c.uid)),
    ['a', 'c'],
    'good records survive; only the failing one is dropped',
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Skipping malformed vCard at index 1/);
});

test('a malformed Markdown document is skipped without aborting the bundle', () => {
  const context = loadBrowserClasses();
  const adapter = new context.MarkdownAdapter();
  const text =
    `${adapter.bundleDelimiter}\n\n---\nuid: one\nfn: Contact One\n---\nOne body\n\n` +
    `${adapter.bundleDelimiter}\n\n---\nuid: two\nfn: Contact Two\n---\nTwo body\n`;

  const original = adapter._contactFromDocument.bind(adapter);
  let seen = 0;
  adapter._contactFromDocument = (...args) => {
    seen += 1;
    if (seen === 1) throw new Error('simulated document failure');
    return original(...args);
  };

  const warnings = captureWarnings(context);
  const contacts = adapter.parse(text);

  assert.deepEqual(
    plain(contacts.map((c) => c.uid)),
    ['two'],
    'the surviving document still imports',
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Skipping malformed contact at index 0/);
});

test('vCard fallback serializer preserves custom fields through export and reparse', () => {
  const { MarkdownAdapter, VCardAdapter, VCFParser } = loadBrowserClasses();
  const markdown = new MarkdownAdapter();
  const vcard = new VCardAdapter(new VCFParser());

  const ada = markdown.parse(readFixture('markdown-ada.md'))[0];
  assert.ok(Object.keys(ada.customFields).length > 0, 'fixture should have custom fields');
  assert.ok(!ada.rawVCard, 'markdown-origin contact has no rawVCard, forcing the fallback path');

  const exported = vcard.serialize([ada]);
  assert.match(exported, /X-CONSTELLATION-FIELD/);
  // The markdown body is carried as NOTE, not duplicated as a custom field.
  assert.doesNotMatch(exported, /markdown_body/);

  const reparsed = vcard.parse(exported)[0];
  assert.deepEqual(
    plain(reparsed.customFields.favorite_color),
    plain(ada.customFields.favorite_color),
    'scalar custom field round-trips through vCard',
  );
  assert.deepEqual(
    plain(reparsed.customFields.nested_profile),
    plain(ada.customFields.nested_profile),
    'nested-object custom field round-trips through vCard',
  );
  assert.ok(!('markdown_body' in reparsed.customFields));
});

test('custom-field values with vCard-special characters round-trip safely', () => {
  const { VCardAdapter, VCFParser } = loadBrowserClasses();
  const vcard = new VCardAdapter(new VCFParser());

  const contact = {
    id: 'c_test',
    uid: 'esc-1',
    fn: 'Esc Test',
    name: { family: '', given: '', additional: '', prefix: '', suffix: '' },
    emails: [],
    phones: [],
    addresses: [],
    urls: [],
    notes: [],
    related: [],
    customFields: {
      tricky: { type: 'string', value: 'a; b, c "x"\nsecond line\\end' },
    },
  };

  const exported = vcard.serialize([contact]);
  const reparsed = vcard.parse(exported)[0];

  assert.deepEqual(plain(reparsed.customFields.tricky), plain(contact.customFields.tricky));
});

test('vCard fallback serializes non-company tags as CATEGORIES and round-trips them', () => {
  const { VCardAdapter, VCFParser } = loadBrowserClasses();
  const vcard = new VCardAdapter(new VCFParser());
  const contact = {
    id: 'c_tags',
    uid: 'tags-1',
    fn: 'Tagged Person',
    name: { family: '', given: '', additional: '', prefix: '', suffix: '' },
    emails: [],
    phones: [],
    addresses: [],
    urls: [],
    notes: [],
    related: [],
    tags: ['company', 'vip', 'lead'], // 'company' is represented separately by X-ABSHOWAS
    customFields: {},
  };

  const exported = vcard.serialize([contact]);
  assert.match(exported, /CATEGORIES:vip,lead/);

  const reparsed = vcard.parse(exported)[0];
  assert.deepEqual(plain(reparsed.tags), ['vip', 'lead']);
});

test('relationships resolve by UID when present, ignoring a mismatched name', () => {
  const { RelationshipBuilder } = loadBrowserClasses();
  const A = {
    id: 'a',
    uid: 'A',
    fn: 'Alice',
    related: [{ uid: 'B', name: 'Totally Wrong', type: 'friend' }],
  };
  const B = { id: 'b', uid: 'B', fn: 'Bob', related: [] };
  const g = new RelationshipBuilder([A, B]).build({
    mode: 'connections',
    includeInferred: false,
    includeLikelyFamily: false,
    includeLikelyConnections: false,
    includeIsolated: true,
  });
  const linked = g.edges.some(
    (e) => (e.source === 'a' && e.target === 'b') || (e.source === 'b' && e.target === 'a'),
  );
  assert.ok(linked, 'A should link to B by uid despite the wrong name');
  assert.ok(!g.nodes.some((n) => n.isVirtual), 'no virtual node for the mismatched name');
});

test('relationships fall back to name matching when no UID is present', () => {
  const { RelationshipBuilder } = loadBrowserClasses();
  const A = { id: 'a', uid: 'A', fn: 'Alice', related: [{ name: 'Bob', type: 'friend' }] };
  const B = { id: 'b', uid: 'B', fn: 'Bob', related: [] };
  const g = new RelationshipBuilder([A, B]).build({
    mode: 'connections',
    includeInferred: false,
    includeLikelyFamily: false,
    includeLikelyConnections: false,
    includeIsolated: true,
  });
  const linked = g.edges.some(
    (e) => (e.source === 'a' && e.target === 'b') || (e.source === 'b' && e.target === 'a'),
  );
  assert.ok(linked, 'A should link to B by name');
});
