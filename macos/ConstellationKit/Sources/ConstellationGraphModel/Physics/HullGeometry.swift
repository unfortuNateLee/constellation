import CoreGraphics

/// HullGeometry — the pure math behind cluster hulls: convex-hull computation,
/// the padded hull polygon drawn around a cluster's member nodes, and the
/// label anchor/scale/opacity rules used to place a hull's caption.
///
/// This mirrors `js/graph.js`'s `_hullPath`, `_hullLabelTransform`
/// (`_hullLabelAnchor` + `_hullLabelScaleFactor`), and `_hullLabelOpacity`,
/// per spec §15.1. This target is UI-framework-free (no SwiftUI/AppKit) —
/// everything here is expressed with `CoreGraphics` value types only, so it
/// can be exercised and unit-tested without a view hierarchy.
///
/// ## Convex hull
///
/// `js/graph.js` calls `d3.polygonHull(points)` (from the vendored
/// `js/vendor/d3.v7.min.js`, d3-polygon module). That is **not** a hand-rolled
/// helper — it's Andrew's monotone chain, and `convexHull(_:)` below is an
/// exact port of it: same lexicographic sort, same upper/lower hull sweep via
/// `computeUpperHullIndexes`, same "keep only strictly-left turns" rule
/// (`cross <= 0` pops the middle point), and the same null-for-fewer-than-3
/// return. Two consequences carried over on purpose:
///   - Collinear points are dropped from the hull (a straight run of points
///     collapses to just its two endpoints).
///   - Exact-duplicate points collapse away too (they produce a zero-area
///     turn against their neighbor and get popped), with no special-casing
///     needed — it falls out of the same cross-product rule.
///
/// ## Hull polygon (`_hullPath`)
///
/// `_hullPath(hull, nodes, nodeRadius)` in `js/graph.js`:
///   1. Returns `''` (no path at all) when fewer than 2 members have a
///      resolved, finite position — this includes the single-member case,
///      which draws **no hull**, not a circle or point marker.
///   2. Otherwise, for every member it contributes the 4 corners of the
///      square circumscribing that member at radius `nodeRadius(member) + 12`
///      (i.e. the node's on-screen radius padded by a flat 12px):
///      `(x∓r, y∓r)` for all four sign combinations.
///   3. Runs `d3.polygonHull` over the full combined corner-point set and
///      builds the SVG `d` attribute as **straight line segments only** —
///      `` `M${polygon.join('L')}Z` `` — there is no curve interpolator
///      (no `d3.curveCardinalClosed`/`d3.line().curve(...)`) and no corner
///      rounding. `hullPath(memberPositions:radii:)` mirrors this exactly,
///      returning the polygon vertices (nil for the same < 2 member case);
///      turning that into an SVG-style path string is a one-line reference
///      convenience (`svgPathString(for:)`), not something the renderer
///      needs to consume as a string.
///
/// ## Hull label anchor/scale (`_hullLabelTransform`)
///
/// `_hullLabelTransform` composes `_hullLabelAnchor` (a translate) with
/// `_hullLabelScaleFactor` (a scale), as an SVG
/// `translate(x,y) scale(s)` transform string (scale applies to the glyph
/// first, then translate positions it — SVG transform lists apply
/// right-to-left to a point). It returns `translate(-9999,-9999)` — i.e.
/// "off-screen" — when the anchor is unavailable (also gated on `< 2`
/// members). This file exposes the two pieces separately as
/// `hullLabelAnchor(...)` (nil in that same degenerate case, letting the
/// caller decide how to hide the label) and `hullLabelScaleFactor(...)`,
/// since composing them into a concrete transform is a rendering-layer
/// decision this UI-framework-free target shouldn't make.
///
/// `_hullLabelAnchor`'s bounding box does **not** reuse the `nodeRadius(d)`
/// closure that `_hullPath` receives — it inlines its own radius formula:
///
/// ```js
/// const r =
///   (node.isGroupNode
///     ? Math.max(12, 18 - (node.groupDepth || 1) * 1.5)
///     : node.isCompany ? 12 : node.isVirtual ? 6 : 10) +
///   Math.min((node.connectionCount || 0) * 1.5, 10) +
///   12;
/// ```
///
/// Notably, unlike the real `nodeRadius(d)` (which returns early for group
/// nodes with **no** connection-count bonus added), this inlined formula
/// always adds the connection-count bonus, even for group nodes — a real
/// divergence between the two radius formulas in the JS, preserved here via
/// `hullLabelBoundsRadius(...)` rather than "fixed".
///
/// `_hullLabelScaleFactor` is `1 / max(0.45, min(zoomScale, 1.2))`, with
/// `zoomScale` itself defaulting to `1` when falsy (unset/0/NaN) before that
/// clamp — `hullLabelScaleFactor(zoomScale:)` mirrors that default too, as
/// does the `12 + 10 / max(zoomScale, 0.45)` label offset inside
/// `_hullLabelAnchor`.
///
/// ## Hull label opacity (`_hullLabelOpacity`)
///
/// `0` when fewer than 2 members or the hull has no label; otherwise `0.92`
/// for 3+ members, `0.84` for exactly 2.
public enum HullGeometry {
    // MARK: - Convex hull (d3-polygon's `polygonHull`, ported exactly)

