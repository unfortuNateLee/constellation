import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

// Ports of the vCard-owned tests from test/robustness.test.js plus the
// registry-coverage test from test/contact-shape.test.js (re-expressed as a
// Codable key-set check — Swift has no runtime field registry).

/// Test double: fails the Nth block, mirroring the JS suite's monkey-patched
/// `_parseVCard` for the malformed-record isolation test.
private final class FailingParser: VCFParser {
    private var seen = 0
    private let failAt: Int

    init(failAt: Int) {
        self.failAt = failAt
        super.init()
    }

    struct SimulatedFailure: Error {}

    override func parseBlock(_ block: String) throws -> Contact? {
        seen += 1
        if seen == failAt { throw SimulatedFailure() }
        return try super.parseBlock(block)
    }
}

@Suite struct VCardRobustnessTests {
    // JS: 'vCard ids are deterministic and stable across reparses (UID-based)'
    @Test func idsAreDeterministicAndStableAcrossReparses() {
        let text = FixtureLoader.contents(of: "comprehensive.vcf")

        let first = VCFParser().parse(text)
        let second = VCFParser().parse(text)

        #expect(second.map(\.id) == first.map(\.id))

        let jane = first.first { $0.uid == "jane-doe-smith" }
        #expect(jane?.id.hasPrefix("c_") == true)
        // Distinct UIDs (even with identical display names) get distinct ids.
        let dupA = first.first { $0.uid == "duplicate-a" }
        let dupB = first.first { $0.uid == "duplicate-b" }
        #expect(dupA != nil && dupB != nil && dupA?.id != dupB?.id)
    }

    // JS: 'contacts without UID but identical names get stable, distinct ids'
    @Test func uidlessDuplicateNamesGetStableDistinctIds() {
        let text =
            "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Sam Same\r\nEND:VCARD\r\n"
            + "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Sam Same\r\nEND:VCARD\r\n"

        let a = VCFParser().parse(text)
        let b = VCFParser().parse(text)

        #expect(a.count == 2)
        #expect(a[0].id != a[1].id, "duplicate-name records must not collide")
        #expect(b.map(\.id) == a.map(\.id), "occurrence-based ids must be stable across reparses")
    }

    // JS: 'a malformed vCard record is skipped without aborting the whole import'
    @Test func malformedRecordIsSkippedWithoutAbortingImport() {
        let text =
            "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:a\r\nFN:Alpha\r\nEND:VCARD\r\n"
            + "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:b\r\nFN:Beta\r\nEND:VCARD\r\n"
            + "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c\r\nFN:Gamma\r\nEND:VCARD\r\n"

        let parser = FailingParser(failAt: 2)
        let contacts = parser.parse(text)

        #expect(contacts.map(\.uid) == ["a", "c"], "good records survive; only the failing one is dropped")
        #expect(parser.warnings.count == 1)
        #expect(parser.warnings[0].contains("Skipping malformed vCard at index 1"))
    }

    // JS: 'vCard fallback serializer preserves custom fields through export and
    // reparse' — adapted: the JS test sources custom fields by parsing
    // markdown-ada.md; the Markdown adapter is another task's scope, so the same
    // fields (scalar + nested object, plus markdown_body) are built directly.
    @Test func fallbackSerializerPreservesCustomFields() {
        let ada = Contact(
            id: "c_ada", uid: "md-ada-lovelace", fn: "Ada Lovelace",
            customFields: [
                "favorite_color": TypedField(type: "string", value: .string("#6a5acd")),
                "nested_profile": TypedField(
                    type: "object",
                    value: .object([
                        "source": .string("markdown-fixture"),
                        "confidence": .number(0.92),
                        "empty_string": .string(""),
                        "optional_note": .null,
                        "aliases": .array([
                            .string("Augusta Ada King"), .string("Countess of Lovelace"),
                        ]),
                        "review": .object([
                            "reviewer": .string("test-suite"), "approved": .bool(true),
                        ]),
                    ])),
                "markdown_body": TypedField(type: "markdown", value: .string("body text")),
            ])
        #expect(ada.rawVCard == nil, "no rawVCard forces the fallback path")

        let vcard = VCardAdapter()
        let exported = vcard.serialize([ada], ids: nil)
        #expect(exported.contains("X-CONSTELLATION-FIELD"))
        // The markdown body is carried as NOTE, not duplicated as a custom field.
        #expect(!exported.contains("markdown_body"))

        let reparsed = vcard.parse(exported, startIndex: 0)[0]
        #expect(reparsed.customFields["favorite_color"] == ada.customFields["favorite_color"])
        #expect(
            reparsed.customFields["nested_profile"]?.value
                == ada.customFields["nested_profile"]?.value)
        #expect(reparsed.customFields["markdown_body"] == nil)
    }

    // JS: 'custom-field values with vCard-special characters round-trip safely'
    @Test func customFieldSpecialCharactersRoundTripSafely() {
        let contact = Contact(
            id: "c_test", uid: "esc-1", fn: "Esc Test",
            customFields: [
                "tricky": TypedField(
                    type: "string", value: .string("a; b, c \"x\"\nsecond line\\end"))
            ])

        let vcard = VCardAdapter()
        let exported = vcard.serialize([contact], ids: nil)
        let reparsed = vcard.parse(exported, startIndex: 0)[0]

        #expect(reparsed.customFields["tricky"] == contact.customFields["tricky"])
    }

    // JS: 'vCard fallback serializes non-company tags as CATEGORIES and round-trips them'
    @Test func fallbackSerializesNonCompanyTagsAsCategories() {
        let contact = Contact(
            id: "c_tags", uid: "tags-1", fn: "Tagged Person",
            tags: ["company", "vip", "lead"])  // 'company' is represented separately by X-ABSHOWAS

        let vcard = VCardAdapter()
        let exported = vcard.serialize([contact], ids: nil)
        #expect(exported.contains("CATEGORIES:vip,lead"))

        let reparsed = vcard.parse(exported, startIndex: 0)[0]
        #expect(reparsed.tags == ["vip", "lead"])
    }

    // JS (contact-shape.test.js): 'the registry covers exactly the standard
    // fields the vCard parser emits' — re-expressed as: a parsed contact's
    // Codable key set is exactly the §8.1 model shape.
    @Test func parsedContactCodableKeysMatchModelShape() throws {
        let contacts = VCFParser().parse(FixtureLoader.contents(of: "comprehensive.vcf"))
        let jane = contacts.first { $0.uid == "jane-doe-smith" }
        let data = try JSONEncoder().encode(jane)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        let expected: Set<String> = [
            "id", "uid", "fn", "name", "nickname", "maidenName", "phoneticFirst",
            "phoneticLast", "org", "department", "phoneticOrg", "title", "gender",
            "isCompany", "altBirthday", "emails", "phones", "addresses", "birthday",
            "anniversary", "dates", "ims", "socialProfiles", "notes", "related",
            "urls", "photo", "tags", "noteTags", "customFields", "rawVCard",
            "sourceDocuments", "rawByKey",
        ]
        #expect(Set((obj ?? [:]).keys) == expected)
    }
}
