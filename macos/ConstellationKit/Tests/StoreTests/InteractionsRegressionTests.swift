// Port of the STORE/STATE-level assertions in
// test/interactions-regression.test.js (M3 task D). That JS suite is mostly
// about DOM/rendering and the editing/bulk-edit/suggestions features (M5+);
// only three of its twenty tests exercise behavior the Swift `AppStore` /
// `FilterEngine` / `ImportCoordinator` already own. Those three are ported
// below; every other JS test is skipped with a one-line reason in the
// comment block at the bottom of this file.
//
// Ported (JS test name → Swift test):
//   • "restore can resolve the saved me contact through UID after reparsing"
//     → selfContactSurvivesSerializeReparseByUID
//   • "contact deletion removes the contact from the working set and export
//     output" → contactRemovalDropsFromWorkingSetAndExport
//   • "multi-file import combines Markdown files into one working set"
//     → multiFileImportCombinesIntoOneWorkingSet

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

@MainActor
private func byUid(_ store: AppStore, _ uid: String) -> Contact {
    let contact = store.contacts.first { $0.uid == uid }
    precondition(contact != nil, "missing contact with UID \(uid)")
    return contact!
}

/// Store-level equivalent of js/app-session.js `_resolveSelfContactId`: UID
/// first (rename-proof), then fn (lowercased/trimmed) as a fallback. `AppStore`
/// does not (yet) expose this as a named method — `contactsByUid` /
/// `contactsByFn` are its public indexes, so the resolution order is
/// reproduced here rather than invented.
@MainActor
private func resolveSelfContactId(_ store: AppStore, uid: String?, fn: String?) -> String? {
    if let uid, !uid.isEmpty, let byUid = store.contactsByUid[uid] {
        return byUid.id
    }
    if let fn, !fn.isEmpty {
        let key = fn.lowercased().trimmingCharacters(in: .whitespaces)
        if let byFn = store.contactsByFn[key]?.first {
            return byFn.id
        }
    }
    return nil
}

// ── Self-contact reference survives a save/reparse round trip ────────────────
// JS: "restore can resolve the saved me contact through UID after reparsing"
// (self-contact id is not itself durable across a reparse — the store save
// path resolves it back through the reparsed contact's UID index).
@Test @MainActor func selfContactSurvivesSerializeReparseByUID() {
    let store = loadedStore()
    let jane = byUid(store, "jane-doe-smith")
    store.setSelfContact(jane.id)

    // Capture the reference the way JS `_selfContactRef` does: UID (+ fn
    // fallback), not the ephemeral contact id.
    let refUID = jane.uid
    let refFN = jane.fn

    // Round-trip: serialize the current working set, reparse it into a fresh
    // store (as a session restore would), then resolve "me" against the new
    // store's indexes.
    let serialized = VCardAdapter().serialize(store.contacts, ids: nil)
    let restoredContacts = VCardAdapter().parse(serialized, startIndex: 0)
    let restored = AppStore()
    restored.loadContacts(restoredContacts, fileLabel: "restored.vcf", activeFormatID: "vcard")

    let restoredID = resolveSelfContactId(restored, uid: refUID, fn: refFN)
    #expect(restoredID != nil)
    #expect(restored.contact(restoredID)?.uid == "jane-doe-smith")
}

// ── Contact deletion removes the contact from the working set and export ─────
// JS: "contact deletion removes the contact from the working set and export
// output". The JS path goes through `_deleteContact` (a not-yet-ported M5
// editing helper); the store-level behavior it exercises — removing a contact
// and re-deriving everything, including serialization — is `AppStore.setContacts`.
@Test @MainActor func contactRemovalDropsFromWorkingSetAndExport() {
    let store = loadedStore()
    let company = byUid(store, "company-acme")

    let remaining = store.contacts.filter { $0.id != company.id }
    store.setContacts(remaining)

    #expect(!store.contacts.contains { $0.uid == "company-acme" })
    #expect(store.contactsById[company.id] == nil)

    let exported = VCardAdapter().serialize(store.contacts, ids: nil)
    #expect(!exported.contains("company-acme"))
}

