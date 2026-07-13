import ConstellationUI
import SwiftUI

@main
struct ConstellationApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppViewModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .preferredColorScheme(model.resolvedColorScheme)
                .frame(minWidth: 900, minHeight: 560)
                // Hand the model to the app delegate so Finder/dock file opens
                // (`application(_:open:)`) route through the same import flow.
                .task { appDelegate.attach(model) }
        }
        .commands {
            // File ▸ Import…  (⌘O)
            CommandGroup(replacing: .importExport) {
                Button("Import…") { model.showImporter = true }
                    .keyboardShortcut("o", modifiers: .command)
            }
            // View ▸ Appearance ▸ System / Light / Dark
            CommandGroup(after: .toolbar) {
                Menu("Appearance") {
                    Picker(
                        "Appearance",
                        selection: Binding(
                            get: { model.themeOverride },
                            set: { model.setTheme($0) })
                    ) {
                        ForEach(ThemeOverride.allCases, id: \.self) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.inline)
                }
            }
        }
    }
}

/// App delegate for Finder/dock file opens. NSApplicationDelegateAdaptor owns the
/// instance, so the SwiftUI app hands it the view model via `attach(_:)`. URLs
/// that arrive before the model is attached (a launch *caused* by opening a file)
/// are queued and flushed on attach.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private weak var model: AppViewModel?
    private var pending: [URL] = []

    func attach(_ model: AppViewModel) {
        self.model = model
        if !pending.isEmpty {
            let queued = pending
            pending = []
            model.importURLs(queued)
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        if let model {
            model.importURLs(urls)
        } else {
            pending.append(contentsOf: urls)
        }
    }
}
