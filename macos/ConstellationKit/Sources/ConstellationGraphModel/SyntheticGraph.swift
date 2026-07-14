// SyntheticGraph — a debug-only synthetic graph generator used for the M4
// performance bar (≈1,500 nodes / ≈1,800 edges) and offscreen render tests.
// Deterministic (seeded LCG) so measurements and snapshots are reproducible.
// Compiled only in DEBUG builds; never shipped.

#if DEBUG
    import Foundation

    public enum SyntheticGraph {
        /// Build a clustered synthetic `GraphModel`: `nodeCount` contact/company/
        /// virtual nodes plus a handful of surname hubs (with hulls), wired with
        /// roughly `edgeCount` edges across the taxonomy categories and a mix of
        /// explicit / inferred / likely kinds.
        public static func make(
            nodeCount: Int = 1500, edgeCount: Int = 1800, seed: UInt64 = 0xC0FFEE
        ) -> GraphModel {
            var rng = LCG(seed: seed)
            let categories = ["other", "other", "other", "company", "virtual"]
            let edgeCategories = ["family", "friend", "work", "neighbor", "other"]

            // Surname hubs (group nodes) — every ~150th node is a hub, min 6.
            let hubCount = max(6, nodeCount / 150)
            var nodes: [GraphNode] = []
            var degree: [String: Int] = [:]

            for h in 0..<hubCount {
                let id = "hub-\(h)"
                nodes.append(
                    GraphNode(
                        id: id, name: "Cluster \(h)", isGroupNode: true,
                        category: "other", filterTags: ["other"],
                        groupKind: "likely-surname", groupDepth: 1, memberIds: []))
            }

            for i in 0..<nodeCount {
                let cat = categories[Int(rng.next() % UInt64(categories.count))]
                let id = "n-\(i)"
                nodes.append(
                    GraphNode(
                        id: id, name: "Person \(i)",
                        isVirtual: cat == "virtual",
                        category: cat,
                        filterTags: [cat],
                        isCompany: cat == "company"))
            }

            var edges: [GraphEdge] = []
            edges.reserveCapacity(edgeCount)
            var hubMembers: [[String]] = Array(repeating: [], count: hubCount)

            // Wire each contact to a hub (membership) to form clusters.
            for i in 0..<nodeCount {
                let hub = Int(rng.next() % UInt64(hubCount))
                let src = "n-\(i)"
                edges.append(
                    GraphEdge(
                        id: "he-\(i)", source: src, target: "hub-\(hub)",
                        type: "cluster", label: "", category: "other", inferred: true,
                        edgeKind: "likely-surname", confidence: 0.45))
                degree[src, default: 0] += 1
                degree["hub-\(hub)", default: 0] += 1
                if hubMembers[hub].count < 30 { hubMembers[hub].append(src) }
            }

            // Fill out to ~edgeCount with random inter-contact relationships.
            var e = nodeCount
            while edges.count < edgeCount {
                let a = Int(rng.next() % UInt64(nodeCount))
                let b = Int(rng.next() % UInt64(nodeCount))
                if a == b { continue }
                let cat = edgeCategories[Int(rng.next() % UInt64(edgeCategories.count))]
                let inferred = rng.next() % 3 == 0
                let src = "n-\(a)"
                let dst = "n-\(b)"
                edges.append(
                    GraphEdge(
                        id: "e-\(e)", source: src, target: dst,
                        type: cat, label: cat, category: cat, inferred: inferred,
                        edgeKind: inferred ? nil : "explicit"))
                degree[src, default: 0] += 1
                degree[dst, default: 0] += 1
                e += 1
            }

            // Apply degree → connectionCount (radius input) and hub memberIds.
            nodes = nodes.map { node in
                var n = node
                n.connectionCount = degree[node.id] ?? 0
                if node.isGroupNode, let idx = Int(node.id.dropFirst(4)) {
                    n.memberIds = hubMembers[idx]
                }
                return n
            }

            // A hull per hub cluster.
            let hulls = (0..<hubCount).map { h in
                GraphHull(
                    id: "hull-\(h)", label: "Cluster \(h)",
                    memberIds: ["hub-\(h)"] + hubMembers[h], kind: "likely-surname",
                    depth: 1, color: "#e17055")
            }

            return GraphModel(mode: "connections", nodes: nodes, edges: edges, hulls: hulls)
        }

        /// Tiny deterministic LCG (Numerical Recipes constants).
        struct LCG {
            var state: UInt64
            init(seed: UInt64) { state = seed }
            mutating func next() -> UInt64 {
                state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
                return state >> 16
            }
        }
    }
#endif
