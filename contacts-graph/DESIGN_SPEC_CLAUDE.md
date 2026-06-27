# ContactGraph — Design & Implementation Specification

*Generated from live codebase review — March 2026; refreshed June 2026 for the ES-module migration, controller split, TSV adapter, light/dark theme, UID-based relationship resolution, and model-driven vCard editing.*

---

## 1. Overview

**ContactGraph** is a single-page, client-side web application that imports Apple vCard (`.vcf`/`.vcard`), Markdown (`.md`/`.markdown`), or TSV (`.tsv`) contact files, parses the contacts, and visualises their relationships as a force-directed graph. There is no server and no build step — everything runs in the browser as native ES modules. (The app must be **served over `http://`**; ES modules will not load from `file://`. See §11.)

### 1.1 Key Capabilities

| Capability | Description |
|---|---|
| Contact Import | Drag-and-drop or file-picker; parses one or more vCard/Markdown/TSV files in a single import operation |
| Graph View | D3 v7 force-directed graph, two modes (Connections, Geographic); node positions are preserved across rebuilds |
| Table View | Sortable, inline-editable spreadsheet of all contacts |
| Contact Detail Panel | Read-only info + inline notes + full edit mode with photo support |
| Relationship Management | Add, edit, and delete explicit relationships (resolved by UID when present); suggestions engine |
| Suggestion Engine | Six types of transitive family-network suggestions |
| Contact Export | Export a single contact, the current selection, or all contacts as vCard, Markdown, or TSV; a downloadable TSV template |
| Cluster Overlays | Convex-hull groupings (surname, hashtag, geographic) |
| Category Filters | "My Family" BFS network + hashtag/system tag filters |
| Bulk Normalize | Rule-based bulk find-and-replace across all contacts |
| Light / Dark Theme | Header toggle, persisted to localStorage (default dark) |
| Session Persistence | IndexedDB caches the full working dataset between browser sessions |

---

## 2. File Structure

```
contacts-graph/
├── index.html                   # App shell + modals
├── css/
│   └── styles.css               # Dark + light theme design system
├── docs/
│   └── APPLE_CONTACTS_ROUNDTRIP_CHECKLIST.md
├── test/
│   ├── fixtures/                # comprehensive.vcf + Markdown fixtures
│   ├── helpers/
│   │   └── load-app.js          # ESM test harness (imports modules + fake DOM globals)
│   ├── *.test.js                # node:test suites (parser, interactions, export, tsv, robustness, …)
└── js/
    ├── vendor/
    │   └── d3.v7.min.js         # Vendored D3 v7 (classic global script) for offline use
    │   # — data layer / shared singletons —
    ├── vcard-utils.js           # RFC 6350 escaping / folding / parse helpers (VCardUtils)
    ├── palette.js               # Reads CSS --cat-* tokens (single source for colors)
    ├── contact-record.js        # Format-neutral record + STANDARD_FIELDS shape registry + stable IDs
    ├── relationship-taxonomy.js # Single source for relationship types/labels/reciprocals/picker
    ├── vcf-parser.js            # vCard parser (VCFParser)
    ├── vcard-adapter.js         # vCard import/export adapter
    ├── markdown-adapter.js      # Markdown frontmatter/body import/export adapter
    ├── tsv-adapter.js           # TSV import/export adapter (+ template)
    ├── relationship-builder.js  # Contacts → { nodes, edges, hulls } (RelationshipBuilder)
    ├── graph.js                 # D3 renderer (ContactGraph), decoupled via on/emit
    │   # — controller: one class split across mixin modules —
    ├── apply-mixin.js           # Grafts a mixin class's methods onto a prototype
    ├── app.js                   # Core ContactRelationshipApp: constructor, _init, rebuild/index pipeline
    ├── app-controller.js        # Assembly point: imports app.js + every mixin, re-exports the class
    ├── app-notes.js             # Notes inline-save + hashtag autocomplete
    ├── app-session.js           # IndexedDB persistence + "me" self-contact resolution
    ├── app-sidebar.js           # Contact list, filters, legend, stats, tag colors
    ├── app-table.js             # Editable table view
    ├── app-detail.js            # Detail panel render / node select
    ├── app-suggestions.js       # Relationship suggestion engine
    ├── app-editing.js           # Field editors + raw-vCard regeneration
    ├── app-relationship-edit.js # Inline relationship CRUD + add-rel modal
    ├── app-bulk.js              # Bulk-normalize rule engine
    ├── app-export.js            # vCard / Markdown / TSV export + TSV template
    ├── app-theme.js             # Light/dark theme toggle + persistence
    └── app-bootstrap.js         # Entry module: browser startup + modal/global wiring
```

The app loads as **native ES modules** (no bundler). `index.html` loads vendored D3 as a classic `<script src="js/vendor/d3.v7.min.js">` (D3 is a browser global), then `<script type="module" src="js/app-bootstrap.js">`; the static `import` graph resolves everything else, so there is no hand-maintained load order. The runtime must not depend on a CDN or network access, and—because browsers refuse ES modules over `file://`—the app must be served over `http://` (any static server; see §11). `package.json` declares `"type":"module"`.

The controller is **one class (`ContactRelationshipApp`) split across modules**: `app.js` holds the core (constructor + the rebuild/index pipeline), and each `app-*.js` module defines a cohesive group of methods that it grafts onto the prototype via `applyMixin` (`js/apply-mixin.js`). `app-controller.js` imports `app.js` plus every mixin for side effects and re-exports the class, so both the browser entry and the test harness import the fully-assembled controller from there.

---

## 3. Core Data Model

### 3.1 Contact (output of VCFParser)

```js
{
  id: 'c_xxxxxxxx',         // deterministic stable ID: FNV-1a hash of UID (or FN) + occurrence suffix
  uid: 'urn:uuid:...',      // from vCard UID field, or null
  fn: 'Jane Smith',         // formatted/display name (from FN field)
  name: {
    family: 'Smith',
    given: 'Jane',
    additional: '',         // middle name
    prefix: '',             // e.g. "Dr."
    suffix: '',             // e.g. "Jr."
  },
  org: 'Acme Corp',
  title: 'Engineer',
  isCompany: false,         // true when X-ABSHOWAS: COMPANY
  emails: [{ value: 'jane@example.com', types: ['INTERNET', 'HOME'] }],
  phones: [{ value: '+1 555 1234', types: ['CELL'] }],
  addresses: [{
    pobox: '', ext: '',
    street: '123 Main St', city: 'Austin',
    state: 'TX', zip: '78701', country: 'US',
    types: ['HOME'],
  }],
  birthday: '1980-04-15',   // YYYY-MM-DD string or null
  anniversary: '2005-06-20',
  notes: ['Free text note'],
  related: [{ name: 'John Smith', type: 'husband', rawType: '_$!<Husband>!$_' }],
  urls: [{ value: 'https://example.com', types: [] }],
  photo: 'data:image/jpeg;base64,...',  // null if absent
  tags: ['company'],        // system tags inferred at parse time
  noteTags: ['church', 'volunteer'],    // hashtags from NOTE fields
  customFields: {},         // arbitrary typed fields from non-vCard adapters
  record: { schema: 'contactgraph.contact', version: 1, ... },
  sourceDocuments: [{ format: 'vcard', raw: 'BEGIN:VCARD...', dirty: false }],
  rawVCard: 'BEGIN:VCARD\r\n...\r\nEND:VCARD',  // original vCard text
}
```

**Important invariant:** for vCard-origin contacts, `rawVCard` is the export source of truth for **non-editable Apple fields** (it is preserved verbatim), while the **model drives all editable fields, including relationships**. Every field mutation must call `_rewriteEditableFields()`, which regenerates the editable lines (and the `X-ABRELATEDNAMES` relationship groups) from the model and re-emits `rawVCard`. Stable IDs are deterministic, so re-parsing the same source yields the same `id` every time (see §10.1, §10.2). Markdown/TSV-origin contacts have no `rawVCard` and export through their adapter's standard-field serializer.

### 3.1.1 ContactRecord (format-neutral model)

Phase 1 of multi-format support attaches a canonical `ContactRecord` beside the existing app-facing contact object. The graph, table, and detail code may continue using legacy fields directly, but all future import/export adapters should target this structure.

