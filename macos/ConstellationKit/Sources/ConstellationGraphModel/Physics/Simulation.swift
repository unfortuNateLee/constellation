// Swift port of the d3-force simulation core (src/simulation.js), minus the
// d3-timer stepper: ticks are driven explicitly by the host so the layout stays
// deterministic and testable. Velocity-Verlet integration, alpha schedule,
// phyllotaxis initial placement, fx/fy pinning, and `find` all match d3 v7.
//
// Ported from d3-force (v3) by Mike Bostock — https://github.com/d3/d3-force
//
// ISC License. Copyright 2010-2023 Mike Bostock.
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
// REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
// AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
// INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
// LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
// OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
// PERFORMANCE OF THIS SOFTWARE.

import Foundation

/// The bare simulation engine — nodes, the alpha schedule, ordered forces, and
/// the single shared LCG. Kept generic (no baked config) so `D3ForceSimulation`
/// can compose it with the app's §15.1 force set. Not `Sendable`.
final class Simulation {
    // simulation.js: initialRadius = 10, initialAngle = π·(3−√5)
    private static let initialRadius = 10.0
    private static let initialAngle = Double.pi * (3 - (5.0).squareRoot())

    private(set) var nodes: [PhysicsNode] = []

    var alpha: Double = 1
    var alphaMin: Double = 0.001
    /// `1 − alphaMin^(1/300)`. Computed once (as d3 does at construction). The
    /// `pow` here is verified bit-identical to V8's on the target toolchain, so
    /// this constant equals d3's exactly (0.02276277904418933).
    private(set) var alphaDecay: Double = 1 - pow(0.001, 1.0 / 300.0)
    var alphaTarget: Double = 0
    /// d3's *internal* multiplier (its public `velocityDecay()` getter returns
    /// `1 − this`). Each tick does `vx *= velocityDecay`.
    var velocityDecay: Double = 0.6

    /// The one LCG seeded per simulation, shared with every force (jiggle).
    let random = D3Random()

    // Insertion-ordered forces (JS Map iteration order == registration order).
    private var forceOrder: [String] = []
    private var forcesByName: [String: Force] = [:]

    // MARK: - Nodes

    /// `simulation.nodes(_)`: repoint the node array, re-run phyllotaxis
    /// placement, and re-initialize every force in registration order.
    func setNodes(_ nodes: [PhysicsNode]) {
        self.nodes = nodes
        initializeNodes()
        for name in forceOrder { forcesByName[name]!.initialize(nodes, random) }
    }

    private func initializeNodes() {
        let n = nodes.count
        for i in 0..<n {
            let node = nodes[i]
            node.index = i
            if let fx = node.fx { node.x = fx }
            if let fy = node.fy { node.y = fy }
            if node.x.isNaN || node.y.isNaN {
                let radius = Simulation.initialRadius * (0.5 + Double(i)).squareRoot()
                let angle = Double(i) * Simulation.initialAngle
                node.x = radius * cos(angle)
                node.y = radius * sin(angle)
            }
            if node.vx.isNaN || node.vy.isNaN {
                node.vx = 0
                node.vy = 0
            }
        }
    }

    // MARK: - Forces

    /// `simulation.force(name, force)`: register (or replace) and initialize.
    func registerForce(_ name: String, _ force: Force) {
        if forcesByName[name] == nil { forceOrder.append(name) }
        forcesByName[name] = force
        force.initialize(nodes, random)
    }

    func force(_ name: String) -> Force? { forcesByName[name] }

    // MARK: - Tick

    /// One integration step. Mirrors `tick()`: decay alpha, apply forces in
    /// order, then Velocity-Verlet integrate (respecting fx/fy pins).
    func tick(_ iterations: Int = 1) {
        let n = nodes.count
        for _ in 0..<iterations {
            alpha += (alphaTarget - alpha) * alphaDecay

            for name in forceOrder { forcesByName[name]!.apply(alpha) }

            for i in 0..<n {
                let node = nodes[i]
                if let fx = node.fx {
                    node.x = fx
                    node.vx = 0
                } else {
                    node.vx *= velocityDecay
                    node.x += node.vx
                }
                if let fy = node.fy {
                    node.y = fy
                    node.vy = 0
                } else {
                    node.vy *= velocityDecay
                    node.y += node.vy
                }
            }
        }
    }

    // MARK: - Find

    /// `simulation.find(x, y, radius)`: nearest node within `radius` (linear
    /// scan, identical tie-breaking to d3 — first-seen wins on ties).
    func find(_ x: Double, _ y: Double, _ radius: Double?) -> PhysicsNode? {
        var r = radius.map { $0 * $0 } ?? .infinity
        var closest: PhysicsNode?
        for node in nodes {
            let dx = x - node.x
            let dy = y - node.y
            let d2 = dx * dx + dy * dy
            if d2 < r {
                closest = node
                r = d2
            }
        }
        return closest
    }
}
