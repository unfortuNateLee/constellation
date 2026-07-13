// ImportCoordinator — the native port of the js/app.js `_loadFiles` import flow
// (lines 571–656). Reads a multi-file drop off the main actor, then applies the
// parsed contacts to the store on the main actor.
//
// Semantics mirrored from js/app.js (JS wins over spec):
//   • Partition (`_adapterForFile` / `_isImageFile`): files an adapter claims are
//     "data" files; image files become sibling photos; anything else is an
//     unsupported drop that aborts the whole import (JS shows a toast + returns).
//   • Sibling photos (line 595): each image is read into a `filename→data-URL`
//     map (key lowercased, JS `img.name.toLowerCase()`); the Markdown adapter
//     resolves `photo: <filename>` refs against it.
//   • Running `startIndex` (line 611): each file parses with `startIndex =`
//     the running contact count so `sourceDocuments.index` numbers contiguously
//     across the whole drop. (Per-file stable-id accumulators are internal to
//     each adapter's `parse`, exactly as in the JS adapters — only startIndex
//     threads across files.)
//   • Merge vs replace (line 628): a second import REPLACES the contact set; it
//     never appends. `AppStore.loadContacts` does the replace.
//   • Active format (lines 613–615): the running format id is `mixed` once two
//     adapters disagree, and the final stored format collapses to `markdown`
//     only for a pure-Markdown drop, else `vcard`.

import ConstellationFormats
import ConstellationModel
import Foundation

/// Outcome of an import (JS toasts derive from these counts).
public struct ImportReport: Sendable, Equatable {
    /// Contacts imported (0 on a failed/aborted import).
    public var imported: Int
    /// Files skipped as unsupported (non-data, non-image) — an aborted import.
    public var skipped: Int
    /// Contacts whose Markdown referenced a photo file absent from the drop
    /// (JS `missingPhotos`).
    public var missingPhotoRefs: Int
    /// File label applied to the store ("<name>" or "N files"); empty on failure.
    public var fileLabel: String
    /// Active format id applied to the store.
    public var activeFormatID: String
    /// Non-nil when the import was aborted without mutating the store.
    public var error: ImportError?

    public init(
        imported: Int, skipped: Int, missingPhotoRefs: Int,
        fileLabel: String, activeFormatID: String, error: ImportError? = nil
    ) {
        self.imported = imported
        self.skipped = skipped
        self.missingPhotoRefs = missingPhotoRefs
        self.fileLabel = fileLabel
        self.activeFormatID = activeFormatID
        self.error = error
    }
}

/// Reasons an import aborts without touching the store (JS returns early after a
/// toast).
public enum ImportError: Sendable, Equatable {
    /// A dropped file matched no adapter and was not an image (JS "Unsupported
    /// file type"). Carries the offending file name.
    case unsupportedFile(String)
    /// No data files at all in the drop (JS "Add a .vcf, .md, or .tsv file").
    case noContactFiles
}

public struct ImportCoordinator: Sendable {
    public let adapters: [any ContactFormatAdapter]

    public init(adapters: [any ContactFormatAdapter] = [VCardAdapter(), MarkdownAdapter(), TSVAdapter()]) {
        self.adapters = adapters
    }

    /// Import `urls` into `store`, replacing its contacts (JS `_loadFiles`). File
    /// IO runs off the main actor; the store mutation hops back to the main actor.
    @discardableResult
    public func importFiles(_ urls: [URL], into store: AppStore) async -> ImportReport {
        switch await prepareImport(urls) {
        case let .failure(error, skipped):
            return ImportReport(
                imported: 0, skipped: skipped, missingPhotoRefs: 0,
                fileLabel: "", activeFormatID: "", error: error)
        case let .success(prepared):
            await store.loadContacts(
                prepared.contacts,
                fileLabel: prepared.fileLabel,
                activeFormatID: prepared.activeFormatID)
            return ImportReport(
                imported: prepared.contacts.count,
                skipped: 0,
                missingPhotoRefs: prepared.missingPhotoRefs,
                fileLabel: prepared.fileLabel,
                activeFormatID: prepared.activeFormatID,
                error: nil)
        }
    }

