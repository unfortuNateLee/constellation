// Swift half of the Constellation cross-implementation parity harness.
//
// Parses every importable fixture in repo-root `fixtures/` with the real
// ConstellationFormats adapters and emits a canonical, byte-stable dump that must
// reproduce the Node half (`scripts/parity/dump-node.mjs`) exactly. See
// scripts/parity/README.md for the pinned contract.
//
// Usage: swift run constellation-dump <outdir>

import ConstellationFormats
import ConstellationModel
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// MARK: - Repo-root resolution
//
// Mirror ConstellationTestSupport/FixtureLoader: walk up from this source file's
// compile-time path until a directory containing `fixtures/` is found. Executables
// can be launched from anywhere, so #filePath (baked in at build time) is the
// reliable anchor; CONSTELLATION_REPO_ROOT overrides it (e.g. for CI or relocated
// checkouts).
func repoRoot(from filePath: String = #filePath) -> URL {
    let fm = FileManager.default
    if let override = ProcessInfo.processInfo.environment["CONSTELLATION_REPO_ROOT"],
       !override.isEmpty {
        return URL(fileURLWithPath: override, isDirectory: true)
    }
    var dir = URL(fileURLWithPath: filePath).deletingLastPathComponent()
    while dir.path != "/" {
        var isDir: ObjCBool = false
        let candidate = dir.appendingPathComponent("fixtures")
        if fm.fileExists(atPath: candidate.path, isDirectory: &isDir), isDir.boolValue {
            return dir
        }
        dir.deleteLastPathComponent()
    }
    fail("constellation-dump: no fixtures/ directory found above \(filePath) "
        + "(set CONSTELLATION_REPO_ROOT)")
}

// MARK: - Importer selection

struct Importer {
    let adapter: ContactFormatAdapter
    let options: ParseOptions
    let format: SourceFormat
}

let vcardAdapter = VCardAdapter()
let markdownAdapter = MarkdownAdapter()
let tsvAdapter = TSVAdapter()

func importer(forExtension ext: String) -> Importer? {
    switch ext {
    case "vcf", "vcard":
        return Importer(adapter: vcardAdapter, options: ParseOptions(), format: .vcard)
    case "md", "markdown":
        // EMPTY photoMap per the contract: no photos are resolved.
        return Importer(adapter: markdownAdapter, options: ParseOptions(photoMap: [:]), format: .markdown)
    case "tsv":
        return Importer(adapter: tsvAdapter, options: ParseOptions(), format: .tsv)
    default:
        return nil
    }
}

// MARK: - Canonical model JSON

/// The contacts array in parse order, each projected to the §8.1 model object,
/// serialized with sorted keys + trailing newline (Node ground truth).
func canonicalJson(_ contacts: [Contact], format: SourceFormat) -> String {
    let models = JSONValue.array(contacts.map { ContactModel.project($0, format: format) })
    return CanonicalJSON.stringify(models) + "\n"
}

// MARK: - Driver

let arguments = CommandLine.arguments
guard arguments.count >= 2, !arguments[1].isEmpty else {
    fail("usage: constellation-dump <outdir>")
}
let outdir = URL(fileURLWithPath: arguments[1], isDirectory: true)

let fm = FileManager.default
let fixturesDir = repoRoot().appendingPathComponent("fixtures", isDirectory: true)

guard let names = try? fm.contentsOfDirectory(atPath: fixturesDir.path) else {
    fail("constellation-dump: cannot read fixtures directory \(fixturesDir.path)")
}

func stem(of name: String) -> String {
    guard let dot = name.lastIndex(of: ".") else { return name }
    return String(name[name.startIndex..<dot])
}

func ext(of name: String) -> String {
    guard let dot = name.lastIndex(of: ".") else { return "" }
    return String(name[name.index(after: dot)...]).lowercased()
}

try? fm.createDirectory(at: outdir, withIntermediateDirectories: true)

let entries = names
    .filter { name in
        var isDir: ObjCBool = false
        let path = fixturesDir.appendingPathComponent(name).path
        return fm.fileExists(atPath: path, isDirectory: &isDir) && !isDir.boolValue
    }
    .sorted()

var produced = 0
var importable = 0

for name in entries {
    guard let imp = importer(forExtension: ext(of: name)) else { continue }
    importable += 1

    let fixtureURL = fixturesDir.appendingPathComponent(name)
    guard let text = try? String(contentsOf: fixtureURL, encoding: .utf8) else {
        fail("constellation-dump: cannot read fixture \(name)")
    }

    let contacts = imp.adapter.parse(text, options: imp.options).contacts
    let base = stem(of: name)

    let files: [(String, String)] = [
        ("\(base).model.json", canonicalJson(contacts, format: imp.format)),
        ("\(base).out.vcf", vcardAdapter.serialize(contacts)),
        ("\(base).out.md", markdownAdapter.serialize(contacts)),
        ("\(base).out.tsv", tsvAdapter.serialize(contacts)),
    ]

    for (outName, content) in files {
        let dest = outdir.appendingPathComponent(outName)
        do {
            try content.write(to: dest, atomically: true, encoding: .utf8)
        } catch {
            fail("constellation-dump: cannot write \(dest.path): \(error)")
        }
        produced += 1
    }

    FileHandle.standardOutput.write(Data(
        "\(name) (\(contacts.count) contacts) -> \(base).{model.json,out.vcf,out.md,out.tsv}\n".utf8))
}

if importable == 0 {
    fail("constellation-dump: no importable fixtures found in \(fixturesDir.path)")
}

FileHandle.standardOutput.write(Data("wrote \(produced) files to \(outdir.path)\n".utf8))
