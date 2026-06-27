import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses } from './helpers/load-app.js';

function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

test('TSV import parses a row into the contact model', () => {
  const { TsvAdapter } = loadBrowserClasses();
  const tsv = new TsvAdapter();
  const text = [
    tsv.COLUMNS.join('\t'),
    [
      'jane-1', // uid
      'Dr.',
      'Jane',
      'Q.',
      'Doe',
      'PhD', // name parts
      'Dr. Jane Q. Doe', // display_name
      'Example Labs',
      'Principal',
      'FALSE',
      '[home] jane@x.com | [work] jane@y.com', // emails
      '[cell] 555-0100', // phones
      '123 Main St',
      'Springfield',
      'CA',
      '90210',
      'USA',
      'home', // address
      '1990-04-15',
      '2015-06-20', // dates
      '[work] https://example.com/jane', // urls
      '[spouse] John Doe | [child] Sam', // relationships
      'vip | lead', // tags
      'Met at the conf. #vip', // notes
    ].join('\t'),
  ].join('\n');

  const c = tsv.parse(text)[0];
  assert.equal(c.uid, 'jane-1');
  assert.equal(c.fn, 'Dr. Jane Q. Doe');
  assert.equal(c.name.given, 'Jane');
  assert.equal(c.name.family, 'Doe');
  assert.equal(c.org, 'Example Labs');
  assert.equal(c.isCompany, false);
  assert.deepEqual(plain(c.emails), [
    { value: 'jane@x.com', types: ['HOME'] },
    { value: 'jane@y.com', types: ['WORK'] },
  ]);
  assert.deepEqual(plain(c.phones[0]), { value: '555-0100', types: ['CELL'] });
  assert.equal(c.addresses[0].city, 'Springfield');
  assert.deepEqual(plain(c.addresses[0].types), ['HOME']);
  assert.equal(c.urls[0].value, 'https://example.com/jane'); // ':' in value survives
  assert.equal(c.related[0].name, 'John Doe');
  assert.equal(c.related[0].type, 'spouse');
  assert.equal(c.related[1].type, 'child');
  assert.deepEqual(plain(c.tags), ['vip', 'lead']);
  assert.deepEqual(plain(c.noteTags), ['vip']); // hashtag derived from notes
  assert.match(c.notes[0], /Met at the conf/);
});

test('TSV serialize → reparse round-trips the common fields', () => {
  const { TsvAdapter } = loadBrowserClasses();
  const tsv = new TsvAdapter();
  const original = tsv.parse(tsv.templateText())[0]; // the example row
  const reparsed = tsv.parse(tsv.serialize([original]))[0];

  for (const key of ['fn', 'org', 'title', 'birthday', 'anniversary']) {
    assert.equal(reparsed[key], original[key], `mismatch on ${key}`);
  }
  assert.deepEqual(plain(reparsed.name), plain(original.name));
  assert.deepEqual(plain(reparsed.emails), plain(original.emails));
  assert.deepEqual(plain(reparsed.phones), plain(original.phones));
  assert.deepEqual(plain(reparsed.addresses), plain(original.addresses));
  assert.deepEqual(plain(reparsed.urls), plain(original.urls));
  assert.deepEqual(
    plain(reparsed.related.map((r) => ({ name: r.name, type: r.type }))),
    plain(original.related.map((r) => ({ name: r.name, type: r.type }))),
  );
  assert.deepEqual(plain(reparsed.notes), plain(original.notes));
});

test('TSV template is the header row (in order) plus a worked example', () => {
  const { TsvAdapter } = loadBrowserClasses();
  const tsv = new TsvAdapter();
  const lines = tsv.templateText().trimEnd().split('\n');
  assert.equal(lines[0], tsv.COLUMNS.join('\t'));
  assert.equal(lines[0].split('\t').length, tsv.COLUMNS.length);
  assert.equal(lines.length, 2); // header + one example
  assert.match(lines[1], /\[home\] jane@example\.com/);
});

test('TSV escapes tabs/newlines in notes and round-trips them', () => {
  const { TsvAdapter } = loadBrowserClasses();
  const tsv = new TsvAdapter();
  const contact = { id: 'c1', fn: 'Multi Line', notes: ['line one\nline two\twith tab'] };
  const reparsed = tsv.parse(tsv.serialize([contact]))[0];
  assert.equal(tsv.serialize([contact]).split('\n').length, 3); // header + 1 row + trailing
  assert.equal(reparsed.notes[0], 'line one\nline two\twith tab');
});

test('TSV import isolates a malformed row', () => {
  const ctx = loadBrowserClasses();
  const tsv = new ctx.TsvAdapter();
  const warnings = [];
  ctx.console.warn = (...a) => warnings.push(a.join(' '));
  const orig = tsv._contactFromRow.bind(tsv);
  let n = 0;
  tsv._contactFromRow = (...args) => {
    n += 1;
    if (n === 1) throw new Error('boom');
    return orig(...args);
  };
  const text = `${tsv.COLUMNS.join('\t')}\nbad\nuid2\tMr.\tBob`;
  const contacts = tsv.parse(text);
  assert.equal(contacts.length, 1);
  assert.match(warnings[0], /Skipping malformed row/);
});
