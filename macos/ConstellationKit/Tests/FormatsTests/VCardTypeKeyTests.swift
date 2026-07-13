import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

// Port of test/type-roundtrip.test.js. The JS test drives the editor's DOM
// collection (`app._collectTypesFromItem`) and asserts the collected entry
// reproduces its parse-time content key; the DOM half belongs to the M5 editing
// milestone. What must hold at the format layer — and is asserted here — is the
// key invariant itself: `contactMethodKey` is order-independent over types,
// case-normalizing, and label-sensitive, so an untouched instance keeps its raw
// bytes and an edited one regenerates.

@Suite struct VCardTypeKeyTests {
    // JS: 'collecting an untouched type set reproduces its content key (all
    // Apple phone perms)' — the type-permutation invariant.
    @Test func untouchedTypeSetsReproduceTheirContentKey() {
        let cases: [[String]] = [
            ["IPHONE", "CELL", "VOICE", "PREF"],  // iPhone bundle
            ["CELL", "VOICE"],
            ["APPLEWATCH", "CELL", "VOICE"],
            ["HOME", "VOICE"],
            ["MAIN"],
            ["HOME", "FAX"],
            ["WORK", "FAX"],
            ["OTHER", "FAX"],
            ["PAGER"],
        ]

        for types in cases {
            let key = VCardUtils.keyForEmailPhoneURL(
                kind: "phone", value: "12345678901", types: types, label: "")
            // Order-independent: any permutation (as an editor rebuild would
            // produce) yields the same key.
            let reversed = VCardUtils.keyForEmailPhoneURL(
                kind: "phone", value: "12345678901", types: types.reversed(), label: "")
            #expect(key == reversed, "phone types \(types.joined(separator: "+")) should be order-independent")
            // Case-normalizing: lowercase input produces the same key.
            let lowered = VCardUtils.keyForEmailPhoneURL(
                kind: "phone", value: "12345678901",
                types: types.map { $0.lowercased() }, label: "")
            #expect(key == lowered)
        }
    }

    // JS: 'custom-labeled phone (no standard types) round-trips its key'
    @Test func customLabeledPhoneRoundTripsItsKey() {
        let key = VCardUtils.keyForEmailPhoneURL(
            kind: "phone", value: "12345678901", types: [], label: "a_custom_value")
        let rebuilt = VCardUtils.keyForEmailPhoneURL(
            kind: "phone", value: "12345678901", types: [], label: "a_custom_value")
        #expect(key == rebuilt)

        // A changed label must change the key (the instance regenerates).
        let relabeled = VCardUtils.keyForEmailPhoneURL(
            kind: "phone", value: "12345678901", types: [], label: "other")
        #expect(key != relabeled)
    }

    // Parse-to-serialize integration of the invariant: types listed in a
    // different order than the raw card still re-emit the original bytes.
    @Test func reorderedTypesKeepOriginalRawBytes() {
        let vcard = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "UID:key-test",
            "N:Test;Key;;;",
            "FN:Key Test",
            "TEL;type=IPHONE;type=CELL;type=VOICE;type=pref:12345678901",
            "END:VCARD",
        ].joined(separator: "\r\n")

        var contact = VCFParser().parse(vcard)[0]
        // Simulate an editor that rebuilds the types array in another order.
        contact.phones[0].types = ["PREF", "VOICE", "CELL", "IPHONE"]
        contact.rawVCard = VCardSerializer.rewriteVCard(contact)
        #expect(
            (contact.rawVCard ?? "").contains(
                "TEL;type=IPHONE;type=CELL;type=VOICE;type=pref:12345678901"),
            "order-only change keeps the original raw line")
    }
}
