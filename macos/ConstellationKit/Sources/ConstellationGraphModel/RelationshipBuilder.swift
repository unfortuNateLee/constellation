// Port of `js/relationship-builder.js` — builds graph nodes / edges / hulls from
// parsed contacts. Value-in / value-out: the builder is constructed once over an
// immutable `[Contact]` (mirroring the JS constructor's name / UID indexes) and
// `build(_:)` returns a fresh `GraphModel` each call. No mutable graph state is
// retained between builds.
//
// Determinism: everything that reaches output uses ordered structures
// (`OrderedDictionary`, insertion-ordered id sets, plain arrays) — never bare
// `Dictionary` iteration — so node / edge / hull order is stable across runs and
// matches the JS Map / object insertion order.
//
// Resolution rules preserved (DESIGN_SPEC §10):
//   • §10.1 UID-first target resolution — the Swift `RelatedValue` carries no
//     `uid` (the M1 model dropped it; even the Markdown adapter constructs
//     related entries without one), so in practice resolution is name-only here.
//     The UID index and the UID-first branch are kept intact so the rule turns
//     back on automatically if the model gains `RelatedValue.uid`.
//   • §10.2 duplicate names → ambiguous (a name key mapping to 2+ contacts never
//     auto-resolves; the reference stays unresolved → virtual).
//   • §10.3 virtual contacts for unresolved explicit targets.
//   • §10.4 "My Family" = the connected component of explicit edges containing
//     the chosen "me" contact.
//   • inferred clusters: shared ORG (colleague), shared surname (likely-family),
//     shared note hashtag (likely-connection).
//   • geographic hierarchy: country → state → city → street.

import ConstellationModel
import Foundation

public struct RelationshipBuilder {
    private let contacts: [Contact]
    /// name key → matching contacts (§10.2: 2+ ⇒ ambiguous, left unresolved).
    private let nameIndex: [String: [Contact]]
    /// UID → contact (§10.1 UID-first resolution).
    private let uidIndex: [String: Contact]

    public init(_ contacts: [Contact]) {
        self.contacts = contacts
        self.nameIndex = Self.buildNameIndex(contacts)
        var uids: [String: Contact] = [:]
        for c in contacts {
            if let uid = c.uid, !uid.isEmpty { uids[String(uid)] = c }
        }
        self.uidIndex = uids
    }

    // MARK: - Public API

    /// Build the graph for `options` (JS `build(options)`).
    public func build(_ options: GraphBuildOptions = GraphBuildOptions()) -> GraphModel {
        switch options.mode {
        case .connections, .familyExplicit, .likelyFamily, .likelyConnections:
            return buildExplicitRelationships(
                includeInferred: options.includeInferred,
                includeLikelyFamily: options.includeLikelyFamily,
                includeLikelyConnections: options.includeLikelyConnections,
                includeIsolated: options.includeIsolated,
                includeVirtual: options.includeVirtual,
                rootContactId: options.rootContactId
            )
        case .geographic:
            return buildGeographic(
                includeIsolated: options.includeIsolated,
                rootContactId: options.rootContactId
            )
        }
    }

    /// Resolve a relationship's target contact. UID-first (§10.1), then name
    /// matching (§10.2). Returns `nil` when unresolved (→ virtual node).
    public func findRelationTarget(_ rel: RelatedValue) -> Contact? {
        // §10.1 UID-first (rename-proof) — js/relationship-builder.js:26.
        if let uid = rel.uid, !uid.isEmpty, let byUid = uidIndex[uid] {
            return byUid
        }
        return findContact(rel.name)
    }

    /// Contact for a given UID, or `nil` (§10.1 UID-first).
    public func contact(forUID uid: String) -> Contact? { uidIndex[uid] }

    /// All contacts matching `name` (§10.2 — may be 0, 1, or many).
    public func findContacts(_ name: String?) -> [Contact] {
        guard let name, !name.isEmpty else { return [] }
        let key = name.lowercased().trimmingCharacters(in: .whitespaces)
        if let hit = nameIndex[key] { return hit }
        let stripped = Self.collapseSpaces(Self.stripQuoted(key)).trimmingCharacters(in: .whitespaces)
        return nameIndex[stripped] ?? []
    }