    // MARK: - Parse (off-main, pure)

    /// The parsed result of a drop, before it touches the store. Exposed for
    /// tests that assert contacts / photo resolution without a store.
    public struct Prepared: Sendable {
        public var contacts: [Contact]
        public var missingPhotoRefs: Int
        public var fileLabel: String
        public var activeFormatID: String
    }

    public enum PrepareOutcome: Sendable {
        case success(Prepared)
        case failure(ImportError, skipped: Int)
    }

    /// Read + parse the drop entirely off the main actor. Nonisolated so file IO
    /// never blocks the UI (JS reads via async `File.text()` / `FileReader`).
    public func prepareImport(_ urls: [URL]) async -> PrepareOutcome {
        let all = urls
        let dataFiles = all.filter { adapterForFile($0) != nil }
        let imageFiles = all.filter { adapterForFile($0) == nil && Self.isImageFile($0) }
        let unknown = all.filter { adapterForFile($0) == nil && !Self.isImageFile($0) }

        // JS aborts the whole import on the first unsupported file.
        if let bad = unknown.first {
            return .failure(.unsupportedFile(bad.lastPathComponent), skipped: unknown.count)
        }
        if dataFiles.isEmpty {
            return .failure(.noContactFiles, skipped: 0)
        }

        // Sibling images → filename(lowercased) → data URL (JS photoMap).
        var photoMap: [String: String] = [:]
        for img in imageFiles {
            if let dataURL = Self.dataURL(for: img) {
                photoMap[img.lastPathComponent.lowercased()] = dataURL
            }
        }

        var contacts: [Contact] = []
        var missingPhotoRefs = 0
        var runningFormatID: String? = nil

        for file in dataFiles {
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            let adapter = adapterForFile(file) ?? adapters[0]
            // Running startIndex across the whole drop (JS `startIndex:
            // contacts.length`); per-file id accumulators live inside `parse`.
            let result = adapter.parse(text, options: ParseOptions(photoMap: photoMap, startIndex: contacts.count))
            contacts.append(contentsOf: result.contacts)
            missingPhotoRefs += result.missingPhotoRefs.count
            runningFormatID = (runningFormatID != nil && runningFormatID != adapter.id) ? "mixed" : adapter.id
        }

        // JS: final stored format is `markdown` only for a pure-Markdown drop.
        let activeFormatID = runningFormatID == "markdown" ? "markdown" : "vcard"
        let label = dataFiles.count == 1 ? dataFiles[0].lastPathComponent : "\(dataFiles.count) files"

        return .success(Prepared(
            contacts: contacts,
            missingPhotoRefs: missingPhotoRefs,
            fileLabel: label,
            activeFormatID: activeFormatID))
    }

    // MARK: - Partition helpers (JS `_adapterForFile` / `_isImageFile`)

    public func adapterForFile(_ url: URL) -> (any ContactFormatAdapter)? {
        adapters.first { $0.canImportFile(named: url.lastPathComponent) }
    }

    /// JS `_isImageFile` — the extension test half (the native drop only carries
    /// URLs, so the MIME-type half is covered by the same extension set).
    static let imageExtensions: Set<String> = [
        "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff",
    ]

    static func isImageFile(_ url: URL) -> Bool {
        imageExtensions.contains(url.pathExtension.lowercased())
    }

    /// Read an image file into a `data:<mime>;base64,…` URL (JS `readAsDataURL`).
    static func dataURL(for url: URL) -> String? {
        guard let bytes = try? Data(contentsOf: url) else { return nil }
        let mime = mimeType(forExtension: url.pathExtension.lowercased())
        return "data:\(mime);base64," + bytes.base64EncodedString()
    }

    static func mimeType(forExtension ext: String) -> String {
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        case "heif": return "image/heif"
        case "bmp": return "image/bmp"
        case "tif", "tiff": return "image/tiff"
        default: return "application/octet-stream"
        }
    }
}
