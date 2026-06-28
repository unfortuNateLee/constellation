# Constellation Design Spec

## 1. Purpose

This document defines the current product behavior, architecture, data contracts, and acceptance criteria for the `constellation` tool so another developer can reimplement it without relying on the existing source code structure.

The application is a browser-only contact explorer and editor for contact data stored in Apple-style vCards, Markdown contact files, or flat TSV spreadsheets. It imports `.vcf`, `.vcard`, `.md`, `.markdown`, and `.tsv` files, builds a relationship graph from explicit and inferred data, lets the user edit contacts and relationships in-browser, and exports edited data back out (vCard, Markdown, or TSV).

## 2. Product Goals

- Run entirely in the browser with no server dependency.
- Preserve Apple Contacts compatibility as closely as possible.
- Support offline import, editing, export, and session restore.
- Treat round-trip fidelity as a core requirement.
- Make contact relationships explorable visually and editable directly.
- Support multiple graph views over the same contact data.
- Support unresolved relationship references through virtual contacts.
- Let the user define a "me" contact and derive a family network from explicit relationship connectivity.

## 3. Non-Goals

- Direct integration with the macOS Contacts database.
- Cloud sync or multi-user collaboration.
- Full vCard spec coverage for every rare property.
- Lossless preservation of every unknown Apple/private field during major structured rewrites, beyond best-effort retention.

## 4. Runtime and Delivery Model

- Delivery model: static frontend app, no build step.
- Module system: native ES modules (no bundler). `index.html` loads vendored D3 as a classic `<script>`, then `js/app-bootstrap.js` as `<script type="module">`; the static `import` graph resolves every other module. `package.json` declares `"type": "module"`.
- Runtime: standard desktop browser.
- Backend: none.
- Persistence: browser storage only.
- Primary local data source: imported `.vcf`, `.md`, or `.tsv` file.
- Session restore storage: IndexedDB.
- Network dependency: none at runtime. Third-party browser libraries must be vendored locally with the app.
- D3 is loaded from `js/vendor/d3.v7.min.js`, not from a CDN, so the app runs with no internet connection.
- Because it uses ES modules, the app **must be served over `http://`** (e.g. `python3 -m http.server` from the repo root); browsers will not load ES modules from `file://`. Serving locally still requires no network access beyond localhost.

## 5. High-Level User Flows

### 5.1 Import

1. User loads a `.vcf`, `.md`, or `.tsv` file.
2. User may select or drop one file or multiple files in one operation.
3. App chooses the matching format adapter for each file (by extension), parses all contacts, and builds graph data.
4. Sidebar list, filters, graph, and detail panel become interactive.
5. Imported data becomes the current working set.

### 5.2 Explore

1. User searches, filters, pans/zooms graph, and selects nodes.
2. User can switch graph views without reimporting contacts.
3. Selecting a node opens the detail panel.
4. Detail panel shows contact info, relationship sections, inferred links, suggestions, or group summaries depending on the selected node.

### 5.2.2 Workspace Modes

The app must support at least these workspace modes:

- `Graph`
  - the default visual network workspace
- `Table`
  - a spreadsheet/database-like workspace for faster bulk inspection and editing
  - uses the same underlying contact dataset as Graph mode
  - shares the current search query and tag filters

### 5.2.1 Graph Views

The app must support at least these graph views:

- `Connections`
  - current explicit relationship graph
  - may optionally cluster by shared organization
  - may optionally overlay likely family groupings based on shared family / last name
  - may optionally overlay likely connections based on shared hashtags from notes
  - only creates a surname cluster when 2 or more contacts share that family name
  - only creates a hashtag cluster when 2 or more contacts share that hashtag
  - must make it visually clear these are likely / unconfirmed groupings rather than explicit relationship-field links
  - must continue to show explicit relationship edges as confirmed links
- `Geographic Relationships`
  - clusters contacts by preferred address
  - address precedence:
    - `HOME`
    - `WORK`
    - any other available address
  - hierarchy order:
    - country
    - state / province
    - city
    - street

### 5.3 Edit Contact

1. User clicks `Edit Details`.
2. Contact fields become editable.
3. Relationship items may be edited inline.
4. User saves changes.
5. In-memory contact model and backing `rawVCard` are updated.
6. Graph and list refresh immediately.

### 5.4 Edit Relationships

1. User edits an existing relationship or adds a new one.
2. User may choose an existing contact or type a freeform name.
3. App updates relationship data and patches the correct Apple `itemN` vCard lines.
4. Changes persist into export and session restore.

### 5.5 Export

1. User exports a single contact, the current multi-select, or the full dataset, in any of three formats (vCard, Markdown, TSV).
2. vCard export is generated from current `rawVCard` blocks when available, or from standard contact fields for non-vCard imports.
3. Markdown export is generated from current contact records, standard fields, custom fields, and preserved Markdown body content; embedded photos are written as separate image files alongside the `.md`.
4. TSV export writes a flat tab-separated table; a "TSV Template" action downloads a blank, column-labeled template with a worked example row.
5. Bulk (multi-contact) export filenames carry the date.

### 5.6 Restore Last Session

1. User reloads the page or reopens the app.
2. User clicks `Restore Last`.
3. App reloads the last saved working source data plus saved UI state.

### 5.7 Switch Theme

1. User toggles the theme control in the header.
2. App switches between dark (default) and light themes and recolors the graph immediately.
3. The choice persists across reloads (see §16.3).

## 6. Core Functional Requirements

### 6.1 Import and Parse

The app must:

- Accept Apple Contacts-compatible `.vcf` files.
- Accept Markdown contact files with YAML-style frontmatter.
- Accept flat TSV (`.tsv`) contact spreadsheets.
- Accept multiple supported files in one import operation and combine their contacts into one working set.
- Parse multiple `BEGIN:VCARD` / `END:VCARD` blocks.
- Preserve per-contact raw card text for later rewrite/export.
- Correctly unfold folded vCard lines.
- Parse Apple grouped `itemN` properties.
- Preserve or reconstruct photos.
- Support contacts that have `N:` even if `FN:` is missing.
- Assign each contact a **deterministic, stable id** derived from its `UID` (or `FN` when no UID), with an occurrence suffix to keep duplicates distinct, so ids are identical across reparses (see §10 and `ContactRecord.assignStableId`). Ids must not be random.
- Isolate per-record parse failures: a single malformed record is skipped with a console warning and the remaining records still import (see §17).

