// Swift port of the four d3-force forces used by the app:
// src/link.js, manyBody.js, center.js, collide.js.
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

// MARK: - forceLink (link.js)

/// Spring force between linked nodes. Distance and strength are closures over
/// the link (the app varies them by edge kind/category). Degree-based `bias`
/// still applies even though the app supplies an explicit strength closure
/// (d3's default *strength* is overridden, but `bias` is independent of it).
final class LinkForce: Force {
    private var links: [PhysicsLink]
    private let distance: (PhysicsLink) -> Double
    private let strength: (PhysicsLink) -> Double
    private let iterations: Int

    private var nodes: [PhysicsNode] = []
    private var random: D3Random?
    private var count: [Int] = []
    private var bias: [Double] = []
    private var strengths: [Double] = []
    private var distances: [Double] = []

    init(
        links: [PhysicsLink],
        distance: @escaping (PhysicsLink) -> Double,
        strength: @escaping (PhysicsLink) -> Double,
        iterations: Int = 1
    ) {
        self.links = links
        self.distance = distance
        self.strength = strength
        self.iterations = iterations
    }

    func setLinks(_ links: [PhysicsLink]) {
        self.links = links
        initializeInternal()
    }

    func initialize(_ nodes: [PhysicsNode], _ random: D3Random) {
        self.nodes = nodes
        self.random = random
        initializeInternal()
    }

    private func initializeInternal() {
        if nodes.isEmpty { return }
        let n = nodes.count
        let m = links.count

        var nodeById: [String: PhysicsNode] = [:]
        nodeById.reserveCapacity(n)
        for d in nodes { nodeById[d.id] = d }

        count = [Int](repeating: 0, count: n)
        for i in 0..<m {
            let link = links[i]
            link.index = i
            guard let s = nodeById[link.sourceId] else {
                fatalError("node not found: \(link.sourceId)")
            }
            guard let t = nodeById[link.targetId] else {
                fatalError("node not found: \(link.targetId)")
            }
            link.source = s
            link.target = t
            count[s.index] += 1
            count[t.index] += 1
        }

        bias = [Double](repeating: 0, count: m)
        for i in 0..<m {
            let link = links[i]
            let cs = Double(count[link.source.index])
            let ct = Double(count[link.target.index])
            bias[i] = cs / (cs + ct)
        }

        strengths = [Double](repeating: 0, count: m)
        for i in 0..<m { strengths[i] = strength(links[i]) }

        distances = [Double](repeating: 0, count: m)
        for i in 0..<m { distances[i] = distance(links[i]) }
    }

    func apply(_ alpha: Double) {
        guard let random else { return }
        let n = links.count
        for _ in 0..<iterations {
            for i in 0..<n {
                let link = links[i]
                let source = link.source!
                let target = link.target!
                var x = target.x + target.vx - source.x - source.vx
                if x == 0 || x.isNaN { x = jiggle(random) }
                var y = target.y + target.vy - source.y - source.vy
                if y == 0 || y.isNaN { y = jiggle(random) }
                var l = (x * x + y * y).squareRoot()
                l = (l - distances[i]) / l * alpha * strengths[i]
                x *= l
                y *= l
                var b = bias[i]
                target.vx -= x * b
                target.vy -= y * b
                b = 1 - b
                source.vx += x * b
                source.vy += y * b
            }
        }
    }
}

// MARK: - forceManyBody (manyBody.js)

/// Barnes-Hut n-body repulsion/attraction via the quadtree. Per-node strength
/// closure (the app charges group/company/regular nodes differently).
final class ManyBodyForce: Force {
    private let strengthFn: (PhysicsNode) -> Double
    private var distanceMin2: Double = 1
    private var distanceMax2: Double = .infinity
    private var theta2: Double = 0.81

    private var nodes: [PhysicsNode] = []
    private var random: D3Random?
    private var strengths: [Double] = []

    // Per-`apply` transient state (mirrors the JS closure vars).
    private var alpha: Double = 0
    private var currentNode: PhysicsNode!

    init(strength: @escaping (PhysicsNode) -> Double) {
        self.strengthFn = strength
    }

    func setDistanceMax(_ d: Double) { distanceMax2 = d * d }
    func setDistanceMin(_ d: Double) { distanceMin2 = d * d }
    func setTheta(_ t: Double) { theta2 = t * t }

    func initialize(_ nodes: [PhysicsNode], _ random: D3Random) {
        self.nodes = nodes
        self.random = random
        if nodes.isEmpty { strengths = []; return }
        let n = nodes.count
        strengths = [Double](repeating: 0, count: n)
        for i in 0..<n {
            let node = nodes[i]
            strengths[node.index] = strengthFn(node)
        }
    }

    func apply(_ alpha: Double) {
        guard random != nil, !nodes.isEmpty else { return }
        self.alpha = alpha
        let tree = QuadTree(nodes: nodes, x: { $0.x }, y: { $0.y })
        tree.visitAfter(accumulate)
        let n = nodes.count
        for i in 0..<n {
            currentNode = nodes[i]
            tree.visit(apply)
        }
    }

    private func accumulate(_ quad: QuadNode, _ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) {
        var strength = 0.0
        var weight = 0.0
        var x = 0.0
        var y = 0.0

        if let children = quad.children {
            // Internal node: accumulate from child quadrants.
            for i in 0..<4 {
                if let q = children[i] {
                    let c = abs(q.value)
                    if c != 0 {
                        strength += q.value
                        weight += c
                        x += c * q.cx
                        y += c * q.cy
                    }
                }
            }
            quad.cx = x / weight
            quad.cy = y / weight
        } else {
            // Leaf node: accumulate from coincident quadrants.
            var q: QuadNode? = quad
            quad.cx = quad.data!.x
            quad.cy = quad.data!.y
            while let node = q {
                strength += strengths[node.data!.index]
                q = node.next
            }
        }

        quad.value = strength
    }

