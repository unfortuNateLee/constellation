// Swift port of the d3-quadtree subset d3-force depends on
// (src/quadtree.js, add.js, cover.js, visit.js, visitAfter.js).
//
// Ported from d3-quadtree (v3) by Mike Bostock — https://github.com/d3/d3-quadtree
//
// ISC License. Copyright 2010-2021 Mike Bostock.
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

/// One quadtree cell. Internal cells hold four optional children; leaf cells
/// hold a data node and a `next` link chaining *coincident* points (identical
/// x/y). The traversal order this structure imposes is load-bearing: it fixes
/// both the Barnes-Hut accumulation order and the order in which the shared LCG
/// is consumed, so it must mirror d3-quadtree exactly.
///
/// `value`, `cx`, `cy`, and `r` are the ad-hoc fields d3-force decorates onto
/// quads during `visitAfter` (many-body centroid/charge; collide max-radius).
final class QuadNode {
    // Internal node: non-nil, length 4. Leaf node: nil.
    var children: [QuadNode?]?
    // Leaf node payload.
    var data: PhysicsNode?
    // Coincident-point chain (leaf only).
    var next: QuadNode?

    // Force accumulators (many-body: value/cx/cy; collide: r).
    var value: Double = 0
    var cx: Double = 0
    var cy: Double = 0
    var r: Double = 0

    @inline(__always) var isInternal: Bool { children != nil }

    init(data: PhysicsNode) {
        self.data = data
    }
    init(internalNode: Bool) {
        self.children = [nil, nil, nil, nil]
    }
}

/// The d3-quadtree subset used by `forceManyBody` and `forceCollide`:
/// `addAll` / `cover` / `add` (identical leaf-chaining & extent doubling) and
/// `visit` / `visitAfter` (identical traversal order). `x`/`y` are pluggable
/// accessors — many-body reads `d.x`/`d.y`, collide reads `d.x+d.vx`/`d.y+d.vy`.
final class QuadTree {
    private(set) var root: QuadNode?
    private var x0 = Double.nan
    private var y0 = Double.nan
    private var x1 = Double.nan
    private var y1 = Double.nan
    private let xAccessor: (PhysicsNode) -> Double
    private let yAccessor: (PhysicsNode) -> Double

    /// `quadtree(nodes, x, y)` — construct and bulk-add.
    init(nodes: [PhysicsNode], x: @escaping (PhysicsNode) -> Double, y: @escaping (PhysicsNode) -> Double) {
        self.xAccessor = x
        self.yAccessor = y
        addAll(nodes)
    }

    // MARK: - cover.js

    @discardableResult
    private func cover(_ x: Double, _ y: Double) -> QuadTree {
        if x.isNaN || y.isNaN { return self }  // ignore invalid points

        var x0 = self.x0
        var y0 = self.y0
        var x1 = self.x1
        var y1 = self.y1

        if x0.isNaN {
            // Integer extent so later doublings don't shift quadrant boundaries.
            x0 = x.rounded(.down)
            x1 = x0 + 1
            y0 = y.rounded(.down)
            y1 = y0 + 1
        } else {
            var z = (x1 - x0) == 0 ? 1 : (x1 - x0)
            var node = root
            var parent: QuadNode?
            var i: Int

            while x0 > x || x >= x1 || y0 > y || y >= y1 {
                i = ((y < y0) ? 1 : 0) << 1 | ((x < x0) ? 1 : 0)
                parent = QuadNode(internalNode: true)
                parent!.children![i] = node
                node = parent
                z *= 2
                switch i {
                case 0: x1 = x0 + z; y1 = y0 + z
                case 1: x0 = x1 - z; y1 = y0 + z
                case 2: x1 = x0 + z; y0 = y1 - z
                case 3: x0 = x1 - z; y0 = y1 - z
                default: break
                }
            }

            if let r = root, r.isInternal { root = node }
        }

        self.x0 = x0
        self.y0 = y0
        self.x1 = x1
        self.y1 = y1
        return self
    }

    // MARK: - add.js

