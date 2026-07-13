import Testing

@testable import ConstellationModel

// Expectations mirror `js/vcf-parser.js`'s `_extractHashtags` output, captured
// via `node --input-type=module -e` against the reference implementation:
//
//   import { VCFParser } from './js/vcf-parser.js';
//   const parser = new VCFParser();
//   parser._extractHashtags([...])
//
// e.g.:
//   ["#Foo"]                                          => ["foo"]
//   ["multi #Foo #bar #foo"]                          => ["bar","foo"]
//   ["(#paren) [#bracket] {#brace} ,#comma ;#semi"]   => ["brace","bracket","comma","paren","semi"]
//   ["email#nothashtag"]                              => []
//   ["#a-b_c123"]                                     => ["a-b_c123"]
//   ["#foo#bar"]                                      => ["foo"]        (2nd '#' isn't preceded by a separator)
//   ["#a#b#c"]                                        => ["a"]
//   ["#_underscore"], ["#-dash"], ["#"], ["# space"]  => []              (body must start [A-Za-z0-9])
struct NoteHashtagsTests {
    struct Case {
        let notes: [String]
        let expected: [String]
    }

    @Test(arguments: [
        Case(notes: ["#Foo"], expected: ["foo"]),
        Case(notes: ["no hashtag here"], expected: []),
        Case(notes: ["hello #foo world"], expected: ["foo"]),
        Case(notes: ["multi #Foo #bar #foo"], expected: ["bar", "foo"]),
        Case(
            notes: ["(#paren) [#bracket] {#brace} ,#comma ;#semi"],
            expected: ["brace", "bracket", "comma", "paren", "semi"]
        ),
        Case(notes: ["email#nothashtag"], expected: []),
        Case(notes: ["#a-b_c123"], expected: ["a-b_c123"]),
        Case(notes: ["#"], expected: []),
        Case(notes: ["# space"], expected: []),
        Case(notes: ["#foo#bar"], expected: ["foo"]),
        Case(notes: ["line1\n#foo"], expected: ["foo"]),
        Case(notes: ["  #leadingspaces"], expected: ["leadingspaces"]),
        Case(notes: ["#UPPER #Mixed #lower"], expected: ["lower", "mixed", "upper"]),
        Case(notes: ["#foo, #foo, #FOO"], expected: ["foo"]),
        Case(notes: [], expected: []),
        Case(notes: ["#valid"], expected: ["valid"]),
        Case(
            notes: ["note one #alpha", "note two #beta", "note three #alpha"],
            expected: ["alpha", "beta"]
        ),
        Case(notes: ["#a#b#c"], expected: ["a"]),
        Case(notes: ["text (#x)(#y)"], expected: ["x", "y"]),
        Case(notes: ["#123start"], expected: ["123start"]),
        Case(notes: ["#_underscore"], expected: []),
        Case(notes: ["#-dash"], expected: []),
    ])
    func extractMatchesJS(_ c: Case) {
        #expect(NoteHashtags.extract(from: c.notes) == c.expected)
    }
}
