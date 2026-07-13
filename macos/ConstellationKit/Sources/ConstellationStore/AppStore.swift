// AppStore — the single source of application state for the native app, ported
// from the js/app.js `ContactRelationshipApp` controller's state + index
// pipeline. All contact mutations flow through store methods; after every
// mutating operation the store runs one `rebuildIndexes()` pass (DESIGN_SPEC
// §19.5) that rebuilds the graph model and every derived lookup in lockstep,
// exactly like the JS `_rebuildGraph` → `_reindexContacts` / `_reindexGraphData`
// sequence.
//
// Fidelity anchors (JS wins over spec):
//   • default toggle/mode state — js/app.js constructor (lines 39–52).
//   • index construction — js/app.js `_reindexContacts` / `_reindexGraphData`
//     / `_buildRelatedRefsByTargetId` (lines 730–821).
//   • filter/category derivation — FilterEngine (js/app-sidebar.js).
//   • self-contact + active-filter reconciliation — js/app.js `_pruneActiveFilters`
//     and `_renderSelfContactPicker` (self reset when its contact disappears).

import ConstellationGraphModel
import ConstellationModel
import Observation

/// Which workspace the content pane shows (JS `_mainViewMode`; graph/table/geo).
public enum WorkspaceMode: String, Sendable, Codable, CaseIterable {
    case graph
    case table
    case geographic
}

/// Table sort state (JS `_tableSort = { key, dir }`).
public struct TableSort: Sendable, Equatable, Codable {
    public var key: String
    public var ascending: Bool
    public init(key: String = "name", ascending: Bool = true) {
        self.key = key
        self.ascending = ascending
    }
}

/// A relationship reference pointing *at* a contact (JS
/// `_buildRelatedRefsByTargetId` entry). `fromContactID` is the contact that
/// declared the relationship; `targetID` is the resolved contact id or a
/// `virtual__…` id when unresolved.
public struct RelatedRef: Sendable, Equatable {
    public var rel: RelatedValue
    public var fromContactID: String
    public init(rel: RelatedValue, fromContactID: String) {
        self.rel = rel
        self.fromContactID = fromContactID
    }
}

@Observable
@MainActor
public final class AppStore {
    // MARK: - Core state

    /// The loaded contacts, in file order. Mutated only through store methods.
    public private(set) var contacts: [Contact] = []
    /// Header label for the current data set (file name or "N files").
    public var fileLabel: String = ""
    /// Active format id: "vcard" | "markdown" | "tsv" (JS `_activeFormatId`).
    public private(set) var activeFormatID: String = "vcard"

    /// Currently selected contact/node id (JS `_selectedNodeId`).
    public var selectedContactID: String?
    /// The "me" contact id (JS `_selfContactId`). Set via `setSelfContact`.
    public private(set) var selfContactID: String?

    /// Sidebar search text. Compared case-insensitively by `FilterEngine`.
    public var searchText: String = ""
    /// Active filter tags, in toggle order (JS `_activeFilters`, a Set — kept
    /// ordered here for stable chip rendering). Mutated via the filter methods.
    public private(set) var activeFilterTags: [String] = []

    /// Content-pane workspace (JS `_mainViewMode`).
    public var workspaceMode: WorkspaceMode = .graph
    /// Contact-list sort mode (JS `_contactSortMode`). Affects the sidebar list
    /// order only, so no index rebuild is required.
    public var contactSortMode: ContactSortMode = .firstLast
    /// Table sort state (JS `_tableSort`).
    public var tableSort: TableSort = TableSort()

    // Graph build toggles — defaults mirror the js/app.js constructor exactly.
    public private(set) var graphMode: GraphBuildMode = .connections
    public private(set) var showInferred: Bool = true
    public private(set) var showLikelyFamily: Bool = false
    public private(set) var showLikelyConnections: Bool = true
    public private(set) var showIsolated: Bool = true
    public private(set) var showVirtual: Bool = true
    /// Extended-family suggestion granularity toggle (JS `_suggestExtendedFamily`,
    /// off by default). Does not affect the graph build; stored for parity/session.
    public var suggestExtendedFamily: Bool = false

    // MARK: - Derived state (rebuilt together by `rebuildIndexes`)

