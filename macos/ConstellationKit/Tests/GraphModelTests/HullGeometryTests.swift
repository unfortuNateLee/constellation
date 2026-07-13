import CoreGraphics
import Testing

@testable import ConstellationGraphModel

/// Ground truth here is cross-checked against the *real* `d3.polygonHull`
/// (from the vendored `js/vendor/d3.v7.min.js`) and a reimplementation of
/// `js/graph.js`'s `_hullPath` / `_hullLabelAnchor` / `_hullLabelScaleFactor`
/// / `_hullLabelOpacity` math extracted by reading the class (it's not
/// separately importable — `GraphRenderer` is a DOM-coupled class, so the
/// geometry was copied verbatim into a throwaway script rather than
/// requiring `graph.js` itself).
///
/// `js/vendor/d3.v7.min.js` needs a `.cjs` extension to `require()` cleanly
/// under plain `node -e` from this repo (the repo's `package.json` has
/// `"type": "module"`, so Node treats the vendored `.js` file as ESM by
/// nearest-package.json unless the extension forces CommonJS) — copy it
/// first, then run:
///
///     cp js/vendor/d3.v7.min.js /tmp/d3.v7.min.cjs
///     node -e "
///     const d3 = require('/tmp/d3.v7.min.cjs');
///
///     function hullPath(members, nodeRadiusFn) {
///       if (members.length < 2) return '';
///       const points = [];
///       for (const m of members) {
///         const r = nodeRadiusFn(m) + 12;
///         points.push([m.x - r, m.y - r], [m.x - r, m.y + r], [m.x + r, m.y - r], [m.x + r, m.y + r]);
///       }
///       const polygon = d3.polygonHull(points);
///       return polygon ? \`M\${polygon.join('L')}Z\` : '';
///     }
///
///     // Triangle, radius 10 + 12 padding:
///     console.log(hullPath([{x:0,y:0},{x:100,y:0},{x:50,y:80}], () => 10));
///     // -> M122,22L122,-22L-22,-22L-22,22L28,102L72,102Z
///
///     // 3 collinear nodes collapse to the bounding rectangle of the ends:
///     console.log(hullPath([{x:0,y:0},{x:50,y:0},{x:100,y:0}], () => 5));
///     // -> M117,17L117,-17L-17,-17L-17,17Z
///
///     // Single node: no path at all.
///     console.log(JSON.stringify(hullPath([{x:10,y:10}], () => 10)));
///     // -> \"\"
///
///     // Two nodes, aligned:
///     console.log(hullPath([{x:0,y:0},{x:100,y:0}], () => 10));
///     // -> M122,22L122,-22L-22,-22L-22,22Z
///
///     // Two nodes, diagonal:
///     console.log(hullPath([{x:0,y:0},{x:60,y:40}], () => 8));
///     // -> M80,60L80,20L20,-20L-20,-20L-20,20L40,60Z
///
///     // Raw d3.polygonHull: interior point dropped, duplicate point collapsed.
///     console.log(JSON.stringify(d3.polygonHull([[0,0],[10,0],[10,10],[0,10],[5,5]])));
///     // -> [[10,10],[10,0],[0,0],[0,10]]
///     console.log(JSON.stringify(d3.polygonHull([[0,0],[1,0],[2,0],[3,0]])));
///     // -> [[3,0],[0,0]]
///     console.log(JSON.stringify(d3.polygonHull([[0,0],[10,0],[10,10],[0,10],[0,0]])));
///     // -> [[10,10],[10,0],[0,0],[0,10]]
///     "
///
/// `_hullLabelAnchor`/`_hullLabelScaleFactor` ground truth (same throwaway
/// script, reimplementing the inlined bounding-box radius formula and the
/// `12 + 10 / max(zoomScale, 0.45)` offset read from `js/graph.js`):
///
///     // 3 members, mixed node kinds, zoom 1:
///     // members: {x:0,y:0,connectionCount:2}, {x:100,y:0,isCompany:true}, {x:50,y:80,isVirtual:true}
///     // -> anchor {x:49.5,y:-47}, scale@1 = 1
///     // same members at zoom 0.5 -> anchor {x:49.5,y:-57}, scale@0.5 = 2
///     // same members at zoom 2   -> anchor {x:49.5,y:-42}, scale@2 = 0.8333333333333334
///     // group-node quirk: {x:0,y:0,isGroupNode:true,groupDepth:2,connectionCount:4}, {x:100,y:0,connectionCount:0}
///     //   -> anchor {x:44.5,y:-55} (group node's bounding radius still gets the connection-count bonus)
///     // very low zoom clamp: {x:0,y:0},{x:100,y:0} @ zoom 0.1 -> anchor {x:50,y:-56.22222222222222}, scale@0.1 = 2.2222222222222223
///
/// `_hullLabelOpacity`: 0 for 0/1 members, 0 with no label regardless of
/// count, 0.84 for exactly 2 members, 0.92 for 3+.
struct HullGeometryTests {
    // MARK: - Test helpers

