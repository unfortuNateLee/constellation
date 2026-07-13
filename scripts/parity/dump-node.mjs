// Node half of the Constellation cross-implementation parity harness.
//
// Parses every importable fixture in repo-root `fixtures/` with the real js/
// adapters and emits a canonical, byte-stable dump the Swift half must
// reproduce exactly. See scripts/parity/README.md for the pinned contract.
//
// Usage: node scripts/parity/dump-node.mjs <outdir>
//
// This file is linted with eslint's recommended config only (it is `.mjs`, so
// the repo's node-globals block — scoped to scripts/**/*.js — does not apply).
// To stay lint-clean without touching eslint config, every Node API is imported
// explicitly and process.stdout/stderr are used instead of the bare `console`.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Reuse the established headless-loading pattern: the test helper installs the
// fake browser globals (document/window/console/indexedDB) the app modules
// resolve against at call time, then hands back the real adapter classes.
import { loadBrowserClasses, fixturePath, readFixture } from '../../test/helpers/load-app.js';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const outdir = process.argv[2];
if (!outdir) {
  fail('usage: node scripts/parity/dump-node.mjs <outdir>');
}

const ctx = loadBrowserClasses();
const { VCardAdapter, MarkdownAdapter, TsvAdapter, ContactRecord } = ctx;

// One stable instance of each adapter; parsing is stateless across fixtures.
const vcardAdapter = new VCardAdapter();
const markdownAdapter = new MarkdownAdapter();
const tsvAdapter = new TsvAdapter();

// Canonical model key allowlist (the §8.1 legacy shape EXCLUDING the phase-1 JS
// artifacts `record` and `sourceDocuments`). Derived from ContactRecord so it
// stays in lockstep with the schema: id, uid, every STANDARD_FIELDS key,
// customFields, rawVCard. Everything else on the parsed object is dropped.

/** Project a parsed legacy contact down to the canonical model object. */
function toModel(contact) {
  const model = {
    id: contact.id ?? '',
    uid: contact.uid ?? null,
  };
  for (const { key, default: makeDefault } of ContactRecord.STANDARD_FIELDS) {
    model[key] = contact[key] !== undefined ? contact[key] : makeDefault();
  }
  model.customFields = contact.customFields ?? {};
  // Markdown/TSV imports carry no raw card; keep the empty string (do not omit).
  model.rawVCard = contact.rawVCard ?? '';
  return model;
}

/**
 * JSON.stringify replacer that sorts object keys lexicographically at every
 * level (arrays keep order; null/empty values are preserved as-is). This is the
 * Node-side ground truth the Swift canonical serializer must match.
 */
function sortedKeysReplacer(_key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = value[key];
    }
    return sorted;
  }
  return value;
}

function canonicalJson(models) {
  return `${JSON.stringify(models, sortedKeysReplacer, 2)}\n`;
}

// Map a fixture extension to the adapter that imports it, plus parse options.
// (md uses an EMPTY photoMap per the contract; no photos are resolved.)
function importerFor(ext) {
  switch (ext) {
    case 'vcf':
    case 'vcard':
      return { adapter: vcardAdapter, options: {} };
    case 'md':
    case 'markdown':
      return { adapter: markdownAdapter, options: { photoMap: {} } };
    case 'tsv':
      return { adapter: tsvAdapter, options: {} };
    default:
      return null;
  }
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function stemOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

const fixturesDir = fixturePath('');
const entries = fs
  .readdirSync(fixturesDir)
  .filter((name) => fs.statSync(path.join(fixturesDir, name)).isFile())
  .sort(); // deterministic order

fs.mkdirSync(outdir, { recursive: true });

const produced = [];
let importable = 0;

for (const name of entries) {
  const importer = importerFor(extensionOf(name));
  if (!importer) continue;
  importable += 1;

  const text = readFixture(name);
  const contacts = importer.adapter.parse(text, importer.options);
  const stem = stemOf(name);

  // Canonical model JSON of the parsed contacts array (parse order).
  const models = contacts.map(toModel);

  // Cross-format serialization: every fixture exercises every serializer.
  const files = [
    [`${stem}.model.json`, canonicalJson(models)],
    [`${stem}.out.vcf`, vcardAdapter.serialize(contacts)],
    [`${stem}.out.md`, markdownAdapter.serialize(contacts)],
    [`${stem}.out.tsv`, tsvAdapter.serialize(contacts)],
  ];

  for (const [outName, content] of files) {
    fs.writeFileSync(path.join(outdir, outName), content, 'utf8');
    produced.push(outName);
  }

  process.stdout.write(
    `${name} (${contacts.length} contacts) -> ${stem}.{model.json,out.vcf,out.md,out.tsv}\n`,
  );
}

if (importable === 0) {
  fail(`no importable fixtures found in ${fixturesDir}`);
}

process.stdout.write(`wrote ${produced.length} files to ${outdir}\n`);