    /// contact id → contact (JS `_contactById`; last wins on duplicate id).
    public private(set) var contactsById: [String: Contact] = [:]
    /// UID → contact (JS `_contactsByUid`; last wins on duplicate UID).
    public private(set) var contactsByUid: [String: Contact] = [:]
    /// lowercased/trimmed fn → contacts (multi-map, ambiguity-aware; preserves
    /// file order — the JS single-map keeps the first, this keeps all so callers
    /// can detect duplicate names like the RelationshipBuilder's name index).
    public private(set) var contactsByFn: [String: [Contact]] = [:]

    /// Current graph (JS `graphData`), built from `contacts` + current options.
    public private(set) var graphModel: GraphModel = GraphModel(mode: "connections", nodes: [], edges: [], hulls: [])
    /// node id → node (JS `_nodeById`).
    public private(set) var nodeById: [String: GraphNode] = [:]
    /// node id → incident edges (JS `_edgesByNodeId`).
    public private(set) var edgesByNodeId: [String: [GraphEdge]] = [:]
    /// resolved/virtual target id → inbound relationship refs (JS
    /// `_relatedRefsByTargetId`).
    public private(set) var relatedRefsByTargetId: [String: [RelatedRef]] = [:]

    /// All filter categories for the sidebar (JS `allCategories`).
    public private(set) var allCategories: [String] = []
    /// Contact-set statistics for the current graph (JS `getStats`).
    public private(set) var stats: GraphStats?

    /// The builder over the current contact set (exposes `findContact`, etc.).
    public private(set) var builder: RelationshipBuilder = RelationshipBuilder([])

    public init() {}

    // MARK: - Derived helpers

    /// The sidebar contact list for the current search/filter/sort (JS
    /// `_filteredContactsForSidebar`). Recomputed on read — cheap, and keeps the
    /// engine the single filtering authority for both sidebar and table.
    public var filteredContacts: [GraphNode] {
        FilterEngine.filteredContacts(
            nodes: graphModel.nodes,
            searchQuery: searchText,
            activeFilters: activeFilterTags,
            sortMode: contactSortMode
        )
    }

    public func contact(_ id: String?) -> Contact? {
        guard let id else { return nil }
        return contactsById[id]
    }

    public func node(_ id: String?) -> GraphNode? {
        guard let id else { return nil }
        return nodeById[id]
    }

    public func edges(for id: String) -> [GraphEdge] {
        edgesByNodeId[id] ?? []
    }

    // MARK: - Mutations (each ends in a single rebuild)

    /// Replace the entire contact set (JS `_loadFiles`: `this.contacts = contacts`
    /// — import is REPLACE, never append). Updates the file label + active format,
    /// then rebuilds every index.
    public func loadContacts(_ contacts: [Contact], fileLabel: String, activeFormatID: String) {
        self.contacts = contacts
        self.fileLabel = fileLabel
        self.activeFormatID = activeFormatID
        rebuildIndexes()
    }

    /// Replace the contact set without touching the file label / format (used by
    /// session restore and tests).
    public func setContacts(_ contacts: [Contact]) {
        self.contacts = contacts
        rebuildIndexes()
    }

    /// Set the "me" contact and rebuild (root of the family component, JS
    /// `_selfContactId` → `rootContactId`).
    public func setSelfContact(_ id: String?) {
        selfContactID = id
        rebuildIndexes()
    }

    /// Set the active format id directly (session restore; import uses
    /// `loadContacts`). No rebuild needed — format id is not a graph input.
    public func setActiveFormatID(_ id: String) {
        activeFormatID = id
    }

    // Graph toggle setters — each mutates then rebuilds the graph + indexes.
    public func setGraphMode(_ mode: GraphBuildMode) { graphMode = mode; rebuildIndexes() }
    public func setShowInferred(_ value: Bool) { showInferred = value; rebuildIndexes() }
    public func setShowLikelyFamily(_ value: Bool) { showLikelyFamily = value; rebuildIndexes() }
    public func setShowLikelyConnections(_ value: Bool) { showLikelyConnections = value; rebuildIndexes() }
    public func setShowIsolated(_ value: Bool) { showIsolated = value; rebuildIndexes() }
    public func setShowVirtual(_ value: Bool) { showVirtual = value; rebuildIndexes() }

    // MARK: - Filter tag mutations (view-only; no graph rebuild)

    /// Toggle a filter tag (JS category-filter button handler). Toggling `family`
    /// is a no-op while no "me" contact is chosen. Returns the new membership.
    @discardableResult
    public func toggleFilter(_ tag: String) -> Bool {
        if tag == "family" && selfContactID == nil { return false }
        if let idx = activeFilterTags.firstIndex(of: tag) {
            activeFilterTags.remove(at: idx)
            return false
        }
        activeFilterTags.append(tag)
        return true
    }

