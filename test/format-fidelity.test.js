import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses } from './helpers/load-app.js';

const plain = (v) => JSON.parse(JSON.stringify(v));

test('Gender (vCard GENDER) round-trips through vCard and Markdown', () => {
  const { VCFParser, VCardAdapter, MarkdownAdapter } = loadBrowserClasses();
  const parser = new VCFParser();
  // vCard parse maps M/F; other sex codes (O/N/U) → '' (unknown).
  const [m] = parser.parse('BEGIN:VCARD\nVERSION:3.0\nFN:Al\nN:;Al;;;\nGENDER:M\nEND:VCARD');
  const [f] = parser.parse('BEGIN:VCARD\nVERSION:3.0\nFN:Bo\nN:;Bo;;;\nGENDER:F;she\nEND:VCARD');
  const [o] = parser.parse('BEGIN:VCARD\nVERSION:3.0\nFN:Cy\nN:;Cy;;;\nGENDER:O\nEND:VCARD');
  assert.equal(m.gender, 'M');
  assert.equal(f.gender, 'F'); // sex code before the ";text" component
  assert.equal(o.gender, '');

  // vCard serialize
  assert.match(new VCardAdapter().serialize([m]), /GENDER:M/);

  // Markdown shows human labels and round-trips back to the code.
  const md = new MarkdownAdapter();
  const out = md.serialize([f]);
  assert.match(out, /- \*\*Gender:\*\* Female/);
  assert.equal(md.parse(out)[0].gender, 'F');
});

test('Markdown round-trips a fully-populated contact across every field group', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();
  const contact = {
    id: 'c1',
    uid: 'jane-doe',
    fn: 'Jane Doe',
    name: { given: 'Jane', family: 'Doe', additional: 'Q', prefix: 'Dr.', suffix: 'PhD' },
    nickname: 'Janey',
    org: 'Example Labs',
    department: 'R&D',
    title: 'Engineer',
    emails: [
      { value: 'jane@x.com', types: ['HOME'], label: '' },
      { value: 'j@w.com', types: ['WORK', 'PREF'], label: '' },
      { value: 'bat@x.com', types: [], label: 'Bat Phone' },
    ],
    phones: [
      { value: '(555) 123-4567', types: ['IPHONE', 'CELL'], label: '' },
      { value: '(555) 9', types: ['HOME', 'FAX'], label: '' },
    ],
    addresses: [
      {
        street: '123 Main Street',
        city: 'Anytown',
        state: 'AL',
        zip: '12345',
        country: 'USA',
        types: ['HOME'],
        label: '',
      },
    ],
    urls: [{ value: 'https://jane.example.com', types: ['HOME'], label: '' }],
    ims: [{ value: 'skype:jane.doe', service: 'Skype', types: [], label: '' }],
    socialProfiles: [
      { url: 'https://twitter.com/janedoe', service: 'Twitter', username: '', label: '' },
    ],
    birthday: '1990-01-01',
    anniversary: '2015-06-20',
    altBirthday: '0071-0815',
    dates: [{ label: 'First met', value: '2018-03-12' }],
    related: [
      { name: 'John Smith', type: 'spouse' },
      { name: 'Mary Doe', type: 'mother' },
    ],
    notes: ['Met at the conference. #vip', 'Loves hiking.'],
    tags: ['vip', 'college'],
    customFields: {
      favorite_color: { type: 'string', value: '#3366cc' },
      lucky: { type: 'list', value: ['7', '13'] },
      profile: { type: 'object', value: { tier: 'gold', points: 14200 } },
    },
  };

  const re = md.parse(md.serialize([contact]))[0];
  assert.equal(re.fn, 'Jane Doe');
  assert.equal(re.uid, 'jane-doe');
  assert.deepEqual(plain(re.name), contact.name);
  assert.equal(re.nickname, 'Janey');
  assert.equal(re.department, 'R&D');
  assert.deepEqual(plain(re.emails[2]), { value: 'bat@x.com', types: [], label: 'Bat Phone' });
  assert.deepEqual(plain(re.emails[1].types), ['WORK', 'PREF']);
  assert.deepEqual(plain(re.phones[1].types), ['HOME', 'FAX']); // "Home Fax"
  assert.deepEqual(plain(re.addresses[0]), {
    pobox: '',
    ext: '',
    street: '123 Main Street',
    city: 'Anytown',
    state: 'AL',
    zip: '12345',
    country: 'USA',
    types: ['HOME'],
    label: '',
  });
  assert.equal(re.ims[0].value, 'skype:jane.doe'); // scheme reconstructed from service
  assert.equal(re.socialProfiles[0].url, 'https://twitter.com/janedoe');
  assert.equal(re.birthday, '1990-01-01');
  assert.equal(re.altBirthday, '0071-0815');
  assert.deepEqual(plain(re.dates), [{ label: 'First met', value: '2018-03-12' }]);
  assert.deepEqual(plain(re.related), [
    { name: 'John Smith', type: 'spouse' },
    { name: 'Mary Doe', type: 'mother' },
  ]);
  assert.deepEqual(plain(re.notes), ['Met at the conference. #vip', 'Loves hiking.']);
  assert.deepEqual(plain(re.tags), ['vip', 'college']);
  assert.deepEqual(plain(re.customFields.profile.value), { tier: 'gold', points: 14200 });
});

