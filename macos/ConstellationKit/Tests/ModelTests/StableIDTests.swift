import Testing
@testable import ConstellationModel

// Hash + id expectations captured via `node -e` against js/contact-record.js
// (`_hash` / `assignStableId`). Byte-identical parity vs Node is the acceptance bar.

struct StableIDTests {
    struct HashCase {
        let input: String
        let expected: String
    }

    @Test(arguments: [
        HashCase(input: "uid:ABC-123", expected: "gnssly"),
        HashCase(input: "fn:jane doe", expected: "10xzknd"),
        HashCase(input: "fn:", expected: "1yqqs71"),
        HashCase(input: "fn:john smith#2", expected: "1xhwe82"),
        HashCase(input: "fn:john smith~1", expected: "1vy8guu"),
        HashCase(input: "uid:x#2~1", expected: "wm833r"),
        // Non-ASCII BMP (é) and non-BMP (emoji, surrogate pair) exercise UTF-16 parity.
        HashCase(input: "fn:café", expected: "1uzyiw4"),
        HashCase(input: "fn:😀 emoji", expected: "ywr0am"),
        HashCase(input: "hello world", expected: "1n91413"),
        HashCase(input: "fn:jane doe~1", expected: "kwh5ws"),
    ])
    func hashParity(_ c: HashCase) {
        #expect(StableID.hash(c.input) == c.expected)
    }

    // A full parse scenario: three "Jane Doe" (no uid) get #2/#3 occurrence
    // suffixes; two identical-uid "John Smith" get uid then uid#2; empty-name
    // contact hashes "fn:". Sequence captured from the JS assignStableId.
    @Test func occurrenceSequenceMatchesJS() {
        var alloc = StableIDAllocator()
        #expect(alloc.assign(uid: nil, fn: "Jane Doe") == "c_10xzknd")
        #expect(alloc.assign(uid: nil, fn: "Jane Doe") == "c_1p9rt6s")
        #expect(alloc.assign(uid: "ABC-123", fn: "John Smith") == "c_gnssly")
        #expect(alloc.assign(uid: "ABC-123", fn: "John Smith") == "c_cimq7b")
        #expect(alloc.assign(uid: nil, fn: "Jane Doe") == "c_1pjrevr")
        #expect(alloc.assign(uid: nil, fn: "") == "c_1yqqs71")
    }

    @Test func uidPreferredOverName() {
        var alloc = StableIDAllocator()
        // uid basis: "uid:ABC-123" regardless of fn.
        #expect(alloc.assign(uid: "ABC-123", fn: "Anything") == "c_gnssly")
    }

    @Test func nameTrimmedAndLowercased() {
        var alloc = StableIDAllocator()
        // "  Jane Doe  " trims + lowercases to basis "fn:jane doe".
        #expect(alloc.assign(uid: nil, fn: "  Jane Doe  ") == "c_10xzknd")
    }

    @Test func emptyUidFallsBackToName() {
        var alloc = StableIDAllocator()
        // Empty-string uid is falsy in JS → name basis.
        #expect(alloc.assign(uid: "", fn: "Jane Doe") == "c_10xzknd")
    }
}
