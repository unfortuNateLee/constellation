import ConstellationGraphModel
import ConstellationModel
import Testing

/// Ports of test/robustness.test.js:191 and :214 — §10.1 resolution rules.
/// `related[].uid` is never parsed from files; it is set in-memory by
/// relationship editing, so these tests construct contacts directly like the JS.
@Suite struct UIDResolutionTests {
    private func makeContact(id: String, uid: String, fn: String, related: [RelatedValue] = [])
        -> Contact
    {
        var contact = Contact()
        contact.id = id
        contact.uid = uid
        contact.fn = fn
        contact.related = related
        return contact
    }

    private var options: GraphBuildOptions {
        var opts = GraphBuildOptions()
        opts.mode = .connections
        opts.includeInferred = false
        opts.includeLikelyFamily = false
        opts.includeLikelyConnections = false
        opts.includeIsolated = true
        return opts
    }

    @Test func relationshipsResolveByUIDIgnoringMismatchedName() {
        let a = makeContact(
            id: "a", uid: "A", fn: "Alice",
            related: [RelatedValue(name: "Totally Wrong", type: "friend", uid: "B")])
        let b = makeContact(id: "b", uid: "B", fn: "Bob")
        let graph = RelationshipBuilder([a, b]).build(options)

        let linked = graph.edges.contains { edge in
            (edge.source == "a" && edge.target == "b")
                || (edge.source == "b" && edge.target == "a")
        }
        #expect(linked, "A should link to B by uid despite the wrong name")
        #expect(
            !graph.nodes.contains(where: { $0.isVirtual }),
            "no virtual node for the mismatched name")
    }

    @Test func relationshipsFallBackToNameWithoutUID() {
        let a = makeContact(
            id: "a", uid: "A", fn: "Alice",
            related: [RelatedValue(name: "Bob", type: "friend")])
        let b = makeContact(id: "b", uid: "B", fn: "Bob")
        let graph = RelationshipBuilder([a, b]).build(options)

        let linked = graph.edges.contains { edge in
            (edge.source == "a" && edge.target == "b")
                || (edge.source == "b" && edge.target == "a")
        }
        #expect(linked, "A should link to B by name")
    }
}
