// Port of test/tsv.test.js + the TSV half of test/format-fidelity.test.js
// (tests 177 / 214). Ground truth for anything ambiguous was generated with
// `node -e '...'` importing js/tsv-adapter.js directly (see the brief); values
// are hardcoded below with the node command noted alongside each.

import Testing

@testable import ConstellationFormats
@testable import ConstellationModel

@Suite("TSVAdapter")
struct TSVAdapterTests {

    // MARK: - tsv.test.js: "TSV import parses a row into the contact model"

    @Test func importParsesRowIntoContactModel() {
        let tsv = TSVAdapter()
        let text = ([
            TSVAdapter.columns.joined(separator: "\t"),
            [
                "jane-1", "Dr.", "Jane", "Q.", "Doe", "PhD",
                "Dr. Jane Q. Doe", "Example Labs", "Principal", "F", "FALSE",
                "[home] jane@x.com | [work] jane@y.com",
                "[cell] 555-0100",
                "123 Main St", "Springfield", "CA", "90210", "USA", "home",
                "1990-04-15", "2015-06-20",
                "[work] https://example.com/jane",
                "[spouse] John Doe | [child] Sam",
                "vip | lead",
                "Met at the conf. #vip",
            ].joined(separator: "\t"),
        ] as [String]).joined(separator: "\n")

        let c = tsv.parse(text).contacts[0]
        #expect(c.uid == "jane-1")
        #expect(c.fn == "Dr. Jane Q. Doe")
        #expect(c.name.given == "Jane")
        #expect(c.name.family == "Doe")
        #expect(c.org == "Example Labs")
        #expect(c.gender == "F")
        #expect(c.isCompany == false)
        #expect(c.emails == [
            LabeledValue(value: "jane@x.com", types: ["HOME"]),
            LabeledValue(value: "jane@y.com", types: ["WORK"]),
        ])
        #expect(c.phones.first == LabeledValue(value: "555-0100", types: ["CELL"]))
        #expect(c.addresses[0].city == "Springfield")
        #expect(c.addresses[0].types == ["HOME"])
        #expect(c.urls[0].value == "https://example.com/jane")  // ':' in value survives
        #expect(c.related[0].name == "John Doe")
        #expect(c.related[0].type == "spouse")
        #expect(c.related[1].type == "child")
        #expect(c.tags == ["vip", "lead"])
        #expect(c.noteTags == ["vip"])  // hashtag derived from notes
        #expect(c.notes[0].contains("Met at the conf"))
    }

    // MARK: - tsv.test.js: "TSV serialize → reparse round-trips the common fields"

    @Test func serializeReparseRoundTripsCommonFields() {
        let tsv = TSVAdapter()
        let original = tsv.parse(tsv.templateText()).contacts[0]  // the example row
        let reparsed = tsv.parse(tsv.serialize([original], ids: nil)).contacts[0]

        #expect(reparsed.fn == original.fn)
        #expect(reparsed.org == original.org)
        #expect(reparsed.title == original.title)
        #expect(reparsed.birthday == original.birthday)
        #expect(reparsed.anniversary == original.anniversary)
        #expect(reparsed.name == original.name)
        #expect(reparsed.emails == original.emails)
        #expect(reparsed.phones == original.phones)
        #expect(reparsed.addresses == original.addresses)
        #expect(reparsed.urls == original.urls)
        #expect(
            reparsed.related.map { ($0.name, $0.type) }.elementsEqual(
                original.related.map { ($0.name, $0.type) }, by: ==))
        #expect(reparsed.notes == original.notes)
    }

    // MARK: - tsv.test.js: "TSV template is the header row (in order) plus a worked example"
    //
    // Byte-identity proof: expectedTemplate below is the literal output of
    //   node -e 'import("./js/tsv-adapter.js").then(({TsvAdapter}) => {
    //     console.log(JSON.stringify(new TsvAdapter().templateText())) })'
    // which printed (517 UTF-8 bytes):
    // "uid\tprefix\tfirst\tmiddle\tlast\tsuffix\tdisplay_name\torganization\ttitle\t
    //  gender\tis_company\temails\tphones\tstreet\tcity\tstate\tzip\tcountry\t
    //  address_type\tbirthday\tanniversary\turls\trelationships\ttags\tnotes\n
    //  \tDr.\tJane\tQ.\tDoe\tPhD\tDr. Jane Q. Doe\tExample Labs\tPrincipal\t\tFALSE\t
    //  [home] jane@example.com | [work] jane@work.example\t
    //  [cell] 555-0100 | [home] 555-0101\t123 Main St\tSpringfield\tCA\t90210\tUSA\t
    //  home\t1990-04-15\t2015-06-20\t[work] https://example.com/jane\t
    //  [spouse] John Doe | [child] Sam Doe\tvip | lead\tMet at the conference. #vip\n"
    @Test func templateIsByteIdenticalToNode() {
        let tsv = TSVAdapter()
        let expectedTemplate =
            "uid\tprefix\tfirst\tmiddle\tlast\tsuffix\tdisplay_name\torganization\ttitle\tgender\tis_company\temails\tphones\tstreet\tcity\tstate\tzip\tcountry\taddress_type\tbirthday\tanniversary\turls\trelationships\ttags\tnotes\n\tDr.\tJane\tQ.\tDoe\tPhD\tDr. Jane Q. Doe\tExample Labs\tPrincipal\t\tFALSE\t[home] jane@example.com | [work] jane@work.example\t[cell] 555-0100 | [home] 555-0101\t123 Main St\tSpringfield\tCA\t90210\tUSA\thome\t1990-04-15\t2015-06-20\t[work] https://example.com/jane\t[spouse] John Doe | [child] Sam Doe\tvip | lead\tMet at the conference. #vip\n"

        let actual = tsv.templateText()
        #expect(actual == expectedTemplate)
        #expect(actual.utf8.count == 517)

        let lines = actual.trimmingCharacters(in: .newlines).components(separatedBy: "\n")
        #expect(lines[0] == TSVAdapter.columns.joined(separator: "\t"))
        #expect(lines[0].components(separatedBy: "\t").count == TSVAdapter.columns.count)
        #expect(lines.count == 2)  // header + one example
        #expect(lines[1].contains("[home] jane@example.com"))
    }

    // MARK: - tsv.test.js: "TSV escapes tabs/newlines in notes and round-trips them"

    @Test func escapesTabsAndNewlinesInNotes() {
        let tsv = TSVAdapter()
        var contact = Contact()
        contact.id = "c1"
        contact.fn = "Multi Line"
        contact.notes = ["line one\nline two\twith tab"]
        let serialized = tsv.serialize([contact], ids: nil)
        let reparsed = tsv.parse(serialized).contacts[0]

        #expect(serialized.components(separatedBy: "\n").count == 3)  // header + 1 row + trailing
        #expect(reparsed.notes[0] == "line one\nline two\twith tab")
    }

    // MARK: - tsv.test.js: "TSV import isolates a malformed row"
    //
    // DEVIATION: the JS test verifies row-level isolation by monkey-patching
    // `_contactFromRow` to throw on the first call and asserting the row is
    // skipped with a console.warn — a pure test-harness fault injection.
    // Inspection of `_contactFromRow` shows nothing in it can actually throw
    // for any real row (every field access is `|| ''`-guarded / regex-safe),
    // so the JS `try/catch` is unreachable in practice, and there is no
    // equivalent seam to inject a fault into a Swift static function from a
    // test. The Swift port preserves the *intent* instead: parsing is lenient
    // for genuinely malformed rows (fewer cells than headers, a row with no
    // tabs at all) and does not abort the rest of the file.
    @Test func toleratesRowsWithFewerCellsThanHeaders() {
        let tsv = TSVAdapter()
        let text = "\(TSVAdapter.columns.joined(separator: "\t"))\nbad\nuid2\tMr.\tBob"
        let contacts = tsv.parse(text).contacts
        #expect(contacts.count == 2)
        #expect(contacts[0].uid == "bad")
        #expect(contacts[1].uid == "uid2")
        #expect(contacts[1].name.prefix == "Mr.")
        #expect(contacts[1].name.given == "Bob")
    }

    // MARK: - format-fidelity.test.js:177 "TSV preserves multiple notes through a round-trip"

    @Test func preservesMultipleNotesThroughRoundTrip() {
        let tsv = TSVAdapter()
        var contact = Contact()
        contact.id = "c1"
        contact.fn = "Multi Note"
        contact.notes = ["First note", "Second note", "Third"]
        let out = tsv.serialize([contact], ids: nil)
        let re = tsv.parse(out).contacts[0]
        #expect(re.notes == ["First note", "Second note", "Third"])
    }

    // MARK: - format-fidelity.test.js:214 "TSV still keeps a single note with internal newlines intact"

    @Test func keepsSingleNoteWithInternalNewlinesIntact() {
        let tsv = TSVAdapter()
        var contact = Contact()
        contact.id = "c1"
        contact.fn = "One Note"
        contact.notes = ["line one\nline two"]
        let re = tsv.parse(tsv.serialize([contact], ids: nil)).contacts[0]
        #expect(re.notes == ["line one\nline two"])
    }

    // MARK: - Escape/unescape ground truth (node -e against js/tsv-adapter.js `_escape`/`_unescape`)

    @Test func escapeUnescapeMatchesNodeGroundTruth() {
        // node: tsv._escape("abc\\") === "abc\\\\"  (trailing backslash doubles)
        #expect(TSVAdapter.escape("abc\\") == "abc\\\\")
        // node: tsv._unescape("abc\\") === "abc\\"  (trailing lone backslash is untouched)
        #expect(TSVAdapter.unescape("abc\\") == "abc\\")
        // node: tsv._unescape("a\\xb") === "axb"  (backslash + non-t/n char drops the backslash)
        #expect(TSVAdapter.unescape("a\\xb") == "axb")
        // node: tsv._escape("a\\tb\nc\r\nd") === "a\\\\tb\\nc\\nd"
        #expect(TSVAdapter.escape("a\\tb\nc\r\nd") == "a\\\\tb\\nc\\nd")
        // node: tsv._escape("a\rb") === "a\rb"  (a lone \r, no following \n, is NOT escaped)
        #expect(TSVAdapter.escape("a\rb") == "a\rb")
    }

    // MARK: - Relationship taxonomy integration (RelationshipTaxonomy.normalize / vcardLabel)

    @Test func relationshipsNormalizeAndCarryVCardLabel() {
        // node: tsv.parse(tsv.templateText())[0].related ===
        //   [{name:"John Doe",type:"spouse",rawType:"_$!<Spouse>!$_"},
        //    {name:"Sam Doe",type:"child",rawType:"_$!<Child>!$_"}]
        let tsv = TSVAdapter()
        let c = tsv.parse(tsv.templateText()).contacts[0]
        #expect(c.related == [
            RelatedValue(name: "John Doe", type: "spouse", rawType: "_$!<Spouse>!$_"),
            RelatedValue(name: "Sam Doe", type: "child", rawType: "_$!<Child>!$_"),
        ])
    }
}
