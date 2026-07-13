// Physics-parity harness — step 2 of 2 (d3 ground truth).
//
// Replays the EXACT app-side force simulation (js/graph.js:628-668 config) on
// the pinned graph input (graph-input.json) using the REAL vendored d3 v7
// runtime, and dumps node positions/velocities at ticks 1, 2, 10, 100 and at
// alphaMin. The Swift port (ConstellationGraphModel/Physics) must reproduce
// these numbers tick-for-tick — ideally bit-exact.
//
// Usage: node scripts/physics-parity/dump-d3.cjs
//
// Why `.cjs` + globalThis.d3: the repo is `type: module`, so the vendored UMD
// build (js/vendor/d3.v7.min.js) is parsed as ESM when required; its CommonJS
// branch doesn't fire, but its browser branch assigns `globalThis.d3`. We
// require it for that side effect and read `globalThis.d3`.
//
// Lint: `.cjs` files get a dedicated flat-config block (eslint.config.js) that
// enables CommonJS + Node globals, so `require`/`module`/`process`/`__dirname`
// resolve cleanly. No bare `console` is used regardless.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

// Populate globalThis.d3 (see header note).
require('../../js/vendor/d3.v7.min.js');
const d3 = globalThis.d3;

// ── Pinned layout viewport (graph.js reads container.clientWidth/Height at
// runtime; the harness pins it so the center force is reproducible). ──────────
const WIDTH = 1200;
const HEIGHT = 800;

const goldensDir = path.resolve(
  __dirname,
  '..',
  '..',
  'macos',
  'ConstellationKit',
  'Tests',
  'Goldens',
  'physics',
);
const inputPath = path.join(goldensDir, 'graph-input.json');
const outPath = path.join(goldensDir, 'positions.json');
const jigglePath = path.join(goldensDir, 'positions-jiggle.json');

// ── Baked app config (EXACT copy of js/graph.js) ─────────────────────────────

// js/graph.js:480-485
function nodeRadius(d) {
  if (d.isGroupNode) return Math.max(12, 18 - (d.groupDepth || 1) * 1.5);
  const base = d.isCompany ? 12 : d.isVirtual ? 6 : 10;
  const bonus = Math.min(d.connectionCount * 1.5, 10);
  return base + bonus;
}

// js/graph.js:635-642
function linkDistance(d) {
  if (d.edgeKind === 'geographic-hierarchy') return 58;
  if (d.edgeKind === 'geographic-membership') return 70;
  if (['likely-surname', 'likely-tag', 'likely-family'].includes(d.edgeKind)) return 65;
  if (d.category === 'family') return 80;
  if (d.category === 'work') return 100;
  return 120;
}

// js/graph.js:643-648
function linkStrength(d) {
  if (d.edgeKind === 'geographic-hierarchy') return 0.9;
  if (d.edgeKind === 'geographic-membership') return 0.82;
  if (['likely-surname', 'likely-tag', 'likely-family'].includes(d.edgeKind)) return 0.76;
  return 0.4;
}

// js/graph.js:655
function chargeStrength(d) {
  return d.isGroupNode ? -520 : d.isCompany ? -400 : -150;
}

// ── Build the simulation exactly as graph.js does ────────────────────────────

function buildSimulation(nodes, edges) {
  const sim = d3
    .forceSimulation()
    .force(
      'link',
      d3
        .forceLink()
        .id((d) => d.id)
        .distance(linkDistance)
        .strength(linkStrength),
    )
    .force('charge', d3.forceManyBody().strength(chargeStrength).distanceMax(400))
    .force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2))
    .force(
      'collide',
      d3.forceCollide((d) => nodeRadius(d) + 8),
    );

  // graph.js repoints arrays on the reused sim, then re-sets center.
  sim.nodes(nodes);
  sim.force('link').links(edges);
  sim.force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2));
  return sim;
}

function snapshot(sim, label) {
  return {
    label,
    alpha: sim.alpha(),
    nodes: sim.nodes().map((n) => ({
      index: n.index,
      id: n.id,
      x: n.x,
      y: n.y,
      vx: n.vx,
      vy: n.vy,
    })),
  };
}

function tickTo(sim, target, current) {
  for (let t = current; t < target; t++) sim.tick();
  return target;
}