    /// `(b - a) × (c - a)`, matching d3-polygon's `cross` helper. Positive
    /// for a counter-clockwise turn `a -> b -> c` in a y-up frame (SVG's
    /// y-down frame flips the visual handedness, but that's immaterial here
    /// — only the sign convention against d3's own flip step matters, and
    /// this is copied verbatim).
    private static func cross(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint) -> CGFloat {
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    }

    /// Port of d3-polygon's `computeUpperHullIndexes`: a single monotone
    /// sweep over already lexicographically-sorted points, popping the most
    /// recent hull point whenever it and the next candidate don't make a
    /// strict left turn (`cross <= 0` pops — this is what makes collinear
    /// runs and exact duplicates collapse to their endpoints).
    private static func computeUpperHullIndexes(_ points: [CGPoint]) -> [Int] {
        let n = points.count
        guard n >= 2 else { return Array(0..<n) }
        var indexes = [0, 1]
        var size = 2
        var candidate = 2
        while candidate < n {
            while size > 1
                && cross(points[indexes[size - 2]], points[indexes[size - 1]], points[candidate]) <= 0
            {
                size -= 1
            }
            if size < indexes.count {
                indexes[size] = candidate
            } else {
                indexes.append(candidate)
            }
            size += 1
            candidate += 1
        }
        return Array(indexes[0..<size])
    }

    /// Convex hull via Andrew's monotone chain — an exact port of
    /// `d3.polygonHull` (see the file-level doc comment for the derivation
    /// and the degenerate-case behavior this preserves).
    ///
    /// Returns `nil` for fewer than 3 points, matching `d3.polygonHull`'s
    /// `null` return (this is the only guard; degenerate inputs like all
    /// points being exactly collinear are handled by the sweep itself, not
    /// by an early return here).
    public static func convexHull(_ points: [CGPoint]) -> [CGPoint]? {
        let n = points.count
        guard n >= 3 else { return nil }

        // d3 sorts a (point, originalIndex) pair lexicographically by
        // (x, then y), then builds the "flipped" (y negated) array in that
        // same sorted order so the lower-hull sweep can reuse the upper-hull
        // routine. Index `k` in `sortedPoints`/`flippedPoints` always refers
        // to the same original point.
        let order = (0..<n).sorted { i, j in
            if points[i].x != points[j].x { return points[i].x < points[j].x }
            return points[i].y < points[j].y
        }
        let sortedPoints = order.map { points[$0] }
        let flippedPoints = sortedPoints.map { CGPoint(x: $0.x, y: -$0.y) }

        let upperIndexes = computeUpperHullIndexes(sortedPoints)
        let lowerIndexes = computeUpperHullIndexes(flippedPoints)

        // Both sweeps always retain sorted-position 0 as their first index
        // and sorted-position (n-1) as their last (see the file-level doc
        // comment's derivation) — so in practice these are always true. They
        // are still computed, not hardcoded, to keep this a faithful port.
        let skipLeft = lowerIndexes.first == upperIndexes.first
        let skipRight = lowerIndexes.last == upperIndexes.last

        var hull: [CGPoint] = []
        hull.reserveCapacity(upperIndexes.count + lowerIndexes.count)

        // Upper hull, right-to-left.
        for i in stride(from: upperIndexes.count - 1, through: 0, by: -1) {
            hull.append(points[order[upperIndexes[i]]])
        }
        // Lower hull, left-to-right, skipping the endpoints shared with the
        // upper hull.
        let lowerStart = skipLeft ? 1 : 0
        let lowerEnd = lowerIndexes.count - (skipRight ? 1 : 0)
        if lowerStart < lowerEnd {
            for i in lowerStart..<lowerEnd {
                hull.append(points[order[lowerIndexes[i]]])
            }
        }
        return hull
    }

