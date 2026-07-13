// Port of js/relationship-taxonomy.js — the single source of truth for
// relationship-type semantics: canonical types, display labels, Apple
// X-ABLabel values, edge categories, reciprocals, generic parents (used by
// the reciprocal-downgrade guard and the indented picker), import aliases,
// gender groups, and valid reciprocal pairs. Behavior is byte-for-byte with
// the JS; the data table is verified against docs/DESIGN_SPEC.md §10.5
// (generated from the JS module by scripts/gen-taxonomy-doc.js).

import Foundation

/// One entry of `RelationshipTaxonomy.types` (JS `TYPES[key]`).
public struct RelationshipTypeEntry: Equatable, Sendable {
    /// Display / friendly label, e.g. "Husband".
    public let label: String
    /// Edge category: family | friend | work | neighbor | other.
    public let category: String
    /// Canonical key of the (generic) reciprocal type.
    public let reciprocal: String
    /// For a gendered/specific type, its generic parent (husband→spouse);
    /// used to detect reciprocal "downgrades". `nil` when none.
    public let generic: String?
    /// Override for the X-ABLabel text; defaults to `label` when `nil`.
    public let vcardLabel: String?

    public init(
        label: String,
        category: String,
        reciprocal: String,
        generic: String? = nil,
        vcardLabel: String? = nil
    ) {
        self.label = label
        self.category = category
        self.reciprocal = reciprocal
        self.generic = generic
        self.vcardLabel = vcardLabel
    }
}

/// One node of `RelationshipTaxonomy.pickerTree` (JS `PICKER_TREE` entry).
public struct RelationshipPickerNode: Sendable {
    public let key: String
    public let subtypes: [String]

    public init(key: String, subtypes: [String] = []) {
        self.key = key
        self.subtypes = subtypes
    }
}

/// A flat, ordered picker option (JS `pickerOptions()` entry).
public struct RelationshipPickerOption: Equatable, Sendable {
    public let value: String
    public let label: String
    public let depth: Int

    public init(value: String, label: String, depth: Int) {
        self.value = value
        self.label = label
        self.depth = depth
    }
}

/// Gendered variants for a relationship concept (JS `GENDER_GROUPS[concept]`).
/// `neutral` is `""` where no gender-neutral term exists (aunt/uncle, niece/nephew).
public struct RelationshipGenderGroup: Sendable {
    public let neutral: String
    public let male: String
    public let female: String

    public init(neutral: String, male: String, female: String) {
        self.neutral = neutral
        self.male = male
        self.female = female
    }
}

public enum RelationshipTaxonomy {
    // MARK: - Data tables

