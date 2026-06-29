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

test('TSV preserves multiple notes through a round-trip', () => {
  const { TsvAdapter } = loadBrowserClasses();
  const tsv = new TsvAdapter();
  const contact = { id: 'c1', fn: 'Multi Note', notes: ['First note', 'Second note', 'Third'] };
  const out = tsv.serialize([contact]);
  const re = tsv.parse(out)[0];
  assert.deepEqual(plain(re.notes), ['First note', 'Second note', 'Third']);
});

test('TSV still keeps a single note with internal newlines intact', () => {
  const { TsvAdapter } = loadBrowserClasses();
  const tsv = new TsvAdapter();
  const contact = { id: 'c1', fn: 'One Note', notes: ['line one\nline two'] };
  const re = tsv.parse(tsv.serialize([contact]))[0];
  assert.deepEqual(plain(re.notes), ['line one\nline two']);
});
