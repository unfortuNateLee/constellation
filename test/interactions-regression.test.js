import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses, makeTestApp, readFixture } from './helpers/load-app.js';

function setup() {
  const context = loadBrowserClasses();
  const contacts = new context.VCFParser().parse(readFixture('comprehensive.vcf'));
  return { context, app: makeTestApp(context, contacts) };
}

function byUid(app, uid) {
  const contact = app.contacts.find((c) => c.uid === uid);
  assert.ok(contact, `missing contact with UID ${uid}`);
  return contact;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('restore can resolve the saved me contact through UID after reparsing', () => {
  const { context, app } = setup();
  const jane = byUid(app, 'jane-doe-smith');
  app._selfContactId = jane.id;
  const ref = app._selfContactRef();

  const restoredContacts = new context.VCFParser().parse(app._serializeCurrentVCF());
  const restored = makeTestApp(context, restoredContacts);
  const restoredId = restored._resolveSelfContactId(ref);

  assert.ok(restoredId);
  assert.equal(restored._contact(restoredId).uid, 'jane-doe-smith');
});

test('table edit updates notes, hashtags, raw vCard, and search-visible data immediately', () => {
  const { app } = setup();
  const geo = byUid(app, 'geo-work');

  app._applyTableEdit(geo.id, 'notes', 'Updated note #neighbor');
  const reparsed = app.parser.parse(geo.rawVCard);
  assert.deepEqual(plain(geo.noteTags), ['neighbor']);
  assert.equal(reparsed[0].notes[0], 'Updated note #neighbor');
  assert.deepEqual(plain(reparsed[0].noteTags), ['neighbor']);

  app._searchQuery = 'updated note';
  app._renderTableMode = function renderTableSearchProbe() {
    this._lastTableMatches = this.contacts.filter((contact) => {
      const haystack = [contact.fn, contact.org, contact.title, (contact.notes || []).join(' ')]
        .join(' ')
        .toLowerCase();
      return haystack.includes(this._searchQuery);
    });
  };
  app._renderTableMode();
  assert.deepEqual(plain(app._lastTableMatches.map((c) => c.uid)), ['geo-work']);
});

test('detail edit path rewrites structured contact fields and preserves vCard metadata', () => {
  const { app } = setup();
  const jane = byUid(app, 'jane-doe-smith');
  jane.title = 'Director; Contacts';
  jane.emails.push({
    value: 'jane.extra@example.com',
    types: app._normalizeStoredTypes('email', ['work'], false),
  });

  app._rewriteEditableFields(jane);
  const reparsed = app.parser.parse(jane.rawVCard)[0];

  assert.equal(reparsed.title, 'Director; Contacts');
  assert.equal(reparsed.emails.at(-1).value, 'jane.extra@example.com');
  assert.deepEqual(plain(reparsed.emails.at(-1).types), ['INTERNET', 'WORK']);
  assert.equal(reparsed.related[0].name, 'John Smith');
});

test('relationship add, edit, delete, and type persistence survive export and reparse', () => {
  const { app } = setup();
  const jane = byUid(app, 'jane-doe-smith');

  const usedItems = [...jane.rawVCard.matchAll(/^item(\d+)\./gim)].map((match) =>
    parseInt(match[1], 10),
  );
  const nextItem = Math.max(...usedItems) + 1;
  const label = app._typeToVCardLabel('neighbor');
  jane.rawVCard = app._insertBeforeEndVCard(
    jane.rawVCard,
    app._joinVCardLines([
      `item${nextItem}.X-ABRELATEDNAMES:${app._vCardEscape('Taylor Geo')}`,
      `item${nextItem}.X-ABLabel:${label}`,
    ]),
  );
  jane.related.push({ name: 'Taylor Geo', type: 'neighbor', rawType: label });

  let reparsed = app.parser.parse(jane.rawVCard)[0];
  assert.ok(reparsed.related.some((rel) => rel.name === 'Taylor Geo' && rel.type === 'neighbor'));

  const husbandIdx = jane.related.findIndex((rel) => rel.name === 'John Smith');
  app._applyRelationshipEdit(jane, husbandIdx, 'John Smith', 'spouse');
  reparsed = app.parser.parse(jane.rawVCard)[0];
  assert.equal(reparsed.related.find((rel) => rel.name === 'John Smith').type, 'spouse');

  const neighborIdx = jane.related.findIndex((rel) => rel.name === 'Taylor Geo');
  app._deleteRelationship(jane, neighborIdx, { id: jane.id });
  reparsed = app.parser.parse(jane.rawVCard)[0];
  assert.equal(
    reparsed.related.some((rel) => rel.name === 'Taylor Geo'),
    false,
  );
});

test('bulk normalize can append notes to empty contacts and replace address country values', () => {
  const { context, app } = setup();
  const duplicate = byUid(app, 'duplicate-a');
  assert.deepEqual(plain(duplicate.notes), []);

  context.document.__setElement('bulk-confirm-risk', { checked: true });
  // Scalar target (notes): no WHERE needed — IF matches the email instance.
  app._bulkRuleState = {
    root: {
      type: 'condition',
      field: 'email-value',
      operator: 'contains',
      value: 'alex.a',
    },
    action: {
      type: 'append',
      field: 'notes',
      value: '#duplicate',
      where: { op: 'AND', conditions: [] },
      applyTo: 'matching',
    },
  };
  app._applyBulkNormalize();
  assert.deepEqual(plain(duplicate.notes), ['#duplicate']);
  assert.deepEqual(plain(duplicate.noteTags), ['duplicate']);
  assert.equal(app.parser.parse(duplicate.rawVCard)[0].notes[0], '#duplicate');

  // Multi-instance target (address): the WHERE scopes the change to the VA
  // address only — IF selects the contact, WHERE selects which address.
  app._bulkRuleState = {
    root: {
      type: 'condition',
      field: 'address-state',
      operator: 'equals',
      value: 'VA',
    },
    action: {
      type: 'set',
      field: 'address-country',
      value: '',
      where: {
        op: 'AND',
        conditions: [{ id: 'w1', field: 'address-state', operator: 'equals', value: 'VA' }],
      },
      applyTo: 'matching',
    },
  };
  app._applyBulkNormalize();
  const jane = byUid(app, 'jane-doe-smith');
  assert.equal(jane.addresses[0].country, '');
  assert.equal(app.parser.parse(jane.rawVCard)[0].addresses[0].country, '');
});

test('bulk normalize retypes only the WHERE-matching relationship instances', () => {
  const { context, app } = setup();
  const jane = byUid(app, 'jane-doe-smith');
  // Two relationships of different types on one contact.
  jane.related = [
    { name: 'Bob Example', type: 'husband', rawType: '_$!<Husband>!$_' },
    { name: 'Sue Example', type: 'sister', rawType: '_$!<Sister>!$_' },
  ];
  app._rewriteEditableFields(jane);

  context.document.__setElement('bulk-confirm-risk', { checked: true });
  app._bulkRuleState = {
    root: { type: 'condition', field: 'relationship-type', operator: 'has', value: 'husband' },
    action: {
      type: 'set',
      field: 'relationship-type',
      value: 'spouse',
      where: {
        op: 'AND',
        conditions: [
          { id: 'w1', field: 'relationship-type', operator: 'equals', value: 'husband' },
        ],
      },
      applyTo: 'matching',
    },
  };
  app._applyBulkNormalize();

  const byName = Object.fromEntries(jane.related.map((r) => [r.name, r.type]));
  assert.equal(byName['Bob Example'], 'spouse'); // Husband → Spouse
  assert.equal(byName['Sue Example'], 'sister'); // Sister left untouched
});

test('photo edits update the serialized card immediately', () => {
  const { app } = setup();
  const jane = byUid(app, 'jane-doe-smith');
  jane.photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

  app._rewriteEditableFields(jane);
  const reparsed = app.parser.parse(jane.rawVCard)[0];

  assert.equal(reparsed.photo, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB');
});

test('notes hashtag autocomplete finds existing tags and inserts the selected tag', () => {
  const { context, app } = setup();
  const popup = {
    innerHTML: '',
    classList: {
      add() {},
      remove() {},
      contains() {
        return false;
      },
    },
    style: {},
    appendChild() {},
  };
  context.document.__setElement('tag-autocomplete', popup);
  app._textareaCaretRect = () => ({ left: 10, top: 10 });

  const textarea = {
    value: 'Need #n',
    selectionStart: 7,
    focus() {},
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };

  const ctx = app._currentHashtagContext(textarea);
  assert.deepEqual(plain(ctx), { query: 'n', start: 5, end: 7 });

  app._updateNotesAutocomplete(textarea);
  assert.deepEqual(plain(app._notesAutocomplete.matches), ['neighbor']);

  app._applyNotesAutocompleteSelection();
  assert.equal(textarea.value, 'Need #neighbor');
});

test('contact deletion removes the contact from the working set and export output', () => {
  const { context, app } = setup();
  context.window.confirm = () => true;
  const company = byUid(app, 'company-acme');

  app._deleteContact(company.id);

  assert.equal(
    app.contacts.some((contact) => contact.uid === 'company-acme'),
    false,
  );
  assert.equal(app._serializeCurrentVCF().includes('company-acme'), false);
});

test('multi-file import combines Markdown files into one working set', async () => {
  const { context, app } = setup();
  const files = [
    { name: 'markdown-ada.md', text: async () => readFixture('markdown-ada.md') },
    { name: 'markdown-grace.md', text: async () => readFixture('markdown-grace.md') },
    { name: 'markdown-bundle.md', text: async () => readFixture('markdown-bundle.md') },
  ];
  const labels = {};
  context.document.__setElement('file-label', { textContent: '' });
  context.document.__setElement('btn-export-all', { classList: { remove() {} } });
  context.document.__setElement('btn-export-md-all', { classList: { remove() {} } });
  context.document.__setElement('drop-zone', { classList: { add() {} } });
  app._showLoading = () => {};
  app._showToast = (msg, type) => {
    labels.toast = { msg, type };
  };
  app._persistSession = async () => {};

  await app._loadFiles(files);

  assert.equal(app.contacts.length, 4);
  assert.deepEqual(plain(app.contacts.map((contact) => contact.uid)), [
    'md-ada-lovelace',
    'md-grace-hopper',
    'md-katherine-johnson',
    'md-dorothy-vaughan',
  ]);
  assert.equal(context.document.getElementById('file-label').textContent, '3 files');
  assert.equal(labels.toast.msg, 'Loaded 4 contacts');
});

test('custom (non-anniversary) Apple dates are modeled and survive an edit', () => {
  const { context, app } = setup();
  // A custom-labeled X-ABDATE is now parsed into the dates[] model (the
  // anniversary keeps its own scalar).
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:date-test',
    'N:Test;Date;;;',
    'FN:Date Test',
    'item1.X-ABDATE:2020-01-02',
    'item1.X-ABLabel:_$!<First met>!$_',
    'END:VCARD',
  ].join('\r\n');
  const [c] = new context.VCFParser().parse(vcard);
  assert.deepEqual(plain(c.dates), [{ label: 'First met', value: '2020-01-02' }]);

  // Editing regenerates the card from the model; the custom date must survive.
  c.title = 'Updated Title';
  app._rewriteEditableFields(c);
  assert.match(c.rawVCard, /X-ABDATE:2020-01-02/);
  assert.match(c.rawVCard, /X-ABLabel:_\$!<First met>!\$_/);
  const reparsed = app.parser.parse(c.rawVCard)[0];
  assert.equal(reparsed.title, 'Updated Title');
  assert.deepEqual(plain(reparsed.dates), [{ label: 'First met', value: '2020-01-02' }]);
});

test('format-neutral contact record stays synchronized with legacy contact edits', () => {
  const { app } = setup();
  const jane = byUid(app, 'jane-doe-smith');
  jane.customFields.favorite_color = {
    type: 'color',
    value: '#3366cc',
  };

  jane.title = 'Record Sync Title';
  app._rewriteEditableFields(jane);

  assert.equal(jane.record.schema, 'constellation.contact');
  assert.equal(jane.record.standard.title, 'Record Sync Title');
  assert.deepEqual(plain(jane.record.fields.favorite_color), {
    type: 'color',
    value: '#3366cc',
  });
  assert.equal(jane.sourceDocuments[0].format, 'vcard');
  assert.equal(jane.sourceDocuments[0].raw, jane.rawVCard);
});

test('custom fields render read-only display values', () => {
  const { app } = setup();
  const jane = byUid(app, 'jane-doe-smith');
  jane.customFields = {
    favorite_color: { type: 'color', value: '#3366cc' },
    emergency_priority: { type: 'number', value: 2 },
    nested_profile: { type: 'object', value: { source: 'markdown', score: 4 } },
  };

  const container = {
    children: [],
    innerHTML: '',
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
  app._renderReadOnlyCustomFields(container, jane);

  const html = container.children.map((child) => child.innerHTML).join('\n');
  assert.match(html, /Custom: Favorite Color/);
  assert.match(html, /#3366cc/);
  assert.match(html, /Custom: Emergency Priority/);
  assert.match(html, />2</);
  assert.match(html, /nested_profile|Nested Profile/);
  assert.match(html, /source/);
});

test('custom field edit collector updates scalar and list fields while preserving objects', () => {
  const { context, app } = setup();
  const existing = {
    favorite_color: { type: 'color', value: '#3366cc' },
    emergency_priority: { type: 'number', value: 2 },
    active: { type: 'boolean', value: false },
    research_topics: { type: 'list', value: ['old'] },
    nested_profile: { type: 'object', value: { source: 'markdown' } },
  };
  const items = [
    {
      dataset: { fieldKey: 'favorite_color' },
      querySelector(selector) {
        return selector === 'input[data-role="custom-value"]' ? { value: '#ff0000' } : null;
      },
      querySelectorAll() {
        return [];
      },
    },
    {
      dataset: { fieldKey: 'emergency_priority' },
      querySelector(selector) {
        return selector === 'input[data-role="custom-value"]' ? { value: '7' } : null;
      },
      querySelectorAll() {
        return [];
      },
    },
    {
      dataset: { fieldKey: 'active' },
      querySelector(selector) {
        return selector === 'input[data-role="custom-value"]' ? { checked: true } : null;
      },
      querySelectorAll() {
        return [];
      },
    },
    {
      dataset: { fieldKey: 'research_topics' },
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        return selector === 'input[data-role="custom-list-value"]'
          ? [{ value: 'symbolic computation' }, { value: '' }, { value: 'compiler design' }]
          : [];
      },
    },
    {
      dataset: { fieldKey: 'nested_profile' },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
  ];
  context.document.querySelectorAll = (selector) =>
    selector === '.detail-edit-item[data-kind="custom-field"]' ? items : [];

  const fields = app._collectEditedCustomFields(existing);

  assert.equal(fields.favorite_color.value, '#ff0000');
  assert.equal(fields.emergency_priority.value, 7);
  assert.equal(fields.active.value, true);
  assert.deepEqual(plain(fields.research_topics.value), [
    'symbolic computation',
    'compiler design',
  ]);
  assert.deepEqual(plain(fields.nested_profile.value), { source: 'markdown' });
});

test('HTML helpers escape custom relationship labels and unsafe hrefs', () => {
  const { app } = setup();
  const rawType = '"><img src=x onerror=alert(1)>';
  const label = app.builder._friendlyType(rawType);

  assert.equal(app._escapeHtml(label), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(app._safeExternalHref('javascript:alert(1)'), '');
  assert.equal(
    app._safeExternalHref('https://example.com/a?b=1').startsWith('https://example.com/'),
    true,
  );
});

test('vCard folding respects UTF-8 byte limits without corrupting text', () => {
  const { VCardUtils } = loadBrowserClasses();
  const source = `NOTE:${'é'.repeat(40)} ${'中'.repeat(20)}`;
  const folded = VCardUtils.foldLine(source);
  const encoder = new TextEncoder();

  for (const line of folded.split('\r\n')) {
    assert.ok(encoder.encode(line).length <= 75, `line exceeds byte limit: ${line}`);
  }
  assert.equal(VCardUtils.unfold(folded), source);
});