    // MARK: - Hull polygon (`_hullPath`)

    /// The padded hull polygon around a cluster's member nodes — a port of
    /// `_hullPath`. Each member contributes the 4 corners of the square
    /// circumscribing it at `radii[i] + padding` (JS hardcodes `padding` as
    /// `12`); the combined corner set is run through `convexHull(_:)`.
    ///
    /// `memberPositions` and `radii` must be the same length (each entry is
    /// one already-filtered, finite-position member and its on-screen node
    /// radius — the "filter to members with a resolved position" step from
    /// `_hullPath` is the caller's job, same as the JS does before calling
    /// it).
    ///
    /// Returns `nil` for fewer than 2 members, matching `_hullPath`'s `''`
    /// (no path drawn — including the single-member case, which draws
    /// nothing, not a circle). For 2+ members this always succeeds: even 2
    /// members contribute 8 corner points, well above `convexHull`'s 3-point
    /// floor.
    public static func hullPath(
        memberPositions: [CGPoint],
        radii: [CGFloat],
        padding: CGFloat = 12
    ) -> [CGPoint]? {
        precondition(
            memberPositions.count == radii.count,
            "memberPositions and radii must be parallel arrays"
        )
        guard memberPositions.count >= 2 else { return nil }

        var corners: [CGPoint] = []
        corners.reserveCapacity(memberPositions.count * 4)
        for (position, radius) in zip(memberPositions, radii) {
            let r = radius + padding
            corners.append(CGPoint(x: position.x - r, y: position.y - r))
            corners.append(CGPoint(x: position.x - r, y: position.y + r))
            corners.append(CGPoint(x: position.x + r, y: position.y - r))
            corners.append(CGPoint(x: position.x + r, y: position.y + r))
        }
        return convexHull(corners)
    }

    /// Reference-only convenience mirroring `` `M${polygon.join('L')}Z` ``
    /// (straight line segments, no curve, no rounding — see the file-level
    /// doc comment). Not needed by a SwiftUI `Path` (which would just walk
    /// the vertex array with `move(to:)`/`addLine(to:)`/`closeSubpath()`),
    /// but kept for parity with the JS shape and for testing against
    /// node-verified ground truth strings.
    public static func svgPathString(for polygon: [CGPoint]) -> String {
        guard !polygon.isEmpty else { return "" }
        let coordinates = polygon.map { point in
            "\(formatCoordinate(point.x)),\(formatCoordinate(point.y))"
        }
        return "M" + coordinates.joined(separator: "L") + "Z"
    }

    /// Matches JS `Number#toString` closely enough for the integer/simple
    /// decimal coordinates hull geometry actually produces: whole values
    /// print without a trailing `.0`.
    private static func formatCoordinate(_ value: CGFloat) -> String {
        if value == value.rounded() && abs(value) < 1e15 {
            return String(Int(value))
        }
        return "\(Double(value))"
    }

    // MARK: - Hull label anchor (`_hullLabelAnchor`)

