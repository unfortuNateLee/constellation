// Public physics surface for the Constellation graph: the engine-swappable
// `GraphPhysics` protocol and its `D3ForceSimulation` implementation, which
// bakes the app's §15.1 force configuration (js/graph.js:480-668) into closures
// over the port's simulation core.
//
// The port reproduces d3-force v7 tick-for-tick (see PhysicsParityTests). The
// force set and registration order — link, charge, center, collide — mirror
// graph.js exactly, which is required for the shared LCG (jiggle) stream to
// stay aligned with the reference implementation.
//
// See D3Random.swift / QuadTree.swift / Forces.swift / Simulation.swift for the
// ported components and their ISC attribution.

import Foundation

// MARK: - Value types (public input/output surface)

/// A node handed to the simulation. Physics-relevant flags drive the baked
/// charge/radius closures; the optional seed fields carry cached position and
/// velocity for incremental (velocity-continuous) reloads. When `x`/`y` are
/// `nil`, d3 phyllotaxis placement applies; when `vx`/`vy` are `nil` they start
/// at 0; `fx`/`fy` pin the node.
public struct SimNode: Sendable, Equatable {
    public var id: String
    public var isGroupNode: Bool
    public var groupDepth: Int?
    public var isCompany: Bool
    public var isVirtual: Bool
    public var connectionCount: Int
    public var category: String

    public var x: Double?
    public var y: Double?
    public var vx: Double?
    public var vy: Double?
    public var fx: Double?
    public var fy: Double?

    public init(
        id: String,
        isGroupNode: Bool = false,
        groupDepth: Int? = nil,
        isCompany: Bool = false,
        isVirtual: Bool = false,
        connectionCount: Int = 0,
        category: String = "other",
        x: Double? = nil,
        y: Double? = nil,
        vx: Double? = nil,
        vy: Double? = nil,
        fx: Double? = nil,
        fy: Double? = nil
    ) {
        self.id = id
        self.isGroupNode = isGroupNode
        self.groupDepth = groupDepth
        self.isCompany = isCompany
        self.isVirtual = isVirtual
        self.connectionCount = connectionCount
        self.category = category
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.fx = fx
        self.fy = fy
    }
}

/// An edge handed to the simulation. `source`/`target` are node ids; `edgeKind`
/// and `category` drive the baked link distance/strength closures.
public struct SimEdge: Sendable, Equatable {
    public var id: String
    public var source: String
    public var target: String
    public var edgeKind: String?
    public var category: String

    public init(
        id: String, source: String, target: String, edgeKind: String? = nil,
        category: String = "other"
    ) {
        self.id = id
        self.source = source
        self.target = target
        self.edgeKind = edgeKind
        self.category = category
    }
}

/// A node's position/velocity readout after ticking.
public struct NodeState: Sendable, Equatable {
    public var id: String
    public var x: Double
    public var y: Double
    public var vx: Double
    public var vy: Double
    public var fx: Double?
    public var fy: Double?
}

// MARK: - Engine protocol

/// Engine-swappable physics interface (per the macOS plan). One concrete
/// implementation ships today: `D3ForceSimulation`.
///
/// Conformers are plain, non-`Sendable` reference types intended for
/// single-threaded (MainActor) use, matching the d3 usage model.
public protocol GraphPhysics: AnyObject {
    init(width: Double, height: Double)

    /// Repoint the node/edge arrays. `incremental` picks the restart alpha
    /// (0.3 vs 1.0, per §15.1); seeded nodes preserve x/y/vx/vy/fx/fy.
    func load(nodes: [SimNode], edges: [SimEdge], incremental: Bool)

    /// Advance one tick. Returns `false` once alpha drops below alphaMin
    /// (the layout has come to rest).
    @discardableResult func tick() -> Bool

    /// Current node positions/velocities, in node order.
    var nodeStates: [NodeState] { get }

