// SessionStore — on-disk session persistence for the native app, ported from
// the JS IndexedDB session (js/app-session.js: `_persistSession` /
// `_restorePersistedSession` / `_resolveSelfContactId` / `_clearPersistedSession`).
//
// The JS app keeps one IndexedDB record holding both the serialized contact
// text and the settings payload together. A native file-per-concern layout is
// simpler to atomically write and to inspect/debug, so this splits that one
// record into two files under
//   ~/Library/Application Support/Constellation/session/
//     data.<vcf|md|tsv>   — contacts serialized by the ACTIVE format adapter
//     session.json        — Codable `SessionSettings` (schema, toggles, self
//                            ref, etc.) — everything from the JS payload
//                            except the serialized content itself.
//
// Fidelity anchors (JS wins over spec):
//   • never persist an empty contact set — JS `_persistSession` guard
//     (`if (!this.contacts.length) return;`).
//   • self-contact re-resolution (uid first, fn lowercased/trimmed fallback)
//     — JS `_resolveSelfContactId`.
//   • legacy graph-mode normalization on restore — JS
//     `_restorePersistedSession` (ported onto `SessionSettings.graphMode`).
//
// `SessionStore` itself is `@MainActor` (it reads/mutates the `@MainActor`
// `AppStore`); the actual file I/O is factored into `nonisolated` static
// helpers so it doesn't implicitly hop through actor-isolated state and stays
// independently testable.

import ConstellationFormats
import ConstellationGraphModel
import ConstellationModel
import Foundation

@MainActor
public final class SessionStore {
    /// Directory this instance reads/writes (injectable for tests; defaults
    /// to `~/Library/Application Support/Constellation/session/`).
    public let directory: URL

    /// Debounce interval for `scheduleAutosave`. Injectable so tests don't
    /// need to wait a full second.
    public let debounceInterval: Duration

    private var autosaveTask: Task<Void, Never>?
    /// The in-flight background write, chained so successive saves can never
    /// land on disk out of order.
    private var pendingWrite: Task<Void, Never>?
    /// Last theme written (or restored), so routine autosaves don't have to
    /// re-read `session.json` from disk just to preserve the theme.
    private var lastKnownTheme: ThemeOverride?

    public init(directory: URL? = nil, debounceInterval: Duration = .seconds(1)) {
        self.directory = directory ?? Self.defaultDirectory()
        self.debounceInterval = debounceInterval
    }

    deinit {
        autosaveTask?.cancel()
    }

    /// `~/Library/Application Support/Constellation/session/`.
    public static func defaultDirectory() -> URL {
        let base =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Constellation", isDirectory: true)
            .appendingPathComponent("session", isDirectory: true)
    }

    // MARK: - File locations

    private nonisolated static let settingsFileName = "session.json"
    private nonisolated static let dataFileBaseName = "data"

    /// One adapter instance per known format id, keyed the same way
    /// `AppStore.activeFormatID` / `SessionSettings.formatID` are.
    private nonisolated static func adapter(for formatID: String) -> any ContactFormatAdapter {
        switch formatID {
        case "markdown": return MarkdownAdapter()
        case "tsv": return TSVAdapter()
        default: return VCardAdapter()
        }
    }

    private var settingsURL: URL {
        directory.appendingPathComponent(Self.settingsFileName)
    }

    private func dataURL(extension ext: String) -> URL {
        directory.appendingPathComponent("\(Self.dataFileBaseName).\(ext)")
    }

    // MARK: - Save

