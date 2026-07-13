/// Palette — the category color scheme for graph nodes/edges/legend and
/// contact-list dots.
///
/// This mirrors `js/palette.js`, where `Palette` reads the category colors
/// from the CSS `:root` custom properties (`css/styles.css`) so the
/// stylesheet is the single source of truth in the web app. This target is
/// UI-framework-free (no AppKit/SwiftUI, no CSSOM to read), so instead of
/// re-reading a stylesheet at runtime, the resolved values are captured here
/// as the same hex strings the CSS `:root` block defines. If the CSS values
/// change, update both `css/styles.css` and this file together.
///
/// Every lookup that doesn't recognize its key falls back the same way the
/// JS does: an unknown category name yields `neutral`; an unknown category
/// passed to `node(_:)` yields `nodeDefault`. There is no hash-based color
/// assignment in the source — unmapped names always resolve to the same
/// fallback constant.
public enum Palette {
    /// JS: `Palette.NEUTRAL`. Used whenever a category name isn't recognized.
    public static let neutral = "#8395a7"

    /// JS: the `category` map inside `Palette._read()`, keyed by the same
    /// category names used throughout the app (family, friend, work, …).
    public static let categoryColors: [String: String] = [
        "family": "#e17055",
        "friend": "#00b894",
        "mitre": "#0984e3",
        "work": "#74b9ff",
        "neighbor": "#fdcb6e",
        "church": "#a29bfe",
        "school": "#fd79a8",
        "medical": "#55efc4",
        "company": "#8e44ad",
        "virtual": "#b2bec3",
        "other": "#8395a7",
    ]

    /// JS: `Palette.nodeDefault` getter. Graph node fill for plain contacts.
    public static let nodeDefault = "#dfe6e9"

    /// JS: `Palette.group` getter. Cluster / location group node fill.
    public static let group = "#8e9aaf"

    /// JS: `Palette.selected` getter. Selected-node ring color.
    public static let selected = "#ffd32a"

    /// JS: `Palette.inferred` getter. Inferred org-cluster link color.
    public static let inferred = "#aaa"

    /// Color for a named category (family, work, …); `neutral` if unknown.
    ///
    /// JS: `static category(name)`.
    public static func category(_ name: String) -> String {
        categoryColors[name] ?? neutral
    }

    /// Graph node fill for a category, falling back to `nodeDefault` if the
    /// category isn't recognized.
    ///
    /// JS: `static node(category)`.
    public static func node(_ category: String) -> String {
        categoryColors[category] ?? nodeDefault
    }
}
