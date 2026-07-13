import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

// Ports of the cross-format conversion tests deferred from the format-specific
// suites: test/parser-roundtrip.test.js's vCard<->Markdown conversion pair
// (lines 247, 277), and the full integrated version of format-fidelity.test.js's
// gender round-trip (line 7) — the vCard-only and Markdown-only halves of that
// gender test were already ported into VCardFidelityTests and
// MarkdownFormatFidelityTests respectively; this suite exercises the complete
// vCard -> Markdown -> vCard chain (and the equivalent vCard chain) as the JS
// test does in one shot.
//
// Where the JS asserts on `record.*` there is no equivalent here — the Swift
// `Contact` has no record duality — so those assertions are simply omitted;
// every other assertion is ported 1:1 against the direct `Contact` fields.

private func byUid(_ contacts: [Contact], _ uid: String) -> Contact {
    let found = contacts.first { $0.uid == uid }
    #expect(found != nil, "missing contact with UID \(uid)")
    return found ?? Contact()
}

@Suite struct CrossFormatTests {
    // JS test/parser-roundtrip.test.js:247
    // 'vCard to Markdown conversion preserves standard contact data'
    @Test func vCardToMarkdownPreservesStandardContactData() {
        let markdown = MarkdownAdapter()
        let contacts = VCFParser().parse(FixtureLoader.contents(of: "comprehensive.vcf"))
        let jane = byUid(contacts, "jane-doe-smith")

        let exported = markdown.serialize([jane])
        let reparsed = markdown.parse(exported).contacts
        let roundTripped = byUid(reparsed, "jane-doe-smith")

        #expect(roundTripped.fn == jane.fn)
        #expect(roundTripped.name == jane.name)
        #expect(roundTripped.org == jane.org)
        #expect(roundTripped.title == jane.title)
        #expect(roundTripped.emails[0].value == jane.emails[0].value)
        // Markdown shows human type labels (Apple-internal INTERNET/VOICE are not kept).
        #expect(roundTripped.emails[0].types == ["HOME", "PREF"])
        #expect(roundTripped.phones[0].value == jane.phones[0].value)
        #expect(roundTripped.addresses[0].street == jane.addresses[0].street)
        #expect(roundTripped.addresses[0].city == jane.addresses[0].city)
        #expect(roundTripped.addresses[0].state == jane.addresses[0].state)
        #expect(roundTripped.addresses[0].zip == jane.addresses[0].zip)
        #expect(roundTripped.addresses[0].country == jane.addresses[0].country)
        #expect(roundTripped.addresses[0].types == jane.addresses[0].types)
        #expect(roundTripped.birthday == jane.birthday)
        #expect(roundTripped.anniversary == jane.anniversary)
        #expect(roundTripped.related[0].name == jane.related[0].name)
        #expect(roundTripped.notes == jane.notes)
    }

    // JS test/parser-roundtrip.test.js:277
    // 'Markdown to vCard conversion preserves standard contact data'
    @Test func markdownToVCardPreservesStandardContactData() {
        let markdown = MarkdownAdapter()
        let vcard = VCardAdapter()
        let ada = markdown.parse(FixtureLoader.contents(of: "markdown-ada.md")).contacts[0]

        let exported = vcard.serialize([ada])
        let reparsed = vcard.parse(exported).contacts
        let roundTripped = byUid(reparsed, "md-ada-lovelace")

        #expect(exported.hasPrefix("BEGIN:VCARD"))
        #expect(roundTripped.fn == ada.fn)
        #expect(roundTripped.name == ada.name)
        #expect(roundTripped.org == ada.org)
        #expect(roundTripped.title == ada.title)
        #expect(roundTripped.emails[0].value == ada.emails[0].value)
        #expect(roundTripped.emails[0].types.contains("HOME"))
        #expect(roundTripped.phones[0].value == ada.phones[0].value)
        #expect(roundTripped.addresses[0].street == ada.addresses[0].street)
        #expect(roundTripped.addresses[0].city == ada.addresses[0].city)
        #expect(roundTripped.addresses[0].country == ada.addresses[0].country)
        #expect(roundTripped.urls[0].value == ada.urls[0].value)
        #expect(roundTripped.birthday == ada.birthday)
        #expect(roundTripped.related[0].name == ada.related[0].name)
        #expect(roundTripped.related[0].type == ada.related[0].type)
        #expect(roundTripped.noteTags == ["math"])
    }

    // JS test/format-fidelity.test.js:7
    // 'Gender (vCard GENDER) round-trips through vCard and Markdown' — full
    // integrated chain (the vCard-only and Markdown-only halves are already
    // covered by VCardFidelityTests.genderRoundTripsThroughVCard and
    // MarkdownFormatFidelityTests.genderRoundTripsThroughMarkdown).
    @Test func genderRoundTripsThroughVCardAndMarkdown() {
        let parser = VCFParser()
        // vCard parse maps M/F; other sex codes (O/N/U) -> "" (unknown).
        let m = parser.parse("BEGIN:VCARD\nVERSION:3.0\nFN:Al\nN:;Al;;;\nGENDER:M\nEND:VCARD")[0]
        let f = parser.parse("BEGIN:VCARD\nVERSION:3.0\nFN:Bo\nN:;Bo;;;\nGENDER:F;she\nEND:VCARD")[0]
        let o = parser.parse("BEGIN:VCARD\nVERSION:3.0\nFN:Cy\nN:;Cy;;;\nGENDER:O\nEND:VCARD")[0]
        #expect(m.gender == "M")
        #expect(f.gender == "F")  // sex code before the ";text" component
        #expect(o.gender == "")

        // vCard serialize
        #expect(VCardAdapter().serialize([m]).contains("GENDER:M"))

        // Markdown shows human labels and round-trips back to the code.
        let md = MarkdownAdapter()
        let out = md.serialize([f])
        #expect(out.contains("- **Gender:** Female"))
        #expect(md.parse(out).contacts[0].gender == "F")
    }
}
