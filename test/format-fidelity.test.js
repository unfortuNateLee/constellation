import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses } from './helpers/load-app.js';

const plain = (v) => JSON.parse(JSON.stringify(v));

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

test('Markdown keeps notes in frontmatter (multiple notes preserved, not duplicated in body)', () => {
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
  const doc = ['---', 'fn: Photo Person', 'photo: photo-person.jpg', '---', ''].join('\n');
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
  const inlineDoc = ['---', 'fn: Inline', `photo: ${dataUrl}`, '---', ''].join('\n');
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