    /// Single unambiguous match, else `nil` (§10.2).
    public func findContact(_ name: String?) -> Contact? {
        let matches = findContacts(name)
        return matches.count == 1 ? matches[0] : nil
    }

    /// Contact-set statistics (JS `getStats`).
    public func getStats(nodes: [GraphNode], edges: [GraphEdge]) -> GraphStats {
        var categoryCounts = OrderedDictionary<Int>()
        for n in nodes where !n.isGroupNode {
            categoryCounts[n.category] = (categoryCounts[n.category] ?? 0) + 1
        }
        var edgeCategoryCounts = OrderedDictionary<Int>()
        for e in edges {
            edgeCategoryCounts[e.category] = (edgeCategoryCounts[e.category] ?? 0) + 1
        }
        let contactNodes = nodes.filter { !$0.isGroupNode }
        let realContacts = contactNodes.filter { !$0.isVirtual }.count
        let virtualContacts = contactNodes.filter { $0.isVirtual }.count
        let realConnections = edges.filter { !$0.inferred }.count
        let virtualConnections = edges.count - realConnections
        return GraphStats(
            loadedContacts: contacts.count,
            realContacts: realContacts,
            virtualContacts: virtualContacts,
            totalContacts: realContacts + virtualContacts,
            realConnections: realConnections,
            virtualConnections: virtualConnections,
            totalConnections: edges.count,
            visibleNodes: contactNodes.count,
            visibleGroups: nodes.filter { $0.isGroupNode }.count,
            edges: edges.count,
            categories: categoryCounts,
            edgeCategories: edgeCategoryCounts
        )
    }

    // MARK: - Explicit-relationship graph

    private func buildExplicitRelationships(
        includeInferred: Bool,
        includeLikelyFamily: Bool,
        includeLikelyConnections: Bool,
        includeIsolated: Bool,
        includeVirtual: Bool,
        rootContactId: String?
    ) -> GraphModel {
        var nodes = OrderedDictionary<GraphNode>()  // id → node
        var pairSet = Set<String>()  // one edge per node pair
        var edges: [GraphEdge] = []
        var explicitAdj: [String: OrderedIDSet] = [:]  // id → connected ids

        // ── 1. Seed nodes from all contacts ──────────────────────
        for c in contacts { nodes[c.id] = Self.makeNode(c) }

        // ── 2. Explicit relationships ────────────────────────────
        appendExplicitRelationshipEdges(
            &nodes, &edges, &pairSet, &explicitAdj, allowVirtualTargets: includeVirtual)

        // ── 3. Inferred (ORG-based) colleague links ──────────────
        var orgHullSeeds: [GraphHull] = []
        if includeInferred {
            var orgGroups = OrderedDictionary<[Contact]>()
            for c in contacts where !c.org.isEmpty && !c.isCompany && c.org.count > 1 {
                let orgKey = c.org.trimmingCharacters(in: .whitespaces)
                var members = orgGroups[orgKey] ?? []
                members.append(c)
                orgGroups[orgKey] = members
            }

            for org in orgGroups.keys {
                let members = orgGroups[org]!
                // Cluster 2+ members but skip pathologically large buckets.
                if members.count < 2 || members.count > 100 { continue }

                orgHullSeeds.append(
                    GraphHull(
                        id: "hull__org__\(org)", label: org,
                        memberIds: members.map { $0.id }, kind: "organization",
                        depth: 1, color: "#00b894"))

                var edgeSet = Set(edges.map { "\(Self.pairKey($0.source, $0.target)):\($0.type)" })
                for i in 0..<members.count {
                    for j in (i + 1)..<members.count {
                        let key = Self.edgeKey(members[i].id, members[j].id, "colleague")
                        let pk = Self.pairKey(members[i].id, members[j].id)
                        if !pairSet.contains(pk) && !edgeSet.contains(key) {
                            pairSet.insert(pk)
                            edgeSet.insert(key)
                            edges.append(
                                GraphEdge(
                                    id: "e_\(edges.count)", source: members[i].id,
                                    target: members[j].id, type: "colleague", rawType: org,
                                    label: org, category: "work", inferred: true, org: org))
                            nodes.bump(members[i].id)
                            nodes.bump(members[j].id)
                        }
                    }
                }
            }
        }

        let familyConnectedIds = collectConnectedIds(rootContactId, explicitAdj)
        var hullSeeds: [GraphHull] = [
            GraphHull(
                id: "family-network", label: "Family Network",
                memberIds: familyConnectedIds.ids, kind: "family-network", depth: 1,
                color: "#e17055")
        ]
        hullSeeds.append(contentsOf: orgHullSeeds)

        if includeLikelyFamily || includeLikelyConnections {
            hullSeeds.append(
                contentsOf: appendLikelyConnectionGroups(
                    &nodes, &edges, &pairSet,
                    includeLikelyFamily: includeLikelyFamily,
                    includeLikelyConnections: includeLikelyConnections))
        }

        // ── 4. Assign category + filter tags to every node ───────
        for id in nodes.keys {
            var node = nodes[id]!
            node.category = Self.nodeCategory(node)
            node.filterTags = filterTags(node, familyConnectedIds)
            nodes[id] = node
        }

        // ── 5. Filter isolated nodes ─────────────────────────────
        var connectedIds = Set<String>()
        for e in edges {
            connectedIds.insert(e.source)
            connectedIds.insert(e.target)
        }
        let allNodes = nodes.keys.map { nodes[$0]! }
        let filteredNodes =
            includeIsolated ? allNodes : allNodes.filter { connectedIds.contains($0.id) }

        return GraphModel(
            mode: "connections", nodes: filteredNodes, edges: edges,
            hulls: buildClusterHulls(filteredNodes, hullSeeds))
    }