// ── Multi-file import combines files into one REPLACING working set ──────────
// JS: "multi-file import combines Markdown files into one working set". Ported
// against `ImportCoordinator` (the Swift port of JS `_loadFiles`) instead of
// the JS test's fake-DOM `File` objects; the DOM-facing bits of the JS test
// (file-label textContent, toast message) are dropped, but the store-facing
// counterparts — contact count, uid order, and the `fileLabel` value that
// feeds the file-label UI — are kept.
@Test @MainActor func multiFileImportCombinesIntoOneWorkingSet() async {
    let store = AppStore()
    let urls = [
        FixtureLoader.url("markdown-ada.md"),
        FixtureLoader.url("markdown-grace.md"),
        FixtureLoader.url("markdown-bundle.md"),
    ]

    let report = await ImportCoordinator().importFiles(urls, into: store)

    #expect(report.imported == 4)
    #expect(store.contacts.count == 4)
    #expect(store.contacts.map(\.uid) == [
        "md-ada-lovelace",
        "md-grace-hopper",
        "md-katherine-johnson",
        "md-dorothy-vaughan",
    ])
    #expect(store.fileLabel == "3 files")
}

// ── Skipped JS tests (not store/state behavior, or depend on unported M5
// editing/suggestions features) ───────────────────────────────────────────────
//
// • "table edit updates notes, hashtags, raw vCard, and search-visible data
//   immediately" — drives `_applyTableEdit` (M5 editing helper, not ported)
//   plus a fake table-render probe (DOM/rendering).
// • "detail edit path rewrites structured contact fields and preserves vCard
//   metadata" — drives `_rewriteEditableFields` (M5 editing helper, not ported).
// • "relationship add, edit, delete, and type persistence survive export and
//   reparse" — drives `_applyRelationshipEdit` / `_deleteRelationship` /
//   `_insertBeforeEndVCard` / raw vCard-line editing helpers (M5, not ported).
// • "bulk normalize can append notes to empty contacts and replace address
//   country values" — drives `_applyBulkNormalize` / `_bulkRuleState` (M5 bulk
//   edit feature, not ported).
// • "bulk normalize retypes only the WHERE-matching relationship instances" —
//   same `_applyBulkNormalize` (M5, not ported).
// • "photo edits update the serialized card immediately" — drives
//   `_rewriteEditableFields` (M5 editing helper, not ported).
// • "notes hashtag autocomplete finds existing tags and inserts the selected
//   tag" — DOM textarea/popup simulation + `_notesAutocomplete` UI state, not
//   store behavior.
// • "custom (non-anniversary) Apple dates are modeled and survive an edit" —
//   the parse half is a format-level (VCFParser) assertion outside StoreTests
//   scope; the edit half drives `_rewriteEditableFields` (M5, not ported).
// • "format-neutral contact record stays synchronized with legacy contact
//   edits" — drives `_rewriteEditableFields` and asserts on `contact.record`,
//   a format-neutral record model not present on the Swift `Contact` type
//   (M5/record-model work, not ported).
// • "custom fields render read-only display values" — drives
//   `_renderReadOnlyCustomFields`, pure DOM/HTML rendering.
// • "custom field edit collector updates scalar and list fields while
//   preserving objects" — drives `_collectEditedCustomFields` over fake
//   `querySelector`/`querySelectorAll` DOM nodes (DOM + M5 editing UI).
// • "HTML helpers escape custom relationship labels and unsafe hrefs" —
//   `_escapeHtml` / `_safeExternalHref` are HTML-rendering helpers, not store
//   state.
// • "vCard folding respects UTF-8 byte limits without corrupting text" — a
//   `VCardUtils` format-level utility; belongs in FormatsTests, not StoreTests.
// • "editing an address preserves its ADR pobox and extended-address
//   components" — the parse half is format-level (VCFParser, out of
//   StoreTests scope); the edit half drives `_rewriteEditableFields` (M5, not
//   ported).
// • "transitive suggestions skip virtual children both spouses already list"
//   — drives `_findRelationshipSuggestions` (js/app-suggestions.js), a
//   relationship-suggestion engine with no Swift port yet (no
//   ConstellationSuggestions-equivalent module exists).
// • "extended-family suggestions are hidden unless opted in; mirrors always
//   show" — drives `_findRelationshipSuggestions` / `_partitionSuggestions`
//   (js/app-suggestions.js), same unported suggestion engine. `AppStore`
//   already carries the `suggestExtendedFamily` toggle (see
//   `AppStoreTests.defaultStateMatchesJS`), but the suggestion generation and
//   shown/hidden partitioning it gates have no Swift implementation to test
//   against yet.
