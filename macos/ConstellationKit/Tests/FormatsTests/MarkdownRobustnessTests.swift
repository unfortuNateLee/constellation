import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationFormats

/// Port of the Node `robustness.test.js` Markdown case (test 85): a malformed
/// contact block is skipped without aborting the rest of the bundle.
///
/// The JS test monkeypatches `_parseContactBlock` to throw on the first block
/// and asserts a `console.warn` is emitted. The Swift adapter's `parse` is
/// lenient and non-throwing (per `ContactFormatAdapter`) and surfaces no console
/// warnings, so this port drives the same skip via the `failingBlockIndices`
/// test seam and verifies the surviving document still imports. (Deviation: the
/// warning-count assertion is not portable; the observable resilience — the
/// surviving contact — is asserted instead.)
@Suite struct MarkdownRobustnessTests {
    @Test func malformedDocumentIsSkippedWithoutAbortingBundle() {
        let text =
            "## Contact One\n\n- **UID:** one\n\n### Notes\nOne body\n\n"
            + "## Contact Two\n\n- **UID:** two\n\n### Notes\nTwo body\n"

        // Simulate the first block's parse failing.
        let adapter = MarkdownAdapter(failingBlockIndices: [0])
        let contacts = adapter.parse(text).contacts
        #expect(contacts.map(\.uid) == ["two"])

        // Sanity: with no injected failure both contacts import.
        let normal = MarkdownAdapter().parse(text).contacts
        #expect(normal.map(\.uid) == ["one", "two"])
    }
}
