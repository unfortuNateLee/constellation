// Sub-shapes of the §8.1 Contact record. Field sets are derived from the runtime
// shapes that `js/vcf-parser.js` actually produces (cross-checked with
// DESIGN_SPEC.md §8.1). Where the JS runtime and the spec disagree, the JS wins.
//
// All types are value types: Codable, Equatable, Sendable, with a memberwise
// public init whose defaults match the JS empty-value defaults ("" / [] / nil).

/// vCard `N` structured name — `{ family, given, additional, prefix, suffix }`
/// (js/vcf-parser.js `case 'N'`).
public struct StructuredName: Codable, Equatable, Sendable {
    public var family: String
    public var given: String
    public var additional: String
    public var prefix: String
    public var suffix: String

    public init(
        family: String = "",
        given: String = "",
        additional: String = "",
        prefix: String = "",
        suffix: String = ""
    ) {
        self.family = family
        self.given = given
        self.additional = additional
        self.prefix = prefix
        self.suffix = suffix
    }
}

/// An email / phone / URL entry — `{ value, types, label }`.
/// `PREF` lives inside `types` (order-preserving; not normalized); `label` is the
/// custom X-ABLabel ("" when none). (js/vcf-parser.js EMAIL/TEL/URL cases + item-group label.)
public struct LabeledValue: Codable, Equatable, Sendable {
    public var value: String
    public var types: [String]
    public var label: String

    public init(value: String = "", types: [String] = [], label: String = "") {
        self.value = value
        self.types = types
        self.label = label
    }

    /// `PREF` present in `types` (case-insensitive, matching `typesToLabel`'s uppercasing).
    public var isPreferred: Bool {
        types.contains { $0.uppercased() == "PREF" }
    }
}

/// A postal address — `{ pobox, ext, street, city, state, zip, country, types, label }`
/// (js/vcf-parser.js `case 'ADR'` + item-group label).
public struct AddressValue: Codable, Equatable, Sendable {
    public var pobox: String
    public var ext: String
    public var street: String
    public var city: String
    public var state: String
    public var zip: String
    public var country: String
    public var types: [String]
    public var label: String

    public init(
        pobox: String = "",
        ext: String = "",
        street: String = "",
        city: String = "",
        state: String = "",
        zip: String = "",
        country: String = "",
        types: [String] = [],
        label: String = ""
    ) {
        self.pobox = pobox
        self.ext = ext
        self.street = street
        self.city = city
        self.state = state
        self.zip = zip
        self.country = country
        self.types = types
        self.label = label
    }

    public var isPreferred: Bool {
        types.contains { $0.uppercased() == "PREF" }
    }
}

/// A related name — `{ name, type, rawType }` (js/vcf-parser.js X-ABRELATEDNAMES).
/// `type` is the normalized relationship type; `rawType` is the original X-ABLabel.
public struct RelatedValue: Codable, Equatable, Sendable {
    public var name: String
    public var type: String
    public var rawType: String

    public init(name: String = "", type: String = "", rawType: String = "") {
        self.name = name
        self.type = type
        self.rawType = rawType
    }
}

/// An instant-message handle — `{ value, service, types, label }`
/// (js/vcf-parser.js `case 'IMPP'` + X-SERVICE-TYPE sibling + item-group label).
public struct ImValue: Codable, Equatable, Sendable {
    public var value: String
    public var service: String
    public var types: [String]
    public var label: String

    public init(value: String = "", service: String = "", types: [String] = [], label: String = "") {
        self.value = value
        self.service = service
        self.types = types
        self.label = label
    }

    public var isPreferred: Bool {
        types.contains { $0.uppercased() == "PREF" }
    }
}

/// A social profile — `{ url, service, username, label }`
/// (js/vcf-parser.js `case 'X-SOCIALPROFILE'` + item-group label).
public struct SocialProfileValue: Codable, Equatable, Sendable {
    public var url: String
    public var service: String
    public var username: String
    public var label: String

    public init(url: String = "", service: String = "", username: String = "", label: String = "") {
        self.url = url
        self.service = service
        self.username = username
        self.label = label
    }
}

/// An Apple custom-labeled date (X-ABDATE, beyond anniversary) — `{ label, value }`
/// (js/vcf-parser.js item-group `X-ABDATE` branch).
public struct DatedValue: Codable, Equatable, Sendable {
    public var label: String
    public var value: String

    public init(label: String = "", value: String = "") {
        self.label = label
        self.value = value
    }
}

/// A format-neutral custom field (`Contact.customFields[key]`). `type` is an open
/// vocabulary; `value` holds arbitrary JSON losslessly. `label` / `metadata` are
/// optional extensions per the M1 interface brief.
public struct TypedField: Codable, Equatable, Sendable {
    public var type: String
    public var value: JSONValue
    public var label: String?
    public var metadata: [String: JSONValue]?

    public init(
        type: String = "",
        value: JSONValue = .null,
        label: String? = nil,
        metadata: [String: JSONValue]? = nil
    ) {
        self.type = type
        self.value = value
        self.label = label
        self.metadata = metadata
    }
}

/// The originating document a contact was parsed from — `{ format, raw, index, dirty }`
/// (js/contact-record.js `_sourceDocument`).
public struct SourceDocument: Codable, Equatable, Sendable {
    public var format: String
    public var raw: String
    public var index: Int?
    public var dirty: Bool

    public init(format: String = "vcard", raw: String = "", index: Int? = nil, dirty: Bool = false) {
        self.format = format
        self.raw = raw
        self.index = index
        self.dirty = dirty
    }
}
