// ThemeSupport — the small pile of appearance helpers the SwiftUI shell needs:
// a theme override enum (System / Light / Dark) applied via `.preferredColorScheme`,
// a hex→Color bridge for the shared `Palette` values, and the contact-list tag /
// category colors.
//
// Colors are a port of the web app's list-row coloring:
//   • system category colors come from `Palette` (js/palette.js, sourced from the
//     CSS `:root` variables) — see `ConstellationGraphModel.Palette`.
//   • user hashtags get a stable HSL color from the same hash the JS uses
//     (js/app-sidebar.js `_tagColor`).
//   • the primary list-dot color is the first color of the JS-ordered filter-tag
//     list (js/app-sidebar.js `_contactListColors`, preferred order
//     family → company → virtual → other, then alphabetical).

import ConstellationGraphModel
import ConstellationStore
import SwiftUI

/// Re-export of the canonical override type: `ThemeOverride` is declared in
/// `ConstellationStore` (it is persisted in `SessionSettings`); the UI layer
/// adds only the SwiftUI-facing derivations below.
public typealias ThemeOverride = ConstellationStore.ThemeOverride

extension ThemeOverride {
    /// The `ColorScheme` to feed `.preferredColorScheme`; `nil` means "follow the
    /// system", the SwiftUI no-override value.
    public var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    /// Menu label.
    public var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }
}

extension Color {
    /// Parse a CSS-style hex string (`#rgb` or `#rrggbb`, `#` optional) the same
    /// way `js/app-sidebar.js` `_colorToRgb` normalizes it. Falls back to the
    /// palette neutral gray on a malformed value.
    public init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        // Expand shorthand #rgb → #rrggbb (JS `ch + ch`).
        if s.count == 3 {
            s = s.map { "\($0)\($0)" }.joined()
        }
        // Pad/truncate to 6 hex digits (JS `padEnd(6,'0').slice(0,6)`).
        if s.count < 6 { s = s.padding(toLength: 6, withPad: "0", startingAt: 0) }
        else if s.count > 6 { s = String(s.prefix(6)) }

        let scanner = Scanner(string: s)
        var value: UInt64 = 0
        if scanner.scanHexInt64(&value) {
            let r = Double((value >> 16) & 0xFF) / 255.0
            let g = Double((value >> 8) & 0xFF) / 255.0
            let b = Double(value & 0xFF) / 255.0
            self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
        } else {
            // JS `Palette.NEUTRAL` (#8395a7).
            self.init(.sRGB, red: 131 / 255, green: 149 / 255, blue: 167 / 255, opacity: 1)
        }
    }
}

public enum ContactColors {
    /// Order the system filter tags render in (js/app-sidebar.js
    /// `_contactListColors` `preferredOrder`); anything else sorts after them.
    private static let preferredOrder = ["family", "company", "virtual", "other"]

    /// Color for one filter tag — mirror of js/app-sidebar.js `_tagColor`: the four
    /// system tags use the shared `Palette`; user hashtags get a stable HSL color
    /// from the JS char-code hash.
    public static func tagColor(_ tag: String) -> Color {
        if preferredOrder.contains(tag) {
            return Color(hex: Palette.category(tag))
        }
        // Stable hashtag color (js/app-sidebar.js `_tagColor`, HSL).
        var hash: UInt32 = 0
        for unit in tag.utf16 {
            hash = (hash &* 31) &+ UInt32(unit)  // UInt32 overflow == JS `>>> 0`
        }
        let hue = Double(hash % 360)
        let sat = Double(58 + (hash % 14)) / 100.0
        let light = Double(58 + ((hash >> 3) % 10)) / 100.0
        return hsl(hue: hue, saturation: sat, lightness: light)
    }

    /// Primary contact-list dot color: the first color of the JS-ordered filter-tag
    /// list (js/app-sidebar.js `_contactListColors`), or the neutral gray when a
    /// node carries no tags.
    public static func primaryColor(filterTags: [String]) -> Color {
        let unique = Array(Set(filterTags))
        let sorted = unique.sorted { a, b in
            let ai = preferredOrder.firstIndex(of: a)
            let bi = preferredOrder.firstIndex(of: b)
            if ai != nil || bi != nil {
                return (ai ?? 999) < (bi ?? 999)
            }
            return a < b
        }
        guard let first = sorted.first else { return Color(hex: Palette.neutral) }
        return tagColor(first)
    }

    /// HSL → Color (SwiftUI has only HSB), matching js/app-sidebar.js `_colorToRgb`.
    private static func hsl(hue: Double, saturation s: Double, lightness l: Double) -> Color {
        let c = (1 - abs(2 * l - 1)) * s
        let hp = hue / 60
        let x = c * (1 - abs(hp.truncatingRemainder(dividingBy: 2) - 1))
        let m = l - c / 2
        var r = 0.0, g = 0.0, b = 0.0
        switch hue {
        case ..<60: (r, g, b) = (c, x, 0)
        case ..<120: (r, g, b) = (x, c, 0)
        case ..<180: (r, g, b) = (0, c, x)
        case ..<240: (r, g, b) = (0, x, c)
        case ..<300: (r, g, b) = (x, 0, c)
        default: (r, g, b) = (c, 0, x)
        }
        return Color(.sRGB, red: r + m, green: g + m, blue: b + m, opacity: 1)
    }

    /// Up-to-two-letter initials for the avatar fallback (first letters of the
    /// first two whitespace-separated words).
    public static func initials(for name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace })
        let letters = words.prefix(2).compactMap { $0.first }
        let joined = String(letters).uppercased()
        return joined.isEmpty ? "?" : joined
    }
}

/// Decode a `data:<mime>;base64,<payload>` URL (the photo representation the
/// Markdown adapter and vCard parser produce) into a SwiftUI `Image`. Returns
/// `nil` for a non-data-URL or undecodable payload.
func imageFromDataURL(_ dataURL: String?) -> Image? {
    guard let dataURL, dataURL.hasPrefix("data:"),
        let comma = dataURL.firstIndex(of: ",")
    else { return nil }
    let payload = String(dataURL[dataURL.index(after: comma)...])
    guard dataURL[..<comma].contains(";base64"),
        let data = Data(base64Encoded: payload),
        let nsImage = NSImage(data: data)
    else { return nil }
    return Image(nsImage: nsImage)
}
