// GraphScreenshot — a DEBUG-only, headless render path for visual verification.
// Parses a VCF, builds the connections graph, runs the simulation to rest, fits
// the view, and renders `GraphScene` to a PNG via `ImageRenderer`. Driven by the
// app's `--screenshot-graph <out.png>` launch flag (see App/ConstellationApp).

#if DEBUG
    import ConstellationFormats
    import ConstellationGraphModel
    import ConstellationStore
    import CoreGraphics
    import ImageIO
    import SwiftUI
    import UniformTypeIdentifiers

    public enum GraphScreenshot {
        /// Import a VCF (text), settle the graph, and return PNG bytes. `nil` on
        /// failure. Runs synchronously on the main actor.
        @MainActor
        public static func pngData(
            vcfText: String,
            size: CGSize = CGSize(width: 1400, height: 1000),
            colorScheme: ColorScheme = .dark
        ) -> Data? {
            let contacts = VCardAdapter().parse(vcfText).contacts
            let store = AppStore()
            store.loadContacts(contacts, fileLabel: "screenshot", activeFormatID: "vcard")
            return pngData(model: store.graphModel, size: size, colorScheme: colorScheme)
        }

        /// Render the ~1,500-node synthetic graph to PNG bytes (perf-harness visual).
        @MainActor
        public static func syntheticPNGData(
            size: CGSize = CGSize(width: 1400, height: 1000),
            colorScheme: ColorScheme = .dark
        ) -> Data? {
            pngData(model: SyntheticGraph.make(), size: size, colorScheme: colorScheme)
        }

        /// Measure the hot-frame cost of the ~1,500-node synthetic graph: the
        /// per-frame physics tick and the per-frame draw, at the fitted zoom the
        /// simulation actually runs at. Returns a human-readable report.
        @MainActor
        public static func perfReport(
            frames: Int = 240, size: CGSize = CGSize(width: 1400, height: 1000)
        ) -> String {
            let model = SyntheticGraph.make()
            let rs = GraphRenderState(width: size.width, height: size.height)
            rs.rebuild(graphModel: model, size: size)
            // Let the layout spread out, then fit — the realistic "hot" viewport.
            for _ in 0..<60 { _ = rs.advanceFrame() }
            rs.fitView(duration: 0)

            let cache = GraphDrawCache()
            cache.reset(dark: true)

            func scene() -> some View {
                GraphScene(renderState: rs, cache: cache, scheme: .dark)
                    .frame(width: size.width, height: size.height)
                    .environment(\.colorScheme, .dark)
            }

            // Physics tick cost (the per-frame simulation step).
            var tickTotal = 0.0
            var ticked = 0
            for _ in 0..<frames {
                let t0 = CACurrentMediaTime()
                _ = rs.advanceFrame()
                tickTotal += CACurrentMediaTime() - t0
                ticked += 1
            }
            let tickMs = tickTotal / Double(ticked) * 1000

            // Draw cost (one full Canvas rasterization).
            let drawFrames = 60
            var drawTotal = 0.0
            for _ in 0..<drawFrames {
                let renderer = ImageRenderer(content: scene())
                renderer.scale = 1
                let t0 = CACurrentMediaTime()
                _ = renderer.cgImage
                drawTotal += CACurrentMediaTime() - t0
            }
            let drawMs = drawTotal / Double(drawFrames) * 1000
            let frameMs = tickMs + drawMs
            let fps = frameMs > 0 ? 1000 / frameMs : 0

            return String(
                format:
                    "perf: %d nodes / %d edges @ %.0fx%.0f\n  physics tick: %.2f ms/frame\n  draw:         %.2f ms/frame\n  total:        %.2f ms/frame  → %.0f fps (budget 16.67 ms)\n",
                model.nodes.count, model.edges.count, size.width, size.height,
                tickMs, drawMs, frameMs, fps)
        }

        /// Render an already-built `GraphModel` to PNG bytes.
        @MainActor
        public static func pngData(
            model: GraphModel,
            size: CGSize = CGSize(width: 1400, height: 1000),
            colorScheme: ColorScheme = .dark
        ) -> Data? {
            let renderState = GraphRenderState(width: size.width, height: size.height)
            renderState.rebuild(graphModel: model, size: size)
            renderState.tickUntilRest()
            renderState.fitView(duration: 0)

            let cache = GraphDrawCache()
            cache.reset(dark: colorScheme != .light)
            cache.preloadPhotos(model.nodes)

            let scene =
                ZStack {
                    GraphTheme(colorScheme).backgroundGradient
                    GraphScene(renderState: renderState, cache: cache, scheme: colorScheme)
                }
                .frame(width: size.width, height: size.height)
                .environment(\.colorScheme, colorScheme)

            let renderer = ImageRenderer(content: scene)
            renderer.scale = 2
            renderer.isOpaque = true
            guard let cg = renderer.cgImage else {
                FileHandle.standardError.write(Data("screenshot: ImageRenderer produced no image\n".utf8))
                return nil
            }
            let out = NSMutableData()
            guard
                let dest = CGImageDestinationCreateWithData(
                    out as CFMutableData, UTType.png.identifier as CFString, 1, nil)
            else { return nil }
            CGImageDestinationAddImage(dest, cg, nil)
            guard CGImageDestinationFinalize(dest) else { return nil }
            FileHandle.standardError.write(
                Data("screenshot: \(model.nodes.count) nodes / \(model.edges.count) edges\n".utf8))
            return out as Data
        }
    }
#endif