    /// Pin/unpin a node (fx/fy). Pinned nodes hold position with zero velocity.
    func pin(id: String, x: Double, y: Double)
    func unpin(id: String)

    /// Move the centering force target.
    func setCenter(x: Double, y: Double)

    /// Nearest node to (x, y) within `radius` (nil = unbounded).
    func find(x: Double, y: Double, radius: Double?) -> NodeState?

    /// Reheat: set the current alpha (a "restart" without a timer).
    func reheat(alpha: Double)

    /// Current alpha.
    var alpha: Double { get }
}

// MARK: - §15.1 baked configuration

/// The force constants from DESIGN_SPEC §15.1 / js/graph.js, exposed as pure
/// functions so tests can assert them directly against the spec table.
public enum ForceConfig {
    /// Full-layout restart alpha (§15.1).
    public static let fullLayoutAlpha = 1.0
    /// Incremental-rebuild restart alpha (§15.1).
    public static let incrementalAlpha = 0.3
    /// Many-body long-range cutoff (§15.1).
    public static let chargeDistanceMax = 400.0
    /// Collision padding added to a node's radius (§15.1).
    public static let collidePadding = 8.0

    /// js/graph.js:480-485 — node radius.
    public static func nodeRadius(
        isGroupNode: Bool, groupDepth: Int?, isCompany: Bool, isVirtual: Bool, connectionCount: Int
    ) -> Double {
        if isGroupNode {
            // `Math.max(12, 18 - (d.groupDepth || 1) * 1.5)` — JS `|| 1` maps a
            // nil/zero depth to 1.
            let gd = groupDepth ?? 0
            let depth = Double(gd == 0 ? 1 : gd)
            return Swift.max(12, 18 - depth * 1.5)
        }
        let base: Double = isCompany ? 12 : (isVirtual ? 6 : 10)
        let bonus = Swift.min(Double(connectionCount) * 1.5, 10)
        return base + bonus
    }

    /// js/graph.js:635-642 — link distance.
    public static func linkDistance(edgeKind: String?, category: String) -> Double {
        if edgeKind == "geographic-hierarchy" { return 58 }
        if edgeKind == "geographic-membership" { return 70 }
        if edgeKind == "likely-surname" || edgeKind == "likely-tag" || edgeKind == "likely-family" {
            return 65
        }
        if category == "family" { return 80 }
        if category == "work" { return 100 }
        return 120
    }

    /// js/graph.js:643-648 — link strength.
    public static func linkStrength(edgeKind: String?, category: String) -> Double {
        if edgeKind == "geographic-hierarchy" { return 0.9 }
        if edgeKind == "geographic-membership" { return 0.82 }
        if edgeKind == "likely-surname" || edgeKind == "likely-tag" || edgeKind == "likely-family" {
            return 0.76
        }
        return 0.4
    }

    /// js/graph.js:655 — many-body charge.
    public static func chargeStrength(isGroupNode: Bool, isCompany: Bool) -> Double {
        isGroupNode ? -520 : (isCompany ? -400 : -150)
    }
}

// MARK: - D3ForceSimulation

/// The concrete d3-force engine with §15.1 baked in. Created once and reused
/// across `load`s (velocity continuity), like graph.js's reused simulation.
public final class D3ForceSimulation: GraphPhysics {
    private let sim = Simulation()
    private let linkForce: LinkForce
    private let chargeForce: ManyBodyForce
    private let centerForce: CenterForce
    private let collideForce: CollideForce

    // Live node index for pin/unpin and readout.
    private var nodesById: [String: PhysicsNode] = [:]

