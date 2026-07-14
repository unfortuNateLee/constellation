// GraphRenderState — the @MainActor render/interaction model behind the native
// graph view. Owns the physics engine (ConstellationGraphModel.GraphPhysics),
// a per-id position/velocity cache (survives rebuilds for the incremental
// relayout described in §15.1), the pan/zoom transform (scale clamped 0.05–4),
// selection state, and a transform-animation clock for the 600ms zoom-to-node /
// fit / reset transitions.
//
// Everything here is a direct port of js/graph.js's renderer bookkeeping:
//   • seeding + incremental heuristic  → js/graph.js:551-573
//   • zoom transform / scaleExtent      → js/graph.js:112-121 (0.05–4), label
//                                          gate k>0.6 (js/graph.js:119)
//   • zoomToNode (scale 1.5, 600ms)     → js/graph.js:751-760
//   • fitView (margin 60, 600ms)        → js/graph.js:247-275
//   • resetView (identity, 600ms)       → js/graph.js:236-238
//   • zoomBy (×1.3, 200ms)              → js/graph.js:241-244 + app.js:257-260
//   • drag pin/unpin (fx/fy, clear on   → js/graph.js:788-803
//     dragend), warm-while-dragging
//   • selection dimming set              → js/graph.js:675-719
//
// Pure geometry/heuristic helpers (transform math, hit-testing, label gating,
// seeding, incremental decision, selection set) are factored out as methods /
// static functions so they can be unit-tested without a view hierarchy.

import ConstellationGraphModel
import CoreGraphics
import Observation
import QuartzCore

/// §15.1 render constants (values cross-checked against js/graph.js + css).
public enum GraphConstants {
    /// js/graph.js:114 `scaleExtent([0.05, 4])`.
    public static let minScale: CGFloat = 0.05
    public static let maxScale: CGFloat = 4
    /// js/graph.js:119 `this._showLabels = k > 0.6`.
    public static let labelZoomThreshold: CGFloat = 0.6
    /// js/graph.js:757 `.scale(1.5)`.
    public static let zoomToNodeScale: CGFloat = 1.5
    /// js/graph.js:759 `.duration(600)`.
    public static let transitionDuration: Double = 0.6
    /// js/graph.js:243 zoom-button transition `.duration(200)`.
    public static let zoomButtonDuration: Double = 0.2
    /// app.js:257 `zoomBy(1.3)`.
    public static let zoomButtonFactor: CGFloat = 1.3
    /// js/graph.js:261 `const margin = 60`.
    public static let fitMargin: CGFloat = 60
    /// js/graph.js:567-568 new-node seed spread: center ± (rand-0.5)*80 → ±40px.
    public static let seedSpread: Double = 80
    /// js/graph.js:198 resize / relayout reheat alpha.
    public static let reheatAlpha: Double = 0.3
}

@MainActor
@Observable
public final class GraphRenderState {
    // MARK: - Physics

    /// The engine is created once and reused across `rebuild`s (velocity
    /// continuity), like graph.js's single reused `forceSimulation`.
    private let engine: D3ForceSimulation
    private var simActive = false

    // MARK: - Render data (current frame's model)

    public private(set) var nodes: [GraphNode] = []
    public private(set) var edges: [GraphEdge] = []
    public private(set) var hulls: [GraphHull] = []
    private var lastModel: GraphModel?

    /// id → world position, updated every tick (drives drawing + hit-testing).
    public private(set) var positions: [String: CGPoint] = [:]

    /// id → last x/y/vx/vy/fx/fy — lets a rebuild resume the existing layout
    /// instead of re-scattering the graph (js/graph.js `_nodePositions`).
    var cache: [String: SeedState] = [:]

    struct SeedState: Equatable {
        var x: Double, y: Double, vx: Double, vy: Double
        var fx: Double?, fy: Double?
    }

    // MARK: - Transform (pan/zoom)

    public private(set) var scale: CGFloat = 1
    public private(set) var tx: CGFloat = 0
    public private(set) var ty: CGFloat = 0

    private struct TransformAnim {
        var k0, k1, tx0, tx1, ty0, ty1: CGFloat
        var start, duration: Double
    }
    private var transformAnim: TransformAnim?

    // MARK: - Selection / interaction

    /// The selected node id (drives dimming — js/graph.js `_selectedNode`).
    public var selectedID: String?
    private var dragging = false

