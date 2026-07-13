// Port of js/markdown-adapter.js — the human-readable, hand-editable Markdown
// contact format.
//
// Each contact is an `## ` heading: identity fields as a bullet list under the
// name, each multi-value field group as its own `### ` section with a uniform
// `- **<label>:** <value>` line per entry. A bundle is several `##` contacts in
// one document (an optional leading `# Title` is ignored). The JS reference
// implementation wins over DESIGN_SPEC on any disagreement; this port reproduces
// its parse output and byte-identical serialization.
//
// NOTE ON ORDERING: the JS keeps custom fields (and nested JSON objects) in
// insertion order via plain JS objects, and the serializer depends on that order
// (`Object.entries` + `JSON.stringify`). The Swift `Contact` model preserves the
// same order natively — `customFields` is an `OrderedDictionary` and nested
// payloads are `JSONObject`s — so this adapter reads and writes order directly,
// with no out-of-band bookkeeping. Byte-exact `JSON.stringify` lives in the
// shared `JSONCodec`. (There is no YAML frontmatter in the reference
// implementation, despite the format's name; the format is the
// heading/bullet/section structure ported here.)

import ConstellationModel
import Foundation

public struct MarkdownAdapter: ContactFormatAdapter {
    public let id = "markdown"
    public let label = "Markdown"
    public let extensions = ["md", "markdown"]
    public let mimeType = "text/markdown;charset=utf-8"

    /// Test seam: block indices whose parse should be simulated as failing
    /// (mirrors the JS per-block try/catch that skips a malformed contact).
    let failingBlockIndices: Set<Int>

    public init() { failingBlockIndices = [] }

    init(failingBlockIndices: Set<Int>) { self.failingBlockIndices = failingBlockIndices }

    public func canImportFile(named fileName: String) -> Bool {
        let lower = fileName.lowercased()
        return extensions.contains { lower.hasSuffix(".\($0)") }
    }

    // MARK: - Identity field registry

    /// Identity bullets under the name, in order: (display label, contact key).
    /// `name.*` keys project to/from the structured name.
    private static let identityFields: [(label: String, key: String)] = [
        ("UID", "uid"),
        ("First Name", "name.given"),
        ("Middle Name", "name.additional"),
        ("Last Name", "name.family"),
        ("Prefix", "name.prefix"),
        ("Suffix", "name.suffix"),
        ("Nickname", "nickname"),
        ("Maiden Name", "maidenName"),
        ("Phonetic First", "phoneticFirst"),
        ("Phonetic Last", "phoneticLast"),
        ("Organization", "org"),
        ("Department", "department"),
        ("Phonetic Org", "phoneticOrg"),
        ("Title", "title"),
        ("Gender", "gender"),
    ]

    private static let identityByLabel: [String: String] = {
        var map: [String: String] = [:]
        for field in identityFields { map[field.label.lowercased()] = field.key }
        return map
    }()

    private static let genderToLabel: [String: String] = ["M": "Male", "F": "Female"]
    private static let genderFromLabel: [String: String] = [
        "male": "M", "m": "M", "female": "F", "f": "F",
    ]

    /// IM service → URI scheme, to reconstruct the stored value from a handle.
    private static let imSchemes: [String: String] = [
        "skype": "skype:", "jabber": "xmpp:", "googletalk": "xmpp:", "google talk": "xmpp:",
        "facebook": "xmpp:", "aim": "aim:", "icq": "aim:", "yahoo": "ymsgr:", "msn": "msnim:",
        "qq": "x-apple:", "gadugadu": "x-apple:",
    ]

    private static let reservedDateLabels: [String: String] = [
        "birthday": "birthday", "anniversary": "anniversary", "alternate birthday": "altBirthday",
    ]

    // MARK: - Parse

