import Testing
@testable import ConstellationModel

// Expectations mirror `js/contact-types.js` output, captured via `node -e` against
// the reference implementation (typesToLabel / labelToTypes).

struct TypeTaxonomyTests {
    // MARK: typesToLabel

    struct T2L {
        let kind: ContactMethodKind
        let types: [String]
        let customLabel: String
        let expected: String
    }

    @Test(arguments: [
        // Every phone taxonomy entry.
        T2L(kind: .phone, types: ["CELL"], customLabel: "", expected: "Mobile"),
        T2L(kind: .phone, types: ["IPHONE"], customLabel: "", expected: "iPhone"),
        T2L(kind: .phone, types: ["APPLEWATCH"], customLabel: "", expected: "Apple Watch"),
        T2L(kind: .phone, types: ["HOME"], customLabel: "", expected: "Home"),
        T2L(kind: .phone, types: ["WORK"], customLabel: "", expected: "Work"),
        T2L(kind: .phone, types: ["MAIN"], customLabel: "", expected: "Main"),
        T2L(kind: .phone, types: ["FAX"], customLabel: "", expected: "Fax"),
        T2L(kind: .phone, types: ["PAGER"], customLabel: "", expected: "Pager"),
        T2L(kind: .phone, types: ["OTHER"], customLabel: "", expected: "Other"),
        // FAX combos.
        T2L(kind: .phone, types: ["HOME", "FAX"], customLabel: "", expected: "Home Fax"),
        T2L(kind: .phone, types: ["WORK", "FAX"], customLabel: "", expected: "Work Fax"),
        T2L(kind: .phone, types: ["OTHER", "FAX"], customLabel: "", expected: "Other Fax"),
        // Preferred appending.
        T2L(kind: .phone, types: ["FAX", "PREF"], customLabel: "", expected: "Fax, Preferred"),
        T2L(kind: .phone, types: ["HOME", "FAX", "PREF"], customLabel: "", expected: "Home Fax, Preferred"),
        T2L(kind: .phone, types: ["CELL", "PREF"], customLabel: "", expected: "Mobile, Preferred"),
        T2L(kind: .phone, types: ["PREF"], customLabel: "", expected: "Preferred"),
        T2L(kind: .phone, types: [], customLabel: "", expected: ""),
        // Case-insensitivity + hidden types + multi.
        T2L(kind: .phone, types: ["cell"], customLabel: "", expected: "Mobile"),
        T2L(kind: .phone, types: ["HOME", "WORK"], customLabel: "", expected: "Home, Work"),
        T2L(kind: .phone, types: ["HOME"], customLabel: "My Custom", expected: "My Custom"),
        T2L(kind: .phone, types: ["VOICE", "CELL"], customLabel: "", expected: "Mobile"),
        // Email / url / address tables.
        T2L(kind: .email, types: ["HOME"], customLabel: "", expected: "Home"),
        T2L(kind: .email, types: ["WORK"], customLabel: "", expected: "Work"),
        T2L(kind: .email, types: ["SCHOOL"], customLabel: "", expected: "School"),
        T2L(kind: .email, types: ["ICLOUD"], customLabel: "", expected: "iCloud"),
        T2L(kind: .email, types: ["OTHER"], customLabel: "", expected: "Other"),
        T2L(kind: .email, types: ["INTERNET", "HOME"], customLabel: "", expected: "Home"),
        // FAX combo only collapses for phone: email keeps FAX as a titlecased word.
        T2L(kind: .email, types: ["FAX"], customLabel: "", expected: "Fax"),
        T2L(kind: .email, types: ["HOME", "PREF"], customLabel: "", expected: "Home, Preferred"),
        T2L(kind: .url, types: ["HOME"], customLabel: "", expected: "Home"),
        T2L(kind: .url, types: ["WORK"], customLabel: "", expected: "Work"),
        T2L(kind: .url, types: ["OTHER"], customLabel: "", expected: "Other"),
        T2L(kind: .address, types: ["HOME"], customLabel: "", expected: "Home"),
        T2L(kind: .address, types: ["WORK"], customLabel: "", expected: "Work"),
        T2L(kind: .address, types: ["OTHER"], customLabel: "", expected: "Other"),
        // address has no FAX collapse → "Home, Fax".
        T2L(kind: .address, types: ["HOME", "FAX"], customLabel: "", expected: "Home, Fax"),
        // Unknown token → titlecase of first char + lowercased rest.
        T2L(kind: .phone, types: ["FOO"], customLabel: "", expected: "Foo"),
        T2L(kind: .email, types: ["XyZ"], customLabel: "", expected: "Xyz"),
    ])
    func typesToLabelMatchesJS(_ c: T2L) {
        #expect(TypeTaxonomy.typesToLabel(c.kind, types: c.types, customLabel: c.customLabel) == c.expected)
    }

