// GraphCanvasView — the SwiftUI graph renderer. A `Canvas` inside
// `TimelineView(.animation(paused: !renderState.isHot))` draws the graph in
// world space (the context is translated/scaled by the pan/zoom transform, so
// labels and stroke widths scale with zoom exactly like the web app's SVG
// `zoomG`). A transparent `GraphInputView` (AppKit) overlays it for wheel /
// pinch / click / drag.
//
// Draw order (spec §15): hulls → hull labels → edges (+ edge labels) → nodes →
// name labels — a port of js/graph.js's group stacking (l.166-171) and tick
// handler (l.581-625).
//
// Perf: edges are batched into one `Path` per style class (color/width/dash/dim)
// and stroked once; resolved `Text` and decoded photo `CGImage`s are cached
// across frames in `GraphDrawCache`; off-screen nodes/edges/labels are culled.

import ConstellationGraphModel
import ConstellationStore
import CoreGraphics
import ImageIO
import SwiftUI

// MARK: - Public view

/// The graph workspace: renderer + input overlay + a small control strip.
public struct GraphCanvasView: View {
    @Bindable var store: AppStore
    @Environment(\.colorScheme) private var colorScheme
    @State private var renderState = GraphRenderState()
    @State private var cache = GraphDrawCache()

    public init(store: AppStore) {
        self.store = store
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack {
                GraphTheme(colorScheme).backgroundGradient
                    .ignoresSafeArea()

                TimelineView(.animation(paused: !renderState.isHot)) { _ in
                    // Advance the sim / transform animation once per frame, then
                    // draw the resulting state.
                    let _ = renderState.advanceFrame()
                    GraphScene(renderState: renderState, cache: cache, scheme: colorScheme)
                }

                GraphInputView(renderState: renderState, store: store)
            }
            .onAppear {
                cache.reset(dark: colorScheme != .light)
                renderState.rebuild(graphModel: store.graphModel, size: geo.size)
            }
            .onChange(of: geo.size) { _, newSize in
                renderState.setSize(newSize)
            }
            .onChange(of: store.graphModel) { _, newModel in
                renderState.rebuild(graphModel: newModel, size: geo.size)
            }
            .onChange(of: colorScheme) { _, newScheme in
                cache.reset(dark: newScheme != .light)
            }
            .onChange(of: store.selectedContactID) { _, newID in
                // Sidebar (or any external) selection: sync dimming and animate a
                // zoom-to-node. Canvas-originated selection already set
                // `renderState.selectedID`, so this is a no-op for those.
                if newID != renderState.selectedID {
                    renderState.selectedID = newID
                    if let newID { renderState.zoomToNode(newID) }
                }
            }
            .overlay(alignment: .bottomTrailing) {
                GraphControlStrip(renderState: renderState)
                    .padding(12)
            }
        }
    }
}

// MARK: - Control strip (zoom / fit / reset / relayout — app.js:255-267)

private struct GraphControlStrip: View {
    let renderState: GraphRenderState

    var body: some View {
        HStack(spacing: 6) {
            button("minus.magnifyingglass") { renderState.zoomButton(1 / GraphConstants.zoomButtonFactor) }
            button("plus.magnifyingglass") { renderState.zoomButton(GraphConstants.zoomButtonFactor) }
            button("arrow.up.left.and.arrow.down.right") { renderState.fitView() }
            button("arrow.counterclockwise") { renderState.resetView() }
            button("wand.and.stars") { renderState.relayout() }
        }
        .padding(6)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
    }

    private func button(_ system: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system).frame(width: 22, height: 22)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - The Canvas scene (shared by the live view and the offscreen snapshot)

struct GraphScene: View {
    let renderState: GraphRenderState
    let cache: GraphDrawCache
    let scheme: ColorScheme

    var body: some View {
        // Reading photoVersion here re-renders when a photo finishes decoding.
        let _ = renderState.photoVersion
        Canvas(rendersAsynchronously: false) { context, size in
            draw(context: &context, size: size)
        }
    }