    public init(width: Double, height: Double) {
        // Closures read the baked config off the internal node/link. Built with
        // empty inputs; graph.js registers forces before nodes exist too.
        linkForce = LinkForce(
            links: [],
            distance: { ForceConfig.linkDistance(edgeKind: $0.edgeKind, category: $0.category) },
            strength: { ForceConfig.linkStrength(edgeKind: $0.edgeKind, category: $0.category) }
        )
        chargeForce = ManyBodyForce(
            strength: { ForceConfig.chargeStrength(isGroupNode: $0.isGroupNode, isCompany: $0.isCompany) }
        )
        chargeForce.setDistanceMax(ForceConfig.chargeDistanceMax)
        centerForce = CenterForce(x: width / 2, y: height / 2)
        collideForce = CollideForce(
            radius: {
                ForceConfig.nodeRadius(
                    isGroupNode: $0.isGroupNode, groupDepth: $0.groupDepth,
                    isCompany: $0.isCompany, isVirtual: $0.isVirtual,
                    connectionCount: $0.connectionCount
                ) + ForceConfig.collidePadding
            }
        )

        // Registration order is load-bearing (LCG stream): link, charge,
        // center, collide — exactly as graph.js.
        sim.registerForce("link", linkForce)
        sim.registerForce("charge", chargeForce)
        sim.registerForce("center", centerForce)
        sim.registerForce("collide", collideForce)
    }

    public func load(nodes: [SimNode], edges: [SimEdge], incremental: Bool) {
        let physicsNodes = nodes.map { n -> PhysicsNode in
            let p = PhysicsNode(
                id: n.id, isGroupNode: n.isGroupNode, groupDepth: n.groupDepth,
                isCompany: n.isCompany, isVirtual: n.isVirtual,
                connectionCount: n.connectionCount, category: n.category)
            // nil seed => NaN so the simulation applies phyllotaxis / zeroing.
            p.x = n.x ?? .nan
            p.y = n.y ?? .nan
            p.vx = n.vx ?? .nan
            p.vy = n.vy ?? .nan
            p.fx = n.fx
            p.fy = n.fy
            return p
        }

        nodesById = [:]
        nodesById.reserveCapacity(physicsNodes.count)
        for p in physicsNodes { nodesById[p.id] = p }

        let physicsLinks = edges.map {
            PhysicsLink(
                id: $0.id, sourceId: $0.source, targetId: $0.target,
                edgeKind: $0.edgeKind, category: $0.category)
        }

        // Mirror graph.js: nodes() first (phyllotaxis + re-init all forces),
        // then link.links() (degree/bias), then set alpha & restart.
        sim.setNodes(physicsNodes)
        linkForce.setLinks(physicsLinks)
        sim.alpha = incremental ? ForceConfig.incrementalAlpha : ForceConfig.fullLayoutAlpha
        sim.alphaTarget = 0
    }

    @discardableResult
    public func tick() -> Bool {
        sim.tick()
        return sim.alpha >= sim.alphaMin
    }

    public var nodeStates: [NodeState] {
        sim.nodes.map {
            NodeState(id: $0.id, x: $0.x, y: $0.y, vx: $0.vx, vy: $0.vy, fx: $0.fx, fy: $0.fy)
        }
    }

    public func pin(id: String, x: Double, y: Double) {
        guard let node = nodesById[id] else { return }
        node.fx = x
        node.fy = y
    }

    public func unpin(id: String) {
        guard let node = nodesById[id] else { return }
        node.fx = nil
        node.fy = nil
    }

    public func setCenter(x: Double, y: Double) {
        centerForce.x = x
        centerForce.y = y
    }

    public func find(x: Double, y: Double, radius: Double?) -> NodeState? {
        guard let node = sim.find(x, y, radius) else { return nil }
        return NodeState(id: node.id, x: node.x, y: node.y, vx: node.vx, vy: node.vy, fx: node.fx, fy: node.fy)
    }

    public func reheat(alpha: Double) {
        sim.alpha = alpha
    }

    public var alpha: Double { sim.alpha }

    /// Exposed for tests: alphaMin / alphaDecay / velocityDecay actually in use.
    public var alphaMin: Double { sim.alphaMin }
    public var alphaDecay: Double { sim.alphaDecay }
    public var internalVelocityDecay: Double { sim.velocityDecay }
}
