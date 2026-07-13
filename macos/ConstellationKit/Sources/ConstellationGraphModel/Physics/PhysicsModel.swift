// Internal mutable node/link model for the d3-force port.
//
// d3-force mutates plain JS objects in place (x/y/vx/vy and an assigned
// `index`), and the quadtree/forces hold references to them. To reproduce that
// exactly — including reference identity, which `forceManyBody` relies on
// (`quad.data !== node`) — the internal representation is a `final class`, not a
// value type. The *public* input/output surface (SimNode/SimEdge) stays value
// types; the simulation converts on `load`.
//
// Not `Sendable`: mutated single-threaded from the simulation each tick.

import Foundation

/// A simulation node — the Swift analogue of the mutated d3 node object.
final class PhysicsNode {
    let id: String

    // Integration state (NaN x/y triggers phyllotaxis placement, per d3).
    var x: Double = .nan
    var y: Double = .nan
    var vx: Double = .nan
    var vy: Double = .nan
    var fx: Double?
    var fy: Double?
    var index: Int = 0

    // Baked-config inputs (read by the charge & radius closures).
    let isGroupNode: Bool
    let groupDepth: Int?
    let isCompany: Bool
    let isVirtual: Bool
    let connectionCount: Int
    let category: String

    init(
        id: String,
        isGroupNode: Bool,
        groupDepth: Int?,
        isCompany: Bool,
        isVirtual: Bool,
        connectionCount: Int,
        category: String
    ) {
        self.id = id
        self.isGroupNode = isGroupNode
        self.groupDepth = groupDepth
        self.isCompany = isCompany
        self.isVirtual = isVirtual
        self.connectionCount = connectionCount
        self.category = category
    }
}

/// A simulation link. `source`/`target` are resolved to node references at
/// initialize time (mirroring d3's id → object resolution).
final class PhysicsLink {
    let id: String
    let sourceId: String
    let targetId: String
    let edgeKind: String?
    let category: String

    // Resolved during LinkForce.initialize.
    var source: PhysicsNode!
    var target: PhysicsNode!
    var index: Int = 0

    init(id: String, sourceId: String, targetId: String, edgeKind: String?, category: String) {
        self.id = id
        self.sourceId = sourceId
        self.targetId = targetId
        self.edgeKind = edgeKind
        self.category = category
    }
}

/// A registered force. Mirrors d3's `force.initialize(nodes, random)` +
/// `force(alpha)` call-object protocol.
protocol Force: AnyObject {
    func initialize(_ nodes: [PhysicsNode], _ random: D3Random)
    func apply(_ alpha: Double)
}
