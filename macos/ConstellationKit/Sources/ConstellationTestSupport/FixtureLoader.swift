import Foundation

/// Locates the repo-root `fixtures/` directory shared with the Node test
/// suite by walking up from this source file's path. Works identically under
/// `swift test`, Xcode, and CI — no SwiftPM resource copying, no symlinks.
public enum FixtureLoader {
    /// Repo root (the directory containing `fixtures/`).
    public static func repoRoot(from filePath: String = #filePath) -> URL {
        var dir = URL(fileURLWithPath: filePath).deletingLastPathComponent()
        let fm = FileManager.default
        while dir.path != "/" {
            var isDir: ObjCBool = false
            let candidate = dir.appendingPathComponent("fixtures")
            if fm.fileExists(atPath: candidate.path, isDirectory: &isDir), isDir.boolValue {
                return dir
            }
            dir.deleteLastPathComponent()
        }
        fatalError("FixtureLoader: no fixtures/ directory found above \(filePath)")
    }

    public static func url(_ name: String) -> URL {
        repoRoot().appendingPathComponent("fixtures").appendingPathComponent(name)
    }

    public static func contents(of name: String) -> String {
        guard let text = try? String(contentsOf: url(name), encoding: .utf8) else {
            fatalError("FixtureLoader: cannot read fixture \(name)")
        }
        return text
    }
}