    public func parse(_ text: String, options: ParseOptions) -> ParseResult {
        let blocks = Self.splitContacts(text)
        var contacts: [Contact] = []
        var missingPhotoRefs: [String] = []
        var allocator = StableIDAllocator()
        for (i, block) in blocks.enumerated() {
            if failingBlockIndices.contains(i) { continue }
            guard
                let parsed = parseContactBlock(
                    block, index: options.startIndex + i, photoMap: options.photoMap,
                    allocator: &allocator)
            else { continue }
            contacts.append(parsed.contact)
            if let ref = parsed.missingPhotoRef { missingPhotoRefs.append(ref) }
        }
        return ParseResult(contacts: contacts, missingPhotoRefs: missingPhotoRefs)
    }

    /// Split a document into per-contact blocks at each `## ` heading.
    static func splitContacts(_ text: String) -> [String] {
        var source = text
        if source.hasPrefix("\u{FEFF}") { source.removeFirst() }
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var blocks: [String] = []
        var cur: [String]? = nil
        for line in lines {
            if matches("^##\\s+", line) {
                if let c = cur { blocks.append(c.joined(separator: "\n")) }
                cur = [line]
            } else if cur != nil {
                cur?.append(line)
            }
            // lines before the first `## ` (e.g. a `# Title`) are ignored
        }
        if let c = cur { blocks.append(c.joined(separator: "\n")) }
        return blocks
    }

    private struct ParsedBlock {
        var contact: Contact
        var missingPhotoRef: String?
    }

    private func parseContactBlock(
        _ block: String, index: Int, photoMap: [String: String], allocator: inout StableIDAllocator
    ) -> ParsedBlock? {
        let lines = block.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        let fn = (Self.capture("^##\\s+(.*)$", lines[0], group: 1) ?? "")
            .trimmingCharacters(in: .whitespaces)
        if fn.isEmpty { return nil }

        // Group the body into the intro (identity bullets) + named `###` sections.
        var intro: [String] = []
        var sections: [(name: String, lines: [String])] = []
        var current: Int? = nil
        for i in 1..<lines.count {
            if let heading = Self.capture("^###\\s+(.*)$", lines[i], group: 1) {
                sections.append((name: heading.trimmingCharacters(in: .whitespaces).lowercased(), lines: []))
                current = sections.count - 1
            } else if let c = current {
                sections[c].lines.append(lines[i])
            } else {
                intro.append(lines[i])
            }
        }

        var contact = Contact()
        contact.fn = fn
        var custom = OrderedDictionary<TypedField>()

        // Identity bullets.
        var uid: String? = nil
        var sawNameBullet = false
        var photoRef: String? = nil
        for line in intro {
            guard let groups = Self.bulletMatch(line) else { continue }
            let label = groups.label
            let value = groups.value
            let lower = label.lowercased()
            let key = Self.identityByLabel[lower]
            if lower == "company" {
                contact.isCompany = Self.matches("^(yes|true)$", value, caseInsensitive: true)
            } else if lower == "photo" {
                contact.photo = Self.resolveImportedPhoto(value, photoMap: photoMap)
                photoRef = value
            } else if key == "uid" {
                uid = value.isEmpty ? nil : value
            } else if let key, key.hasPrefix("name.") {
                Self.setName(&contact.name, key: String(key.dropFirst(5)), value: value)
                sawNameBullet = true
            } else if key == "gender" {
                contact.gender = Self.genderFromLabel[value.lowercased()] ?? ""
            } else if let key {
                Self.setScalar(&contact, key: key, value: value)
            } else if !value.isEmpty {
                // Unknown identity bullet → preserve as a custom field.
                custom[label] = TypedField(type: "string", value: .string(value))
            }
        }
        contact.uid = uid
        if !sawNameBullet { contact.name = Self.namePartsFromDisplayName(fn) }

        // Sections.
        for section in sections {
            switch section.name {
            case "email":
                contact.emails = parseMethodSection(.email, section.lines)
            case "phone", "phones":
                contact.phones = parseMethodSection(.phone, section.lines)
            case "website", "websites", "url", "urls":
                contact.urls = parseMethodSection(.url, section.lines)
            case "address", "addresses":
                contact.addresses = parseAddressSection(section.lines)
            case "instant messages", "ims", "im":
                contact.ims = parseImSection(section.lines)
            case "social profiles", "social":
                contact.socialProfiles = parseSocialSection(section.lines)
            case "dates", "other dates":
                parseDatesSection(section.lines, &contact)
            case "relationships":
                contact.related = parseRelationshipsSection(section.lines)
            case "tags":
                contact.tags = parseTagsSection(section.lines)
            case "notes":
                contact.notes = parseNotesSection(section.lines)
            case "other fields", "custom fields":
                parseOtherFieldsSection(section.lines, into: &custom)
            default:
                break
            }
        }

        contact.id = allocator.assign(uid: uid, fn: fn)
        contact.customFields = custom
        contact.rawVCard = ""
        contact.noteTags = NoteHashtags.extract(from: contact.notes)
        if contact.tags.isEmpty && contact.isCompany { contact.tags = ["company"] }
        contact.sourceDocuments = [
            SourceDocument(format: id, raw: "", index: index, dirty: false)
        ]

        let unresolved = contact.photo == nil && (photoRef?.isEmpty == false)
        return ParsedBlock(contact: contact, missingPhotoRef: unresolved ? photoRef : nil)
    }

