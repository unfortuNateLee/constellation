import ConstellationModel
import Foundation

/// VCF / vCard parser (port of js/vcf-parser.js).
/// Handles vCard 3.0 and 4.0 with Apple-specific extensions. Lenient: a
/// malformed record is skipped without aborting the whole import.
///
/// Subclassable within the package so tests can simulate a per-block failure
/// (the JS suite monkey-patches `_parseVCard`; Swift tests override
/// `parseBlock(_:)` instead).
open class VCFParser {
    public init() {}

    /// Diagnostic warnings from the last `parse` call (JS logs via console.warn).
    public private(set) var warnings: [String] = []

    public func parse(_ text: String) -> [Contact] {
        warnings = []

        // Pre-extract raw blocks and photos as ordered arrays (one entry per
        // vCard, in file order). Keying by position instead of FN avoids silent
        // overwrites when two contacts share a display name.
        var rawBlocks: [String] = []
        var photos: [String?] = []

        for block in Self.vcardBlocks(in: text) {
            rawBlocks.append(block)
            photos.append(Self.extractPhoto(fromRawBlock: block))
        }

        // Strip large binary blocks before unfolding for performance.
        let stripped = Self.stripPhotoBlocks(text)

        // Unfold continuation lines per RFC 6350 §3.2.
        let unfolded = VCardUtils.unfold(stripped)

        var contacts: [Contact] = []
        let blocks = Self.vcardBlocks(in: unfolded)

        // Per-parse accumulator for deterministic, collision-free ids.
        var allocator = StableIDAllocator()

        // blocks[i] (unfolded) always corresponds to rawBlocks[i] (original)
        // because folding never adds or removes BEGIN:/END:VCARD markers.
        for (i, block) in blocks.enumerated() {
            // Isolate malformed records: one bad block is skipped with a warning
            // instead of aborting the whole import.
            do {
                guard var contact = try parseBlock(block) else { continue }
                if i < rawBlocks.count {
                    contact.rawVCard = rawBlocks[i]
                    if let photo = photos[i] { contact.photo = photo }
                }
                contact.id = allocator.assign(uid: contact.uid, fn: contact.fn)
                contact.sourceDocuments = [
                    SourceDocument(
                        format: "vcard", raw: contact.rawVCard ?? "", index: i, dirty: false)
                ]
                contacts.append(contact)
            } catch {
                warnings.append(
                    "[VCFParser] Skipping malformed vCard at index \(i): \(error)")
            }
        }

        return contacts
    }

    /// Parse one unfolded vCard block. Overridable for failure-isolation tests.
    open func parseBlock(_ block: String) throws -> Contact? {
        Self.parseVCard(block)
    }

    // MARK: - Block/photo pre-extraction