test('Markdown round-trips the newer standard fields (nickname, department, …)', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();
  const contact = {
    id: 'c1',
    uid: 'u1',
    fn: 'Dana Doe',
    name: { given: 'Dana', family: 'Doe', additional: '', prefix: '', suffix: '' },
    nickname: 'Dee',
    maidenName: 'Smith',
    phoneticFirst: 'DAY-nuh',
    phoneticLast: 'DOH',
    org: 'Acme',
    department: 'R&D',
    phoneticOrg: 'AK-mee',
    title: 'Engineer',
    altBirthday: '0071-0815',
  };
  const out = md.serialize([contact]);
  const re = md.parse(out)[0];
  assert.equal(re.nickname, 'Dee');
  assert.equal(re.maidenName, 'Smith');
  assert.equal(re.phoneticFirst, 'DAY-nuh');
  assert.equal(re.phoneticLast, 'DOH');
  assert.equal(re.department, 'R&D');
  assert.equal(re.phoneticOrg, 'AK-mee');
  assert.equal(re.altBirthday, '0071-0815');
});

test('Markdown preserves multiple notes (as blank-line-separated paragraphs)', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();
  const contact = { id: 'c1', fn: 'Multi Note', notes: ['First note', 'Second note'] };
  const out = md.serialize([contact]);
  const re = md.parse(out)[0];
  assert.deepEqual(plain(re.notes), ['First note', 'Second note']);
});

test('Markdown import resolves externalized photos from a sibling-image map', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();
  const doc = ['## Photo Person', '', '- **Photo:** photo-person.jpg', ''].join('\n');
  const dataUrl = 'data:image/jpeg;base64,/9j/AAAA';

  // Without the image map → photo unresolved (null), flagged for the warning.
  const [bare] = md.parse(doc);
  assert.equal(bare.photo, null);
  assert.equal(bare._photoUnresolved, true);

  // With a matching sibling image (case-insensitive) → resolved to the data URL.
  const [withPhoto] = md.parse(doc, { photoMap: { 'photo-person.jpg': dataUrl } });
  assert.equal(withPhoto.photo, dataUrl);
  assert.equal(withPhoto._photoUnresolved, false);

  // An inline data: URL still works and isn't treated as unresolved.
  const inlineDoc = ['## Inline', '', `- **Photo:** ${dataUrl}`, ''].join('\n');
  const [inline] = md.parse(inlineDoc);
  assert.equal(inline.photo, dataUrl);
  assert.equal(inline._photoUnresolved, false);
});

test('TSV preserves multiple notes through a round-trip', () => {
  const { TsvAdapter } = loadBrowserClasses();
  const tsv = new TsvAdapter();
  const contact = { id: 'c1', fn: 'Multi Note', notes: ['First note', 'Second note', 'Third'] };
  const out = tsv.serialize([contact]);
  const re = tsv.parse(out)[0];
  assert.deepEqual(plain(re.notes), ['First note', 'Second note', 'Third']);
});

test('X-ABLabel: Apple predefined labels are wrapped, custom labels stay plain', () => {
  const { VCardUtils } = loadBrowserClasses();
  // Predefined → wrapped so Apple localizes them.
  assert.equal(VCardUtils.formatXABLabel('Other'), '_$!<Other>!$_');
  assert.equal(VCardUtils.formatXABLabel('School'), '_$!<School>!$_');
  assert.equal(VCardUtils.formatXABLabel('HomePage'), '_$!<HomePage>!$_');
  // Custom → plain (otherwise Apple Contacts shows the literal _$!<…>!$_ markers).
  assert.equal(VCardUtils.formatXABLabel('a_custom_value'), 'a_custom_value');
  assert.equal(VCardUtils.formatXABLabel('Soccer Team'), 'Soccer Team');
});

test('a custom X-ABLabel on an edited phone serializes plain (no _$!<…>!$_)', () => {
  const { VCardAdapter, VCFParser } = loadBrowserClasses();
  const adapter = new VCardAdapter();
  // Force the fallback serializer (no rawVCard) with a custom-labeled phone.
  const contact = {
    id: 'c1',
    fn: 'Label Test',
    phones: [{ value: '5551234', types: [], label: 'Bat Phone' }],
  };
  const out = adapter.serialize([contact]);
  assert.match(out, /X-ABLabel:Bat Phone/);
  assert.doesNotMatch(out, /_\$!<Bat Phone>!\$_/);
  // And it re-parses back to the same custom label.
  const [re] = new VCFParser().parse(out);
  assert.equal(re.phones[0].label, 'Bat Phone');
});

test('TSV still keeps a single note with internal newlines intact', () => {
  const { TsvAdapter } = loadBrowserClasses();
  const tsv = new TsvAdapter();
  const contact = { id: 'c1', fn: 'One Note', notes: ['line one\nline two'] };
  const re = tsv.parse(tsv.serialize([contact]))[0];
  assert.deepEqual(plain(re.notes), ['line one\nline two']);
});