    // MARK: - Geographic graph

    private func buildGeographic(includeIsolated: Bool, rootContactId: String?) -> GraphModel {
        var nodes = OrderedDictionary<GraphNode>()
        var edges: [GraphEdge] = []
        var createdGroups = Set<String>()
        var groupMemberIds = OrderedDictionary<OrderedIDSet>()
        var edgeSet = Set<String>()
        let familyConnectedIds = collectConnectedIds(rootContactId, buildExplicitAdjacency())

        for c in contacts {
            var node = Self.makeNode(c)
            node.category = Self.nodeCategory(node)
            node.filterTags = filterTags(node, familyConnectedIds)
            nodes[c.id] = node
        }

        var edgeIdx = 0
        for c in contacts {
            let path = preferredAddressPath(c)
            if path.isEmpty {
                if !includeIsolated { continue }
                let noAddrId = "geo__country__no-address"
                ensureGeoGroup(
                    &nodes, &createdGroups, &groupMemberIds,
                    id: noAddrId, name: "No Address",
                    title: "Contacts without a usable address",
                    kind: "geo-country", depth: 1)
                addUniqueEdge(
                    &edges, &edgeSet,
                    GraphEdge(
                        id: "e_\(edgeIdx)", source: noAddrId, target: c.id, type: "located-at",
                        label: "No address", category: "other", inferred: true,
                        edgeKind: "geographic-membership"))
                edgeIdx += 1
                nodes.bump(noAddrId)
                nodes.bump(c.id)
                groupMemberIds[noAddrId]!.insert(c.id)
                continue
            }

            var parentGroupId: String? = nil
            var currentPath: [String] = []
            for (i, segment) in path.enumerated() {
                currentPath.append(segment.key)
                let groupId = "geo__\(segment.level)__\(currentPath.joined(separator: "__"))"
                ensureGeoGroup(
                    &nodes, &createdGroups, &groupMemberIds,
                    id: groupId, name: segment.label, title: segment.description,
                    kind: "geo-\(segment.level)", depth: i + 1)
                groupMemberIds[groupId]!.insert(c.id)

                if let parent = parentGroupId {
                    addUniqueEdge(
                        &edges, &edgeSet,
                        GraphEdge(
                            id: "e_\(edgeIdx)", source: parent, target: groupId, type: "contains",
                            label: "", category: "other", inferred: true,
                            edgeKind: "geographic-hierarchy"))
                    edgeIdx += 1
                }
                parentGroupId = groupId
            }

            if let parent = parentGroupId {
                addUniqueEdge(
                    &edges, &edgeSet,
                    GraphEdge(
                        id: "e_\(edgeIdx)", source: parent, target: c.id, type: "located-at",
                        label: "", category: "other", inferred: true,
                        edgeKind: "geographic-membership"))
                edgeIdx += 1
                nodes.bump(c.id)
                nodes.bump(parent)
            }
        }

        let allNodes = nodes.keys.map { nodes[$0]! }
        let filteredNodes =
            includeIsolated
            ? allNodes : allNodes.filter { $0.isGroupNode || $0.connectionCount > 0 }

        var hullSeeds: [GraphHull] = []
        for groupId in groupMemberIds.keys {
            let memberSet = groupMemberIds[groupId]!
            if memberSet.count < 2 { continue }
            guard let node = nodes[groupId] else { continue }
            let depth = node.groupDepth ?? 1
            hullSeeds.append(
                GraphHull(
                    id: "hull__\(groupId)", label: node.name, memberIds: memberSet.ids,
                    kind: node.groupKind ?? "geographic", depth: depth,
                    color: Self.geoHullColor(depth)))
        }

        return GraphModel(
            mode: "geographic", nodes: filteredNodes, edges: edges,
            hulls: buildClusterHulls(filteredNodes, hullSeeds))
    }

