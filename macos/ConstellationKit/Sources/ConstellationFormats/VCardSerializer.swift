import ConstellationModel
import Foundation

/// VCardSerializer — the single model-driven vCard serializer
/// (port of js/vcard-serializer.js).
///
/// Two entry points share one body generator (`modelLines`):
///
/// - `rewriteVCard(_:)` — for vCard-origin contacts (`rawVCard` present).
///   Hybrid raw preservation: lines the app doesn't model (PRODID, REV, obscure
///   Apple item groups, …) are kept verbatim; modeled properties are regenerated
///   from the contact. Within the modeled contact methods, an *untouched*
///   instance (its content key still maps to original raw line(s) in
///   `contact.rawByKey`) is re-emitted byte-for-byte — preserving Apple's exact
///   TYPE casing/order — and only edited instances are regenerated.
///
/// - `generateVCard(_:)` — full regeneration for contacts with no raw card
///   (Markdown/TSV imports, in-app creations). Also emits UID and CATEGORIES
///   (from non-system tags), which the rewrite path instead keeps verbatim from
///   the original card.
///
/// Every write path must go through this module.
public enum VCardSerializer {
    /// Export-time serialization: the raw card is the source of truth when present.
    public static func serializeContact(_ contact: Contact) -> String {
        if let raw = contact.rawVCard, !raw.isEmpty { return raw }
        return generateVCard(contact)
    }

    /// Simple (non-item-group) properties the model owns: the rewrite path drops
    /// these from the original card and regenerates them. Anything not listed is
    /// kept verbatim (UID, CATEGORIES, PRODID, REV, X-ALTBDAY, other X-* …).
    static let modeledProps: Set<String> = [
        "FN", "N", "NICKNAME", "X-MAIDENNAME", "X-PHONETIC-FIRST-NAME",
        "X-PHONETIC-LAST-NAME", "X-PHONETIC-ORG", "ORG", "TITLE", "GENDER",
        "EMAIL", "TEL", "ADR", "BDAY", "NOTE", "URL", "IMPP", "X-SOCIALPROFILE",
        "PHOTO", "X-ABSHOWAS", "X-CONSTELLATION-FIELD",
    ]

    /// Regenerate a raw vCard's modeled properties from the contact, preserving
    /// everything else verbatim. Returns the new raw string (does not mutate).
    public static func rewriteVCard(_ contact: Contact) -> String {
        guard let rawVCard = contact.rawVCard, !rawVCard.isEmpty else { return "" }

        let lines = VCardUtils.unfold(rawVCard)
            .split(separator: /\r\n|\n/, omittingEmptySubsequences: false)
            .map(String.init)

        var keptSimple: [String] = []
        var itemGroupOrder: [String] = []
        var itemGroups: [String: [String]] = [:]
        var begin = "BEGIN:VCARD"
        var end = "END:VCARD"
        var version: String?
        var nextItem = 1

        for line in lines {
            if line.isEmpty { continue }
            if line.range(of: "^BEGIN:VCARD", options: [.regularExpression, .caseInsensitive])
                != nil
            {
                begin = line
                continue
            }
            if line.range(of: "^END:VCARD", options: [.regularExpression, .caseInsensitive])
                != nil
            {
                end = line
                continue
            }
            if line.range(of: "^VERSION:", options: [.regularExpression, .caseInsensitive]) != nil
            {
                version = line
                continue
            }

            if let itemMatch = line.prefixMatch(of: /(?i)(item\d+)\./) {
                let key = String(itemMatch.1)
                let number = Int(key.dropFirst(4)) ?? 0
                nextItem = max(nextItem, number + 1)
                if itemGroups[key] == nil {
                    itemGroups[key] = []
                    itemGroupOrder.append(key)
                }
                itemGroups[key]!.append(line)
                continue
            }

            // JS: line.split(':', 1)[0].split(';', 1)[0].toUpperCase()
            let beforeColon = line.components(separatedBy: ":")[0]
            let prop = beforeColon.components(separatedBy: ";")[0].uppercased()
            if modeledProps.contains(prop) { continue }
            keptSimple.append(line)
        }

        var keptItemLines: [String] = []
        for key in itemGroupOrder {
            let groupLines = itemGroups[key] ?? []
            var props = Set<String>()
            for line in groupLines {
                let lhs = line.components(separatedBy: ":")[0]
                if let m = lhs.wholeMatch(of: /(?i)item\d+\.(.+)/) {
                    props.insert(String(m.1).components(separatedBy: ";")[0].uppercased())
                } else {
                    props.insert("")
                }
            }
            let editableContactGroup =
                props.contains("EMAIL") || props.contains("TEL") || props.contains("ADR")
                || props.contains("URL") || props.contains("IMPP")
                || props.contains("X-SOCIALPROFILE")
            let dateGroup = props.contains("X-ABDATE")
            let relatedGroup = props.contains("X-ABRELATEDNAMES")
            // Drop the groups we regenerate from the model (editable contact
            // fields, dates, relationships); keep everything else verbatim.
            if !editableContactGroup && !dateGroup && !relatedGroup {
                keptItemLines.append(contentsOf: groupLines)
            }
        }

        let generated = modelLines(
            contact, mode: .rewrite, rawByKey: contact.rawByKey, nextItem: nextItem)

        var body = [begin, version ?? "VERSION:3.0"]
        body.append(contentsOf: keptSimple)
        body.append(contentsOf: generated)
        body.append(contentsOf: keptItemLines)
        body.append(end)
        return VCardUtils.foldLines(body)
    }