    public static let types: [String: RelationshipTypeEntry] = [
        // Spouse / partner
        "spouse": RelationshipTypeEntry(label: "Spouse", category: "family", reciprocal: "spouse"),
        "husband": RelationshipTypeEntry(
            label: "Husband", category: "family", reciprocal: "wife", generic: "spouse"),
        "wife": RelationshipTypeEntry(
            label: "Wife", category: "family", reciprocal: "husband", generic: "spouse"),
        "partner": RelationshipTypeEntry(label: "Partner", category: "family", reciprocal: "partner"),
        // Parents
        "mother": RelationshipTypeEntry(
            label: "Mother", category: "family", reciprocal: "child", generic: "parent"),
        "father": RelationshipTypeEntry(
            label: "Father", category: "family", reciprocal: "child", generic: "parent"),
        "parent": RelationshipTypeEntry(label: "Parent", category: "family", reciprocal: "child"),
        "stepmother": RelationshipTypeEntry(
            label: "Stepmother", category: "family", reciprocal: "stepchild", generic: "stepparent"),
        "stepfather": RelationshipTypeEntry(
            label: "Stepfather", category: "family", reciprocal: "stepchild", generic: "stepparent"),
        "stepparent": RelationshipTypeEntry(
            label: "Stepparent", category: "family", reciprocal: "stepchild"),
        // Children
        "son": RelationshipTypeEntry(
            label: "Son", category: "family", reciprocal: "parent", generic: "child"),
        "daughter": RelationshipTypeEntry(
            label: "Daughter", category: "family", reciprocal: "parent", generic: "child"),
        "child": RelationshipTypeEntry(label: "Child", category: "family", reciprocal: "parent"),
        "stepson": RelationshipTypeEntry(
            label: "Stepson", category: "family", reciprocal: "stepparent", generic: "stepchild"),
        "stepdaughter": RelationshipTypeEntry(
            label: "Stepdaughter", category: "family", reciprocal: "stepparent", generic: "stepchild"),
        "stepchild": RelationshipTypeEntry(
            label: "Stepchild", category: "family", reciprocal: "stepparent"),
        // Siblings
        "brother": RelationshipTypeEntry(
            label: "Brother", category: "family", reciprocal: "sibling", generic: "sibling"),
        "sister": RelationshipTypeEntry(
            label: "Sister", category: "family", reciprocal: "sibling", generic: "sibling"),
        "sibling": RelationshipTypeEntry(label: "Sibling", category: "family", reciprocal: "sibling"),
        // Grandparents
        "grandmother": RelationshipTypeEntry(
            label: "Grandmother", category: "family", reciprocal: "grandchild", generic: "grandparent"),
        "grandfather": RelationshipTypeEntry(
            label: "Grandfather", category: "family", reciprocal: "grandchild", generic: "grandparent"),
        "grandparent": RelationshipTypeEntry(
            label: "Grandparent", category: "family", reciprocal: "grandchild"),
        // Grandchildren
        "grandson": RelationshipTypeEntry(
            label: "Grandson", category: "family", reciprocal: "grandparent", generic: "grandchild"),
        "granddaughter": RelationshipTypeEntry(
            label: "Granddaughter", category: "family", reciprocal: "grandparent", generic: "grandchild"),
        "grandchild": RelationshipTypeEntry(
            label: "Grandchild", category: "family", reciprocal: "grandparent"),
        // Extended family
        "uncle": RelationshipTypeEntry(label: "Uncle", category: "family", reciprocal: "nephew"),
        "aunt": RelationshipTypeEntry(label: "Aunt", category: "family", reciprocal: "niece"),
        "nephew": RelationshipTypeEntry(label: "Nephew", category: "family", reciprocal: "uncle"),
        "niece": RelationshipTypeEntry(label: "Niece", category: "family", reciprocal: "aunt"),
        "cousin": RelationshipTypeEntry(label: "Cousin", category: "family", reciprocal: "cousin"),
        // Social / professional
        "friend": RelationshipTypeEntry(label: "Friend", category: "friend", reciprocal: "friend"),
        "neighbor": RelationshipTypeEntry(label: "Neighbor", category: "neighbor", reciprocal: "neighbor"),
        "colleague": RelationshipTypeEntry(label: "Colleague", category: "work", reciprocal: "colleague"),
        "manager": RelationshipTypeEntry(label: "Manager", category: "work", reciprocal: "assistant"),
        "assistant": RelationshipTypeEntry(label: "Assistant", category: "work", reciprocal: "manager"),
        // Backward-compat combined / hyphenated forms (recognized, not offered in the picker)
        "step-parent": RelationshipTypeEntry(
            label: "Stepparent", category: "family", reciprocal: "stepchild"),
        "step-child": RelationshipTypeEntry(
            label: "Stepchild", category: "family", reciprocal: "stepparent"),
        "uncle/aunt": RelationshipTypeEntry(
            label: "Uncle/Aunt", category: "family", reciprocal: "nephew/niece", vcardLabel: "Uncle"),
        "nephew/niece": RelationshipTypeEntry(
            label: "Nephew/Niece", category: "family", reciprocal: "uncle/aunt", vcardLabel: "Nephew"),
    ]