    /// Container size in points (the SVG viewport equivalent).
    public private(set) var size: CGSize = CGSize(width: 1200, height: 800)

    /// True while the layout is settling or a transform animation / drag is in
    /// flight; drives `TimelineView(.animation(paused: !isHot))`.
    public var isHot: Bool = false

    /// Bumped when a photo finishes decoding off-main so the Canvas repaints
    /// even when the simulation is at rest.
    public private(set) var photoVersion = 0

    public init(width: Double = 1200, height: Double = 800) {
        size = CGSize(width: width, height: height)
        engine = D3ForceSimulation(width: width, height: height)
    }

    // MARK: - Label gating (js/graph.js:119)

    public var labelsVisible: Bool { scale > GraphConstants.labelZoomThreshold }

    // MARK: - Transform math (pure, testable)

    public func worldToView(_ p: CGPoint) -> CGPoint {
        CGPoint(x: tx + scale * p.x, y: ty + scale * p.y)
    }

    public func viewToWorld(_ p: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - tx) / scale, y: (p.y - ty) / scale)
    }

    public static func clampScale(_ k: CGFloat) -> CGFloat {
        min(GraphConstants.maxScale, max(GraphConstants.minScale, k))
    }

    /// Node on-screen radius (world units) — reuses the shared §15.1 formula so
    /// the collide config and the renderer never disagree (js/graph.js:480-485).
    public static func radius(of n: GraphNode) -> CGFloat {
        CGFloat(
            ForceConfig.nodeRadius(
                isGroupNode: n.isGroupNode, groupDepth: n.groupDepth,
                isCompany: n.isCompany, isVirtual: n.isVirtual,
                connectionCount: n.connectionCount))
    }

    // MARK: - Hit testing (inverse transform + radius scan, js/graph.js click)

    /// Nearest node whose disc contains `viewPoint`; nil if the click missed
    /// every node. Group and virtual nodes are included.
    public func hitTest(viewPoint: CGPoint) -> String? {
        let w = viewToWorld(viewPoint)
        var best: (id: String, d: CGFloat)?
        for n in nodes {
            guard let p = positions[n.id] else { continue }
            let r = Self.radius(of: n)
            let dx = p.x - w.x
            let dy = p.y - w.y
            let d = (dx * dx + dy * dy).squareRoot()
            if d <= r, best == nil || d < best!.d {
                best = (n.id, d)
            }
        }
        return best?.id
    }

    // MARK: - Selection set (js/graph.js:678-693)

    /// The id itself plus every node one edge away — the "kept bright" set when
    /// a node is selected. Non-members are dimmed by the renderer.
    public func connectedSet(to id: String) -> Set<String> {
        var set: Set<String> = [id]
        for e in edges where e.source == id || e.target == id {
            set.insert(e.source)
            set.insert(e.target)
        }
        return set
    }

    // MARK: - Incremental seeding (js/graph.js:551-573)

    /// Build the seeded `SimNode` array from a model + position cache, and count
    /// how many nodes resumed a cached position. New (uncached) nodes seed near
    /// the center within ±40px (`seedSpread/2`), matching js/graph.js:567-568.
    nonisolated static func seededSimNodes(
        nodes: [GraphNode],
        cache: [String: SeedState],
        size: CGSize,
        jitter: () -> Double
    ) -> (sim: [SimNode], seeded: Int) {
        var sim: [SimNode] = []
        sim.reserveCapacity(nodes.count)
        var seeded = 0
        for n in nodes {
            var s = SimNode(
                id: n.id, isGroupNode: n.isGroupNode, groupDepth: n.groupDepth,
                isCompany: n.isCompany, isVirtual: n.isVirtual,
                connectionCount: n.connectionCount, category: n.category)
            if let prev = cache[n.id] {
                s.x = prev.x
                s.y = prev.y
                s.vx = prev.vx
                s.vy = prev.vy
                s.fx = prev.fx
                s.fy = prev.fy
                seeded += 1
            } else {
                s.x = size.width / 2 + (jitter() - 0.5) * GraphConstants.seedSpread
                s.y = size.height / 2 + (jitter() - 0.5) * GraphConstants.seedSpread
                s.vx = 0
                s.vy = 0
            }
            sim.append(s)
        }
        return (sim, seeded)
    }

    /// js/graph.js:573 — settle gently (incremental, alpha 0.3) when ≥50% of the
    /// incoming nodes resumed a cached position; otherwise run a full layout.
    nonisolated static func isIncremental(seeded: Int, total: Int) -> Bool {
        total > 0 && Double(seeded) >= Double(total) * 0.5
    }

    // MARK: - Rebuild (repoints the reused sim, velocity-continuous)

    public func rebuild(
        graphModel: GraphModel,
        size: CGSize,
        jitter: () -> Double = { Double.random(in: 0..<1) }
    ) {
        self.size = size
        lastModel = graphModel
        nodes = graphModel.nodes
        edges = graphModel.edges
        hulls = graphModel.hulls

        let (sim, seeded) = Self.seededSimNodes(
            nodes: nodes, cache: cache, size: size, jitter: jitter)
        let incremental = Self.isIncremental(seeded: seeded, total: nodes.count)

        let simEdges = edges.map {
            SimEdge(
                id: $0.id, source: $0.source, target: $0.target,
                edgeKind: $0.edgeKind, category: $0.category)
        }

        engine.setCenter(x: size.width / 2, y: size.height / 2)
        engine.load(nodes: sim, edges: simEdges, incremental: incremental)
        syncFromEngine()
        simActive = true
        isHot = true

        // Drop cache entries for nodes no longer present so a shrinking graph
        // doesn't leak stale positions.
        let live = Set(nodes.map(\.id))
        cache = cache.filter { live.contains($0.key) }
    }

    /// React to a viewport size change (js/graph.js:184-200 `_onResize`): recenter
    /// and reheat to 0.3, but only on a real change (avoid needless re-animation).
    public func setSize(_ newSize: CGSize) {
        guard newSize.width > 0, newSize.height > 0 else { return }
        guard newSize != size else { return }
        size = newSize
        engine.setCenter(x: newSize.width / 2, y: newSize.height / 2)
        engine.reheat(alpha: GraphConstants.reheatAlpha)
        simActive = true
        isHot = true
    }

    // MARK: - Frame advance (driven by TimelineView / snapshot loop)

    /// Advance one frame: tick the layout (if warm) and step any transform
    /// animation. Recomputes `isHot`.
    public func advanceFrame() {
        // Keep the sim warm while dragging (js/graph.js dragStarted
        // `alphaTarget(0.3)`), which our engine emulates by re-flooring alpha.
        if dragging {
            engine.reheat(alpha: max(engine.alpha, GraphConstants.reheatAlpha))
            simActive = true
        }
        if simActive {
            simActive = engine.tick()
            syncFromEngine()
        }

        var animating = false
        if let a = transformAnim {
            let now = CACurrentMediaTime()
            let t = min(1, max(0, (now - a.start) / a.duration))
            let e = CGFloat(Self.easeInOut(t))
            scale = a.k0 + (a.k1 - a.k0) * e
            tx = a.tx0 + (a.tx1 - a.tx0) * e
            ty = a.ty0 + (a.ty1 - a.ty0) * e
            if t >= 1 { transformAnim = nil } else { animating = true }
        }

        isHot = simActive || animating || dragging
    }

    /// Tick to rest synchronously (for the offscreen screenshot path / tests).
    public func tickUntilRest(maxIterations: Int = 4000) {
        var i = 0
        while engine.tick(), i < maxIterations { i += 1 }
        syncFromEngine()
        simActive = false
        isHot = false
    }

    private func syncFromEngine() {
        for st in engine.nodeStates {
            positions[st.id] = CGPoint(x: st.x, y: st.y)
            cache[st.id] = SeedState(
                x: st.x, y: st.y, vx: st.vx, vy: st.vy, fx: st.fx, fy: st.fy)
        }
    }

    static func easeInOut(_ t: Double) -> Double {
        t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
    }

    // MARK: - Immediate zoom / pan (wheel, pinch, drag-pan)

    /// Zoom by a multiplicative factor keeping the world point under
    /// `viewPoint` fixed (standard d3.zoom wheel/pinch behavior).
    public func zoom(by factor: CGFloat, about viewPoint: CGPoint) {
        let newK = Self.clampScale(scale * factor)
        let wx = (viewPoint.x - tx) / scale
        let wy = (viewPoint.y - ty) / scale
        scale = newK
        tx = viewPoint.x - newK * wx
        ty = viewPoint.y - newK * wy
        transformAnim = nil
    }

    public func panBy(dx: CGFloat, dy: CGFloat) {
        tx += dx
        ty += dy
        transformAnim = nil
    }

    // MARK: - Animated transitions

    private func animateTo(k: CGFloat, tx targetTx: CGFloat, ty targetTy: CGFloat, duration: Double) {
        let clampedK = Self.clampScale(k)
        if duration <= 0 {
            scale = clampedK
            tx = targetTx
            ty = targetTy
            transformAnim = nil
            return
        }
        transformAnim = TransformAnim(
            k0: scale, k1: clampedK, tx0: tx, tx1: targetTx, ty0: ty, ty1: targetTy,
            start: CACurrentMediaTime(), duration: duration)
        isHot = true
    }

    /// Center + zoom (×1.5) on a node without changing selection dimming
    /// (js/graph.js:751-760). No-op if the node has no resolved position.
    public func zoomToNode(_ id: String, duration: Double = GraphConstants.transitionDuration) {
        guard let p = positions[id] else { return }
        let k = GraphConstants.zoomToNodeScale
        animateTo(
            k: k, tx: size.width / 2 - k * p.x, ty: size.height / 2 - k * p.y,
            duration: duration)
    }

    /// Fit every node within the viewport with a 60px margin (js/graph.js:247-275).
    public func fitView(duration: Double = GraphConstants.transitionDuration) {
        let pts = nodes.compactMap { positions[$0.id] }
        guard !pts.isEmpty else { return resetView(duration: duration) }
        var minX = CGFloat.infinity, minY = CGFloat.infinity
        var maxX = -CGFloat.infinity, maxY = -CGFloat.infinity
        for p in pts {
            minX = min(minX, p.x); minY = min(minY, p.y)
            maxX = max(maxX, p.x); maxY = max(maxY, p.y)
        }
        let m = GraphConstants.fitMargin
        let w = max(1, maxX - minX)
        let h = max(1, maxY - minY)
        let k = min(
            GraphConstants.maxScale,
            max(GraphConstants.minScale, min((size.width - m * 2) / w, (size.height - m * 2) / h)))
        let cx = (minX + maxX) / 2
        let cy = (minY + maxY) / 2
        animateTo(k: k, tx: size.width / 2 - k * cx, ty: size.height / 2 - k * cy, duration: duration)
    }

    /// Reset to the identity transform (js/graph.js:236-238).
    public func resetView(duration: Double = GraphConstants.transitionDuration) {
        animateTo(k: 1, tx: 0, ty: 0, duration: duration)
    }

    /// Zoom in/out about the viewport center (js/graph.js:241-244).
    public func zoomButton(_ factor: CGFloat) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let newK = Self.clampScale(scale * factor)
        let wx = (center.x - tx) / scale
        let wy = (center.y - ty) / scale
        animateTo(
            k: newK, tx: center.x - newK * wx, ty: center.y - newK * wy,
            duration: GraphConstants.zoomButtonDuration)
    }

    /// Re-run the layout from a fresh centered seed (js/graph.js:283-304): discard
    /// cached positions so every node is treated as new (full alpha=1 layout).
    public func relayout() {
        guard let model = lastModel else { return }
        cache.removeAll()
        rebuild(graphModel: model, size: size)
    }

    // MARK: - Drag (js/graph.js:788-803)

    public func beginDrag(_ id: String) {
        guard let p = positions[id] else { return }
        dragging = true
        engine.pin(id: id, x: p.x, y: p.y)
        engine.reheat(alpha: GraphConstants.reheatAlpha)
        simActive = true
        isHot = true
    }

    public func dragNode(_ id: String, toWorld p: CGPoint) {
        engine.pin(id: id, x: p.x, y: p.y)
        positions[id] = p
        engine.reheat(alpha: max(engine.alpha, GraphConstants.reheatAlpha))
        isHot = true
    }

    /// js/graph.js:799-803 — on dragend the node is UNPINNED (fx/fy cleared) so
    /// it rejoins the simulation; alphaTarget returns to 0 (decay to rest).
    public func endDrag(_ id: String) {
        engine.unpin(id: id)
        dragging = false
    }

    // MARK: - Photo decode notification

    public func bumpPhotoVersion() { photoVersion &+= 1 }

    #if DEBUG
        /// Test-only: pin a node's resolved position (bypassing the simulation).
        func setTestPosition(_ id: String, _ p: CGPoint) {
            positions[id] = p
            cache[id] = SeedState(x: p.x, y: p.y, vx: 0, vy: 0, fx: nil, fy: nil)
        }
        func testPosition(_ id: String) -> CGPoint? { positions[id] }
    #endif
}
