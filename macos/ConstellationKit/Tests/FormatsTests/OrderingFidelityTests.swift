import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

/// Locks in insertion-order fidelity for custom fields (and nested-object JSON
/// payloads) against the Node reference implementation, so a future refactor
/// that silently reintroduces sorted-key output fails loudly.
///
/// The fixture `fixtures/custom-fields-ordering.md` deliberately lists custom
/// fields — and the keys of a nested `json` object — in an order that differs
/// from sorted order. The golden files were produced by running the real JS
/// adapters over that fixture:
///   - Markdown: `new MarkdownAdapter().serialize(parse(fixture))`
///   - vCard:    `new VCardAdapter().serialize(parse(fixture))`  (no raw card,
///               so each contact regenerates through X-CONSTELLATION-FIELD)
/// and are stored under `Tests/Goldens/{markdown,vcard}/`.
@Suite struct OrderingFidelityTests {
    private let markdown = MarkdownAdapter()
    private let vcard = VCardAdapter()

    /// Load a Node-generated golden stored outside any SwiftPM target.
    private func golden(_ subdir: String, _ name: String, file: String = #filePath) -> String {
        let testsDir = URL(fileURLWithPath: file)
            .deletingLastPathComponent()  // FormatsTests
            .deletingLastPathComponent()  // Tests
        let url = testsDir.appendingPathComponent("Goldens/\(subdir)/\(name)")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            fatalError("OrderingFidelityTests: cannot read \(url.path)")
        }
        return text
    }

    private func parseFixture() -> [Contact] {
        markdown.parse(FixtureLoader.contents(of: "custom-fields-ordering.md")).contacts
    }

    /// The parser must record custom fields in encounter (non-sorted) order.
    @Test func customFieldOrderIsEncounterOrderNotSorted() {
        let contact = parseFixture()[0]
        #expect(
            contact.customFields.keys == [
                "zebra_priority", "alpha_metrics", "mission_log", "beta_rank", "omega_notes",
            ])
        // Nested object keys are likewise preserved in source order.
        guard case .object(let metrics)? = contact.customFields["alpha_metrics"]?.value else {
            Issue.record("alpha_metrics is not an object")
            return
        }
        #expect(metrics.keys == ["throughput", "accuracy", "backlog", "regions"])
        guard case .object(let backlog)? = metrics["backlog"] else {
            Issue.record("backlog is not an object")
            return
        }
        #expect(backlog.keys == ["urgent", "normal"])
    }

    /// (a) Markdown parse→serialize is byte-identical to the Node golden.
    @Test func markdownRoundTripIsByteIdenticalWithNode() {
        let out = markdown.serialize(parseFixture())
        #expect(out == golden("markdown", "expected-custom-fields-ordering.md"))
    }

    /// (b) vCard generation from the markdown-origin contact (no raw card) is
    /// byte-identical to the Node golden — proves X-CONSTELLATION-FIELD payloads
    /// (and their nested-object values) serialize in insertion order.
    @Test func vcardGenerationIsByteIdenticalWithNode() {
        var contacts = parseFixture()
        for i in contacts.indices { contacts[i].rawVCard = nil }
        let out = vcard.serialize(contacts, ids: nil)
        #expect(out == golden("vcard", "expected-custom-fields-ordering.vcf"))
    }
}
