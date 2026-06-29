import { RelationshipTaxonomy } from './relationship-taxonomy.js';
import { ContactRecord } from './contact-record.js';

/**
 * Builds graph nodes and edges from parsed contacts.
 * Handles:
 *   1. Explicit relationships (X-ABRELATEDNAMES)
 *   2. Inferred relationships (shared ORG)
 */
export class RelationshipBuilder {
  constructor(contacts) {
    this.contacts = contacts;
    this._nameIndex = this._buildNameIndex(contacts);
    this._uidIndex = new Map();
    for (const c of contacts) {
      if (c.uid) this._uidIndex.set(String(c.uid), c);
    }
  }

  /**
   * Resolve a relationship's target contact. Prefers an explicit `uid` on the
   * relationship (exact, rename-proof — Markdown relations can carry one), then
   * falls back to name matching. Returns null when unresolved (→ virtual node).
   */
  findRelationTarget(rel) {
    if (rel && rel.uid) {
      const byUid = this._uidIndex.get(String(rel.uid));
      if (byUid) return byUid;
    }
    return this.findContact(rel && rel.name);
  }

  _buildNameIndex(contacts) {
    const index = new Map();

    // Keep all contacts for a lookup key so collisions can be treated as ambiguous
    // instead of silently linking a relationship to the wrong person.
    const add = (key, c) => {
      if (!key) return;
      if (!index.has(key)) index.set(key, []);
      const matches = index.get(key);
      if (!matches.includes(c)) {
        matches.push(c);
        if (matches.length === 2) {
          console.warn(
            `[nameIndex] Ambiguous lookup key "${key}" — ` +
              `"${matches[0].fn}" and "${c.fn}" both match; leaving lookups unresolved.`,
          );
        }
      }
    };

    for (const c of contacts) {
      if (!c.fn) continue;
      const fn = c.fn.trim();
      const lower = fn.toLowerCase();

      // Exact FN
      add(lower, c);
      // Without nickname tokens (e.g. Micah "Tikah" Mangold → Micah Mangold)
      const stripped = fn
        .replace(/["'][^"']*["']/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (stripped && stripped !== lower) add(stripped, c);
      // Last, First
      const parts = fn.split(/\s+/);
      if (parts.length >= 2) {
        add(`${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`.toLowerCase(), c);
      }
      // First Last only (drop middle names / suffixes) for 3+-word names
      if (parts.length >= 3) {
        add(`${parts[0]} ${parts[parts.length - 1]}`.toLowerCase(), c);
      }
    }
    return index;
  }

  findContacts(name) {
    if (!name) return [];
    const key = name.toLowerCase().trim();
    if (this._nameIndex.has(key)) return this._nameIndex.get(key);
    const stripped = key
      .replace(/["'][^"']*["']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return this._nameIndex.get(stripped) || [];
  }

  findContact(name) {
    const matches = this.findContacts(name);
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * Returns { nodes: [...], edges: [...] }
   * nodes: ContactNode objects (enriched contacts)
   * edges: { source, target, type, category, inferred, org? }
   */
  build(options = {}) {
    const {
      mode = 'connections',
      includeInferred = true,
      includeLikelyFamily = true,
      includeLikelyConnections = true,
      includeIsolated = false,
      rootContactId = null,
    } = options;

    if (
      mode === 'connections' ||
      mode === 'family-explicit' ||
      mode === 'likely-family' ||
      mode === 'likely-connections'
    ) {
      return this._buildExplicitRelationships({
        includeInferred,
        includeLikelyFamily,
        includeLikelyConnections,
        includeIsolated,
        rootContactId,
      });
    }
    if (mode === 'geographic') {
      return this._buildGeographic({ includeIsolated, rootContactId });
    }
    return this._buildExplicitRelationships({ includeInferred, includeIsolated, rootContactId });
  }

  _buildExplicitRelationships({
    includeInferred = true,
    includeLikelyFamily = true,
    includeLikelyConnections = true,
    includeIsolated = false,
    rootContactId = null,
  }) {
    const nodesMap = new Map(); // id → node
    const pairSet = new Set(); // deduplicate edges by pair (one edge per node pair)
    const edges = [];
    const explicitAdj = new Map(); // id → Set of explicitly connected ids

    // ── 1. Seed nodes from all contacts ──────────────────────────
    for (const c of this.contacts) {
      nodesMap.set(c.id, this._makeNode(c));
    }

    // ── 2. Explicit relationships ─────────────────────────────────
    this._appendExplicitRelationshipEdges(nodesMap, edges, pairSet, explicitAdj, {
      allowVirtualTargets: true,
    });

    // ── 3. Inferred (ORG-based) relationships ─────────────────────
    if (includeInferred) {
      const orgGroups = new Map();
      for (const c of this.contacts) {
        if (c.org && !c.isCompany && c.org.length > 1) {
          const orgKey = c.org.trim();
          if (!orgGroups.has(orgKey)) orgGroups.set(orgKey, []);
          orgGroups.get(orgKey).push(c);
        }
      }

      for (const [org, members] of orgGroups) {
        // Only connect reasonably sized groups (skip generic mega-orgs)
        if (members.length < 2 || members.length > 30) continue;

        const edgeSet = new Set(edges.map((e) => `${this._pairKey(e.source, e.target)}:${e.type}`));
        for (let i = 0; i < members.length; i++) {
          for (let j = i + 1; j < members.length; j++) {
            const key = this._edgeKey(members[i].id, members[j].id, 'colleague');
            const pk = this._pairKey(members[i].id, members[j].id);
            if (!pairSet.has(pk) && !edgeSet.has(key)) {
              pairSet.add(pk);
              edgeSet.add(key);
              edges.push({
                id: `e_${edges.length}`,
                source: members[i].id,
                target: members[j].id,
                type: 'colleague',
                rawType: org,
                label: org,
                category: 'work',
                inferred: true,
                org,
              });
              nodesMap.get(members[i].id).connectionCount++;
              nodesMap.get(members[j].id).connectionCount++;
            }
          }
        }
      }
    }

    const familyConnectedIds = this._collectConnectedIds(rootContactId, explicitAdj);
    let hullSeeds = [
      {
        id: 'family-network',
        label: 'Family Network',
        memberIds: Array.from(familyConnectedIds),
        kind: 'family-network',
        depth: 1,
        color: '#e17055',
      },
    ];

    if (includeLikelyFamily || includeLikelyConnections) {
      hullSeeds = hullSeeds.concat(
        this._appendLikelyConnectionGroups(nodesMap, edges, pairSet, {
          includeLikelyFamily,
          includeLikelyConnections,
        }),
      );
    }

    // ── 4. Assign primary category to each node ───────────────────
    for (const node of nodesMap.values()) {
      node.category = this._nodeCategory(node);
      node.filterTags = this._filterTags(node, familyConnectedIds);
    }

    // ── 5. Filter nodes ───────────────────────────────────────────
    const connectedIds = new Set();
    for (const e of edges) {
      connectedIds.add(typeof e.source === 'object' ? e.source.id : e.source);
      connectedIds.add(typeof e.target === 'object' ? e.target.id : e.target);
    }

    const filteredNodes = includeIsolated
      ? Array.from(nodesMap.values())
      : Array.from(nodesMap.values()).filter((n) => connectedIds.has(n.id));

    return {
      mode: 'connections',
      nodes: filteredNodes,
      edges,
      hulls: this._buildClusterHulls(filteredNodes, hullSeeds),
    };
  }

  _buildGeographic({ includeIsolated = false, rootContactId = null }) {
    const nodesMap = new Map();
    const edges = [];
    const hierarchyGroups = new Map();
    const groupMemberIds = new Map();
    const edgeSet = new Set();
    const familyConnectedIds = this._collectConnectedIds(
      rootContactId,
      this._buildExplicitAdjacency(),
    );

    for (const c of this.contacts) {
      const node = this._makeNode(c);
      node.category = this._nodeCategory(node);
      node.filterTags = this._filterTags(node, familyConnectedIds);
      nodesMap.set(c.id, node);
    }

    let edgeIdx = 0;
    for (const c of this.contacts) {
      const path = this._preferredAddressPath(c);
      if (path.length === 0) {
        if (!includeIsolated) continue;
        const noAddrGroup = this._ensureGeoGroup(nodesMap, hierarchyGroups, groupMemberIds, {
          id: 'geo__country__no-address',
          name: 'No Address',
          title: 'Contacts without a usable address',
          kind: 'geo-country',
          depth: 1,
        });
        this._addUniqueEdge(edges, edgeSet, {
          id: `e_${edgeIdx++}`,
          source: noAddrGroup.id,
          target: c.id,
          type: 'located-at',
          label: 'No address',
          category: 'other',
          inferred: true,
          edgeKind: 'geographic-membership',
        });
        noAddrGroup.connectionCount++;
        nodesMap.get(c.id).connectionCount++;
        groupMemberIds.get(noAddrGroup.id).add(c.id);
        continue;
      }

      let parentGroupId = null;
      let currentPath = [];
      for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        currentPath.push(segment.key);
        const groupId = `geo__${segment.level}__${currentPath.join('__')}`;
        this._ensureGeoGroup(nodesMap, hierarchyGroups, groupMemberIds, {
          id: groupId,
          name: segment.label,
          title: segment.description,
          kind: `geo-${segment.level}`,
          depth: i + 1,
        });
        groupMemberIds.get(groupId).add(c.id);

        if (parentGroupId) {
          this._addUniqueEdge(edges, edgeSet, {
            id: `e_${edgeIdx++}`,
            source: parentGroupId,
            target: groupId,
            type: 'contains',
            label: '',
            category: 'other',
            inferred: true,
            edgeKind: 'geographic-hierarchy',
          });
        }
        parentGroupId = groupId;
      }

      if (parentGroupId) {
        this._addUniqueEdge(edges, edgeSet, {
          id: `e_${edgeIdx++}`,
          source: parentGroupId,
          target: c.id,
          type: 'located-at',
          label: '',
          category: 'other',
          inferred: true,
          edgeKind: 'geographic-membership',
        });
        nodesMap.get(c.id).connectionCount++;
        const parent = nodesMap.get(parentGroupId);
        if (parent) parent.connectionCount++;
      }
    }

    const filteredNodes = includeIsolated
      ? Array.from(nodesMap.values())
      : Array.from(nodesMap.values()).filter((n) => n.isGroupNode || n.connectionCount > 0);

    const hullSeeds = [];
    for (const [groupId, memberSet] of groupMemberIds.entries()) {
      if (memberSet.size < 2) continue;
      const node = nodesMap.get(groupId);
      if (!node) continue;
      hullSeeds.push({
        id: `hull__${groupId}`,
        label: node.name,
        memberIds: Array.from(memberSet),
        kind: node.groupKind || 'geographic',
        depth: node.groupDepth || 1,
        color: this._geoHullColor(node.groupDepth || 1),
      });
    }

    return {
      mode: 'geographic',
      nodes: filteredNodes,
      edges,
      hulls: this._buildClusterHulls(filteredNodes, hullSeeds),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────

  _makeNode(c) {
    const node = {
      id: c.id,
      name: c.fn, // graph node display name = contact's FN
      structuredName: c.name || null,
      isVirtual: false,
      customFields: c.customFields || {},
      record: c.record || null,
      sourceDocuments: c.sourceDocuments || [],
      rawVCard: c.rawVCard || null,
      connectionCount: 0,
      category: 'other',
      filterTags: [],
      isGroupNode: false,
    };
    // Copy the standard contact fields (org / title / emails / … / photo) from
    // the single ContactRecord field registry; fn and name are projected to
    // name and structuredName above.
    for (const { key, default: makeDefault } of ContactRecord.STANDARD_FIELDS) {
      if (key === 'fn' || key === 'name') continue;
      node[key] = c[key] || makeDefault();
    }
    return node;
  }

  _makeGroupNode({ id, name, title = '', kind = 'group', depth = 1, count = 0 }) {
    return {
      id,
      name,
      structuredName: null,
      org: '',
      title,
      isCompany: false,
      isVirtual: false,
      emails: [],
      phones: [],
      addresses: [],
      urls: [],
      birthday: null,
      anniversary: null,
      notes: [],
      related: [],
      tags: [],
      photo: null,
      rawVCard: null,
      connectionCount: count,
      category: 'other',
      filterTags: [],
      isGroupNode: true,
      groupKind: kind,
      groupDepth: depth,
      memberIds: [],
    };
  }

  _collectConnectedIds(rootId, adjacency) {
    if (!rootId || !adjacency.has(rootId)) return new Set();

    const seen = new Set([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adjacency.get(current) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  }

  _filterTags(node, familyConnectedIds) {
    if (node.isGroupNode) return [];
    const tags = new Set(
      [...(node.tags || []), ...(node.noteTags || [])].filter((t) => t !== 'family'),
    );

    if (node.isVirtual) tags.add('virtual');
    else if (node.isCompany) tags.add('company');
    if (!node.isVirtual && !node.isCompany && tags.size === 0) tags.add('other');

    if (familyConnectedIds.has(node.id)) tags.add('family');

    return Array.from(tags);
  }

  _edgeKey(a, b, type) {
    return [a, b].sort().join('↔') + ':' + type;
  }

  _pairKey(a, b) {
    return [a, b].sort().join('↔');
  }

  _appendExplicitRelationshipEdges(
    nodesMap,
    edges,
    pairSet,
    explicitAdj,
    { allowVirtualTargets = true } = {},
  ) {
    const edgeSet = new Set();
    for (const c of this.contacts) {
      for (const rel of c.related || []) {
        const target = this.findRelationTarget(rel);
        const targetId = target ? target.id : `virtual__${rel.name.replace(/[^a-zA-Z0-9]/g, '_')}`;

        if (!target && !allowVirtualTargets) continue;

        if (!nodesMap.has(targetId)) {
          nodesMap.set(targetId, {
            id: targetId,
            name: rel.name,
            org: '',
            isCompany: false,
            isVirtual: true,
            emails: [],
            phones: [],
            birthday: null,
            notes: [],
            related: [],
            tags: ['virtual'],
            noteTags: [],
            category: 'virtual',
            photo: null,
            connectionCount: 0,
            filterTags: ['virtual'],
            isGroupNode: false,
          });
        }

        const key = this._edgeKey(c.id, targetId, rel.type);
        const pk = this._pairKey(c.id, targetId);
        if (!pairSet.has(pk) && !edgeSet.has(key)) {
          pairSet.add(pk);
          edgeSet.add(key);
          edges.push({
            id: `e_${edges.length}`,
            source: c.id,
            target: targetId,
            type: rel.type,
            rawType: rel.rawType,
            label: this._friendlyType(rel.type),
            reverseLabel: null,
            category: this._edgeCategory(rel.type),
            inferred: false,
            edgeKind: 'explicit',
            isConfirmed: true,
          });
          nodesMap.get(c.id).connectionCount++;
          nodesMap.get(targetId).connectionCount++;
          if (!explicitAdj.has(c.id)) explicitAdj.set(c.id, new Set());
          if (!explicitAdj.has(targetId)) explicitAdj.set(targetId, new Set());
          explicitAdj.get(c.id).add(targetId);
          explicitAdj.get(targetId).add(c.id);
        } else if (pairSet.has(pk)) {
          const existingEdge = edges.find((e) => this._pairKey(e.source, e.target) === pk);
          if (
            existingEdge &&
            existingEdge.target === c.id &&
            existingEdge.reverseLabel === null &&
            this._isValidReciprocal(existingEdge.type, rel.type)
          ) {
            existingEdge.reverseLabel = this._friendlyType(rel.type);
          }
        }
      }
    }
  }

  _appendLikelyConnectionGroups(
    nodesMap,
    edges,
    pairSet,
    { includeLikelyFamily = true, includeLikelyConnections = true } = {},
  ) {
    const hullSeeds = [];
    let edgeIdx = edges.length;
    if (includeLikelyFamily) {
      const surnameGroups = new Map();
      for (const c of this.contacts) {
        if (c.isCompany) continue;
        const familyName = this._familyNameForContact(c);
        const key = this._normalizeFamilyKey(familyName);
        if (!key) continue;
        if (!surnameGroups.has(key)) {
          surnameGroups.set(key, { label: familyName.trim(), contacts: [] });
        }
        surnameGroups.get(key).contacts.push(c);
      }

      for (const [key, group] of surnameGroups) {
        if (group.contacts.length < 2) continue;
        const hubId = `family_group__${key}`;
        const hub = this._makeGroupNode({
          id: hubId,
          name: `${group.label} family`,
          title: 'Likely family cluster by shared surname',
          kind: 'likely-surname',
          depth: 1,
          count: group.contacts.length,
        });
        nodesMap.set(hubId, hub);

        const memberIds = [];
        for (const c of group.contacts) {
          const node = nodesMap.get(c.id);
          if (!node) continue;
          node.connectionCount++;
          memberIds.push(c.id);
          const pairKey = this._pairKey(hubId, c.id);
          if (pairSet.has(pairKey)) continue;
          pairSet.add(pairKey);
          edges.push({
            id: `e_${edgeIdx++}`,
            source: hubId,
            target: c.id,
            type: 'likely-surname',
            label: group.label,
            category: 'family',
            inferred: true,
            edgeKind: 'likely-surname',
            confidence: 0.45,
            isConfirmed: false,
          });
        }
        hub.connectionCount = memberIds.length;
        hub.memberIds = memberIds;
        hullSeeds.push({
          id: `hull__${hubId}`,
          label: group.label,
          memberIds,
          kind: 'likely-surname',
          depth: 1,
          color: '#e17055',
        });
      }
    }

    if (includeLikelyConnections) {
      const hashtagGroups = new Map();
      for (const c of this.contacts) {
        for (const tag of c.noteTags || []) {
          if (!hashtagGroups.has(tag)) hashtagGroups.set(tag, []);
          hashtagGroups.get(tag).push(c);
        }
      }

      for (const [tag, members] of hashtagGroups) {
        if (members.length < 2) continue;
        const hubId = `tag_group__${tag}`;
        const hub = this._makeGroupNode({
          id: hubId,
          name: `#${tag}`,
          title: 'Likely connection cluster by shared hashtag',
          kind: 'likely-tag',
          depth: 1,
          count: members.length,
        });
        nodesMap.set(hubId, hub);

        const memberIds = [];
        for (const c of members) {
          const node = nodesMap.get(c.id);
          if (!node) continue;
          node.connectionCount++;
          memberIds.push(c.id);
          const pairKey = this._pairKey(hubId, c.id);
          if (pairSet.has(pairKey)) continue;
          pairSet.add(pairKey);
          edges.push({
            id: `e_${edgeIdx++}`,
            source: hubId,
            target: c.id,
            type: 'likely-tag',
            label: `#${tag}`,
            category: 'other',
            inferred: true,
            edgeKind: 'likely-tag',
            confidence: 0.38,
            isConfirmed: false,
          });
        }
        hub.connectionCount = memberIds.length;
        hub.memberIds = memberIds;
        hullSeeds.push({
          id: `hull__${hubId}`,
          label: `#${tag}`,
          memberIds,
          kind: 'likely-tag',
          depth: 1,
          color: '#74b9ff',
        });
      }
    }
    return hullSeeds;
  }

  _buildExplicitAdjacency() {
    const adjacency = new Map();
    for (const c of this.contacts) {
      if (!adjacency.has(c.id)) adjacency.set(c.id, new Set());
      for (const rel of c.related || []) {
        const target = this.findRelationTarget(rel);
        if (!target) continue;
        if (!adjacency.has(target.id)) adjacency.set(target.id, new Set());
        adjacency.get(c.id).add(target.id);
        adjacency.get(target.id).add(c.id);
      }
    }
    return adjacency;
  }

  _addUniqueEdge(edges, edgeSet, edge) {
    const edgeKey = `${this._pairKey(edge.source, edge.target)}:${edge.edgeKind || edge.type}`;
    if (edgeSet.has(edgeKey)) return;
    edgeSet.add(edgeKey);
    edges.push(edge);
  }

  _ensureGeoGroup(nodesMap, hierarchyGroups, groupMemberIds, descriptor) {
    if (!hierarchyGroups.has(descriptor.id)) {
      const node = this._makeGroupNode({
        id: descriptor.id,
        name: descriptor.name,
        title: descriptor.title,
        kind: descriptor.kind,
        depth: descriptor.depth,
      });
      nodesMap.set(node.id, node);
      hierarchyGroups.set(node.id, node);
      groupMemberIds.set(node.id, new Set());
    }
    return hierarchyGroups.get(descriptor.id);
  }

  _buildClusterHulls(nodes, hullSeeds) {
    const visibleIds = new Set(nodes.map((n) => n.id));
    return hullSeeds.filter(
      (hull) => hull.memberIds.filter((id) => visibleIds.has(id)).length >= 2,
    );
  }

  _familyNameForContact(contact) {
    const family = String(contact?.name?.family || '').trim();
    if (family) return family;
    const parts = String(contact?.fn || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 1] : '';
  }

  _normalizeFamilyKey(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9'-]/g, '')
      .trim();
  }

  _preferredAddressPath(contact) {
    const address = this._preferredAddress(contact);
    if (!address) return [];
    const country = this._normalizeGeoLabel(address.country);
    const state = this._normalizeGeoLabel(address.state);
    const city = this._normalizeGeoLabel(address.city);
    const street = this._normalizeStreet(address.street);

    const path = [];
    if (country) {
      path.push({
        level: 'country',
        key: this._normalizeGeoKey(country),
        label: country,
        description: 'Country cluster',
      });
    }
    if (state) {
      path.push({
        level: 'state',
        key: this._normalizeGeoKey(state),
        label: state,
        description: 'State / province cluster',
      });
    }
    if (city) {
      path.push({
        level: 'city',
        key: this._normalizeGeoKey(city),
        label: city,
        description: 'City cluster',
      });
    }
    if (street) {
      path.push({
        level: 'street',
        key: this._normalizeGeoKey(street),
        label: street,
        description: 'Street cluster',
      });
    }
    return path;
  }

  _preferredAddress(contact) {
    const addresses = contact.addresses || [];
    if (addresses.length === 0) return null;

    const score = (addr) => {
      const types = (addr.types || []).map((t) => String(t || '').toLowerCase());
      if (types.includes('home')) return 0;
      if (types.includes('work')) return 1;
      return 2;
    };

    return [...addresses].sort((a, b) => score(a) - score(b))[0] || null;
  }

  _normalizeGeoLabel(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _normalizeStreet(value) {
    const normalized = this._normalizeGeoLabel(value).replace(/,+/g, ',');
    if (!normalized) return '';

    // Collapse street-level grouping to the road name instead of full house address,
    // so "1217 Windswept Circle" and "1301 Windswept Circle" share one cluster.
    const withoutNumber = normalized.replace(/^\s*\d+[A-Za-z0-9\-/]*\s+/, '').trim();
    return withoutNumber || normalized;
  }

  _normalizeGeoKey(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  _geoHullColor(depth) {
    const palette = {
      1: '#74b9ff',
      2: '#55efc4',
      3: '#fdcb6e',
      4: '#fd79a8',
    };
    return palette[depth] || '#b2bec3';
  }

  /**
   * Returns true when typeA and typeB are a sensible reciprocal pair,
   * e.g. "son" / "father" or "spouse" / "spouse".
   * Prevents data-entry errors from surfacing as wrong edge labels.
   */
  _isValidReciprocal(typeA, typeB) {
    return RelationshipTaxonomy.isValidReciprocal(typeA, typeB);
  }

  _friendlyType(type) {
    return RelationshipTaxonomy.label(type);
  }

  _edgeCategory(type) {
    return RelationshipTaxonomy.category(type);
  }

  _nodeCategory(node) {
    if (node.isVirtual) return 'virtual';
    if (node.isCompany) return 'company';
    return 'other';
  }

  /**
   * Get statistics about the contact set
   */
  getStats(nodes, edges) {
    const categoryCounts = {};
    for (const n of nodes) {
      if (n.isGroupNode) continue;
      categoryCounts[n.category] = (categoryCounts[n.category] || 0) + 1;
    }
    const edgeCategoryCounts = {};
    for (const e of edges) {
      edgeCategoryCounts[e.category] = (edgeCategoryCounts[e.category] || 0) + 1;
    }
    return {
      totalContacts: this.contacts.length,
      visibleNodes: nodes.filter((n) => !n.isGroupNode).length,
      visibleGroups: nodes.filter((n) => n.isGroupNode).length,
      edges: edges.length,
      categories: categoryCounts,
      edgeCategories: edgeCategoryCounts,
    };
  }
}
