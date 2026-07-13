import ConstellationModel
import Foundation

/// The single JSON utility shared by every byte-critical serialization path
/// (vCard `X-CONSTELLATION-FIELD` payloads and content keys, Markdown "Other
/// Fields" fenced-``json`` blocks). It replaces the two divergent
/// reimplementations that the vCard and Markdown ports each grew.
///
/// It is *not* a general encoder: it reproduces V8's `JSON.stringify` byte-for-
/// byte and pairs with an order-preserving parser so a `JSONObject`'s insertion
/// order survives a round-trip.
///   - object keys are emitted in the container's insertion order (the caller's
///     responsibility via `JSONObject`/`OrderedDictionary`);
///   - numbers print JS-style — integer-valued doubles without a decimal point,
///     non-finite as `null`;
///   - `/` is never escaped, non-ASCII is kept verbatim, control characters use
///     the short (`\n`) or `\u00xx` escapes;
///   - `stringify` matches `JSON.stringify(value, null, 2)`; `stringifyCompact`
///     matches `JSON.stringify(value)`.
enum JSONCodec {

    // MARK: - Parse (order-preserving)

    /// Parse `text` into a `JSONValue` (objects become order-preserving
    /// `JSONObject`s). Returns `nil` on any malformed input, mirroring the JS
    /// `try { JSON.parse } catch` fallback.
    static func parse(_ text: String) -> JSONValue? {
        var parser = Parser(Array(text.unicodeScalars))
        parser.skipWhitespace()
        guard let value = parser.parseValue() else { return nil }
        parser.skipWhitespace()
        return parser.atEnd ? value : nil
    }

    private struct Parser {
        let scalars: [Unicode.Scalar]
        var i = 0

        init(_ scalars: [Unicode.Scalar]) { self.scalars = scalars }

        var atEnd: Bool { i >= scalars.count }

        mutating func skipWhitespace() {
            while i < scalars.count {
                let c = scalars[i]
                if c == " " || c == "\t" || c == "\n" || c == "\r" { i += 1 } else { break }
            }
        }

        mutating func parseValue() -> JSONValue? {
            guard i < scalars.count else { return nil }
            switch scalars[i] {
            case "{": return parseObject()
            case "[": return parseArray()
            case "\"": return parseString().map { .string($0) }
            case "t", "f": return parseBool()
            case "n": return parseNull()
            default: return parseNumber()
            }
        }

        mutating func parseObject() -> JSONValue? {
            i += 1  // '{'
            var object = JSONObject()
            skipWhitespace()
            if i < scalars.count, scalars[i] == "}" { i += 1; return .object(object) }
            while i < scalars.count {
                skipWhitespace()
                guard i < scalars.count, scalars[i] == "\"", let key = parseString() else { return nil }
                skipWhitespace()
                guard i < scalars.count, scalars[i] == ":" else { return nil }
                i += 1
                skipWhitespace()
                guard let value = parseValue() else { return nil }
                object[key] = value
                skipWhitespace()
                guard i < scalars.count else { return nil }
                if scalars[i] == "," { i += 1; continue }
                if scalars[i] == "}" { i += 1; return .object(object) }
                return nil
            }
            return nil
        }

        mutating func parseArray() -> JSONValue? {
            i += 1  // '['
            var items: [JSONValue] = []
            skipWhitespace()
            if i < scalars.count, scalars[i] == "]" { i += 1; return .array(items) }
            while i < scalars.count {
                skipWhitespace()
                guard let value = parseValue() else { return nil }
                items.append(value)
                skipWhitespace()
                guard i < scalars.count else { return nil }
                if scalars[i] == "," { i += 1; continue }
                if scalars[i] == "]" { i += 1; return .array(items) }
                return nil
            }
            return nil
        }