### 6.2 Contact Fields Supported

The editable contact model must support at minimum:

- Display name (`FN`)
- Structured name parts from `N`
  - given / first
  - additional / middle
  - family / last
  - prefix
  - suffix
- organization
- title
- birthday
- anniversary
- notes
- emails
- phones
- addresses
- websites
- photo
- Apple related names
- `X-ABSHOWAS:COMPANY`

### 6.3 Relationship Graph

The app must build graph nodes and edges from:

- Explicit Apple related-name relationships.
- Optional inferred org-based coworker links.
- Virtual nodes for unresolved related names.
- Mode-specific group nodes for non-default graph views when needed.

The graph must support:

- zoom and pan
- node selection
- immediate visual update after edit
- full contact names as labels
- photo rendering when available
- graph view switching
- cluster hulls for grouped graph views
- large cluster-hull labels that identify the grouping meaning
- cluster-hull labels that remain legible even when zoomed out significantly

### 6.4 Filtering

The app must support:

- text search
- contact-list sort mode:
  - `First Last`
  - `Last, First`
  - rendered as an inline label/control row in the sidebar
- graph view selection
- toggle organization clustering on/off
- toggle surname clustering on/off
- toggle hashtag clustering on/off
- toggle isolated contacts on/off
- multi-tag filtering
- special system filters:
  - `My Family`
  - `Company`
  - `Virtual`
  - `None`
- dynamic hashtag filters derived from hashtags found in contact notes

### 6.5 Table Mode

The table workspace must support:

- switching between graph and table without reimporting contacts
- using the current search query and active tag filters
- sortable columns
- inline editing of core scalar fields
- inline structured editing of emails, phones, websites, and addresses
- preservation of multi-value metadata while editing in table mode:
  - built-in type labels
  - custom type labels
  - preferred status
  - hidden/default vCard types such as `INTERNET`, `VOICE`, and `PREF`
- inline editing of notes
- add-contact action
- delete-contact action
- open-contact action to jump back into graph/detail workflows

The current implementation edits these columns directly in table mode:

- name
- organization
- title
- emails
- phones
- websites
- addresses
- birthday
- anniversary
- notes

Tags are shown as a derived read-only column from note hashtags.

### 6.6 Session Persistence

The app must persist and restore:

- current edited working source data and source format
- selected “me” contact
- organization/likely-family/likely-connections/isolated toggle state
- contact-list sort mode
- graph view
- workspace mode (graph or table)
- enough information to reconstruct the current dataset after reload

## 7. Information Architecture

## 7.1 Main Layout

- Header bar
- Left sidebar
- Main workspace
  - Graph mode
  - Table mode
- Right detail panel

## 7.2 Header

Expected controls (consolidated into dropdown menus to keep the bar uncluttered):

- **Import ▾** menu — "Import vCard" (`.vcf`), "Import MD (coming soon)" (placeholder; shows a "coming soon" toast, no import yet), "Import TSV" (`.tsv`), and "Download TSV Template"
- **Export All ▾** menu (shown once contacts are loaded) — "Export All as vCard / Markdown / TSV"
- **Bulk Normalize** (rule-based multi-contact edit)
- **Session ▾** menu — "Restore Last Session" + "Clear Saved Session"; the whole menu is disabled when no saved session exists
- light/dark theme toggle
- **Focus on Me** — centers the graph on AND selects/opens the chosen "me" contact. Disabled (grayed, unclickable) when no "me" contact is chosen or it is not in the current graph. (There is no "reset to whole graph" fallback.)
- **graph/table** view shown as a single segmented toggle (selecting one deselects the other)
- compact stats summary (contacts / visible / explicit / connections)

Dropdown menus are a shared popover component: clicking the trigger opens a list of actions; it closes on selection, outside click, or Escape.

## 7.3 Sidebar

Expected structure:

- left controls column (each titled section — "Me / Family Network", "Filter by Tag", "Display Options" — is **collapsible** by clicking its title; a chevron indicates state):
  - “me” selector / family network selector
  - category/tag filters
  - graph view selector
  - graph visibility toggles
- right contacts column:
  - search
  - contact-list header
  - contact-list sort control
  - **Export Selected ▾** menu (vCard / Markdown / TSV) + a Clear button, shown when one or more contacts are selected for export
  - contact list

The left controls column should be collapsible independently.

- collapsing it hides the controls column against the left window edge
- the right contacts column remains visible
- collapsing it frees more horizontal space for the graph canvas
- the collapsed/expanded state should persist with session restore

When no contacts are loaded, the graph area shows an **empty-state onboarding** panel ("Import to get started", drag-and-drop hint, and a "Choose File…" button). The graph **legend** overlay is collapsible by clicking its title.

The contact list must support two coupled display/sort modes:

- `First Last`
  - sort primarily by the standard display name
  - display names in normal display-name format
- `Last, First`
  - sort primarily by structured family name, then given name
  - display names in `Last, First` format when structured name parts are available
  - gracefully fall back to the normal display name when structured parts are incomplete

## 7.4 Detail Panel

Expected sections:

- header with photo/avatar and identity summary, plus a "center graph on this contact" button and a close button
- editable contact details — in read mode each field shows its **label above the value** (label as a small caption, then the value)
- notes
- `Relationships` — a **collapsible** master section whose body nests, in order:
  - the contact's own relationships
  - `Referenced in Others' Cards` — a **collapsible** subsection (with a count badge)
  - `From "<org>" (inferred)` when applicable
  - `Suggested Additions` — a **collapsible** subsection (with a count badge)
- footer actions — including a single **Export Contact ▾** menu (vCard / Markdown / TSV)

The outer "Connections" or "Relationship Network" heading is not required and should be omitted.

The inferred subsection shows the first several inferred colleagues and a "+ N more" affordance that is a **clickable link** revealing the remaining entries in place.

Collapse state for the `Relationships` master section and the `Referenced in Others' Cards` and `Suggested Additions` subsections persists across contact re-selection within a session.

## 8. Data Model