```js
{
  schema: 'contactgraph.contact',
  version: 1,
  id: 'c_xxxxxxxx',
  uid: 'urn:uuid:...',
  displayName: 'Jane Smith',
  standard: {
    fn, name, org, title, isCompany,
    emails, phones, addresses, urls,
    birthday, anniversary, notes, related,
    photo, tags, noteTags,
  },
  fields: {
    favorite_color: { type: 'color', value: '#3366cc' },
  },
  sourceDocuments: [
    { format: 'vcard', raw: 'BEGIN:VCARD...', index: 0, dirty: false },
  ],
}
```

`fields` is the semantic-lossless extension point for Markdown and any future adapter-specific data. Unknown fields must remain attached even when the current UI cannot edit them. `sourceDocuments` records the backing source representation for round-trip/export work. `ContactRecord.refreshLegacyContact(contact)` keeps the attached record synchronized after legacy edits.

**Single source for the contact shape.** `ContactRecord.STANDARD_FIELDS` is the one place the standard-field list (and each field's default) is declared. `ContactRecord.createEmptyContact()`, the parser's empty-contact init, the adapters, and the builder's `_makeNode()` all derive from it, so adding a standard field is a one-line change. `ContactRecord.assignStableId(contact, usedIds, basisCounts)` computes the deterministic `c_…` id (FNV-1a over `uid:`/`fn:` basis plus an occurrence suffix to keep duplicate-named contacts distinct and stable across reparses).

### 3.1.2 Contact Format Adapters

File-format-specific behavior should live behind small adapters so Markdown can be added without threading conditionals through the controller.

Adapter contract:

```js
{
  id: 'vcard',
  label: 'vCard',
  extensions: ['vcf', 'vcard'],
  mimeType: 'text/vcard;charset=utf-8',
  canImportFile(file),
  parse(text, options),
  serialize(contacts, ids),
  exportBlob(contacts, ids),
}
```

Current adapters:

- `VCardAdapter`
  - delegates parsing to `VCFParser`
  - serializes selected contacts from current `rawVCard` blocks, with a standard-field fallback for contacts imported from Markdown
  - returns export `Blob`s with the vCard MIME type
- `MarkdownAdapter`
  - parses YAML-style frontmatter plus Markdown body content
  - maps known fields into the legacy app-facing contact shape
  - preserves unknown top-level and `fields` values as typed `customFields`
  - preserves body content as `customFields.markdown_body`
  - serializes one contact as one Markdown document, or multiple contacts as a delimiter-separated Markdown bundle
  - on export, **externalizes photos** to separate image files referenced by filename (`serializeBundle()` returns `{ markdown, images }`) instead of base64-embedding them
- `TsvAdapter` (`js/tsv-adapter.js`)
  - a flat, spreadsheet-friendly format: one contact per row, a header row naming the columns in `TsvAdapter.COLUMNS` order
  - multi-valued fields (emails, phones, urls, relationships) are a `' | '`-joined list where each item may carry a type in brackets, e.g. `[home] jane@x.com | [work] jane@y.com`; relationships are `[type] Name`
  - a single address is spread across `street`/`city`/`state`/`zip`/`country`/`address_type` columns; tabs and newlines inside values are escaped
  - `templateText()` returns a blank template (header row + one worked example row), downloaded via the "TSV Template" button
  - intentionally simplified (one address, a single type per value, no photo) — vCard / Markdown remain the lossless formats

Future formats should be implemented as sibling adapters that map into `ContactRecord`, `customFields`, and the legacy app-facing fields needed by existing UI.

### 3.1.3 Markdown Contact Format

Markdown contacts use YAML-style frontmatter for structured fields and the body for long-form human notes.

```md
---
contactgraph: 1
uid: jane-md
fn: Jane Markdown
name:
  given: Jane
  family: Markdown
emails:
  - value: jane@example.com
    types: [HOME, INTERNET]
fields:
  favorite_color:
    type: color
    value: "#3366cc"
emergency_priority: 2
---
# Notes

Markdown body #neighbor
```

Known keys populate standard contact fields. Unknown top-level keys and all `fields` entries become semantic custom fields. The Markdown body is preserved as `markdown_body`; when no explicit `notes` frontmatter is present, the body also feeds the app-facing `notes` array so search and hashtag filters work.

Multiple Markdown contacts in one file are separated by:

```md
<!-- CONTACTGRAPH:CONTACT -->
```

### 3.2 Node (output of RelationshipBuilder)

Nodes extend contacts with graph-specific fields:

```js
{
  // --- all contact fields copied across ---
  id, name, structuredName, org, title, isCompany,
  emails, phones, addresses, urls, birthday, anniversary,
  notes, related, tags, noteTags, customFields, record,
  sourceDocuments, photo, rawVCard,

  // --- graph fields added by builder ---
  isVirtual: false,        // true for people listed in relationships but without their own vCard
  connectionCount: 3,      // number of edges incident to this node
  category: 'other',       // primary display category (see §3.4)
  filterTags: ['family', 'church'],  // tags for sidebar filter buttons
  isGroupNode: false,      // true for cluster hub nodes (surname/geo/tag groups)

  // --- only on group nodes ---
  groupKind: 'likely-surname',  // 'likely-surname' | 'likely-tag' | 'geo-country' | ...
  groupDepth: 1,
  memberIds: ['c_abc', 'c_def'],
}
```

`_makeNode()` copies the standard contact fields from `ContactRecord.STANDARD_FIELDS` (renaming `fn`→`name` and `name`→`structuredName`) and then adds the graph-only fields, so the node shape tracks the contact shape automatically.

### 3.3 Edge

```js
{
  id: 'e_0',
  source: 'c_abc',         // node ID string (D3 replaces with object reference after simulation)
  target: 'c_def',
  type: 'husband',         // canonical relationship type
  rawType: '_$!<Husband>!$_',  // original vCard label value
  label: 'Husband',        // human-readable label for source side
  reverseLabel: 'Wife',    // human-readable label for target side (null when same as label)
  category: 'family',      // edge colour category (see §3.5)
  inferred: false,         // true for org-inferred or cluster edges
  edgeKind: 'explicit',    // 'explicit' | 'likely-surname' | 'likely-tag' | 'likely-family'
                           //   | 'geographic-hierarchy' | 'geographic-membership'
  isConfirmed: true,       // false for unconfirmed likely-connection edges
  confidence: null,        // 0.0–1.0 for unconfirmed edges (0.45 surname, 0.38 tag)
  org: null,               // org name for inferred colleague edges
}
```

### 3.4 Node Categories (filterTags)

`filterTags` is an array of strings. The builder computes it from `_filterTags(node, familyConnectedIds)`:

| Tag | Source |
|---|---|
| `family` | Node is within BFS distance of the "me" contact via explicit relationships |
| `company` | `contact.isCompany === true` |
| `virtual` | Node has no corresponding real vCard (`isVirtual === true`) |
| `other` | Fallback — no other tags assigned |
| `<hashtag>` | Any `#tag` found in the contact's NOTE fields |

The sidebar filter buttons show all distinct tags. A contact can appear in multiple filters.

### 3.5 Edge Categories

| Category | Types included |
|---|---|
| `family` | All family relationship types (spouse/parent/child/sibling/grandparent/etc.) |
| `friend` | `friend` |
| `work` | `colleague`, `manager`, `assistant` |
| `neighbor` | `neighbor` |
| `other` | Everything else |

### 3.6 Hull (convex cluster visualisation)

```js
{
  id: 'hull__family_group__smith',
  label: 'Smith',
  memberIds: ['c_abc', 'c_def', 'c_ghi'],
  kind: 'likely-surname',   // used for colour/style selection
  depth: 1,                 // for geo hulls: 1=country, 2=state, 3=city, 4=street
  color: '#e17055',
}
```

---

## 4. VCFParser (`js/vcf-parser.js`)

**Class:** `VCFParser`

### 4.1 `parse(text)` — Top-Level Entry Point

1. **Pre-extract raw blocks and photos as positional arrays.** Scans the raw text with a regex for `BEGIN:VCARD ... END:VCARD` blocks. For each block, extracts the base64 photo data (if present) into a `photos[]` array. Uses positional index (not FN) to avoid collision when two contacts share a display name.

2. **Strip photo data from main text** (for performance) — replaces `PHOTO...` multi-line blocks with `PHOTO:__stripped__` before unfolding.

3. **Unfold continuation lines** per RFC 6350 §3.2 using `VCardUtils.unfold()`. A CRLF/LF followed by a space or tab is removed along with the leading continuation whitespace.

4. **Split into per-contact blocks** by matching `BEGIN:VCARD ... END:VCARD` in the unfolded text.

5. **Parse each block** via `_parseVCard()` and attach the corresponding raw block + photo by positional index. Each block is parsed in a `try/catch`: a malformed record is skipped with a console warning rather than aborting the whole import.

6. **Assign a deterministic id** to each contact via `_assignStableId()` → `ContactRecord.assignStableId()` (FNV-1a over the contact's UID/FN plus an occurrence suffix), so re-parsing the same file yields identical ids.

### 4.2 `_parseVCard(block)` — Per-Contact Parsing

Iterates unfolded lines and parses them through `VCardUtils.parseContentLine()`. This finds the first colon that is not inside a quoted parameter, parses `item1.PROPNAME;PARAMS:value` group syntax, and parses parameters into normalized name/value arrays.

Key property handling:

| vCard Property | Parsed into |
|---|---|
| `FN` | `contact.fn` |
| `N` | `contact.name` (family;given;additional;prefix;suffix), split on unescaped semicolons only |
| `ORG` | `contact.org` (first unescaped semicolon-delimited component) |
| `TITLE` | `contact.title` |
| `X-ABSHOWAS:COMPANY` | `contact.isCompany = true` |
| `EMAIL` | Appended to `contact.emails` (skips values starting with `/9j/`) |
| `TEL` | Appended to `contact.phones`; supports repeated and comma-separated `TYPE` params |
| `ADR` | Appended to `contact.addresses`; split on unescaped semicolons only |
| `BDAY` | `contact.birthday` (skips `//` prefixed year-less dates) |
| `NOTE` | Appended to `contact.notes` |
| `URL` | Appended to `contact.urls` |
| `UID` | `contact.uid` |
| `CATEGORIES` | Comma-separated values merged into `contact.tags` (non-company tags round-trip through vCard via this property) |
| `PHOTO` | Skipped here; handled by positional array |

After the line loop, processes **item groups** (`item1.X-ABRELATEDNAMES` + `item1.X-ABLabel`) to populate `contact.related`.

### 4.3 Relationship Type Normalisation

`_normalizeRelType(label)` delegates to `RelationshipTaxonomy.normalize(label)` (`js/relationship-taxonomy.js`) — the **single source of truth** for relationship semantics. The taxonomy strips Apple's `_$!<Label>!$_` wrapper and maps common strings (including all gendered variants — grandmother, uncle, nephew, stepmother, stepson, etc.) to canonical, hyphen-free types (e.g. `stepson`, not `step-son`). The same class also provides labels, vCard labels, edge categories, reciprocals, and the picker option HTML, so the parser, builder, and controller all delegate to it rather than carrying their own maps.

### 4.4 Hashtag Extraction

`_extractHashtags(notes)` scans NOTE field text for `#tag` patterns matching `/(^|[\s([{,;])#([A-Za-z0-9][A-Za-z0-9_-]*)/g`. Returns a sorted array of lowercase tag names stored in `contact.noteTags`.

### 4.5 Shared vCard Utilities (`js/vcard-utils.js`)

`VCardUtils` is the shared parser/writer utility layer. Parser and app serialization must use it so import/export behavior stays symmetric.

Required utility behavior:

- unfold folded content lines by removing CRLF/LF plus the following space/tab
- parse content lines at the first colon outside quoted parameters
- split parameter lists on unquoted semicolons
- split structured values such as `N` and `ADR` on unescaped semicolons
- parse `TYPE=HOME,VOICE`, repeated `TYPE=` params, and bare legacy type params
- decode `\n`, `\N`, `\,`, `\;`, and `\\`
- encode backslash, semicolon, comma, and newlines for generated values
- fold generated lines to vCard continuation lines beginning with one space
  - folding must respect the vCard 75-octet limit
  - folding must not split multibyte UTF-8 characters
- emit CRLF line endings for generated vCard blocks

---

## 5. RelationshipBuilder (`js/relationship-builder.js`)

**Class:** `RelationshipBuilder`

**Constructor:** `new RelationshipBuilder(contacts)` — builds the name index and a `_uidIndex` (`Map<uid, Contact>`) immediately.

### 5.1 Target Resolution (UID-first, then name)

`findRelationTarget(rel)` is the resolver used at both explicit-edge sites. It prefers an explicit `rel.uid` (looked up in `_uidIndex`) — exact and rename-proof — and falls back to `findContact(rel.name)` when there is no uid or the uid isn't loaded. Markdown/TSV relationships can carry a `uid`, and the add-relationship modal stores the target contact's uid, so app-created relationships are rename-proof too. vCard relationships (name-only) still resolve by name.

`_buildNameIndex(contacts)` creates a `Map<string, Contact[]>`. For each contact it adds four lookup keys:
1. Exact FN (lowercase)
2. FN with nickname tokens removed (`"quoted"` parts stripped)
3. Last, First format
4. First Last only (drops middle names for 3+ word names)

When a key maps to 2+ contacts, a console warning fires (ambiguous). `findContact(name)` returns `null` for ambiguous keys (→ a virtual node is created rather than silently linking the wrong person). `findContacts(name)` returns the full array.

### 5.2 `build(options)` — Dispatch

```js
build({
  mode: 'connections',       // 'connections' | 'geographic'
  includeInferred: true,     // org-based colleague edges
  includeLikelyFamily: true, // surname cluster overlays
  includeLikelyConnections: true, // hashtag cluster overlays
  includeIsolated: false,    // include nodes with no edges
  rootContactId: null,       // ID of "me" contact for family BFS
})
```

Returns `{ mode, nodes, edges, hulls }`.

**Routing:**
- `mode === 'connections'` (or variants) → `_buildExplicitRelationships()`
- `mode === 'geographic'` → `_buildGeographic()`

### 5.3 `_buildExplicitRelationships()`

1. Seed `nodesMap` from all contacts (`_makeNode()`).
2. Call `_appendExplicitRelationshipEdges()` — adds explicit edges from `contact.related` arrays; creates virtual nodes for unresolved names; populates `explicitAdj` for BFS.
3. Optionally add ORG-inferred colleague edges (groups of 2–30 contacts sharing the same `org`).
4. Compute `familyConnectedIds` via BFS from `rootContactId` (`_collectConnectedIds()`).
5. Build `hullSeeds` — starts with a family-network hull; optionally appends surname and hashtag hulls via `_appendLikelyConnectionGroups()`.
6. Assign `category` and `filterTags` to every node.
7. Filter out isolated nodes (unless `includeIsolated`).
8. Build final hulls via `_buildClusterHulls()`.

### 5.4 `_buildGeographic()`

Groups contacts by address hierarchy: country → state → city → street. Each level becomes a group node. Edges connect:
- `geographic-hierarchy`: parent group → child group
- `geographic-membership`: innermost group → contact node

Street normalisation strips leading house numbers so neighbours on the same road share a cluster.

Hull seeds are created for any group node with 2+ member contacts.

Address preference order: HOME (score 0) → WORK (score 1) → other (score 2). Contacts without a usable address are optionally placed in a "No Address" group.

### 5.5 Cluster Hub Nodes (`_makeGroupNode`)

Group nodes have `isGroupNode: true` plus:
- `groupKind`: `'likely-surname'` | `'likely-tag'` | `'geo-country'` | `'geo-state'` | `'geo-city'` | `'geo-street'`
- `groupDepth`: integer depth in the hierarchy
- `memberIds`: IDs of member contacts (not other group nodes)

### 5.6 Key Helper Methods

| Method | Purpose |
|---|---|
| `_appendExplicitRelationshipEdges()` | Adds explicit edges; builds `explicitAdj`; handles `reverseLabel` for reciprocal pairs |
| `_appendLikelyConnectionGroups()` | Adds surname and hashtag hub nodes/edges; returns new hullSeeds |
| `_buildExplicitAdjacency()` | Builds adjacency Map (used by geographic mode for BFS) |
| `_collectConnectedIds(rootId, adj)` | BFS from rootId; returns Set of all connected IDs |
| `_buildClusterHulls(nodes, seeds)` | Filters seeds to those with 2+ visible members |
| `_familyNameForContact(c)` | Uses `c.name.family`; falls back to last word of `c.fn` |
| `_normalizeFamilyKey(name)` | NFKD → strip diacritics → lowercase → strip non-alnum |
| `_normalizeGeoKey(value)` | NFKD → lowercase → replace non-alnum with `-` |
| `_normalizeStreet(value)` | Strips leading house number from street address |
| `_geoHullColor(depth)` | `{1:'#74b9ff', 2:'#55efc4', 3:'#fdcb6e', 4:'#fd79a8'}` |
| `_edgeCategory(type)` | Delegates to `RelationshipTaxonomy.category(type)` (family/friend/work/neighbor/other) |
| `_friendlyType(type)` | Delegates to `RelationshipTaxonomy.label(type)` (title-case display string) |
| `_isValidReciprocal(a, b)` | Delegates to `RelationshipTaxonomy.isValidReciprocal(a, b)` |
| `getStats(nodes, edges)` | Returns totalContacts, visibleNodes, visibleGroups, edges, categories |

The type/category/reciprocal helpers all delegate to `RelationshipTaxonomy` (§4.3) rather than carrying their own maps.

---

## 6. ContactGraph Renderer (`js/graph.js`)

**Class:** `ContactGraph`

### 6.1 Initialisation

Creates an SVG with five layered `<g>` groups in z-order:
1. `hulls` — convex hull `<path>` elements
2. `hull-labels` — `<text>` labels above hulls
3. `links` — `<g>` containers (one per edge, each containing a `<line>` + two `<text>`)
4. `nodes` — `<g>` containers (one per node)
5. `labels` — `<text>` name labels below nodes

SVG defs contain:
- Arrow markers for each edge category (`arrow-family`, `arrow-friend`, `arrow-work`, `arrow-neighbor`, `arrow-other`)
- A `glow` filter (Gaussian blur) for selected nodes

### 6.2 `render(nodes, edges, meta)`

Stores all data then calls `_applyFilters()`. Does NOT call `_renderGraph()` directly.

### 6.3 `_applyFilters()`

1. If `!_showInferred`, removes org-inferred edges (where `e.inferred && !e.edgeKind`).
2. If `_filterCategories` is non-empty, computes the visible node set:
   - Starts with nodes whose `filterTags` overlap `_filterCategories`
   - Propagates visibility to/from group nodes (so cluster hubs appear when any member is visible)
   - Filters edges to only include those with both endpoints visible
   - Filters hulls to those with at least one visible member

Then calls `_renderGraph()`.

### 6.4 `_renderGraph(nodes, edges, hulls)`

Uses D3 v7 **enter/update/exit** join pattern on all four visual layers. Key behaviours:

**Hulls:** `<path class="cluster-hull hull-{kind}">` with fill/stroke from `hull.color`.

**Edges:** Each edge is a `<g class="link link-{category}">` containing:
- `<line>` — stroke colour from category, dashed for inferred/likely edges
- `<text class="edge-label-src">` — label near the source end (at 32% along the line when dual labels, 50% when single)
- `<text class="edge-label-tgt">` — reverse label near the target end (at 68% along) — only shown when it differs from the source label

**Nodes:** Each node is a `<g class="node node-{category}">` containing:
- `<circle class="node-ring">` — gold selection halo (opacity 0 by default)
- `<circle class="node-circle">` — main circle, radius varies by type
- `<clipPath>` + `<image>` — circular photo crop (only when photo exists)
- `<text class="node-initials">` — two-character initials (when no photo, not company, not group)
- `<text class="node-company-icon">` — 🏢 emoji (companies without photo)
- `<text class="node-group-icon">` — glyph (group nodes: `≈` surname, `#` tag, `◎` geo, `◌` other)

**Labels:** `<text class="node-label">` positioned below each node.

### 6.5 Node Radius Formula

```js
const nodeRadius = d => {
  if (d.isGroupNode) return Math.max(12, 18 - d.groupDepth * 1.5);
  const base = d.isCompany ? 12 : d.isVirtual ? 6 : 10;
  const bonus = Math.min(d.connectionCount * 1.5, 10);
  return base + bonus;
};
```

### 6.6 Force Simulation Parameters

| Force | Configuration |
|---|---|
| `forceLink` | Distance varies by edgeKind: geo-hierarchy=58, geo-membership=70, likely=65, family=80, work=100, default=120 |
| `forceManyBody` | Group nodes: -520, companies: -400, regular: -150; `distanceMax=400` |
| `forceCenter` | Centred on container |
| `forceCollide` | `nodeRadius + 8` |

**Position preservation across rebuilds.** The renderer keeps a `_nodePositions` cache (`Map<id, {x, y}>`, updated as the simulation ticks). On `render()` it seeds each incoming node from its cached position; when at least ~50% of nodes are already placed it treats the rebuild as *incremental* and resumes with a gentle `alpha(0.3)` instead of a full re-layout, so editing a contact doesn't re-scatter the graph. (The controller also skips the rebuild entirely on a notes save when no `#hashtag` changed.)

### 6.7 Convex Hull Rendering

`_hullPath(hull, nodes, nodeRadius)` computes the convex hull of four corner points expanded by `r+12` around each member node, using `d3.polygonHull()`. Returns an SVG path string.

Hull labels are positioned at the top-centre of the bounding box and scale inversely with zoom (so they appear at a constant visual size).

### 6.8 Selection / Highlighting

On node click: dims all non-connected nodes to opacity 0.15, dims non-incident edges to opacity 0.05, shows the gold selection ring. Emits `nodeSelect` event.

`highlightContact(id)` — selects without emitting (used from contact list clicks) then zooms to the node.

`resetView()` — animated transition to `d3.zoomIdentity`.

### 6.9 Colour Scheme

Colours are **not hardcoded in JS**. `graph.js` builds its node/edge colour maps from the CSS `--cat-*` custom properties via `Palette` (`js/palette.js`), which reads them with `getComputedStyle` and caches the result. CSS is therefore the single source of truth for category colours (see §9.1). On a theme switch, `app-theme.js` calls `Palette.refresh()` (to clear the cache) then `graph.refreshColors()`, so the graph recolours to the active theme without a full rebuild.

Representative dark-theme tokens (family `--cat-family` #e17055, friend `--cat-friend` #00b894, work `--cat-work` #74b9ff, neighbor `--cat-neighbor` #fdcb6e, company `--cat-company` #636e72, plus node-default/group/selected/edge-inferred tokens); the light theme overrides a subset under `:root[data-theme='light']`. The authoritative list lives in `css/styles.css`.

### 6.10 `getLegend(mode)` — Legend Data

Returns an array of legend item descriptors appropriate for the current mode. App uses this to render the graph legend.

---

## 7. App Controller (`js/app.js` + `app-*.js` mixins, assembled by `js/app-controller.js`)

**Class:** `ContactRelationshipApp`

**Instantiation:** `new ContactRelationshipApp()` in `DOMContentLoaded` from `app-bootstrap.js` → stored as `window.app`.

The controller is a single class split across modules. `app.js` owns the core: the constructor (creates the format adapters and graph, calls `_init()`), `_init()` (DOM wiring), and the `_rebuildGraph` / `_reindexContacts` / `_reindexGraphData` pipeline plus shared helpers (`_adapterForFile`, `_makeMinimalContact`, etc.). Each `app-*.js` module defines a cohesive method group and grafts it onto `ContactRelationshipApp.prototype` via `applyMixin`. `app-controller.js` imports `app.js` and every mixin (for side effects) and re-exports the class; `app-bootstrap.js` imports from there and boots. This split is intentionally mechanical — `this._foo()` calls resolve across modules with no call-site changes — so the subsections below name the owning module:

| Concern | Module |
|---|---|
| Notes inline-save + hashtag autocomplete (§7.6) | `app-notes.js` |
| Sidebar list, filters, legend, stats (§7.5, §7.17) | `app-sidebar.js` |
| Detail panel render / node select (§7.6) | `app-detail.js` |
| Field edit mode + `_rewriteEditableFields` (§7.7, §7.8) | `app-editing.js` |
| Inline relationship edit + add-rel modal (§7.9, §7.12) | `app-relationship-edit.js` |
| Suggestion engine (§7.21) | `app-suggestions.js` |
| Table view (§7.19) | `app-table.js` |
| Bulk normalize (§7.20) | `app-bulk.js` |
| Export + TSV template (§7.13) | `app-export.js` |
| IndexedDB session + "me" picker (§7.16, §7.18) | `app-session.js` |
| Light/dark theme (§7.24) | `app-theme.js` |

### 7.1 State Properties

| Property | Type | Description |
|---|---|---|
| `contacts` | `Contact[]` | Full parsed contact array |
| `graphData` | `{nodes, edges, hulls}` | Last output of `builder.build()` |
| `builder` | `RelationshipBuilder` | Rebuilt whenever contacts change |
| `graph` | `ContactGraph` | D3 renderer instance |
| `_graphMode` | string | `'connections'` or `'geographic'` |
| `_mainViewMode` | string | `'graph'` or `'table'` |
| `_showInferred` | bool | Toggle org-inferred edges |
| `_showLikelyFamily` | bool | Toggle surname clustering |
| `_showLikelyConnections` | bool | Toggle hashtag clustering |
| `_showIsolated` | bool | Toggle isolated node display |
| `_selfContactId` | string/null | ID of "me" contact for family BFS |
| `_activeFilters` | `Set<string>` | Currently active filter tags |
| `_searchQuery` | string | Current sidebar search text |
| `_selectedNodeId` | string/null | Currently displayed node in detail panel |
| `_editingContactId` | string/null | Contact in edit mode |
| `_dismissedSuggestions` | `Set<string>` | Keys of dismissed suggestion items |
| `_selectedForExport` | `Set<string>` | Contact IDs checked for bulk export |
| `_tableSort` | `{key, dir}` | Table sort state |
| `_bulkRuleState` | object/null | Current bulk normalize rule |
| `_sidebarControlsCollapsed` | bool | Sidebar collapse state |
| `_contactById` | `Map<string, Contact>` | Real contact lookup by contact ID |
| `_contactsByUid` | `Map<string, Contact>` | Stable lookup by vCard `UID` for session restore |
| `_contactsByFn` | `Map<string, Contact>` | Normalized display-name lookup for duplicate checks and restore fallback |
| `_nodeById` | `Map<string, Node>` | Current graph node lookup, including virtual and group nodes |
| `_edgesByNodeId` | `Map<string, Edge[]>` | Current graph edge adjacency lookup |
| `_relatedRefsByTargetId` | `Map<string, Array>` | Reverse relationship references used by the detail panel |

### 7.2 Startup Flow

1. `new ContactGraph(container)` — creates D3 renderer
2. Attach all DOM event listeners (file input, drag-drop, toggles, buttons)
3. Check for persisted session in IndexedDB → restore if found
4. Render empty state (drop zone visible)

### 7.3 File Load Flow

`_loadFile(file)` →
1. Show loading overlay
2. `file.text()` → pass to `parser.parse(text)`
3. `new RelationshipBuilder(contacts)`
4. `_rebuildGraph()`
5. `_persistSession()`

### 7.4 `_rebuildGraph()`

```
_reindexContacts()
  → builder.build(options)
  → graphData = { mode, nodes, edges, hulls }
  → _reindexGraphData()
  → allCategories = _availableFilterTags(nodes)
  → _pruneActiveFilters()
  → _renderSelfContactPicker()
  → _renderCategoryFilters()
  → _renderStats()
  → _renderLegend()
  → _syncGraphModeControls()
  → graph.render(nodes, edges, { mode, hulls })
  → graph.setFilterCategories(activeFilters)
  → _renderContactList()
  → _renderTableMode()
  → re-select prior node if still present
```

### 7.5 Contact List (Sidebar)

`_renderContactList()` renders a virtualized (non-windowed) list of contact items. Each item has:
- Export checkbox (for bulk VCF export)
- Coloured dot (derived from `filterTags` — can be a CSS linear-gradient for multi-tag contacts)
- Name (formatted per `_contactSortMode`)
- Subtitle (org or category)

Click → `graph.highlightContact(id)` + `_onNodeSelect(node)`.

Filtering respects `_searchQuery` (searches name, org, title, notes) and `_activeFilters`.

### 7.6 Detail Panel

`_onNodeSelect(node)` populates the right-side detail panel with:

1. **Header** — avatar (photo or initials), name, org, title, category badge
2. **Contact Info** — read-only rows (icon + value + label), including custom fields from Markdown/import metadata as `Custom: <Label>` rows, or editable form
3. **Notes** — inline textarea with autosave (2-second debounce) and hashtag autocomplete
4. **Relationships** — three sections: own relationships, back-references, inferred
5. **Suggested Additions** — suggestion engine output
6. **Footer buttons** — context-sensitive (virtual node shows "Create Contact", edit mode shows Save/Cancel)

#### Relationship Display Sections

1. **Own relationships** — from `contact.related`; each item has an edit (✎) button that triggers inline type editing
2. **Back-references** — other contacts whose `related` arrays mention this node; shown with "via X" label
3. **Inferred (org)** — up to 8 inferred colleague edges, with "+ N more" overflow

#### Inline Notes Autosave

Notes textarea fires `oninput` → schedules a 2-second debounce save. On blur, flushes immediately. On save:
- Updates `contact.notes`, `contact.noteTags`, `contact.tags`
- Calls `_rewriteEditableFields(contact)` to patch `rawVCard`
- Rebuilds graph and persists

#### Hashtag Autocomplete

When the user types `#` in any notes textarea, a floating popup (`#tag-autocomplete`) appears below the caret showing matching existing tags from all contacts. Keyboard navigation: Arrow keys, Enter/Tab to apply, Escape to close.

### 7.7 Edit Mode

Activated by "Edit Details" button. Renders a form grid with:
- Photo upload/remove (FileReader → base64 data URL stored in hidden input)
- Text fields for all name parts, org, title, birthday, anniversary, notes
- Collection fields (emails, phones, URLs) — each entry has value input, type select, "Preferred" radio, Remove button
- Address editor with separate street/city/state/zip/country fields per address
- Custom field editor — scalar and list fields are editable; nested object fields render read-only and remain preserved
- "Treat as Company" checkbox (sets `X-ABSHOWAS: COMPANY` on export)
- Inline relationship editors (triggered from edit mode)

Saving calls `_saveDetailEdits()` which reads all form DOM state, updates the contact object, calls `_rewriteEditableFields()`, rebuilds the graph.

### 7.8 `_rewriteEditableFields(contact)` (`app-editing.js`)

Re-emits `contact.rawVCard` from the current model. This is how in-memory edits persist to the exportable VCF, and it is the **single chokepoint that keeps the model and the raw card consistent**. The method unfolds the existing card, **keeps** non-editable simple properties and non-editable item groups verbatim (including non-anniversary `itemN.X-ABDATE` groups such as custom Apple dates), and **regenerates** the editable content from the model: FN/N/ORG/TITLE/PHOTO, the typed emails/phones/addresses/urls, NOTE, the anniversary item group, and — as of the model-driven-relationships change — the `itemN.X-ABRELATEDNAMES` + `X-ABLabel` relationship groups, derived from `contact.related`. Output is folded via `VCardUtils.foldLines()`, then `_syncContactRecord(contact)` refreshes the canonical `ContactRecord`.

Because relationships are now regenerated here, the relationship add/edit/delete paths just mutate `contact.related` and call this method — there is no longer any per-relationship `rawVCard` string surgery in those paths (see §7.9, §7.12, §10.1).

### 7.9 Inline Relationship Type Editing

`_startInlineRelEdit(item, contact, relIdx, node)` — called when the ✎ button is clicked on a relationship item.

Replaces the display row with an inline editor containing:
- A `<select>` of all known types plus "Custom…"
- A freeform text input (shown when "Custom…" is selected)
- Save and Cancel buttons

The type `<select>` and the add-relationship picker are both generated from `RelationshipTaxonomy.optionsHtml()` (the single source), so the modal and inline editors stay in sync; the custom option uses `RelationshipTaxonomy.CUSTOM_OPTION_VALUE`.

On save:
1. Updates `contact.related[relIdx].type` and `.rawType`
2. Calls `_rewriteEditableFields(contact)` — which regenerates the `X-ABRELATEDNAMES`/`X-ABLabel` group from the updated model (no direct string patching)
3. Checks for a reciprocal relationship in the target contact:
   - Finds the target contact via `findContact(rel.name)`
   - Computes `_reciprocalType(newType)`
   - Checks `_isReciprocalDowngrade(candidate, existing)` — if the computed reciprocal is a generic fallback and the existing type is already more specific, does NOT overwrite
   - If update proceeds, updates the target's `related` entry and calls `_rewriteEditableFields(otherContact)`
4. Shows a toast: "Updated to X" or "Updated to X — also set Y's side to Z"

### 7.10 `_reciprocalType(type)`

Maps each relationship type to its expected counterpart:

```
spouse↔spouse, husband↔wife, partner↔partner
mother/father/parent → child
son/daughter/child → parent
stepmother/stepfather/stepparent → stepchild
stepson/stepdaughter/stepchild → stepparent
brother/sister/sibling → sibling
grandmother/grandfather/grandparent → grandchild
grandson/granddaughter/grandchild → grandparent
uncle/aunt → nephew/niece
nephew/niece → uncle/aunt (gendered)
cousin → cousin
manager ↔ assistant
friend/colleague/neighbor → same
```

### 7.11 `_isReciprocalDowngrade(candidate, existing)`

Returns `true` when `candidate` is the generic form of `existing`:
```
parent    superseded by: mother, father
child     superseded by: son, daughter
spouse    superseded by: husband, wife
sibling   superseded by: brother, sister
stepparent superseded by: stepmother, stepfather
stepchild  superseded by: stepson, stepdaughter
grandparent superseded by: grandmother, grandfather
grandchild  superseded by: grandson, granddaughter
```

### 7.12 Add Relationship Modal

Opened via "Add Relationship" button in detail panel footer or inline button in relationships section.

Modal fields:
- From: current contact name (read-only)
- Relationship Type: `<select>` grouped by Family/Social/Professional + "Custom…" option
- Custom Type: text input (shown when "Custom…" selected)
- Target: dropdown — "Choose Existing Contact" or "Enter New Name"
- Existing Contact: `<select>` of all real contacts
- New Name: text input (with option to create real contact entry)

On save:
1. Determines `relName` and `relType` (custom type via `RelationshipTaxonomy.CUSTOM_OPTION_VALUE`); when the target is an existing contact, captures its `uid` so the relation is rename-proof
2. Pushes `{ name, type, rawType, uid? }` to `contact.related`
3. Calls `_rewriteEditableFields(contact)` — the `X-ABRELATEDNAMES` group is regenerated from the model (no hand-inserted lines)
4. Rebuilds graph + persists

### 7.13 Contact Export (`app-export.js`)

Export goes through the format adapters and supports three **scopes** — a single contact (detail panel), the current multi-select (`_selectedForExport`), or all contacts — each available as vCard, Markdown, or TSV. Bulk filenames carry a `_dateStamp()` (`YYYY-MM-DD`).

- `_exportVCF(ids, filename)` / `_exportTsv(ids, filename)` delegate via `_exportWithAdapter(adapter, ids, filename)`, which creates the adapter `Blob`, downloads it through a temporary `<a download>`, and reports the exported count.
- `_exportMarkdownScope(ids, baseName)` uses `MarkdownAdapter.serializeBundle()`. A photo-free export is a single `.md`; if any contact has a photo, the `.md` and the **externalized image files** are written together via `_saveFilesSeparately()` — the File System Access directory picker (`showDirectoryPicker`) where available, otherwise sequential downloads.
- `_downloadTsvTemplate()` downloads `TsvAdapter.templateText()` as `contacts-template.tsv` (every column in order + one worked example row).

vCard export serializes selected contacts from `rawVCard` when available and synthesizes a standard-field vCard for contacts imported from Markdown/TSV (non-company tags via `CATEGORIES`, custom fields via `X-CONTACTGRAPH-FIELD`). Markdown export serializes standard fields, typed custom fields, and preserved body content (nested objects, lists, booleans, nulls, empty strings, numeric-looking strings). TSV export emits the flat one-row-per-contact format described in §3.1.2.

### 7.14 Contact Creation

Three paths:
1. **"Create Contact" from virtual node** — calls `_createContactFromVirtual()`, generates a minimal vCard with FN and N fields
2. **"+ Add Contact" in table view** — calls `_addContactFromTable()`, same minimal vCard
3. **New name in "Add Relationship" modal** with "Create real contact entry" option

All three generate a new `id` via `parser._generateId()` and push to `this.contacts`.

### 7.15 Contact Deletion

`_deleteContact(id)` — confirms with `window.confirm()`, removes from `this.contacts`, rebuilds graph.

### 7.16 IndexedDB Session Persistence

Uses `IndexedDB` (database: `contacts-graph-db`, store: `sessions`).

`_persistSession()` — serializes the full state to a JSON object:
```js
{
  formatId: 'vcard' | 'markdown' | 'tsv',
  content: '...',       // serialized working source data
  fileLabel: '...',
  graphMode: '...',
  mainViewMode: '...',
  showInferred, showLikelyFamily, showLikelyConnections, showIsolated,
  selfContactId, activeFilters, searchQuery, contactSortMode,
  sidebarControlsCollapsed, tableSort,
}
```

`_restorePersistedSession()` — reads from IndexedDB, restores all state, triggers `_rebuildGraph()`.

`_clearPersistedSession(confirm)` — deletes the stored session; optionally confirms first.

### 7.17 Category Filter System

`_availableFilterTags(nodes)` — returns tags in a fixed order: `['family', 'company', 'virtual', 'other']` first, then alphabetically sorted hashtags.

Filter buttons are rendered by `_renderCategoryFilters()`. Active filters are stored in `_activeFilters` (a `Set`). The `family` filter is disabled unless `_selfContactId` is set. Clicking a filter updates `graph.setFilterCategories()` and re-renders the contact list.

### 7.18 "Me / Family Network" Picker

The `self-contact-select` dropdown lets the user designate a "me" contact. Used for:
1. Computing `familyConnectedIds` in the builder (BFS from `rootContactId`)
2. Enabling the `family` filter tag
3. Affecting the family-network hull in the graph

### 7.19 Table View

Activated by the "Table" button in the header. Shows a sortable table with columns: Name, Organization, Title, Emails, Phones, Birthday, Anniversary, Tags, Notes, Actions.

- Inline editing via `<input>` / `<textarea>` cells; `change` event triggers `_applyTableEdit()`
- Sort by clicking column headers (toggles asc/desc)
- Tags column is read-only (shows parsed `#hashtags`)
- Notes column has hashtag autocomplete
- Actions: "Open" (switches to graph view and opens detail panel), "Delete"

### 7.20 Bulk Normalize Modal

A rule-based find-and-replace tool. Supports multi-condition IF rules with AND/OR logic:

**Condition types:** field contains/equals/starts-with/ends-with; has phone; has email; etc.

**Action types:**
- `set` — overwrite a field with a new value
- `append` — append to a field
- `clear` — clear a field

Shows a live preview of affected contacts and a sample list before applying.

Requires the user to check a confirmation checkbox before the "Apply Rule" button is enabled.

### 7.21 Suggestion Engine

`_findRelationshipSuggestions(node)` returns an array of suggestion objects. Six suggestion types:

**Type 1 — Mutual:** A lists B, but B's card doesn't list A. Suggests adding the reciprocal.

**Type 2 — Shared child:** A and B are spouses/partners; A lists C as their child but B doesn't. Suggests adding C to B's card.

**Type 3 — Transitive (outward):** Two-hop family chains. Rules defined in `INWARD_TRANSITIONS` array:
- Via spouse/partner → shared children
- Via parent → siblings (uses `typeMapper` for gender: son→brother, daughter→sister)
- Via parent → grandparents
- Via parent → uncle/aunt (parent's siblings)
- Via child → grandchildren
- Via sibling → nephew/niece
- Via sibling → parent
- Via uncle/aunt → cousins
- Via grandparent → uncle/aunt
- Via nephew/niece → sibling
- Via cousin → uncle/aunt
- Via grandchild → child
- Via nephew/niece → more nephews/nieces
- Via grandchild → more grandchildren
- Via cousin → more cousins

**Type 4 — Reverse-parent sibling:** Scans ALL contacts for those that list the current node as a child type. Suggests those parents' other children as siblings (even if the child hasn't listed the parent back).

**Type 5 — Inbound reciprocal:** Uses a pre-built inbound reference index to find anyone listing this node but not being listed back.

**Type 6 — Likely-connections cluster peer:** When surname/hashtag clusters are visible, suggests connecting to cluster-mates.

Each suggestion has:
- `key` — deduplication string (also used for dismissal)
- `kind` — suggestion category
- `targetId`, `targetName` — contact to add the relationship to
- `relName`, `relType` — the relationship to add
- `reason` — human-readable explanation

`_applyRelationshipSuggestion()` patches the target contact's `rawVCard` (same mechanism as the modal), updates `contact.related`, and rebuilds the graph.

Dismissed suggestion keys are stored in `_dismissedSuggestions` (in-memory only, cleared on page reload).

Relationship patching must tolerate folded related-name lines, optional parameters, escaped values, and repeated display names. It prefers matching the relationship row/index before falling back to related-name text lookup. Relationship deletion removes the entire matched `itemN.*` group.

### 7.22 `_vCardEscape(str)`, line folding, and `_typeToVCardLabel(type)`

`_vCardEscape(str)` delegates to `VCardUtils.encodeValue()` and escapes backslash, semicolon, comma, and newlines. Generated vCard lines are folded through `VCardUtils.foldLines()` before being stored in `rawVCard`; folding is UTF-8 byte-aware so non-ASCII contact data remains valid.

`_typeToVCardLabel(type)` converts the canonical type string to Apple's `_$!<Label>!$_` format used in `X-ABLabel`.

### 7.23 HTML and Link Safety

Imported contacts and freeform user fields are treated as untrusted at render time.

- Custom relationship type labels must be escaped before insertion into relationship rows.
- The shared HTML escaping helper must escape `&`, `<`, `>`, `"`, and `'`.
- Contact-provided URL fields should only render as clickable links for safe external protocols such as `http:` and `https:`.
- Unsafe protocols such as `javascript:` must be displayed as text rather than as active links.

### 7.24 Light / Dark Theme (`app-theme.js`)

The two themes are pure CSS — `:root` (dark, default) and a `:root[data-theme='light']` override in `styles.css`. The mixin only flips the `data-theme` attribute on `<html>`, persists the choice to `localStorage` (`contacts-graph:theme`), and re-reads colours so the JS-built graph palette matches:

- `_applyInitialTheme()` runs before the graph is created (reads the saved theme, defaults to dark, no re-render).
- `_toggleTheme()` (header `#btn-theme-toggle`) flips dark↔light.
- `_setTheme(theme, {persist, rerender})` sets the attribute, calls `Palette.refresh()`, then `graph.refreshColors()` + `_renderLegend()`, and updates the toggle button label (which shows the theme you'll switch *to*).

---

## 8. HTML Structure (`index.html`)

Three-column layout inside `.app-body`:

```
.app
├── .app-header          — logo, import/export buttons (vCard/Markdown/TSV + TSV Template), stats, theme toggle (#btn-theme-toggle), view toggle (Graph/Table)
└── .app-body
    ├── aside.sidebar    — controls + contact list
    │   ├── .sidebar-controls
    │   │   ├── Me/Family Network picker
    │   │   ├── Filter by Tag buttons
    │   │   └── Display Options (graph mode, toggles)
    │   └── .sidebar-list
    │       ├── Search input
    │       ├── Sort dropdown
    │       ├── Export bar (hidden until selection)
    │       └── #contact-list
    ├── .graph-area      — graph or table content area
    │   ├── #graph-container  — D3 SVG rendered here
    │   ├── .table-mode       — hidden in graph view
    │   ├── .graph-legend
    │   ├── .drop-zone        — initial state overlay
    │   └── .loading-overlay
    └── aside.detail-panel   — hidden until node selected
        ├── .detail-header   — avatar, name, org, title
        ├── .detail-body
        │   ├── #detail-contact-info
        │   ├── #notes-section
        │   ├── #detail-relationships
        │   └── #suggestions-section
        └── .detail-footer   — action buttons
```

**Modals:**
- `#add-rel-modal` — Add Relationship modal
- `#bulk-normalize-modal` — Bulk Normalize modal

**Other global elements:**
- `#toast` — toast notification
- `#tag-autocomplete` — hashtag autocomplete popup (floats at caret position)

`index.html` loads only two scripts: vendored D3 as a classic `<script>` (a browser global D3 uses), then `<script type="module" src="js/app-bootstrap.js">`. The module import graph (via `app-controller.js`) pulls in everything else.

---

## 9. CSS Design System (`css/styles.css`)

### 9.1 Colour Palette (CSS Custom Properties)

`css/styles.css` is the **single source of truth for colours**. `:root` defines the dark theme; `:root[data-theme='light']` overrides the subset that needs adjusting for a light background. Two groups matter:

- **UI chrome** — `--bg`/`--bg2`/`--bg3`/`--bg4`, `--border`, `--text`/`--text2`/`--text3`, `--accent`/`--accent2`, `--success`/`--error`/`--warning`.
- **Category colours** — `--cat-*` tokens (`--cat-family`, `--cat-friend`, `--cat-work`, `--cat-neighbor`, `--cat-church`, `--cat-school`, `--cat-medical`, `--cat-company`, …) plus the graph-only `--cat-node-default`, `--cat-group`, `--cat-selected`, `--cat-edge-inferred`. These are read by `Palette` (`js/palette.js`) and consumed by both `graph.js` (node/edge colours) and the controller (`_tagColor`), so no category colour is hardcoded in JS (see §6.9).

```css
/* dark (default) — representative values */
--bg:        #0f0e17    --text:      #e4e4e4    --accent:  #7c5cbf
--cat-family: #e17055   --cat-friend: #00b894   --cat-work: #74b9ff
/* light overrides under :root[data-theme='light'] (darker node-default, amber --cat-selected, …) */
```

### 9.2 Layout

Uses CSS Grid for the three-column app layout. The sidebar has a collapse animation (CSS transition on `max-width`). The graph area fills all remaining space.

### 9.3 Key Component Classes

| Class | Description |
|---|---|
| `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-xs` | Button variants |
| `.contact-item` | Sidebar list item with `--contact-accent` CSS var |
| `.filter-btn` | Category filter button with active state |
| `.rel-item` | Relationship row in detail panel |
| `.suggestion-item` | Suggestion row in detail panel |
| `.rel-custom-input` | Freeform type text input (appears inline in suggestion and edit rows) |
| `.toggle-switch`, `.toggle-track` | Custom iOS-style toggle switches |
| `.detail-edit-grid` | Two-column grid for edit form |
| `.table-cell-input`, `.table-cell-textarea` | Table view inline edit inputs |
| `.cluster-hull` | SVG hull path elements |
| `.hull-label` | SVG text labels for hulls |
| `.graph-tooltip` | Hover tooltip (positioned absolutely on `document.body`) |
| `.toast` | Notification toast (fixed, bottom-right) |
| `.tag-autocomplete` | Hashtag dropdown (fixed, floats at caret) |

### 9.4 Responsive Behaviour

The sidebar can be collapsed via the `collapsed` class (toggles `max-width`). The detail panel occupies the right column and can be hidden. Both trigger a `window.resize` event to let D3 recalculate the simulation centre.

---

## 10. Key Algorithms and Invariants

### 10.1 rawVCard as Source of Truth (for non-editable Apple fields)

For vCard-origin contacts, `rawVCard` is preserved verbatim as the source of truth for **non-editable Apple fields** — the obscure `X-*` properties and item groups the model doesn't capture survive every edit. The **model drives the editable fields, including relationships**: every mutation calls `_rewriteEditableFields(contact)`, which keeps the non-editable lines and regenerates the editable ones (and the `X-ABRELATEDNAMES` relationship groups) from the model, then re-emits `rawVCard`. So the model and the raw card stay consistent through a single chokepoint — there is no separate per-relationship string surgery to drift out of sync. Markdown/TSV-origin contacts have no `rawVCard` (the model is the only source) and export through their adapter's standard-field serializer.

### 10.2 Positional vCard Indexing

The parser pre-extracts photos and raw blocks into positional arrays indexed by parse order. When iterating unfolded blocks, index `i` in the unfolded array always corresponds to index `i` in the raw array. This avoids the FN-collision bug where two contacts with the same display name would overwrite each other's raw block.

### 10.2.1 Escaped Delimiter Safety

Structured vCard fields must never be split on escaped delimiters. Examples:

- `N:Doe\;Smith;Jane;;;` stores family name `Doe;Smith`
- `ADR;TYPE=HOME:;;123 Main\; Apt 4;Arlington;VA;22201;USA` stores street `123 Main; Apt 4`
- `ORG:ACME\; Labs;Research` stores organization `ACME; Labs`

Type parameters support both repeated and comma-separated forms:

- `TEL;TYPE=HOME;TYPE=VOICE`
- `TEL;TYPE=HOME,VOICE`

### 10.2.2 Apple Date Item Preservation

Apple custom date item groups use `itemN.X-ABDATE` plus `itemN.X-ABLabel`. Ordinary contact rewrites regenerate anniversary from the contact model, but must preserve other date item groups rather than treating every `X-ABDATE` group as editable. This prevents losing custom date labels such as "First met" when unrelated contact fields are saved.

### 10.3 Ambiguous Name Lookups

`findContact(name)` returns `null` for ambiguous matches (two contacts with the same normalised key). This is intentional — it's better to show no match than to silently link to the wrong person. `findContacts(name)` returns all matches when you need the full list. Relationship target resolution sidesteps ambiguity entirely when a `uid` is present: `findRelationTarget(rel)` resolves by `uid` first and only falls back to name (§5.1).

### 10.4 Reciprocal Downgrade Prevention

When editing a relationship type and auto-updating the reciprocal, `_isReciprocalDowngrade(candidate, existing)` prevents overwriting a specific type (e.g. `son`) with a generic one (e.g. `child`). The generic form is only written if the existing relationship is also generic or absent.

### 10.5 Edge Deduplication

Two strategies:
- `pairSet` (Set of `id1↔id2`) — ensures at most one edge per node pair in explicit mode
- `edgeSet` (Set of `id1↔id2:type`) — for org-inferred edges, allows multiple relationship types per pair
- `_addUniqueEdge()` — for geographic mode, deduplicates by `pairKey:edgeKind`

### 10.6 Runtime Indexes

The controller and graph renderer both maintain derived indexes to avoid repeated full-array scans in interaction-heavy paths.

Controller indexes:
- `_contactById` maps real contact IDs to mutable contact objects.
- `_contactsByUid` maps vCard `UID` values to contacts for stable restore of the saved "me" contact.
- `_contactsByFn` maps normalized formatted names to contacts for duplicate detection and fallback restore. If duplicate names become common, this should be upgraded to a multi-map plus ambiguity checks.
- `_nodeById` maps current graph node IDs to graph nodes.
- `_edgesByNodeId` maps each node ID to all current incident graph edges.
- `_relatedRefsByTargetId` maps a selected target node to contacts that reference it through relationship fields.

Graph renderer indexes:
- `_nodeById` maps currently visible node IDs after filtering.
- `_edgesByNodeId` maps currently visible incident edges after filtering.

Indexes are invalidated and rebuilt after import, restore, graph rebuilds, relationship changes, contact edits, contact creation/deletion, graph mode changes, and visibility/filter changes. Detail rendering, relationship suggestions, selected-node refresh, group member rendering, graph selection highlighting, hull label placement, and node zoom should use these indexes rather than scanning `contacts`, `graphData.nodes`, or `graphData.edges`.

### 10.6 Virtual Nodes

When a contact lists a relationship with a name that doesn't resolve to any known contact, a virtual node is created with `id = 'virtual__<sanitized_name>'` and `isVirtual = true`. Virtual nodes are shown in the graph but cannot have relationships added to them directly (they have no `rawVCard`). The "Create Contact" button promotes them to real contacts.

---

## 11. Build/Development Notes

- **No bundler, but native ES modules** — the app code is plain ES modules (`package.json` has `"type":"module"`); there is no compile/bundle step.
- **Must be served over `http://`** — browsers refuse ES modules from `file://`, so run any static server and open over http (no internet needed once served), e.g. from `contacts-graph/`: `python3 -m http.server 7891` → `http://localhost:7891`.
- **D3 version** — must be D3 **v7**, vendored locally at `js/vendor/d3.v7.min.js` and loaded as a classic global script before the module entry (uses `d3.zoom()`, `d3.forceSimulation()`, `d3.polygonHull()`, `d3.drag()`)
- **No runtime dependencies** — the app needs no CDN, network, server, or package install at runtime. `npm install` pulls in dev tooling only (ESLint, Prettier).
- **Browser requirements** — ES modules, IndexedDB, FileReader API, Blob/URL.createObjectURL, CSS Grid, `localStorage`; optionally the File System Access API (`showDirectoryPicker`) for grouped Markdown+image export (falls back to downloads).
- **Tooling & CI** — `npm test` (Node's built-in `node:test`), `npm run lint` (ESLint flat config, ESM), `npm run format` / `format:check` (Prettier); GitHub Actions runs them on push. None require network access.

### 11.1 Functional Test Coverage

The automated test suite (`test/*.test.js`) imports the app's ES modules directly through `test/helpers/load-app.js`, which installs fake browser globals (`document`/`window`/`console`/`indexedDB`) on `globalThis` before each call. This lets parser, builder, serializer, adapter, and controller methods be tested without a build system or a real browser.

Fixture coverage in `test/fixtures/comprehensive.vcf`:
- normal Apple contacts
- duplicate names
- photos
- custom type labels
- preferred fields
- escaped semicolons, commas, and newlines
- relationships
- virtual contacts
- companies
- Notes hashtags
- geography

Automated coverage:
- parser import verifies all key fixture fields
- vCard import attaches a format-neutral `ContactRecord`, `customFields`, and `sourceDocuments`
- `ContactRecord` stays synchronized after legacy contact edits
- `VCardAdapter` imports and serializes through the format boundary, including selected-contact export
- `MarkdownAdapter` imports frontmatter/body contacts, preserves arbitrary typed fields, supports bundle files, and serializes Markdown output
- robust sample Markdown fixtures import as separate single-contact files and as a multi-contact bundle
- multi-file import combines supported Markdown files into one working set
- Markdown import → export → reimport preserves unknown fields, unknown nested objects, null/empty values, and Markdown body content
- vCard → Markdown and Markdown → vCard conversion preserve standard contact data
- custom fields render in the detail panel, and scalar/list custom field edits preserve unknown nested object data
- parser/serializer round-trip verifies metadata survives parse → rewrite/export → reparse
- duplicate-name ambiguity stays unresolved
- unresolved relationship names create virtual graph nodes
- saved "me" contact restore resolves through `UID`
- table edit updates Notes, hashtags, raw vCard, and searchable data
- detail edit rewrites structured fields without dropping relationship metadata
- relationship add/edit/delete persists through reparse
- bulk normalize appends to empty Notes and replaces address country values
- photo edits update serialized vCards immediately
- Notes hashtag autocomplete identifies and inserts existing tags
- contact deletion removes the contact from the working export set
- non-anniversary Apple date item groups survive detail rewrites
- custom relationship labels and unsafe hrefs are escaped/rejected in render helpers
- vCard folding respects UTF-8 byte limits without corrupting text
- non-company tags round-trip through the vCard fallback via `CATEGORIES`
- relationships resolve by UID when present and fall back to name otherwise
- a malformed vCard / Markdown / TSV record is skipped without aborting the import
- TSV parse, serialize→reparse round-trip, template shape, and tab/newline escaping (`test/tsv.test.js`)

Manual Apple Contacts round-trip coverage is defined in `docs/APPLE_CONTACTS_ROUNDTRIP_CHECKLIST.md`.

---

## 12. Extension Points

Several earlier extension targets are now **done**: the controller split into mixin modules (§7), native ES modules (§2, §11), a TSV adapter (§3.1.2), a light/dark theme (§7.24), UID-based relationship resolution (§5.1), incremental/position-preserving graph rebuilds (§6.6), and multi-file import. Remaining likely targets:

1. **Markdown re-import with photos** — importing a Markdown export back together with its externalized image files (re-attaching each `photo:` by filename) for a lossless round-trip
2. **More graph modes** — e.g. a timeline view, an org-chart layout
3. **Relationship editing from table view** — currently only accessible from the detail panel
4. **Import merging** — loading a new file replaces all contacts; merge logic would need conflict resolution
5. **Graph export** — PNG/SVG export of the current graph view
6. **Suggestions persistence** — dismissed suggestions are lost on page reload
7. **Undo/redo** — no undo support currently; mitigated by session persistence + Export All
8. **CSV** — generalize `TsvAdapter` on its delimiter (the schema/encoding already factor cleanly)
