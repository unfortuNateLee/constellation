// Port of js/tsv-adapter.js — a flat, spreadsheet-friendly TSV (tab-separated)
// contact format for bulk editing. One contact per row; the header row names
// the columns (see `columns` for the fixed order). Multi-valued fields
// (emails, phones, urls, relationships) are a `' | '`-joined list where each
// item may carry a type in brackets, e.g. `[home] jane@x.com | [work]
// jane@y.com`. A single address is spread across street/city/state/zip/
// country/address_type columns.
//
// TSV is intentionally simplified (one address, a single type per value, no
// photo) — vCard / Markdown remain the lossless formats. Behavior is
// byte-for-byte with the JS; see DESIGN_SPEC.md §8.1.4.

import ConstellationModel
import Foundation

public struct TSVAdapter: ContactFormatAdapter {
    public init() {}

    public var id: String { "tsv" }
    public var label: String { "TSV" }
    public var extensions: [String] { ["tsv"] }
    public var mimeType: String { "text/tab-separated-values;charset=utf-8" }

    /// Header order = the order columns must be provided in (js `this.COLUMNS`).
    public static let columns: [String] = [
        "uid",
        "prefix",
        "first",
        "middle",
        "last",
        "suffix",
        "display_name",
        "organization",
        "title",
        "gender",
        "is_company",
        "emails",
        "phones",
        "street",
        "city",
        "state",
        "zip",
        "country",
        "address_type",
        "birthday",
        "anniversary",
        "urls",
        "relationships",
        "tags",
        "notes",
    ]

    // MARK: - Import

    public func parse(_ text: String, options: ParseOptions) -> ParseResult {
        var stripped = text
        if stripped.hasPrefix("\u{FEFF}") {
            stripped.removeFirst()
        }
        // js: `.split(/\r\n|\n/)` — a lone `\r` (no following `\n`) is NOT a line
        // break; normalizing real CRLF to LF first and then splitting on LF alone
        // yields the identical partition (a solitary `\r` stays glued to its line).
        let lines = stripped
            .replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n")

        var h = 0
        while h < lines.count, lines[h].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            h += 1
        }
        guard h < lines.count else { return ParseResult(contacts: []) }

        let headers = lines[h].components(separatedBy: "\t")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

