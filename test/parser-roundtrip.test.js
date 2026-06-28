import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses, makeTestApp, readFixture } from './helpers/load-app.js';

function byUid(contacts, uid) {
  const contact = contacts.find((c) => c.uid === uid);
  assert.ok(contact, `missing contact with UID ${uid}`);
  return contact;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('parser imports comprehensive Apple-style vCards with metadata intact', () => {
  const { VCFParser } = loadBrowserClasses();
  const contacts = new VCFParser().parse(readFixture('comprehensive.vcf'));

  assert.equal(contacts.length, 7);

  const jane = byUid(contacts, 'jane-doe-smith');
  assert.equal(jane.record.schema, 'constellation.contact');
  assert.equal(jane.record.version, 1);
  assert.equal(jane.record.standard.fn, jane.fn);
  assert.equal(jane.record.standard.name.family, 'Doe;Smith');
  assert.deepEqual(plain(jane.customFields), {});
  assert.equal(jane.sourceDocuments[0].format, 'vcard');
  assert.equal(jane.sourceDocuments[0].index, 0);
  assert.match(jane.sourceDocuments[0].raw, /BEGIN:VCARD/);
  assert.equal(jane.fn, 'Dr. Jane, Q. Doe;Smith');
  assert.deepEqual(plain(jane.name), {
    family: 'Doe;Smith',
    given: 'Jane, Q.',
    additional: '',
    prefix: 'Dr.',
    suffix: '',
  });
  assert.equal(jane.org, 'Example; Labs');
  assert.equal(jane.title, 'Principal, Contacts');
  assert.equal(jane.emails[0].value, 'jane@example.com');
  assert.deepEqual(plain(jane.emails[0].types), ['INTERNET', 'HOME', 'PREF']);
  assert.deepEqual(plain(jane.emails[1].types), ['X-CUSTOM-LABEL']);
  assert.deepEqual(plain(jane.phones[0].types), ['CELL', 'VOICE', 'PREF']);
  assert.deepEqual(plain(jane.phones[1].types), ['HOME', 'VOICE']);
  assert.equal(jane.addresses[0].street, '123 Main; Apt 4');
  assert.deepEqual(plain(jane.addresses[0].types), ['HOME', 'PREF']);
  assert.equal(jane.anniversary, '2005-06-20');
  assert.equal(jane.related[0].name, 'John Smith');
  assert.equal(jane.related[0].type, 'husband');
  assert.equal(jane.photo, 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD');
  assert.match(jane.notes[0], /Line one\nLine two/);
  assert.deepEqual(plain(jane.noteTags), ['mitre', 'neighbor']);

  const company = byUid(contacts, 'company-acme');
  assert.equal(company.isCompany, true);
  assert.equal(company.fn, 'Acme Corporation International Research and Development Holdings');
});

test('relationship builder keeps duplicate names ambiguous and creates virtual contacts', () => {
  const { RelationshipBuilder, VCFParser } = loadBrowserClasses();
  const contacts = new VCFParser().parse(readFixture('comprehensive.vcf'));
  const builder = new RelationshipBuilder(contacts);

  assert.equal(builder.findContact('Alex Duplicate'), null);
  assert.equal(builder.findContacts('Alex Duplicate').length, 2);

  const graph = builder.build({
    mode: 'connections',
    includeInferred: true,
    includeLikelyFamily: false,
    includeLikelyConnections: true,
    includeIsolated: true,
    rootContactId: null,
  });
  const virtual = graph.nodes.find((node) => node.isVirtual && node.name === 'Missing Child');
  assert.ok(virtual, 'expected unresolved related name to produce a virtual node');
  assert.ok(graph.edges.some((edge) => edge.target === virtual.id || edge.source === virtual.id));
});

test('vCard adapter imports and serializes through the format boundary', () => {
  const { VCardAdapter, VCFParser } = loadBrowserClasses();
  const adapter = new VCardAdapter(new VCFParser());
  const contacts = adapter.parse(readFixture('comprehensive.vcf'));

  assert.equal(adapter.id, 'vcard');
  assert.equal(adapter.canImportFile({ name: 'contacts.vcf' }), true);
  assert.equal(adapter.canImportFile({ name: 'contacts.md' }), false);
  assert.equal(contacts.length, 7);
  assert.equal(contacts[0].sourceDocuments[0].format, 'vcard');

  const serialized = adapter.serialize(contacts, new Set([contacts[0].id]));
  const reparsed = adapter.parse(serialized);

  assert.equal(reparsed.length, 1);
  assert.equal(reparsed[0].uid, contacts[0].uid);
  assert.match(serialized, /^BEGIN:VCARD/);
  assert.match(serialized, /\r\n$/);
});

test('Markdown adapter preserves standard fields, arbitrary fields, and body content', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const adapter = new MarkdownAdapter();
  const markdown = `---
constellation: 1
uid: jane-md
fn: Jane Markdown
name:
  given: Jane
  family: Markdown
org: Example Labs
emails:
  - value: jane@example.com
    types: [HOME, INTERNET]
related:
  - uid: john-md
    name: John Markdown
    type: spouse
fields:
  favorite_color:
    type: color
    value: "#3366cc"
  custom_history:
    type: list
    value:
      - met at conference
      - invited to dinner
emergency_priority: 2
---
# Notes

Markdown body #neighbor
`;

  const contacts = adapter.parse(markdown);
  const jane = contacts[0];

  assert.equal(adapter.canImportFile({ name: 'contact.md' }), true);
  assert.equal(adapter.canImportFile({ name: 'contact.vcf' }), false);
  assert.equal(jane.uid, 'jane-md');
  assert.equal(jane.name.family, 'Markdown');
  assert.deepEqual(plain(jane.emails[0].types), ['HOME', 'INTERNET']);
  assert.deepEqual(plain(jane.customFields.favorite_color), { type: 'color', value: '#3366cc' });
  assert.deepEqual(plain(jane.customFields.emergency_priority), { type: 'number', value: 2 });
  assert.equal(jane.customFields.markdown_body.type, 'markdown');
  assert.match(jane.customFields.markdown_body.value, /Markdown body #neighbor/);
  assert.deepEqual(plain(jane.noteTags), ['neighbor']);

  const exported = adapter.serialize(contacts);
  const reparsed = adapter.parse(exported)[0];
  assert.equal(reparsed.uid, 'jane-md');
  assert.equal(reparsed.customFields.favorite_color.value, '#3366cc');
  assert.equal(reparsed.customFields.emergency_priority.value, 2);
  assert.match(reparsed.customFields.markdown_body.value, /Markdown body #neighbor/);
});

test('Markdown adapter supports bundle files with multiple contacts', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const adapter = new MarkdownAdapter();
  const contacts = adapter.parse(`${adapter.bundleDelimiter}

---
uid: one
fn: Contact One
---
One body

${adapter.bundleDelimiter}

---
uid: two
fn: Contact Two
---
Two body
`);

  assert.deepEqual(plain(contacts.map((contact) => contact.uid)), ['one', 'two']);
  const bundle = adapter.serialize(contacts);
  assert.match(bundle, /CONSTELLATION:CONTACT/);
  assert.equal(adapter.parse(bundle).length, 2);
});

test('Markdown sample files import as separate and bundled contacts', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const adapter = new MarkdownAdapter();
  const contacts = [
    ...adapter.parse(readFixture('markdown-ada.md')),
    ...adapter.parse(readFixture('markdown-grace.md'), { startIndex: 1 }),
    ...adapter.parse(readFixture('markdown-bundle.md'), { startIndex: 2 }),
  ];

  assert.deepEqual(plain(contacts.map((contact) => contact.uid)), [
    'md-ada-lovelace',
    'md-grace-hopper',
    'md-katherine-johnson',
    'md-dorothy-vaughan',
  ]);
  assert.equal(contacts[0].customFields.favorite_color.value, '#6a5acd');
  assert.equal(contacts[0].customFields.source_metadata.value.empty_marker, '');
  assert.equal(contacts[0].customFields.nested_profile.value.optional_note, null);
  assert.equal(contacts[1].customFields.custom_clearance_level.value, 'historical');
  assert.equal(contacts[1].customFields.nested_service_record.value.awards.compiler.verified, true);
  assert.equal(contacts[2].customFields.mission_count.value, 3);
  assert.equal(contacts[3].customFields.programming_language.value, 'FORTRAN');
  assert.equal(contacts[3].customFields.nested_leadership_record.value.teams[0].role, 'supervisor');
});

test('Markdown import, export, and reimport preserves unknown fields, nested objects, and body', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const adapter = new MarkdownAdapter();
  const contacts = [
    ...adapter.parse(readFixture('markdown-ada.md')),
    ...adapter.parse(readFixture('markdown-grace.md'), { startIndex: 1 }),
    ...adapter.parse(readFixture('markdown-bundle.md'), { startIndex: 2 }),
  ];

  const exported = adapter.serialize(contacts);
  const reparsed = adapter.parse(exported);
  const ada = byUid(reparsed, 'md-ada-lovelace');
  const grace = byUid(reparsed, 'md-grace-hopper');
  const dorothy = byUid(reparsed, 'md-dorothy-vaughan');

  assert.equal(reparsed.length, 4);
  assert.equal(ada.customFields.confidence_score.value, 0.98);
  assert.deepEqual(plain(ada.customFields.source_metadata.value), {
    collection: 'sample-fixtures',
    imported_by: 'phase-5-tests',
    reviewed: true,
    empty_marker: '',
  });
  assert.deepEqual(plain(ada.customFields.nested_profile.value), {
    source: 'markdown-fixture',
    confidence: 0.92,
    empty_string: '',
    optional_note: null,
    aliases: ['Augusta Ada King', 'Countess of Lovelace'],
    review: {
      reviewer: 'test-suite',
      approved: true,
    },
  });
  assert.deepEqual(plain(grace.customFields.nested_service_record.value.awards), {
    compiler: {
      year: 1952,
      verified: true,
    },
  });
  assert.equal(
    dorothy.customFields.nested_leadership_record.value.teams[1].name,
    'Analysis and Computation Division',
  );
  assert.match(
    ada.customFields.markdown_body.value,
    /Wrote notes intended to survive Markdown export and reimport/,
  );
  assert.match(grace.customFields.markdown_body.value, /not just as plain notes/);
});

