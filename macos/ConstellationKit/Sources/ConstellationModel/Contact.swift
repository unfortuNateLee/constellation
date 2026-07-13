// The one contact model (DESIGN_SPEC.md §8.1). Field order and defaults mirror
// `ContactRecord.STANDARD_FIELDS` (js/contact-record.js:18-58), the single source
// of the contact shape. Where the JS runtime and the spec disagree the JS wins:
// notably `notes` is an ARRAY of strings (STANDARD_FIELDS default `[]`), not a
// scalar string as §8.1 describes.
//
// The legacy-vs-record duality (`fromLegacyContact` / `attachToLegacyContact`) is
// a JS phase-1 migration artifact and is intentionally NOT ported — `Contact` is
// the single model. `sourceDocuments` (format/raw/index/dirty) does belong here.
public struct Contact: Codable, Equatable, Sendable {
    /// Deterministic, per-parse-stable id (see `StableIDAllocator`).
    public var id: String
    /// Source UID (vCard `UID`), or `nil` when absent.
    public var uid: String?

    // --- STANDARD_FIELDS, in js/contact-record.js order ---
    public var fn: String
    public var name: StructuredName
    public var nickname: String
    public var maidenName: String
    public var phoneticFirst: String
    public var phoneticLast: String
    public var org: String
    /// Second ORG component (e.g. "ACME Inc.;Development" → "Development").
    public var department: String
    public var phoneticOrg: String
    public var title: String
    /// vCard GENDER sex component: "M" | "F" | "" (unset/unknown).
    public var gender: String
    public var isCompany: Bool
    /// Apple alternate/lunar birthday (X-ALTBDAY); display + preserve only.
    public var altBirthday: String
    public var emails: [LabeledValue]
    public var phones: [LabeledValue]
    public var addresses: [AddressValue]
    /// vCard `BDAY` value string, or `nil` when unset.
    public var birthday: String?
    /// Anniversary X-ABDATE value string, or `nil` when unset.
    public var anniversary: String?
    /// Additional Apple custom-labeled dates (X-ABDATE) beyond anniversary.
    public var dates: [DatedValue]
    /// Instant-message handles (IMPP).
    public var ims: [ImValue]
    /// Social profiles (X-SOCIALPROFILE).
    public var socialProfiles: [SocialProfileValue]
    /// NOTE: an array (one entry per vCard NOTE), matching the JS runtime shape.
    public var notes: [String]
    public var related: [RelatedValue]
    public var urls: [LabeledValue]
    /// PHOTO as a data URI, or `nil`.
    public var photo: String?
    public var tags: [String]
    public var noteTags: [String]

    // --- non-STANDARD_FIELDS model members ---
    /// Format-neutral custom fields, in insertion order (mirrors the JS plain
    /// object; `Object.entries` order drives byte-identical serialization).
    public var customFields: OrderedDictionary<TypedField>
    public var rawVCard: String?
    public var sourceDocuments: [SourceDocument]
    /// Hybrid raw preservation (JS `_rawByKey`): content key of an untouched
    /// contact-method instance → its original raw vCard line(s). Populated by
    /// the vCF parser, consumed by the serializer's rewrite path so unedited
    /// instances re-emit byte-for-byte. Runtime-only in spirit (rebuilt on each
    /// parse), but Codable like the rest of the model.
    public var rawByKey: [String: [String]]

    public init(
        id: String = "",
        uid: String? = nil,
        fn: String = "",
        name: StructuredName = StructuredName(),
        nickname: String = "",
        maidenName: String = "",
        phoneticFirst: String = "",
        phoneticLast: String = "",
        org: String = "",
        department: String = "",
        phoneticOrg: String = "",
        title: String = "",
        gender: String = "",
        isCompany: Bool = false,
        altBirthday: String = "",
        emails: [LabeledValue] = [],
        phones: [LabeledValue] = [],
        addresses: [AddressValue] = [],
        birthday: String? = nil,
        anniversary: String? = nil,
        dates: [DatedValue] = [],
        ims: [ImValue] = [],
        socialProfiles: [SocialProfileValue] = [],
        notes: [String] = [],
        related: [RelatedValue] = [],
        urls: [LabeledValue] = [],
        photo: String? = nil,
        tags: [String] = [],
        noteTags: [String] = [],
        customFields: OrderedDictionary<TypedField> = [:],
        rawVCard: String? = nil,
        sourceDocuments: [SourceDocument] = [],
        rawByKey: [String: [String]] = [:]
    ) {
        self.id = id
        self.uid = uid
        self.fn = fn
        self.name = name
        self.nickname = nickname
        self.maidenName = maidenName
        self.phoneticFirst = phoneticFirst
        self.phoneticLast = phoneticLast
        self.org = org
        self.department = department
        self.phoneticOrg = phoneticOrg
        self.title = title
        self.gender = gender
        self.isCompany = isCompany
        self.altBirthday = altBirthday
        self.emails = emails
        self.phones = phones
        self.addresses = addresses
        self.birthday = birthday
        self.anniversary = anniversary
        self.dates = dates
        self.ims = ims
        self.socialProfiles = socialProfiles
        self.notes = notes
        self.related = related
        self.urls = urls
        self.photo = photo
        self.tags = tags
        self.noteTags = noteTags
        self.customFields = customFields
        self.rawVCard = rawVCard
        self.sourceDocuments = sourceDocuments
        self.rawByKey = rawByKey
    }
}
