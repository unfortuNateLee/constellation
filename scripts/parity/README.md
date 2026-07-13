# Constellation parity harness (M1)

A cross-implementation CI gate proving the Node (`js/`) and Swift (`macos/`)
format layers agree **byte-for-byte**. Two dumpers, one diff.

- `dump-node.mjs` — the Node dumper (this half; done).
- `check.sh` — runs both dumpers into temp dirs and `diff -ru`s them.
- The Swift dumper (`swift run constellation-dump <outdir>`) is built later by
  the macOS half; `check.sh` fails gracefully (exit 2) until it exists.

## Dump contract (both implementations MUST produce identical bytes)

For **each** fixture in repo-root `fixtures/` that an adapter can import (by
extension):

1. Parse with the matching adapter:
   - `vcf` / `vcard` → vCard adapter
   - `md` / `markdown` → Markdown adapter, with an **EMPTY photoMap**
   - `tsv` → TSV adapter
2. Emit to the output directory:
   - `<fixture-stem>.model.json` — canonical JSON of the parsed contacts array
   - `<fixture-stem>.out.vcf` — vCard serialization of all parsed contacts
   - `<fixture-stem>.out.md` — Markdown serialization of all parsed contacts
   - `<fixture-stem>.out.tsv` — TSV serialization of all parsed contacts

Cross-format serialization is deliberate: every fixture exercises every
serializer, so a divergence in any serializer surfaces on every fixture.

## Canonical model JSON rules

- The contacts array **in parse order**. Each contact is the §8.1 legacy shape
  **EXCLUDING** `record` and `sourceDocuments` (phase-1 JS artifacts) and
  **INCLUDING** `id`, `uid`, every `ContactRecord.STANDARD_FIELDS` key,
  `customFields`, and `rawVCard`. Any other transient property on the parsed
  object (e.g. `_photoUnresolved`) is dropped — the include-list above is the
  spec, so the projection is an explicit allowlist, not a blocklist.
- Node defines ground truth: `JSON.stringify(value, sortedKeysReplacer, 2)` plus
  a trailing `"\n"`. Keys are sorted lexicographically at **every** object level
  (including `customFields` and nested objects). `null` stays `null`; empty
  strings/arrays stay as-is (empty fields are **not** omitted).
- The Swift side must reproduce Node's `JSON.stringify` output exactly: 2-space
  indent, sorted keys, no slash-escaping, minimal string escaping (`"`, `\`,
  control chars as `\b \f \n \r \t`, else `\uXXXX`), integer-valued numbers with
  no decimal point, UTF-8 literals for non-ASCII. Hand-write a small canonical
  serializer over the model — do **not** fight `JSONEncoder`.
- Photo/base64 fields are included verbatim (they are strings).

## Usage

```sh
# Dump the Node side to a directory of your choice.
node scripts/parity/dump-node.mjs /tmp/node-out

# Run the full gate (Node vs Swift). Exit 0 = identical, 1 = diff, 2 = Swift
# dumper not built yet.
scripts/parity/check.sh

# Point the gate at a Swift package elsewhere than macos/:
CONSTELLATION_SWIFT_DIR=/path/to/swiftpkg scripts/parity/check.sh
```

## How the Node dumper loads app modules headless

The `js/` modules are browser-oriented and resolve `document` / `window` /
`console` / `indexedDB` against `globalThis` at call time. `dump-node.mjs`
reuses the established test pattern — `test/helpers/load-app.js`'s
`loadBrowserClasses()` — which installs fake browser globals and returns the
real adapter classes. No new npm dependencies; the repo is `type: module`.

## Determinism

Contact `id`s are assigned by the adapters via `ContactRecord.assignStableId`
(hash-based), and the model serializer sorts keys, so repeated runs are
byte-identical. `check.sh` relies on this: re-running must produce zero diff.
