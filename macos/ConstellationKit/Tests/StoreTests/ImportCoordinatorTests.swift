// ImportCoordinator fidelity: partitioning, running startIndex, sibling photos,
// merge-vs-replace, format collapse, and abort conditions (js/app.js _loadFiles).

import ConstellationFormats
import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationStore

private func tempDir() -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("import-tests-" + UUID().uuidString)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

@discardableResult
private func write(_ text: String, named name: String, in dir: URL) -> URL {
    let url = dir.appendingPathComponent(name)
    try? text.write(to: url, atomically: true, encoding: .utf8)
    return url
}

@discardableResult
private func writeBytes(_ bytes: [UInt8], named name: String, in dir: URL) -> URL {
    let url = dir.appendingPathComponent(name)
    try? Data(bytes).write(to: url)
    return url
}

private let photoMarkdown = """
## Jane Photo

- **First Name:** Jane
- **Last Name:** Photo
- **Photo:** jane.jpg
"""

// ── Single vCard import ───────────────────────────────────────────────────────
@Test @MainActor func importSingleVCard() async {
    let store = AppStore()
    let url = FixtureLoader.url("comprehensive.vcf")
    let report = await ImportCoordinator().importFiles([url], into: store)

    #expect(report.error == nil)
    #expect(report.imported == 7)
    #expect(report.activeFormatID == "vcard")
    #expect(report.fileLabel == "comprehensive.vcf")
    #expect(store.contacts.count == 7)
    #expect(store.fileLabel == "comprehensive.vcf")
}

// ── Multi-file mixing formats → running startIndex + format collapse ──────────
@Test @MainActor func importMixedFilesThreadsStartIndexAndCollapsesFormat() async {
    let store = AppStore()
    let urls = [FixtureLoader.url("comprehensive.vcf"), FixtureLoader.url("markdown-ada.md")]
    let report = await ImportCoordinator().importFiles(urls, into: store)

    #expect(report.error == nil)
    #expect(report.imported == 8)  // 7 vcf + 1 md
    // Mixed drop collapses to vcard (JS: markdown only when pure-markdown).
    #expect(report.activeFormatID == "vcard")
    #expect(report.fileLabel == "2 files")

    // sourceDocuments.index numbers contiguously across the whole drop.
    let indices = store.contacts.map { $0.sourceDocuments.first?.index }
    #expect(indices == Array(0..<8).map { Optional($0) })
}

// ── Pure-markdown import keeps the markdown format ────────────────────────────
@Test @MainActor func importPureMarkdownKeepsFormat() async {
    let store = AppStore()
    let report = await ImportCoordinator().importFiles([FixtureLoader.url("markdown-ada.md")], into: store)
    #expect(report.error == nil)
    #expect(report.activeFormatID == "markdown")
    #expect(store.contacts.count == 1)
}

// ── Sibling photo resolves against the drop's image files ─────────────────────
@Test @MainActor func importResolvesSiblingPhoto() async {
    let dir = tempDir()
    let md = write(photoMarkdown, named: "jane.md", in: dir)
    // Minimal JPEG magic bytes — content is irrelevant, only the data URL matters.
    let jpg = writeBytes([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10], named: "jane.jpg", in: dir)

    let store = AppStore()
    let report = await ImportCoordinator().importFiles([md, jpg], into: store)

    #expect(report.error == nil)
    #expect(report.imported == 1)
    #expect(report.missingPhotoRefs == 0)
    let photo = store.contacts.first?.photo
    #expect(photo?.hasPrefix("data:image/jpeg;base64,") == true)
}

// ── Missing sibling photo is reported, contact photo stays nil ────────────────
@Test @MainActor func importReportsMissingPhoto() async {
    let dir = tempDir()
    let md = write(photoMarkdown, named: "jane.md", in: dir)  // no jane.jpg alongside

    let store = AppStore()
    let report = await ImportCoordinator().importFiles([md], into: store)

    #expect(report.error == nil)
    #expect(report.missingPhotoRefs == 1)
    #expect(store.contacts.first?.photo == nil)
}

// ── Image-name matching is case-insensitive (JS lowercases the key) ───────────
@Test @MainActor func importPhotoMatchIsCaseInsensitive() async {
    let dir = tempDir()
    let md = write(photoMarkdown, named: "jane.md", in: dir)
    let jpg = writeBytes([0xFF, 0xD8, 0xFF, 0xE0], named: "JANE.JPG", in: dir)

    let store = AppStore()
    let report = await ImportCoordinator().importFiles([md, jpg], into: store)
    #expect(report.missingPhotoRefs == 0)
    #expect(store.contacts.first?.photo?.hasPrefix("data:image/jpeg;base64,") == true)
}

// ── Second import replaces the first (never appends) ──────────────────────────
@Test @MainActor func secondImportReplaces() async {
    let store = AppStore()
    let coordinator = ImportCoordinator()
    _ = await coordinator.importFiles([FixtureLoader.url("comprehensive.vcf")], into: store)
    #expect(store.contacts.count == 7)

    _ = await coordinator.importFiles([FixtureLoader.url("markdown-ada.md")], into: store)
    #expect(store.contacts.count == 1)  // replaced, not 8
    #expect(store.activeFormatID == "markdown")
}

// ── Abort: an unsupported file leaves the store untouched ─────────────────────
@Test @MainActor func unsupportedFileAbortsWithoutMutating() async {
    let dir = tempDir()
    let store = AppStore()
    _ = await ImportCoordinator().importFiles([FixtureLoader.url("comprehensive.vcf")], into: store)
    let before = store.contacts.count

    let txt = write("just some text", named: "notes.txt", in: dir)
    let report = await ImportCoordinator().importFiles([txt], into: store)

    #expect(report.error == .unsupportedFile("notes.txt"))
    #expect(report.imported == 0)
    #expect(store.contacts.count == before)  // untouched
}

// ── Abort: image-only drop (no data file) ─────────────────────────────────────
@Test @MainActor func imageOnlyDropAborts() async {
    let dir = tempDir()
    let jpg = writeBytes([0xFF, 0xD8], named: "solo.jpg", in: dir)
    let store = AppStore()
    let report = await ImportCoordinator().importFiles([jpg], into: store)
    #expect(report.error == .noContactFiles)
    #expect(store.contacts.isEmpty)
}

// ── Partition unit checks ─────────────────────────────────────────────────────
@Test func imageDetectionByExtension() {
    #expect(ImportCoordinator.isImageFile(URL(fileURLWithPath: "/x/pic.JPEG")))
    #expect(ImportCoordinator.isImageFile(URL(fileURLWithPath: "/x/pic.heic")))
    #expect(!ImportCoordinator.isImageFile(URL(fileURLWithPath: "/x/data.vcf")))
    #expect(!ImportCoordinator.isImageFile(URL(fileURLWithPath: "/x/notes.txt")))
}

@Test func adapterSelectionByExtension() {
    let c = ImportCoordinator()
    #expect(c.adapterForFile(URL(fileURLWithPath: "/x/a.vcf"))?.id == "vcard")
    #expect(c.adapterForFile(URL(fileURLWithPath: "/x/a.md"))?.id == "markdown")
    #expect(c.adapterForFile(URL(fileURLWithPath: "/x/a.tsv"))?.id == "tsv")
    #expect(c.adapterForFile(URL(fileURLWithPath: "/x/a.png")) == nil)
}