    private func draw(context: inout GraphicsContext, size: CGSize) {
        let theme = GraphTheme(scheme)
        let rs = renderState
        let scale = rs.scale

        // Apply the pan/zoom transform: everything below is in world coords.
        context.translateBy(x: rs.tx, y: rs.ty)
        context.scaleBy(x: scale, y: scale)

        // World-space visible rect (+padding) for culling.
        let topLeft = rs.viewToWorld(.zero)
        let bottomRight = rs.viewToWorld(CGPoint(x: size.width, y: size.height))
        let pad: CGFloat = 60
        let visible = CGRect(
            x: topLeft.x - pad, y: topLeft.y - pad,
            width: (bottomRight.x - topLeft.x) + pad * 2,
            height: (bottomRight.y - topLeft.y) + pad * 2)

        let nodeByID = Dictionary(rs.nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let positions = rs.positions
        let selected = rs.selectedID
        let connected = selected.map { rs.connectedSet(to: $0) }
        let labelsOn = rs.labelsVisible

        drawHulls(&context, theme: theme, nodeByID: nodeByID, positions: positions, connected: connected)
        if labelsOn {
            drawHullLabels(&context, theme: theme, nodeByID: nodeByID, positions: positions, scale: scale)
        }
        drawEdges(&context, theme: theme, positions: positions, selected: selected, visible: visible)
        if labelsOn {
            drawEdgeLabels(&context, theme: theme, positions: positions, selected: selected, visible: visible)
        }
        drawNodes(
            &context, theme: theme, positions: positions, selected: selected,
            connected: connected, scale: scale, visible: visible)
        if labelsOn {
            drawNameLabels(
                &context, theme: theme, positions: positions, connected: connected,
                visible: visible)
        }
    }

    // MARK: Hulls (js/graph.js:388-408, 958-975)

    private func drawHulls(
        _ context: inout GraphicsContext, theme: GraphTheme,
        nodeByID: [String: GraphNode], positions: [String: CGPoint], connected: Set<String>?
    ) {
        for hull in renderState.hulls {
            var pts: [CGPoint] = []
            var radii: [CGFloat] = []
            for id in hull.memberIds {
                guard let n = nodeByID[id], let p = positions[id],
                    p.x.isFinite, p.y.isFinite
                else { continue }
                pts.append(p)
                radii.append(GraphRenderState.radius(of: n))
            }
            guard let polygon = HullGeometry.hullPath(memberPositions: pts, radii: radii) else {
                continue
            }
            var path = Path()
            path.move(to: polygon[0])
            for v in polygon.dropFirst() { path.addLine(to: v) }
            path.closeSubpath()

            let base = hullOpacity(hull)
            // Selection dim (js:698-702): hulls touching the connected set stay
            // bright, others fade to 0.2.
            let dim: CGFloat =
                connected.map { c in hull.memberIds.contains(where: c.contains) ? 1 : 0.2 } ?? 1
            let color = Color(hex: hull.color)
            context.fill(path, with: .color(color.opacity(base * dim)))
            context.stroke(
                path, with: .color(color.opacity(min(base + 0.08, 0.28) * dim)),
                lineWidth: 1.5)
        }
    }

    /// js/graph.js:950-956 `_hullOpacity`.
    private func hullOpacity(_ h: GraphHull) -> CGFloat {
        if h.kind.hasPrefix("geo-") {
            let depth = max(1, h.depth)
            return max(0.04, 0.1 - CGFloat(depth - 1) * 0.015)
        }
        return 0.12
    }

    // MARK: Hull labels (js/graph.js:410-425, 977-1026)

    private func drawHullLabels(
        _ context: inout GraphicsContext, theme: GraphTheme,
        nodeByID: [String: GraphNode], positions: [String: CGPoint], scale: CGFloat
    ) {
        let scaleFactor = HullGeometry.hullLabelScaleFactor(zoomScale: scale)
        for hull in renderState.hulls {
            guard !hull.label.isEmpty else { continue }
            var pts: [CGPoint] = []
            var radii: [CGFloat] = []
            var memberCount = 0
            for id in hull.memberIds {
                guard let n = nodeByID[id], let p = positions[id],
                    p.x.isFinite, p.y.isFinite
                else { continue }
                memberCount += 1
                pts.append(p)
                radii.append(
                    HullGeometry.hullLabelBoundsRadius(
                        isGroupNode: n.isGroupNode, groupDepth: n.groupDepth,
                        isCompany: n.isCompany, isVirtual: n.isVirtual,
                        connectionCount: n.connectionCount))
            }
            let opacity = HullGeometry.hullLabelOpacity(memberCount: memberCount, hasLabel: true)
            guard opacity > 0,
                let anchor = HullGeometry.hullLabelAnchor(
                    memberPositions: pts, boundsRadii: radii, zoomScale: scale)
            else { continue }

            // Font size is 11 user-units, scaled by the label's own factor; the
            // world→view zoom then scales it again, matching the SVG transform.
            let fontSize = 11 * scaleFactor
            let text = Text(hull.label.uppercased())
                .font(.system(size: fontSize, weight: .heavy))
            var layer = context
            layer.opacity = opacity
            layer.addFilter(.shadow(color: theme.hullLabelHalo, radius: 1.5 * scaleFactor))
            layer.draw(
                layer.resolve(text.foregroundColor(theme.hullLabelFill(kind: hull.kind))),
                at: anchor, anchor: .center)
        }
    }

    // MARK: Edges (batched by style class — js/graph.js:433-477, 937-948)

    private struct EdgeStyleKey: Hashable {
        let category: String
        let width: CGFloat
        let dash: [CGFloat]
        let dim: CGFloat
    }

    private func drawEdges(
        _ context: inout GraphicsContext, theme: GraphTheme,
        positions: [String: CGPoint], selected: String?, visible: CGRect
    ) {
        var batches: [EdgeStyleKey: Path] = [:]
        for e in renderState.edges {
            guard let s = positions[e.source], let t = positions[e.target] else { continue }
            if !segmentIntersects(visible, s, t) { continue }
            let dim: CGFloat =
                selected.map { (e.source == $0 || e.target == $0) ? 1 : 0.05 } ?? 1
            let key = EdgeStyleKey(
                category: e.category, width: edgeWidth(e), dash: edgeDash(e), dim: dim)
            batches[key, default: Path()].appendLine(s, t)
        }
        for (key, path) in batches {
            let color = theme.edgeColor(key.category).opacity(0.5 * key.dim)
            context.stroke(
                path, with: .color(color),
                style: StrokeStyle(lineWidth: key.width, dash: key.dash))
        }
    }

    /// js/graph.js:937-942 `_edgeWidth`.
    private func edgeWidth(_ e: GraphEdge) -> CGFloat {
        switch e.edgeKind {
        case "geographic-hierarchy": return 2.2
        case "geographic-membership": return 1.6
        case "likely-surname", "likely-tag", "likely-family": return 1.4
        default: return e.inferred ? 1 : 2
        }
    }

    /// js/graph.js:944-948 `_edgeDashArray`.
    private func edgeDash(_ e: GraphEdge) -> [CGFloat] {
        switch e.edgeKind {
        case "likely-surname", "likely-tag", "likely-family": return [6, 4]
        case "geographic-membership": return [2, 2]
        default: return e.inferred ? [4, 3] : []
        }
    }

    // MARK: Edge labels (js/graph.js:442-457, 595-609)

    private func drawEdgeLabels(
        _ context: inout GraphicsContext, theme: GraphTheme,
        positions: [String: CGPoint], selected: String?, visible: CGRect
    ) {
        for e in renderState.edges {
            guard let s = positions[e.source], let t = positions[e.target] else { continue }
            if !segmentIntersects(visible, s, t) { continue }
            let dim: CGFloat =
                selected.map { (e.source == $0 || e.target == $0) ? 1 : 0.05 } ?? 1
            let hasDual = (e.reverseLabel != nil) && (e.reverseLabel != e.label)
            // Source-side label: hidden for inferred edges (js:449).
            if !e.inferred, !e.label.isEmpty {
                let f: CGFloat = hasDual ? 0.32 : 0.5
                let p = CGPoint(x: s.x + f * (t.x - s.x), y: s.y + f * (t.y - s.y))
                drawEdgeLabel(&context, cache: cache, text: e.label, at: p, color: theme.edgeLabel, dim: dim)
            }
            // Target-side label: only when the reverse label differs (js:457).
            if hasDual, let rev = e.reverseLabel, !rev.isEmpty {
                let p = CGPoint(x: s.x + 0.68 * (t.x - s.x), y: s.y + 0.68 * (t.y - s.y))
                drawEdgeLabel(&context, cache: cache, text: rev, at: p, color: theme.edgeLabel, dim: dim)
            }
        }
    }

    private func drawEdgeLabel(
        _ context: inout GraphicsContext, cache: GraphDrawCache, text: String,
        at p: CGPoint, color: Color, dim: CGFloat
    ) {
        let resolved = cache.resolvedText(
            &context, text, size: 9, weight: .regular, color: color,
            role: .edge, dark: scheme != .light)
        var layer = context
        layer.opacity = dim
        layer.draw(resolved, at: CGPoint(x: p.x, y: p.y - 4), anchor: .center)
    }

    // MARK: Nodes (js/graph.js:479-531, 822-935)

    private func drawNodes(
        _ context: inout GraphicsContext, theme: GraphTheme,
        positions: [String: CGPoint], selected: String?, connected: Set<String>?,
        scale: CGFloat, visible: CGRect
    ) {
        let dark = scheme != .light
        for n in renderState.nodes {
            guard let p = positions[n.id] else { continue }
            if !visible.contains(p) { continue }
            let r = GraphRenderState.radius(of: n)
            let isSel = n.id == selected
            // Selection dimming (js:687): non-connected nodes fade to 0.15.
            let dim: CGFloat = connected.map { $0.contains(n.id) ? 1 : 0.15 } ?? 1
            let square = n.isCompany && !n.isGroupNode

            // Selection ring (js:834-848): drawn behind the shape at r+5.
            if isSel {
                let ring = shapePath(center: p, r: r + 5, square: square)
                context.stroke(
                    ring, with: .color(theme.selectedRing.opacity(dim)), lineWidth: 2)
            }

            // Main shape.
            let shape = shapePath(center: p, r: r, square: square)
            let fillOpacity: CGFloat = (n.isVirtual ? 0.45 : 1) * dim
            context.fill(shape, with: .color(theme.nodeFill(n, selected: isSel).opacity(fillOpacity)))
            let strokeWidth: CGFloat = n.isGroupNode ? 2 : (n.isVirtual ? 2 : 1.5)
            let dash: [CGFloat] = n.isGroupNode ? [5, 3] : (n.isVirtual ? [3, 2] : [])
            context.stroke(
                shape, with: .color(theme.nodeStroke(n, selected: isSel).opacity(dim)),
                style: StrokeStyle(lineWidth: strokeWidth, dash: dash))

            // Content (photo / glyph / initials) only when legible on screen.
            guard r * scale >= 7 else { continue }
            drawNodeContent(&context, node: n, at: p, r: r, square: square, dim: dim, dark: dark)
        }
    }

    private func drawNodeContent(
        _ context: inout GraphicsContext, node n: GraphNode, at p: CGPoint,
        r: CGFloat, square: Bool, dim: CGFloat, dark: Bool
    ) {
        let rect = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
        if let dataURL = n.photo,
            let cg = cache.image(forContact: n.id, dataURL: dataURL, notify: renderState)
        {
            var layer = context
            layer.opacity = dim
            layer.clip(to: shapePath(center: p, r: r, square: square))
            layer.draw(Image(decorative: cg, scale: 1), in: rect)
            return
        }
        if n.isGroupNode {
            drawGlyph(
                &context, groupGlyph(n), at: p, size: max(11, r * 0.62),
                color: .white, dim: dim, role: .glyph, dark: dark)
        } else if n.isCompany {
            drawGlyph(
                &context, "🏢", at: p, size: r * 0.9, color: .white, dim: dim,
                role: .company, dark: dark)
        } else {
            drawGlyph(
                &context, initials(n.name), at: p, size: max(7, r * 0.55),
                color: Color(.sRGB, white: 1, opacity: 0.85), dim: dim,
                role: .initials, dark: dark, weight: .semibold)
        }
    }

    private func drawGlyph(
        _ context: inout GraphicsContext, _ s: String, at p: CGPoint, size: CGFloat,
        color: Color, dim: CGFloat, role: GraphDrawCache.Role, dark: Bool,
        weight: Font.Weight = .regular
    ) {
        let resolved = cache.resolvedText(
            &context, s, size: size, weight: weight, color: color, role: role, dark: dark)
        var layer = context
        layer.opacity = dim
        layer.draw(resolved, at: p, anchor: .center)
    }

    // MARK: Name labels (js/graph.js:534-547)

    private func drawNameLabels(
        _ context: inout GraphicsContext, theme: GraphTheme,
        positions: [String: CGPoint], connected: Set<String>?, visible: CGRect
    ) {
        let dark = scheme != .light
        for n in renderState.nodes {
            guard !n.name.isEmpty, let p = positions[n.id] else { continue }
            if !visible.contains(p) { continue }
            let r = GraphRenderState.radius(of: n)
            // Selection dimming (js:697): non-connected labels fade to 0.1.
            let dim: CGFloat = connected.map { $0.contains(n.id) ? 1 : 0.1 } ?? 1
            let resolved = cache.resolvedText(
                &context, n.name, size: 11, weight: .medium, color: theme.nameLabel,
                role: .name, dark: dark)
            var layer = context
            layer.opacity = dim
            layer.draw(resolved, at: CGPoint(x: p.x, y: p.y + r + 14), anchor: .center)
        }
    }

    // MARK: Shape / glyph helpers

    private func shapePath(center p: CGPoint, r: CGFloat, square: Bool) -> Path {
        let rect = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
        // js:832 `corner = rad * 0.32`.
        return square ? Path(roundedRect: rect, cornerRadius: r * 0.32) : Path(ellipseIn: rect)
    }

    /// js/graph.js:1028-1033 `_groupGlyph`.
    private func groupGlyph(_ n: GraphNode) -> String {
        let kind = n.groupKind ?? ""
        if kind.hasPrefix("geo-") { return "◎" }
        if kind == "likely-surname" { return "≈" }
        if kind == "likely-tag" { return "#" }
        return "◌"
    }

    /// js/graph.js:1035-1040 `_initials`.
    private func initials(_ name: String) -> String {
        let parts = name.split(whereSeparator: { $0.isWhitespace })
        guard let first = parts.first else { return "?" }
        if parts.count == 1 { return String(first.prefix(1)).uppercased() }
        let last = parts[parts.count - 1]
        return (String(first.prefix(1)) + String(last.prefix(1))).uppercased()
    }
}

// MARK: - Geometry helpers

private extension Path {
    mutating func appendLine(_ a: CGPoint, _ b: CGPoint) {
        move(to: a)
        addLine(to: b)
    }
}

/// Cheap conservative test: does the segment's bounding box meet the rect?
private func segmentIntersects(_ rect: CGRect, _ a: CGPoint, _ b: CGPoint) -> Bool {
    let segRect = CGRect(
        x: min(a.x, b.x), y: min(a.y, b.y),
        width: abs(a.x - b.x), height: abs(a.y - b.y))
    return rect.intersects(segRect)
}

// MARK: - Draw cache (resolved Text + decoded photos, kept across frames)

@MainActor
final class GraphDrawCache {
    enum Role: Int { case name, edge, initials, glyph, company, hull }

