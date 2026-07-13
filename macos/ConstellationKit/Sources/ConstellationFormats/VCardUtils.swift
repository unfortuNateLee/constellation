import Foundation

/// Shared vCard helpers (port of js/vcard-utils.js).
/// Keeps parser and writer behavior aligned for escaped values, parameters, and
/// folding. Behavior is byte-compatible with the JS reference.
public enum VCardUtils {
    /// Apple's predefined X-ABLabel tokens — the only labels Apple wraps in the
    /// `_$!<…>!$_` marker (it localizes them for display). Every other label is a
    /// user-custom label, which Apple writes (and expects) PLAIN. Comparison is
    /// case-insensitive; see `formatXABLabel`.
    public static let appleLabels: Set<String> = [
        "home", "work", "other", "school", "mobile", "main", "pager", "iphone",
        "homepage", "home page", "anniversary",
        // Relationship labels Apple localizes (used by the relationship taxonomy).
        "mother", "father", "parent", "brother", "sister", "child", "son",
        "daughter", "friend", "spouse", "partner", "assistant", "manager",
        "husband", "wife",
    ]

    /// Format an X-ABLabel value the way Apple does: wrap a known predefined label
    /// in `_$!<…>!$_` (so Apple localizes it), but write a custom label PLAIN —
    /// otherwise Apple Contacts shows the literal `_$!<…>!$_` markers around it.
    public static func formatXABLabel(_ label: String) -> String {
        appleLabels.contains(label.lowercased())
            ? "_$!<\(encodeValue(label))>!$_"
            : encodeValue(label)
    }

    /// Remove RFC 6350 §3.2 fold markers: a CRLF (or bare LF) immediately
    /// followed by a space or tab — both the break and the whitespace go.
    public static func unfold(_ text: String) -> String {
        var out = text.replacingOccurrences(
            of: "\r\n[ \t]", with: "", options: .regularExpression)
        out = out.replacingOccurrences(of: "\n[ \t]", with: "", options: .regularExpression)
        return out
    }

    /// Split on an unescaped delimiter; escape sequences are KEPT verbatim in the
    /// parts (decoding happens separately, matching the JS).
    public static func splitEscaped(_ value: String, delimiter: Unicode.Scalar = ";") -> [String]
    {
        var parts: [String] = []
        var current = ""
        var escaped = false
        for ch in value.unicodeScalars {
            if escaped {
                current += "\\"
                current.unicodeScalars.append(ch)
                escaped = false
                continue
            }
            if ch == "\\" {
                escaped = true
                continue
            }
            if ch == delimiter {
                parts.append(current)
                current = ""
                continue
            }
            current.unicodeScalars.append(ch)
        }
        if escaped { current += "\\" }
        parts.append(current)
        return parts
    }

    public struct ContentLine {
        public var group: String?
        public var name: String
        public var params: [Param]
        public var value: String
    }

    public struct Param {
        public var name: String
        public var values: [String]
    }

    public static func parseContentLine(_ line: String) -> ContentLine? {
        guard let colonIdx = firstUnquotedColonIndex(line) else { return nil }
        let lhs = String(line[..<colonIdx])
        let value = String(line[line.index(after: colonIdx)...])
        var lhsParts = splitParams(lhs)
        let propFull = lhsParts.isEmpty ? "" : lhsParts.removeFirst()

        var group: String?
        var name = propFull
        if let match = propFull.wholeMatch(
            of: /(?i)^(item\d+)\.(.+)$/)
        {
            group = String(match.1).lowercased()
            name = String(match.2)
        }

        return ContentLine(
            group: group,
            name: name.uppercased(),
            params: parseParams(lhsParts),
            value: value
        )
    }

    public static func parseParams(_ parts: [String]) -> [Param] {
        var params: [Param] = []
        for part in parts where !part.isEmpty {
            guard let eqIdx = part.firstIndex(of: "=") else {
                params.append(Param(name: "TYPE", values: [unquoteParam(part)]))
                continue
            }
            let name = String(part[..<eqIdx]).uppercased()
            let rawValue = String(part[part.index(after: eqIdx)...])
            let values = splitParamValues(rawValue).map { unquoteParam($0) }
            params.append(Param(name: name, values: values))
        }
        return params
    }