    // MARK: - Section parsers

    private func parseMethodSection(_ kind: ContactMethodKind, _ lines: [String]) -> [LabeledValue] {
        var out: [LabeledValue] = []
        for bullet in Self.bulletLines(lines) where !bullet.value.isEmpty {
            let (types, custom) = TypeTaxonomy.labelToTypes(kind, bullet.label)
            out.append(LabeledValue(value: bullet.value, types: types, label: custom))
        }
        return out
    }

    private func parseAddressSection(_ lines: [String]) -> [AddressValue] {
        var out: [AddressValue] = []
        var cur: (types: [String], label: String, lines: [String])? = nil
        func flush() {
            if let c = cur { out.append(Self.finishAddress(c)) }
            cur = nil
        }
        for line in lines {
            if let head = Self.capture("^-\\s+\\*\\*(.+?):\\*\\*\\s*$", line, group: 1) {
                flush()
                let (types, label) = TypeTaxonomy.labelToTypes(.address, head.trimmingCharacters(in: .whitespaces))
                cur = (types: types, label: label, lines: [])
            } else if cur != nil, Self.matches("^\\s{2,}\\S", line) {
                cur?.lines.append(line.trimmingCharacters(in: .whitespaces))
            }
        }
        flush()
        return out
    }

    private static func finishAddress(_ cur: (types: [String], label: String, lines: [String])) -> AddressValue {
        var addr = AddressValue(types: cur.types, label: cur.label)
        var ls = cur.lines
        if ls.count >= 2, let last = ls.last, !last.contains(",") {
            addr.country = ls.removeLast()
        }
        var cityIdx = -1
        for i in stride(from: ls.count - 1, through: 0, by: -1) where ls[i].contains(",") {
            cityIdx = i
            break
        }
        if cityIdx == -1 {
            addr.street = ls.joined(separator: ", ")
        } else {
            addr.street = ls[0..<cityIdx].joined(separator: ", ")
            let line = ls[cityIdx]
            let comma = line.range(of: ",", options: .backwards)!
            addr.city = String(line[line.startIndex..<comma.lowerBound]).trimmingCharacters(in: .whitespaces)
            let rest = String(line[comma.upperBound...]).trimmingCharacters(in: .whitespaces)
            if let sp = rest.range(of: " ", options: .backwards) {
                addr.state = String(rest[rest.startIndex..<sp.lowerBound]).trimmingCharacters(in: .whitespaces)
                addr.zip = String(rest[sp.upperBound...]).trimmingCharacters(in: .whitespaces)
            } else {
                addr.state = rest
            }
        }
        return addr
    }

    private func parseImSection(_ lines: [String]) -> [ImValue] {
        var out: [ImValue] = []
        for bullet in Self.bulletLines(lines) where !bullet.value.isEmpty {
            let scheme = Self.imSchemes[bullet.label.lowercased()] ?? ""
            out.append(ImValue(value: scheme + bullet.value, service: bullet.label, types: [], label: ""))
        }
        return out
    }