    // MARK: labelToTypes

    struct L2T {
        let kind: ContactMethodKind
        let input: String
        let types: [String]
        let label: String
    }

    @Test(arguments: [
        L2T(kind: .phone, input: "Mobile", types: ["CELL"], label: ""),
        L2T(kind: .phone, input: "Home Fax", types: ["HOME", "FAX"], label: ""),
        L2T(kind: .phone, input: "Work Fax", types: ["WORK", "FAX"], label: ""),
        L2T(kind: .phone, input: "Other Fax", types: ["OTHER", "FAX"], label: ""),
        L2T(kind: .phone, input: "Fax", types: ["FAX"], label: ""),
        L2T(kind: .phone, input: "Home, Preferred", types: ["HOME", "PREF"], label: ""),
        L2T(kind: .phone, input: "Preferred", types: ["PREF"], label: ""),
        L2T(kind: .phone, input: "Mobile, Work", types: ["CELL", "WORK"], label: ""),
        L2T(kind: .phone, input: "cell", types: ["CELL"], label: ""),
        L2T(kind: .phone, input: "PREF", types: ["PREF"], label: ""),
        L2T(kind: .phone, input: "", types: [], label: ""),
        L2T(kind: .phone, input: "  ", types: [], label: ""),
        // Any unrecognized token → whole string becomes a custom label.
        L2T(kind: .phone, input: "My Custom Label", types: [], label: "My Custom Label"),
        L2T(kind: .phone, input: "Home, Bogus", types: [], label: "Home, Bogus"),
        L2T(kind: .phone, input: "iPhone", types: ["IPHONE"], label: ""),
        L2T(kind: .phone, input: "Apple Watch", types: ["APPLEWATCH"], label: ""),
        L2T(kind: .email, input: "School", types: ["SCHOOL"], label: ""),
        L2T(kind: .email, input: "iCloud", types: ["ICLOUD"], label: ""),
        L2T(kind: .email, input: "home, work", types: ["HOME", "WORK"], label: ""),
        // Ordered de-dup.
        L2T(kind: .email, input: "Home, Home", types: ["HOME"], label: ""),
        L2T(kind: .url, input: "Other", types: ["OTHER"], label: ""),
        L2T(kind: .address, input: "Work", types: ["WORK"], label: ""),
        L2T(kind: .phone, input: "Home, Home Fax", types: ["HOME", "FAX"], label: ""),
        L2T(kind: .phone, input: "Mobile, Mobile", types: ["CELL"], label: ""),
    ])
    func labelToTypesMatchesJS(_ c: L2T) {
        let result = TypeTaxonomy.labelToTypes(c.kind, c.input)
        #expect(result.types == c.types)
        #expect(result.label == c.label)
    }

    // MARK: taxonomy structure + hidden types

    @Test func hiddenTypes() {
        #expect(TypeTaxonomy.hiddenTypes == ["PREF", "VOICE", "INTERNET"])
    }

    @Test func phoneTableOrder() {
        #expect(TypeTaxonomy.typeTaxonomy(.phone).map(\.value)
            == ["CELL", "IPHONE", "APPLEWATCH", "HOME", "WORK", "MAIN", "FAX", "PAGER", "OTHER"])
    }
}