## 8.1 Parsed Contact Contract

Each parsed contact should support a model equivalent to:

```ts
type StructuredName = {
  family: string
  given: string
  additional: string
  prefix: string
  suffix: string
}

type LabeledValue = {
  value: string
  types: string[]
  isPreferred: boolean
}

type AddressValue = {
  street: string
  city: string
  state: string
  postalCode: string
  country: string
  poBox?: string
  extended?: string
  types: string[]
  isPreferred: boolean
}

type RelatedValue = {
  name: string
  type: string
  rawType?: string
}

type Contact = {
  id: string
  uid?: string
  fn: string
  name: StructuredName
  org: string
  title: string
  isCompany: boolean
  emails: LabeledValue[]
  phones: LabeledValue[]
  urls: LabeledValue[]
  addresses: AddressValue[]
  birthday?: string
  anniversary?: string
  notes: string
  related: RelatedValue[]
  photo?: string
  tags: string[]
  customFields: Record<string, TypedField>
  sourceDocuments: SourceDocument[]
  record: ContactRecord
  rawVCard: string
}
```

Phase 1 of multi-format support keeps this legacy contact shape as the app-facing model, but every real contact should also carry a format-neutral `ContactRecord` through `contact.record`. Existing graph, detail, table, and vCard code may continue reading the legacy fields directly while new import/export adapters target `ContactRecord`.

## 8.1.1 Format-Neutral ContactRecord Contract

```ts
type TypedField = {
  type: 'string' | 'number' | 'boolean' | 'date' | 'list' | 'object' | 'markdown' | 'unknown' | string
  value: unknown
  label?: string
  metadata?: Record<string, unknown>
}

type SourceDocument = {
  format: 'vcard' | 'markdown' | string
  raw: string
  index?: number | null
  dirty: boolean
}

type ContactRecord = {
  schema: 'constellation.contact'
  version: 1
  id: string
  uid?: string | null
  displayName: string
  standard: {
    fn: string
    name: StructuredName
    org: string
    title: string
    isCompany: boolean
    emails: LabeledValue[]
    phones: LabeledValue[]
    urls: LabeledValue[]
    addresses: AddressValue[]
    birthday?: string | null
    anniversary?: string | null
    notes: string[]
    related: RelatedValue[]
    photo?: string | null
    tags: string[]
    noteTags: string[]
  }
  fields: Record<string, TypedField>
  sourceDocuments: SourceDocument[]
}
```

`fields` is the semantic-lossless extension point for arbitrary imported Markdown fields and future non-vCard data. Unknown fields must remain attached to the contact even when the current UI does not understand or edit them.

`sourceDocuments` records the original backing representation. For vCard imports this contains the raw vCard block. For future Markdown imports it should contain the normalized source Markdown or the parsed frontmatter/body representation needed by the Markdown adapter.

Whenever legacy contact fields or `rawVCard` change, the attached `ContactRecord` must be refreshed so `record.standard`, `record.fields`, and `record.sourceDocuments` stay synchronized.

## 8.1.2 Contact Format Adapter Contract

File formats should enter and leave the app through small adapters rather than directly through UI/controller code.

```ts
type ContactFormatAdapter = {
  id: string
  label: string
  extensions: string[]
  mimeType: string
  canImportFile(file: File | { name: string }): boolean
  parse(text: string, options?: object): Contact[]
  serialize(contacts: Contact[], ids?: Set<string> | string[] | null): string
  exportBlob(contacts: Contact[], ids?: Set<string> | string[] | null): Blob | null
}
```

The current implementations are:

- `VCardAdapter`
  - delegates parsing to `VCFParser`
  - serializes from current `rawVCard` blocks, with a standard-field fallback for contacts imported from a non-vCard format
  - the fallback round-trips non-`company` tags via `CATEGORIES` and arbitrary custom fields via an `X-CONSTELLATION-FIELD` property
  - keeps the existing app-facing contact model stable
- `MarkdownAdapter`
  - parses YAML-style frontmatter plus Markdown body content
  - maps known fields into the legacy app-facing contact model
  - preserves unknown top-level and `fields` values as typed `customFields`
  - serializes contacts as one Markdown document or a delimiter-separated Markdown bundle, externalizing photos as separate image files (see §13.4)
- `TsvAdapter`
  - parses a flat tab-separated table (one contact per row) into the contact model
  - serializes the selected contacts back to TSV and provides a downloadable template
  - intentionally simplified for spreadsheet editing; see §8.1.4

Future formats should be implemented as sibling adapters rather than branching format-specific behavior through the controller. The controller picks an adapter for an imported file by extension (`canImportFile`) and never branches on format itself.

### 8.1.3 Markdown Contact Format

Markdown contacts use YAML-style frontmatter for structured data and the Markdown body for long-form human notes or narrative content.

```md
---
constellation: 1
uid: jane-md
fn: Jane Markdown
name:
  given: Jane
  family: Markdown
emails:
  - value: jane@example.com
    types: [HOME, INTERNET]
related:
  - uid: john-md
    name: John Markdown
    type: spouse
fields:
  favorite_color:
    type: color
    value: "#3366cc"
emergency_priority: 2
---
# Notes

Markdown body #neighbor
```

Known frontmatter keys map into standard contact fields. Unknown top-level keys and all entries under `fields` become typed custom fields. The Markdown body is preserved in `customFields.markdown_body` with `type: markdown`; when no explicit `notes` frontmatter is present, the body also populates the app-facing `notes` field so search, hashtags, and graph filters can use it.

Multiple contacts may be stored in one `.md` bundle using:

```md
<!-- CONSTELLATION:CONTACT -->
```

as the document delimiter.

### 8.1.4 TSV Contact Format

TSV is a flat, spreadsheet-friendly format for bulk editing. One contact per row; the first non-empty line is a header row that names the columns. The column order is fixed (`TsvAdapter.COLUMNS`):

```text
uid  prefix  first  middle  last  suffix  display_name  organization  title
is_company  emails  phones  street  city  state  zip  country  address_type
birthday  anniversary  urls  relationships  tags  notes
```

Encoding rules:

- Multi-valued fields (`emails`, `phones`, `urls`, `relationships`) are a `' | '`-joined list. Each item may carry a type in brackets, e.g. `[home] jane@x.com | [work] jane@y.com`; for relationships the bracket is the relationship type and the value is the target name, e.g. `[spouse] John Doe | [child] Sam`.
- A single address is spread across the `street`/`city`/`state`/`zip`/`country`/`address_type` columns. On export the preferred (home > work > first) address is written.
- `is_company` is `TRUE`/`FALSE` (truthy import accepts `true`/`yes`/`1`).
- `tags` is a `' | '`-joined list; `notes` carries hashtags, which regenerate the note-tag filters on import.
- Tabs and newlines inside any value are backslash-escaped so each contact stays on one physical row.

TSV is intentionally lossy relative to vCard/Markdown: one address per contact, a single primary type per value, and no photo. vCard and Markdown remain the lossless round-trip formats. A "TSV Template" action downloads the header row plus one worked example row to fill in.

## 8.2 Graph Node Contract

```ts
type GraphNode = {
  id: string
  label: string
  category: string
  filterTags: string[]
  isVirtual: boolean
  isGroupNode?: boolean
  groupKind?: string
  groupDepth?: number
  memberIds?: string[]
  inferredOnly?: boolean
  photo?: string
  contact?: Contact
}
```

## 8.3 Edge Contract

```ts
type GraphEdge = {
  source: string
  target: string
  type: string
  rawType?: string
  label: string
  reverseLabel?: string
  inferred: boolean
  category: string
  org?: string
  edgeKind?: string
  confidence?: number
  isConfirmed?: boolean
}
```

## 8.4 Graph Hull Contract

```ts
type GraphHull = {
  id: string
  label: string
  memberIds: string[]
  kind: string
  depth?: number
  color?: string
}
```

## 9. Parsing Specification

### 9.1 Supported vCard Properties

The parser must read at least:

- `FN`
- `N`
- `UID`
- `ORG`
- `TITLE`
- `EMAIL`
- `TEL`
- `ADR`
- `URL`
- `NOTE`
- `BDAY`
- `PHOTO`
- `X-ABSHOWAS`
- `X-ABRELATEDNAMES`
- `X-ABLabel`
- `X-ABDATE`
- `CATEGORIES` (round-trips non-`company` tags)
- `X-CONSTELLATION-FIELD` (round-trips arbitrary typed custom fields for contacts that originated in a non-vCard format)

### 9.2 Structured Names

Rules:

- Parse `N` into five structured fields.
- Split `N` on unescaped semicolons only.
- Preserve escaped semicolons inside name parts, for example `N:Doe\;Smith;Jane;;;` parses family name as `Doe;Smith`.
- Parse `FN` as display name.
- If `FN` is absent, synthesize display name from the structured name fields.
- Do not rely on token-splitting `FN` to recreate `N` except as a last-resort fallback for newly created contacts.

### 9.3 Multi-Value Entries

For emails, phones, addresses, and URLs:

- Parse Apple `itemN` grouping.
- Parse and normalize type labels.
- Support repeated `TYPE=` parameters, for example `TEL;TYPE=HOME;TYPE=VOICE`.
- Support comma-separated `TYPE` values, for example `TEL;TYPE=HOME,VOICE`.
- Treat bare legacy type parameters such as `;HOME` as type labels.
- Preserve custom types when present.
- Preserve preferred status.
- Split `ADR` on unescaped semicolons only so escaped semicolons inside street/address fields are preserved.
- For `ORG`, use the first unescaped semicolon-delimited organization component as the primary organization while preserving escaped semicolons inside the value.

### 9.4 Internal Type Handling

The UI must hide these internal/default types from the editable visible label field:

- Emails: `INTERNET`, `PREF`
- Phones: `VOICE`, `PREF`
- Addresses: `PREF`
- URLs: `PREF`

These hidden types must still be reintroduced during serialization where needed.

### 9.5 Notes

- Treat notes as editable plain text.
- Preserve newlines.
- Best-effort rewrite is acceptable.

### 9.6 Photos

- Support inline vCard photos.
- Preserve or rewrite photo as a data-backed vCard field.
- Show photo immediately in detail panel and graph after edit.

### 9.7 Shared vCard Utility Semantics

Parsing and writing must use one shared set of vCard helper rules so import and export stay symmetric:

- unfold folded content lines by removing CRLF/LF followed by space or tab
- locate the property/value separator at the first colon that is not inside a quoted parameter
- split property parameters on unquoted semicolons
- split structured values such as `N` and `ADR` on unescaped semicolons
- decode escaped value characters:
  - `\n` and `\N` become a newline
  - `\,` becomes comma
  - `\;` becomes semicolon
  - `\\` becomes backslash
- encode exported values by escaping backslash, semicolon, comma, and newlines
- fold generated content lines to vCard-safe continuation lines before storing them in `rawVCard`
  - folding must respect the vCard 75-octet limit, not just JavaScript character count
  - folding must not split multibyte UTF-8 characters
- use CRLF line endings for generated vCard output

## 10. Relationship Resolution Rules

### 10.1 Explicit Relationships

Relationships are based on Apple related-name fields.

Each outgoing related-name entry belongs to the contact whose card contains it.

A relationship target is resolved **UID-first** (`RelationshipBuilder.findRelationTarget`):

1. If the relationship entry carries a `uid` and a contact with that UID exists, resolve to it. This is exact and rename-proof; Markdown and TSV relationships can carry a `uid`, and the add-relationship flow stores the target's UID when the target is an existing contact.
2. Otherwise fall back to name matching, subject to the duplicate-name rule below.
3. If neither resolves, the target becomes a virtual node.

### 10.2 Duplicate Names

Name collisions must never silently resolve to a single contact.

Required behavior:

- maintain a name index that can return multiple matches
- only auto-resolve when exactly one real contact matches
- otherwise treat the relationship target as ambiguous/unresolved
- prefer creating or keeping a virtual node over linking to the wrong real person

### 10.3 Virtual Contacts

Virtual contacts represent unresolved names referenced by explicit relationships.

They must:

- appear in graph and details
- be distinguishable from real contacts
- support conversion into a new real contact

### 10.4 Family Filter

`My Family` is not defined as “has a family-type relationship.”

It is defined as:

- choose one real contact as “me”
- construct an undirected graph of explicit relationship edges only
- compute the connected component containing “me”
- every node in that component receives the `family` filter tag

Implications:

- inferred org edges do not affect family membership
- a person may have family-type labels and still not be in the `My Family` filter
- any explicit relationship type can contribute to connectedness

## 11. Category and Filter Model

There are two different concepts:

- primary category for styling
- filter tags for filtering

### 11.1 Primary Category

Only one primary category is chosen for display styling.

Current implementation uses a simplified styling model:

1. virtual
2. company
3. other

### 11.2 Filter Tags

A node may have multiple filter tags simultaneously.

Both the graph and sidebar contact list must use the same filter-tag semantics.

The sidebar contact list should visually reflect a contact's active filter tags:

- system tags use fixed app colors
- note hashtags use stable deterministic colors
- multi-tag contacts may display a blended or multi-color treatment

Category and tag colors have a **single source of truth**: the CSS `--cat-*` custom properties in `css/styles.css`. The `Palette` module (`js/palette.js`) reads them once via `getComputedStyle` (cached) and both the graph renderer and the sidebar consume `Palette` rather than hardcoding colors. Because the palette is CSS-driven, switching theme (§16.3) recolors everything by calling `Palette.refresh()` and re-reading the tokens.

Filter tags come from two sources:

- system tags:
  - `family` (`My Family`)
  - `company`
  - `virtual`
  - `other` (`None`)
- note hashtags parsed from the contact's notes

Hashtag normalization rules:

- case-insensitive
- stored in lowercase
- leading `#` removed internally
- deduplicated per contact

## 12. Editing Specification

## 12.1 Contact Edit Mode

When `Edit Details` is activated:

- contact scalar fields become editable
- photo controls become editable
- multi-value sections become editable
- relationship rows can enter inline edit mode

## 12.2 Multi-Value Type Editor

For emails, phones, addresses, and websites:

- use a dropdown for known built-in types
- include `Custom` as a dropdown option
- when type is built-in, hide the custom type input
- when type is custom, show the custom type input
- dropdown should default to the current vCard type if recognized
- otherwise default to `Custom` and prefill the custom input

## 12.3 Preferred Item Behavior

For each of these groups independently:

- emails
- phones
- addresses
- websites

The UI must allow exactly one preferred item via radio selection, or zero if none is selected.

Setting one item preferred in a group must clear preferred status on the others in that same group.

### 12.4 Company Flag

Provide a checkbox to control whether the contact is serialized with:

```text
X-ABSHOWAS:COMPANY
```

### 12.5 Relationship Editing

Each explicit relationship row must support:

- editing target name
- editing relationship type
- deleting the relationship
- inline save/cancel controls

The target name control must:

- allow picking an existing contact
- allow typing a brand-new freeform name
- provide autocomplete suggestions from existing contacts

The relationship-type control presents a single flat list (no group headers): each generic parent type (Spouse, Parent, Stepparent, Child, Stepchild, Sibling, Grandparent, Grandchild) is selectable, with its more-specific subtypes (e.g. Husband / Wife / Partner under Spouse) shown **indented** beneath it. There is no "(generic)" label — selecting the parent stores the generic type, selecting a child stores that specific type. A "Custom…" escape hatch reveals a freeform input.

When relationship inline edit mode is active:

- clicking the row must not navigate to the target contact

### 12.6 Relationship Add Flow

The `Add Relationship` action must appear at the bottom of the explicit `Relationships` section.

It must allow:

- selecting an existing contact or entering a new name
- selecting a relationship type
- persisting both model data and raw vCard changes

Large pickers — the existing-contact picker and the relationship-type picker — must support **type-to-filter** (start typing to narrow the list) rather than requiring the user to scroll the full list.

The `Add Relationship` action must remain available while a contact is being **edited**. Opening it mid-edit must first commit the in-progress edit-form state to the model so unsaved field changes are not lost; edit mode continues after the relationship is added.

### 12.7 Bulk Relationship Editing

The bulk-normalize tool must support relationships as a first-class field:

- a **search condition** matching contacts that have (or do not have) a relationship of a chosen type
- a **retype action** that changes relationships of one type to another across all matched contacts, **updating the reciprocal relationship on the other person's card** using the same reciprocal rules as single-contact editing (subject to the reciprocal-downgrade guard, §10.1)

Both the field/type pickers in the bulk tool support type-to-filter.

## 13. Serialization and Export

## 13.1 General Rules

- Export from current in-memory `rawVCard` blocks.
- Escape commas, semicolons, backslashes, and newlines correctly.
- Fold generated vCard lines before export using continuation lines that begin with a single space, respecting UTF-8 byte limits.
- Normalize rewritten cards to CRLF line endings.
- Preserve valid Apple `itemN` patterns.
- Support rewriting contact cards after edits without requiring a full parser round-trip.

## 13.2 Structured Name Serialization

When saving a contact:

- serialize `FN` from display name
- serialize `N` from structured name fields
- preserve empty structured slots where needed

Example:

```text
N:Last;First;Middle;Prefix;Suffix
```

## 13.3 Relationship Serialization Semantics

Relationships are **model-driven**: `contact.related` is the single source of truth, and the `itemN.X-ABRELATEDNAMES` / `itemN.X-ABLabel` groups are regenerated from it by the same routine that regenerates emails/phones/addresses (`_rewriteEditableFields`), not patched in place. Add / edit / delete relationship actions mutate `contact.related` and re-run that regeneration. (Earlier versions hand-patched individual item groups with regex surgery; that dual-write is gone.)

The regeneration must:

- emit one `itemN` group per related entry, escaping the name and using the entry's raw/derived Apple label
- preserve non-relationship item groups and unknown Apple properties verbatim (see §13.5)
- tolerate folded and escaped input when reading the original card

When the user edits a relationship to a target that is an existing contact, the relationship records that contact's `uid` so future resolution is rename-proof (§10.1). Reciprocal updates on the other contact regenerate that contact's card the same way.

Saving relationship edits from the main contact `Save` action must commit any still-open inline relationship editors before serializing.

### 13.5 Rewrite Preservation Rules

When rewriting editable contact fields:

- keep unknown non-editable simple properties whenever practical
- keep non-editable `itemN` groups whenever practical
- keep non-anniversary `itemN.X-ABDATE` groups, such as custom Apple dates, during ordinary contact rewrites
- regenerate editable scalar and collection fields from the current contact model — including emails, phones, addresses, URLs, the anniversary item group, and the explicit relationship `itemN` groups (which are derived from `contact.related`, §13.3)
- use shared vCard encoding/folding helpers for all generated lines

## 13.6 HTML and Link Safety

Imported contact data and user-entered freeform fields must be treated as untrusted before inserting into HTML.

- Render plain contact values with `textContent` or an equivalent HTML-escaping helper.
- Escape `&`, `<`, `>`, `"`, and `'` when a value must be interpolated into HTML.
- Escape custom relationship type display labels before rendering relationship rows.
- Do not render unsafe URL protocols, such as `javascript:`, as clickable links.

## 13.4 Export Variants

Export is **multi-scope × multi-format**. Each scope can be exported in each format:

- scopes: single contact (detail panel), current multi-selection (export bar), all contacts (header)
- formats: vCard (`.vcf`), Markdown (`.md`), TSV (`.tsv`)

Plus a standalone **TSV Template** download (header row + one worked example row).

Bulk (multi-contact) export filenames carry the date, e.g. `contacts 2026-06-26.tsv`.

Virtual-only contacts cannot be exported until converted into real contacts.

Markdown export must include standard fields, typed custom fields, and preserved Markdown body content. Multi-contact Markdown exports use the `<!-- CONSTELLATION:CONTACT -->` bundle delimiter. Unknown custom field payloads must keep semantic values such as nested objects, lists, booleans, nulls, empty strings, and numeric-looking strings.

Markdown export **externalizes photos**: instead of base64-embedding a photo, the `.md` references a separate, human-readably-named image file, and the image files are written alongside the `.md`. The app writes them together using the File System Access directory picker (`showDirectoryPicker`) where available, falling back to individual downloads. A photo-free export is a single `.md`.

TSV export writes the flat table described in §8.1.4 for the chosen scope.

## 14. Browser Persistence

Session restore must use IndexedDB rather than `localStorage` because edited source payloads may exceed `localStorage` quotas.

Persisted session data must include:

- active format id
- serialized working source data
- imported file name or label
- timestamp
- selected “me” contact reference
- inferred visibility toggle
- isolated visibility toggle
- contact-list sort mode

The selected “me” reference must be stable across reparses:

- prefer `UID`
- fallback to `FN`

## 15. Graph Rendering Requirements

The graph renderer must:

- display full names for all contacts, including companies and doctors
- render photo when present
- render fallback initials or icon when photo is missing
- update node content immediately after photo edits
- distinguish inferred edges from explicit edges visually
- support node selection without stale detail-body rendering
- preserve node positions across rebuilds: a position cache seeds each node's `x`/`y` from its previous layout so an edit does not re-scatter the graph. When most nodes are already placed the simulation resettles gently with a low alpha; a genuinely new node set lays out fresh.

Selecting a different node while the detail panel is open must fully rerender both header and body for the new node.

To keep editing cheap, edits that cannot change the graph topology should avoid a full rebuild. In particular, saving a note that changes no `#hashtag` updates the contact record without rebuilding the builder/graph.

## 16. Derived / Computed UI Behavior

### 16.1 Age Display

Next to birthday and anniversary, show completed years rounded down.

Examples:

- birthday: `Jan 5, 1988 (38)`
- anniversary: `Jun 12, 2010 (15)`

### 16.2 Detail Panel Relationship Sections

`Relationships` is a collapsible master section; the following are nested subsections within its body and appear only when relevant:

- own relationships (directly under the `Relationships` header) — each row reads `[Type] is [Name]` (e.g. "Father is Chris Parker")
- `Referenced in Others' Cards` (a collapsible subsection with a count badge) — each row reads `[Type] of [Name]` (e.g. "Son of Chris Parker"); the "listed in <name>'s card" note is a hover tooltip, not a visible field
- `From "<org>" (inferred)` (with a clickable "+ N more" reveal link when truncated)
- `Suggested Additions` (a collapsible subsection with a count badge)

The connector word ("is" / "of") is static, not editable. Collapse state for the master section and the `Referenced in Others' Cards` and `Suggested Additions` subsections persists across re-selection within a session.

When the selected node is a graph group node instead of a contact, the detail panel should show a group summary and a list of member contacts rather than editable contact fields.

### 16.3 Light / Dark Theme

The app supports a light and a dark theme, toggled from a header control.

- Themes are pure CSS: `css/styles.css` defines the dark palette on `:root` and a light override on `:root[data-theme="light"]`. The toggle only flips the `data-theme` attribute on the document element.
- The default theme is dark. The current choice persists across reloads (localStorage key `constellation:theme`); a missing or unreadable value falls back to dark.
- Because category colors are CSS-driven (§11.2), switching theme recolors the sidebar and graph by refreshing the `Palette` cache and re-reading the `--cat-*` tokens.

## 17. Error Handling Requirements

The app should degrade safely when:

- a related name matches multiple contacts
- a raw vCard line cannot be patched exactly
- a card lacks expected Apple fields
- a single record in an import is malformed
- browser persistence fails

Safe degradation means:

- do not silently bind to the wrong person
- avoid crashing the detail panel
- isolate per-record parse failures — skip the one bad record with a console warning and still import the rest (do not abort the whole import)
- preserve as much imported data as practical
- surface failures via console and/or unobtrusive UI messaging if added

## 18. Suggested Internal Module Boundaries

A clean reimplementation should keep responsibilities separated roughly as follows:

### 18.1 Parser Module

Responsibilities:

- read vCard text
- unfold lines
- parse supported properties
- normalize Apple-specific structures
- output contact models

### 18.2 Relationship Builder Module

Responsibilities:

- resolve names where safe
- create virtual contacts
- generate graph nodes/edges
- generate mode-specific group nodes and cluster hull metadata
- assign primary category and filter tags
- compute family-network membership

### 18.3 Graph View Module

Responsibilities:

- render/update force graph
- depend on local vendored D3 v7
- apply filters
- manage selection callbacks
- render node visuals
- render cluster hulls
- distinguish contact nodes from group nodes visually
- maintain per-render indexes for node and edge lookup