test('vCard to Markdown conversion preserves standard contact data', () => {
  const { MarkdownAdapter, VCFParser } = loadBrowserClasses();
  const markdown = new MarkdownAdapter();
  const contacts = new VCFParser().parse(readFixture('comprehensive.vcf'));
  const jane = byUid(contacts, 'jane-doe-smith');

  const exported = markdown.serialize([jane]);
  const reparsed = markdown.parse(exported);
  const roundTripped = byUid(reparsed, 'jane-doe-smith');

  assert.equal(roundTripped.fn, jane.fn);
  assert.deepEqual(plain(roundTripped.name), plain(jane.name));
  assert.equal(roundTripped.org, jane.org);
  assert.equal(roundTripped.title, jane.title);
  assert.equal(roundTripped.emails[0].value, jane.emails[0].value);
  assert.deepEqual(plain(roundTripped.emails[0].types), plain(jane.emails[0].types));
  assert.equal(roundTripped.phones[0].value, jane.phones[0].value);
  assert.equal(roundTripped.addresses[0].street, jane.addresses[0].street);
  assert.equal(roundTripped.addresses[0].city, jane.addresses[0].city);
  assert.equal(roundTripped.addresses[0].state, jane.addresses[0].state);
  assert.equal(roundTripped.addresses[0].zip, jane.addresses[0].zip);
  assert.equal(roundTripped.addresses[0].country, jane.addresses[0].country);
  assert.deepEqual(plain(roundTripped.addresses[0].types), plain(jane.addresses[0].types));
  assert.equal(roundTripped.birthday, jane.birthday);
  assert.equal(roundTripped.anniversary, jane.anniversary);
  assert.equal(roundTripped.related[0].name, jane.related[0].name);
  assert.deepEqual(plain(roundTripped.notes), plain(jane.notes));
});