    private func parseSocialSection(_ lines: [String]) -> [SocialProfileValue] {
        var out: [SocialProfileValue] = []
        for bullet in Self.bulletLines(lines) where !bullet.value.isEmpty {
            out.append(SocialProfileValue(url: bullet.value, service: bullet.label, username: "", label: ""))
        }
        return out
    }

    private func parseDatesSection(_ lines: [String], _ contact: inout Contact) {
        for bullet in Self.bulletLines(lines) where !bullet.value.isEmpty {
            if let reserved = Self.reservedDateLabels[bullet.label.lowercased()] {
                switch reserved {
                case "birthday": contact.birthday = bullet.value
                case "anniversary": contact.anniversary = bullet.value
                case "altBirthday": contact.altBirthday = bullet.value
                default: break
                }
            } else {
                contact.dates.append(DatedValue(label: bullet.label, value: bullet.value))
            }
        }
    }

    private func parseRelationshipsSection(_ lines: [String]) -> [RelatedValue] {
        var out: [RelatedValue] = []
        for bullet in Self.bulletLines(lines) where !bullet.value.isEmpty {
            out.append(RelatedValue(name: bullet.value, type: RelationshipTaxonomy.normalize(bullet.label)))
        }
        return out
    }

    private func parseTagsSection(_ lines: [String]) -> [String] {
        let text = lines.joined(separator: " ")
        var tags: [String] = []
        for m in Self.allMatches("#([\\w-]+)", text, group: 1) { tags.append(m) }
        if tags.isEmpty {
            for part in text.split(separator: ",").map({ $0.trimmingCharacters(in: .whitespaces) })
            where !part.isEmpty {
                tags.append(part.hasPrefix("#") ? String(part.dropFirst()) : part)
            }
        }
        return Self.orderedDedup(tags)
    }

    private func parseNotesSection(_ lines: [String]) -> [String] {
        let text = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return [] }
        return Self.splitParagraphs(text)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func parseOtherFieldsSection(
        _ lines: [String], into custom: inout OrderedDictionary<TypedField>
    ) {
        var i = 0
        while i < lines.count {
            guard let bullet = Self.bulletMatch(lines[i]) else { i += 1; continue }
            let key = bullet.label
            let inline = bullet.value
            i += 1

            if inline.isEmpty, i < lines.count, Self.matches("^\\s*```", lines[i]) {
                // Fenced ```json block → the verbatim {type, value} envelope.
                i += 1  // opening fence
                var json: [String] = []
                while i < lines.count, !Self.matches("^\\s*```", lines[i]) {
                    json.append(lines[i])
                    i += 1
                }
                if i < lines.count { i += 1 }  // closing fence
                let raw = json.joined(separator: "\n")
                if let parsed = JSONCodec.parse(raw) {
                    custom[key] = Self.normalizeField(parsed)
                } else {
                    custom[key] = TypedField(type: "string", value: .string(raw))
                }
                continue
            }

            if inline.isEmpty, i < lines.count, Self.matches("^\\s{2,}-\\s+", lines[i]) {
                // Sub-bullet list.
                var items: [JSONValue] = []
                while i < lines.count, Self.matches("^\\s{2,}-\\s+", lines[i]) {
                    let item = Self.replaceFirst("^\\s{2,}-\\s+", in: lines[i], with: "")
                        .trimmingCharacters(in: .whitespaces)
                    items.append(Self.coerceScalar(item))
                    i += 1
                }
                custom[key] = TypedField(type: "list", value: .array(items))
                continue
            }

            custom[key] = TypedField(
                type: Self.inferScalarType(inline), value: Self.coerceScalar(inline))
        }
    }

    // MARK: - Field normalization (custom fields)