    public static func typesFromParams(_ params: [Param]) -> [String] {
        var types: [String] = []
        for param in params where param.name == "TYPE" {
            for value in param.values {
                let type = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !type.isEmpty { types.append(type.uppercased()) }
            }
        }
        var seen = Set<String>()
        return types.filter { seen.insert($0).inserted }
    }

    /// Escape a vCard property value: backslash, then `;`, `,`, and newlines.
    public static func encodeValue(_ value: String) -> String {
        var out = value.replacingOccurrences(of: "\\", with: "\\\\")
        out = out.replacingOccurrences(of: ";", with: "\\;")
        out = out.replacingOccurrences(of: ",", with: "\\,")
        out = out.replacingOccurrences(of: "\r\n", with: "\\n")
        out = out.replacingOccurrences(of: "\r", with: "\\n")
        out = out.replacingOccurrences(of: "\n", with: "\\n")
        return out
    }

    /// Single left-to-right pass: each backslash consumes exactly the next
    /// character. Sequential replaces are wrong here — unescaping `\\` last makes
    /// `\\n` (escaped backslash + literal "n") decode as a newline.
    public static func decodeValue(_ value: String) -> String {
        let scalars = Array(value.unicodeScalars)
        var out = String.UnicodeScalarView()
        var i = 0
        while i < scalars.count {
            let ch = scalars[i]
            if ch == "\\", i + 1 < scalars.count {
                let next = scalars[i + 1]
                i += 1
                if next == "n" || next == "N" {
                    out.append("\n")
                } else {
                    out.append(next)
                }
            } else {
                out.append(ch)
            }
            i += 1
        }
        return String(out)
    }

    /// `;TYPE=X;TYPE=Y` parameter string from a types array: trimmed, empties
    /// dropped, case-insensitively deduped keeping first, values UPPERCASED.
    public static func buildTypeParams(_ types: [String]) -> String {
        var seen = Set<String>()
        return types
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .filter { seen.insert($0.uppercased()).inserted }
            .map { ";TYPE=\($0.uppercased())" }
            .joined()
    }

    /// Encode a string for use as a vCard *parameter* value (RFC 6350 §3.3).
    /// A param value containing a structural character (`,`, `;`, `:`) or
    /// whitespace must be wrapped in double quotes. DQUOTE and CR/LF cannot
    /// appear inside a quoted param value, so they are stripped.
    public static func encodeParamValue(_ value: String) -> String {
        let cleaned = value.replacingOccurrences(
            of: "[\"\r\n]", with: "", options: .regularExpression)
        let needsQuotes =
            cleaned.range(of: "[,;:\\s]", options: .regularExpression) != nil
        return needsQuotes ? "\"\(cleaned)\"" : cleaned
    }

    // Canonical change-detection keys for contact-method instances. Used by
    // hybrid per-instance raw preservation: the parser records each instance's
    // key → original raw line(s); the serializer re-emits the original bytes for
    // any instance whose current key still matches (i.e. the user never touched
    // it), regenerating only edited instances. Types are uppercased + sorted so
    // the key is order-independent (order-only changes keep the raw bytes).
    //
    // JS `contactMethodKey(kind, entry)` builds JSON arrays with kind-specific
    // field orders; these helpers replicate each shape exactly.

    public static func keyForEmailPhoneURL(kind: String, value: String, types: [String], label: String)
        -> String
    {
        JSONCodec.rawArray([
            JSONCodec.encodeString(kind),
            JSONCodec.encodeString(value),
            typesArrayJSON(types),
            JSONCodec.encodeString(label),
        ])
    }

