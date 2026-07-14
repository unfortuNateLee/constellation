// WorkspaceView — the content pane: a Table / Graph / Geographic switcher above
// the active workspace. Table shows the read-only `ContactTableView`; the two
// graph modes render the `GraphCanvasView` force-directed graph (M4). The
// geographic pane drives the geographic graph build; both panes reuse the same
// renderer (only the underlying graph model differs).

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
            case .graph, .geographic:
                GraphCanvasView(store: store)
            }
        }
        .onAppear { syncGraphMode(store.workspaceMode) }
        .onChange(of: store.workspaceMode) { _, mode in syncGraphMode(mode) }
    }

    /// Keep the graph *build* mode consistent with the visible pane: the
    /// geographic pane builds the geographic graph; the graph pane builds an
    /// explicit-relationship graph (js/app.js: geographic view sets
    /// `_graphMode = 'geographic'`). Rebuild only when the mode actually flips.
    private func syncGraphMode(_ mode: WorkspaceMode) {
        switch mode {
        case .geographic:
            if store.graphMode != .geographic { store.setGraphMode(.geographic) }
        case .graph:
            if store.graphMode == .geographic { store.setGraphMode(.connections) }
        case .table:
            break
        }
    }
}
