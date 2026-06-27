# ContactGraph — Design & Implementation Specification

*Generated from live codebase review — March 2026*

---

## 1. Overview

**ContactGraph** is a single-page, client-side web application that imports Apple vCard (`.vcf`/`.vcard`) or Markdown (`.md`/`.markdown`) contact files, parses the contacts, and visualises their relationships as a force-directed graph. There is no server — everything runs in the browser.

### 1.1 Key Capabilities

| Capability | Description |
|---|---|
| Contact Import | Drag-and-drop or file-picker; parses one or more vCard/Markdown files in a single import operation |
| Graph View | D3 v7 force-directed graph, three modes (Connections, Geographic) |
| Table View | Sortable, inline-editable spreadsheet of all contacts |
| Contact Detail Panel | Read-only info + inline notes + full edit mode with photo support |
| Relationship Management | Add, edit, and delete explicit relationships; suggestions engine |
| Suggestion Engine | Six types of transitive family-network suggestions |
| Contact Export | Export all, selected subset, or a single contact back to `.vcf`; export all contacts as Markdown |
| Cluster Overlays | Convex-hull groupings (surname, hashtag, geographic) |
| Category Filters | "My Family" BFS network + hashtag/system tag filters |
| Bulk Normalize | Rule-based bulk find-and-replace across all contacts |
| Session Persistence | IndexedDB caches the full working dataset between browser sessions |

---

## 2. File Structure

```
contacts-graph/
├── index.html                   # App shell + modals
├── css/
│   └── styles.css               # Dark-theme design system (1527 lines)
├── docs/
│   └── APPLE_CONTACTS_ROUNDTRIP_CHECKLIST.md
├── test/
│   ├── fixtures/
│   │   └── comprehensive.vcf
│   ├── helpers/
│   │   └── load-app.cjs
│   ├── interactions-regression.test.js
│   └── parser-roundtrip.test.js
└── js/
    ├── vendor/
    │   └── d3.v7.min.js         # Vendored D3 v7 browser bundle for offline use
    ├── vcard-utils.js           # Shared vCard parse/write helpers
    ├── contact-record.js        # Format-neutral contact record helpers
    ├── vcf-parser.js            # VCF/vCard parser (384 lines)
    ├── vcard-adapter.js         # vCard import/export adapter boundary
    ├── markdown-adapter.js      # Markdown frontmatter/body import/export adapter
    ├── relationship-builder.js  # Graph data builder (1053 lines)
    ├── graph.js                 # D3 renderer (805 lines)
    ├── app.js                   # Core app controller / orchestrator
    ├── app-notes.js             # Notes inline-save and hashtag autocomplete methods
    └── app-bootstrap.js         # Browser startup and modal/global event wiring
```

All scripts are loaded via `<script>` tags in `index.html` with cache-busting query params (`?v=20260315c`). D3 v7 is vendored locally at `js/vendor/d3.v7.min.js` and loaded before the app scripts. The runtime must not depend on CDN or network access.

Load order is critical: `d3.v7.min.js` → `vcard-utils.js` → `contact-record.js` → `vcf-parser.js` → `vcard-adapter.js` → `markdown-adapter.js` → `relationship-builder.js` → `graph.js` → `app.js` → `app-notes.js` → `app-bootstrap.js`.

---

## 3. Core Data Model

### 3.1 Contact (output of VCFParser)