    /// Alternate labels (post Apple-wrapper strip + lowercase) → canonical key.
    public static let aliases: [String: String] = [
        "domestic partner": "partner",
        "step mother": "stepmother",
        "step father": "stepfather",
        "step parent": "stepparent",
        "step-parent": "stepparent",
        "step son": "stepson",
        "step daughter": "stepdaughter",
        "step child": "stepchild",
        "step-child": "stepchild",
        "grand mother": "grandmother",
        "grand father": "grandfather",
        "grand parent": "grandparent",
        "grand son": "grandson",
        "grand daughter": "granddaughter",
        "grand child": "grandchild",
        "best friend": "friend",
        "coworker": "colleague",
        "co-worker": "colleague",
        "boss": "manager",
    ]

    /// Sensible reciprocal pairs (checked in both directions). Listed once.
    public static let validReciprocalPairs: [(String, String)] = [
        ("spouse", "spouse"),
        ("husband", "wife"),
        ("husband", "spouse"),
        ("wife", "spouse"),
        ("partner", "partner"),
        ("friend", "friend"),
        ("colleague", "colleague"),
        ("neighbor", "neighbor"),
        ("cousin", "cousin"),
        ("manager", "assistant"),
        ("mother", "son"),
        ("mother", "daughter"),
        ("mother", "child"),
        ("father", "son"),
        ("father", "daughter"),
        ("father", "child"),
        ("parent", "son"),
        ("parent", "daughter"),
        ("parent", "child"),
        ("stepmother", "stepson"),
        ("stepmother", "stepdaughter"),
        ("stepmother", "stepchild"),
        ("stepfather", "stepson"),
        ("stepfather", "stepdaughter"),
        ("stepfather", "stepchild"),
        ("stepparent", "stepson"),
        ("stepparent", "stepdaughter"),
        ("stepparent", "stepchild"),
        ("step-parent", "step-child"),
        ("step-parent", "stepson"),
        ("step-parent", "stepdaughter"),
        ("step-parent", "stepchild"),
        ("stepparent", "step-child"),
        ("brother", "brother"),
        ("brother", "sister"),
        ("brother", "sibling"),
        ("sister", "sister"),
        ("sister", "sibling"),
        ("sibling", "sibling"),
        ("grandmother", "grandson"),
        ("grandmother", "granddaughter"),
        ("grandmother", "grandchild"),
        ("grandfather", "grandson"),
        ("grandfather", "granddaughter"),
        ("grandfather", "grandchild"),
        ("grandparent", "grandson"),
        ("grandparent", "granddaughter"),
        ("grandparent", "grandchild"),
        ("uncle", "nephew"),
        ("uncle", "niece"),
        ("aunt", "nephew"),
        ("aunt", "niece"),
        ("uncle/aunt", "nephew/niece"),
        ("uncle/aunt", "nephew"),
        ("uncle/aunt", "niece"),
    ]

    /// Picker tree — the order and nesting shown in the relationship-type picker.
    /// Each top-level entry is a selectable type; a generic parent (e.g. `spouse`)
    /// carries its gendered / more-specific subtypes, which render indented beneath
    /// it. The user can select either the generic parent or any subtype. Stored
    /// values are always the canonical keys below.
    public static let pickerTree: [RelationshipPickerNode] = [
        RelationshipPickerNode(key: "spouse", subtypes: ["husband", "wife", "partner"]),
        RelationshipPickerNode(key: "parent", subtypes: ["mother", "father"]),
        RelationshipPickerNode(key: "stepparent", subtypes: ["stepmother", "stepfather"]),
        RelationshipPickerNode(key: "child", subtypes: ["son", "daughter"]),
        RelationshipPickerNode(key: "stepchild", subtypes: ["stepson", "stepdaughter"]),
        RelationshipPickerNode(key: "sibling", subtypes: ["brother", "sister"]),
        RelationshipPickerNode(key: "grandparent", subtypes: ["grandmother", "grandfather"]),
        RelationshipPickerNode(key: "grandchild", subtypes: ["grandson", "granddaughter"]),
        RelationshipPickerNode(key: "uncle"),
        RelationshipPickerNode(key: "aunt"),
        RelationshipPickerNode(key: "nephew"),
        RelationshipPickerNode(key: "niece"),
        RelationshipPickerNode(key: "cousin"),
        RelationshipPickerNode(key: "friend"),
        RelationshipPickerNode(key: "neighbor"),
        RelationshipPickerNode(key: "colleague"),
        RelationshipPickerNode(key: "manager"),
        RelationshipPickerNode(key: "assistant"),
    ]

