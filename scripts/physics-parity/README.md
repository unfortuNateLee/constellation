# Physics parity harness (M4)

Proves the Swift d3-force port
(`macos/ConstellationKit/Sources/ConstellationGraphModel/Physics/`) reproduces
the **real vendored d3 v7** force simulation **tick-for-tick, bit-exactly**.

Same strategy as the M1 byte-parity gate: one pinned input, a Node-side ground
truth from the runtime we're cloning, and a Swift test that must match it.

## The two committed goldens (regenerated, never hand-edited)

Both live in `macos/ConstellationKit/Tests/Goldens/physics/` so the Swift test
loads them via `#filePath` (no SwiftPM resource copying), exactly like the
Markdown/vCard goldens.

- **`graph-input.json`** — the node/edge set the simulation runs on, derived
  from `fixtures/comprehensive.vcf` through the **real `js/` RelationshipBuilder**
  (mode `connections`, all include-flags on). This isolates _physics_ parity
  from _graph-model_ parity (already proven): the physics test never rebuilds
  the graph, it replays this exact input. Node/edge **order is load-bearing** —
  it fixes the shared-LCG (jiggle) stream and the Barnes-Hut accumulation order.
- **`positions.json`** — d3 v7 ground truth: `x/y/vx/vy` for every node at
  ticks 0, 1, 2, 10, 100 and at rest (alphaMin), plus the alpha schedule
  constants and the rest tick count (300).
- **`positions-jiggle.json`** — a second, deliberately synthetic scenario that
  seeds several nodes at _identical_ positions. The comprehensive-fixture layout
  never produces coincident points, so it never consumes the shared LCG (0
  jiggle calls); this scenario forces "jiggle" (random tie-breaking) in **all
  three** random forces — link, many-body, collide — on every tick (the golden
  records the LCG consumption count). Reproducing it bit-exactly is what
  actually proves **LCG stream alignment**: the port consumes the one shared
  seeded stream in the identical order and quantity as d3. Its scenario input is
  embedded in the golden so both sides run byte-identical nodes/edges.

## Regenerate

```sh
# 1. Build the graph input from the fixture (ESM; real RelationshipBuilder).
node scripts/physics-parity/build-graph-input.mjs

# 2. Dump d3 v7 ground-truth positions (CommonJS; requires the vendored UMD d3).
node scripts/physics-parity/dump-d3.cjs
```

Both steps are fully deterministic (no `Math.random`, seeded LCG) — re-running
produces byte-identical JSON. If either the fixture, the RelationshipBuilder, or
the §15.1 force config changes, regenerate and re-run the Swift tests.

## Pinned configuration (must match on both sides)

- Viewport `1200 × 800` → centering force at `(600, 400)`. graph.js reads the
  container size at runtime; the harness pins it so the center force is
  reproducible.
- Forces registered in graph.js order: **link, charge, center, collide**.
- Full-layout restart alpha `1.0` (non-incremental).
- §15.1 distance/strength/charge/collide closures, copied verbatim from
  `js/graph.js` into `dump-d3.cjs` and baked into `ForceConfig` on the Swift
  side.

## Parity result & the transcendental question

**Bit-exact: max abs diff 0.0** at every checkpoint (see
`Tests/GraphModelTests/PhysicsParityTests.swift`).

The only realistic source of a JS-vs-Swift float divergence is the transcendental
functions in the deterministic path: `Math.cos`/`Math.sin` (phyllotaxis initial
placement) and `Math.pow` (alphaDecay). Everything else is `+ − × ÷ √`, all
IEEE-754 correctly-rounded and therefore identical. We verified — by dumping the
raw IEEE-754 bit patterns from V8 and from the Swift toolchain for the exact
inputs used — that **Darwin libm agrees with V8 bit-for-bit** on `cos`, `sin`,
`pow`, `sqrt`, and the `π`/`√5` constants. So no fdlibm port is needed; platform
`libm` already yields the identical stream.

If a future OS/toolchain ever diverges on one of these (it would show up as a
tiny, ~1e-13, diff seeded at tick 0), the remedy is to port fdlibm's
`__kernel_sin`/`__kernel_cos`/`pow` (which V8 itself uses) into the Swift
`Simulation` — the arithmetic path around them is already bit-exact.
