import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

/// Ports of the Node `format-fidelity.test.js` Markdown cases (the Markdown half
/// of test 7, and tests 28, 116, 145, 154).
@Suite struct MarkdownFormatFidelityTests {
    private let adapter = MarkdownAdapter()

    // format-fidelity 7 (Markdown half): gender shows a human label and
    // round-trips back to the vCard sex code.
    @Test func genderRoundTripsThroughMarkdown() {
        let f = Contact(fn: "Bo", name: StructuredName(given: "Bo"), gender: "F")
        let out = adapter.serialize([f])
        #expect(out.contains("- **Gender:** Female"))
        #expect(adapter.parse(out).contacts[0].gender == "F")
    }

    // format-fidelity 28: a fully-populated contact round-trips across every
    // field group.
    @Test func fullyPopulatedContactRoundTrips() {
        let contact = Contact(
            id: "c1",
            uid: "jane-doe",
            fn: "Jane Doe",
            name: StructuredName(family: "Doe", given: "Jane", additional: "Q", prefix: "Dr.", suffix: "PhD"),
            nickname: "Janey",
            org: "Example Labs",
            department: "R&D",
            title: "Engineer",
            emails: [
                LabeledValue(value: "jane@x.com", types: ["HOME"]),
                LabeledValue(value: "j@w.com", types: ["WORK", "PREF"]),
                LabeledValue(value: "bat@x.com", types: [], label: "Bat Phone"),
            ],
            phones: [
                LabeledValue(value: "(555) 123-4567", types: ["IPHONE", "CELL"]),
                LabeledValue(value: "(555) 9", types: ["HOME", "FAX"]),
            ],
            addresses: [
                AddressValue(
                    street: "123 Main Street", city: "Anytown", state: "AL", zip: "12345",
                    country: "USA", types: ["HOME"])
            ],
            birthday: "1990-01-01",
            anniversary: "2015-06-20",
            dates: [DatedValue(label: "First met", value: "2018-03-12")],
            ims: [ImValue(value: "skype:jane.doe", service: "Skype")],
            socialProfiles: [SocialProfileValue(url: "https://twitter.com/janedoe", service: "Twitter")],
            related: [
                RelatedValue(name: "John Smith", type: "spouse"),
                RelatedValue(name: "Mary Doe", type: "mother"),
            ],
            urls: [LabeledValue(value: "https://jane.example.com", types: ["HOME"])],
            tags: ["vip", "college"],
            customFields: [
                "favorite_color": TypedField(type: "string", value: .string("#3366cc")),
                "lucky": TypedField(type: "list", value: .array([.string("7"), .string("13")])),
                "profile": TypedField(
                    type: "object", value: .object(["tier": .string("gold"), "points": .number(14200)])),
            ]
        )
        // altBirthday is set separately (not in the memberwise position order above).
        var populated = contact
        populated.altBirthday = "0071-0815"
        populated.notes = ["Met at the conference. #vip", "Loves hiking."]

        let re = adapter.parse(adapter.serialize([populated])).contacts[0]
        #expect(re.fn == "Jane Doe")
        #expect(re.uid == "jane-doe")
        #expect(re.name == StructuredName(family: "Doe", given: "Jane", additional: "Q", prefix: "Dr.", suffix: "PhD"))
        #expect(re.nickname == "Janey")
        #expect(re.department == "R&D")
        #expect(re.emails[2].value == "bat@x.com")
        #expect(re.emails[2].types == [])
        #expect(re.emails[2].label == "Bat Phone")
        #expect(re.emails[1].types == ["WORK", "PREF"])
        #expect(re.phones[1].types == ["HOME", "FAX"])  // "Home Fax"
        #expect(re.addresses[0].street == "123 Main Street")
        #expect(re.addresses[0].city == "Anytown")
        #expect(re.addresses[0].state == "AL")
        #expect(re.addresses[0].zip == "12345")
        #expect(re.addresses[0].country == "USA")
        #expect(re.addresses[0].types == ["HOME"])
        #expect(re.ims[0].value == "skype:jane.doe")  // scheme reconstructed
        #expect(re.socialProfiles[0].url == "https://twitter.com/janedoe")
        #expect(re.birthday == "1990-01-01")
        #expect(re.altBirthday == "0071-0815")
        #expect(re.dates.map { [$0.label, $0.value] } == [["First met", "2018-03-12"]])
        #expect(re.related.map { [$0.name, $0.type] } == [["John Smith", "spouse"], ["Mary Doe", "mother"]])
        #expect(re.notes == ["Met at the conference. #vip", "Loves hiking."])
        #expect(re.tags == ["vip", "college"])
        #expect(MDJSON.str(MDJSON.get(re.customFields["profile"]?.value, "tier")) == "gold")
        #expect(MDJSON.num(MDJSON.get(re.customFields["profile"]?.value, "points")) == 14200)
    }

    // format-fidelity 116: the newer standard fields round-trip.
    @Test func newerStandardFieldsRoundTrip() {
        let contact = Contact(
            id: "c1", uid: "u1", fn: "Dana Doe",
            name: StructuredName(family: "Doe", given: "Dana"),
            nickname: "Dee", maidenName: "Smith", phoneticFirst: "DAY-nuh", phoneticLast: "DOH",
            org: "Acme", department: "R&D", phoneticOrg: "AK-mee", title: "Engineer",
            altBirthday: "0071-0815")
        let re = adapter.parse(adapter.serialize([contact])).contacts[0]
        #expect(re.nickname == "Dee")
        #expect(re.maidenName == "Smith")
        #expect(re.phoneticFirst == "DAY-nuh")
        #expect(re.phoneticLast == "DOH")
        #expect(re.department == "R&D")
        #expect(re.phoneticOrg == "AK-mee")
        #expect(re.altBirthday == "0071-0815")
    }

    // format-fidelity 145: multiple notes survive as blank-line-separated
    // paragraphs.
    @Test func preservesMultipleNotes() {
        let contact = Contact(fn: "Multi Note", notes: ["First note", "Second note"])
        let re = adapter.parse(adapter.serialize([contact])).contacts[0]
        #expect(re.notes == ["First note", "Second note"])
    }

    // format-fidelity 154: externalized photos resolve from a sibling-image map;
    // unresolved refs are flagged (mapped to ParseResult.missingPhotoRefs).
    @Test func resolvesExternalizedPhotosFromMap() {
        let doc = ["## Photo Person", "", "- **Photo:** photo-person.jpg", ""].joined(separator: "\n")
        let dataUrl = "data:image/jpeg;base64,/9j/AAAA"

        // Without the image map → photo unresolved (nil), flagged.
        let bare = adapter.parse(doc)
        #expect(bare.contacts[0].photo == nil)
        #expect(bare.missingPhotoRefs == ["photo-person.jpg"])

        // With a matching sibling image (case-insensitive) → resolved.
        let withPhoto = adapter.parse(doc, options: ParseOptions(photoMap: ["photo-person.jpg": dataUrl]))
        #expect(withPhoto.contacts[0].photo == dataUrl)
        #expect(withPhoto.missingPhotoRefs.isEmpty)

        // An inline data: URL still works and isn't treated as unresolved.
        let inlineDoc = ["## Inline", "", "- **Photo:** \(dataUrl)", ""].joined(separator: "\n")
        let inline = adapter.parse(inlineDoc)
        #expect(inline.contacts[0].photo == dataUrl)
        #expect(inline.missingPhotoRefs.isEmpty)
    }
}