        mutating func parseString() -> String? {
            i += 1  // opening quote
            var out = String.UnicodeScalarView()
            while i < scalars.count {
                let c = scalars[i]
                if c == "\"" { i += 1; return String(out) }
                if c == "\\" {
                    i += 1
                    guard i < scalars.count else { return nil }
                    let esc = scalars[i]
                    switch esc {
                    case "\"": out.append("\"")
                    case "\\": out.append("\\")
                    case "/": out.append("/")
                    case "b": out.append(Unicode.Scalar(0x08))
                    case "f": out.append(Unicode.Scalar(0x0C))
                    case "n": out.append("\n")
                    case "r": out.append("\r")
                    case "t": out.append("\t")
                    case "u":
                        guard i + 4 < scalars.count else { return nil }
                        let hex = String(String.UnicodeScalarView(scalars[(i + 1)...(i + 4)]))
                        guard let code = UInt32(hex, radix: 16), let u = Unicode.Scalar(code) else {
                            return nil
                        }
                        out.append(u)
                        i += 4
                    default: return nil
                    }
                    i += 1
                } else {
                    out.append(c)
                    i += 1
                }
            }
            return nil
        }

        mutating func parseBool() -> JSONValue? {
            if match("true") { return .bool(true) }
            if match("false") { return .bool(false) }
            return nil
        }

        mutating func parseNull() -> JSONValue? {
            match("null") ? .null : nil
        }

        mutating func match(_ literal: String) -> Bool {
            let lit = Array(literal.unicodeScalars)
            guard i + lit.count <= scalars.count else { return false }
            for (k, s) in lit.enumerated() where scalars[i + k] != s { return false }
            i += lit.count
            return true
        }

        mutating func parseNumber() -> JSONValue? {
            let start = i
            if i < scalars.count, scalars[i] == "-" { i += 1 }
            while i < scalars.count, isNumberScalar(scalars[i]) { i += 1 }
            guard i > start else { return nil }
            let token = String(String.UnicodeScalarView(scalars[start..<i]))
            guard let n = Double(token) else { return nil }
            return .number(n)
        }

        private func isNumberScalar(_ c: Unicode.Scalar) -> Bool {
            (c >= "0" && c <= "9") || c == "." || c == "e" || c == "E" || c == "+" || c == "-"
        }
    }

    // MARK: - Serialize

    /// `JSON.stringify(value, null, 2)`: 2-space indent, `": "` separators,
    /// `[]`/`{}` for empties.
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
            let body = items.map { inner + stringify($0, indent: indent + 2) }.joined(separator: ",\n")
            return "[\n" + body + "\n" + close + "]"
        case .object(let object):
            if object.isEmpty { return "{}" }
            let inner = String(repeating: " ", count: indent + 2)
            let close = String(repeating: " ", count: indent)
            let body = object.pairs.map {
                inner + encodeString($0.key) + ": " + stringify($0.value, indent: indent + 2)
            }.joined(separator: ",\n")
            return "{\n" + body + "\n" + close + "}"
        }
    }

    /// `JSON.stringify(value)` — no whitespace.
    static func stringifyCompact(_ value: JSONValue) -> String {
        switch value {
        case .string(let s): return encodeString(s)
        case .number(let n): return numberString(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        case .array(let items):
            return "[" + items.map { stringifyCompact($0) }.joined(separator: ",") + "]"
        case .object(let object):
            return "{"
                + object.pairs.map { encodeString($0.key) + ":" + stringifyCompact($0.value) }
                    .joined(separator: ",") + "}"
        }
    }

    /// Compose an array literal from already-serialized element fragments
    /// (`JSON.stringify([...])` when each element is pre-encoded). Used to build
    /// vCard content keys.
    static func rawArray(_ elements: [String]) -> String {
        "[" + elements.joined(separator: ",") + "]"
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

    /// JS `String(number)` / `JSON.stringify` number formatting: integer-valued
    /// doubles in the safe range print without a decimal point; non-finite is
    /// `null`; `-0` prints as `0`.
    static func numberString(_ n: Double) -> String {
        guard n.isFinite else { return "null" }
        if n == n.rounded(.towardZero), abs(n) <= 9_007_199_254_740_991 {
            return String(Int64(n))
        }
        // Shortest round-trip; JS prints exponents as "1e-7", Swift "1e-07".
        var s = "\(n)"
        if let r = s.range(of: "e-0") { s.replaceSubrange(r, with: "e-") }
        if let r = s.range(of: "e+0") { s.replaceSubrange(r, with: "e+") }
        return s
    }
}
