import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

// Ports of test/parser-roundtrip.test.js (vCard-owned tests; the markdown,
// relationship-builder, and cross-format tests are owned elsewhere per the M1
// fan-out brief).

private func byUid(_ contacts: [Contact], _ uid: String) -> Contact {
    let found = contacts.first { $0.uid == uid }
    #expect(found != nil, "missing contact with UID \(uid)")
    return found ?? Contact()
}

private func matches(_ text: String, _ pattern: String) -> Bool {
    text.range(of: pattern, options: .regularExpression) != nil
}

@Suite struct VCardParserRoundtripTests {
    // JS: 'parser imports comprehensive Apple-style vCards with metadata intact'
    // (record.* assertions become sourceDocuments assertions — the JS record
    // duality is intentionally not ported.)
    @Test func importsComprehensiveAppleVCardsWithMetadataIntact() {
        let contacts = VCFParser().parse(FixtureLoader.contents(of: "comprehensive.vcf"))

        #expect(contacts.count == 7)

        let jane = byUid(contacts, "jane-doe-smith")
        #expect(jane.customFields.isEmpty)
        #expect(jane.sourceDocuments[0].format == "vcard")
        #expect(jane.sourceDocuments[0].index == 0)
        #expect(jane.sourceDocuments[0].raw.contains("BEGIN:VCARD"))
        #expect(jane.fn == "Dr. Jane, Q. Doe;Smith")
        #expect(
            jane.name
                == StructuredName(
                    family: "Doe;Smith", given: "Jane, Q.", additional: "", prefix: "Dr.",
                    suffix: ""))
        #expect(jane.org == "Example; Labs")
        #expect(jane.title == "Principal, Contacts")
        #expect(jane.emails[0].value == "jane@example.com")
        #expect(jane.emails[0].types == ["INTERNET", "HOME", "PREF"])
        #expect(jane.emails[1].types == ["X-CUSTOM-LABEL"])
        #expect(jane.phones[0].types == ["CELL", "VOICE", "PREF"])
        #expect(jane.phones[1].types == ["HOME", "VOICE"])
        #expect(jane.addresses[0].street == "123 Main; Apt 4")
        #expect(jane.addresses[0].types == ["HOME", "PREF"])
        #expect(jane.anniversary == "2005-06-20")
        #expect(jane.related[0].name == "John Smith")
        #expect(jane.related[0].type == "husband")
        #expect(jane.photo == "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD")
        #expect(jane.notes[0].contains("Line one\nLine two"))
        #expect(jane.noteTags == ["mitre", "neighbor"])