        var contacts: [Contact] = []
        var allocator = StableIDAllocator()
        for i in (h + 1)..<lines.count {
            if lines[i].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            let cells = lines[i].components(separatedBy: "\t")
            var row: [String: String] = [:]
            for (idx, name) in headers.enumerated() {
                row[name] = Self.unescape(idx < cells.count ? cells[idx] : "")
            }
            let index = contacts.count
            contacts.append(Self.contact(fromRow: row, index: index, allocator: &allocator))
        }
        return ParseResult(contacts: contacts)
    }

    private static func contact(
        fromRow row: [String: String], index: Int, allocator: inout StableIDAllocator
    ) -> Contact {
        var contact = Contact()

        let uidRaw = row["uid"] ?? ""
        contact.uid = uidRaw.isEmpty ? nil : uidRaw

        let prefix = row["prefix"] ?? ""
        let first = row["first"] ?? ""
        let middle = row["middle"] ?? ""
        let last = row["last"] ?? ""
        let suffix = row["suffix"] ?? ""
        contact.name = StructuredName(
            family: last, given: first, additional: middle, prefix: prefix, suffix: suffix)

        let displayName = row["display_name"] ?? ""
        let composed = composeDisplayName(contact.name)
        contact.fn =
            !displayName.isEmpty
            ? displayName : (!composed.isEmpty ? composed : (!uidRaw.isEmpty ? uidRaw : "Contact"))

        contact.org = row["organization"] ?? ""
        contact.title = row["title"] ?? ""

        let genderRaw = row["gender"] ?? ""
        if let f = genderRaw.first, f.lowercased() == "m" {
            contact.gender = "M"
        } else if let f = genderRaw.first, f.lowercased() == "f" {
            contact.gender = "F"
        } else {
            contact.gender = ""
        }

        let isCompanyRaw = (row["is_company"] ?? "").lowercased()
        contact.isCompany = ["true", "yes", "1"].contains(isCompanyRaw)

        contact.emails = parseTypedList(row["emails"]).map {
            LabeledValue(value: $0.value, types: $0.types)
        }
        contact.phones = parseTypedList(row["phones"]).map {
            LabeledValue(value: $0.value, types: $0.types)
        }
        contact.urls = parseTypedList(row["urls"]).map {
            LabeledValue(value: $0.value, types: $0.types)
        }
        contact.related = parseTypedList(row["relationships"]).map { entry in
            let type = RelationshipTaxonomy.normalize(
                entry.types.first?.lowercased() ?? "")
            return RelatedValue(
                name: entry.value, type: type, rawType: RelationshipTaxonomy.vcardLabel(type))
        }

        if let addr = address(fromRow: row) {
            contact.addresses = [addr]
        }

        let birthday = row["birthday"] ?? ""
        contact.birthday = birthday.isEmpty ? nil : birthday
        let anniversary = row["anniversary"] ?? ""
        contact.anniversary = anniversary.isEmpty ? nil : anniversary

        // Multiple notes are joined with a blank line on export (see rowFor); split
        // them back so N notes round-trip. A single note with internal newlines
        // stays intact (only a blank-line separator splits).
        let notesRaw = row["notes"] ?? ""
        contact.notes = notesRaw.isEmpty ? [] : notesRaw.components(separatedBy: "\n\n")

        contact.tags = (row["tags"] ?? "")
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        contact.noteTags = NoteHashtags.extract(from: contact.notes)
        if contact.tags.isEmpty, contact.isCompany {
            contact.tags = ["company"]
        }

        contact.id = allocator.assign(uid: contact.uid, fn: contact.fn)
        contact.sourceDocuments = [SourceDocument(format: "tsv", raw: "", index: index, dirty: false)]
        return contact
    }

    private static func address(fromRow row: [String: String]) -> AddressValue? {
        let street = row["street"] ?? ""
        let city = row["city"] ?? ""
        let state = row["state"] ?? ""
        let zip = row["zip"] ?? ""
        let country = row["country"] ?? ""
        guard !street.isEmpty || !city.isEmpty || !state.isEmpty || !zip.isEmpty || !country.isEmpty
        else { return nil }
        let addressType = row["address_type"] ?? ""
        return AddressValue(
            pobox: "", ext: "", street: street, city: city, state: state, zip: zip,
            country: country,
            types: addressType.isEmpty ? [] : [addressType.uppercased()])
    }

    // MARK: - Export

    public func serialize(_ contacts: [Contact], ids: Set<String>?) -> String {
        let selected = contacts.filter { ids == nil || ids!.contains($0.id) }
        let rows = selected.map { Self.row(for: $0) }
        return ([Self.columns.joined(separator: "\t")] + rows).joined(separator: "\n") + "\n"
    }

    /// Header row plus one example row showing the expected format.
    public func templateText() -> String {
        let example: [String: String] = [
            "uid": "",
            "prefix": "Dr.",
            "first": "Jane",
            "middle": "Q.",
            "last": "Doe",
            "suffix": "PhD",
            "display_name": "Dr. Jane Q. Doe",
            "organization": "Example Labs",
            "title": "Principal",
            "is_company": "FALSE",
            "emails": "[home] jane@example.com | [work] jane@work.example",
            "phones": "[cell] 555-0100 | [home] 555-0101",
            "street": "123 Main St",
            "city": "Springfield",
            "state": "CA",
            "zip": "90210",
            "country": "USA",
            "address_type": "home",
            "birthday": "1990-04-15",
            "anniversary": "2015-06-20",
            "urls": "[work] https://example.com/jane",
            "relationships": "[spouse] John Doe | [child] Sam Doe",
            "tags": "vip | lead",
            "notes": "Met at the conference. #vip",
        ]
        let exampleRow = Self.columns.map { Self.escape(example[$0] ?? "") }.joined(separator: "\t")
        return "\(Self.columns.joined(separator: "\t"))\n\(exampleRow)\n"
    }

    private static func row(for contact: Contact) -> String {
        let name = contact.name
        let addr = preferredAddress(contact.addresses)
        let cell: [String: String] = [
            "uid": contact.uid ?? "",
            "prefix": name.prefix,
            "first": name.given,
            "middle": name.additional,
            "last": name.family,
            "suffix": name.suffix,
            "display_name": contact.fn,
            "organization": contact.org,
            "title": contact.title,
            "gender": contact.gender,
            "is_company": contact.isCompany ? "TRUE" : "FALSE",
            "emails": formatTypedList(contact.emails),
            "phones": formatTypedList(contact.phones),
            "street": addr?.street ?? "",
            "city": addr?.city ?? "",
            "state": addr?.state ?? "",
            "zip": addr?.zip ?? "",
            "country": addr?.country ?? "",
            "address_type": primaryType(addr?.types ?? []),
            "birthday": contact.birthday ?? "",
            "anniversary": contact.anniversary ?? "",
            "urls": formatTypedList(contact.urls),
            "relationships": contact.related
                .filter { !$0.name.isEmpty }
                .map { $0.type.isEmpty ? $0.name : "[\($0.type)] \($0.name)" }
                .joined(separator: " | "),
            "tags": contact.tags.joined(separator: " | "),
            // Blank-line separator so multiple notes survive the round-trip (a
            // single note keeps its own internal newlines).
            "notes": contact.notes.joined(separator: "\n\n"),
        ]
        return columns.map { Self.escape(cell[$0] ?? "") }.joined(separator: "\t")
    }

    // MARK: - Helpers

    private struct TypedEntry {
        var value: String
        var types: [String]
    }

    // js: `^\[([^\]]+)\]\s*(.*)$` — `[^\]]+` requires at least one char inside
    // the brackets, so an empty `[]` does NOT match and the whole segment
    // (including the literal brackets) becomes the plain value.
    private static let bracketRegex = try! NSRegularExpression(
        pattern: "^\\[([^\\]]+)\\]\\s*(.*)$")

    private static func parseTypedList(_ value: String?) -> [TypedEntry] {
        (value ?? "")
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map { part -> TypedEntry in
                let range = NSRange(part.startIndex..., in: part)
                if let match = bracketRegex.firstMatch(in: part, range: range),
                    let bracketRange = Range(match.range(at: 1), in: part),
                    let valueRange = Range(match.range(at: 2), in: part)
                {
                    let bracket = String(part[bracketRange]).trimmingCharacters(
                        in: .whitespacesAndNewlines)
                    let val = String(part[valueRange]).trimmingCharacters(
                        in: .whitespacesAndNewlines)
                    return TypedEntry(value: val, types: bracket.isEmpty ? [] : [bracket.uppercased()])
                }
                return TypedEntry(value: part, types: [])
            }
            .filter { !$0.value.isEmpty }
    }

    private static func formatTypedList(_ entries: [LabeledValue]) -> String {
        entries.compactMap { entry -> String? in
            guard !entry.value.isEmpty else { return nil }
            let type = primaryType(entry.types)
            return type.isEmpty ? entry.value : "[\(type)] \(entry.value)"
        }.joined(separator: " | ")
    }

    // Pick the human-meaningful label from a vCard type list (skip protocol noise).
    private static func primaryType(_ types: [String]) -> String {
        for type in types {
            let upper = type.uppercased()
            if upper == "INTERNET" || upper == "VOICE" || upper == "PREF" { continue }
            return type.lowercased()
        }
        return ""
    }

    private static func preferredAddress(_ addresses: [AddressValue]) -> AddressValue? {
        guard !addresses.isEmpty else { return nil }
        func score(_ a: AddressValue) -> Int {
            let types = a.types.map { $0.lowercased() }
            if types.contains("home") { return 0 }
            if types.contains("work") { return 1 }
            return 2
        }
        return addresses.sorted { score($0) < score($1) }.first
    }

    private static func composeDisplayName(_ name: StructuredName) -> String {
        let parts = [name.prefix, name.given, name.additional, name.family, name.suffix]
            .filter { !$0.isEmpty }
        let joined = parts.joined(separator: " ")
        // js: `.replace(/\s+/g, ' ').trim()`
        let collapsed = joined.split(separator: " ", omittingEmptySubsequences: true).joined(
            separator: " ")
        return collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // TSV cells can't contain raw tabs / newlines — escape them (and backslash).
    // js does three sequential global replaces (`\`→`\\`, tab→`\t`, `\r?\n`→`\n`);
    // since none of those patterns overlap or introduce new instances of an
    // earlier pattern, a single left-to-right scan is equivalent. Note a lone
    // `\r` (no following `\n`) is NOT escaped — it passes through verbatim,
    // matching the JS regex `\r?\n` which requires the `\n`.
    //
    // Operates over `unicodeScalars` rather than `Character`s: Swift's grapheme
    // clustering (UAX #29 GB3) fuses an adjacent CR+LF into a single
    // `Character`, which would break the CR-lookahead below if done at the
    // `Character` level.
    static func escape(_ value: String) -> String {
        var out = ""
        let scalars = Array(value.unicodeScalars)
        var i = 0
        while i < scalars.count {
            let c = scalars[i]
            if c == "\\" {
                out += "\\\\"
                i += 1
            } else if c == "\t" {
                out += "\\t"
                i += 1
            } else if c == "\r", i + 1 < scalars.count, scalars[i + 1] == "\n" {
                out += "\\n"
                i += 2
            } else if c == "\n" {
                out += "\\n"
                i += 1
            } else {
                out.unicodeScalars.append(c)
                i += 1
            }
        }
        return out
    }

    static func unescape(_ value: String) -> String {
        let scalars = Array(value.unicodeScalars)
        var out = ""
        var i = 0
        while i < scalars.count {
            let c = scalars[i]
            if c == "\\", i + 1 < scalars.count {
                let next = scalars[i + 1]
                if next == "t" {
                    out += "\t"
                } else if next == "n" {
                    out += "\n"
                } else {
                    out.unicodeScalars.append(next)
                }
                i += 2
            } else {
                out.unicodeScalars.append(c)
                i += 1
            }
        }
        return out
    }
}
