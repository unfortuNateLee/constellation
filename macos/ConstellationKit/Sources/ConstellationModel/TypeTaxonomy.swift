// Port of js/contact-types.js — the shared contact-method TYPE taxonomy and the
// typesToLabel / labelToTypes round-trip used by the Markdown format and the
// read-only type editor. Behavior is byte-for-byte with the JS: FAX-combo
// collapsing, "Preferred" appending, unrecognized-token → whole-string custom
// label, case-insensitivity, and ordered de-dup (`[...new Set(types)]`).

import Foundation

/// The kind of contact method whose type set is being rendered/parsed.
/// Unknown kinds fall back to the address table in the JS; the enum makes only
/// the four defined kinds representable.
public enum ContactMethodKind: String, Sendable, CaseIterable {
    case phone
    case email
    case url
    case address
}

/// An ordered `{ value, label }` type option (vCard TYPE → display label).
public struct TypeOption: Equatable, Sendable {
    public let value: String
    public let label: String

    public init(value: String, label: String) {
        self.value = value
        self.label = label
    }
}

public enum TypeTaxonomy {
    /// Ordered TYPE tables per kind (js/contact-types.js `TAXONOMY`).
    private static let tables: [ContactMethodKind: [TypeOption]] = [
        .phone: [
            TypeOption(value: "CELL", label: "Mobile"),
            TypeOption(value: "IPHONE", label: "iPhone"),
            TypeOption(value: "APPLEWATCH", label: "Apple Watch"),
            TypeOption(value: "HOME", label: "Home"),
            TypeOption(value: "WORK", label: "Work"),
            TypeOption(value: "MAIN", label: "Main"),
            TypeOption(value: "FAX", label: "Fax"),
            TypeOption(value: "PAGER", label: "Pager"),
            TypeOption(value: "OTHER", label: "Other"),
        ],
        .email: [
            TypeOption(value: "HOME", label: "Home"),
            TypeOption(value: "WORK", label: "Work"),
            TypeOption(value: "SCHOOL", label: "School"),
            TypeOption(value: "ICLOUD", label: "iCloud"),
            TypeOption(value: "OTHER", label: "Other"),
        ],
        .url: [
            TypeOption(value: "HOME", label: "Home"),
            TypeOption(value: "WORK", label: "Work"),
            TypeOption(value: "OTHER", label: "Other"),
        ],
        .address: [
            TypeOption(value: "HOME", label: "Home"),
            TypeOption(value: "WORK", label: "Work"),
            TypeOption(value: "OTHER", label: "Other"),
        ],
    ]

    /// Types that are structural/implied and never shown as a user label.
    public static let hiddenTypes: Set<String> = ["PREF", "VOICE", "INTERNET"]

    /// Ordered `{ value, label }` type options for a kind.
    public static func typeTaxonomy(_ kind: ContactMethodKind) -> [TypeOption] {
        tables[kind] ?? tables[.address]!
    }

    /// Render a type set + optional custom label to a single human label string.
    /// A custom label wins; else visible types as Title-Case words (FAX combos
    /// collapse to "Home Fax"/…), with "Preferred" appended when PREF is set.
    public static func typesToLabel(
        _ kind: ContactMethodKind,
        types: [String] = [],
        customLabel: String = ""
    ) -> String {
        if !customLabel.isEmpty { return customLabel }
        let up = types.map { $0.uppercased() }
        let preferred = up.contains("PREF")

        var label: String
        if kind == .phone && up.contains("FAX") {
            if up.contains("HOME") {
                label = "Home Fax"
            } else if up.contains("WORK") {
                label = "Work Fax"
            } else if up.contains("OTHER") {
                label = "Other Fax"
            } else {
                label = "Fax"
            }
        } else {
            var labelOf: [String: String] = [:]
            for option in typeTaxonomy(kind) { labelOf[option.value] = option.label }
            let parts = up
                .filter { !hiddenTypes.contains($0) }
                .map { labelOf[$0] ?? titleCase($0) }
            label = parts.joined(separator: ", ")
        }

        if preferred {
            label = label.isEmpty ? "Preferred" : "\(label), Preferred"
        }
        return label
    }

    /// Parse a human label string back to `(types, label)`. Every comma-separated
    /// token must be a known type (or "preferred"/"pref", or a FAX combo) to be
    /// treated as types; otherwise the whole string is a custom X-ABLabel.
    /// Case-insensitive.
    public static func labelToTypes(
        _ kind: ContactMethodKind,
        _ labelStr: String
    ) -> (types: [String], label: String) {
        let raw = labelStr.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return ([], "") }

        var tokenToType: [String: String] = [:]
        for option in typeTaxonomy(kind) {
            tokenToType[option.value.lowercased()] = option.value
            tokenToType[option.label.lowercased()] = option.value
        }
        let composites: [String: [String]] = [
            "home fax": ["HOME", "FAX"],
            "work fax": ["WORK", "FAX"],
            "other fax": ["OTHER", "FAX"],
        ]

        let tokens = raw.split(separator: ",", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

        var types: [String] = []
        for tok in tokens {
            if tok.isEmpty { continue }
            if tok == "preferred" || tok == "pref" {
                types.append("PREF")
            } else if let composite = composites[tok] {
                types.append(contentsOf: composite)
            } else if let mapped = tokenToType[tok] {
                types.append(mapped)
            } else {
                // Unrecognized token → the whole label is a custom X-ABLabel.
                return ([], raw)
            }
        }
        return (orderedDedup(types), "")
    }

    // JS `t.charAt(0) + t.slice(1).toLowerCase()` on an already-uppercased token.
    private static func titleCase(_ upper: String) -> String {
        guard let first = upper.first else { return upper }
        return String(first) + upper.dropFirst().lowercased()
    }

    // JS `[...new Set(arr)]`: first-occurrence order preserved.
    private static func orderedDedup(_ items: [String]) -> [String] {
        var seen: Set<String> = []
        var out: [String] = []
        for item in items where seen.insert(item).inserted {
            out.append(item)
        }
        return out
    }
}