### 18.4 App Controller Module

Responsibilities:

- bind DOM events
- own current state
- manage detail panel rendering
- handle edit/save flows
- patch raw vCards
- import/export
- session persistence
- maintain derived lookup indexes for graph/detail/table operations

Current file split. The controller is **one class** (`ContactRelationshipApp`) whose methods are split across focused ES-module files. `app.js` defines the class and core behavior; each `app-*.js` module defines a cohesive group of methods and grafts them onto the prototype via `applyMixin` (`js/apply-mixin.js`). Because they all extend the same prototype, `this._foo()` works across modules with no call-site changes.

- `js/app.js`: core class — constructor, `_init`, file load, the rebuild/index pipeline, shared helpers (vCard escaping/folding, `_typeToVCardLabel`, etc.).
- `js/app-notes.js`: Notes inline save and hashtag autocomplete.
- `js/app-session.js`: IndexedDB persistence and self-contact ("me") resolution.
- `js/app-sidebar.js`: contact list, filters, legend, stats, tag colors.
- `js/app-table.js`: editable table view.
- `js/app-detail.js`: detail-panel render and node selection.
- `js/app-suggestions.js`: relationship suggestion engine.
- `js/app-editing.js`: field editors and `_rewriteEditableFields` (raw-vCard regeneration).
- `js/app-relationship-edit.js`: inline relationship CRUD and the add-relationship modal.
- `js/app-export.js`: vCard / Markdown / TSV export and the TSV template.
- `js/app-bulk.js`: bulk-normalize rule engine and modal.
- `js/app-theme.js`: light/dark theme toggle and persistence.
- `js/app-controller.js`: assembly point — imports `app.js` plus every mixin module (for their side effects) and re-exports `ContactRelationshipApp`. Both the browser entry and the test harness import the class from here.
- `js/app-bootstrap.js`: entry module — `DOMContentLoaded` startup plus add-relationship and bulk-normalize modal wiring; it is the single `<script type="module">` in `index.html`.

With ES modules the load order is resolved by the `import` graph rather than `<script>` order, so the mixin modules need only be imported before the app is constructed (which `app-controller.js` guarantees). The split is deliberately mechanical and does not change state ownership or behavior.

The data layer additionally has three single-source modules that everything else derives from, so a fact is defined exactly once:

- `RelationshipTaxonomy` (`js/relationship-taxonomy.js`): relationship types, display/vCard labels, categories, reciprocals, normalization, and the picker options. Parser, builder, and controller delegate to it.
- `ContactRecord.STANDARD_FIELDS` + `createEmptyContact()` (`js/contact-record.js`): the canonical contact field shape; the parser, adapters, and graph node builder derive their field lists from it.
- `Palette` (`js/palette.js`): reads the CSS `--cat-*` tokens as the single color source (§11.2).

Shared UI helpers: `makeSearchable(select)` (`js/searchable-select.js`) progressively enhances any native `<select>` into a type-to-filter combobox while preserving its value and `change` event, so large pickers (contacts, relationship types, bulk fields) become searchable without bespoke per-picker code; `attachMenu(trigger, items)` (`js/menu-button.js`) turns a button into a dropdown-menu trigger, used to consolidate the Import / Export (All / Selected / Contact) / Session actions into single menu buttons.

### 18.5 Runtime Indexes and Invalidation

The app intentionally favors data preservation and correctness, but it should avoid repeated full-array scans in hot UI paths. A reimplementation should maintain these indexes:

- `contactById`: maps real contact IDs to mutable contact objects.
- `contactsByUid`: maps vCard `UID` values to contacts for stable session restore.
- `contactsByFn`: maps normalized display names to contacts for duplicate checks and fallback restore. If duplicate display names must be supported, this should become a multi-map plus ambiguity checks.
- `nodeById`: maps current graph node IDs to graph nodes, including virtual and group nodes.
- `edgesByNodeId`: maps a node ID to all current graph edges incident to that node.
- `relatedRefsByTargetId`: maps a target node ID to reverse relationship references from contacts that list that target.

Indexes are derived state and must be rebuilt after any operation that can change contacts, graph nodes, edges, or relationship resolution:

- after VCF import
- after session restore, before resolving saved self-contact references
- after creating/deleting contacts
- after editing contact fields, names, notes, tags, photos, addresses, or company status
- after adding/editing/deleting relationships
- after changing graph mode or graph visibility options

The graph renderer should keep its own filtered `nodeById` and `edgesByNodeId` indexes for the currently visible graph. Selection highlighting, selected-node zooming, connected-edge highlighting, and cluster hull label placement should use those indexes rather than scanning the full render arrays on every interaction or tick.

## 19. Acceptance Criteria

## 19.1 Import / Parse

- Importing a multi-contact Apple VCF produces one contact per card.
- Importing multiple Markdown files in one operation combines single-contact and bundled Markdown contacts into one working set.
- Contacts with `N:` but no `FN:` still appear with a usable display name.
- Photos, URLs, addresses, and structured names populate the UI correctly.

## 19.2 Relationship Safety

- If two real contacts share the same name, the app does not auto-link a related-name entry to the wrong one.
- Unresolved names produce virtual contacts.

## 19.3 Editing

- Editing a contact’s name updates both display and structured name fields in export.
- Editing relationship type and saving survives reload/restore.
- Editing or adding a photo updates the graph immediately.
- Editing emails/phones/addresses/websites preserves types and preferred state.
- Checking `Treat as Company` round-trips through export.
- Editing ordinary contact fields preserves non-anniversary Apple `X-ABDATE` item groups.
- Exported folded lines preserve non-ASCII text while staying within vCard byte limits.

## 19.4 Family Filter

- Selecting a “me” contact changes the `Family` filter membership based on explicit connectivity only.
- A disconnected family-labeled cluster is excluded.
- A connected non-family-labeled cluster is included if explicitly reachable.

## 19.5 Persistence

- After import, edit, and “me” selection, reloading and clicking `Restore Last` restores the edited dataset and selected “me” card.
- The selected graph view is restored with the saved session.

## 19.6 Graph/UI Integrity