test('Markdown to vCard conversion preserves standard contact data', () => {
  const { MarkdownAdapter, VCardAdapter, VCFParser } = loadBrowserClasses();
  const markdown = new MarkdownAdapter();
  const vcard = new VCardAdapter(new VCFParser());
  const ada = markdown.parse(readFixture('markdown-ada.md'))[0];

  const exported = vcard.serialize([ada]);
  const reparsed = vcard.parse(exported);
  const roundTripped = byUid(reparsed, 'md-ada-lovelace');

  assert.match(exported, /^BEGIN:VCARD/);
  assert.equal(roundTripped.fn, ada.fn);
  assert.deepEqual(plain(roundTripped.name), plain(ada.name));
  assert.equal(roundTripped.org, ada.org);
  assert.equal(roundTripped.title, ada.title);
  assert.equal(roundTripped.emails[0].value, ada.emails[0].value);
  assert.deepEqual(plain(roundTripped.emails[0].types), plain(ada.emails[0].types));
  assert.equal(roundTripped.phones[0].value, ada.phones[0].value);
  assert.equal(roundTripped.addresses[0].street, ada.addresses[0].street);
  assert.equal(roundTripped.addresses[0].city, ada.addresses[0].city);
  assert.equal(roundTripped.addresses[0].country, ada.addresses[0].country);
  assert.equal(roundTripped.urls[0].value, ada.urls[0].value);
  assert.equal(roundTripped.birthday, ada.birthday);
  assert.equal(roundTripped.related[0].name, ada.related[0].name);
  assert.equal(roundTripped.related[0].type, ada.related[0].type);
  assert.deepEqual(plain(roundTripped.noteTags), ['math']);
});