    public static func keyForAddress(
        pobox: String, ext: String, street: String, city: String, state: String,
        zip: String, country: String, types: [String], label: String
    ) -> String {
        JSONCodec.rawArray([
            JSONCodec.encodeString("address"),
            JSONCodec.encodeString(pobox),
            JSONCodec.encodeString(ext),
            JSONCodec.encodeString(street),
            JSONCodec.encodeString(city),
            JSONCodec.encodeString(state),
            JSONCodec.encodeString(zip),
            JSONCodec.encodeString(country),
            typesArrayJSON(types),
            JSONCodec.encodeString(label),
        ])
    }

    public static func keyForIM(value: String, service: String, types: [String], label: String)
        -> String
    {
        JSONCodec.rawArray([
            JSONCodec.encodeString("im"),
            JSONCodec.encodeString(value),
            JSONCodec.encodeString(service),
            typesArrayJSON(types),
            JSONCodec.encodeString(label),
        ])
    }

    public static func keyForSocial(url: String, service: String, username: String, label: String)
        -> String
    {
        JSONCodec.rawArray([
            JSONCodec.encodeString("social"),
            JSONCodec.encodeString(url),
            JSONCodec.encodeString(service),
            JSONCodec.encodeString(username),
            JSONCodec.encodeString(label),
        ])
    }

    private static func typesArrayJSON(_ types: [String]) -> String {
        JSONCodec.rawArray(types.map { JSONCodec.encodeString($0.uppercased()) }.sorted())
    }

    /// Fold one line to 75-octet chunks (RFC 6350), continuation lines prefixed
    /// with a single space (which counts toward the next line's 75). Chunking is
    /// per code point measured in UTF-8 bytes, matching the JS TextEncoder path.
    public static func foldLine(_ line: String, limit: Int = 75) -> String {
        if line.utf8.count <= limit { return line }

        var chunks: [String] = []
        var current = ""
        var currentBytes = 0
        var chunkLimit = limit

        for ch in line.unicodeScalars {
            let byteLength = String(ch).utf8.count
            if !current.isEmpty, currentBytes + byteLength > chunkLimit {
                chunks.append(chunks.isEmpty ? current : " \(current)")
                current = String(ch)
                currentBytes = byteLength
                chunkLimit = limit - 1
            } else {
                current.unicodeScalars.append(ch)
                currentBytes += byteLength
            }
        }
        if !current.isEmpty || chunks.isEmpty {
            chunks.append(chunks.isEmpty ? current : " \(current)")
        }

        return chunks.joined(separator: "\r\n")
    }

    public static func foldLines(_ lines: [String]) -> String {
        lines.map { foldLine($0) }.joined(separator: "\r\n")
    }

    // MARK: - Internals (ports of the JS underscore helpers)

    private static func firstUnquotedColonIndex(_ source: String) -> String.Index? {
        var inQuotes = false
        var idx = source.startIndex
        while idx < source.endIndex {
            let ch = source[idx]
            if ch == "\"" { inQuotes.toggle() }
            if ch == ":" && !inQuotes { return idx }
            idx = source.index(after: idx)
        }
        return nil
    }

    static func splitParams(_ lhs: String) -> [String] {
        var parts: [String] = []
        var current = ""
        var inQuotes = false
        for ch in lhs.unicodeScalars {
            if ch == "\"" { inQuotes.toggle() }
            if ch == ";" && !inQuotes {
                parts.append(current)
                current = ""
                continue
            }
            current.unicodeScalars.append(ch)
        }
        parts.append(current)
        return parts
    }

    private static func splitParamValues(_ value: String) -> [String] {
        var values: [String] = []
        var current = ""
        var inQuotes = false
        for ch in value.unicodeScalars {
            if ch == "\"" { inQuotes.toggle() }
            if ch == "," && !inQuotes {
                values.append(current)
                current = ""
                continue
            }
            current.unicodeScalars.append(ch)
        }
        values.append(current)
        return values
    }

    private static func unquoteParam(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count >= 2, trimmed.hasPrefix("\""), trimmed.hasSuffix("\"") {
            return String(trimmed.dropFirst().dropLast())
        }
        return trimmed
    }
}
