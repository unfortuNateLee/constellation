import ConstellationModel

/// Which adapter parsed a fixture. The canonical model projection is
/// format-dependent because the JS parsers (the byte-for-byte ground truth)
/// produce *different object shapes* per format:
///
///   - vCard entries omit a contact-method `label` unless the source had an
///     Apple `X-ABLABEL` item group (so an empty label is **absent**, not `""`),
///     and `related` carries `rawType`.
///   - Markdown entries always carry `label` (default `""`), and `related` has
///     **no** `rawType`.
///   - TSV mirrors the vCard shape for `related` (rawType present) and omits
///     `label` on emails/phones/urls (no `.tsv` fixtures exist today, so this
///     path is unexercised by the gate; kept faithful to `js/tsv-adapter.js`).
///
/// The Swift model can't distinguish "absent label" from "empty label" — both
/// are `""` — so the projection reconstructs the JS presence rule from the
/// format plus the value. This is dumper-side projection, not adapter behavior.
enum SourceFormat {
    case vcard
    case markdown
    case tsv

    /// Contact-method entries (emails/phones/urls/addresses/ims/social) emit
    /// `label` even when empty. Markdown always does; vCard/TSV only when present.
    var alwaysEmitLabel: Bool { self == .markdown }

    /// `related` carries `rawType` (vCard/TSV) vs. name+type only (Markdown).
    var relatedHasRawType: Bool { self != .markdown }

    /// emails/phones/urls omit `label` entirely (TSV only).
    var methodOmitsLabel: Bool { self == .tsv }
}

/// Projects a parsed `Contact` down to the canonical §8.1 model object as a
/// `JSONValue` tree, EXCLUDING `sourceDocuments`/`rawByKey` (Swift-only) and
/// matching the exact field set the Node dumper emits. Keys are assembled in any
/// order; `CanonicalJSON` sorts them at serialization time.
enum ContactModel {
    static func project(_ c: Contact, format: SourceFormat) -> JSONValue {
        var o: [(String, JSONValue)] = []
        func put(_ key: String, _ value: JSONValue) { o.append((key, value)) }

        put("id", .string(c.id))
        put("uid", nullableString(c.uid))
        put("fn", .string(c.fn))
        put("name", name(c.name))
        put("nickname", .string(c.nickname))
        put("maidenName", .string(c.maidenName))
        put("phoneticFirst", .string(c.phoneticFirst))
        put("phoneticLast", .string(c.phoneticLast))
        put("org", .string(c.org))
        put("department", .string(c.department))
        put("phoneticOrg", .string(c.phoneticOrg))
        put("title", .string(c.title))
        put("gender", .string(c.gender))
        put("isCompany", .bool(c.isCompany))
        put("altBirthday", .string(c.altBirthday))
        put("emails", .array(c.emails.map { labeled($0, format: format) }))
        put("phones", .array(c.phones.map { labeled($0, format: format) }))
        put("addresses", .array(c.addresses.map { address($0, format: format) }))
        put("birthday", nullableString(c.birthday))
        put("anniversary", nullableString(c.anniversary))
        put("dates", .array(c.dates.map { dated($0) }))
        put("ims", .array(c.ims.map { im($0, format: format) }))
        put("socialProfiles", .array(c.socialProfiles.map { social($0, format: format) }))
        put("notes", .array(c.notes.map { .string($0) }))
        put("related", .array(c.related.map { related($0, format: format) }))
        put("urls", .array(c.urls.map { labeled($0, format: format) }))
        put("photo", nullableString(c.photo))
        put("tags", .array(c.tags.map { .string($0) }))
        put("noteTags", .array(c.noteTags.map { .string($0) }))
        put("customFields", customFields(c.customFields))
        put("rawVCard", .string(c.rawVCard ?? ""))

        return .object(JSONObject(o))
    }

    // MARK: - Sub-shapes

    private static func nullableString(_ s: String?) -> JSONValue {
        s.map { .string($0) } ?? .null
    }

    private static func name(_ n: StructuredName) -> JSONValue {
        .object(JSONObject([
            ("family", .string(n.family)),
            ("given", .string(n.given)),
            ("additional", .string(n.additional)),
            ("prefix", .string(n.prefix)),
            ("suffix", .string(n.suffix)),
        ]))
    }

    private static func labeled(_ v: LabeledValue, format: SourceFormat) -> JSONValue {
        var pairs: [(String, JSONValue)] = [
            ("value", .string(v.value)),
            ("types", .array(v.types.map { .string($0) })),
        ]
        appendLabel(&pairs, v.label, format: format)
        return .object(JSONObject(pairs))
    }

    private static func address(_ a: AddressValue, format: SourceFormat) -> JSONValue {
        var pairs: [(String, JSONValue)] = [
            ("pobox", .string(a.pobox)),
            ("ext", .string(a.ext)),
            ("street", .string(a.street)),
            ("city", .string(a.city)),
            ("state", .string(a.state)),
            ("zip", .string(a.zip)),
            ("country", .string(a.country)),
            ("types", .array(a.types.map { .string($0) })),
        ]
        appendLabel(&pairs, a.label, format: format)
        return .object(JSONObject(pairs))
    }

    private static func im(_ v: ImValue, format: SourceFormat) -> JSONValue {
        var pairs: [(String, JSONValue)] = [
            ("value", .string(v.value)),
            ("service", .string(v.service)),
            ("types", .array(v.types.map { .string($0) })),
        ]
        appendLabel(&pairs, v.label, format: format)
        return .object(JSONObject(pairs))
    }

    private static func social(_ v: SocialProfileValue, format: SourceFormat) -> JSONValue {
        var pairs: [(String, JSONValue)] = [
            ("url", .string(v.url)),
            ("service", .string(v.service)),
            ("username", .string(v.username)),
        ]
        appendLabel(&pairs, v.label, format: format)
        return .object(JSONObject(pairs))
    }

    private static func dated(_ v: DatedValue) -> JSONValue {
        .object(JSONObject([
            ("label", .string(v.label)),
            ("value", .string(v.value)),
        ]))
    }

    private static func related(_ v: RelatedValue, format: SourceFormat) -> JSONValue {
        var pairs: [(String, JSONValue)] = [
            ("name", .string(v.name)),
            ("type", .string(v.type)),
        ]
        if format.relatedHasRawType {
            pairs.append(("rawType", .string(v.rawType)))
        }
        return .object(JSONObject(pairs))
    }

    /// Append `label` per the format's presence rule: emails/phones/urls in TSV
    /// omit it entirely; Markdown always emits it; vCard emits only when non-empty.
    private static func appendLabel(
        _ pairs: inout [(String, JSONValue)],
        _ label: String,
        format: SourceFormat
    ) {
        if format.methodOmitsLabel { return }
        if format.alwaysEmitLabel || !label.isEmpty {
            pairs.append(("label", .string(label)))
        }
    }

    private static func customFields(_ fields: OrderedDictionary<TypedField>) -> JSONValue {
        var obj: [(String, JSONValue)] = []
        for (key, field) in fields.pairs {
            var pairs: [(String, JSONValue)] = [
                ("type", .string(field.type)),
                ("value", field.value),
            ]
            if let label = field.label {
                pairs.append(("label", .string(label)))
            }
            if let metadata = field.metadata {
                var meta: [(String, JSONValue)] = []
                for (mk, mv) in metadata { meta.append((mk, mv)) }
                pairs.append(("metadata", .object(JSONObject(meta))))
            }
            obj.append((key, .object(JSONObject(pairs))))
        }
        return .object(JSONObject(obj))
    }
}