    /// Mirror of JS `_normalizeField`: `{type, value}` envelopes pass through
    /// (preserving the value's nested key order); a bare value is wrapped with an
    /// inferred type. Insertion order is carried natively by `JSONObject`, so no
    /// out-of-band envelope string is needed.
    private static func normalizeField(_ parsed: JSONValue) -> TypedField {
        if case .object(let obj) = parsed, let typeValue = obj["type"], let value = obj["value"] {
            let type: String
            if case .string(let s) = typeValue { type = s } else { type = JSONCodec.stringifyCompact(typeValue) }
            return TypedField(type: type, value: value)
        }
        let type: String
        switch parsed {
        case .array: type = "list"
        case .object, .null: type = "object"
        case .number: type = "number"
        case .string: type = "string"
        case .bool: type = "boolean"
        }
        return TypedField(type: type, value: parsed)
    }

    private static func inferScalarType(_ raw: String) -> String {
        if matches("^(true|false)$", raw, caseInsensitive: true) { return "boolean" }
        if matches("^-?\\d+(?:\\.\\d+)?$", raw) { return "number" }
        return "string"
    }

    private static func coerceScalar(_ raw: String) -> JSONValue {
        if matches("^true$", raw, caseInsensitive: true) { return .bool(true) }
        if matches("^false$", raw, caseInsensitive: true) { return .bool(false) }
        if matches("^-?\\d+(?:\\.\\d+)?$", raw), let n = Double(raw) { return .number(n) }
        return .string(raw)
    }

    // MARK: - Serialize

    public func serialize(_ contacts: [Contact], ids: Set<String>?) -> String {
        let selected = contacts.filter { ids == nil || ids!.contains($0.id) }
        if selected.isEmpty { return "" }
        return selected.map { serializeContact($0, photoOverride: nil) }.joined(separator: "\n\n") + "\n"
    }

    private func serializeContact(_ contact: Contact, photoOverride: String?) -> String {
        var lines: [String] = ["## \(contact.fn.isEmpty ? "Contact" : contact.fn)", ""]

        var idBullets: [(String, String)] = []
        if let uid = contact.uid, !uid.isEmpty { idBullets.append(("UID", uid)) }
        for field in Self.identityFields where field.key != "uid" {
            var value: String
            if field.key.hasPrefix("name.") {
                value = Self.getName(contact.name, key: String(field.key.dropFirst(5)))
            } else if field.key == "gender" {
                value = Self.genderToLabel[contact.gender] ?? ""
            } else {
                value = Self.getScalar(contact, key: field.key)
            }
            if !value.isEmpty { idBullets.append((field.label, value)) }
        }
        if contact.isCompany { idBullets.append(("Company", "Yes")) }
        let photoVal = photoOverride ?? (contact.photo ?? "")
        if !photoVal.isEmpty { idBullets.append(("Photo", photoVal)) }
        for (label, value) in idBullets { lines.append("- **\(label):** \(value)") }

        emitMethodSection(&lines, heading: "Email", kind: .email, entries: contact.emails)
        emitMethodSection(&lines, heading: "Phone", kind: .phone, entries: contact.phones)
        emitMethodSection(&lines, heading: "Website", kind: .url, entries: contact.urls)
        emitAddressSection(&lines, contact.addresses)
        emitImSection(&lines, contact.ims)
        emitSocialSection(&lines, contact.socialProfiles)
        emitDatesSection(&lines, contact)
        emitRelationshipsSection(&lines, contact.related)
        emitTagsSection(&lines, contact.tags)
        emitNotesSection(&lines, contact.notes)
        emitOtherFieldsSection(&lines, contact.customFields)

        var out = lines.joined(separator: "\n")
        while out.hasSuffix("\n") { out.removeLast() }
        return out
    }

    private func emitMethodSection(
        _ lines: inout [String], heading: String, kind: ContactMethodKind, entries: [LabeledValue]
    ) {
        var items: [String] = []
        for e in entries where !e.value.isEmpty {
            let label = TypeTaxonomy.typesToLabel(kind, types: e.types, customLabel: e.label)
            items.append("- **\(label.isEmpty ? "Other" : label):** \(e.value)")
        }
        if !items.isEmpty { lines.append(contentsOf: ["", "### \(heading)"] + items) }
    }