    /// The radius `_hullLabelAnchor` inlines per member when computing its
    /// bounding box — a distinct formula from the `nodeRadius(d)` closure
    /// `_hullPath` is handed (see the file-level doc comment: group nodes
    /// get the connection-count bonus here but not in `nodeRadius`).
    ///
    /// `groupDepth` mirrors JS `node.groupDepth || 1`: `nil` *or* `0` become
    /// `1`; any other value (including a negative one, which JS's `||`
    /// would not replace) passes through unchanged.
    public static func hullLabelBoundsRadius(
        isGroupNode: Bool,
        groupDepth: Int?,
        isCompany: Bool,
        isVirtual: Bool,
        connectionCount: Int
    ) -> CGFloat {
        let base: CGFloat
        if isGroupNode {
            let depth = (groupDepth == nil || groupDepth == 0) ? 1 : groupDepth!
            base = max(12, 18 - CGFloat(depth) * 1.5)
        } else if isCompany {
            base = 12
        } else if isVirtual {
            base = 6
        } else {
            base = 10
        }
        let bonus = min(CGFloat(connectionCount) * 1.5, 10)
        return base + bonus + 12
    }

    /// The hull label's anchor point (top-center of the padded member
    /// bounding box, offset upward) — a port of `_hullLabelAnchor`.
    ///
    /// `boundsRadii[i]` is the per-member radius from
    /// `hullLabelBoundsRadius(...)` (or an equivalent), *not* the
    /// `radii` passed to `hullPath(...)` — the JS uses two different radius
    /// formulas for the hull polygon vs. the label's bounding box (see the
    /// file-level doc comment).
    ///
    /// Returns `nil` for fewer than 2 members, matching `_hullLabelAnchor`'s
    /// own `null` (which `_hullLabelTransform` turns into an off-screen
    /// `translate(-9999,-9999)` — a rendering-layer decision left to the
    /// caller here).
    public static func hullLabelAnchor(
        memberPositions: [CGPoint],
        boundsRadii: [CGFloat],
        zoomScale: CGFloat
    ) -> CGPoint? {
        precondition(
            memberPositions.count == boundsRadii.count,
            "memberPositions and boundsRadii must be parallel arrays"
        )
        guard memberPositions.count >= 2 else { return nil }

        var minX = CGFloat.infinity
        var maxX = -CGFloat.infinity
        var minY = CGFloat.infinity
        var maxY = -CGFloat.infinity
        for (position, r) in zip(memberPositions, boundsRadii) {
            minX = min(minX, position.x - r)
            maxX = max(maxX, position.x + r)
            minY = min(minY, position.y - r)
            maxY = max(maxY, position.y + r)
        }
        _ = maxY  // computed to mirror the JS reduce exactly; unused by the anchor itself, same as JS.

        let offset = 12 + 10 / max(effectiveZoomScale(zoomScale), 0.45)
        return CGPoint(x: (minX + maxX) / 2, y: minY - offset)
    }

    /// `_hullLabelScaleFactor`: `1 / max(0.45, min(zoomScale, 1.2))`, with
    /// the same "falsy zoom defaults to 1" rule `_hullLabelAnchor`'s offset
    /// uses (JS: `this._zoomScale || 1`).
    public static func hullLabelScaleFactor(zoomScale: CGFloat) -> CGFloat {
        1 / max(0.45, min(effectiveZoomScale(zoomScale), 1.2))
    }

    /// JS `this._zoomScale || 1`: `0` and `NaN` (both falsy) default to `1`;
    /// any other value, including negative ones, passes through unchanged.
    private static func effectiveZoomScale(_ zoomScale: CGFloat) -> CGFloat {
        (zoomScale == 0 || zoomScale.isNaN) ? 1 : zoomScale
    }

    // MARK: - Hull label opacity (`_hullLabelOpacity`)

    /// `_hullLabelOpacity`: `0` when fewer than 2 members or there's no
    /// label to show; otherwise `0.92` for 3+ members, `0.84` for exactly 2.
    public static func hullLabelOpacity(memberCount: Int, hasLabel: Bool) -> CGFloat {
        guard memberCount >= 2, hasLabel else { return 0 }
        return memberCount >= 3 ? 0.92 : 0.84
    }
}
