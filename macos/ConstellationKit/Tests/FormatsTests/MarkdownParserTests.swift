import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

/// Ports of the Node `parser-roundtrip.test.js` Markdown cases (tests 100, 153,
/// 178, 203).
@Suite struct MarkdownParserTests {
    private let adapter = MarkdownAdapter()

    // parser-roundtrip: "Markdown adapter preserves standard fields, custom
    // fields, and notes"
    @Test func preservesStandardFieldsCustomFieldsAndNotes() {
        let markdown = [
            "## Jane Markdown",
            "",
            "- **UID:** jane-md",
            "- **First Name:** Jane",
            "- **Last Name:** Markdown",
            "- **Organization:** Example Labs",
            "",
            "### Email",
            "- **Home:** jane@example.com",
            "",
            "### Relationships",
            "- **Spouse:** John Markdown",
            "",
            "### Notes",
            "Markdown body #neighbor",
            "",
            "### Other Fields",
            "- **favorite_color:** #3366cc",
            "- **emergency_priority:** 2",
            "- **custom_history:**",
            "  - met at conference",
            "  - invited to dinner",
            "",
        ].joined(separator: "\n")

        let contacts = adapter.parse(markdown).contacts
        let jane = contacts[0]

        #expect(adapter.canImportFile(named: "contact.md") == true)
        #expect(adapter.canImportFile(named: "contact.vcf") == false)
        #expect(jane.uid == "jane-md")
        #expect(jane.name.family == "Markdown")
        #expect(jane.emails[0].types == ["HOME"])
        #expect(jane.related[0].type == "spouse")

        #expect(jane.customFields["favorite_color"]?.type == "string")
        #expect(MDJSON.str(jane.customFields["favorite_color"]?.value) == "#3366cc")
        #expect(jane.customFields["emergency_priority"]?.type == "number")
        #expect(MDJSON.num(jane.customFields["emergency_priority"]?.value) == 2)
        #expect(jane.customFields["custom_history"]?.type == "list")
        #expect(
            MDJSON.arr(jane.customFields["custom_history"]?.value)?.compactMap(MDJSON.str)
                == ["met at conference", "invited to dinner"])

        #expect(jane.notes == ["Markdown body #neighbor"])
        #expect(jane.noteTags == ["neighbor"])