    /// Full regeneration for a contact with no raw card.
    public static func generateVCard(_ contact: Contact) -> String {
        var lines = ["BEGIN:VCARD", "VERSION:3.0"]
        if let uid = contact.uid, !uid.isEmpty {
            lines.append("UID:\(esc(uid))")
        }
        lines.append(contentsOf: modelLines(contact, mode: .generate, rawByKey: [:], nextItem: 1))
        lines.append("END:VCARD")
        return VCardUtils.foldLines(lines)
    }

    // MARK: - Shared body generator

    enum Mode {
        case rewrite
        case generate
    }

    /// The model-driven card body, FN through custom fields, shared by both
    /// paths. `.generate` additionally emits CATEGORIES (the rewrite path keeps
    /// the original CATEGORIES line verbatim instead, so inferred tags are never
    /// written into an Apple-origin card).
    static func modelLines(
        _ contact: Contact, mode: Mode, rawByKey: [String: [String]], nextItem startItem: Int
    ) -> [String] {
        var lines: [String] = []
        var nextItem = startItem

        if mode == .rewrite {
            // JS falls back to _namePartsFromDisplayName only when contact.name
            // is literally absent — parsed contacts always carry a name object
            // (even all-empty), so the model name is used as-is.
            lines.append("FN:\(esc(contact.fn))")
            lines.append(nLine(contact.name))
        } else {
            let name = contact.name
            let fn =
                !contact.fn.isEmpty
                ? contact.fn
                : {
                    let composed = composeDisplayName(name)
                    return composed.isEmpty ? "Contact" : composed
                }()
            lines.append("FN:\(esc(fn))")
            lines.append(nLine(name))
        }
        if !contact.nickname.isEmpty { lines.append("NICKNAME:\(esc(contact.nickname))") }
        if !contact.maidenName.isEmpty { lines.append("X-MAIDENNAME:\(esc(contact.maidenName))") }
        if !contact.phoneticFirst.isEmpty {
            lines.append("X-PHONETIC-FIRST-NAME:\(esc(contact.phoneticFirst))")
        }
        if !contact.phoneticLast.isEmpty {
            lines.append("X-PHONETIC-LAST-NAME:\(esc(contact.phoneticLast))")
        }
        if contact.isCompany { lines.append("X-ABSHOWAS:COMPANY") }
        if !contact.org.isEmpty || !contact.department.isEmpty {
            let orgValue =
                !contact.department.isEmpty
                ? "\(esc(contact.org));\(esc(contact.department))" : esc(contact.org)
            lines.append("ORG:\(orgValue)")
        }
        if !contact.phoneticOrg.isEmpty { lines.append("X-PHONETIC-ORG:\(esc(contact.phoneticOrg))") }
        if !contact.title.isEmpty { lines.append("TITLE:\(esc(contact.title))") }
        if !contact.gender.isEmpty { lines.append("GENDER:\(esc(contact.gender))") }
        lines.append(contentsOf: photoLines(contact.photo))

        if mode == .generate {
            // Non-system tags (markdown / in-app) → standard CATEGORIES so they
            // aren't dropped on export. 'company' is already X-ABSHOWAS.
            let categories = contact.tags.filter { !$0.isEmpty && $0 != "company" }
            if !categories.isEmpty {
                lines.append("CATEGORIES:\(categories.map { esc($0) }.joined(separator: ","))")
            }
        }

        // Emit a contact field as a plain line, or — when the entry carries an
        // Apple custom label — as an item group with an X-ABLabel.
        func pushLabeledField(_ prop: String, _ params: String, _ value: String, _ label: String) {
            if !label.isEmpty {
                lines.append("item\(nextItem).\(prop)\(params):\(value)")
                lines.append("item\(nextItem).X-ABLabel:\(VCardUtils.formatXABLabel(label))")
                nextItem += 1
            } else {
                lines.append("\(prop)\(params):\(value)")
            }
        }
        // Hybrid raw preservation (rewrite mode): an unchanged instance re-emits
        // its original bytes; only edited instances regenerate. In generate mode
        // rawByKey is empty, so everything regenerates.
        func pushMethod(_ key: String, _ regenerate: () -> Void) {
            if let raw = rawByKey[key], !raw.isEmpty {
                lines.append(contentsOf: raw)
            } else {
                regenerate()
            }
        }

        for email in contact.emails where !email.value.isEmpty {
            pushMethod(
                VCardUtils.keyForEmailPhoneURL(
                    kind: "email", value: email.value, types: email.types, label: email.label)
            ) {
                pushLabeledField(
                    "EMAIL", VCardUtils.buildTypeParams(email.types), esc(email.value),
                    email.label)
            }
        }
        for phone in contact.phones where !phone.value.isEmpty {
            pushMethod(
                VCardUtils.keyForEmailPhoneURL(
                    kind: "phone", value: phone.value, types: phone.types, label: phone.label)
            ) {
                pushLabeledField(
                    "TEL", VCardUtils.buildTypeParams(phone.types), esc(phone.value), phone.label)
            }
        }
        for address in contact.addresses {
            let hasAddress =
                !address.pobox.isEmpty || !address.ext.isEmpty || !address.street.isEmpty
                || !address.city.isEmpty || !address.state.isEmpty || !address.zip.isEmpty
                || !address.country.isEmpty
            if !hasAddress { continue }
            pushMethod(
                VCardUtils.keyForAddress(
                    pobox: address.pobox, ext: address.ext, street: address.street,
                    city: address.city, state: address.state, zip: address.zip,
                    country: address.country, types: address.types, label: address.label)
            ) {
                let value =
                    "\(esc(address.pobox));\(esc(address.ext));\(esc(address.street));\(esc(address.city));\(esc(address.state));\(esc(address.zip));\(esc(address.country))"
                pushLabeledField(
                    "ADR", VCardUtils.buildTypeParams(address.types), value, address.label)
            }
        }
        for entry in contact.urls where !entry.value.isEmpty {
            pushMethod(
                VCardUtils.keyForEmailPhoneURL(
                    kind: "url", value: entry.value, types: entry.types, label: entry.label)
            ) {
                pushLabeledField(
                    "URL", VCardUtils.buildTypeParams(entry.types), esc(entry.value), entry.label)
            }
        }
        for im in contact.ims where !im.value.isEmpty {
            pushMethod(
                VCardUtils.keyForIM(
                    value: im.value, service: im.service, types: im.types, label: im.label)
            ) {
                let svc =
                    !im.service.isEmpty
                    ? ";X-SERVICE-TYPE=\(VCardUtils.encodeParamValue(im.service))" : ""
                let params = svc + VCardUtils.buildTypeParams(im.types)
                pushLabeledField("IMPP", params, esc(im.value), im.label)
            }
        }
        for sp in contact.socialProfiles where !sp.url.isEmpty {
            pushMethod(
                VCardUtils.keyForSocial(
                    url: sp.url, service: sp.service, username: sp.username, label: sp.label)
            ) {
                var params = ""
                if !sp.service.isEmpty {
                    params += ";TYPE=\(VCardUtils.encodeParamValue(sp.service))"
                }
                if !sp.username.isEmpty {
                    params += ";X-USER=\(VCardUtils.encodeParamValue(sp.username))"
                }
                pushLabeledField("X-SOCIALPROFILE", params, esc(sp.url), sp.label)
            }
        }

        if let birthday = contact.birthday, !birthday.isEmpty {
            lines.append("BDAY:\(esc(birthday))")
        }
        for note in contact.notes where !note.isEmpty {
            lines.append("NOTE:\(esc(note))")
        }

        if let anniversary = contact.anniversary, !anniversary.isEmpty {
            lines.append("item\(nextItem).X-ABDATE:\(esc(anniversary))")
            lines.append("item\(nextItem).X-ABLabel:_$!<Anniversary>!$_")
            nextItem += 1
        }
        for dateEntry in contact.dates where !dateEntry.value.isEmpty {
            lines.append("item\(nextItem).X-ABDATE:\(esc(dateEntry.value))")
            let label = dateEntry.label.isEmpty ? "Date" : dateEntry.label
            lines.append("item\(nextItem).X-ABLabel:\(VCardUtils.formatXABLabel(label))")
            nextItem += 1
        }

        // Relationships regenerated from the model — contact.related is the
        // single source of truth; the raw X-ABRELATEDNAMES groups are derived.
        for rel in contact.related where !rel.name.isEmpty {
            let label =
                !rel.rawType.isEmpty ? rel.rawType : RelationshipTaxonomy.vcardLabel(rel.type)
            lines.append("item\(nextItem).X-ABRELATEDNAMES:\(esc(rel.name))")
            lines.append("item\(nextItem).X-ABLabel:\(label)")
            nextItem += 1
        }

        // Format-neutral custom fields round-trip via X-CONSTELLATION-FIELD
        // (read back by VCFParser). The markdown body is already carried as NOTE.
        // JS iterates Object.entries insertion order; the ordered customFields
        // container preserves it, and JSONCodec matches JS `JSON.stringify` byte
        // for byte (incl. nested-object key order).
        for (key, field) in contact.customFields.pairs {
            if key == "markdown_body" { continue }
            let payload = JSONValue.object([
                "key": .string(key),
                "type": .string(field.type),
                "value": field.value,
            ])
            lines.append("X-CONSTELLATION-FIELD:\(esc(JSONCodec.stringifyCompact(payload)))")
        }

        return lines
    }