    private func apply(_ quad: QuadNode, _ x1: Double, _ y0: Double, _ x2: Double, _ y1: Double) -> Bool {
        let node = currentNode!
        if quad.value == 0 { return true }

        var x = quad.cx - node.x
        var y = quad.cy - node.y
        let w = x2 - x1
        var l = x * x + y * y

        // Barnes-Hut approximation if the cell is far enough.
        if w * w / theta2 < l {
            if l < distanceMax2 {
                if x == 0 { x = jiggle(random!); l += x * x }
                if y == 0 { y = jiggle(random!); l += y * y }
                if l < distanceMin2 { l = (distanceMin2 * l).squareRoot() }
                node.vx += x * quad.value * alpha / l
                node.vy += y * quad.value * alpha / l
            }
            return true
        }
            // Otherwise process points directly (descend if internal / skip if beyond max).
        else if quad.children != nil || l >= distanceMax2 {
            return false
        }

        // Leaf, close: limit forces and randomize direction if coincident.
        if quad.data !== node || quad.next != nil {
            if x == 0 { x = jiggle(random!); l += x * x }
            if y == 0 { y = jiggle(random!); l += y * y }
            if l < distanceMin2 { l = (distanceMin2 * l).squareRoot() }
        }

        var q: QuadNode? = quad
        while let cur = q {
            if cur.data !== node {
                let w2 = strengths[cur.data!.index] * alpha / l
                node.vx += x * w2
                node.vy += y * w2
            }
            q = cur.next
        }
        return false
    }
}

// MARK: - forceCenter (center.js)

/// Recenters the whole layout so its centroid sits at (x, y). No randomness.
final class CenterForce: Force {
    var x: Double
    var y: Double
    private var strength: Double = 1
    private var nodes: [PhysicsNode] = []

    init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    func initialize(_ nodes: [PhysicsNode], _ random: D3Random) {
        self.nodes = nodes
    }

    func apply(_ alpha: Double) {
        let n = nodes.count
        if n == 0 { return }
        var sx = 0.0
        var sy = 0.0
        for node in nodes {
            sx += node.x
            sy += node.y
        }
        sx = (sx / Double(n) - x) * strength
        sy = (sy / Double(n) - y) * strength
        for node in nodes {
            node.x -= sx
            node.y -= sy
        }
    }
}

// MARK: - forceCollide (collide.js)

/// Prevents node overlap: pushes apart nodes whose circles (radius closure)
/// intersect, using a quadtree over predicted positions (x + vx, y + vy).
final class CollideForce: Force {
    private let radiusFn: (PhysicsNode) -> Double
    private var strength: Double = 1
    private let iterations: Int

    private var nodes: [PhysicsNode] = []
    private var random: D3Random?
    private var radii: [Double] = []

    init(radius: @escaping (PhysicsNode) -> Double, iterations: Int = 1) {
        self.radiusFn = radius
        self.iterations = iterations
    }

    func initialize(_ nodes: [PhysicsNode], _ random: D3Random) {
        self.nodes = nodes
        self.random = random
        if nodes.isEmpty { radii = []; return }
        let n = nodes.count
        radii = [Double](repeating: 0, count: n)
        for i in 0..<n {
            let node = nodes[i]
            radii[node.index] = radiusFn(node)
        }
    }

    func apply(_ alpha: Double) {
        guard let random, !nodes.isEmpty else { return }
        let n = nodes.count
        for _ in 0..<iterations {
            let tree = QuadTree(nodes: nodes, x: { $0.x + $0.vx }, y: { $0.y + $0.vy })
            tree.visitAfter(prepare)
            for i in 0..<n {
                let node = nodes[i]
                let ri = radii[node.index]
                let ri2 = ri * ri
                let xi = node.x + node.vx
                let yi = node.y + node.vy
                tree.visit { quad, x0, y0, x1, y1 in
                    self.collideApply(
                        quad, x0, y0, x1, y1,
                        node: node, xi: xi, yi: yi, ri: ri, ri2: ri2, random: random)
                }
            }
        }
    }

    private func collideApply(
        _ quad: QuadNode, _ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double,
        node: PhysicsNode, xi: Double, yi: Double, ri: Double, ri2: Double, random: D3Random
    ) -> Bool {
        let rj = quad.r
        let r = ri + rj
        if let data = quad.data {
            if data.index > node.index {
                var x = xi - data.x - data.vx
                var y = yi - data.y - data.vy
                var l = x * x + y * y
                if l < r * r {
                    if x == 0 { x = jiggle(random); l += x * x }
                    if y == 0 { y = jiggle(random); l += y * y }
                    let sq = l.squareRoot()
                    l = (r - sq) / sq * strength
                    x *= l
                    let rj2 = rj * rj
                    var frac = rj2 / (ri2 + rj2)
                    node.vx += x * frac
                    y *= l
                    node.vy += y * frac
                    frac = 1 - frac
                    data.vx -= x * frac
                    data.vy -= y * frac
                }
            }
            return false
        }
        return x0 > xi + r || x1 < xi - r || y0 > yi + r || y1 < yi - r
    }

    private func prepare(_ quad: QuadNode, _ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) {
        if let data = quad.data {
            quad.r = radii[data.index]
            return
        }
        quad.r = 0
        if let children = quad.children {
            for i in 0..<4 {
                if let c = children[i], c.r > quad.r {
                    quad.r = c.r
                }
            }
        }
    }
}
