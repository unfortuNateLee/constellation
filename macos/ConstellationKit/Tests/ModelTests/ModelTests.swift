import Testing
import Foundation
@testable import ConstellationModel

struct JSONValueTests {
    private func roundTrip(_ value: JSONValue) throws -> JSONValue {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    @Test func scalarsRoundTrip() throws {
        for value: JSONValue in [
            .string("hello"),
            .string(""),
            .number(42),
            .number(-3.5),
            .number(0),
            .bool(true),
            .bool(false),
            .null,
        ] {
            #expect(try roundTrip(value) == value)
        }
    }

    @Test func nestedRoundTrip() throws {
        let value: JSONValue = .object([
            "name": .string("Ada"),
            "age": .number(36),
            "member": .bool(true),
            "middle": .null,
            "tags": .array([.string("a"), .string("b")]),
            "nested": .object(["x": .array([.number(1), .number(2)])]),
        ])
        #expect(try roundTrip(value) == value)
    }

    @Test func boolNotDecodedAsNumber() throws {
        // Guards decode ordering: `true` must stay a bool, not become 1.
        let data = Data("true".utf8)
        #expect(try JSONDecoder().decode(JSONValue.self, from: data) == .bool(true))
    }

    @Test func typedFieldRoundTrips() throws {
        let field = TypedField(
            type: "custom",
            value: .object(["k": .array([.string("v"), .number(1)])]),
            label: "My Field",
            metadata: ["source": .string("markdown")]
        )
        let data = try JSONEncoder().encode(field)
        #expect(try JSONDecoder().decode(TypedField.self, from: data) == field)
    }
}

struct ContactModelTests {
    @Test func emptyContactDefaultsMatchJS() {
        // Mirrors ContactRecord.createEmptyContact() defaults.
        let c = Contact()
        #expect(c.id == "")
        #expect(c.uid == nil)
        #expect(c.fn == "")
        #expect(c.name == StructuredName())
        #expect(c.nickname == "")
        #expect(c.maidenName == "")
        #expect(c.phoneticFirst == "")
        #expect(c.phoneticLast == "")
        #expect(c.org == "")
        #expect(c.department == "")
        #expect(c.phoneticOrg == "")
        #expect(c.title == "")
        #expect(c.gender == "")
        #expect(c.isCompany == false)
        #expect(c.altBirthday == "")
        #expect(c.emails.isEmpty)
        #expect(c.phones.isEmpty)
        #expect(c.addresses.isEmpty)
        #expect(c.birthday == nil)
        #expect(c.anniversary == nil)
        #expect(c.dates.isEmpty)
        #expect(c.ims.isEmpty)
        #expect(c.socialProfiles.isEmpty)
        // notes is an ARRAY (JS wins over spec §8.1's scalar).
        #expect(c.notes.isEmpty)
        #expect(c.related.isEmpty)
        #expect(c.urls.isEmpty)
        #expect(c.photo == nil)
        #expect(c.tags.isEmpty)
        #expect(c.noteTags.isEmpty)
        #expect(c.customFields.isEmpty)
        #expect(c.rawVCard == nil)
        #expect(c.sourceDocuments.isEmpty)
    }

    @Test func fullyPopulatedContactRoundTrips() throws {
        let c = Contact(
            id: "c_abc",
            uid: "UID-1",
            fn: "Ada Lovelace",
            name: StructuredName(family: "Lovelace", given: "Ada"),
            org: "Analytical Engines",
            department: "R&D",
            gender: "F",
            isCompany: false,
            emails: [LabeledValue(value: "ada@x.com", types: ["HOME", "PREF"])],
            phones: [LabeledValue(value: "+1", types: ["CELL"], label: "Pocket")],
            addresses: [AddressValue(street: "1 Rd", city: "London", types: ["HOME"], label: "Flat")],
            birthday: "1815-12-10",
            anniversary: "1835-07-08",
            dates: [DatedValue(label: "Graduation", value: "1833-01-01")],
            ims: [ImValue(value: "ada", service: "Signal", types: ["HOME"], label: "Chat")],
            socialProfiles: [SocialProfileValue(url: "https://x.com/ada", service: "twitter", username: "ada")],
            notes: ["first note", "second #tag"],
            related: [RelatedValue(name: "Byron", type: "father", rawType: "_$!<Father>!$_")],
            urls: [LabeledValue(value: "https://ada.dev", types: ["WORK"])],
            photo: "data:image/png;base64,AAAA",
            tags: ["company"],
            noteTags: ["tag"],
            customFields: ["x": TypedField(type: "text", value: .string("v"))],
            rawVCard: "BEGIN:VCARD\nEND:VCARD",
            sourceDocuments: [SourceDocument(format: "vcard", raw: "BEGIN:VCARD", index: 0, dirty: false)]
        )
        let data = try JSONEncoder().encode(c)
        #expect(try JSONDecoder().decode(Contact.self, from: data) == c)
    }

    @Test func isPreferredIsCaseInsensitive() {
        #expect(LabeledValue(types: ["PREF"]).isPreferred)
        #expect(LabeledValue(types: ["pref"]).isPreferred)
        #expect(LabeledValue(types: ["HOME", "Pref"]).isPreferred)
        #expect(!LabeledValue(types: ["HOME"]).isPreferred)
        #expect(AddressValue(types: ["pref"]).isPreferred)
        #expect(ImValue(types: ["PREF"]).isPreferred)
    }
}
