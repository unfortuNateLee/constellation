// Pure-logic tests for GraphRenderState: transform math, hit-testing, label
// gating, incremental seeding, and the selection set. These exercise the
// factored-out methods without any view hierarchy.

import ConstellationGraphModel
import CoreGraphics
import Testing

@testable import ConstellationUI

private func node(
    _ id: String, category: String = "other", isCompany: Bool = false,
    isVirtual: Bool = false, isGroup: Bool = false, connections: Int = 0,
    groupDepth: Int? = nil
) -> GraphNode {
    GraphNode(
        id: id, name: id, isVirtual: isVirtual, isGroupNode: isGroup,
        connectionCount: connections, category: category, groupDepth: groupDepth,
        isCompany: isCompany)
}

private func edge(_ id: String, _ s: String, _ t: String, category: String = "other")
    -> GraphEdge
{
    GraphEdge(id: id, source: s, target: t, type: category, label: category, category: category, inferred: false)
}

// MARK: - Transform math

@Test @MainActor func worldViewRoundTrips() {
    let rs = GraphRenderState()
    rs.zoom(by: 2, about: CGPoint(x: 100, y: 100))
    for p in [CGPoint(x: 0, y: 0), CGPoint(x: 50, y: -30), CGPoint(x: 250, y: 400)] {
        let back = rs.viewToWorld(rs.worldToView(p))
        #expect(abs(back.x - p.x) < 1e-6)
        #expect(abs(back.y - p.y) < 1e-6)
    }
}

@Test @MainActor func zoomKeepsPointerAnchored() {
    let rs = GraphRenderState()
    let pointer = CGPoint(x: 300, y: 200)
    let worldBefore = rs.viewToWorld(pointer)
    rs.zoom(by: 1.7, about: pointer)
    let worldAfter = rs.viewToWorld(pointer)
    // The world point under the pointer must not move.
    #expect(abs(worldBefore.x - worldAfter.x) < 1e-6)
    #expect(abs(worldBefore.y - worldAfter.y) < 1e-6)
}

@Test @MainActor func scaleClampsToExtent() {
    #expect(GraphRenderState.clampScale(100) == GraphConstants.maxScale)
    #expect(GraphRenderState.clampScale(0.0001) == GraphConstants.minScale)
    #expect(GraphRenderState.clampScale(1) == 1)
}

@Test @MainActor func panShiftsTranslationOnly() {
    let rs = GraphRenderState()
    let before = rs.scale
    rs.panBy(dx: 40, dy: -25)
    #expect(rs.scale == before)
    #expect(rs.worldToView(.zero) == CGPoint(x: 40, y: -25))
}

// MARK: - Label gating (js/graph.js:119 — k > 0.6)

@Test @MainActor func labelGateAtThreshold() {
    let rs = GraphRenderState()
    rs.resetView(duration: 0)  // k = 1
    #expect(rs.labelsVisible)
    // Zoom out below 0.6 about origin.
    rs.zoom(by: 0.5, about: .zero)  // k = 0.5
    #expect(!rs.labelsVisible)
    rs.zoom(by: 1.4, about: .zero)  // k = 0.7
    #expect(rs.labelsVisible)
}

// MARK: - Incremental seeding heuristic (js/graph.js:573)

@Test func incrementalRequiresHalfCached() {
    #expect(GraphRenderState.isIncremental(seeded: 5, total: 10))  // exactly 50%
    #expect(GraphRenderState.isIncremental(seeded: 6, total: 10))
    #expect(!GraphRenderState.isIncremental(seeded: 4, total: 10))
    #expect(!GraphRenderState.isIncremental(seeded: 0, total: 0))  // empty graph
}

@Test func seedingResumesCacheAndScattersNewNodes() {
    let size = CGSize(width: 1000, height: 800)
    let cache: [String: GraphRenderState.SeedState] = [
        "a": .init(x: 111, y: 222, vx: 1, vy: 2, fx: nil, fy: nil),
        "b": .init(x: 5, y: 6, vx: 0, vy: 0, fx: 5, fy: 6),
    ]
    let nodes = [node("a"), node("b"), node("c")]
    // Deterministic jitter at 0.5 → new node lands exactly at center.
    let (sim, seeded) = GraphRenderState.seededSimNodes(
        nodes: nodes, cache: cache, size: size, jitter: { 0.5 })
    #expect(seeded == 2)
    #expect(sim[0].x == 111 && sim[0].y == 222 && sim[0].vx == 1)
    #expect(sim[1].fx == 5 && sim[1].fy == 6)
    // New node "c": jitter 0.5 → offset (0.5-0.5)*80 = 0 → center.
    #expect(sim[2].x == 500 && sim[2].y == 400)
    #expect(sim[2].vx == 0 && sim[2].vy == 0)
}

