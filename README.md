# Constellation

A browser-only, fully offline contact relationship explorer and editor. Import
Apple-style **vCard** (`.vcf`), **Markdown** (`.md`), or **TSV** (`.tsv`)
contacts, explore the relationships between them as an interactive graph, edit
contacts and relationships inline, run rule-based bulk normalization, and export
back to any of those formats. Everything runs client-side — no server, no
backend, no CDN (D3 is vendored locally), and your data never leaves the browser.

## Features

- **Import** vCard, Markdown, or TSV contact files (single files or multi-contact
  bundles), preserving Apple-specific fields for round-trip fidelity.
- **Relationship graph** (D3 force-directed) built from both explicit
  relationships and inferred ones (shared organization, surname, hashtags).
  Relationships resolve by UID when present (rename-proof), else by name.
- **Geographic** view clustering contacts by address (country → state → city → street).
- **Table** view with sortable columns and inline editing.
- **"Me" contact** to derive a family / close-network view.
- **Virtual nodes** for relationship targets that don't resolve to a real contact.
- **Suggestion engine** proposing reciprocal / missing relationships.
- **Bulk normalize** via a nested AND/OR rule engine.
- **Light / dark theme** — a header toggle, persisted across reloads (default dark).
- **Session persistence** to IndexedDB (restores on reload).
- **Multi-scope export** — individual contact, current selection, or all
  contacts, as vCard / Markdown / TSV. Bulk filenames carry the date.
  - Markdown export **externalizes photos** to separate image files written
    alongside the `.md` (via the File System Access directory picker, with a
    download fallback) instead of base64-embedding them.
  - **TSV template** — download a blank `.tsv` with every column in order plus a
    worked example row, to fill in and import.

## Running the app

It's a static site — no build step — but it uses **native ES modules**, which
browsers don't load over `file://`. So serve it from a local static server and
open it over `http://` (no internet connection required once served).

From the repo root:

```sh
python3 -m http.server 7891
# then visit http://localhost:7891
```

Any static file server works. (Opening `index.html` directly from disk will fail
to load the modules — this changed when the app moved from classic global
scripts to ES modules.)

## Development

Requires Node.js 20+ (22 recommended) for the test suite and tooling.

```sh
npm install        # install dev tooling (ESLint, Prettier)
npm test           # run the test suite (node --test)
npm run lint       # lint
npm run format     # auto-format with Prettier
npm run format:check
```

> Note: the app code itself has **no runtime dependencies** — `npm install`
> only pulls in dev tooling. The app keeps working offline with no install.

## Project layout

```
constellation/
  index.html                 App shell (loads d3 + the app-bootstrap.js ES module)
  css/styles.css             All styling (dark + light themes via :root[data-theme])
  js/
    vendor/d3.v7.min.js      Vendored D3 v7 (classic global)
    # — data layer / shared singletons —
    vcard-utils.js           RFC 6350 escaping / folding helpers
    palette.js               Reads CSS --cat-* tokens (single source for colors)
    contact-record.js        Format-neutral record + STANDARD_FIELDS shape registry
    relationship-taxonomy.js Single source for relationship types/labels/reciprocals
    vcf-parser.js            vCard parser
    vcard-adapter.js         vCard import/export adapter
    markdown-adapter.js      Markdown import/export adapter
    tsv-adapter.js           TSV import/export adapter (+ template)
    relationship-builder.js  Contacts → { nodes, edges, hulls }
    graph.js                 D3 renderer (decoupled via on/emit)
    # — controller (one class, split across mixin modules) —
    apply-mixin.js           Grafts a mixin class's methods onto a prototype
    app.js                   Core controller: constructor, _init, rebuild/index pipeline
    app-controller.js        Assembly point: imports app.js + every mixin, re-exports
    app-notes.js             Notes editing + hashtag autocomplete
    app-session.js           IndexedDB persistence + "me" self-contact resolution
    app-sidebar.js           Contact list, filters, legend, stats, tag colors
    app-table.js             Editable table view
    app-detail.js            Detail panel render / node select
    app-suggestions.js       Relationship suggestion engine
    app-editing.js           Field editors + raw-vCard regeneration
    app-relationship-edit.js Inline relationship CRUD + add-rel modal
    app-bulk.js              Bulk-normalize modal (nested AND/OR rule engine)
    app-export.js            vCard / Markdown / TSV export + template
    app-theme.js             Light/dark theme toggle + persistence
    app-bootstrap.js         Entry module: startup + modal wiring
  test/                      Node test suite + fixtures
  docs/
    DESIGN_SPEC.md           Reimplementation spec
    DESIGN_SPEC_CLAUDE.md    Codebase-grounded spec
    APPLE_CONTACTS_ROUNDTRIP_CHECKLIST.md  Manual round-trip validation steps
```

## Architecture notes & direction

The app loads as **native ES modules** (no bundler): `index.html` includes the
vendored D3 as a classic script, then `js/app-bootstrap.js` as a
`<script type="module">`, and the import graph resolves the rest.

- **Format-neutral model + pluggable adapters.** Contacts live in a
  `ContactRecord`-shaped model; `VCardAdapter`, `MarkdownAdapter`, and
  `TsvAdapter` each implement the same `parse` / `serialize` / `exportBlob`
  interface, so new formats become sibling adapters. vCard keeps the raw card as
  the source of truth (for Apple-field fidelity); other formats drive from the
  model.
- **Single sources of truth.** The contact shape (`ContactRecord.STANDARD_FIELDS`),
  the relationship taxonomy (`RelationshipTaxonomy` — labels, categories,
  reciprocals, the picker), and the color palette (CSS `--cat-*` read via
  `Palette`) each have exactly one definition that everything else derives from.
- **Controller as one class, split across modules.** `app.js` holds the core
  (constructor, init, the rebuild/index pipeline); cohesive method groups live in
  `app-*.js` "mixin" modules that graft themselves onto the prototype via
  `applyMixin`. `app-controller.js` is the assembly point; `app-bootstrap.js` is
  the entry. So `this._foo()` calls work across modules with no call-site
  changes, and the class is editable in focused files.
- **The graph** (`graph.js` / `ConstellationGraph`) is decoupled from the controller —
  it communicates only through a small `on`/`emit` API — and preserves node
  positions across rebuilds so edits don't re-scatter the layout.

Possible future work:

- Re-import a Markdown export together with its externalized photo files
  (re-attaching images from the sibling files for a lossless round-trip).