- Selecting one node after another updates the full detail panel, not just the header.
- Full names render on graph labels.
- `Add Relationship` appears at the bottom of the `Relationships` section.
- The sidebar contact list supports both `First Last` and `Last, First` sort modes.
- The contact-list sort label and dropdown appear on the same row.
- In `Last, First` mode, the sidebar displays names in `Last, First` format whenever structured name data is available.
- Contact-list row accents are derived from the contact's filter tags rather than a single legacy category color.
- The sidebar is split into a controls column and a dedicated contacts-list column.
- The controls column can be collapsed while the contacts/search column remains visible.
- Detail panels show custom fields from `customFields` / `record.fields`.
- Detail edit mode can edit scalar custom fields and list custom fields; nested object custom fields are displayed read-only and preserved.
- Switching graph views does not require reimporting contacts.
- Switching between graph and table mode does not require reimporting contacts.
- `Connections` can show or hide organization clustering independently.
- `Connections` can show or hide likely family independently.
- `Connections` can show or hide likely connections independently.
- `Connections` only creates surname clusters when 2 or more contacts share the same family name.
- `Connections` only creates hashtag clusters when 2 or more contacts share the same hashtag.
- `Connections` uses clearly unconfirmed visual treatment for likely group links while still showing explicit relationship edges as confirmed.
- `Geographic Relationships` groups contacts by preferred address using the hierarchy country → state/province → city → street.
- Grouped graph views render prominent hull labels naming each cluster.
- Hull labels remain readable when the graph is zoomed out.
- Group nodes show a group summary in the detail panel instead of editable contact details.
- Custom relationship labels and contact-provided link fields cannot inject executable HTML into the detail panel.

## 20. Recommended Test Matrix

The repository includes an offline Node test suite runnable from the repository root:

```bash
npm test
```

The automated suite lives under `test/` and uses fixture VCF files under `test/fixtures/`. The primary fixture is `comprehensive.vcf`, which covers:

- normal Apple-style contacts
- duplicate display names
- photos
- custom type labels
- preferred email, phone, and address fields
- escaped semicolons, commas, and newlines
- explicit relationships
- unresolved relationships that create virtual contacts
- company contacts via `X-ABSHOWAS:COMPANY`
- Notes hashtags
- geographic address data

Automated tests must cover:

- parser import of all fixture fields
- serializer round-trip: parse fixture → rewrite/serialize → reparse → verify key fields and metadata survive
- duplicate-name ambiguity behavior
- virtual contact graph generation
- saved "me" contact restore by `UID`
- table notes edit and immediate searchable data refresh
- detail-field rewrite preserving metadata
- relationship add/edit/delete and relationship type persistence
- bulk normalize append and replace behavior, including appending to empty Notes
- photo update serialization
- Notes hashtag autocomplete context and insertion
- contact deletion from the working export set
- vCard import attaches a format-neutral `ContactRecord`, `customFields`, and `sourceDocuments`
- `ContactRecord` stays synchronized after legacy contact edits
- `VCardAdapter` imports, serializes, filters selected contacts, and recognizes vCard file extensions
- `MarkdownAdapter` imports frontmatter/body contacts, preserves arbitrary typed fields, supports bundle files, and serializes Markdown output
- `TsvAdapter` parses a row into the contact model, serialize→reparse round-trips the common fields, escapes tabs/newlines, emits a header+example template, and isolates a malformed row
- relationships resolve by `uid` when present (ignoring a mismatched name) and fall back to name matching when absent
- deterministic contact ids are stable across reparses and distinct for duplicate names
- non-`company` tags round-trip through the vCard fallback via `CATEGORIES`
- robust sample Markdown fixtures import as separate single-contact files and as a multi-contact bundle
- multi-file import combines supported Markdown files into one working set
- Markdown import → export → reimport preserves unknown fields, unknown nested objects, null/empty values, and Markdown body content
- vCard → Markdown and Markdown → vCard conversion preserve standard contact data
- custom fields render in read-only detail mode
- scalar and list custom fields can be edited while object custom fields are preserved
- preservation of non-anniversary Apple date item groups during contact rewrites
- HTML escaping and unsafe-href rejection for user/contact-provided display values
- UTF-8 byte-safe vCard line folding

Manual Apple Contacts validation is documented in `docs/APPLE_CONTACTS_ROUNDTRIP_CHECKLIST.md`.

At minimum, automated or manual coverage should include:

- VCF with `FN` and `N`
- VCF with `N` but no `FN`
- duplicate contact names
- contact with no photo, then add photo
- contact with multiple emails and one preferred
- contact with custom type labels
- relationship rename to an existing contact
- relationship rename to a new freeform name
- relationship type edit followed by full save and restore
- sidebar sort mode toggle followed by save and restore
- contact-list row coloring reflects system tags and hashtags
- graph view switch followed by save and restore
- table mode switch followed by save and restore
- inline table edit of name/org/title
- inline table edit of notes updates hashtag tags
- add contact from table mode
- delete contact from table mode
- connections view with organization clustering on/off
- connections view with surname clustering on/off
- connections view with hashtag clustering on/off
- connections surname cluster with 2 contacts
- connections surname with only 1 contact does not create a cluster
- hull label appears for connections clusters
- hull label remains readable after zooming out
- connections hashtag cluster with 2 contacts
- connections hashtag with only 1 contact does not create a cluster
- geographic grouping across country/state/city/street
- virtual contact conversion to real contact
- “me” selection restore after reload
- family filter on disconnected clusters

## 21. Future Extension Opportunities

Possible next steps for a new implementation:

- re-import a Markdown export together with its externalized photo files, re-attaching each image by the filename referenced in the `.md` (the one remaining gap in lossless Markdown round-trip, since the externalized image is not embedded in the `.md`)
- formal schema validation for parsed contacts
- richer conflict UI for ambiguous duplicate-name relationships
- better preservation of obscure Apple/private fields
- a CSV variant of the TSV adapter (the schema/encoding already factor cleanly on a delimiter)
- optional import/export diff view
- browser-side undo/redo stack

The following directions from earlier drafts are now **implemented** and no longer future work: native ES-module delivery, splitting the monolithic controller into mixin modules, incremental position-preserving graph rebuilds, UID-first relationship resolution, the TSV adapter, and the light/dark theme.
