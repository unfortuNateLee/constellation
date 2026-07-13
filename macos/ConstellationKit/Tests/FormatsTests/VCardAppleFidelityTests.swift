import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

// Ports of test/apple-fidelity.test.js: end-to-end Apple-field fidelity against
// the 2-card torture fixture: import → edit an unrelated field (forces a full
// rewrite) → export → reparse, asserting nothing is lost and untouched
// instances stay byte-identical.

private func matches(_ text: String, _ pattern: String) -> Bool {
    text.range(of: pattern, options: .regularExpression) != nil
}

@Suite struct VCardAppleFidelityTests {
    private func parseFixture() -> [Contact] {
        VCardAdapter().parse(FixtureLoader.contents(of: "apple-full-fields.vcf"), startIndex: 0)
    }

    // JS: 'every Apple field parses off the torture fixture'
    @Test func everyAppleFieldParses() {
        let contacts = parseFixture()
        #expect(contacts.count == 2)
        let person = contacts[0]
        let company = contacts[1]

        // Identity
        #expect(person.nickname == "Testy")
        #expect(person.maidenName == "Beta")
        #expect(person.phoneticFirst == "TESS-TEE")
        #expect(person.phoneticLast == "MICK-TESS-TER-SEN")
        #expect(person.org == "ACME Inc.")
        #expect(person.department == "Development")
        #expect(person.phoneticOrg == "ACK-MEE INK")
        #expect(person.altBirthday == "0071-0815")

        // Multi-instance
        #expect(person.phones.count == 12)
        #expect(person.emails.count == 4)
        #expect(person.addresses.count == 5)
        #expect(person.urls.count == 5)
        #expect(person.socialProfiles.count == 8)
        #expect(person.ims.count >= 9)
        #expect(person.related.count == 15)
        #expect(person.photo?.hasPrefix("data:image") == true)

        // The iPhone retains its full multi-type set.
        let iphone = person.phones.first { $0.types.contains("IPHONE") }
        #expect(iphone != nil)
        #expect(iphone?.types.sorted() == ["CELL", "IPHONE", "PREF", "VOICE"])

        // Company flag
        #expect(company.isCompany == true)
        #expect(person.isCompany == false)
    }

    // JS: 'editing an unrelated field preserves all Apple fields + untouched raw lines'
    @Test func editingUnrelatedFieldPreservesAppleFieldsAndRawLines() {
        var contacts = parseFixture()

        // Edit something unrelated to phones, forcing a full card rewrite.
        contacts[0].title = "Chief Tester"
        contacts[0].rawVCard = VCardSerializer.rewriteVCard(contacts[0])
        let raw = contacts[0].rawVCard ?? ""

        // Untouched multi-type phone lines survive byte-for-byte (Apple casing/order).
        #expect(raw.contains("TEL;type=IPHONE;type=CELL;type=VOICE;type=pref:12345678901"))
        #expect(raw.contains("TEL;type=APPLEWATCH;type=CELL;type=VOICE:1 (234) 567-8901"))
        #expect(matches(raw, "TEL;type=HOME;type=FAX:"))
        // Preserved-verbatim exotic fields.
        #expect(raw.contains("X-ALTBDAY;CALSCALE=gregorian:0071-0815"))
        // Regenerated identity fields reflect the model.
        #expect(raw.contains("NICKNAME:Testy"))
        #expect(raw.contains("ORG:ACME Inc.;Development"))
        #expect(raw.contains("TITLE:Chief Tester"))

        // Reparse and confirm counts + key fields are intact.
        let re = VCardAdapter().parse(raw, startIndex: 0)[0]
        #expect(re.phones.count == 12)
        #expect(re.emails.count == 4)
        #expect(re.addresses.count == 5)
        #expect(re.urls.count == 5)
        #expect(re.socialProfiles.count == 8)
        #expect(re.related.count == 15)
        #expect(re.department == "Development")
        #expect(re.maidenName == "Beta")
        #expect(re.altBirthday == "0071-0815")
        #expect(re.photo?.hasPrefix("data:image") == true)
        let reIphone = re.phones.first { $0.types.contains("IPHONE") }
        #expect(reIphone?.types.sorted() == ["CELL", "IPHONE", "PREF", "VOICE"])
    }
}
