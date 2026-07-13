import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

/// Proves the Swift Markdown serializer is byte-identical to the Node reference
/// implementation for the three shared fixtures, both round-tripped individually
/// and combined. The golden strings were produced by running the real
/// `js/markdown-adapter.js` (`serialize(parse(fixture))`) and are stored under
/// `Tests/Goldens/markdown/`.
@Suite struct MarkdownByteIdentityTests {
    private let adapter = MarkdownAdapter()

    private func roundTrip(_ fixture: String) -> String {
        adapter.serialize(adapter.parse(FixtureLoader.contents(of: fixture)).contacts)
    }

    @Test func adaFixtureIsByteIdentical() {
        #expect(roundTrip("markdown-ada.md") == MDGolden.load("expected-ada.md"))
    }

    @Test func graceFixtureIsByteIdentical() {
        #expect(roundTrip("markdown-grace.md") == MDGolden.load("expected-grace.md"))
    }

    @Test func bundleFixtureIsByteIdentical() {
        #expect(roundTrip("markdown-bundle.md") == MDGolden.load("expected-bundle.md"))
    }

    @Test func combinedBundleIsByteIdentical() {
        var contacts: [Contact] = []
        for fixture in ["markdown-ada.md", "markdown-grace.md", "markdown-bundle.md"] {
            contacts += adapter.parse(FixtureLoader.contents(of: fixture)).contacts
        }
        #expect(adapter.serialize(contacts) == MDGolden.load("expected-all.md"))
    }

    /// The contact ids are byte-identical to Node's StableID output.
    @Test func stableIdsMatchNode() {
        var contacts: [Contact] = []
        for fixture in ["markdown-ada.md", "markdown-grace.md", "markdown-bundle.md"] {
            contacts += adapter.parse(FixtureLoader.contents(of: fixture)).contacts
        }
        #expect(contacts.map(\.id) == ["c_1x3hd4j", "c_ci7682", "c_7uu6n4", "c_1r73ng5"])
    }
}