    private func addPoint(_ x: Double, _ y: Double, _ d: PhysicsNode) {
        if x.isNaN || y.isNaN { return }  // ignore invalid points

        var parent: QuadNode?
        var node = root
        let leaf = QuadNode(data: d)
        var x0 = self.x0
        var y0 = self.y0
        var x1 = self.x1
        var y1 = self.y1
        var xm: Double
        var ym: Double
        var right: Bool
        var bottom: Bool
        var i = 0

        // Empty tree: root becomes this leaf.
        if node == nil {
            root = leaf
            return
        }

        // Descend to the existing leaf for the new point, or insert.
        while let n = node, n.isInternal {
            xm = (x0 + x1) / 2
            right = x >= xm
            if right { x0 = xm } else { x1 = xm }
            ym = (y0 + y1) / 2
            bottom = y >= ym
            if bottom { y0 = ym } else { y1 = ym }

            parent = n
            i = (bottom ? 1 : 0) << 1 | (right ? 1 : 0)
            node = n.children![i]
            if node == nil {
                parent!.children![i] = leaf
                return
            }
        }

        // Is the new point exactly coincident with the existing point?
        let existing = node!
        let xp = xAccessor(existing.data!)
        let yp = yAccessor(existing.data!)
        if x == xp && y == yp {
            leaf.next = existing
            if let p = parent {
                p.children![i] = leaf
            } else {
                root = leaf
            }
            return
        }

        // Split the leaf until the old and new points separate.
        var j: Int
        repeat {
            if let p = parent {
                let newParent = QuadNode(internalNode: true)
                p.children![i] = newParent
                parent = newParent
            } else {
                let newParent = QuadNode(internalNode: true)
                root = newParent
                parent = newParent
            }
            xm = (x0 + x1) / 2
            right = x >= xm
            if right { x0 = xm } else { x1 = xm }
            ym = (y0 + y1) / 2
            bottom = y >= ym
            if bottom { y0 = ym } else { y1 = ym }
            i = (bottom ? 1 : 0) << 1 | (right ? 1 : 0)
            j = ((yp >= ym) ? 1 : 0) << 1 | ((xp >= xm) ? 1 : 0)
        } while i == j

        parent!.children![j] = existing
        parent!.children![i] = leaf
    }

    // MARK: - addAll (add.js)

    private func addAll(_ data: [PhysicsNode]) {
        let n = data.count
        var xz = [Double](repeating: 0, count: n)
        var yz = [Double](repeating: 0, count: n)
        var x0 = Double.infinity
        var y0 = Double.infinity
        var x1 = -Double.infinity
        var y1 = -Double.infinity

        // Compute the points and their extent.
        for i in 0..<n {
            let x = xAccessor(data[i])
            let y = yAccessor(data[i])
            if x.isNaN || y.isNaN { continue }
            xz[i] = x
            yz[i] = y
            if x < x0 { x0 = x }
            if x > x1 { x1 = x }
            if y < y0 { y0 = y }
            if y > y1 { y1 = y }
        }

        // If there were no (valid) points, abort.
        if x0 > x1 || y0 > y1 { return }

        // Expand the tree to cover the new points.
        cover(x0, y0).cover(x1, y1)

        // Add the new points.
        for i in 0..<n {
            addPoint(xz[i], yz[i], data[i])
        }
    }

    // MARK: - visit.js (pre-order; callback returns true to prune the subtree)

    func visit(_ callback: (QuadNode, Double, Double, Double, Double) -> Bool) {
        guard let r = root else { return }
        var quads: [(QuadNode, Double, Double, Double, Double)] = [(r, x0, y0, x1, y1)]
        while let q = quads.popLast() {
            let (node, qx0, qy0, qx1, qy1) = q
            if !callback(node, qx0, qy0, qx1, qy1), let ch = node.children {
                let xm = (qx0 + qx1) / 2
                let ym = (qy0 + qy1) / 2
                if let c = ch[3] { quads.append((c, xm, ym, qx1, qy1)) }
                if let c = ch[2] { quads.append((c, qx0, ym, xm, qy1)) }
                if let c = ch[1] { quads.append((c, xm, qy0, qx1, ym)) }
                if let c = ch[0] { quads.append((c, qx0, qy0, xm, ym)) }
            }
        }
    }

    // MARK: - visitAfter.js (post-order)

    func visitAfter(_ callback: (QuadNode, Double, Double, Double, Double) -> Void) {
        guard let r = root else { return }
        var quads: [(QuadNode, Double, Double, Double, Double)] = [(r, x0, y0, x1, y1)]
        var next: [(QuadNode, Double, Double, Double, Double)] = []
        while let q = quads.popLast() {
            let (node, qx0, qy0, qx1, qy1) = q
            if let ch = node.children {
                let xm = (qx0 + qx1) / 2
                let ym = (qy0 + qy1) / 2
                if let c = ch[0] { quads.append((c, qx0, qy0, xm, ym)) }
                if let c = ch[1] { quads.append((c, xm, qy0, qx1, ym)) }
                if let c = ch[2] { quads.append((c, qx0, ym, xm, qy1)) }
                if let c = ch[3] { quads.append((c, xm, ym, qx1, qy1)) }
            }
            next.append(q)
        }
        while let q = next.popLast() {
            callback(q.0, q.1, q.2, q.3, q.4)
        }
    }
}