```js
{
  id: 'c_xxxxxxxx',         // random base-36 ID generated at parse time
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

**Important invariant:** `rawVCard` is the source of truth for export. Every field mutation in the app must also patch `rawVCard` via `_rewriteEditableFields()`.

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

5. **Parse each block** via `_parseVCard()` and attach the corresponding raw block + photo by positional index.

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
| `PHOTO` | Skipped here; handled by positional array |

After the line loop, processes **item groups** (`item1.X-ABRELATEDNAMES` + `item1.X-ABLabel`) to populate `contact.related`.

### 4.3 Relationship Type Normalisation

`_normalizeRelType(label)` strips Apple's `_$!<Label>!$_` wrapper and maps common strings to canonical types. All canonical types use no hyphens (e.g. `stepson`, not `step-son`). Full map is in the source — covers all gendered variants (grandmother, grandfather, uncle, aunt, nephew, niece, stepmother, stepfather, stepson, stepdaughter, etc.).

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

**Constructor:** `new RelationshipBuilder(contacts)` — builds the name index immediately.

### 5.1 Name Index

`_buildNameIndex(contacts)` creates a `Map<string, Contact[]>`. For each contact it adds four lookup keys:
1. Exact FN (lowercase)
2. FN with nickname tokens removed (`"quoted"` parts stripped)
3. Last, First format
4. First Last only (drops middle names for 3+ word names)

When a key maps to 2+ contacts, a console warning fires (ambiguous). `findContact(name)` returns `null` for ambiguous keys. `findContacts(name)` returns the full array.

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
| `_edgeCategory(type)` | Maps type string to family/friend/work/neighbor/other |
| `_friendlyType(type)` | Maps internal type to title-case display string |
| `_isValidReciprocal(a, b)` | Checks if two types form a valid reciprocal pair |
| `getStats(nodes, edges)` | Returns totalContacts, visibleNodes, visibleGroups, edges, categories |

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

### 6.7 Convex Hull Rendering

`_hullPath(hull, nodes, nodeRadius)` computes the convex hull of four corner points expanded by `r+12` around each member node, using `d3.polygonHull()`. Returns an SVG path string.

Hull labels are positioned at the top-centre of the bounding box and scale inversely with zoom (so they appear at a constant visual size).

### 6.8 Selection / Highlighting

On node click: dims all non-connected nodes to opacity 0.15, dims non-incident edges to opacity 0.05, shows the gold selection ring. Emits `nodeSelect` event.

`highlightContact(id)` — selects without emitting (used from contact list clicks) then zooms to the node.

`resetView()` — animated transition to `d3.zoomIdentity`.

### 6.9 Colour Scheme

**Node colours:**
```
family: #e17055   friend: #00b894   work: #74b9ff
neighbor: #fdcb6e church: #a29bfe   school: #fd79a8
medical: #55efc4  company: #636e72  virtual: #b2bec3
other: #dfe6e9    group: #8e9aaf    selected: #ffd32a
```

**Edge colours:**
```
family: #e17055  friend: #00b894  work: #74b9ff
neighbor: #fdcb6e  other: #636e72
```

### 6.10 `getLegend(mode)` — Legend Data

Returns an array of legend item descriptors appropriate for the current mode. App uses this to render the graph legend.

---

## 7. App Controller (`js/app.js`, `js/app-notes.js`, `js/app-bootstrap.js`)

**Class:** `ContactRelationshipApp`

**Instantiation:** `new ContactRelationshipApp()` in `DOMContentLoaded` from `app-bootstrap.js` → stored as `window.app`.

`app.js` owns the core `ContactRelationshipApp` class. `app-notes.js` extends `ContactRelationshipApp.prototype` with Notes inline-save and hashtag autocomplete methods. `app-bootstrap.js` owns browser startup and modal/global DOM wiring. This split is intentionally mechanical: it changes file boundaries without changing behavior or state ownership.

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

### 7.8 `_rewriteEditableFields(contact)`

Patches `contact.rawVCard` in-place with current contact field values. This is how in-memory edits persist to the exportable VCF. The method unfolds the existing card for stable patching, preserves unknown non-editable simple properties and non-editable item groups where practical, preserves non-anniversary `itemN.X-ABDATE` groups such as custom Apple dates, regenerates editable fields from the contact model, and folds generated output using `VCardUtils.foldLines()`.

### 7.9 Inline Relationship Type Editing

`_startInlineRelEdit(item, contact, relIdx, node)` — called when the ✎ button is clicked on a relationship item.

Replaces the display row with an inline editor containing:
- A `<select>` of all known types plus "Custom…"
- A freeform text input (shown when "Custom…" is selected)
- Save and Cancel buttons

On save:
1. Updates `contact.related[relIdx].type` and `.rawType`
2. Patches `contact.rawVCard` via `_replaceItemProperty()` — finds the `item{n}.X-ABLabel` line for this relationship and replaces its value
3. Checks for a reciprocal relationship in the target contact:
   - Finds the target contact via `findContact(rel.name)`
   - Computes `_reciprocalType(newType)`
   - Checks `_isReciprocalDowngrade(candidate, existing)` — if the computed reciprocal is a generic fallback and the existing type is already more specific, does NOT overwrite
   - If update proceeds, patches the target contact's `rawVCard` and `related` array the same way
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
1. Determines `relName` and `relType`
2. Finds highest `item{n}` prefix in `contact.rawVCard`
3. Appends two lines before `END:VCARD`:
   ```
   item{n+1}.X-ABRELATEDNAMES:{escaped name}
   item{n+1}.X-ABLabel:{vcard label}
   ```
4. Pushes to `contact.related`
5. Rebuilds graph + persists

### 7.13 Contact Export

Export goes through format adapters.

- `_exportVCF(idSet, filename)` delegates to `VCardAdapter`.
- `_exportMarkdown(idSet, filename)` delegates to `MarkdownAdapter`.
- `_exportWithAdapter(adapter, idSet, filename)` creates the adapter `Blob`, clicks a temporary `<a download>` element, and reports the exported count.

vCard export serializes selected contacts from `rawVCard` when available and can synthesize a standard-field vCard for contacts imported from Markdown. Markdown export serializes standard fields, typed custom fields, and preserved Markdown body content, including semantic custom values such as nested objects, lists, booleans, nulls, empty strings, and numeric-looking strings.

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
  formatId: 'vcard' | 'markdown',
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

---

## 8. HTML Structure (`index.html`)

Three-column layout inside `.app-body`:

```
.app
├── .app-header          — logo, import/export buttons, stats, view toggle (Graph/Table)
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

