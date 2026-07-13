import ConstellationModel
import Foundation

/// Loads Node-generated golden Markdown files stored outside any SwiftPM target
/// (`macos/ConstellationKit/Tests/Goldens/markdown/`) so the build ignores them.
enum MDGolden {
    static func load(_ name: String, file: String = #filePath) -> String {
        // <repo>/macos/ConstellationKit/Tests/FormatsTests/<file>.swift
        let testsDir = URL(fileURLWithPath: file)
            .deletingLastPathComponent()  // FormatsTests
            .deletingLastPathComponent()  // Tests
        let url = testsDir.appendingPathComponent("Goldens/markdown/\(name)")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            fatalError("MDGolden: cannot read \(url.path)")
        }
        return text
    }
}

/// Small order-independent accessors over `JSONValue` for assertions (named to
/// avoid colliding with any sibling test target's helpers).
enum MDJSON {
    static func str(_ v: JSONValue?) -> String? {
        if case .string(let s)? = v { return s }
        return nil
    }
    static func num(_ v: JSONValue?) -> Double? {
        if case .number(let n)? = v { return n }
        return nil
    }
    static func bool(_ v: JSONValue?) -> Bool? {
        if case .bool(let b)? = v { return b }
        return nil
    }
    static func isNull(_ v: JSONValue?) -> Bool {
        if case .null? = v { return true }
        return false
    }
    static func get(_ v: JSONValue?, _ key: String) -> JSONValue? {
        if case .object(let o)? = v { return o[key] }
        return nil
    }
    static func arr(_ v: JSONValue?) -> [JSONValue]? {
        if case .array(let a)? = v { return a }
        return nil
    }
    /// Chained object lookup: `path(v, "value", "awards", "compiler")`.
    static func path(_ v: JSONValue?, _ keys: String...) -> JSONValue? {
        var cur = v
        for k in keys { cur = get(cur, k) }
        return cur
    }
}

extension Array where Element == Contact {
    func byUid(_ uid: String) -> Contact? { first { $0.uid == uid } }
}
