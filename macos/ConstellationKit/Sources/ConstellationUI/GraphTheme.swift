// GraphTheme — resolves the graph's node/edge/hull/label colors for the current
// appearance. Category colors are the theme-independent `--cat-*` tokens shared
// with the web app via `Palette`; the handful of graph tokens the stylesheet
// overrides in light mode (`css/styles.css` `:root[data-theme='light']`) are
// applied here per `@Environment(\.colorScheme)`.
//
// Concrete values extracted from css/styles.css:
//   --cat-node-default  dark #dfe6e9 (l.58)  / light #8d99ad (l.108)
//   --cat-group         #8e9aaf (l.59, both)
//   --cat-selected      dark #ffd32a (l.60)  / light #f0a020 (l.111)
//   --cat-virtual       dark #b2bec3 (l.56)  / light #9aa6ad (l.109)
//   --cat-edge-inferred dark #aaa    (l.61)  / light #9aa0ab (l.110)
//   --graph-label       dark #d6d6e0 (l.62)  / light #2c3242 (l.112)
//   --graph-edge-label  dark #c4c4d0 (l.63)  / light #707890 (l.113)
//   --surface-graph     dark #12122a→#0a0a14 / light #f8fafe→#e8edf6 (l.68/116)
//   node stroke         #1a1a2e (JS-hardcoded, js/graph.js:931; both themes)
//   .hull-label fills   theme-independent rgba (css l.1146-1174)

import ConstellationGraphModel
import SwiftUI

struct GraphTheme {
    let isDark: Bool

    init(_ scheme: ColorScheme) { isDark = scheme != .light }

    // MARK: - Node fill (js/graph.js:807-811 `_nodeColor`)

    func nodeFill(_ node: GraphNode, selected: Bool) -> Color {
        if selected { return selectedRing }
        if node.isGroupNode { return Color(hex: Palette.group) }
        switch node.category {
        case "company": return Color(hex: Palette.category("company"))
        case "virtual": return Color(hex: isDark ? "#b2bec3" : "#9aa6ad")
        default: return Color(hex: isDark ? Palette.nodeDefault : "#8d99ad")
        }
    }

    /// js/graph.js:931 — virtual nodes outline in their own color; everything
    /// else uses the dark ink stroke.
    func nodeStroke(_ node: GraphNode, selected: Bool) -> Color {
        node.isVirtual ? nodeFill(node, selected: selected) : Color(hex: "#1a1a2e")
    }

    var selectedRing: Color { Color(hex: isDark ? "#ffd32a" : "#f0a020") }

    // MARK: - Edge color (js/graph.js:103-105 / _colorScheme.edge)

    func edgeColor(_ category: String) -> Color {
        switch category {
        case "family", "friend", "work", "neighbor":
            return Color(hex: Palette.category(category))
        default:
            // `edge.other` maps to the company color in _buildColorScheme.
            return Color(hex: Palette.category("company"))
        }
    }

    // MARK: - Labels

    var nameLabel: Color { Color(hex: isDark ? "#d6d6e0" : "#2c3242") }
    var edgeLabel: Color { Color(hex: isDark ? "#c4c4d0" : "#707890") }

    /// css `.hull-label` fills (theme-independent rgba, by `hull-label-<kind>`).
    func hullLabelFill(kind: String) -> Color {
        if kind.hasPrefix("geo-") {
            return Color(.sRGB, red: 226 / 255, green: 232 / 255, blue: 1, opacity: 0.94)
        }
        switch kind {
        case "likely-surname":
            return Color(.sRGB, red: 1, green: 233 / 255, blue: 224 / 255, opacity: 0.96)
        case "likely-tag":
            return Color(.sRGB, red: 214 / 255, green: 236 / 255, blue: 1, opacity: 0.96)
        case "organization":
            return Color(.sRGB, red: 214 / 255, green: 1, blue: 240 / 255, opacity: 0.96)
        default:
            return Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.92)
        }
    }

    /// css `.hull-label` halo: paint-order stroke rgba(15,15,26,0.88), width 5.
    var hullLabelHalo: Color { Color(.sRGB, red: 15 / 255, green: 15 / 255, blue: 26 / 255, opacity: 0.88) }

    // MARK: - Background (css `--surface-graph` radial gradient)

    var backgroundGradient: RadialGradient {
        let stops: [Color] =
            isDark
            ? [Color(hex: "#12122a"), Color(hex: "#0a0a14")]
            : [Color(hex: "#f8fafe"), Color(hex: "#e8edf6")]
        return RadialGradient(
            colors: stops, center: .center, startRadius: 0, endRadius: 900)
    }
}
