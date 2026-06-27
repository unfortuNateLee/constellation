# ContactGraph

A browser-only, fully offline contact relationship explorer and editor. Import
Apple-style **vCard** (`.vcf`) or **Markdown** (`.md`) contacts, explore the
relationships between them as an interactive graph, edit contacts and
relationships inline, run rule-based bulk normalization, and export back to
vCard or Markdown. Everything runs client-side — no server, no backend, no CDN
(D3 is vendored locally), and your data never leaves the browser.

## Features

- **Import** vCard and Markdown contact files (single files or multi-contact
  bundles), preserving Apple-specific fields for round-trip fidelity.
- **Relationship graph** (D3 force-directed) built from both explicit
  relationships and inferred ones (shared organization, surname, hashtags).
- **Geographic** view clustering contacts by address (country → state → city → street).
- **Table** view with sortable columns and inline editing.
- **"Me" contact** to derive a family / close-network view.
- **Virtual nodes** for relationship targets that don't resolve to a real contact.
- **Suggestion engine** proposing reciprocal / missing relationships.
- **Bulk normalize** via a nested AND/OR rule engine.
- **Session persistence** to IndexedDB (restores on reload).
- **Export** back to vCard or Markdown.

## Running the app

It's a static site — no build step.

**Option A — open directly:** open `contacts-graph/index.html` in a desktop
browser. Works over `file://` with the network disabled.

**Option B — local server** (avoids some `file://` restrictions):

```sh
python3 -m http.server 7891 --directory contacts-graph
# then visit http://localhost:7891
```

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
contacts-graph/
  index.html                 App shell (loads scripts as classic globals, in order)
  css/styles.css             All styling (dark theme)
  js/
    vendor/d3.v7.min.js      Vendored D3 v7
    vcard-utils.js           RFC 6350 escaping / folding helpers
    contact-record.js        Format-neutral canonical contact record
    vcf-parser.js            vCard parser
    vcard-adapter.js         vCard import/export adapter
    markdown-adapter.js      Markdown import/export adapter
    relationship-builder.js  Contacts → { nodes, edges, hulls }
    graph.js                 D3 renderer (decoupled via on/emit)
    app.js                   Main controller
    app-notes.js             Notes editing + hashtag autocomplete (prototype mixin)
    app-bootstrap.js         Startup + modal wiring
  test/                      Node test suite + fixtures
  DESIGN_SPEC.md             Reimplementation spec
  DESIGN_SPEC_CLAUDE.md      Codebase-grounded spec
```

## Architecture notes & direction

The app currently loads as **classic browser globals** via ordered `<script>`
tags (no bundler). The data layer is mid-migration toward a **format-neutral
`ContactRecord` model** with pluggable **format adapters** (`VCardAdapter`,
`MarkdownAdapter`) so new formats become sibling adapters.

Planned direction (tracked work):

- Migrate to **ES modules** (and a lightweight dev/bundle setup), removing the
  load-order coupling and the cross-file global classes.
- Stable, deterministic contact IDs (derived from UID/FN rather than random).
- Per-record parse error isolation.
- Single canonical definition of the contact shape and the relationship
  taxonomy / color palette (currently duplicated across several files).
- Incremental graph rebuilds instead of full rebuild-on-every-edit.
- Split the monolithic controller (`app.js`) into focused modules.
