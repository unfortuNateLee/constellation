import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses } from './helpers/load-app.js';

// The component/packing helpers are static and DOM-free — only the class needs
// the fake browser globals to load.
function graphClass() {
  const { ConstellationGraph } = loadBrowserClasses();
  return ConstellationGraph;
}

const n = (id) => ({ id });

test('computeComponents partitions disconnected clusters and singletons', () => {
  const G = graphClass();
  const nodes = ['a1', 'a2', 'a3', 'b1', 'b2', 'lone'].map(n);
  const edges = [
    { source: 'a1', target: 'a2' },
    // object endpoints (post-simulation shape) must work too
    { source: { id: 'a2' }, target: { id: 'a3' } },
    { source: 'b1', target: 'b2' },
    // dangling edge to an unknown node is ignored
    { source: 'b1', target: 'ghost' },
  ];
  const components = G.computeComponents(nodes, edges);
  const sets = components.map((c) => [...c].sort().join(','));
  assert.deepEqual(sets, ['a1,a2,a3', 'b1,b2', 'lone']);
  // Largest first
  assert.equal(components[0].length, 3);
});

test('packComponentHomes keeps home circles apart and is deterministic', () => {
  const G = graphClass();
  const nodes = [];
  const edges = [];
  // 1 big component (8 nodes), 2 medium (4), and 5 singletons.
  const addChain = (prefix, count) => {
    for (let i = 0; i < count; i++) {
      nodes.push(n(`${prefix}${i}`));
      if (i > 0) edges.push({ source: `${prefix}${i - 1}`, target: `${prefix}${i}` });
    }
  };
  addChain('big', 8);
  addChain('m1-', 4);
  addChain('m2-', 4);
  for (let i = 0; i < 5; i++) nodes.push(n(`solo${i}`));

  const components = G.computeComponents(nodes, edges);
  const homes = G.packComponentHomes(components, { cx: 500, cy: 400 });

  // Every node has a home; nodes in one component share it.
  for (const node of nodes) assert.ok(homes.has(node.id), `missing home for ${node.id}`);
  assert.deepEqual(homes.get('big0'), homes.get('big7'));

  // Largest component sits at the center.
  assert.equal(homes.get('big0').x, 500);
  assert.equal(homes.get('big0').y, 400);

  // Distinct components' home circles don't overlap (the whole point).
  const distinct = [...new Set([...homes.values()])];
  for (let i = 0; i < distinct.length; i++) {
    for (let j = i + 1; j < distinct.length; j++) {
      const a = distinct[i];
      const b = distinct[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(
        dist >= a.r + b.r,
        `home circles overlap: d=${dist.toFixed(1)} < ${a.r.toFixed(1)}+${b.r.toFixed(1)}`,
      );
    }
  }

  // Deterministic: same inputs → identical placement.
  const again = G.packComponentHomes(G.computeComponents(nodes, edges), { cx: 500, cy: 400 });
  for (const node of nodes) {
    assert.deepEqual(homes.get(node.id), again.get(node.id));
  }
});
