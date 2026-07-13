// RootView — the app's three-column `NavigationSplitView` shell:
//   sidebar  → SidebarView   (search, filter chips, contact list)
//   content  → WorkspaceView (Table / Graph / Geographic), or the empty-state
//              drop hint when no contacts are loaded
//   detail   → DetailPlaceholderView (read-only summary / "Select a contact")
//
// `AppViewModel` is the single orchestration object the SwiftUI shell owns. It
// wraps the `ConstellationStore` types (AppStore, ImportCoordinator, ImportReport)
// so the app *target* only ever imports `ConstellationUI` — it never names a Store
// type directly. Import (menu / drop / Finder-open), the import report, and the
// theme override all live here.

import ConstellationStore
import SwiftUI
import UniformTypeIdentifiers

/// The orchestration object for the SwiftUI shell. `@MainActor @Observable` so the
/// views track its state and every store hop stays on the main actor.
@MainActor
@Observable
public final class AppViewModel {
    /// The application state (Task A). Views read it directly.
    public let store: AppStore
    private let coordinator = ImportCoordinator()
    private let session: SessionStore

    /// Bound to the `.fileImporter` presentation (flipped by File ▸ Import…).
    public var showImporter = false
    /// The most recent import outcome, shown in the completion alert.
    public var report: ImportReport?
    public var showingReport = false
    /// True while an import is parsing (drives the progress overlay).
    public var isImporting = false

    /// Appearance override, applied by the app via `.preferredColorScheme`.
    /// Persisted in `UserDefaults`, mirroring the web app's localStorage theme
    /// (js/app-theme.js): an app-level preference independent of session data,
    /// so it survives even when no contacts are loaded and the session save
    /// skips. The value also rides along in `SessionSettings.themeOverride`
    /// on each autosave to keep `session.json` self-describing.
    public var themeOverride: ThemeOverride

    private static let themeDefaultsKey = "constellation:themeOverride"

    public init(session: SessionStore = SessionStore()) {
        store = AppStore()
        self.session = session
        let raw = UserDefaults.standard.string(forKey: Self.themeDefaultsKey) ?? ""
        themeOverride = ThemeOverride(rawValue: raw) ?? .system
        _ = session.restore(into: store)
        startAutosaveObservation()
    }

    public var resolvedColorScheme: ColorScheme? { themeOverride.colorScheme }

    public func setTheme(_ override: ThemeOverride) {
        themeOverride = override
        UserDefaults.standard.set(override.rawValue, forKey: Self.themeDefaultsKey)
        session.scheduleAutosave(from: store, themeOverride: override)
    }

    /// Debounced session autosave on any persisted-state mutation, re-armed
    /// after each change (Observation tracking is one-shot). Watches exactly
    /// the state that `SessionSettings` persists — selection/search/filter
    /// state is deliberately not persisted, matching the JS payload.
    private func startAutosaveObservation() {
        withObservationTracking {
            _ = store.contacts
            _ = store.selfContactID
            _ = store.workspaceMode
            _ = store.graphMode
            _ = store.contactSortMode
            _ = store.suggestExtendedFamily
            _ = store.showInferred
            _ = store.showLikelyFamily
            _ = store.showLikelyConnections
            _ = store.showIsolated
            _ = store.showVirtual
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.session.scheduleAutosave(from: self.store, themeOverride: self.themeOverride)
                self.startAutosaveObservation()
            }
        }
    }

    /// Import a set of file URLs (menu, drag-drop, or Finder/dock open). File IO
    /// runs off the main actor inside the coordinator; the store mutation hops back.
    public func importURLs(_ urls: [URL]) {
        guard !urls.isEmpty, !isImporting else { return }
        // Sandbox: gain read access to user-selected / dropped files for the read.
        let accessed = urls.filter { $0.startAccessingSecurityScopedResource() }
        isImporting = true
        Task {
            let outcome = await coordinator.importFiles(urls, into: store)
            for url in accessed { url.stopAccessingSecurityScopedResource() }
            report = outcome
            showingReport = true
            isImporting = false
            // Session autosave fires via the observation loop watching
            // `store.contacts`; no explicit trigger needed here.
        }
    }

    /// Handle a `.fileImporter` result.
    public func handleImporterResult(_ result: Result<[URL], Error>) {
        if case let .success(urls) = result {
            importURLs(urls)
        }
    }

    /// A human-readable summary of the last import for the completion alert.
    public var reportMessage: String {
        guard let report else { return "" }
        if let error = report.error {
            switch error {
            case let .unsupportedFile(name):
                return "Couldn't import “\(name)”: unsupported file type. Import .vcf, .md, or .tsv files."
            case .noContactFiles:
                return "No contact files found. Import a .vcf, .md, or .tsv file."
            }
        }
        var lines = ["Imported \(report.imported) contact\(report.imported == 1 ? "" : "s")."]
        if report.missingPhotoRefs > 0 {
            lines.append(
                "\(report.missingPhotoRefs) referenced photo\(report.missingPhotoRefs == 1 ? " was" : "s were") missing from the drop.")
        }
        return lines.joined(separator: "\n")
    }

    /// The content types the open panel accepts (data files + sibling photos).
    public static var importContentTypes: [UTType] {
        var types: [UTType] = [.vCard]
        for ext in ["vcf", "vcard", "md", "markdown", "tsv"] {
            if let t = UTType(filenameExtension: ext) { types.append(t) }
        }
        types.append(.image)
        return types
    }
}

public struct RootView: View {
    @Bindable private var model: AppViewModel

    public init(model: AppViewModel) {
        self.model = model
    }

    public var body: some View {
        NavigationSplitView {
            SidebarView(store: model.store)
        } content: {
            content
        } detail: {
            DetailPlaceholderView(store: model.store)
        }
        // Window-level drag-drop of file URLs.
        .dropDestination(for: URL.self) { urls, _ in
            model.importURLs(urls)
            return true
        }
        .fileImporter(
            isPresented: $model.showImporter,
            allowedContentTypes: AppViewModel.importContentTypes,
            allowsMultipleSelection: true
        ) { result in
            model.handleImporterResult(result)
        }
        .alert(
            "Import", isPresented: $model.showingReport,
            actions: { Button("OK", role: .cancel) {} },
            message: { Text(model.reportMessage) })
        .overlay {
            if model.isImporting {
                ZStack {
                    Color.black.opacity(0.15).ignoresSafeArea()
                    ProgressView("Importing…")
                        .padding(20)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if model.store.contacts.isEmpty {
            EmptyStateView { model.showImporter = true }
        } else {
            WorkspaceView(store: model.store)
        }
    }
}

/// The no-contacts drop target / import hint.
private struct EmptyStateView: View {
    let onImport: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "square.and.arrow.down.on.square")
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)
            Text("No contacts loaded").font(.title3.weight(.semibold))
            Text("Import .vcf / .md / .tsv — drag files here or press ⌘O")
                .foregroundStyle(.secondary)
            Button("Import…", action: onImport)
                .keyboardShortcut("o", modifiers: .command)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    style: StrokeStyle(lineWidth: 2, dash: [8, 6])
                )
                .foregroundStyle(.quaternary)
                .padding(24))
    }
}