@Test func seedingScatterStaysWithin40px() {
    let size = CGSize(width: 1000, height: 800)
    let nodes = [node("x")]
    let (lo, _) = GraphRenderState.seededSimNodes(nodes: nodes, cache: [:], size: size, jitter: { 0 })
    let (hi, _) = GraphRenderState.seededSimNodes(nodes: nodes, cache: [:], size: size, jitter: { 1 })
    #expect(lo[0].x == 460 && hi[0].x == 540)  // center 500 ± 40
    #expect(lo[0].y == 360 && hi[0].y == 440)  // center 400 ± 40
}

// MARK: - Radius (shared §15.1 formula, js/graph.js:480-485)

@Test @MainActor func radiusMatchesSpec() {
    #expect(GraphRenderState.radius(of: node("p")) == 10)  // person base
    #expect(GraphRenderState.radius(of: node("c", isCompany: true)) == 12)
    #expect(GraphRenderState.radius(of: node("v", isVirtual: true)) == 6)
    // person with 4 connections: 10 + min(4*1.5, 10) = 16
    #expect(GraphRenderState.radius(of: node("p4", connections: 4)) == 16)
    // bonus caps at 10: 10 + 10 = 20
    #expect(GraphRenderState.radius(of: node("p99", connections: 99)) == 20)
    // group depth 2: max(12, 18 - 2*1.5) = 15
    #expect(GraphRenderState.radius(of: node("g", isGroup: true, groupDepth: 2)) == 15)
}

// MARK: - Hit testing (inverse transform + radius scan)

@Test @MainActor func hitTestFindsNodeUnderPointer() {
    let rs = GraphRenderState()
    let model = GraphModel(
        mode: "connections",
        nodes: [node("a", connections: 4), node("b", connections: 4)],
        edges: [], hulls: [])
    rs.rebuild(graphModel: model, size: CGSize(width: 800, height: 600), jitter: { 0.5 })
    // Force known positions (both seeded to center by jitter 0.5, so relocate).
    rs.setTestPosition("a", CGPoint(x: 100, y: 100))
    rs.setTestPosition("b", CGPoint(x: 400, y: 400))
    // identity transform → view == world.
    #expect(rs.hitTest(viewPoint: CGPoint(x: 100, y: 100)) == "a")
    #expect(rs.hitTest(viewPoint: CGPoint(x: 405, y: 402)) == "b")  // within r=16
    #expect(rs.hitTest(viewPoint: CGPoint(x: 250, y: 250)) == nil)  // empty space
}

@Test @MainActor func hitTestRespectsTransform() {
    let rs = GraphRenderState()
    let model = GraphModel(
        mode: "connections", nodes: [node("a", connections: 4)], edges: [], hulls: [])
    rs.rebuild(graphModel: model, size: CGSize(width: 800, height: 600), jitter: { 0.5 })
    rs.setTestPosition("a", CGPoint(x: 100, y: 100))
    rs.zoom(by: 2, about: .zero)  // world 100 → view 200
    #expect(rs.hitTest(viewPoint: CGPoint(x: 200, y: 200)) == "a")
    #expect(rs.hitTest(viewPoint: CGPoint(x: 100, y: 100)) == nil)
}

// MARK: - Selection set (js/graph.js:678-693)

@Test @MainActor func connectedSetIsNeighborhood() {
    let rs = GraphRenderState()
    let model = GraphModel(
        mode: "connections",
        nodes: [node("a"), node("b"), node("c"), node("d")],
        edges: [edge("e1", "a", "b"), edge("e2", "a", "c")],
        hulls: [])
    rs.rebuild(graphModel: model, size: CGSize(width: 800, height: 600), jitter: { 0.5 })
    let set = rs.connectedSet(to: "a")
    #expect(set == ["a", "b", "c"])
    #expect(!set.contains("d"))
    // A leaf node's set is itself + its one neighbor.
    #expect(rs.connectedSet(to: "b") == ["a", "b"])
}

// MARK: - Fit / reset transforms

@Test @MainActor func fitFramesAllNodesWithinViewport() {
    let rs = GraphRenderState()
    let model = GraphModel(
        mode: "connections", nodes: [node("a"), node("b")], edges: [], hulls: [])
    let size = CGSize(width: 800, height: 600)
    rs.rebuild(graphModel: model, size: size, jitter: { 0.5 })
    rs.setTestPosition("a", CGPoint(x: -200, y: -100))
    rs.setTestPosition("b", CGPoint(x: 200, y: 100))
    rs.fitView(duration: 0)
    // Both nodes must map inside the viewport after fitting.
    for id in ["a", "b"] {
        let v = rs.worldToView(rs.testPosition(id)!)
        #expect(v.x >= 0 && v.x <= size.width)
        #expect(v.y >= 0 && v.y <= size.height)
    }
    #expect(rs.scale <= GraphConstants.maxScale && rs.scale >= GraphConstants.minScale)
}

@Test @MainActor func resetRestoresIdentity() {
    let rs = GraphRenderState()
    rs.zoom(by: 3, about: CGPoint(x: 10, y: 10))
    rs.panBy(dx: 50, dy: 50)
    rs.resetView(duration: 0)
    #expect(rs.scale == 1)
    #expect(rs.worldToView(.zero) == .zero)
}