    public static let customOptionValue = "__custom__"

    // Gendered relationship concepts: concept → { neutral, M, F }. `neutral` is ''
    // where no gender-neutral term exists (aunt/uncle, niece/nephew).
    public static let genderGroups: [String: RelationshipGenderGroup] = [
        "spouse": RelationshipGenderGroup(neutral: "spouse", male: "husband", female: "wife"),
        "parent": RelationshipGenderGroup(neutral: "parent", male: "father", female: "mother"),
        "stepparent": RelationshipGenderGroup(
            neutral: "stepparent", male: "stepfather", female: "stepmother"),
        "child": RelationshipGenderGroup(neutral: "child", male: "son", female: "daughter"),
        "stepchild": RelationshipGenderGroup(
            neutral: "stepchild", male: "stepson", female: "stepdaughter"),
        "sibling": RelationshipGenderGroup(neutral: "sibling", male: "brother", female: "sister"),
        "grandparent": RelationshipGenderGroup(
            neutral: "grandparent", male: "grandfather", female: "grandmother"),
        "grandchild": RelationshipGenderGroup(
            neutral: "grandchild", male: "grandson", female: "granddaughter"),
        "pibling": RelationshipGenderGroup(neutral: "", male: "uncle", female: "aunt"),
        "nibling": RelationshipGenderGroup(neutral: "", male: "nephew", female: "niece"),
    ]

    // Any gendered/neutral type → its gender-group concept key.
    public static let genderConcept: [String: String] = [
        "spouse": "spouse",
        "husband": "spouse",
        "wife": "spouse",
        "parent": "parent",
        "father": "parent",
        "mother": "parent",
        "stepparent": "stepparent",
        "stepfather": "stepparent",
        "stepmother": "stepparent",
        "child": "child",
        "son": "child",
        "daughter": "child",
        "stepchild": "stepchild",
        "stepson": "stepchild",
        "stepdaughter": "stepchild",
        "sibling": "sibling",
        "brother": "sibling",
        "sister": "sibling",
        "grandparent": "grandparent",
        "grandfather": "grandparent",
        "grandmother": "grandparent",
        "grandchild": "grandchild",
        "grandson": "grandchild",
        "granddaughter": "grandchild",
        "uncle": "pibling",
        "aunt": "pibling",
        "nephew": "nibling",
        "niece": "nibling",
    ]

    /// Indentation prefix (non-breaking spaces) used to nest subtype options.
    public static let pickerIndent = "\u{00A0}\u{00A0}\u{00A0}"

    // MARK: - Apple wrapper strip

    // JS: /^_\$!<(.+)>!\$_$/ — no /s flag, so `.` does not match newlines,
    // matching NSRegularExpression's default (dotMatchesLineSeparators off).
    private static let appleWrapperRegex = try! NSRegularExpression(pattern: "^_\\$!<(.+)>!\\$_$")

    private static func stripAppleWrapper(_ s: String) -> String {
        let range = NSRange(s.startIndex..., in: s)
        guard let match = appleWrapperRegex.firstMatch(in: s, range: range),
            let captureRange = Range(match.range(at: 1), in: s)
        else {
            return s
        }
        return String(s[captureRange])
    }

    // JS `t.charAt(0).toUpperCase() + t.slice(1)`.
    private static func cap(_ type: String) -> String {
        guard !type.isEmpty else { return "" }
        return type.prefix(1).uppercased() + type.dropFirst()
    }

    // MARK: - Public API

    /// Apple-wrapper strip + lowercase + alias resolution → canonical key.
    public static func normalize(_ label: String) -> String {
        let cleaned = stripAppleWrapper(label)
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return aliases[cleaned] ?? cleaned
    }

