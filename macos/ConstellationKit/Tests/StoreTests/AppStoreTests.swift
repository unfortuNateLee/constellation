// AppStore index-rebuild + reconciliation invariants.

import ConstellationFormats
import ConstellationGraphModel
import ConstellationModel
import ConstellationTestSupport
import Testing

@testable import ConstellationStore

@MainActor
private func loadedStore(_ fixture: String = "comprehensive.vcf") -> AppStore {
    let contacts = VCardAdapter().parse(FixtureLoader.contents(of: fixture)).contacts
    let store = AppStore()
    store.loadContacts(contacts, fileLabel: fixture, activeFormatID: "vcard")
    return store
}

// ── Defaults mirror the js/app.js constructor ─────────────────────────────────
@Test @MainActor func defaultStateMatchesJS() {
    let store = AppStore()
    #expect(store.contacts.isEmpty)
    #expect(store.activeFormatID == "vcard")
    #expect(store.graphMode == .connections)
    #expect(store.showInferred == true)
    #expect(store.showLikelyFamily == false)
    #expect(store.showLikelyConnections == true)
    #expect(store.showIsolated == true)
    #expect(store.showVirtual == true)
    #expect(store.suggestExtendedFamily == false)
    #expect(store.contactSortMode == .firstLast)
    #expect(store.workspaceMode == .graph)
    #expect(store.tableSort == TableSort(key: "name", ascending: true))
}

// ── Index construction ────────────────────────────────────────────────────────
@Test @MainActor func rebuildBuildsAllIndexes() {
    let store = loadedStore()

    // contactsById covers every contact; keys are the contact ids.
    #expect(store.contactsById.count == store.contacts.count)
    for c in store.contacts { #expect(store.contactsById[c.id] == c) }

    // contactsByUid indexes only contacts carrying a UID.
    for c in store.contacts where !(c.uid ?? "").isEmpty {
        #expect(store.contactsByUid[c.uid!]?.id == c.id)
    }

    // nodeById mirrors the graph model.
    #expect(store.nodeById.count == store.graphModel.nodes.count)
    for n in store.graphModel.nodes { #expect(store.nodeById[n.id]?.id == n.id) }

    // Every edge is indexed under both endpoints.
    for e in store.graphModel.edges {
        #expect(store.edges(for: e.source).contains { $0.id == e.id })
        #expect(store.edges(for: e.target).contains { $0.id == e.id })
    }

    #expect(store.stats != nil)
}

// ── contactsByFn is a file-order multi-map (ambiguity aware) ───────────────────
@Test @MainActor func contactsByFnGroupsDuplicateNamesInFileOrder() {
    let store = loadedStore()
    // "Alex Duplicate" appears twice; the multi-map keeps both, in file order.
    let dupes = store.contactsByFn["alex duplicate"]
    #expect(dupes?.count == 2)
    #expect(dupes?.map(\.id) == ["c_3n0a4w", "c_4gz37t"])
}

// ── related-ref index (inbound relationships) ─────────────────────────────────
@Test @MainActor func relatedRefsIndexInboundRelationships() {
    let store = loadedStore()
    // Every stored ref's declaring contact really lists that relationship.
    for (_, refs) in store.relatedRefsByTargetId {
        for ref in refs {
            let from = store.contact(ref.fromContactID)
            #expect(from != nil)
            #expect(from!.related.contains { $0.name == ref.rel.name })
        }
    }
    // Unresolved targets get a virtual__ id.
    let hasVirtualTarget = store.relatedRefsByTargetId.keys.contains { $0.hasPrefix("virtual__") }
    #expect(hasVirtualTarget)
}

@Test func sanitizeVirtualNameReplacesNonAlnum() {
    #expect(AppStore.sanitizeVirtualName("Missing Child") == "Missing_Child")
    #expect(AppStore.sanitizeVirtualName("O'Brien-Smith") == "O_Brien_Smith")
}

// ── Import replaces (never appends) ───────────────────────────────────────────
@Test @MainActor func loadContactsReplacesEntireSet() {
    let store = loadedStore()
    let firstCount = store.contacts.count
    #expect(firstCount > 0)

    // A second load with a single-contact set replaces, not appends.
    let one = Contact(id: "c_only", fn: "Solo Person", name: StructuredName(family: "Person", given: "Solo"))
    store.loadContacts([one], fileLabel: "one.vcf", activeFormatID: "vcard")
    #expect(store.contacts.count == 1)
    #expect(store.contactsById["c_only"] != nil)
    #expect(store.fileLabel == "one.vcf")
}

// ── Selection + self reconciliation after a rebuild ───────────────────────────
@Test @MainActor func selectionSurvivesRebuildWhenNodePersists() {
    let store = loadedStore()
    store.selectedContactID = "c_qs7uey"
    store.setShowVirtual(false)  // triggers a rebuild
    #expect(store.selectedContactID == "c_qs7uey")  // real node persists
}

@Test @MainActor func staleSelectionClearedAfterReplace() {
    let store = loadedStore()
    store.selectedContactID = "c_qs7uey"
    store.loadContacts([], fileLabel: "empty", activeFormatID: "vcard")
    #expect(store.selectedContactID == nil)
}

@Test @MainActor func selfContactClearedWhenContactRemoved() {
    let store = loadedStore()
    store.setSelfContact("c_qs7uey")
    store.toggleFilter("family")
    #expect(store.activeFilterTags.contains("family"))

    // Replace with a set that lacks the self contact: self + family filter drop.
    store.loadContacts([], fileLabel: "empty", activeFormatID: "vcard")
    #expect(store.selfContactID == nil)
    #expect(!store.activeFilterTags.contains("family"))
}

// ── Filter pruning drops tags that are no longer categories ───────────────────
@Test @MainActor func pruneDropsUnknownFilterTags() {
    let store = loadedStore()
    store.setActiveFilters(["company", "not-a-real-tag"])
    #expect(store.activeFilterTags == ["company"])
}

// ── Graph toggles feed build options and rebuild the model ────────────────────
@Test @MainActor func graphToggleRebuildsModel() {
    let store = loadedStore()
    let before = store.graphModel.nodes.count
    store.setShowVirtual(false)
    #expect(store.buildOptions.includeVirtual == false)
    // Dropping virtual nodes should not increase the node count.
    #expect(store.graphModel.nodes.count <= before)
}

@Test @MainActor func setSelfContactFeedsRootIntoBuildOptions() {
    let store = loadedStore()
    store.setSelfContact("c_qs7uey")
    #expect(store.buildOptions.rootContactId == "c_qs7uey")
    #expect(store.selfContactID == "c_qs7uey")
}
