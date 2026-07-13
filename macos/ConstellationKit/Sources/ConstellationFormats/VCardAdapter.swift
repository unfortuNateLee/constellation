import ConstellationModel
import Foundation

/// vCard format adapter (port of js/vcard-adapter.js).
///
/// Wraps the parser and raw-vCard serialization rules behind the shape every
/// file format implements. This adapter is the format boundary.
public struct VCardAdapter: ContactFormatAdapter {
    public let id = "vcard"
    public let label = "vCard"
    public let extensions = ["vcf", "vcard"]
    public let mimeType = "text/vcard;charset=utf-8"

    public init() {}

    public func canImportFile(named fileName: String) -> Bool {
        let name = fileName.lowercased()
        return extensions.contains { name.hasSuffix(".\($0)") }
    }

    public func parse(_ text: String, options: ParseOptions) -> ParseResult {
        ParseResult(contacts: parse(text, startIndex: options.startIndex))
    }

    /// JS `parse(text, {startIndex})`: multi-file imports offset each contact's
    /// sourceDocuments index so bundles number contiguously.
    public func parse(_ text: String, startIndex: Int) -> [Contact] {
        var contacts = VCFParser().parse(text)
        for i in contacts.indices {
            contacts[i].sourceDocuments = [
                SourceDocument(
                    format: id,
                    raw: contacts[i].rawVCard ?? "",
                    index: startIndex + i,
                    dirty: false
                )
            ]
        }
        return contacts
    }

    public func serialize(_ contacts: [Contact], ids: Set<String>?) -> String {
        var blocks: [String] = []
        for contact in contacts {
            if let ids, !ids.contains(contact.id) { continue }
            // The raw card (kept in sync by the edit paths) is the source of
            // truth; contacts without one (Markdown/TSV imports) are generated
            // from the model by the shared serializer.
            let block = VCardSerializer.serializeContact(contact)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !block.isEmpty { blocks.append(block) }
        }
        return blocks.isEmpty ? "" : blocks.joined(separator: "\r\n") + "\r\n"
    }
}