    private func emitAddressSection(_ lines: inout [String], _ addresses: [AddressValue]) {
        let addrs = addresses.filter {
            !$0.street.isEmpty || !$0.city.isEmpty || !$0.state.isEmpty || !$0.zip.isEmpty || !$0.country.isEmpty
        }
        if addrs.isEmpty { return }
        lines.append(contentsOf: ["", "### Address"])
        for a in addrs {
            let label = TypeTaxonomy.typesToLabel(.address, types: a.types, customLabel: a.label)
            lines.append("- **\(label.isEmpty ? "Other" : label):**")
            if !a.street.isEmpty { lines.append("  \(a.street)") }
            let stateZip = [a.state, a.zip].filter { !$0.isEmpty }.joined(separator: " ")
            let cityLine = [a.city, stateZip].filter { !$0.isEmpty }.joined(separator: ", ")
            if !cityLine.isEmpty { lines.append("  \(cityLine)") }
            if !a.country.isEmpty { lines.append("  \(a.country)") }
        }
    }

    private func emitImSection(_ lines: inout [String], _ ims: [ImValue]) {
        var items: [String] = []
        for im in ims where !im.value.isEmpty {
            let label = !im.service.isEmpty ? im.service : (!im.label.isEmpty ? im.label : "IM")
            items.append("- **\(label):** \(Self.stripScheme(im.value))")
        }
        if !items.isEmpty { lines.append(contentsOf: ["", "### Instant Messages"] + items) }
    }

    private func emitSocialSection(_ lines: inout [String], _ profiles: [SocialProfileValue]) {
        var items: [String] = []
        for sp in profiles where !sp.url.isEmpty {
            let label = !sp.service.isEmpty ? sp.service : (!sp.label.isEmpty ? sp.label : "Profile")
            let value: String
            if Self.matches("^https?:", sp.url, caseInsensitive: true) {
                value = sp.url
            } else {
                let stripped = Self.stripScheme(sp.url)
                value = stripped.isEmpty ? sp.url : stripped
            }
            items.append("- **\(label):** \(value)")
        }
        if !items.isEmpty { lines.append(contentsOf: ["", "### Social Profiles"] + items) }
    }

    private func emitDatesSection(_ lines: inout [String], _ contact: Contact) {
        var items: [String] = []
        if let b = contact.birthday, !b.isEmpty { items.append("- **Birthday:** \(b)") }
        if let a = contact.anniversary, !a.isEmpty { items.append("- **Anniversary:** \(a)") }
        if !contact.altBirthday.isEmpty { items.append("- **Alternate Birthday:** \(contact.altBirthday)") }
        for d in contact.dates where !d.value.isEmpty {
            items.append("- **\(d.label.isEmpty ? "Date" : d.label):** \(d.value)")
        }
        if !items.isEmpty { lines.append(contentsOf: ["", "### Dates"] + items) }
    }

    private func emitRelationshipsSection(_ lines: inout [String], _ related: [RelatedValue]) {
        var items: [String] = []
        for rel in related where !rel.name.isEmpty {
            items.append("- **\(RelationshipTaxonomy.label(rel.type)):** \(rel.name)")
        }
        if !items.isEmpty { lines.append(contentsOf: ["", "### Relationships"] + items) }
    }

    private func emitTagsSection(_ lines: inout [String], _ tags: [String]) {
        let derived: Set<String> = ["company", "virtual", "other"]
        let user = tags.filter { !$0.isEmpty && !derived.contains($0) }
        if !user.isEmpty {
            lines.append(contentsOf: ["", "### Tags", user.map { "#\($0)" }.joined(separator: ", ")])
        }
    }