---

## 9. CSS Design System (`css/styles.css`)

### 9.1 Colour Palette (CSS Custom Properties)

```css
--bg:        #0f0e17    /* page background */
--bg2:       #1a1a2e    /* sidebar, panel */
--bg3:       #16213e    /* inputs, cards */
--bg4:       #0f3460    /* hover states */
--border:    #2d2d44
--text:      #e4e4e4
--text2:     #a0a0b8
--text3:     #6b6b8a
--accent:    #7c5cbf    /* purple primary */
--accent2:   #9b7fdb
--success:   #00b894
--error:     #d63031
--warning:   #fdcb6e
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

### 10.1 rawVCard as Source of Truth

Every mutation to a contact's fields MUST also patch `contact.rawVCard`. This is done via `_rewriteEditableFields(contact)`. If `rawVCard` is absent, the contact cannot be exported. The app guards against this by checking `contact.rawVCard` before any export or VCF patch operation.

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

`findContact(name)` returns `null` for ambiguous matches (two contacts with the same normalised key). This is intentional — it's better to show no match than to silently link to the wrong person. `findContacts(name)` returns all matches when you need the full list.

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

- **No build step** — vanilla HTML/CSS/JS, no bundler required
- **Local development** — open `index.html` directly in a browser; no server needed (browser security policies allow `file://` access for this app's features)
- **Cache busting** — all script/CSS `src` URLs include `?v=YYYYMMDD` query params; update these when deploying changes
- **D3 version** — must be D3 **v7**, vendored locally at `js/vendor/d3.v7.min.js` for offline use (uses `d3.zoom()`, `d3.forceSimulation()`, `d3.polygonHull()`, `d3.drag()`)
- **Offline runtime** — no CDN, network, server, package-manager, or extension dependency is required after the app files are present locally
- **Browser requirements** — IndexedDB, FileReader API, Blob/URL.createObjectURL, CSS Grid, modern JS (ES2020+)
- **Automated tests** — run `npm test` from the repository root; tests use Node's built-in `node:test` runner and do not require network access

### 11.1 Functional Test Coverage

The automated test suite loads the browser-oriented JavaScript files into a Node VM with a small DOM shim. This allows parser, builder, serializer, and controller methods to be tested without adding a build system or browser-only test dependency.

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

Manual Apple Contacts round-trip coverage is defined in `docs/APPLE_CONTACTS_ROUNDTRIP_CHECKLIST.md`.

---

## 12. Extension Points

The following areas are most likely targets for future work:

1. **More graph modes** — e.g. a timeline view, an org-chart layout
2. **Relationship editing from table view** — currently only accessible from detail panel
3. **Import merging** — currently loading a new file replaces all contacts; merge logic would need conflict resolution
4. **Multi-file support** — allow loading multiple VCF files into one working set
5. **Graph export** — PNG/SVG export of the current graph view
6. **Suggestions persistence** — dismissed suggestions are lost on page reload
7. **Undo/redo** — no undo support currently; mitigated by session persistence + Export All