    static func vcardBlocks(in text: String) -> [String] {
        // JS: /BEGIN:VCARD[\s\S]*?END:VCARD/gi
        let regex = try! NSRegularExpression(
            pattern: "BEGIN:VCARD[\\s\\S]*?END:VCARD", options: [.caseInsensitive])
        let ns = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: ns.length))
            .map { ns.substring(with: $0.range) }
    }

    static func extractPhoto(fromRawBlock rawBlock: String) -> String? {
        // JS: /^(PHOTO[^\r\n]*)\r?\n((?:[ \t][^\r\n]*\r?\n)*)/m
        let regex = try! NSRegularExpression(
            pattern: "^(PHOTO[^\\r\\n]*)\\r?\\n((?:[ \\t][^\\r\\n]*\\r?\\n)*)",
            options: [.anchorsMatchLines])
        let ns = rawBlock as NSString
        guard
            let m = regex.firstMatch(
                in: rawBlock, range: NSRange(location: 0, length: ns.length))
        else { return nil }

        let firstLine = ns.substring(with: m.range(at: 1))
        let contLines = m.range(at: 2).location != NSNotFound ? ns.substring(with: m.range(at: 2)) : ""

        guard let colonIdx = firstLine.firstIndex(of: ":") else { return nil }

        var b64 = String(firstLine[firstLine.index(after: colonIdx)...])
        for line in contLines.components(separatedBy: .newlines) {
            if line.hasPrefix(" ") || line.hasPrefix("\t") {
                b64 += String(line.dropFirst())
            }
        }
        b64 = b64.trimmingCharacters(in: .whitespacesAndNewlines)
        if b64.isEmpty { return nil }

        var mimeType = "image/jpeg"
        if let typeMatch = firstLine.firstMatch(of: /(?i)TYPE=([A-Za-z0-9-]+)/) {
            let type = String(typeMatch.1).uppercased()
            let map: [String: String] = [
                "PNG": "image/png", "GIF": "image/gif", "WEBP": "image/webp",
                "HEIC": "image/heic", "HEIF": "image/heif", "BMP": "image/bmp",
                "TIFF": "image/tiff",
            ]
            mimeType = map[type] ?? "image/jpeg"
        }
        return "data:\(mimeType);base64,\(b64)"
    }

    static func stripPhotoBlocks(_ text: String) -> String {
        // JS: /^PHOTO[^\n]*\n(?:[ \t][^\n]*\n)*/gm → 'PHOTO:__stripped__\n'
        let regex = try! NSRegularExpression(
            pattern: "^PHOTO[^\\n]*\\n(?:[ \\t][^\\n]*\\n)*",
            options: [.anchorsMatchLines])
        let ns = text as NSString
        return regex.stringByReplacingMatches(
            in: text, range: NSRange(location: 0, length: ns.length),
            withTemplate: "PHOTO:__stripped__\n")
    }

    // MARK: - Single-card parsing

    /// Tracks which model array an item group's instance landed in, so labels
    /// and IMPP services from sibling lines can be attached afterwards. (The JS
    /// mutates shared object references; value types need indices.)
    private enum MethodRef {
        case email(Int)
        case phone(Int)
        case address(Int)
        case url(Int)
        case im(Int)
        case social(Int)
    }

    static func parseVCard(_ block: String) -> Contact? {
        let lines = block.split(separator: /\r\n|\n/, omittingEmptySubsequences: false)
            .map(String.init)

        var contact = Contact()

        // Ordered item-group capture (JS object key insertion order).
        var itemOrder: [String] = []
        var items: [String: [String: String]] = [:]
        var itemRawLines: [String: [String]] = [:]
        var itemInstances: [String: MethodRef] = [:]
        var categories: [String] = []

        // __raw capture per created entry (JS entry.__raw): nil for grouped
        // entries (filled from itemRawLines later), the source line otherwise.
        var rawCapture: [ObjectIdentifierKey: [String]?] = [:]
        struct ObjectIdentifierKey: Hashable {
            let kind: String
            let index: Int
        }
        func captureRaw(_ kind: String, _ index: Int, _ itemKey: String?, _ line: String) {
            rawCapture[ObjectIdentifierKey(kind: kind, index: index)] =
                itemKey == nil ? [line] : nil as [String]?
        }

        for line in lines {
            if line.isEmpty || line == "BEGIN:VCARD" || line == "END:VCARD" { continue }

            guard let parsedLine = VCardUtils.parseContentLine(line) else { continue }

            let propName = parsedLine.name
            let itemKey = parsedLine.group
            let value = parsedLine.value

            if let itemKey {
                if items[itemKey] == nil {
                    items[itemKey] = [:]
                    itemOrder.append(itemKey)
                }
                items[itemKey]![propName] = value
                itemRawLines[itemKey, default: []].append(line)
            }

            let types = VCardUtils.typesFromParams(parsedLine.params)

            // Photo data was stripped before parsing (performance).
            if propName == "PHOTO" { continue }

            switch propName {
            case "FN":
                contact.fn = decode(value)

            case "N":
                let parts = VCardUtils.splitEscaped(value, delimiter: ";")
                contact.name = StructuredName(
                    family: decode(parts.count > 0 ? parts[0] : ""),
                    given: decode(parts.count > 1 ? parts[1] : ""),
                    additional: decode(parts.count > 2 ? parts[2] : ""),
                    prefix: decode(parts.count > 3 ? parts[3] : ""),
                    suffix: decode(parts.count > 4 ? parts[4] : "")
                )

            case "ORG":
                let orgParts = VCardUtils.splitEscaped(value, delimiter: ";")
                contact.org = decode(orgParts.first ?? "")
                contact.department = decode(orgParts.count > 1 ? orgParts[1] : "")

            case "NICKNAME":
                contact.nickname = decode(value)

            case "X-MAIDENNAME":
                contact.maidenName = decode(value)

            case "X-PHONETIC-FIRST-NAME":
                contact.phoneticFirst = decode(value)

            case "X-PHONETIC-LAST-NAME":
                contact.phoneticLast = decode(value)

            case "X-PHONETIC-ORG":
                contact.phoneticOrg = decode(value)

            case "X-ALTBDAY":
                // Display + preserve only; the raw line (incl. CALSCALE) is kept verbatim.
                contact.altBirthday = decode(value)

            case "TITLE":
                contact.title = decode(value)

            case "GENDER":
                // vCard 4.0 GENDER: sex component (M/F/O/N/U) optionally ";text".
                // We model only Male/Female/unknown → M→M, F→F, else ''.
                let sex = decode(value).components(separatedBy: ";")[0]
                    .trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                contact.gender = sex == "M" ? "M" : sex == "F" ? "F" : ""

            case "X-ABSHOWAS":
                if value.uppercased() == "COMPANY" { contact.isCompany = true }

            case "EMAIL":
                if !value.isEmpty && !value.hasPrefix("/9j/") {
                    contact.emails.append(
                        LabeledValue(value: decode(value), types: types, label: ""))
                    let idx = contact.emails.count - 1
                    captureRaw("email", idx, itemKey, line)
                    if let itemKey { itemInstances[itemKey] = .email(idx) }
                }

            case "TEL":
                if !value.isEmpty {
                    contact.phones.append(
                        LabeledValue(value: decode(value), types: types, label: ""))
                    let idx = contact.phones.count - 1
                    captureRaw("phone", idx, itemKey, line)
                    if let itemKey { itemInstances[itemKey] = .phone(idx) }
                }

            case "ADR":
                let parts = VCardUtils.splitEscaped(value, delimiter: ";")
                func part(_ i: Int) -> String { decode(parts.count > i ? parts[i] : "") }
                contact.addresses.append(
                    AddressValue(
                        pobox: part(0), ext: part(1), street: part(2), city: part(3),
                        state: part(4), zip: part(5), country: part(6), types: types,
                        label: ""))
                let idx = contact.addresses.count - 1
                captureRaw("address", idx, itemKey, line)
                if let itemKey { itemInstances[itemKey] = .address(idx) }

            case "BDAY":
                if !value.isEmpty && !value.hasPrefix("//") {
                    contact.birthday = value
                }

            case "NOTE":
                if !value.isEmpty { contact.notes.append(decode(value)) }

            case "URL":
                if !value.isEmpty {
                    contact.urls.append(
                        LabeledValue(value: decode(value), types: types, label: ""))
                    let idx = contact.urls.count - 1
                    captureRaw("url", idx, itemKey, line)
                    if let itemKey { itemInstances[itemKey] = .url(idx) }
                }

            case "IMPP":
                if !value.isEmpty {
                    contact.ims.append(
                        ImValue(
                            value: decode(value),
                            service: paramValue(parsedLine.params, "X-SERVICE-TYPE"),
                            types: types, label: ""))
                    let idx = contact.ims.count - 1
                    captureRaw("im", idx, itemKey, line)
                    if let itemKey { itemInstances[itemKey] = .im(idx) }
                }

            case "X-SOCIALPROFILE":
                if !value.isEmpty {
                    contact.socialProfiles.append(
                        SocialProfileValue(
                            url: decode(value),
                            service: paramValue(parsedLine.params, "TYPE"),
                            username: paramValue(parsedLine.params, "X-USER"),
                            label: ""))
                    let idx = contact.socialProfiles.count - 1
                    captureRaw("social", idx, itemKey, line)
                    if let itemKey { itemInstances[itemKey] = .social(idx) }
                }

            case "UID":
                contact.uid = value

            case "CATEGORIES":
                for cat in VCardUtils.splitEscaped(value, delimiter: ",") {
                    let decoded = decode(cat)
                    if !decoded.isEmpty { categories.append(decoded) }
                }

            case "X-CONSTELLATION-FIELD":
                // Round-tripped format-neutral custom field, JSON-encoded as
                // {key, type, value}. Parsed with the order-preserving codec so a
                // nested-object value re-serializes byte-identically. Unparseable
                // payloads are ignored rather than failing the contact.
                if let json = JSONCodec.parse(decode(value)),
                    case .object(let obj) = json,
                    case .string(let key)? = obj["key"], !key.isEmpty
                {
                    let type: String
                    if case .string(let t)? = obj["type"], !t.isEmpty {
                        type = t
                    } else {
                        type = "unknown"
                    }
                    contact.customFields[key] = TypedField(
                        type: type, value: obj["value"] ?? .null)
                }

            default:
                break  // X-ABRELATEDNAMES etc. are processed via the items map below.
            }
        }

        // Process item groups → related contacts, dates, and custom field labels.
        for key in itemOrder {
            let data = items[key] ?? [:]
            if let relatedNames = data["X-ABRELATEDNAMES"], let rawType = data["X-ABLABEL"] {
                let relType = RelationshipTaxonomy.normalize(rawType)
                let name = decode(relatedNames)
                if !name.isEmpty {
                    contact.related.append(
                        RelatedValue(name: name, type: relType, rawType: rawType))
                }
            } else if let abDate = data["X-ABDATE"] {
                let label = unwrapLabel(data["X-ABLABEL"] ?? "")
                if label.lowercased().contains("anniversary") {
                    contact.anniversary = abDate
                } else {
                    // Any other Apple custom-labeled date is modeled in dates[].
                    contact.dates.append(
                        DatedValue(label: label.isEmpty ? "Date" : label, value: abDate))
                }
            } else if let abLabel = data["X-ABLABEL"], let ref = itemInstances[key] {
                // Apple custom label on an email/phone/address/url/im item group.
                let label = unwrapLabel(abLabel)
                switch ref {
                case .email(let i): contact.emails[i].label = label
                case .phone(let i): contact.phones[i].label = label
                case .address(let i): contact.addresses[i].label = label
                case .url(let i): contact.urls[i].label = label
                case .im(let i): contact.ims[i].label = label
                case .social(let i): contact.socialProfiles[i].label = label
                }
            }
            // An item-grouped IMPP may carry its service as a sibling property.
            if let ref = itemInstances[key], let service = data["X-SERVICE-TYPE"] {
                if case .im(let i) = ref, contact.ims[i].service.isEmpty {
                    contact.ims[i].service = service
                }
                if case .social(let i) = ref, contact.socialProfiles[i].service.isEmpty {
                    contact.socialProfiles[i].service = service
                }
            }
        }

        // Index every contact-method instance by its content key → original raw
        // line(s), so the serializer can re-emit untouched instances byte-for-byte.
        // Grouped instances pick up their full item group (value + X-ABLabel +
        // X-SERVICE-TYPE siblings).
        for (key, ref) in itemInstances {
            let k: ObjectIdentifierKey
            switch ref {
            case .email(let i): k = ObjectIdentifierKey(kind: "email", index: i)
            case .phone(let i): k = ObjectIdentifierKey(kind: "phone", index: i)
            case .address(let i): k = ObjectIdentifierKey(kind: "address", index: i)
            case .url(let i): k = ObjectIdentifierKey(kind: "url", index: i)
            case .im(let i): k = ObjectIdentifierKey(kind: "im", index: i)
            case .social(let i): k = ObjectIdentifierKey(kind: "social", index: i)
            }
            if rawCapture[k] == nil || rawCapture[k]! == nil {
                rawCapture[k] = itemRawLines[key]
            }
        }
        contact.rawByKey = [:]
        for (i, e) in contact.emails.enumerated() {
            if let raw = rawCapture[ObjectIdentifierKey(kind: "email", index: i)] ?? nil,
                !raw.isEmpty
            {
                contact.rawByKey[
                    VCardUtils.keyForEmailPhoneURL(
                        kind: "email", value: e.value, types: e.types, label: e.label)] = raw
            }
        }
        for (i, e) in contact.phones.enumerated() {
            if let raw = rawCapture[ObjectIdentifierKey(kind: "phone", index: i)] ?? nil,
                !raw.isEmpty
            {
                contact.rawByKey[
                    VCardUtils.keyForEmailPhoneURL(
                        kind: "phone", value: e.value, types: e.types, label: e.label)] = raw
            }
        }
        for (i, a) in contact.addresses.enumerated() {
            if let raw = rawCapture[ObjectIdentifierKey(kind: "address", index: i)] ?? nil,
                !raw.isEmpty
            {
                contact.rawByKey[
                    VCardUtils.keyForAddress(
                        pobox: a.pobox, ext: a.ext, street: a.street, city: a.city,
                        state: a.state, zip: a.zip, country: a.country, types: a.types,
                        label: a.label)] = raw
            }
        }
        for (i, e) in contact.urls.enumerated() {
            if let raw = rawCapture[ObjectIdentifierKey(kind: "url", index: i)] ?? nil,
                !raw.isEmpty
            {
                contact.rawByKey[
                    VCardUtils.keyForEmailPhoneURL(
                        kind: "url", value: e.value, types: e.types, label: e.label)] = raw
            }
        }
        for (i, im) in contact.ims.enumerated() {
            if let raw = rawCapture[ObjectIdentifierKey(kind: "im", index: i)] ?? nil,
                !raw.isEmpty
            {
                contact.rawByKey[
                    VCardUtils.keyForIM(
                        value: im.value, service: im.service, types: im.types,
                        label: im.label)] = raw
            }
        }
        for (i, sp) in contact.socialProfiles.enumerated() {
            if let raw = rawCapture[ObjectIdentifierKey(kind: "social", index: i)] ?? nil,
                !raw.isEmpty
            {
                contact.rawByKey[
                    VCardUtils.keyForSocial(
                        url: sp.url, service: sp.service, username: sp.username,
                        label: sp.label)] = raw
            }
        }

        if contact.fn.isEmpty {
            contact.fn = composeDisplayName(contact.name)
        }
        if contact.fn.isEmpty { return nil }

        // Infer tags, then merge any CATEGORIES (user/markdown tags) round-tripped in.
        contact.noteTags = NoteHashtags.extract(from: contact.notes)
        var tags: [String] = []
        var seen = Set<String>()
        if contact.isCompany, seen.insert("company").inserted { tags.append("company") }
        for cat in categories where seen.insert(cat).inserted { tags.append(cat) }
        contact.tags = tags

        return contact
    }

    // MARK: - Helpers (ports of the JS underscore helpers)

    /// First value of a named vCard parameter (e.g. X-SERVICE-TYPE), or "".
    static func paramValue(_ params: [VCardUtils.Param], _ name: String) -> String {
        params.first(where: { $0.name == name })?.values.first ?? ""
    }

    /// Strip Apple's `_$!<…>!$_` wrapper from an X-ABLabel and decode it.
    /// JS regex `^_\$!<(.*)>!\$_$` — `.` does not cross newlines.
    static func unwrapLabel(_ label: String) -> String {
        if let m = label.wholeMatch(of: /_\$!<([^\n\r]*)>!\$_/) {
            return decode(String(m.1))
        }
        return decode(label)
    }

    static func decode(_ value: String) -> String {
        VCardUtils.decodeValue(value).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func composeDisplayName(_ name: StructuredName) -> String {
        [name.prefix, name.given, name.additional, name.family, name.suffix]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
