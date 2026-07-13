// TableViewModel — the UI-framework-agnostic row/column model behind the
// read-only contact table. It carries NO SwiftUI (or AppKit) imports so the body
// can be swapped from SwiftUI's `Table` to an `NSTableView` in a later milestone
// without touching this file (M3 brief, ConstellationUI section).
//
// Columns + sort semantics are a read-only port of js/app-table.js:
//   • the column set mirrors `_tableColumns()` minus the edit-only `actions`
//     column; every other column renders as read-only text.
//   • `sortable` matches the JS `sortable: true` flags (name, nickname, org,
//     department, title, birthday).
//   • the sort comparator mirrors `_compareTableContacts` — a case-insensitive
//     ("base" sensitivity) compare on a per-key projected string, with the sort
//     applied on top of the already-sidebar-filtered node set.

import ConstellationGraphModel
import ConstellationModel
import ConstellationStore

/// One column of the read-only table.
public struct TableColumnSpec: Identifiable, Sendable {
    /// `Identifiable` conformance — the column's sort/identity key.
    public var id: String { key }
    /// Sort/identity key — matches the JS column `key` and the `TableSort.key`
    /// values (`name`, `org`, …).
    public let key: String
    public let title: String
    /// Whether the header toggles `TableSort` (JS `sortable: true`).
    public let sortable: Bool
    /// Default width in points (JS column `width`).
    public let width: Double

    public init(key: String, title: String, sortable: Bool, width: Double) {
        self.key = key
        self.title = title
        self.sortable = sortable
        self.width = width
    }
}

/// A projected, read-only row. Every field is a display string; `id` is the
/// contact/node id used for selection + `Identifiable`.
public struct TableRow: Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let nickname: String
    public let org: String
    public let department: String
    public let title: String
    public let emails: String
    public let phones: String
    public let ims: String
    public let socialProfiles: String
    public let urls: String
    public let addresses: String
    public let birthday: String
    public let anniversary: String
    public let related: String
    public let dates: String
    public let tags: String
    public let notes: String
}

public enum TableViewModel {
    /// The read-only column set — js/app-table.js `_tableColumns()` order and
    /// widths, minus the edit-only `actions` column. `sortable` mirrors the JS
    /// flags exactly.
    public static let columns: [TableColumnSpec] = [
        TableColumnSpec(key: "name", title: "Name", sortable: true, width: 170),
        TableColumnSpec(key: "nickname", title: "Nickname", sortable: true, width: 120),
        TableColumnSpec(key: "org", title: "Organization", sortable: true, width: 180),
        TableColumnSpec(key: "department", title: "Department", sortable: true, width: 150),
        TableColumnSpec(key: "title", title: "Title", sortable: true, width: 160),
        TableColumnSpec(key: "emails", title: "Emails", sortable: false, width: 240),
        TableColumnSpec(key: "phones", title: "Phones", sortable: false, width: 240),
        TableColumnSpec(key: "ims", title: "Instant Messages", sortable: false, width: 220),
        TableColumnSpec(key: "socialProfiles", title: "Social Profiles", sortable: false, width: 220),
        TableColumnSpec(key: "urls", title: "Websites", sortable: false, width: 220),
        TableColumnSpec(key: "addresses", title: "Addresses", sortable: false, width: 260),
        TableColumnSpec(key: "birthday", title: "Birthday", sortable: true, width: 130),
        TableColumnSpec(key: "anniversary", title: "Anniversary", sortable: false, width: 130),
        TableColumnSpec(key: "related", title: "Relationships", sortable: false, width: 200),
        TableColumnSpec(key: "dates", title: "Other Dates", sortable: false, width: 160),
        TableColumnSpec(key: "tags", title: "Tags", sortable: false, width: 150),
        TableColumnSpec(key: "notes", title: "Notes", sortable: false, width: 260),
    ]

    /// The `TableSort.key` values that a header can actually toggle (the sortable
    /// columns). Used by the view to map SwiftUI's sort state back to a key.
    public static let sortableKeys: Set<String> = Set(
        columns.filter(\.sortable).map(\.key))

    /// Project + sort the already-filtered node set for the current `TableSort`.
    /// Sort is stable with an input-index tiebreaker so ties keep sidebar (filter)
    /// order — matching V8's stable `Array.prototype.sort` in js/app-table.js.
    public static func sortedRows(_ nodes: [GraphNode], sort: TableSort) -> [TableRow] {
        let sorted =
            nodes.enumerated()
            .map { (index: $0.offset, key: sortValue($0.element, key: sort.key), node: $0.element) }
            .sorted { a, b in
                let cmp = a.key.localizedCaseInsensitiveCompare(b.key)
                if cmp == .orderedSame { return a.index < b.index }
                let ascendingLess = cmp == .orderedAscending
                return sort.ascending ? ascendingLess : !ascendingLess
            }
            .map(\.node)
        return sorted.map(project)
    }

    // MARK: - Projection

    static func project(_ n: GraphNode) -> TableRow {
        TableRow(
            id: n.id,
            name: n.name,
            nickname: n.nickname,
            org: n.org,
            department: n.department,
            title: n.title,
            emails: n.emails.map(\.value).joined(separator: ", "),
            phones: n.phones.map(\.value).joined(separator: ", "),
            ims: n.ims.map { $0.value }.joined(separator: ", "),
            socialProfiles: n.socialProfiles.map { $0.username.isEmpty ? $0.url : $0.username }
                .joined(separator: ", "),
            urls: n.urls.map(\.value).joined(separator: ", "),
            addresses: n.addresses.map(Self.formatAddress).joined(separator: " • "),
            birthday: n.birthday ?? "",
            anniversary: n.anniversary ?? "",
            related: n.related.map(\.name).joined(separator: ", "),
            dates: n.dates.map { "\($0.label): \($0.value)" }.joined(separator: ", "),
            tags: n.noteTags.map { "#\($0)" }.joined(separator: " "),
            notes: n.notes.joined(separator: "\n"))
    }

    /// Per-key sort projection — mirror of js/app-table.js `_compareTableContacts`
    /// `get()`. Collections join with a space; unknown keys fall back to the name
    /// (JS `default: contact.fn`).
    static func sortValue(_ n: GraphNode, key: String) -> String {
        switch key {
        case "name": return n.name
        case "nickname": return n.nickname
        case "department": return n.department
        case "org": return n.org
        case "title": return n.title
        case "emails": return n.emails.map(\.value).joined(separator: " ")
        case "phones": return n.phones.map(\.value).joined(separator: " ")
        case "urls": return n.urls.map(\.value).joined(separator: " ")
        case "addresses": return n.addresses.map(Self.formatAddress).joined(separator: " ")
        case "birthday": return n.birthday ?? ""
        case "anniversary": return n.anniversary ?? ""
        case "tags": return n.noteTags.joined(separator: " ")
        case "notes": return n.notes.joined(separator: "\n")
        default: return n.name
        }
    }

    /// `[street, city, state, zip, country]` non-empty, space-joined (js/app-table.js
    /// address sort/render).
    static func formatAddress(_ a: AddressValue) -> String {
        [a.street, a.city, a.state, a.zip, a.country]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
