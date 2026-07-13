// ContactTableView — the read-only SwiftUI `Table` body over `TableViewModel`.
//
// Sorting: the sortable-column headers drive SwiftUI's `sortOrder` binding, which
// we translate into `AppStore.tableSort` (the JS `_tableSort`). We never let
// `Table` reorder the data — `TableViewModel.sortedRows` does the JS-parity sort
// and feeds the already-sorted rows in. The `sortOrder` binding is only a carrier
// for which header is active + its direction. Read-only: no cell editors (M5).
//
// The columns are split into three `@TableColumnBuilder` chunks so the type
// checker doesn't choke on one 17-column expression.

import ConstellationStore
import SwiftUI

private typealias RowComparator = KeyPathComparator<TableRow>

struct ContactTableView: View {
    @Bindable var store: AppStore
    @State private var sortOrder: [RowComparator]

    init(store: AppStore) {
        self.store = store
        _sortOrder = State(initialValue: Self.comparators(for: store.tableSort))
    }

    private var rows: [TableRow] {
        TableViewModel.sortedRows(store.filteredContacts, sort: store.tableSort)
    }

    var body: some View {
        Table(rows, sortOrder: $sortOrder) {
            identityColumns
            channelColumns
            trailingColumns
        }
        .onChange(of: sortOrder) { _, newValue in
            applySortOrder(newValue)
        }
        .overlay {
            if rows.isEmpty {
                ContentUnavailableView(
                    "No matches",
                    systemImage: "line.3.horizontal.decrease.circle",
                    description: Text("No contacts match the current search and filters."))
            }
        }
    }

    // MARK: - Column groups

    @TableColumnBuilder<TableRow, RowComparator>
    private var identityColumns: some TableColumnContent<TableRow, RowComparator> {
        TableColumn("Name", value: \.name) { Text($0.name) }
            .width(min: 120, ideal: 170)
        TableColumn("Nickname", value: \.nickname) { Text($0.nickname) }
            .width(min: 80, ideal: 120)
        TableColumn("Organization", value: \.org) { Text($0.org) }
            .width(min: 100, ideal: 180)
        TableColumn("Department", value: \.department) { Text($0.department) }
            .width(min: 90, ideal: 150)
        TableColumn("Title", value: \.title) { Text($0.title) }
            .width(min: 90, ideal: 160)
    }

    @TableColumnBuilder<TableRow, RowComparator>
    private var channelColumns: some TableColumnContent<TableRow, RowComparator> {
        TableColumn("Emails") { Text($0.emails) }.width(ideal: 240)
        TableColumn("Phones") { Text($0.phones) }.width(ideal: 240)
        TableColumn("Instant Messages") { Text($0.ims) }.width(ideal: 220)
        TableColumn("Social Profiles") { Text($0.socialProfiles) }.width(ideal: 220)
        TableColumn("Websites") { Text($0.urls) }.width(ideal: 220)
        TableColumn("Addresses") { Text($0.addresses) }.width(ideal: 260)
    }

    @TableColumnBuilder<TableRow, RowComparator>
    private var trailingColumns: some TableColumnContent<TableRow, RowComparator> {
        TableColumn("Birthday", value: \.birthday) { Text($0.birthday) }
            .width(min: 90, ideal: 130)
        TableColumn("Anniversary") { Text($0.anniversary) }.width(ideal: 130)
        TableColumn("Relationships") { Text($0.related) }.width(ideal: 200)
        TableColumn("Other Dates") { Text($0.dates) }.width(ideal: 160)
        TableColumn("Tags") { Text($0.tags) }.width(ideal: 150)
        TableColumn("Notes") { Text($0.notes).lineLimit(1) }.width(ideal: 260)
    }

    // MARK: - Sort key ↔ keypath bridging

    /// (keypath, `TableSort.key`) pairs for the sortable columns. Kept as a local
    /// value — a `static let` of keypaths would demand `Sendable` conformance.
    private var sortableKeyPaths: [(PartialKeyPath<TableRow>, String)] {
        [
            (\TableRow.name, "name"),
            (\TableRow.nickname, "nickname"),
            (\TableRow.org, "org"),
            (\TableRow.department, "department"),
            (\TableRow.title, "title"),
            (\TableRow.birthday, "birthday"),
        ]
    }

    /// Translate SwiftUI's active comparator back into `TableSort` (key + dir).
    private func applySortOrder(_ order: [RowComparator]) {
        guard let first = order.first,
            let key = sortableKeyPaths.first(where: { $0.0 == first.keyPath })?.1
        else { return }
        let ascending = first.order == .forward
        if store.tableSort.key != key || store.tableSort.ascending != ascending {
            store.tableSort = TableSort(key: key, ascending: ascending)
        }
    }

    /// Build SwiftUI's initial `sortOrder` from the store's `TableSort`.
    private static func comparators(for sort: TableSort) -> [RowComparator] {
        let order: SortOrder = sort.ascending ? .forward : .reverse
        let keyPath: KeyPath<TableRow, String> & Sendable
        switch sort.key {
        case "nickname": keyPath = \.nickname
        case "org": keyPath = \.org
        case "department": keyPath = \.department
        case "title": keyPath = \.title
        case "birthday": keyPath = \.birthday
        default: keyPath = \.name
        }
        return [KeyPathComparator(keyPath, order: order)]
    }
}