    private func isClose(_ a: CGFloat, _ b: CGFloat, tolerance: CGFloat = 1e-9) -> Bool {
        abs(a - b) <= tolerance
    }

    private func pointsMatch(_ a: [CGPoint], _ b: [CGPoint], tolerance: CGFloat = 1e-9) -> Bool {
        guard a.count == b.count else { return false }
        return zip(a, b).allSatisfy {
            isClose($0.x, $1.x, tolerance: tolerance) && isClose($0.y, $1.y, tolerance: tolerance)
        }
    }

    // MARK: - convexHull

    @Test func fewerThanThreePointsReturnsNil() {
        #expect(HullGeometry.convexHull([]) == nil)
        #expect(HullGeometry.convexHull([CGPoint(x: 0, y: 0)]) == nil)
        #expect(HullGeometry.convexHull([CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 1)]) == nil)
    }

    @Test func squareWithInteriorPointDropsTheInteriorPoint() {
        // node-verified: d3.polygonHull([[0,0],[10,0],[10,10],[0,10],[5,5]]) -> [[10,10],[10,0],[0,0],[0,10]]
        let points = [
            CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 0), CGPoint(x: 10, y: 10), CGPoint(x: 0, y: 10),
            CGPoint(x: 5, y: 5),
        ]
        let expected = [
            CGPoint(x: 10, y: 10), CGPoint(x: 10, y: 0), CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 10),
        ]
        let hull = HullGeometry.convexHull(points)
        #expect(hull != nil)
        #expect(pointsMatch(hull!, expected))
    }

    @Test func allCollinearPointsCollapseToTheirTwoEndpoints() {
        // node-verified: d3.polygonHull([[0,0],[1,0],[2,0],[3,0]]) -> [[3,0],[0,0]]
        let points = [
            CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 2, y: 0), CGPoint(x: 3, y: 0),
        ]
        let expected = [CGPoint(x: 3, y: 0), CGPoint(x: 0, y: 0)]
        let hull = HullGeometry.convexHull(points)
        #expect(hull != nil)
        #expect(pointsMatch(hull!, expected))
    }

    @Test func duplicatePointsCollapseWithoutSpecialCasing() {
        // node-verified: d3.polygonHull([[0,0],[10,0],[10,10],[0,10],[0,0]]) -> [[10,10],[10,0],[0,0],[0,10]]
        let points = [
            CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 0), CGPoint(x: 10, y: 10), CGPoint(x: 0, y: 10),
            CGPoint(x: 0, y: 0),
        ]
        let expected = [
            CGPoint(x: 10, y: 10), CGPoint(x: 10, y: 0), CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 10),
        ]
        let hull = HullGeometry.convexHull(points)
        #expect(hull != nil)
        #expect(pointsMatch(hull!, expected))
    }

    // MARK: - hullPath (`_hullPath`)

    @Test func triangleHullWithPadding() {
        // node-verified: M122,22L122,-22L-22,-22L-22,22L28,102L72,102Z
        let positions = [
            CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0), CGPoint(x: 50, y: 80),
        ]
        let radii: [CGFloat] = [10, 10, 10]
        let expected = [
            CGPoint(x: 122, y: 22), CGPoint(x: 122, y: -22), CGPoint(x: -22, y: -22),
            CGPoint(x: -22, y: 22), CGPoint(x: 28, y: 102), CGPoint(x: 72, y: 102),
        ]
        let hull = HullGeometry.hullPath(memberPositions: positions, radii: radii)
        #expect(hull != nil)
        #expect(pointsMatch(hull!, expected))
        #expect(
            HullGeometry.svgPathString(for: hull!) == "M122,22L122,-22L-22,-22L-22,22L28,102L72,102Z"
        )
    }

    @Test func collinearMembersCollapseToBoundingRectangle() {
        // node-verified: M117,17L117,-17L-17,-17L-17,17Z
        let positions = [
            CGPoint(x: 0, y: 0), CGPoint(x: 50, y: 0), CGPoint(x: 100, y: 0),
        ]
        let radii: [CGFloat] = [5, 5, 5]
        let expected = [
            CGPoint(x: 117, y: 17), CGPoint(x: 117, y: -17), CGPoint(x: -17, y: -17),
            CGPoint(x: -17, y: 17),
        ]
        let hull = HullGeometry.hullPath(memberPositions: positions, radii: radii)
        #expect(hull != nil)
        #expect(pointsMatch(hull!, expected))
        #expect(HullGeometry.svgPathString(for: hull!) == "M117,17L117,-17L-17,-17L-17,17Z")
    }

    @Test func singleMemberDrawsNoHull() {
        // node-verified: hullPath([{x:10,y:10}], () => 10) === '' (no path at all,
        // not a degenerate circle/point marker).
        let hull = HullGeometry.hullPath(
            memberPositions: [CGPoint(x: 10, y: 10)],
            radii: [10]
        )
        #expect(hull == nil)
        #expect(HullGeometry.svgPathString(for: []) == "")
    }

    @Test func noMembersDrawsNoHull() {
        let hull = HullGeometry.hullPath(memberPositions: [], radii: [])
        #expect(hull == nil)
    }

    @Test func twoMembersAlignedProduceARectangle() {
        // node-verified: M122,22L122,-22L-22,-22L-22,22Z
        let positions = [CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0)]
        let radii: [CGFloat] = [10, 10]
        let expected = [
            CGPoint(x: 122, y: 22), CGPoint(x: 122, y: -22), CGPoint(x: -22, y: -22),
            CGPoint(x: -22, y: 22),
        ]
        let hull = HullGeometry.hullPath(memberPositions: positions, radii: radii)
        #expect(hull != nil)
        #expect(pointsMatch(hull!, expected))
        #expect(HullGeometry.svgPathString(for: hull!) == "M122,22L122,-22L-22,-22L-22,22Z")
    }

    @Test func twoMembersDiagonalProduceAHexagon() {
        // node-verified: M80,60L80,20L20,-20L-20,-20L-20,20L40,60Z
        let positions = [CGPoint(x: 0, y: 0), CGPoint(x: 60, y: 40)]
        let radii: [CGFloat] = [8, 8]
        let expected = [
            CGPoint(x: 80, y: 60), CGPoint(x: 80, y: 20), CGPoint(x: 20, y: -20),
            CGPoint(x: -20, y: -20), CGPoint(x: -20, y: 20), CGPoint(x: 40, y: 60),
        ]
        let hull = HullGeometry.hullPath(memberPositions: positions, radii: radii)
        #expect(hull != nil)
        #expect(pointsMatch(hull!, expected))
        #expect(HullGeometry.svgPathString(for: hull!) == "M80,60L80,20L20,-20L-20,-20L-20,20L40,60Z")
    }

    // MARK: - hullLabelBoundsRadius / hullLabelAnchor (`_hullLabelAnchor`)

    @Test func labelBoundsRadiusPlainNode() {
        // base 10 (plain contact) + bonus min(2*1.5,10)=3 + 12 padding = 25
        let r = HullGeometry.hullLabelBoundsRadius(
            isGroupNode: false, groupDepth: nil, isCompany: false, isVirtual: false,
            connectionCount: 2
        )
        #expect(isClose(r, 25))
    }

    @Test func labelBoundsRadiusCompanyNode() {
        // base 12 + bonus 0 + 12 = 24
        let r = HullGeometry.hullLabelBoundsRadius(
            isGroupNode: false, groupDepth: nil, isCompany: true, isVirtual: false,
            connectionCount: 0
        )
        #expect(isClose(r, 24))
    }

    @Test func labelBoundsRadiusVirtualNode() {
        // base 6 + bonus 0 + 12 = 18
        let r = HullGeometry.hullLabelBoundsRadius(
            isGroupNode: false, groupDepth: nil, isCompany: false, isVirtual: true,
            connectionCount: 0
        )
        #expect(isClose(r, 18))
    }

    @Test func labelBoundsRadiusGroupNodeStillGetsConnectionBonus() {
        // Divergence from `nodeRadius(d)`: group nodes get the connection-count
        // bonus here. base max(12, 18 - 2*1.5) = 15, bonus min(4*1.5,10)=6, +12 = 33.
        let r = HullGeometry.hullLabelBoundsRadius(
            isGroupNode: true, groupDepth: 2, isCompany: false, isVirtual: false,
            connectionCount: 4
        )
        #expect(isClose(r, 33))
    }

    @Test func labelBoundsRadiusGroupDepthFalsyDefaultsToOne() {
        // JS `node.groupDepth || 1`: nil and 0 both become 1.
        let withNil = HullGeometry.hullLabelBoundsRadius(
            isGroupNode: true, groupDepth: nil, isCompany: false, isVirtual: false,
            connectionCount: 0
        )
        let withZero = HullGeometry.hullLabelBoundsRadius(
            isGroupNode: true, groupDepth: 0, isCompany: false, isVirtual: false,
            connectionCount: 0
        )
        // base max(12, 18 - 1*1.5) = 16.5, bonus 0, +12 = 28.5
        #expect(isClose(withNil, 28.5))
        #expect(isClose(withZero, 28.5))
    }

    @Test func labelAnchorThreeMembersAtZoomOne() {
        // node-verified anchor {x:49.5,y:-47} at zoom 1.
        let positions = [
            CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0), CGPoint(x: 50, y: 80),
        ]
        let radii: [CGFloat] = [
            HullGeometry.hullLabelBoundsRadius(
                isGroupNode: false, groupDepth: nil, isCompany: false, isVirtual: false,
                connectionCount: 2
            ),
            HullGeometry.hullLabelBoundsRadius(
                isGroupNode: false, groupDepth: nil, isCompany: true, isVirtual: false,
                connectionCount: 0
            ),
            HullGeometry.hullLabelBoundsRadius(
                isGroupNode: false, groupDepth: nil, isCompany: false, isVirtual: true,
                connectionCount: 0
            ),
        ]
        let anchor = HullGeometry.hullLabelAnchor(
            memberPositions: positions, boundsRadii: radii, zoomScale: 1
        )
        #expect(anchor != nil)
        #expect(isClose(anchor!.x, 49.5))
        #expect(isClose(anchor!.y, -47))
    }

    @Test func labelAnchorSameMembersAtZoomZeroPointFive() {
        // node-verified anchor {x:49.5,y:-57} at zoom 0.5 (2-member subset).
        let positions = [CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0)]
        let radii: [CGFloat] = [
            HullGeometry.hullLabelBoundsRadius(
                isGroupNode: false, groupDepth: nil, isCompany: false, isVirtual: false,
                connectionCount: 2
            ),
            HullGeometry.hullLabelBoundsRadius(
                isGroupNode: false, groupDepth: nil, isCompany: true, isVirtual: false,
                connectionCount: 0
            ),
        ]
        let anchor = HullGeometry.hullLabelAnchor(
            memberPositions: positions, boundsRadii: radii, zoomScale: 0.5
        )
        #expect(anchor != nil)
        #expect(isClose(anchor!.x, 49.5))
        #expect(isClose(anchor!.y, -57))
    }

    @Test func labelAnchorSameMembersAtZoomTwo() {
        // node-verified anchor {x:49.5,y:-42} at zoom 2.
        let positions = [CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0)]
        let radii: [CGFloat] = [
            HullGeometry.hullLabelBoundsRadius(
                isGroupNode: false, groupDepth: nil, isCompany: false, isVirtual: false,
                connectionCount: 2
            ),
            HullGeometry.hullLabelBoundsRadius(
                isGroupNode: false, groupDepth: nil, isCompany: true, isVirtual: false,
                connectionCount: 0
            ),
        ]
        let anchor = HullGeometry.hullLabelAnchor(
            memberPositions: positions, boundsRadii: radii, zoomScale: 2
        )
        #expect(anchor != nil)
        #expect(isClose(anchor!.x, 49.5))
        #expect(isClose(anchor!.y, -42))
    }

    @Test func labelAnchorGroupNodeQuirk() {
        // node-verified anchor {x:44.5,y:-55} at zoom 1: the group node's
        // bounding radius still includes the connection-count bonus.
        let positions = [CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0)]
        let radii: [CGFloat] = [
            HullGeometry.hullLabelBoundsRadius(
                isGroupNode: true, groupDepth: 2, isCompany: false, isVirtual: false,
                connectionCount: 4
            ),
            HullGeometry.hullLabelBoundsRadius(
                isGroupNode: false, groupDepth: nil, isCompany: false, isVirtual: false,
                connectionCount: 0
            ),
        ]
        let anchor = HullGeometry.hullLabelAnchor(
            memberPositions: positions, boundsRadii: radii, zoomScale: 1
        )
        #expect(anchor != nil)
        #expect(isClose(anchor!.x, 44.5))
        #expect(isClose(anchor!.y, -55))
    }

    @Test func labelAnchorVeryLowZoomClampsOffsetDenominator() {
        // node-verified anchor {x:50,y:-56.22222222222222} at zoom 0.1
        // (offset denominator clamps to 0.45, not 0.1).
        let positions = [CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0)]
        let radii: [CGFloat] = [22, 22]
        let anchor = HullGeometry.hullLabelAnchor(
            memberPositions: positions, boundsRadii: radii, zoomScale: 0.1
        )
        #expect(anchor != nil)
        #expect(isClose(anchor!.x, 50))
        #expect(isClose(anchor!.y, -56.22222222222222, tolerance: 1e-6))
    }

    @Test func labelAnchorFewerThanTwoMembersReturnsNil() {
        #expect(
            HullGeometry.hullLabelAnchor(memberPositions: [], boundsRadii: [], zoomScale: 1) == nil
        )
        #expect(
            HullGeometry.hullLabelAnchor(
                memberPositions: [CGPoint(x: 0, y: 0)], boundsRadii: [10], zoomScale: 1
            ) == nil
        )
    }

    // MARK: - hullLabelScaleFactor (`_hullLabelScaleFactor`)

    @Test func labelScaleFactorMatchesJS() {
        // node-verified: scale@1 = 1, scale@0.5 = 2, scale@2 = 0.8333333333333334,
        // scale@0.1 = 2.2222222222222223 (all clamped to [0.45, 1.2] before inverting).
        #expect(isClose(HullGeometry.hullLabelScaleFactor(zoomScale: 1), 1))
        #expect(isClose(HullGeometry.hullLabelScaleFactor(zoomScale: 0.5), 2))
        #expect(
            isClose(
                HullGeometry.hullLabelScaleFactor(zoomScale: 2), 0.8333333333333334, tolerance: 1e-9
            )
        )
        #expect(
            isClose(
                HullGeometry.hullLabelScaleFactor(zoomScale: 0.1), 2.2222222222222223,
                tolerance: 1e-9
            )
        )
    }

    @Test func labelScaleFactorFalsyZoomDefaultsToOne() {
        // JS `this._zoomScale || 1`: a zero zoom falls back to 1, same as unset.
        #expect(isClose(HullGeometry.hullLabelScaleFactor(zoomScale: 0), 1))
    }

    // MARK: - hullLabelOpacity (`_hullLabelOpacity`)

    @Test(
        arguments: [
            (0, true, CGFloat(0)),
            (1, true, CGFloat(0)),
            (2, true, CGFloat(0.84)),
            (3, true, CGFloat(0.92)),
            (5, true, CGFloat(0.92)),
            (3, false, CGFloat(0)),
            (0, false, CGFloat(0)),
        ]
    )
    func labelOpacityMatchesJS(memberCount: Int, hasLabel: Bool, expected: CGFloat) {
        #expect(
            isClose(
                HullGeometry.hullLabelOpacity(memberCount: memberCount, hasLabel: hasLabel), expected
            )
        )
    }
}