    private func emitNotesSection(_ lines: inout [String], _ notes: [String]) {
        let text = notes.filter { !$0.isEmpty }.joined(separator: "\n\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { lines.append(contentsOf: ["", "### Notes", text]) }
    }

    private func emitOtherFieldsSection(
        _ lines: inout [String], _ customFields: OrderedDictionary<TypedField>
    ) {
        let entries = customFields.pairs.filter { $0.key != "markdown_body" }
        if entries.isEmpty { return }
        var body: [String] = []
        for (key, field) in entries {
            let value = field.value
            if case .array(let items) = value, items.allSatisfy({ Self.isScalarOrNull($0) }) {
                body.append("- **\(key):**")
                for item in items { body.append("  - \(Self.templateString(item))") }
            } else if Self.isNonNullObject(value) {
                // Nested/complex → a visible, verbatim JSON block.
                body.append("- **\(key):**")
                body.append("  ```json")
                for l in Self.envelopeJSON(field).components(separatedBy: "\n") { body.append("  \(l)") }
                body.append("  ```")
            } else {
                body.append("- **\(key):** \(Self.scalarValueString(value))")
            }
        }
        if !body.isEmpty { lines.append(contentsOf: ["", "### Other Fields"] + body) }
    }

    /// The canonical `JSON.stringify({type, value}, null, 2)` for a custom field.
    /// `field.value` is order-preserving (`JSONObject`), so the nested key order
    /// is reproduced directly — no stored envelope needed.
    private static func envelopeJSON(_ field: TypedField) -> String {
        let envelope = JSONValue.object([
            "type": .string(field.type),
            "value": field.value,
        ])
        return JSONCodec.stringify(envelope)
    }

    private static func isScalarOrNull(_ v: JSONValue) -> Bool {
        switch v {
        case .object, .array: return false
        default: return true
        }
    }

    private static func isNonNullObject(_ v: JSONValue) -> Bool {
        switch v {
        case .object, .array: return true
        default: return false
        }
    }

    /// JS template-literal string of a scalar (`${item}`) for sub-bullet items.
    private static func templateString(_ v: JSONValue) -> String {
        switch v {
        case .string(let s): return s
        case .number(let n): return JSONCodec.numberString(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        default: return ""
        }
    }

    /// JS `_formatScalarValue`: null → "", otherwise `String(value)`.
    private static func scalarValueString(_ v: JSONValue) -> String {
        switch v {
        case .string(let s): return s
        case .number(let n): return JSONCodec.numberString(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return ""
        default: return ""
        }
    }

    // MARK: - Small helpers

    private static func stripScheme(_ value: String) -> String {
        guard let m = capture("^([a-z][a-z0-9.+-]*:)(.*)$", value, group: 1, caseInsensitive: true) else {
            return value
        }
        if matches("^https?:", m, caseInsensitive: true) { return value }
        return capture("^([a-z][a-z0-9.+-]*:)(.*)$", value, group: 2, caseInsensitive: true) ?? value
    }

    private static func resolveImportedPhoto(_ photo: String, photoMap: [String: String]) -> String? {
        if photo.isEmpty { return nil }
        if photo.hasPrefix("data:") { return photo }
        if let resolved = photoMap[photo.lowercased()] { return resolved }
        return nil
    }

    private static func namePartsFromDisplayName(_ displayName: String) -> StructuredName {
        let parts = displayName.trimmingCharacters(in: .whitespaces)
            .split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" })
            .map(String.init)
        if parts.isEmpty { return StructuredName() }
        if parts.count == 1 { return StructuredName(given: parts[0]) }
        return StructuredName(
            family: parts[parts.count - 1],
            given: parts[0],
            additional: parts[1..<(parts.count - 1)].joined(separator: " "))
    }

    private static func setName(_ name: inout StructuredName, key: String, value: String) {
        switch key {
        case "given": name.given = value
        case "family": name.family = value
        case "additional": name.additional = value
        case "prefix": name.prefix = value
        case "suffix": name.suffix = value
        default: break
        }
    }

    private static func getName(_ name: StructuredName, key: String) -> String {
        switch key {
        case "given": return name.given
        case "family": return name.family
        case "additional": return name.additional
        case "prefix": return name.prefix
        case "suffix": return name.suffix
        default: return ""
        }
    }

    private static func setScalar(_ contact: inout Contact, key: String, value: String) {
        switch key {
        case "nickname": contact.nickname = value
        case "maidenName": contact.maidenName = value
        case "phoneticFirst": contact.phoneticFirst = value
        case "phoneticLast": contact.phoneticLast = value
        case "org": contact.org = value
        case "department": contact.department = value
        case "phoneticOrg": contact.phoneticOrg = value
        case "title": contact.title = value
        default: break
        }
    }

    private static func getScalar(_ contact: Contact, key: String) -> String {
        switch key {
        case "nickname": return contact.nickname
        case "maidenName": return contact.maidenName
        case "phoneticFirst": return contact.phoneticFirst
        case "phoneticLast": return contact.phoneticLast
        case "org": return contact.org
        case "department": return contact.department
        case "phoneticOrg": return contact.phoneticOrg
        case "title": return contact.title
        default: return ""
        }
    }

    // MARK: - Bullet / regex utilities

    struct Bullet { let label: String; let value: String }

    static func bulletMatch(_ line: String) -> Bullet? {
        guard let groups = captureAll("^-\\s+\\*\\*(.+?):\\*\\*\\s?(.*)$", line) else { return nil }
        return Bullet(
            label: (groups[1] ?? "").trimmingCharacters(in: .whitespaces),
            value: (groups[2] ?? "").trimmingCharacters(in: .whitespaces))
    }

    static func bulletLines(_ lines: [String]) -> [Bullet] {
        lines.compactMap { bulletMatch($0) }
    }

    static func orderedDedup(_ items: [String]) -> [String] {
        var seen: Set<String> = []
        var out: [String] = []
        for item in items where seen.insert(item).inserted { out.append(item) }
        return out
    }

    /// Split on blank lines (JS `/\n\s*\n/`).
    static func splitParagraphs(_ text: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: "\\n\\s*\\n") else { return [text] }
        let ns = text as NSString
        var result: [String] = []
        var lastEnd = 0
        for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result.append(ns.substring(with: NSRange(location: lastEnd, length: m.range.location - lastEnd)))
            lastEnd = m.range.location + m.range.length
        }
        result.append(ns.substring(from: lastEnd))
        return result
    }

    private static func regex(_ pattern: String, caseInsensitive: Bool = false) -> NSRegularExpression? {
        try? NSRegularExpression(
            pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    static func matches(_ pattern: String, _ subject: String, caseInsensitive: Bool = false) -> Bool {
        guard let re = regex(pattern, caseInsensitive: caseInsensitive) else { return false }
        return re.firstMatch(in: subject, range: NSRange(subject.startIndex..., in: subject)) != nil
    }

    static func capture(_ pattern: String, _ subject: String, group: Int, caseInsensitive: Bool = false) -> String? {
        guard let re = regex(pattern, caseInsensitive: caseInsensitive),
            let m = re.firstMatch(in: subject, range: NSRange(subject.startIndex..., in: subject)),
            m.numberOfRanges > group, let r = Range(m.range(at: group), in: subject)
        else { return nil }
        return String(subject[r])
    }

    static func captureAll(_ pattern: String, _ subject: String, caseInsensitive: Bool = false) -> [String?]? {
        guard let re = regex(pattern, caseInsensitive: caseInsensitive),
            let m = re.firstMatch(in: subject, range: NSRange(subject.startIndex..., in: subject))
        else { return nil }
        var groups: [String?] = []
        for g in 0..<m.numberOfRanges {
            if let r = Range(m.range(at: g), in: subject) { groups.append(String(subject[r])) } else { groups.append(nil) }
        }
        return groups
    }

    static func allMatches(_ pattern: String, _ subject: String, group: Int) -> [String] {
        guard let re = regex(pattern) else { return [] }
        var out: [String] = []
        for m in re.matches(in: subject, range: NSRange(subject.startIndex..., in: subject)) {
            if m.numberOfRanges > group, let r = Range(m.range(at: group), in: subject) {
                out.append(String(subject[r]))
            }
        }
        return out
    }

    static func replaceFirst(_ pattern: String, in subject: String, with replacement: String) -> String {
        guard let re = regex(pattern),
            let m = re.firstMatch(in: subject, range: NSRange(subject.startIndex..., in: subject)),
            let r = Range(m.range, in: subject)
        else { return subject }
        return subject.replacingCharacters(in: r, with: replacement)
    }
}
