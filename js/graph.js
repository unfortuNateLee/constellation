import { Palette } from './palette.js';

// `d3` is the vendored UMD global, loaded as a classic script before this module
// (declared as a global in eslint.config.js).

/**
 * ConstellationGraph — D3 force-directed graph renderer
 * Requires D3 v7 (vendored locally in HTML for offline use)
 */
export class ConstellationGraph {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth;
    this.height = container.clientHeight;

    this._nodes = [];
    this._edges = [];
    this._nodeById = new Map();
    this._edgesByNodeId = new Map();
    // id → last {x, y, vx, vy, fx, fy}; lets a rebuild resume the existing
    // layout instead of re-scattering the graph on every edit.
    this._nodePositions = new Map();
    this._simulation = null;
    this._svg = null;
    this._zoomG = null;
    this._linkG = null;
    this._hullG = null;
    this._hullLabelG = null;
    this._nodeG = null;
    this._labelG = null;
    this._zoom = null;
    this._zoomScale = 1;

    this._selectedNode = null;
    this._hoveredNode = null;
    this._showInferred = true;
    this._showLabels = true;
    this._filterCategories = new Set();
    this._mode = 'connections';
    this._hulls = [];

    this._listeners = {};

    // Colors come from the CSS category tokens via Palette (single source).
    this._colorScheme = this._buildColorScheme();