    // MARK: - Helpers

    static func nLine(_ name: StructuredName) -> String {
        "N:\(esc(name.family));\(esc(name.given));\(esc(name.additional));\(esc(name.prefix));\(esc(name.suffix))"
    }

    static func photoLines(_ dataUrl: String?) -> [String] {
        guard let dataUrl, dataUrl.hasPrefix("data:") else { return [] }
        // JS: /^data:([^;]+);base64,(.+)$/ — `.` does not cross newlines, so a
        // data URL containing a line break produces no PHOTO lines at all.
        guard
            let m = dataUrl.wholeMatch(
                of: /data:([^;]+);base64,([^\n\r\u{2028}\u{2029}]+)/)
        else { return [] }

        let mime = String(m.1).lowercased()
        let base64 = String(m.2).replacingOccurrences(
            of: "\\s+", with: "", options: .regularExpression)
        let typeMap: [String: String] = [
            "image/png": "PNG", "image/gif": "GIF", "image/webp": "WEBP",
            "image/heic": "HEIC", "image/heif": "HEIF", "image/bmp": "BMP",
            "image/tiff": "TIFF",
        ]
        let type = typeMap[mime] ?? "JPEG"
        let firstChunk = String(base64.prefix(72))
        var lines = ["PHOTO;ENCODING=b;TYPE=\(type):\(firstChunk)"]
        var rest = Substring(base64.dropFirst(72))
        while !rest.isEmpty {
            lines.append(" \(rest.prefix(72))")
            rest = rest.dropFirst(72)
        }
        return lines
    }

    static func namePartsFromDisplayName(_ displayName: String) -> StructuredName {
        let parts = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: /\s+/).map(String.init)
        if parts.isEmpty { return StructuredName() }
        if parts.count == 1 { return StructuredName(given: parts[0]) }
        return StructuredName(
            family: parts[parts.count - 1],
            given: parts[0],
            additional: parts[1..<(parts.count - 1)].joined(separator: " ")
        )
    }

    static func composeDisplayName(_ name: StructuredName) -> String {
        [name.prefix, name.given, name.additional, name.family, name.suffix]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func esc(_ value: String) -> String {
        VCardUtils.encodeValue(value)
    }
}
