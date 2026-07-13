import ConstellationModel

/// Canonical JSON serializer for the parity harness model dump.
///
/// Reproduces Node's `JSON.stringify(value, sortedKeysReplacer, 2)` byte-for-byte:
/// object keys are sorted lexicographically at **every** level, 2-space indent,
/// `": "` separators, `/` never escaped, non-ASCII kept verbatim, control chars
/// as the short (`\n`) or `\u00xx` escapes, integer-valued numbers with no decimal
/// point. It mirrors `ConstellationFormats/JSONCodec` (which is module-internal and
/// therefore not importable here) but differs in one respect the contract demands:
/// keys are **sorted**, not emitted in insertion order.
enum CanonicalJSON {
    /// `JSON.stringify(value, sortedKeysReplacer, 2)` — sorted keys, 2-space indent.
    static func stringify(_ value: JSONValue, indent: Int = 0) -> String {
        switch value {
        case .string(let s): return encodeString(s)
        case .number(let n): return numberString(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        case .array(let items):
            if items.isEmpty { return "[]" }
            let inner = String(repeating: " ", count: indent + 2)
            let close = String(repeating: " ", count: indent)
            let body = items
                .map { inner + stringify($0, indent: indent + 2) }
                .joined(separator: ",\n")
            return "[\n" + body + "\n" + close + "]"
        case .object(let object):
            if object.isEmpty { return "{}" }
            let inner = String(repeating: " ", count: indent + 2)
            let close = String(repeating: " ", count: indent)
            let sortedPairs = object.pairs.sorted { $0.key < $1.key }
            let body = sortedPairs
                .map { inner + encodeString($0.key) + ": " + stringify($0.value, indent: indent + 2) }
                .joined(separator: ",\n")
            return "{\n" + body + "\n" + close + "}"
        }
    }

    /// A JSON string literal matching JS: escape `"` `\` and control chars; keep
    /// non-ASCII (incl. astral scalars) verbatim; never escape `/`.
    static func encodeString(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case Unicode.Scalar(0x08): out += "\\b"
            case Unicode.Scalar(0x0C): out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }

    /// JS number formatting: integer-valued doubles in the safe range print without
    /// a decimal point; non-finite is `null`; `-0` prints as `0`.
    static func numberString(_ n: Double) -> String {
        guard n.isFinite else { return "null" }
        if n == n.rounded(.towardZero), abs(n) <= 9_007_199_254_740_991 {
            return String(Int64(n))
        }
        var s = "\(n)"
        if let r = s.range(of: "e-0") { s.replaceSubrange(r, with: "e-") }
        if let r = s.range(of: "e+0") { s.replaceSubrange(r, with: "e+") }
        return s
    }
}