    /// Replace the active filter set (order preserved), dropping any tag that is
    /// not a current category or `family` without a "me" (JS `_pruneActiveFilters`).
    public func setActiveFilters(_ tags: [String]) {
        activeFilterTags = tags
        pruneActiveFilters()
    }

    public func clearFilters() {
        activeFilterTags = []
    }

    // MARK: - Index rebuild (JS `_reindexContacts` / `_reindexGraphData`)

    /// The single rebuild pass run after every mutating operation (§19.5): rebuild
    /// contact indexes, the graph model, node/edge/related indexes, the category
    /// list, then reconcile the self + selection + active-filter state against the
    /// new graph.
    public func rebuildIndexes() {
        rebuildContactIndexes()

        builder = RelationshipBuilder(contacts)
        let model = builder.build(buildOptions)
        graphModel = model

        rebuildGraphIndexes(model)
        relatedRefsByTargetId = buildRelatedRefs()

        allCategories = FilterEngine.availableFilterTags(model.nodes)
        stats = builder.getStats(nodes: model.nodes, edges: model.edges)

        // Reconcile "me": JS `_renderSelfContactPicker` clears it when its contact
        // is gone. Do this before pruning so the family filter is dropped too.
        if let me = selfContactID, contactsById[me] == nil {
            selfContactID = nil
        }
        pruneActiveFilters()

        // Reconcile selection: a fresh graph (e.g. a new import) drops a stale id.
        if let sel = selectedContactID, nodeById[sel] == nil {
            selectedContactID = nil
        }
    }

    /// Graph build options assembled from the current toggle/mode/self scalars
    /// (JS `_rebuildGraph` options object).
    public var buildOptions: GraphBuildOptions {
        GraphBuildOptions(
            mode: graphMode,
            includeInferred: showInferred,
            includeLikelyFamily: showLikelyFamily,
            includeLikelyConnections: showLikelyConnections,
            includeIsolated: showIsolated,
            includeVirtual: showVirtual,
            rootContactId: selfContactID
        )
    }

    // MARK: - Private index builders

    private func rebuildContactIndexes() {
        var byId: [String: Contact] = [:]
        var byUid: [String: Contact] = [:]
        var byFn: [String: [Contact]] = [:]
        for c in contacts {
            byId[c.id] = c
            if let uid = c.uid, !uid.isEmpty { byUid[uid] = c }
            let fnKey = c.fn.lowercased().trimmingCharacters(in: .whitespaces)
            if !fnKey.isEmpty { byFn[fnKey, default: []].append(c) }
        }
        contactsById = byId
        contactsByUid = byUid
        contactsByFn = byFn
    }

    private func rebuildGraphIndexes(_ model: GraphModel) {
        var nById: [String: GraphNode] = [:]
        for n in model.nodes { nById[n.id] = n }
        nodeById = nById

        var eByNode: [String: [GraphEdge]] = [:]
        for e in model.edges {
            eByNode[e.source, default: []].append(e)
            eByNode[e.target, default: []].append(e)
        }
        edgesByNodeId = eByNode
    }

    /// Port of `_buildRelatedRefsByTargetId` (js/app.js): every contact's
    /// relationships are indexed by their resolved target id, or by a
    /// `virtual__<sanitized-name>` id when unresolved.
    private func buildRelatedRefs() -> [String: [RelatedRef]] {
        var refs: [String: [RelatedRef]] = [:]
        for other in contacts {
            for rel in other.related {
                let targetID: String
                if let target = builder.findContact(rel.name) {
                    targetID = target.id
                } else {
                    targetID = "virtual__" + Self.sanitizeVirtualName(rel.name)
                }
                refs[targetID, default: []].append(RelatedRef(rel: rel, fromContactID: other.id))
            }
        }
        return refs
    }

    /// JS `rel.name.replace(/[^a-zA-Z0-9]/g, '_')`.
    nonisolated static func sanitizeVirtualName(_ name: String) -> String {
        String(name.map { ch in
            (ch.isASCII && (ch.isLetter || ch.isNumber)) ? ch : "_"
        })
    }

    /// Drop filter tags that are no longer categories, or `family` without a
    /// "me" (JS `_pruneActiveFilters`). Order is preserved.
    private func pruneActiveFilters() {
        let allowed = Set(allCategories)
        activeFilterTags = activeFilterTags.filter { tag in
            allowed.contains(tag) && !(tag == "family" && selfContactID == nil)
        }
    }
}