    this._init();
  }

  // Node/edge colors derived from the CSS `--cat-*` tokens (via Palette).
  _buildColorScheme() {
    const cat = (name) => Palette.category(name);
    return {
      node: {
        family: cat('family'),
        friend: cat('friend'),
        mitre: cat('mitre'),
        work: cat('work'),
        neighbor: cat('neighbor'),
        church: cat('church'),
        school: cat('school'),
        medical: cat('medical'),
        company: cat('company'),
        virtual: cat('virtual'),
        other: Palette.nodeDefault,
        group: Palette.group,
        selected: Palette.selected,
      },
      edge: {
        family: cat('family'),
        friend: cat('friend'),
        work: cat('work'),
        neighbor: cat('neighbor'),
        other: cat('company'),
        inferred: Palette.inferred,
      },
    };
  }

  /**
   * Re-read the palette (after a theme switch) and recolor the existing graph
   * in place — node fills, selected ring, link strokes, and arrow markers —
   * without re-running the force simulation (so nodes don't jump). Label/hull
   * text colors flip automatically via CSS. Caller must Palette.refresh() first.
   */
  refreshColors() {
    this._colorScheme = this._buildColorScheme();
    if (!this._svg) return;
    const scheme = this._colorScheme;
    this._nodeG.selectAll('circle.node-circle').attr('fill', (d) => this._nodeColor(d));
    this._nodeG.selectAll('circle.node-ring').attr('stroke', scheme.node.selected);
    this._linkG.selectAll('g.link line').attr('stroke', (d) => this._edgeColor(d));
    this._svg.selectAll('defs marker').each((_, i, nodesArr) => {
      const marker = nodesArr[i];
      const category = String(marker.id || '').replace('arrow-', '');
      d3.select(marker)
        .select('path')
        .attr('fill', scheme.edge[category] || scheme.edge.other);
    });
  }

  _edgeColor(d) {
    return this._colorScheme.edge[d.category] || this._colorScheme.edge.other;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  _init() {
    const el = this.container;

    this._zoom = d3
      .zoom()
      .scaleExtent([0.05, 4])
      .on('zoom', (e) => {
        this._zoomG.attr('transform', e.transform);
        this._zoomScale = e.transform.k || 1;
        const k = e.transform.k;
        this._showLabels = k > 0.6;
        this._labelG.attr('opacity', this._showLabels ? 1 : 0);
      });

    this._svg = d3
      .select(el)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('role', 'group')
      .attr(
        'aria-label',
        'Contact relationship graph. Use Tab to move between contacts, Enter to open one.',
      )
      .style('background', 'transparent')
      .call(this._zoom)
      .on('click', (e) => {
        if (e.target === this._svg.node() || e.target.tagName === 'svg') {
          this._deselectAll();
        }
      });

    // Defs: arrow markers per edge category
    const defs = this._svg.append('defs');
    for (const [cat, color] of Object.entries(this._colorScheme.edge)) {
      defs
        .append('marker')
        .attr('id', `arrow-${cat}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', color)
        .attr('opacity', 0.6);
    }

    // Filter: drop shadow for selected nodes
    const filter = defs.append('filter').attr('id', 'glow');
    filter.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'coloredBlur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    this._zoomG = this._svg.append('g').attr('class', 'zoom-root');
    this._hullG = this._zoomG.append('g').attr('class', 'hulls');
    this._hullLabelG = this._zoomG.append('g').attr('class', 'hull-labels');
    this._linkG = this._zoomG.append('g').attr('class', 'links');
    this._nodeG = this._zoomG.append('g').attr('class', 'nodes');
    this._labelG = this._zoomG.append('g').attr('class', 'labels');

    // Tooltip
    this._tooltip = d3
      .select(document.body)
      .append('div')
      .attr('class', 'graph-tooltip')
      .style('opacity', 0)
      .style('pointer-events', 'none');

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    // Ignore resizes while the graph is hidden (0×0) — e.g. when the Table view is
    // showing. Acting on them would re-center the simulation on (0,0) and leave it
    // primed at a high alpha, making the graph janky when you switch back.
    if (!w || !h) return;
    // Only react to a real size change; otherwise leave the settled layout alone so
    // returning to the graph at the same size doesn't needlessly re-animate it.
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    if (this._simulation) {
      this._simulation.force('center', d3.forceCenter(this.width / 2, this.height / 2));
      this._simulation.alpha(0.3).restart();
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  on(event, handler) {
    this._listeners[event] = handler;
    return this;
  }

  emit(event, data) {
    if (this._listeners[event]) this._listeners[event](data);
  }

  render(nodes, edges, meta = {}) {
    this._allNodes = nodes;
    this._allEdges = edges;
    this._mode = meta.mode || 'connections';
    this._allHulls = meta.hulls || [];
    this._applyFilters();
  }

  setShowInferred(val) {
    this._showInferred = val;
    this._applyFilters();
  }

  setFilterCategories(cats) {
    this._filterCategories = new Set(cats);
    this._applyFilters();
  }

  highlightContact(id) {
    this._selectNode(id, false);
    this._zoomToNode(id);
  }

  resetView() {
    this._svg.transition().duration(600).call(this._zoom.transform, d3.zoomIdentity);
  }

  /** Zoom in/out by a multiplicative factor about the viewport center. */
  zoomBy(factor) {
    if (!this._zoom || !this._svg) return;
    this._svg.transition().duration(200).call(this._zoom.scaleBy, factor);
  }

  /** Fit all current nodes within the viewport with a margin. */
  fitView() {
    const nodes = [...(this._nodeById?.values() || [])].filter((n) => n.x != null && n.y != null);
    if (!nodes.length) return this.resetView();
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    const margin = 60;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const scale = Math.min(
      4,
      Math.max(0.05, Math.min((this.width - margin * 2) / w, (this.height - margin * 2) / h)),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const t = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(scale)
      .translate(-cx, -cy);
    this._svg.transition().duration(600).call(this._zoom.transform, t);
  }

  /** Zoom/center on a contact node without changing the current selection.
   *  Returns true if the node was found and centered, false otherwise. */
  centerOnContact(id) {
    const node = this._nodeById.get(id);
    if (!node || !node.x) return false;
    this._zoomToNode(id);
    return true;
  }

  // ── Internal render pipeline ───────────────────────────────────

  _applyFilters() {
    let nodes = this._allNodes || [];
    let edges = this._allEdges || [];
    let hulls = this._allHulls || [];
    let nodeById = this._indexNodes(nodes);

    // Filter out inferred edges if disabled
    if (!this._showInferred && (this._mode === 'connections' || this._mode === 'family-explicit')) {
      edges = edges.filter((e) => !(e.inferred && !e.edgeKind));
    }

    // Filter by category
    if (this._filterCategories.size > 0) {
      const matchingIds = new Set(
        nodes
          .filter(
            (n) =>
              !n.isGroupNode && (n.filterTags || []).some((tag) => this._filterCategories.has(tag)),
          )
          .map((n) => n.id),
      );
      // Pull in group/cluster nodes connected to any visible node (transitively)
      // via a single BFS over a precomputed adjacency map — O(V+E) instead of the
      // old fixed-point rescan of every edge until stable (O(V*E)).
      const adj = new Map();
      for (const e of edges) {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        (adj.get(s) || adj.set(s, []).get(s)).push(t);
        (adj.get(t) || adj.set(t, []).get(t)).push(s);
      }
      const visibleIds = new Set(matchingIds);
      const queue = [...matchingIds];
      while (queue.length) {
        const cur = queue.shift();
        for (const nb of adj.get(cur) || []) {
          if (visibleIds.has(nb)) continue;
          if (nodeById.get(nb)?.isGroupNode) {
            visibleIds.add(nb);
            queue.push(nb);
          }
        }
      }
      nodes = nodes.filter((n) => visibleIds.has(n.id));
      edges = edges.filter((e) => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        return visibleIds.has(s) && visibleIds.has(t);
      });
      hulls = hulls.filter((h) => (h.memberIds || []).some((id) => visibleIds.has(id)));
    }

    this._nodes = nodes;
    this._edges = edges;
    this._hulls = hulls;
    this._nodeById = this._indexNodes(nodes);
    this._edgesByNodeId = this._indexEdgesByNode(edges);
    this._renderGraph(nodes, edges, hulls);
  }

  _renderGraph(nodes, edges, hulls = []) {
    // Stop old simulation
    if (this._simulation) this._simulation.stop();

    const nodeIds = new Set(nodes.map((n) => n.id));
    const validEdges = edges.filter((e) => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      return nodeIds.has(s) && nodeIds.has(t);
    });

    const hull = this._hullG
      .selectAll('path.cluster-hull')
      .data(hulls, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append('path')
            .attr('class', (d) => `cluster-hull hull-${d.kind || 'default'}`)
            .attr('fill', (d) => d.color || '#74b9ff')
            .attr('fill-opacity', (d) => this._hullOpacity(d))
            .attr('stroke', (d) => d.color || '#74b9ff')
            .attr('stroke-opacity', (d) => Math.min(this._hullOpacity(d) + 0.08, 0.28))
            .attr('stroke-width', 1.5),
        (update) =>
          update
            .attr('fill', (d) => d.color || '#74b9ff')
            .attr('fill-opacity', (d) => this._hullOpacity(d))
            .attr('stroke', (d) => d.color || '#74b9ff')
            .attr('stroke-opacity', (d) => Math.min(this._hullOpacity(d) + 0.08, 0.28)),
        (exit) => exit.remove(),
      );

    const hullLabel = this._hullLabelG
      .selectAll('text.hull-label')
      .data(hulls, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append('text')
            .attr('class', (d) => `hull-label hull-label-${d.kind || 'default'}`)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', '11px')
            .attr('pointer-events', 'none')
            .text((d) => d.label || ''),
        (update) => update.text((d) => d.label || ''),
        (exit) => exit.remove(),
      );

    // ── Links ──
    const link = this._linkG
      .selectAll('g.link')
      .data(validEdges, (d) => d.id)
      .join(
        (enter) => {
          const g = enter.append('g').attr('class', (d) => `link link-${d.category}`);
          g.append('line')
            .attr(
              'stroke',
              (d) => this._colorScheme.edge[d.category] || this._colorScheme.edge.other,
            )
            .attr('stroke-width', (d) => this._edgeWidth(d))
            .attr('stroke-dasharray', (d) => this._edgeDashArray(d))
            .attr('stroke-opacity', 0.5);
          // Source-side label (near the source node)
          g.append('text')
            .attr('class', 'edge-label edge-label-src')
            .attr('text-anchor', 'middle')
            .attr('dy', -4)
            .attr('font-size', '9px')
            .attr('pointer-events', 'none')
            .text((d) => (d.inferred ? '' : d.label));
          // Target-side label (near the target node) — only shown when labels differ
          g.append('text')
            .attr('class', 'edge-label edge-label-tgt')
            .attr('text-anchor', 'middle')
            .attr('dy', -4)
            .attr('font-size', '9px')
            .attr('pointer-events', 'none')
            .text((d) => (d.reverseLabel && d.reverseLabel !== d.label ? d.reverseLabel : ''));
          return g;
        },
        (update) => {
          // Refresh labels in case edge data changed between renders
          update.select('text.edge-label-src').text((d) => (d.inferred ? '' : d.label));
          update
            .select('text.edge-label-tgt')
            .text((d) => (d.reverseLabel && d.reverseLabel !== d.label ? d.reverseLabel : ''));
          update
            .select('line')
            .attr(
              'stroke',
              (d) => this._colorScheme.edge[d.category] || this._colorScheme.edge.other,
            )
            .attr('stroke-width', (d) => this._edgeWidth(d))
            .attr('stroke-dasharray', (d) => this._edgeDashArray(d));
          return update;
        },
        (exit) => exit.remove(),
      );

    // ── Nodes ──
    const nodeRadius = (d) => {
      if (d.isGroupNode) return Math.max(12, 18 - (d.groupDepth || 1) * 1.5);
      const base = d.isCompany ? 12 : d.isVirtual ? 6 : 10;
      const bonus = Math.min(d.connectionCount * 1.5, 10);
      return base + bonus;
    };

    const node = this._nodeG
      .selectAll('g.node')
      .data(nodes, (d) => d.id)
      .join(
        (enter) => {
          const g = enter
            .append('g')
            .attr('class', (d) => `node node-${d.category}`)
            .style('cursor', 'pointer')
            // Keyboard-accessible: each node is a focusable button labeled by name.
            .attr('tabindex', 0)
            .attr('role', 'button')
            .attr('aria-label', (d) => d.name || 'contact')
            .call(
              d3
                .drag()
                .on('start', (e, d) => this._dragStarted(e, d))
                .on('drag', (e, d) => this._dragged(e, d))
                .on('end', (e, d) => this._dragEnded(e, d)),
            )
            .on('click', (e, d) => {
              e.stopPropagation();
              this._selectNode(d.id);
            })
            .on('keydown', (e, d) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this._selectNode(d.id);
              }
            })
            .on('mouseover', (e, d) => this._onHover(e, d, true))
            .on('mouseout', (e, d) => this._onHover(e, d, false));

          // Outer glow ring (shown on select)
          g.append('circle')
            .attr('class', 'node-ring')
            .attr('r', (d) => nodeRadius(d) + 5)
            .attr('fill', 'none')
            .attr('stroke', this._colorScheme.node.selected)
            .attr('stroke-width', 2)
            .attr('opacity', 0);

          // Main circle
          g.append('circle')
            .attr('class', 'node-circle')
            .attr('r', (d) => nodeRadius(d))
            .attr('fill', (d) => this._nodeColor(d))
            .attr('stroke', '#1a1a2e')
            .attr('stroke-width', (d) => (d.isGroupNode ? 2 : 1.5))
            .attr('stroke-dasharray', (d) => (d.isGroupNode ? '5 3' : null));

          // Clip path for circular photo crop
          g.append('clipPath')
            .attr('id', (d) => `node-clip-${d.id}`)
            .append('circle')
            .attr('r', (d) => nodeRadius(d));

          // Photo (shown instead of initials when available)
          g.filter((d) => d.photo)
            .append('image')
            .attr('href', (d) => d.photo)
            .attr('x', (d) => -nodeRadius(d))
            .attr('y', (d) => -nodeRadius(d))
            .attr('width', (d) => nodeRadius(d) * 2)
            .attr('height', (d) => nodeRadius(d) * 2)
            .attr('clip-path', (d) => `url(#node-clip-${d.id})`)
            .attr('preserveAspectRatio', 'xMidYMid slice')
            .attr('pointer-events', 'none');

          // Initials text (only when no photo)
          g.filter((d) => !d.isCompany && !d.photo && !d.isGroupNode)
            .append('text')
            .attr('class', 'node-initials')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', (d) => Math.max(7, nodeRadius(d) * 0.55) + 'px')
            .attr('fill', 'rgba(255,255,255,0.85)')
            .attr('pointer-events', 'none')
            .attr('font-weight', '600')
            .text((d) => this._initials(d.name));

          // Company icon (only when no photo)
          g.filter((d) => d.isCompany && !d.photo && !d.isGroupNode)
            .append('text')
            .attr('class', 'node-company-icon')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', (d) => nodeRadius(d) * 0.9 + 'px')
            .attr('fill', '#fff')
            .attr('pointer-events', 'none')
            .text('🏢');

          g.filter((d) => d.isGroupNode)
            .append('text')
            .attr('class', 'node-group-icon')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', (d) => Math.max(11, nodeRadius(d) * 0.62) + 'px')
            .attr('fill', '#fff')
            .attr('pointer-events', 'none')
            .text((d) => this._groupGlyph(d));

          return g;
        },
        (update) => {
          update
            .select('.node-circle')
            .attr('r', (d) => nodeRadius(d))
            .attr('fill', (d) => this._nodeColor(d));
          update.select('.node-ring').attr('r', (d) => nodeRadius(d) + 5);
          update.select('clipPath circle').attr('r', (d) => nodeRadius(d));

          update.each((d, i, nodes) => {
            const g = d3.select(nodes[i]);

            g.selectAll('image').remove();
            g.selectAll('text.node-initials').remove();
            g.selectAll('text.node-company-icon').remove();
            g.selectAll('text.node-group-icon').remove();

            if (d.photo) {
              g.append('image')
                .attr('href', (d) => d.photo)
                .attr('x', (d) => -nodeRadius(d))
                .attr('y', (d) => -nodeRadius(d))
                .attr('width', (d) => nodeRadius(d) * 2)
                .attr('height', (d) => nodeRadius(d) * 2)
                .attr('clip-path', (d) => `url(#node-clip-${d.id})`)
                .attr('preserveAspectRatio', 'xMidYMid slice')
                .attr('pointer-events', 'none');
            } else if (d.isGroupNode) {
              g.append('text')
                .attr('class', 'node-group-icon')
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .attr('font-size', (d) => Math.max(11, nodeRadius(d) * 0.62) + 'px')
                .attr('fill', '#fff')
                .attr('pointer-events', 'none')
                .text((d) => this._groupGlyph(d));
            } else if (d.isCompany) {
              g.append('text')
                .attr('class', 'node-company-icon')
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .attr('font-size', (d) => nodeRadius(d) * 0.9 + 'px')
                .attr('fill', '#fff')
                .attr('pointer-events', 'none')
                .text('🏢');
            } else {
              g.append('text')
                .attr('class', 'node-initials')
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .attr('font-size', (d) => Math.max(7, nodeRadius(d) * 0.55) + 'px')
                .attr('fill', 'rgba(255,255,255,0.85)')
                .attr('pointer-events', 'none')
                .attr('font-weight', '600')
                .text((d) => this._initials(d.name));
            }
          });
          return update;
        },
        (exit) => exit.remove(),
      );

    // ── Labels ──
    const label = this._labelG
      .selectAll('text.node-label')
      .data(nodes, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append('text')
            .attr('class', 'node-label')
            .attr('text-anchor', 'middle')
            .attr('dy', (d) => nodeRadius(d) + 14)
            .attr('font-size', '11px')
            .attr('pointer-events', 'none')
            .text((d) => d.name || ''),
        (update) => update.text((d) => d.name || '').attr('dy', (d) => nodeRadius(d) + 14),
        (exit) => exit.remove(),
      );

    // Resume the previous layout: seed each node from its cached position so an
    // edit doesn't re-scatter the graph. New nodes (no cache) use d3 defaults.
    let seeded = 0;
    for (const n of nodes) {
      const prev = this._nodePositions.get(n.id);
      if (prev) {
        n.x = prev.x;
        n.y = prev.y;
        n.vx = prev.vx || 0;
        n.vy = prev.vy || 0;
        if (prev.fx != null) n.fx = prev.fx;
        if (prev.fy != null) n.fy = prev.fy;
        seeded += 1;
      } else {
        // New node: start near the center so it settles into view rather than
        // crawling in from the origin.
        n.x = this.width / 2 + (Math.random() - 0.5) * 80;
        n.y = this.height / 2 + (Math.random() - 0.5) * 80;
      }
    }
    // Settle gently when the graph is largely unchanged (an edit); run a full
    // layout when most nodes are new (first load, mode/filter change).
    const incremental = nodes.length > 0 && seeded >= nodes.length * 0.5;

    // ── Simulation ──
    // The tick handler closes over this render's selections/nodes, so it's
    // re-bound every render. The simulation object and its force objects are
    // created once and reused (their accessors are pure functions of node/edge
    // data) — only .nodes()/.links()/center are repointed — preserving velocity
    // continuity and avoiding a full forceSimulation rebuild on every edit.
    const tick = () => {
      hull.attr('d', (d) => this._hullPath(d, nodes, nodeRadius));
      hullLabel
        .attr('transform', (d) => this._hullLabelTransform(d, nodes))
        .attr('opacity', (d) => this._hullLabelOpacity(d, nodes));
      link
        .select('line')
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      // Position source label near source node (32% along) when dual labels,
      // or centered (50%) when there is only one label
      link
        .select('text.edge-label-src')
        .attr('x', (d) => {
          const f = d.reverseLabel && d.reverseLabel !== d.label ? 0.32 : 0.5;
          return d.source.x + f * (d.target.x - d.source.x);
        })
        .attr('y', (d) => {
          const f = d.reverseLabel && d.reverseLabel !== d.label ? 0.32 : 0.5;
          return d.source.y + f * (d.target.y - d.source.y);
        });
      // Position target label near target node (68% along)
      link
        .select('text.edge-label-tgt')
        .attr('x', (d) => d.source.x + 0.68 * (d.target.x - d.source.x))
        .attr('y', (d) => d.source.y + 0.68 * (d.target.y - d.source.y));

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      label.attr('transform', (d) => `translate(${d.x},${d.y})`);

      // Remember positions so the next rebuild can resume this layout.
      for (const n of nodes) {
        this._nodePositions.set(n.id, {
          x: n.x,
          y: n.y,
          vx: n.vx,
          vy: n.vy,
          fx: n.fx,
          fy: n.fy,
        });
      }
    };

    if (!this._simulation) {
      this._simulation = d3
        .forceSimulation()
        .force(
          'link',
          d3
            .forceLink()
            .id((d) => d.id)
            .distance((d) => {
              if (d.edgeKind === 'geographic-hierarchy') return 58;
              if (d.edgeKind === 'geographic-membership') return 70;
              if (['likely-surname', 'likely-tag', 'likely-family'].includes(d.edgeKind)) return 65;
              if (d.category === 'family') return 80;
              if (d.category === 'work') return 100;
              return 120;
            })
            .strength((d) => {
              if (d.edgeKind === 'geographic-hierarchy') return 0.9;
              if (d.edgeKind === 'geographic-membership') return 0.82;
              if (['likely-surname', 'likely-tag', 'likely-family'].includes(d.edgeKind))
                return 0.76;
              return 0.4;
            }),
        )
        .force(
          'charge',
          d3
            .forceManyBody()
            .strength((d) => (d.isGroupNode ? -520 : d.isCompany ? -400 : -150))
            .distanceMax(400),
        )
        .force('center', d3.forceCenter(this.width / 2, this.height / 2))
        .force(
          'collide',
          d3.forceCollide((d) => nodeRadius(d) + 8),
        );
    }

    const sim = this._simulation;
    sim.nodes(nodes);
    sim.force('link').links(validEdges);
    sim.force('center', d3.forceCenter(this.width / 2, this.height / 2));
    sim.on('tick', tick);
    sim.alpha(incremental ? 0.3 : 1).restart();
  }

  // ── Selection & Highlighting ────────────────────────────────────

  _selectNode(id, emit = true) {
    this._selectedNode = id;

    const connectedNodeIds = new Set([id]);
    (this._edgesByNodeId.get(id) || []).forEach((e) => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      if (s === id) connectedNodeIds.add(t);
      if (t === id) connectedNodeIds.add(s);
    });

    // Fade non-connected
    this._nodeG.selectAll('g.node').attr('opacity', (d) => (connectedNodeIds.has(d.id) ? 1 : 0.15));

    this._linkG.selectAll('g.link').attr('opacity', (e) => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      return s === id || t === id ? 1 : 0.05;
    });

    this._labelG
      .selectAll('text.node-label')
      .attr('opacity', (d) => (connectedNodeIds.has(d.id) ? 1 : 0.1));
    this._hullG
      .selectAll('path.cluster-hull')
      .attr('opacity', (d) =>
        (d.memberIds || []).some((memberId) => connectedNodeIds.has(memberId)) ? 1 : 0.2,
      );
    this._hullLabelG
      .selectAll('text.hull-label')
      .attr('opacity', (d) =>
        (d.memberIds || []).some((memberId) => connectedNodeIds.has(memberId)) ? 1 : 0.18,
      );

    // Ring
    this._nodeG.selectAll('g.node .node-ring').attr('opacity', (d) => (d.id === id ? 1 : 0));

    if (emit) {
      const nodeData = this._nodeById.get(id);
      if (nodeData) this.emit('nodeSelect', nodeData);
    }
  }

  _deselectAll() {
    this._selectedNode = null;
    this._nodeG.selectAll('g.node').attr('opacity', 1);
    this._linkG.selectAll('g.link').attr('opacity', 1);
    this._labelG.selectAll('text.node-label').attr('opacity', 1);
    this._hullG.selectAll('path.cluster-hull').attr('opacity', 1);
    this._hullLabelG
      .selectAll('text.hull-label')
      .attr('opacity', (d) => this._hullLabelOpacity(d, this._nodes));
    this._nodeG.selectAll('.node-ring').attr('opacity', 0);
    this.emit('nodeDeselect', null);
  }

  _zoomToNode(id) {
    const node = this._nodeById.get(id);
    if (!node || !node.x) return;
    const t = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(1.5)
      .translate(-node.x, -node.y);
    this._svg.transition().duration(600).call(this._zoom.transform, t);
  }

  // ── Hover ───────────────────────────────────────────────────────

  _onHover(event, d, entering) {
    if (entering) {
      this._hoveredNode = d.id;
      this._tooltip
        .html(this._tooltipHTML(d))
        .style('opacity', 1)
        .style('left', event.pageX + 12 + 'px')
        .style('top', event.pageY - 28 + 'px');
    } else {
      this._hoveredNode = null;
      this._tooltip.style('opacity', 0);
    }
  }

  _tooltipHTML(d) {
    const lines = [`<strong>${this._escapeHtml(d.name)}</strong>`];
    if (d.org) lines.push(`<em>${this._escapeHtml(d.org)}</em>`);
    if (d.connectionCount)
      lines.push(`${d.connectionCount} connection${d.connectionCount !== 1 ? 's' : ''}`);
    return lines.join('<br>');
  }

  // ── Drag ────────────────────────────────────────────────────────

  _dragStarted(event, d) {
    if (!event.active) this._simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  _dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  _dragEnded(event, d) {
    if (!event.active) this._simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  // ── Utility ──────────────────────────────────────────────────────

  _nodeColor(d) {
    if (d.id === this._selectedNode) return this._colorScheme.node.selected;
    if (d.isGroupNode) return this._colorScheme.node.group;
    return this._colorScheme.node[d.category] || this._colorScheme.node.other;
  }

  _edgeWidth(d) {
    if (d.edgeKind === 'geographic-hierarchy') return 2.2;
    if (d.edgeKind === 'geographic-membership') return 1.6;
    if (['likely-surname', 'likely-tag', 'likely-family'].includes(d.edgeKind)) return 1.4;
    return d.inferred ? 1 : 2;
  }

  _edgeDashArray(d) {
    if (['likely-surname', 'likely-tag', 'likely-family'].includes(d.edgeKind)) return '6 4';
    if (d.edgeKind === 'geographic-membership') return '2 2';
    return d.inferred ? '4 3' : null;
  }

  _hullOpacity(d) {
    if ((d.kind || '').startsWith('geo-')) {
      const depth = d.depth || 1;
      return Math.max(0.04, 0.1 - (depth - 1) * 0.015);
    }
    return 0.12;
  }

  _hullPath(hull, nodes, nodeRadius) {
    const members = (hull.memberIds || [])
      .map((id) => this._nodeById.get(id))
      .filter((n) => n && Number.isFinite(n.x) && Number.isFinite(n.y));
    if (members.length < 2) return '';

    const points = [];
    for (const member of members) {
      const r = nodeRadius(member) + 12;
      points.push([member.x - r, member.y - r]);
      points.push([member.x - r, member.y + r]);
      points.push([member.x + r, member.y - r]);
      points.push([member.x + r, member.y + r]);
    }
    const polygon = d3.polygonHull(points);
    if (!polygon) return '';
    return `M${polygon.join('L')}Z`;
  }

  _hullLabelTransform(hull, nodes) {
    const anchor = this._hullLabelAnchor(hull, nodes);
    if (!anchor) return 'translate(-9999,-9999)';
    return `translate(${anchor.x},${anchor.y}) scale(${this._hullLabelScaleFactor()})`;
  }

  _hullLabelAnchor(hull, _nodes) {
    const members = (hull.memberIds || [])
      .map((id) => this._nodeById.get(id))
      .filter((n) => n && Number.isFinite(n.x) && Number.isFinite(n.y));
    if (members.length < 2) return null;

    const bounds = members.reduce(
      (acc, node) => {
        const r =
          (node.isGroupNode
            ? Math.max(12, 18 - (node.groupDepth || 1) * 1.5)
            : node.isCompany
              ? 12
              : node.isVirtual
                ? 6
                : 10) +
          Math.min((node.connectionCount || 0) * 1.5, 10) +
          12;
        acc.minX = Math.min(acc.minX, node.x - r);
        acc.maxX = Math.max(acc.maxX, node.x + r);
        acc.minY = Math.min(acc.minY, node.y - r);
        acc.maxY = Math.max(acc.maxY, node.y + r);
        return acc;
      },
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );

    const offset = 12 + 10 / Math.max(this._zoomScale || 1, 0.45);
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: bounds.minY - offset,
    };
  }

  _hullLabelScaleFactor() {
    const k = this._zoomScale || 1;
    return 1 / Math.max(0.45, Math.min(k, 1.2));
  }

  _hullLabelOpacity(hull, _nodes) {
    const members = (hull.memberIds || []).map((id) => this._nodeById.get(id)).filter(Boolean);
    if (members.length < 2 || !hull.label) return 0;
    return members.length >= 3 ? 0.92 : 0.84;
  }

  _groupGlyph(d) {
    if ((d.groupKind || '').startsWith('geo-')) return '◎';
    if (d.groupKind === 'likely-surname') return '≈';
    if (d.groupKind === 'likely-tag') return '#';
    return '◌';
  }

  _initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  _escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _indexNodes(nodes = []) {
    return new Map((nodes || []).map((node) => [node.id, node]));
  }

  _indexEdgesByNode(edges = []) {
    const index = new Map();
    const add = (id, edge) => {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(edge);
    };
    for (const edge of edges || []) {
      const source = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const target = typeof edge.target === 'object' ? edge.target.id : edge.target;
      add(source, edge);
      add(target, edge);
    }
    return index;
  }

  // ── Legend data ─────────────────────────────────────────────────
  getLegend(mode = this._mode) {
    // Solid swatch colors come from the shared palette (via _colorScheme).
    const node = this._colorScheme.node;
    const edge = this._colorScheme.edge;
    const dashed = (color, on, gap) =>
      `background: repeating-linear-gradient(to right, ${color} 0, ${color} ${on}px, transparent ${on}px, transparent ${gap}px);`;
    const hullStyle =
      'background: rgba(116,185,255,0.12); border: 1px solid rgba(116,185,255,0.28);';

    if (mode === 'connections' || mode === 'likely-connections' || mode === 'likely-family') {
      return [
        { label: 'Contact', color: node.other, type: 'node' },
        { label: 'Company', color: node.company, type: 'node' },
        { label: 'Virtual', color: node.virtual, type: 'node' },
        { label: 'Likely cluster hull', type: 'hull', style: hullStyle },
        { label: 'Likely family', type: 'line', style: dashed(edge.family, 5, 9) },
        { label: 'Likely connection', type: 'line', style: dashed(edge.work, 5, 9) },
        { label: 'Explicit relationship', type: 'line', style: `background: ${edge.family};` },
        { label: 'Organization cluster', type: 'line', style: dashed(edge.inferred, 4, 7) },
      ];
    }
    if (mode === 'geographic') {
      return [
        { label: 'Contact', color: node.other, type: 'node' },
        { label: 'Location group', color: node.group, type: 'node' },
        { label: 'Geographic hull', type: 'hull', style: hullStyle },
        { label: 'Hierarchy link', type: 'line', style: `background: ${edge.work};` },
        { label: 'Contact membership', type: 'line', style: dashed(edge.other, 3, 6) },
      ];
    }
    return [
      { label: 'Contact', color: node.other, type: 'node' },
      { label: 'Company', color: node.company, type: 'node' },
      { label: 'Virtual', color: node.virtual, type: 'node' },
      { label: 'Family rel.', type: 'line', style: `background: ${edge.family};` },
      { label: 'Inferred (org)', type: 'line', style: dashed(edge.inferred, 4, 7) },
    ];
  }
}