    // MARK: - Explicit edges

    private func appendExplicitRelationshipEdges(
        _ nodes: inout OrderedDictionary<GraphNode>,
        _ edges: inout [GraphEdge],
        _ pairSet: inout Set<String>,
        _ explicitAdj: inout [String: OrderedIDSet],
        allowVirtualTargets: Bool
    ) {
        var edgeSet = Set<String>()
        for c in contacts {
            for rel in c.related {
                let target = findRelationTarget(rel)
                let targetId = target?.id ?? "virtual__\(Self.virtualSlug(rel.name))"

                if target == nil && !allowVirtualTargets { continue }

                if nodes[targetId] == nil {
                    nodes[targetId] = GraphNode(
                        id: targetId, name: rel.name, isVirtual: true,
                        category: "virtual", filterTags: ["virtual"], tags: ["virtual"])
                }

                let key = Self.edgeKey(c.id, targetId, rel.type)
                let pk = Self.pairKey(c.id, targetId)
                if !pairSet.contains(pk) && !edgeSet.contains(key) {
                    pairSet.insert(pk)
                    edgeSet.insert(key)
                    edges.append(
                        GraphEdge(
                            id: "e_\(edges.count)", source: c.id, target: targetId, type: rel.type,
                            rawType: rel.rawType, label: friendlyType(rel.type), reverseLabel: nil,
                            category: edgeCategory(rel.type), inferred: false, edgeKind: "explicit",
                            isConfirmed: true))
                    nodes.bump(c.id)
                    nodes.bump(targetId)
                    explicitAdj[c.id, default: OrderedIDSet()].insert(targetId)
                    explicitAdj[targetId, default: OrderedIDSet()].insert(c.id)
                } else if pairSet.contains(pk) {
                    if let idx = edges.firstIndex(where: { Self.pairKey($0.source, $0.target) == pk }) {
                        let existing = edges[idx]
                        if existing.target == c.id && existing.reverseLabel == nil
                            && isValidReciprocal(existing.type, rel.type)
                        {
                            edges[idx].reverseLabel = friendlyType(rel.type)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Likely-connection clusters (surname + hashtag)

    private func appendLikelyConnectionGroups(
        _ nodes: inout OrderedDictionary<GraphNode>,
        _ edges: inout [GraphEdge],
        _ pairSet: inout Set<String>,
        includeLikelyFamily: Bool,
        includeLikelyConnections: Bool
    ) -> [GraphHull] {
        var hullSeeds: [GraphHull] = []
        var edgeIdx = edges.count

        if includeLikelyFamily {
            var surnameGroups = OrderedDictionary<(label: String, contacts: [Contact])>()
            for c in contacts where !c.isCompany {
                let familyName = familyNameForContact(c)
                let key = Self.normalizeFamilyKey(familyName)
                if key.isEmpty { continue }
                var group =
                    surnameGroups[key]
                    ?? (label: familyName.trimmingCharacters(in: .whitespaces), contacts: [])
                group.contacts.append(c)
                surnameGroups[key] = group
            }

            for key in surnameGroups.keys {
                let group = surnameGroups[key]!
                if group.contacts.count < 2 { continue }
                let hubId = "family_group__\(key)"
                var hub = Self.makeGroupNode(
                    id: hubId, name: "\(group.label) family",
                    title: "Likely family cluster by shared surname", kind: "likely-surname",
                    depth: 1, count: group.contacts.count)
                nodes[hubId] = hub

                var memberIds: [String] = []
                for c in group.contacts {
                    guard nodes[c.id] != nil else { continue }
                    nodes.bump(c.id)
                    memberIds.append(c.id)
                    let pairKey = Self.pairKey(hubId, c.id)
                    if pairSet.contains(pairKey) { continue }
                    pairSet.insert(pairKey)
                    edges.append(
                        GraphEdge(
                            id: "e_\(edgeIdx)", source: hubId, target: c.id, type: "likely-surname",
                            label: group.label, category: "family", inferred: true,
                            edgeKind: "likely-surname", confidence: 0.45, isConfirmed: false))
                    edgeIdx += 1
                }
                hub.connectionCount = memberIds.count
                hub.memberIds = memberIds
                nodes[hubId] = hub
                hullSeeds.append(
                    GraphHull(
                        id: "hull__\(hubId)", label: group.label, memberIds: memberIds,
                        kind: "likely-surname", depth: 1, color: "#e17055"))
            }
        }

        if includeLikelyConnections {
            var hashtagGroups = OrderedDictionary<[Contact]>()
            for c in contacts {
                for tag in c.noteTags {
                    var members = hashtagGroups[tag] ?? []
                    members.append(c)
                    hashtagGroups[tag] = members
                }
            }

            for tag in hashtagGroups.keys {
                let members = hashtagGroups[tag]!
                if members.count < 2 { continue }
                let hubId = "tag_group__\(tag)"
                var hub = Self.makeGroupNode(
                    id: hubId, name: "#\(tag)",
                    title: "Likely connection cluster by shared hashtag", kind: "likely-tag",
                    depth: 1, count: members.count)
                nodes[hubId] = hub

                var memberIds: [String] = []
                for c in members {
                    guard nodes[c.id] != nil else { continue }
                    nodes.bump(c.id)
                    memberIds.append(c.id)
                    let pairKey = Self.pairKey(hubId, c.id)
                    if pairSet.contains(pairKey) { continue }
                    pairSet.insert(pairKey)
                    edges.append(
                        GraphEdge(
                            id: "e_\(edgeIdx)", source: hubId, target: c.id, type: "likely-tag",
                            label: "#\(tag)", category: "other", inferred: true,
                            edgeKind: "likely-tag", confidence: 0.38, isConfirmed: false))
                    edgeIdx += 1
                }
                hub.connectionCount = memberIds.count
                hub.memberIds = memberIds
                nodes[hubId] = hub
                hullSeeds.append(
                    GraphHull(
                        id: "hull__\(hubId)", label: "#\(tag)", memberIds: memberIds,
                        kind: "likely-tag", depth: 1, color: "#74b9ff"))
            }
        }
        return hullSeeds
    }

    // MARK: - Family network (§10.4)

    private func buildExplicitAdjacency() -> [String: OrderedIDSet] {
        var adjacency: [String: OrderedIDSet] = [:]
        for c in contacts {
            if adjacency[c.id] == nil { adjacency[c.id] = OrderedIDSet() }
            for rel in c.related {
                guard let target = findRelationTarget(rel) else { continue }
                if adjacency[target.id] == nil { adjacency[target.id] = OrderedIDSet() }
                adjacency[c.id]!.insert(target.id)
                adjacency[target.id]!.insert(c.id)
            }
        }
        return adjacency
    }

    private func collectConnectedIds(_ rootId: String?, _ adjacency: [String: OrderedIDSet])
        -> OrderedIDSet
    {
        guard let rootId, adjacency[rootId] != nil else { return OrderedIDSet() }
        var seen = OrderedIDSet()
        seen.insert(rootId)
        var queue = [rootId]
        var head = 0
        while head < queue.count {
            let current = queue[head]
            head += 1
            for next in adjacency[current]?.ids ?? [] {
                if seen.contains(next) { continue }
                seen.insert(next)
                queue.append(next)
            }
        }
        return seen
    }

    // MARK: - Node construction

    /// JS `_makeNode` — copies the standard contact fields across (minus fn/name,
    /// which project to `name` / `structuredName`) and adds the graph-only fields.
    private static func makeNode(_ c: Contact) -> GraphNode {
        GraphNode(
            id: c.id, name: c.fn, structuredName: c.name, isVirtual: false, isGroupNode: false,
            connectionCount: 0, category: "other", filterTags: [],
            nickname: c.nickname, maidenName: c.maidenName, phoneticFirst: c.phoneticFirst,
            phoneticLast: c.phoneticLast, org: c.org, department: c.department,
            phoneticOrg: c.phoneticOrg, title: c.title, gender: c.gender, isCompany: c.isCompany,
            altBirthday: c.altBirthday, emails: c.emails, phones: c.phones, addresses: c.addresses,
            birthday: c.birthday, anniversary: c.anniversary, dates: c.dates, ims: c.ims,
            socialProfiles: c.socialProfiles, notes: c.notes, related: c.related, urls: c.urls,
            photo: c.photo, tags: c.tags, noteTags: c.noteTags, customFields: c.customFields,
            sourceDocuments: c.sourceDocuments, rawVCard: c.rawVCard)
    }

    /// JS `_makeGroupNode` — a synthetic hub for a surname / hashtag / geo cluster.
    private static func makeGroupNode(
        id: String, name: String, title: String = "", kind: String = "group", depth: Int = 1,
        count: Int = 0
    ) -> GraphNode {
        GraphNode(
            id: id, name: name, structuredName: nil, isVirtual: false, isGroupNode: true,
            connectionCount: count, category: "other", filterTags: [], groupKind: kind,
            groupDepth: depth, memberIds: [], title: title)
    }

    // MARK: - Categorisation + filter tags (§11)

    private static func nodeCategory(_ node: GraphNode) -> String {
        if node.isVirtual { return "virtual" }
        if node.isCompany { return "company" }
        return "other"
    }

    private func filterTags(_ node: GraphNode, _ familyConnectedIds: OrderedIDSet) -> [String] {
        if node.isGroupNode { return [] }
        // Insertion-ordered unique set (JS `new Set([...tags, ...noteTags])`),
        // dropping the literal `family` hashtag.
        var tags = OrderedIDSet()
        for t in node.tags where t != "family" { tags.insert(t) }
        for t in node.noteTags where t != "family" { tags.insert(t) }

        if node.isVirtual {
            tags.insert("virtual")
        } else if node.isCompany {
            tags.insert("company")
        }
        if !node.isVirtual && !node.isCompany && tags.count == 0 { tags.insert("other") }

        if familyConnectedIds.contains(node.id) { tags.insert("family") }

        return tags.ids
    }

    // MARK: - Edge keys

    private static func edgeKey(_ a: String, _ b: String, _ type: String) -> String {
        "\(pairKey(a, b)):\(type)"
    }

    private static func pairKey(_ a: String, _ b: String) -> String {
        // JS `[a, b].sort().join('↔')` — lexicographic string sort.
        (a <= b ? "\(a)↔\(b)" : "\(b)↔\(a)")
    }

    private func addUniqueEdge(_ edges: inout [GraphEdge], _ edgeSet: inout Set<String>, _ edge: GraphEdge) {
        let key = "\(Self.pairKey(edge.source, edge.target)):\(edge.edgeKind ?? edge.type)"
        if edgeSet.contains(key) { return }
        edgeSet.insert(key)
        edges.append(edge)
    }

    private func buildClusterHulls(_ nodes: [GraphNode], _ hullSeeds: [GraphHull]) -> [GraphHull] {
        let visibleIds = Set(nodes.map { $0.id })
        return hullSeeds.filter { $0.memberIds.filter { visibleIds.contains($0) }.count >= 2 }
    }

    // MARK: - Geographic helpers

    private func ensureGeoGroup(
        _ nodes: inout OrderedDictionary<GraphNode>,
        _ createdGroups: inout Set<String>,
        _ groupMemberIds: inout OrderedDictionary<OrderedIDSet>,
        id: String, name: String, title: String, kind: String, depth: Int
    ) {
        if createdGroups.contains(id) { return }
        nodes[id] = Self.makeGroupNode(id: id, name: name, title: title, kind: kind, depth: depth)
        createdGroups.insert(id)
        groupMemberIds[id] = OrderedIDSet()
    }

    private struct GeoSegment {
        let level: String
        let key: String
        let label: String
        let description: String
    }

    private func preferredAddressPath(_ contact: Contact) -> [GeoSegment] {
        guard let address = preferredAddress(contact) else { return [] }
        let country = Self.normalizeGeoLabel(address.country)
        let state = Self.normalizeGeoLabel(address.state)
        let city = Self.normalizeGeoLabel(address.city)
        let street = Self.normalizeStreet(address.street)

        var path: [GeoSegment] = []
        if !country.isEmpty {
            path.append(
                GeoSegment(
                    level: "country", key: Self.normalizeGeoKey(country), label: country,
                    description: "Country cluster"))
        }
        if !state.isEmpty {
            path.append(
                GeoSegment(
                    level: "state", key: Self.normalizeGeoKey(state), label: state,
                    description: "State / province cluster"))
        }
        if !city.isEmpty {
            path.append(
                GeoSegment(
                    level: "city", key: Self.normalizeGeoKey(city), label: city,
                    description: "City cluster"))
        }
        if !street.isEmpty {
            path.append(
                GeoSegment(
                    level: "street", key: Self.normalizeGeoKey(street), label: street,
                    description: "Street cluster"))
        }
        return path
    }

    private func preferredAddress(_ contact: Contact) -> AddressValue? {
        let addresses = contact.addresses
        if addresses.isEmpty { return nil }
        func score(_ addr: AddressValue) -> Int {
            let types = addr.types.map { $0.lowercased() }
            if types.contains("home") { return 0 }
            if types.contains("work") { return 1 }
            return 2
        }
        // Stable sort (JS relies on stable Array.prototype.sort); Swift's sort is
        // guaranteed stable, so ties keep original order.
        return addresses.enumerated()
            .sorted { (score($0.element), $0.offset) < (score($1.element), $1.offset) }
            .first?.element
    }

    private static func geoHullColor(_ depth: Int) -> String {
        switch depth {
        case 1: return "#74b9ff"
        case 2: return "#55efc4"
        case 3: return "#fdcb6e"
        case 4: return "#fd79a8"
        default: return "#b2bec3"
        }
    }

    // MARK: - Family-name helpers

    private func familyNameForContact(_ contact: Contact) -> String {
        let family = contact.name.family.trimmingCharacters(in: .whitespaces)
        if !family.isEmpty { return family }
        let parts = contact.fn.trimmingCharacters(in: .whitespaces)
            .split(whereSeparator: { $0.isWhitespace }).map(String.init)
        return parts.count >= 2 ? parts[parts.count - 1] : ""
    }

    // MARK: - Taxonomy passthroughs

    private func isValidReciprocal(_ a: String, _ b: String) -> Bool {
        RelationshipTaxonomy.isValidReciprocal(a, b)
    }
    private func friendlyType(_ type: String) -> String { RelationshipTaxonomy.label(type) }
    private func edgeCategory(_ type: String) -> String { RelationshipTaxonomy.category(type) }

    // MARK: - String normalisation

    /// `virtual__` id slug: JS `rel.name.replace(/[^a-zA-Z0-9]/g, '_')`.
    private static func virtualSlug(_ name: String) -> String {
        String(name.map { $0.isLetter && $0.isASCII || ($0.isNumber && $0.isASCII) ? $0 : "_" })
    }

    /// JS `_normalizeGeoLabel`: collapse whitespace runs to one space, trim.
    private static func normalizeGeoLabel(_ v: String) -> String {
        collapseSpaces(v).trimmingCharacters(in: .whitespaces)
    }

    /// JS `_normalizeStreet`: collapse label, squash comma runs, then drop a
    /// leading house number so neighbours on a road share one cluster.
    private static func normalizeStreet(_ v: String) -> String {
        let normalized = regexReplace(normalizeGeoLabel(v), ",+", ",")
        if normalized.isEmpty { return "" }
        let withoutNumber = regexReplace(normalized, "^\\s*\\d+[A-Za-z0-9\\-/]*\\s+", "")
            .trimmingCharacters(in: .whitespaces)
        return withoutNumber.isEmpty ? normalized : withoutNumber
    }

    /// JS `_normalizeGeoKey`: lowercase → NFKD strip diacritics → non-alnum runs
    /// to `-` → trim leading/trailing `-`.
    private static func normalizeGeoKey(_ v: String) -> String {
        let s = stripDiacritics(v.lowercased())
        let dashed = regexReplace(s, "[^a-z0-9]+", "-")
        return dashed.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    /// JS `_normalizeFamilyKey`: lowercase → NFKD strip diacritics → remove any
    /// char outside `[a-z0-9'-]` → trim.
    private static func normalizeFamilyKey(_ name: String) -> String {
        let s = stripDiacritics(name.lowercased())
        let cleaned = regexReplace(s, "[^a-z0-9'\\-]", "")
        return cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// NFKD decomposition then drop combining marks U+0300–U+036F (JS
    /// `.normalize('NFKD').replace(/[̀-ͯ]/g, '')`).
    private static func stripDiacritics(_ s: String) -> String {
        String(
            String.UnicodeScalarView(
                s.decomposedStringWithCompatibilityMapping.unicodeScalars.filter {
                    !(0x300...0x36F).contains($0.value)
                }))
    }

    /// Remove Apple-style quoted nickname tokens: JS `/["'][^"']*["']/g`.
    private static func stripQuoted(_ s: String) -> String {
        regexReplace(s, "[\"'][^\"']*[\"']", "")
    }

    /// Collapse `\s+` runs to a single space (does not trim).
    private static func collapseSpaces(_ s: String) -> String {
        regexReplace(s, "\\s+", " ")
    }

    // MARK: - Name index (§10.2)

    private static func buildNameIndex(_ contacts: [Contact]) -> [String: [Contact]] {
        var index: [String: [Contact]] = [:]
        // Dedupe by contact id (JS dedupes by object identity).
        func add(_ key: String, _ c: Contact) {
            if key.isEmpty { return }
            var matches = index[key] ?? []
            if !matches.contains(where: { $0.id == c.id }) {
                matches.append(c)
                index[key] = matches
            }
        }

        for c in contacts {
            if c.fn.isEmpty { continue }
            let fn = c.fn.trimmingCharacters(in: .whitespaces)
            let lower = fn.lowercased()

            add(lower, c)  // exact FN

            // Without quoted nickname tokens (e.g. Micah "Tikah" Mangold → Micah Mangold)
            let stripped = collapseSpaces(stripQuoted(fn))
                .trimmingCharacters(in: .whitespaces).lowercased()
            if !stripped.isEmpty && stripped != lower { add(stripped, c) }

            // Last, First
            let parts = fn.split(whereSeparator: { $0.isWhitespace }).map(String.init)
            if parts.count >= 2 {
                let lastFirst = "\(parts[parts.count - 1]), \(parts[0..<(parts.count - 1)].joined(separator: " "))"
                add(lastFirst.lowercased(), c)
            }
            // First Last only (drop middle names) for 3+ word names
            if parts.count >= 3 {
                add("\(parts[0]) \(parts[parts.count - 1])".lowercased(), c)
            }
        }
        return index
    }
}

// MARK: - Regex helper

/// Global regex replace mirroring JS `String.prototype.replace(/…/g, repl)`.
private func regexReplace(_ input: String, _ pattern: String, _ template: String) -> String {
    guard let re = try? NSRegularExpression(pattern: pattern) else { return input }
    let range = NSRange(input.startIndex..., in: input)
    return re.stringByReplacingMatches(in: input, range: range, withTemplate: template)
}

// MARK: - Insertion-ordered unique id set

/// A tiny insertion-ordered, de-duplicated id collection. Used wherever the JS
/// relies on `Set` insertion order reaching output (family-network member ids,
/// BFS visit order, geo group membership, filter-tag ordering).
struct OrderedIDSet {
    private(set) var ids: [String] = []
    private var seen: Set<String> = []

    init() {}

    mutating func insert(_ id: String) {
        if seen.insert(id).inserted { ids.append(id) }
    }
    func contains(_ id: String) -> Bool { seen.contains(id) }
    var count: Int { ids.count }
}

// MARK: - Node-map ergonomics

extension OrderedDictionary where Value == GraphNode {
    /// Increment a node's `connectionCount` in place (JS `node.connectionCount++`).
    mutating func bump(_ id: String) {
        guard var node = self[id] else { return }
        node.connectionCount += 1
        self[id] = node
    }
}