test('serializer round-trips key fields, preferred flags, custom labels, photos, hashtags, and geography', () => {
  const context = loadBrowserClasses();
  const contacts = new context.VCFParser().parse(readFixture('comprehensive.vcf'));
  const app = makeTestApp(context, contacts);

  for (const contact of app.contacts) app._rewriteEditableFields(contact);
  const exported = app._serializeCurrentVCF();
  const reparsed = new context.VCFParser().parse(exported);

  const jane = byUid(reparsed, 'jane-doe-smith');
  assert.equal(jane.fn, 'Dr. Jane, Q. Doe;Smith');
  assert.equal(jane.name.family, 'Doe;Smith');
  assert.equal(jane.name.given, 'Jane, Q.');
  assert.deepEqual(plain(jane.emails[0].types), ['INTERNET', 'HOME', 'PREF']);
  assert.deepEqual(plain(jane.emails[1].types), ['X-CUSTOM-LABEL']);
  assert.deepEqual(plain(jane.phones[0].types), ['CELL', 'VOICE', 'PREF']);
  assert.equal(jane.addresses[0].street, '123 Main; Apt 4');
  assert.equal(jane.addresses[0].country, 'USA');
  assert.equal(jane.anniversary, '2005-06-20');
  assert.equal(jane.related[0].name, 'John Smith');
  assert.equal(jane.related[0].type, 'husband');
  assert.equal(jane.photo, 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD');
  assert.deepEqual(plain(jane.noteTags), ['mitre', 'neighbor']);

  const company = byUid(reparsed, 'company-acme');
  assert.equal(company.isCompany, true);

  const geo = byUid(reparsed, 'geo-work');
  assert.equal(geo.addresses[0].types[0], 'WORK');
  assert.equal(geo.addresses[0].city, 'San Francisco');
});