    /// Friendly display label, e.g. "Husband". Falls back to capitalized input.
    public static func label(_ type: String) -> String {
        if let entry = types[type] { return entry.label }
        return type.isEmpty ? "Related" : cap(type)
    }

    /// Apple X-ABLabel text for a relationship type. Known taxonomy types are
    /// wrapped in the `_$!<…>!$_` marker (Apple localizes them); a custom/unknown
    /// type is written PLAIN and verbatim — otherwise Apple Contacts shows the
    /// literal markers around the custom label.
    public static func vcardLabel(_ type: String) -> String {
        if let entry = types[type] {
            return "_$!<\(entry.vcardLabel ?? entry.label)>!$_"
        }
        return type.isEmpty ? "Related" : type
    }

    /// Edge category: family | friend | work | neighbor | other.
    public static func category(_ type: String) -> String {
        types[type]?.category ?? "other"
    }

    /// Canonical (generic) reciprocal type; returns input unchanged if unknown.
    public static func reciprocal(_ type: String) -> String {
        types[type]?.reciprocal ?? type
    }

    /// Resolve `type` to the gendered variant for the given gender ('M'|'F'|'').
    /// Unknown gender → the neutral term if one exists, else the input unchanged.
    public static func gendered(_ type: String, _ gender: String) -> String {
        guard let concept = genderConcept[type], let group = genderGroups[concept] else {
            return type
        }
        if gender == "M", !group.male.isEmpty { return group.male }
        if gender == "F", !group.female.isEmpty { return group.female }
        return group.neutral.isEmpty ? type : group.neutral
    }

    /// The reciprocal of `type`, gendered by the gender of whoever will hold the
    /// reciprocal role (i.e. the contact). Unknown gender → the neutral reciprocal
    /// where one exists, otherwise the canonical reciprocal (e.g. niece → aunt).
    public static func genderedReciprocal(_ type: String, _ gender: String = "") -> String {
        gendered(reciprocal(type), gender)
    }

    public static func isKnown(_ type: String) -> Bool {
        types[type.lowercased()] != nil
    }

    public static func isValidReciprocal(_ typeA: String, _ typeB: String) -> Bool {
        for (a, b) in validReciprocalPairs {
            if (typeA == a && typeB == b) || (typeA == b && typeB == a) { return true }
        }
        return false
    }

    /// True when `candidate` (a generic) is less specific than the existing type.
    public static func isReciprocalDowngrade(_ candidate: String, _ existing: String) -> Bool {
        types[existing]?.generic == candidate
    }

    /// Flat, ordered picker options derived from `pickerTree`.
    /// Each option's `depth` is 1 when it's an indented subtype.
    /// Shared by `optionsHtml(_:includeCustom:)` (native <select>) and the
    /// searchable combobox.
    public static func pickerOptions() -> [RelationshipPickerOption] {
        var opts: [RelationshipPickerOption] = []
        for node in pickerTree {
            opts.append(RelationshipPickerOption(value: node.key, label: label(node.key), depth: 0))
            for sub in node.subtypes {
                opts.append(RelationshipPickerOption(value: sub, label: label(sub), depth: 1))
            }
        }
        return opts
    }

    /// Flat <option> HTML for the relationship-type picker. Subtypes are indented
    /// under their generic parent (no <optgroup>). Pass includeCustom=false to omit
    /// the "Custom…" escape hatch (e.g. for pickers that must yield a known type).
    public static func optionsHtml(_ selectedType: String, includeCustom: Bool = true) -> String {
        var html = ""
        var selectable: [String] = []
        for opt in pickerOptions() {
            selectable.append(opt.value)
            let text = opt.depth > 0 ? pickerIndent + opt.label : opt.label
            html += "<option value=\"\(opt.value)\""
            html += opt.value == selectedType ? " selected" : ""
            html += ">\(text)</option>"
        }
        if includeCustom {
            let isUnknown = !selectedType.isEmpty && !selectable.contains(selectedType)
            html += "<option value=\"\(customOptionValue)\""
            html += isUnknown ? " selected" : ""
            html += ">Custom…</option>"
        }
        return html
    }
}
