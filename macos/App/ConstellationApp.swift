import ConstellationUI
import SwiftUI

@main
struct ConstellationApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppViewModel()

    init() {
        #if DEBUG
            // Debug-only visual verification: `--screenshot-graph <out.png>
            // [--vcf <path>]` imports a VCF, settles the graph, writes a PNG,
            // and quits without ever showing a window.
            GraphScreenshotCommand.runIfRequested()
        #endif
    }

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

#if DEBUG
    import Foundation

    /// Parses the `--screenshot-graph` launch flag and, when present, renders the
    /// graph to a PNG and exits before any window appears. Debug builds only.
    enum GraphScreenshotCommand {
        static func runIfRequested() {
            let args = CommandLine.arguments
            if args.contains("--perf-graph") {
                MainActor.assumeIsolated {
                    FileHandle.standardError.write(Data(GraphScreenshot.perfReport().utf8))
                    exit(0)
                }
            }
            guard let outIdx = args.firstIndex(of: "--screenshot-graph"),
                outIdx + 1 < args.count
            else { return }
            let outPath = args[outIdx + 1]
            let synthetic = args.contains("--synthetic")
            let vcfPath = value(of: "--vcf", in: args)

            MainActor.assumeIsolated {
                // The app is sandboxed, so read the VCF from stdin (`--vcf -`)
                // and write the PNG to stdout (`--screenshot-graph -`) when a
                // literal file path is out of reach; both handles are provided
                // by the (unsandboxed) parent shell.
                let data: Data?
                if synthetic {
                    data = GraphScreenshot.syntheticPNGData()
                } else if let vcfPath {
                    let text: String?
                    if vcfPath == "-" {
                        text = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8)
                    } else {
                        text = try? String(contentsOfFile: vcfPath, encoding: .utf8)
                    }
                    data = text.flatMap { GraphScreenshot.pngData(vcfText: $0) }
                } else {
                    FileHandle.standardError.write(
                        Data("--screenshot-graph needs --vcf <path|-> (or --synthetic)\n".utf8))
                    data = nil
                }

                guard let data else { exit(1) }
                if outPath == "-" {
                    FileHandle.standardOutput.write(data)
                } else {
                    do { try data.write(to: URL(fileURLWithPath: outPath)) }
                    catch {
                        FileHandle.standardError.write(Data("screenshot: write failed: \(error)\n".utf8))
                        exit(1)
                    }
                }
                exit(0)
            }
        }

        private static func value(of flag: String, in args: [String]) -> String? {
            guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
            return args[idx + 1]
        }
    }
#endif

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