    /// Serializes `store.contacts` via the adapter matching
    /// `store.activeFormatID` to `data.<ext>` and writes `session.json`
    /// alongside it, atomically. No-op when `store.contacts` is empty (JS
    /// `_persistSession` guard) — an autosave firing right after the user
    /// clears their contact list must not clobber a still-useful saved
    /// session.
    ///
    /// `themeOverride` has no `AppStore` analog (theme lives in
    /// `ConstellationUI`; see the file header and integration notes below).
    /// Pass the current value explicitly when the user changes it; when
    /// omitted (e.g. from a toggle/filter-triggered autosave), the
    /// previously-saved theme is preserved so routine autosaves can't
    /// silently reset it to `.system`.
    public func save(from store: AppStore, themeOverride: ThemeOverride? = nil) {
        guard !store.contacts.isEmpty else { return }

        // Everything store-derived is snapshotted here on the main actor;
        // serialization + disk IO then run off-main (M3 gate-review fix) —
        // `Contact` and `SessionSettings` are value types and `Sendable`.
        let contacts = store.contacts
        let formatID = store.activeFormatID

        let resolvedTheme =
            themeOverride
            ?? lastKnownTheme
            ?? Self.readSettings(from: settingsURL)?.themeOverride
            ?? .system
        lastKnownTheme = resolvedTheme

        let settings = SessionSettings(
            fileLabel: store.fileLabel,
            formatID: Self.adapter(for: formatID).id,
            savedAt: Date(),
            selfContactRef: store.selfContactID.flatMap { id in
                store.contact(id).map { SelfContactRef(uid: $0.uid, fn: $0.fn) }
            },
            showInferred: store.showInferred,
            showLikelyFamily: store.showLikelyFamily,
            showLikelyConnections: store.showLikelyConnections,
            showIsolated: store.showIsolated,
            showVirtual: store.showVirtual,
            suggestExtendedFamily: store.suggestExtendedFamily,
            sidebarControlsCollapsed: false,
            contactSortMode: store.contactSortMode,
            graphMode: store.graphMode,
            workspaceMode: store.workspaceMode,
            themeOverride: resolvedTheme
        )

        // Chain onto any in-flight write so saves land on disk in issue order,
        // then serialize + write off the main actor. Best-effort like the JS
        // `_persistSession` catch block: failures are swallowed.
        let directory = self.directory
        let settingsURL = self.settingsURL
        let previousWrite = pendingWrite
        pendingWrite = Task.detached(priority: .utility) {
            await previousWrite?.value
            let adapter = Self.adapter(for: formatID)
            let content = adapter.serialize(contacts)
            try? Self.writeSession(
                content: content,
                dataExtension: adapter.extensions.first ?? "vcf",
                settings: settings,
                directory: directory,
                settingsURL: settingsURL,
                dataURLProvider: { ext in
                    directory.appendingPathComponent("\(Self.dataFileBaseName).\(ext)")
                }
            )
        }
    }

    /// Awaits any in-flight background write — tests use this to make `save`
    /// observable without sleeping.
    public func flushPendingWrites() async {
        await pendingWrite?.value
    }

    /// Debounced autosave: cancels any pending save and schedules a new one
    /// `debounceInterval` out (cancel-and-replace Task debounce). Calling this
    /// twice in quick succession results in exactly one write.
    public func scheduleAutosave(from store: AppStore, themeOverride: ThemeOverride? = nil) {
        autosaveTask?.cancel()
        autosaveTask = Task { [weak self, debounceInterval] in
            try? await Task.sleep(for: debounceInterval)
            guard !Task.isCancelled, let self else { return }
            self.save(from: store, themeOverride: themeOverride)
        }
    }

    // MARK: - Restore