function main() {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  // Fresh, mutable node/edge objects (d3 augments them with index/x/y/vx/vy and
  // resolves source/target string ids to node refs). Order preserved exactly.
  const nodes = input.nodes.map((n) => ({
    id: n.id,
    isGroupNode: n.isGroupNode,
    groupDepth: n.groupDepth,
    isCompany: n.isCompany,
    isVirtual: n.isVirtual,
    connectionCount: n.connectionCount,
    category: n.category,
  }));
  const edges = input.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    edgeKind: e.edgeKind,
    category: e.category,
  }));

  const sim = buildSimulation(nodes, edges);
  const alphaMin = sim.alphaMin();

  // Full-layout restart alpha (graph.js: non-incremental => alpha 1).
  sim.alpha(1);

  // Capture the phyllotaxis initial placement (tick 0) too — useful for
  // isolating an init-vs-integration divergence.
  const snapshots = [snapshot(sim, 'tick0')];

  let cur = 0;
  for (const target of [1, 2, 10, 100]) {
    cur = tickTo(sim, target, cur);
    snapshots.push(snapshot(sim, `tick${target}`));
  }

  // Run to rest: d3's stepper stops after the tick that drops alpha below
  // alphaMin. Replicate that exact termination.
  while (sim.alpha() >= alphaMin) {
    sim.tick();
    cur++;
  }
  snapshots.push(snapshot(sim, 'alphaMin'));

  const out = {
    _comment:
      'd3 v7 ground-truth positions for the physics port. Generated by ' +
      'scripts/physics-parity/dump-d3.cjs from graph-input.json. Regenerate ' +
      'with: node scripts/physics-parity/dump-d3.cjs',
    d3Version: d3.version,
    width: WIDTH,
    height: HEIGHT,
    fullLayoutAlpha: 1,
    incrementalAlpha: 0.3,
    alphaMin,
    alphaDecay: sim.alphaDecay(),
    velocityDecay: sim.velocityDecay(),
    restTickCount: cur,
    snapshots,
  };

  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `positions.json: ${nodes.length} nodes, ${snapshots.length} snapshots, ` +
      `rest at tick ${cur} -> ${outPath}\n`,
  );

  dumpJiggleScenario();
}

// ── Jiggle / LCG stream-alignment scenario ───────────────────────────────────
//
// The comprehensive.vcf layout never produces coincident points, so it never
// consumes the shared LCG. This second scenario seeds several nodes at IDENTICAL
// positions, which forces "jiggle" (random tie-breaking) in all three random
// forces — link, many-body, collide — every tick. Reproducing it bit-exactly
// proves the Swift port consumes the LCG in the identical ORDER and quantity as
// d3 (the streams are aligned). The scenario input is embedded in the golden so
// both sides run byte-identical nodes/edges.
function dumpJiggleScenario() {
  const scenarioNodes = [
    {
      id: 'j0',
      isGroupNode: false,
      groupDepth: null,
      isCompany: false,
      isVirtual: false,
      connectionCount: 2,
      category: 'other',
      x: 400,
      y: 300,
    },
    {
      id: 'j1',
      isGroupNode: false,
      groupDepth: null,
      isCompany: true,
      isVirtual: false,
      connectionCount: 1,
      category: 'work',
      x: 400,
      y: 300,
    },
    {
      id: 'j2',
      isGroupNode: true,
      groupDepth: 1,
      isCompany: false,
      isVirtual: false,
      connectionCount: 2,
      category: 'other',
      x: 600,
      y: 300,
    },
    {
      id: 'j3',
      isGroupNode: false,
      groupDepth: null,
      isCompany: false,
      isVirtual: true,
      connectionCount: 1,
      category: 'other',
      x: 600,
      y: 300,
    },
    {
      id: 'j4',
      isGroupNode: false,
      groupDepth: null,
      isCompany: false,
      isVirtual: false,
      connectionCount: 2,
      category: 'family',
      x: 400,
      y: 300,
    },
  ];
  const scenarioEdges = [
    { id: 'je0', source: 'j0', target: 'j1', edgeKind: 'explicit', category: 'work' },
    { id: 'je1', source: 'j2', target: 'j3', edgeKind: 'likely-surname', category: 'other' },
    { id: 'je2', source: 'j0', target: 'j2', edgeKind: 'explicit', category: 'family' },
    { id: 'je3', source: 'j0', target: 'j4', edgeKind: 'explicit', category: 'family' },
  ];

  const nodes = scenarioNodes.map((n) => ({ ...n }));
  const edges = scenarioEdges.map((e) => ({ ...e }));

  const sim = buildSimulation(nodes, edges);

  // Wrap the shared random source with a counter to prove jiggle actually
  // fires. randomSource() re-initializes the forces with the wrapper, matching
  // how the port shares one LCG across all forces.
  let consumptions = 0;
  const baseRandom = sim.randomSource();
  sim.randomSource(() => {
    consumptions += 1;
    return baseRandom();
  });

  sim.alpha(1);

  const snapshots = [snapshot(sim, 'tick0')];
  let cur = 0;
  for (const target of [1, 2, 5, 20]) {
    cur = tickTo(sim, target, cur);
    snapshots.push(snapshot(sim, `tick${target}`));
  }

  const out = {
    _comment:
      'LCG stream-alignment scenario: coincident seeded nodes force jiggle in ' +
      'link/charge/collide every tick. Generated by scripts/physics-parity/' +
      'dump-d3.cjs. The Swift port must reproduce these bit-exactly, proving ' +
      'the shared-LCG stream is consumed in identical order.',
    width: WIDTH,
    height: HEIGHT,
    alpha: 1,
    lcgConsumptions: consumptions,
    scenario: { nodes: scenarioNodes, edges: scenarioEdges },
    snapshots,
  };

  fs.writeFileSync(jigglePath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `positions-jiggle.json: ${nodes.length} nodes, ${snapshots.length} snapshots, ` +
      `${consumptions} LCG consumptions -> ${jigglePath}\n`,
  );
}

main();
