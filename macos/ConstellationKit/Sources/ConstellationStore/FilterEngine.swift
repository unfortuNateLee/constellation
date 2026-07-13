// Sidebar / table filtering + list-name formatting — a verbatim port of the JS
// contact-list pipeline so the native list matches the web app row-for-row.
//
// Source of truth (JS wins over the spec, per the M3 brief):
//   • js/app-sidebar.js `_filteredContactsForSidebar` — base set, sort, search,
//     tag filter (search fields + OR tag semantics).
//   • js/app-sidebar.js `_availableFilterTags` — category list (all 4 system
//     tags + sorted dynamic hashtags; the JS `available` set is dead code).
//   • js/app.js `_formatContactListName` / `_contactListSortKey` — display name
//     and sort key derivation.
//   • js/app-editing.js `_composeDisplayName` — the structured-name fallback.
//
// The engine is deliberately pure (no store state) so both AppStore's sidebar
// list and the (M3-B) table row projection can share one implementation, and so
// tests can assert filter output against JS-generated node ground truth.

import ConstellationGraphModel
import ConstellationModel

/// Contact-list sort mode (JS `_contactSortMode`).
public enum ContactSortMode: String, Sendable, Codable {
    case firstLast = "first-last"
    case lastFirst = "last-first"
}

public enum FilterEngine {
    /// The four built-in system filter tags (JS `_availableFilterTags` `system`).
    public static let systemTags = ["family", "company", "virtual", "other"]

    // MARK: - Sidebar list pipeline

    /// Port of `_filteredContactsForSidebar` (js/app-sidebar.js): base set is the
    /// graph's real, non-group nodes sorted by list key; then the (already
    /// lowercased) search query filters over name / last-first name / org / title
    /// / notes; then active filter tags keep any node sharing at least one tag
    /// (OR semantics, JS `.some`).
    public static func filteredContacts(
        nodes: [GraphNode],
        searchQuery: String,
        activeFilters: [String],
        sortMode: ContactSortMode
    ) -> [GraphNode] {
        // Base set: real contact nodes only (JS `!n.isVirtual && !n.isGroupNode`).
        let base = nodes.filter { !$0.isVirtual && !$0.isGroupNode }

        // Stable sort by list key. Swift's sort is stable, but we carry the input
        // index as an explicit tiebreaker so ties resolve to graph (file) order
        // regardless of sort-algorithm guarantees — matching V8's stable `.sort`.
        let sorted =
            base.enumerated()
            .map { (index: $0.offset, key: sortKey($0.element, sortMode: sortMode), node: $0.element) }
            .sorted { a, b in a.key == b.key ? a.index < b.index : jsLess(a.key, b.key) }
            .map(\.node)

        var contacts = sorted

        // Search (JS lowercases the query at input; empty string ⇒ no filtering).
        let q = searchQuery.lowercased()
        if !q.isEmpty {
            contacts = contacts.filter { matchesSearch($0, query: q) }
        }

        // Active filter tags: OR — keep any node carrying at least one active tag.
        if !activeFilters.isEmpty {
            let active = Set(activeFilters)
            contacts = contacts.filter { node in
                node.filterTags.contains { active.contains($0) }
            }
        }
        return contacts
    }

    /// Search predicate for one node — mirrors the five fields the JS list search
    /// checks (js/app-sidebar.js): display name, last-first name, org, title, and
    /// notes joined by newlines. `query` is expected already lowercased.
    public static func matchesSearch(_ node: GraphNode, query: String) -> Bool {
        if node.name.lowercased().contains(query) { return true }
        let lastFirst = formatListName(fn: node.name, structured: node.structuredName, mode: .lastFirst)
        if lastFirst.lowercased().contains(query) { return true }
        if node.org.lowercased().contains(query) { return true }
        if node.title.lowercased().contains(query) { return true }
        if node.notes.joined(separator: "\n").lowercased().contains(query) { return true }
        return false
    }

    // MARK: - Category list

    /// Port of `_availableFilterTags` (js/app-sidebar.js): always the four system
    /// tags in fixed order, followed by every dynamic (hashtag) filter tag seen
    /// on any node, sorted. (The JS `available` set is computed but unused; the
    /// return is unconditionally `[...system, ...sortedDynamic]`.)
    public static func availableFilterTags(_ nodes: [GraphNode]) -> [String] {
        let system = Set(systemTags)
        var dynamic = Set<String>()
        for node in nodes {
            for tag in node.filterTags where !system.contains(tag) {
                dynamic.insert(tag)
            }
        }
        return systemTags + dynamic.sorted { jsLess($0, $1) }
    }

    // MARK: - Name formatting (js/app.js)

    /// Port of `_formatContactListName`. For a `GraphNode` pass `node.name` as
    /// `fn` (nodes have no `fn`; JS falls back `entity.fn || entity.name`).
    public static func formatListName(
        fn: String, structured: StructuredName?, mode: ContactSortMode
    ) -> String {
        let fallback = fn.trimmed
        guard let s = structured else { return fallback }

        let family = s.family.trimmed
        let given = s.given.trimmed
        let additional = s.additional.trimmed
        let prefix = s.prefix.trimmed
        let suffix = s.suffix.trimmed

        if mode != .lastFirst {
            return fallback.isEmpty ? composeDisplayName(s) : fallback
        }
        if family.isEmpty || given.isEmpty {
            return fallback.isEmpty ? composeDisplayName(s) : fallback
        }
        let trailing = collapseSpaces([prefix, given, additional, suffix].filter { !$0.isEmpty }.joined(separator: " "))
        return trailing.isEmpty ? family : "\(family), \(trailing)"
    }

    /// Port of `_contactListSortKey`.
    public static func sortKey(_ node: GraphNode, sortMode: ContactSortMode) -> String {
        let fallback = formatListName(fn: node.name, structured: node.structuredName, mode: .firstLast)
            .lowercased()
        guard sortMode == .lastFirst, let s = node.structuredName else { return fallback }

        let family = s.family.trimmed.lowercased()
        let given = s.given.trimmed.lowercased()
        let additional = s.additional.trimmed.lowercased()
        let prefix = s.prefix.trimmed.lowercased()
        let suffix = s.suffix.trimmed.lowercased()
        if family.isEmpty || given.isEmpty { return fallback }
        return [family, given, additional, prefix, suffix]
            .filter { !$0.isEmpty }
            .joined(separator: "\u{0}")
    }

    /// Port of `_composeDisplayName` (js/app-editing.js).
    public static func composeDisplayName(_ n: StructuredName) -> String {
        collapseSpaces([n.prefix, n.given, n.additional, n.family, n.suffix]
            .filter { !$0.isEmpty }
            .joined(separator: " "))
    }

    // MARK: - Helpers

    /// Ordering used where the JS uses `String.localeCompare`. Swift compares by
    /// Unicode scalar; for the ASCII / lowercased keys these lists carry the two
    /// orders agree. (Locale-collation edge cases — diacritics, punctuation
    /// weighting — are the one documented deviation.)
    static func jsLess(_ a: String, _ b: String) -> Bool { a < b }
}

extension String {
    /// JS `String.prototype.trim()` — strips leading/trailing whitespace + newlines.
    fileprivate var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// JS `.replace(/\s+/g, ' ').trim()` — collapse internal whitespace runs to a
/// single space and trim the ends.
private func collapseSpaces(_ s: String) -> String {
    s.components(separatedBy: .whitespacesAndNewlines)
        .filter { !$0.isEmpty }
        .joined(separator: " ")
}