        let company = byUid(contacts, "company-acme")
        #expect(company.isCompany == true)
        #expect(
            company.fn
                == "Acme Corporation International Research and Development Holdings")
    }

    // JS: 'vCard adapter imports and serializes through the format boundary'
    @Test func adapterImportsAndSerializesThroughFormatBoundary() {
        let adapter = VCardAdapter()
        let contacts = adapter.parse(FixtureLoader.contents(of: "comprehensive.vcf"), startIndex: 0)

        #expect(adapter.id == "vcard")
        #expect(adapter.canImportFile(named: "contacts.vcf") == true)
        #expect(adapter.canImportFile(named: "contacts.md") == false)
        #expect(contacts.count == 7)
        #expect(contacts[0].sourceDocuments[0].format == "vcard")

        let serialized = adapter.serialize(contacts, ids: [contacts[0].id])
        let reparsed = adapter.parse(serialized, startIndex: 0)

        #expect(reparsed.count == 1)
        #expect(reparsed[0].uid == contacts[0].uid)
        #expect(serialized.hasPrefix("BEGIN:VCARD"))
        #expect(serialized.hasSuffix("\r\n"))
    }

    // JS: 'serializer round-trips key fields, preferred flags, custom labels,
    // photos, hashtags, and geography' — app._rewriteEditableFields is
    // rawVCard = rewriteVCard(contact); _serializeCurrentVCF is adapter.serialize.
    @Test func serializerRoundTripsKeyFieldsThroughRewrite() {
        var contacts = VCFParser().parse(FixtureLoader.contents(of: "comprehensive.vcf"))

        for i in contacts.indices where contacts[i].rawVCard != nil {
            contacts[i].rawVCard = VCardSerializer.rewriteVCard(contacts[i])
        }
        let exported = VCardAdapter().serialize(contacts, ids: nil)
        let reparsed = VCFParser().parse(exported)

        let jane = byUid(reparsed, "jane-doe-smith")
        #expect(jane.fn == "Dr. Jane, Q. Doe;Smith")
        #expect(jane.name.family == "Doe;Smith")
        #expect(jane.name.given == "Jane, Q.")
        #expect(jane.emails[0].types == ["INTERNET", "HOME", "PREF"])
        #expect(jane.emails[1].types == ["X-CUSTOM-LABEL"])
        #expect(jane.phones[0].types == ["CELL", "VOICE", "PREF"])
        #expect(jane.addresses[0].street == "123 Main; Apt 4")
        #expect(jane.addresses[0].country == "USA")
        #expect(jane.anniversary == "2005-06-20")
        #expect(jane.related[0].name == "John Smith")
        #expect(jane.related[0].type == "husband")
        #expect(jane.photo == "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD")
        #expect(jane.noteTags == ["mitre", "neighbor"])

        let company = byUid(reparsed, "company-acme")
        #expect(company.isCompany == true)

        let geo = byUid(reparsed, "geo-work")
        #expect(geo.addresses[0].types[0] == "WORK")
        #expect(geo.addresses[0].city == "San Francisco")
    }

    // JS: 'Apple item-grouped custom labels on email/phone/address survive parse + edit'
    @Test func itemGroupedCustomLabelsSurviveParseAndEdit() {
        let vcard = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "UID:label-test",
            "N:Test;Label;;;",
            "FN:Label Test",
            "item1.EMAIL;type=INTERNET:lake@example.com",
            "item1.X-ABLabel:_$!<Lake House>!$_",
            "item2.TEL:555-9000",
            "item2.X-ABLabel:_$!<Boat>!$_",
            "item3.ADR:;;1 Dock Rd;Harbor;ME;04001;USA",
            "item3.X-ABLabel:_$!<Marina>!$_",
            "END:VCARD",
        ].joined(separator: "\r\n")

        var contacts = VCFParser().parse(vcard)
        #expect(contacts.count == 1)

        // Parsed into the model as a per-instance label.
        #expect(contacts[0].emails[0].label == "Lake House")
        #expect(contacts[0].phones[0].label == "Boat")
        #expect(contacts[0].addresses[0].label == "Marina")

        // Editing the contact regenerates the card from the model — labels must
        // survive (regression: item-grouped labels used to be dropped on edit).
        contacts[0].rawVCard = VCardSerializer.rewriteVCard(contacts[0])
        #expect(matches(contacts[0].rawVCard ?? "", "X-ABLabel:_\\$!<Lake House>!\\$_"))
        let reparsed = VCFParser().parse(contacts[0].rawVCard ?? "")[0]
        #expect(reparsed.emails[0].label == "Lake House")
        #expect(reparsed.phones[0].label == "Boat")
        #expect(reparsed.addresses[0].label == "Marina")
    }

    // JS: 'IMPP instant messages parse, model service, and survive an edit'
    @Test func imppParsesModelsServiceAndSurvivesEdit() {
        let vcard = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "UID:im-test",
            "N:Test;Im;;;",
            "FN:Im Test",
            "IMPP;X-SERVICE-TYPE=Skype:skype:johndoe",
            "IMPP;X-SERVICE-TYPE=Jabber:xmpp:john@example.com",
            "END:VCARD",
        ].joined(separator: "\r\n")

        var contacts = VCFParser().parse(vcard)
        #expect(contacts[0].ims.count == 2)
        #expect(contacts[0].ims[0].service == "Skype")
        #expect(contacts[0].ims[0].value == "skype:johndoe")
        #expect(contacts[0].ims[1].service == "Jabber")

        contacts[0].rawVCard = VCardSerializer.rewriteVCard(contacts[0])
        let reparsed = VCFParser().parse(contacts[0].rawVCard ?? "")[0]
        #expect(reparsed.ims.count == 2)
        #expect(reparsed.ims[0].service == "Skype")
        #expect(reparsed.ims[0].value == "skype:johndoe")
        #expect(reparsed.ims[1].value == "xmpp:john@example.com")
    }

    // JS: 'X-SOCIALPROFILE social profiles parse and survive an edit'
    @Test func socialProfilesParseAndSurviveEdit() {
        let vcard = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "UID:social-test",
            "N:Test;Social;;;",
            "FN:Social Test",
            "X-SOCIALPROFILE;TYPE=Twitter;X-USER=johnd:https://twitter.com/johnd",
            "item1.X-SOCIALPROFILE;TYPE=LinkedIn:https://linkedin.com/in/john",
            "item1.X-ABLabel:_$!<Work>!$_",
            "END:VCARD",
        ].joined(separator: "\r\n")

        var contacts = VCFParser().parse(vcard)
        #expect(contacts[0].socialProfiles.count == 2)
        #expect(contacts[0].socialProfiles[0].service == "Twitter")
        #expect(contacts[0].socialProfiles[0].username == "johnd")
        #expect(contacts[0].socialProfiles[0].url == "https://twitter.com/johnd")
        #expect(contacts[0].socialProfiles[1].service == "LinkedIn")
        #expect(contacts[0].socialProfiles[1].label == "Work")

        contacts[0].rawVCard = VCardSerializer.rewriteVCard(contacts[0])
        let raw = contacts[0].rawVCard ?? ""
        let reparsed = VCFParser().parse(raw)[0]
        #expect(reparsed.socialProfiles.count == 2)
        #expect(reparsed.socialProfiles[0].username == "johnd")
        #expect(reparsed.socialProfiles[1].label == "Work")
        #expect(raw.contains("X-SOCIALPROFILE;TYPE=Twitter;X-USER=johnd:"))
    }
}