    private struct TextKey: Hashable {
        let s: String
        let size: Int
        let role: Int
        let dark: Bool
    }

    private var texts: [TextKey: GraphicsContext.ResolvedText] = [:]
    private(set) var images: [String: CGImage] = [:]
    private var inFlight: Set<String> = []

    /// Clear caches on a theme change (label colors flip).
    func reset(dark: Bool) {
        texts.removeAll(keepingCapacity: true)
    }

    /// Decode every node photo synchronously (offscreen snapshot path only).
    func preloadPhotos(_ nodes: [GraphNode]) {
        for n in nodes {
            guard let url = n.photo, images[n.id] == nil else { continue }
            if let cg = decodeCGImage(fromDataURL: url) { images[n.id] = cg }
        }
    }

    func resolvedText(
        _ context: inout GraphicsContext, _ s: String, size: CGFloat, weight: Font.Weight,
        color: Color, role: Role, dark: Bool
    ) -> GraphicsContext.ResolvedText {
        let key = TextKey(s: s, size: Int(size.rounded()), role: role.rawValue, dark: dark)
        if let cached = texts[key] { return cached }
        let resolved = context.resolve(
            Text(s).font(.system(size: size, weight: weight)).foregroundColor(color))
        texts[key] = resolved
        return resolved
    }

    /// Return a decoded photo, kicking off an off-main decode the first time.
    func image(forContact id: String, dataURL: String?, notify: GraphRenderState) -> CGImage? {
        if let img = images[id] { return img }
        guard let dataURL, !inFlight.contains(id) else { return nil }
        inFlight.insert(id)
        Task.detached(priority: .utility) {
            let decoded = decodeCGImage(fromDataURL: dataURL)
            await MainActor.run {
                if let decoded { self.images[id] = decoded }
                self.inFlight.remove(id)
                notify.bumpPhotoVersion()
            }
        }
        return nil
    }
}

/// Decode a `data:<mime>;base64,<payload>` URL to a `CGImage` off the main
/// actor (nonisolated, thread-safe via ImageIO).
nonisolated func decodeCGImage(fromDataURL dataURL: String) -> CGImage? {
    guard dataURL.hasPrefix("data:"), let comma = dataURL.firstIndex(of: ","),
        dataURL[..<comma].contains(";base64")
    else { return nil }
    let payload = String(dataURL[dataURL.index(after: comma)...])
    guard let data = Data(base64Encoded: payload),
        let source = CGImageSourceCreateWithData(data as CFData, nil),
        let cg = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { return nil }
    return cg
}
