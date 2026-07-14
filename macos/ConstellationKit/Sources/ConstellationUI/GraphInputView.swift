// GraphInputView — a transparent AppKit overlay that turns pointer input into
// GraphRenderState transforms and selection, mirroring js/graph.js's d3.zoom +
// d3.drag wiring (l.109-139, l.500-518, l.788-803).
//
// Gesture mapping (Mac-native, consistent with d3.zoom's wheel-zoom default —
// see the report for the deviation note):
//   • mouse wheel / ⌘-scroll  → zoom about the pointer (js/graph.js:112-121)
//   • trackpad two-finger scroll → pan
//   • pinch (magnify)          → zoom about the pointer
//   • click empty space        → deselect (js/graph.js:135-139 `_deselectAll`)
//   • click a node             → select (js/graph.js:507-510)
//   • drag a node              → pin fx/fy and follow; release clears fx/fy
//   • drag empty space         → pan

import AppKit
import ConstellationStore
import SwiftUI

struct GraphInputView: NSViewRepresentable {
    let renderState: GraphRenderState
    let store: AppStore

    func makeNSView(context: Context) -> InputNSView {
        let view = InputNSView()
        view.renderState = renderState
        view.store = store
        return view
    }

    func updateNSView(_ nsView: InputNSView, context: Context) {
        nsView.renderState = renderState
        nsView.store = store
    }
}

final class InputNSView: NSView {
    var renderState: GraphRenderState?
    var store: AppStore?

    private var mouseDownPoint: CGPoint = .zero
    private var draggedNodeID: String?
    private var didDrag = false
    private var dragBeganOnNode = false

    // Top-left origin to match SwiftUI's Canvas coordinate space.
    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    private func point(_ event: NSEvent) -> CGPoint {
        convert(event.locationInWindow, from: nil)
    }

    // MARK: - Click / drag

    override func mouseDown(with event: NSEvent) {
        guard let rs = renderState else { return }
        let p = point(event)
        mouseDownPoint = p
        didDrag = false
        draggedNodeID = rs.hitTest(viewPoint: p)
        dragBeganOnNode = draggedNodeID != nil
    }

    override func mouseDragged(with event: NSEvent) {
        guard let rs = renderState else { return }
        let p = point(event)
        if !didDrag {
            // Small threshold so a click isn't mistaken for a drag.
            let dx = p.x - mouseDownPoint.x
            let dy = p.y - mouseDownPoint.y
            if (dx * dx + dy * dy).squareRoot() < 3 { return }
            didDrag = true
            if let id = draggedNodeID { rs.beginDrag(id) }
        }
        if let id = draggedNodeID {
            rs.dragNode(id, toWorld: rs.viewToWorld(p))
        } else {
            rs.panBy(
                dx: p.x - mouseDownPoint.x, dy: p.y - mouseDownPoint.y)
            mouseDownPoint = p
        }
    }

    override func mouseUp(with event: NSEvent) {
        guard let rs = renderState else { return }
        if let id = draggedNodeID {
            if didDrag {
                rs.endDrag(id)
            } else {
                // A clean click on a node selects it (no zoom-to — that's the
                // sidebar's behavior). Sync dimming + store selection.
                rs.selectedID = id
                store?.selectedContactID = id
            }
        } else if !didDrag {
            // Click on empty space deselects (js/graph.js:135-139).
            rs.selectedID = nil
            store?.selectedContactID = nil
        }
        draggedNodeID = nil
        didDrag = false
        dragBeganOnNode = false
    }

    // MARK: - Wheel / pinch zoom + pan

    override func scrollWheel(with event: NSEvent) {
        guard let rs = renderState else { return }
        let p = point(event)
        let commandZoom = event.modifierFlags.contains(.command)
        // Mouse wheels report coarse (non-precise) deltas — treat those as zoom
        // (d3.zoom's wheel default). Trackpad precise deltas pan unless ⌘ is held.
        if commandZoom || !event.hasPreciseScrollingDeltas {
            let delta = event.scrollingDeltaY
            let factor = pow(2, delta / 100)
            rs.zoom(by: factor, about: p)
        } else {
            rs.panBy(dx: event.scrollingDeltaX, dy: event.scrollingDeltaY)
        }
    }

    override func magnify(with event: NSEvent) {
        guard let rs = renderState else { return }
        rs.zoom(by: 1 + event.magnification, about: point(event))
    }
}
