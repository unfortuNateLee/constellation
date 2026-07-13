import ConstellationModel
import Foundation

/// Options passed to `ContactFormatAdapter.parse`.
///
/// `photoMap` maps sibling image filenames to data URLs so externalized
/// Markdown photo references resolve on import (DESIGN_SPEC §8.1.2).
///
/// `startIndex` offsets each parsed contact's `sourceDocuments.index` (JS
/// `options.startIndex`): multi-file imports pass a running offset so a bundle's
/// documents number contiguously across files.
public struct ParseOptions: Sendable {
    public var photoMap: [String: String]
    public var startIndex: Int

    public init(photoMap: [String: String] = [:], startIndex: Int = 0) {
        self.photoMap = photoMap
        self.startIndex = startIndex
    }
}

/// Result of parsing a contact document.
///
/// `missingPhotoRefs` lists referenced photo filenames that were absent from
/// `ParseOptions.photoMap`, so the UI can report the count (DESIGN_SPEC §8.1.2).
public struct ParseResult: Sendable {
    public var contacts: [Contact]
    public var missingPhotoRefs: [String]

    public init(contacts: [Contact], missingPhotoRefs: [String] = []) {
        self.contacts = contacts
        self.missingPhotoRefs = missingPhotoRefs
    }
}

/// File formats enter and leave the app through small adapters rather than
/// directly through UI/controller code (DESIGN_SPEC §8.1.2). The controller
/// picks an adapter for an imported file by `canImportFile(named:)` and never
/// branches on format itself.
public protocol ContactFormatAdapter: Sendable {
    /// Stable adapter id: "vcard" | "markdown" | "tsv".
    var id: String { get }
    /// Human-facing format label.
    var label: String { get }
    /// Lowercased file extensions without the dot, e.g. ["vcf"].
    var extensions: [String] { get }
    var mimeType: String { get }

    func canImportFile(named fileName: String) -> Bool
    /// Parsers are lenient and never throw; malformed input yields fewer/empty contacts.
    func parse(_ text: String, options: ParseOptions) -> ParseResult
    /// Serialize `contacts`, optionally restricted to `ids` (contact `id` values),
    /// preserving input order.
    func serialize(_ contacts: [Contact], ids: Set<String>?) -> String
}

extension ContactFormatAdapter {
    public func canImportFile(named fileName: String) -> Bool {
        let ext = (fileName as NSString).pathExtension.lowercased()
        return extensions.contains(ext)
    }

    public func parse(_ text: String) -> ParseResult {
        parse(text, options: ParseOptions())
    }

    public func serialize(_ contacts: [Contact]) -> String {
        serialize(contacts, ids: nil)
    }
}