        let reparsed = adapter.parse(adapter.serialize(contacts)).contacts[0]
        #expect(reparsed.uid == "jane-md")
        #expect(MDJSON.str(reparsed.customFields["favorite_color"]?.value) == "#3366cc")
        #expect(MDJSON.num(reparsed.customFields["emergency_priority"]?.value) == 2)
        #expect(reparsed.notes == ["Markdown body #neighbor"])
    }

    // parser-roundtrip: "Markdown adapter supports bundle files with multiple
    // contacts"
    @Test func supportsBundleFilesWithMultipleContacts() {
        let text = [
            "## Contact One", "", "- **UID:** one", "", "### Notes", "One body", "",
            "## Contact Two", "", "- **UID:** two", "", "### Notes", "Two body", "",
        ].joined(separator: "\n")
        let contacts = adapter.parse(text).contacts
        #expect(contacts.map(\.uid) == ["one", "two"])

        let bundle = adapter.serialize(contacts)
        #expect(MarkdownParserTests.hasLine(bundle, prefix: "## Contact One"))
        #expect(MarkdownParserTests.hasLine(bundle, prefix: "## Contact Two"))
        #expect(adapter.parse(bundle).contacts.count == 2)
    }

    // parser-roundtrip: "Markdown sample files import as separate and bundled
    // contacts"
    @Test func sampleFilesImportAsSeparateAndBundledContacts() {
        var contacts: [Contact] = []
        contacts += adapter.parse(FixtureLoader.contents(of: "markdown-ada.md")).contacts
        contacts += adapter.parse(FixtureLoader.contents(of: "markdown-grace.md")).contacts
        contacts += adapter.parse(FixtureLoader.contents(of: "markdown-bundle.md")).contacts

        #expect(
            contacts.map(\.uid) == [
                "md-ada-lovelace", "md-grace-hopper", "md-katherine-johnson", "md-dorothy-vaughan",
            ])
        #expect(MDJSON.str(contacts[0].customFields["favorite_color"]?.value) == "#6a5acd")
        #expect(
            MDJSON.str(MDJSON.path(contacts[0].customFields["nested_profile"]?.value, "empty_string"))
                == "")
        #expect(
            MDJSON.isNull(MDJSON.path(contacts[0].customFields["nested_profile"]?.value, "optional_note")))
        #expect(
            MDJSON.str(contacts[1].customFields["custom_clearance_level"]?.value) == "historical")
        #expect(
            MDJSON.bool(
                MDJSON.path(
                    contacts[1].customFields["nested_service_record"]?.value,
                    "awards", "compiler", "verified")) == true)
        #expect(MDJSON.num(contacts[2].customFields["mission_count"]?.value) == 3)
        #expect(
            MDJSON.str(contacts[3].customFields["programming_language"]?.value) == "FORTRAN")
        let teams = MDJSON.arr(
            MDJSON.path(contacts[3].customFields["nested_leadership_record"]?.value, "teams"))
        #expect(MDJSON.str(MDJSON.get(teams?[0], "role")) == "supervisor")
    }

    // parser-roundtrip: "Markdown import, export, and reimport preserves custom
    // fields, nested objects, and notes"
    @Test func exportAndReimportPreservesNestedObjectsAndNotes() {
        var contacts: [Contact] = []
        contacts += adapter.parse(FixtureLoader.contents(of: "markdown-ada.md")).contacts
        contacts += adapter.parse(FixtureLoader.contents(of: "markdown-grace.md")).contacts
        contacts += adapter.parse(FixtureLoader.contents(of: "markdown-bundle.md")).contacts

        let exported = adapter.serialize(contacts)
        let reparsed = adapter.parse(exported).contacts
        #expect(reparsed.count == 4)

        let ada = reparsed.byUid("md-ada-lovelace")!
        let grace = reparsed.byUid("md-grace-hopper")!
        let dorothy = reparsed.byUid("md-dorothy-vaughan")!

        let profile = ada.customFields["nested_profile"]?.value
        #expect(MDJSON.str(MDJSON.get(profile, "source")) == "markdown-fixture")
        #expect(MDJSON.num(MDJSON.get(profile, "confidence")) == 0.92)
        #expect(MDJSON.str(MDJSON.get(profile, "empty_string")) == "")
        #expect(MDJSON.isNull(MDJSON.get(profile, "optional_note")))
        #expect(
            MDJSON.arr(MDJSON.get(profile, "aliases"))?.compactMap(MDJSON.str)
                == ["Augusta Ada King", "Countess of Lovelace"])
        #expect(MDJSON.str(MDJSON.path(profile, "review", "reviewer")) == "test-suite")
        #expect(MDJSON.bool(MDJSON.path(profile, "review", "approved")) == true)

        #expect(
            MDJSON.num(
                MDJSON.path(
                    grace.customFields["nested_service_record"]?.value,
                    "awards", "compiler", "year")) == 1952)
        let teams = MDJSON.arr(
            MDJSON.path(dorothy.customFields["nested_leadership_record"]?.value, "teams"))
        #expect(MDJSON.str(MDJSON.get(teams?[1], "name")) == "Analysis and Computation Division")

        #expect(ada.notes.joined(separator: "\n").contains("Wrote notes intended to survive Markdown export and reimport"))
        #expect(grace.notes.joined(separator: "\n").contains("not just as plain notes"))
    }

    private static func hasLine(_ text: String, prefix: String) -> Bool {
        text.split(separator: "\n", omittingEmptySubsequences: false).contains { $0.hasPrefix(prefix) }
    }
}
