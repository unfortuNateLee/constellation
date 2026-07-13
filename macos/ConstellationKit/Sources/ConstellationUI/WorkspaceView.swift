// WorkspaceView — the content pane: a Table / Graph / Geographic switcher above
// the active workspace. Table shows the read-only `ContactTableView`; the two
// graph modes render a centered "arrives in M4" placeholder (the graph canvas is
// a later milestone).

import ConstellationStore
import SwiftUI

struct WorkspaceView: View {
    @Bindable var store: AppStore

    var body: some View {
        VStack(spacing: 0) {
            Picker("View", selection: $store.workspaceMode) {
                Text("Table").tag(WorkspaceMode.table)
                Text("Graph").tag(WorkspaceMode.graph)
                Text("Geographic").tag(WorkspaceMode.geographic)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .padding(8)

            Divider()

            switch store.workspaceMode {
            case .table:
                ContactTableView(store: store)
            case .graph:
                GraphPlaceholder(
                    title: "Graph view",
                    detail: "The relationship graph arrives in M4.")
            case .geographic:
                GraphPlaceholder(
                    title: "Geographic view",
                    detail: "The geographic graph arrives in M4.")
            }
        }
    }
}

/// Centered placeholder for the not-yet-built graph workspaces.
private struct GraphPlaceholder: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                .font(.system(size: 40))
                .foregroundStyle(.tertiary)
            Text(title).font(.title3.weight(.semibold))
            Text(detail).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