    /// Reads `session.json` + the matching `data.<ext>` file, parses via the
    /// saved format's adapter, loads the contacts into `store`, applies the
    /// saved toggle/sort/mode settings, then resolves the self-contact
    /// reference (uid first, fn fallback — JS `_resolveSelfContactId`).
    /// Returns whether a session was actually restored; on any failure
    /// (missing files, corrupt/unreadable JSON, empty parse) `store` is left
    /// untouched and `false` is returned.
    @discardableResult
    public func restore(into store: AppStore) -> Bool {
        guard let settings = Self.readSettings(from: settingsURL),
            settings.schemaVersion == SessionSettings.currentSchemaVersion
        else { return false }

        let adapter = Self.adapter(for: settings.formatID)
        let ext = adapter.extensions.first ?? "vcf"
        guard let content = try? String(contentsOf: dataURL(extension: ext), encoding: .utf8)
        else { return false }

        let parsed = adapter.parse(content)
        guard !parsed.contacts.isEmpty else { return false }

        lastKnownTheme = settings.themeOverride
        store.loadContacts(parsed.contacts, fileLabel: settings.fileLabel, activeFormatID: adapter.id)

        store.setGraphMode(settings.graphMode)
        store.setShowInferred(settings.showInferred)
        store.setShowLikelyFamily(settings.showLikelyFamily)
        store.setShowLikelyConnections(settings.showLikelyConnections)
        store.setShowIsolated(settings.showIsolated)
        store.setShowVirtual(settings.showVirtual)
        store.suggestExtendedFamily = settings.suggestExtendedFamily
        store.contactSortMode = settings.contactSortMode
        store.workspaceMode = settings.workspaceMode

        let selfID = Self.resolveSelfContactId(settings.selfContactRef, in: store)
        store.setSelfContact(selfID)

        return true
    }

    /// JS `_resolveSelfContactId`, ported verbatim: uid lookup first, then a
    /// lowercased/trimmed `fn` lookup, `nil` when neither resolves.
    static func resolveSelfContactId(_ ref: SelfContactRef?, in store: AppStore) -> String? {
        guard let ref else { return nil }
        if let uid = ref.uid, !uid.isEmpty, let byUid = store.contactsByUid[uid] {
            return byUid.id
        }
        if let fn = ref.fn, !fn.isEmpty {
            let key = fn.lowercased().trimmingCharacters(in: .whitespaces)
            if let byFn = store.contactsByFn[key]?.first {
                return byFn.id
            }
        }
        return nil
    }

    // MARK: - Clear

    /// Deletes any saved session (`session.json` + every known `data.*`).
    /// Best-effort, like the JS `_clearPersistedSession`.
    public func clear() {
        try? FileManager.default.removeItem(at: settingsURL)
        for ext in Self.allKnownExtensions {
            try? FileManager.default.removeItem(at: dataURL(extension: ext))
        }
    }

    /// Canonical extensions for every known adapter, used to sweep stale
    /// `data.*` files (see `writeSession` below) and by `clear()`.
    nonisolated private static let allKnownExtensions = ["vcf", "md", "tsv"]

    // MARK: - Nonisolated file I/O

    /// Reads and decodes `session.json`. Returns `nil` on any failure
    /// (missing file, malformed JSON, schema mismatch) — corrupt state is
    /// treated as "nothing saved," never a crash.
    nonisolated static func readSettings(from url: URL) -> SessionSettings? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(SessionSettings.self, from: data)
    }

    /// Writes `data.<dataExtension>` + `session.json` atomically, then sweeps
    /// any other `data.*` left over from a previous, different active format
    /// (switching vcard → markdown → tsv would otherwise accumulate stale
    /// data files forever — the JS has no analog for this since its single
    /// IndexedDB key just gets overwritten).
    nonisolated static func writeSession(
        content: String,
        dataExtension: String,
        settings: SessionSettings,
        directory: URL,
        settingsURL: URL,
        dataURLProvider: (String) -> URL
    ) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let settingsData = try encoder.encode(settings)

        try content.data(using: .utf8)?.write(to: dataURLProvider(dataExtension), options: .atomic)
        try settingsData.write(to: settingsURL, options: .atomic)

        for ext in allKnownExtensions where ext != dataExtension {
            let staleURL = dataURLProvider(ext)
            if FileManager.default.fileExists(atPath: staleURL.path) {
                try? FileManager.default.removeItem(at: staleURL)
            }
        }
    }
}
