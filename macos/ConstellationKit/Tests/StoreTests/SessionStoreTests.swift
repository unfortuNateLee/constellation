// SessionStore fidelity tests — on-disk round-trip, self-contact resolution
// (JS `_resolveSelfContactId`), the never-persist-empty guard, corrupted-file
// handling, and the cancel-and-replace autosave debounce.

import ConstellationFormats
import ConstellationGraphModel
import ConstellationModel
import ConstellationTestSupport
import Foundation
import Testing

@testable import ConstellationStore

@MainActor
private func tempSessionDir() -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("session-tests-" + UUID().uuidString)
    return dir
}

@MainActor
private func comprehensiveStore() -> AppStore {
    let contacts = VCardAdapter().parse(FixtureLoader.contents(of: "comprehensive.vcf")).contacts
    let store = AppStore()
    store.loadContacts(contacts, fileLabel: "comprehensive.vcf", activeFormatID: "vcard")
    return store
}

// ── Round-trip: contacts, settings, format ─────────────────────────────────────
@Test @MainActor func sessionRoundTripPreservesContactsAndSettings() {
    let store = comprehensiveStore()
    let jane = store.contactsByUid["jane-doe-smith"]!
    store.setSelfContact(jane.id)
    store.setShowLikelyFamily(true)
    store.setShowVirtual(false)
    store.contactSortMode = .lastFirst
    store.workspaceMode = .table

    let dir = tempSessionDir()
    let session = SessionStore(directory: dir)
    session.save(from: store, themeOverride: .dark)

    let fresh = AppStore()
    let restored = session.restore(into: fresh)

    #expect(restored)
    #expect(fresh.contacts == store.contacts)
    #expect(fresh.activeFormatID == "vcard")
    #expect(fresh.fileLabel == "comprehensive.vcf")
    #expect(fresh.showLikelyFamily == true)
    #expect(fresh.showVirtual == false)
    #expect(fresh.showInferred == store.showInferred)
    #expect(fresh.showLikelyConnections == store.showLikelyConnections)
    #expect(fresh.showIsolated == store.showIsolated)
    #expect(fresh.suggestExtendedFamily == store.suggestExtendedFamily)
    #expect(fresh.contactSortMode == .lastFirst)
    #expect(fresh.workspaceMode == .table)
    // Self-ref resolves back to the same logical contact (uid-stable id).
    #expect(fresh.selfContactID == jane.id)

    // Persisted settings carry the schema version + theme (no AppStore analog).
    let settingsURL = dir.appendingPathComponent("session.json")
    let settings = SessionStore.readSettings(from: settingsURL)
    #expect(settings?.schemaVersion == SessionSettings.currentSchemaVersion)
    #expect(settings?.themeOverride == .dark)
    #expect(settings?.formatID == "vcard")
}

// ── Markdown-format session round-trips ────────────────────────────────────────
@Test @MainActor func markdownFormatSessionRoundTrips() {
    let contacts = MarkdownAdapter().parse(FixtureLoader.contents(of: "markdown-ada.md")).contacts
    let store = AppStore()
    store.loadContacts(contacts, fileLabel: "markdown-ada.md", activeFormatID: "markdown")

    let dir = tempSessionDir()
    let session = SessionStore(directory: dir)
    session.save(from: store)

    #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("data.md").path))

    let fresh = AppStore()
    #expect(session.restore(into: fresh))
    #expect(fresh.activeFormatID == "markdown")
    #expect(fresh.contacts == store.contacts)
    #expect(fresh.fileLabel == "markdown-ada.md")
}

// ── Switching formats sweeps the stale data.<ext> (documented hygiene) ─────────
@Test @MainActor func savingUnderNewFormatRemovesStaleDataFile() {
    let dir = tempSessionDir()
    let session = SessionStore(directory: dir)

    let vcardStore = comprehensiveStore()
    session.save(from: vcardStore)
    #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("data.vcf").path))

    let mdContacts = MarkdownAdapter().parse(FixtureLoader.contents(of: "markdown-ada.md")).contacts
    let mdStore = AppStore()
    mdStore.loadContacts(mdContacts, fileLabel: "markdown-ada.md", activeFormatID: "markdown")
    session.save(from: mdStore)

    #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("data.md").path))
    #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("data.vcf").path))
}

// ── Self-ref resolution: uid ────────────────────────────────────────────────────
@Test @MainActor func selfRefResolvesByUid() {
    let store = comprehensiveStore()
    let john = store.contactsByUid["john-smith"]!
    let ref = SelfContactRef(uid: "john-smith", fn: nil)
    #expect(SessionStore.resolveSelfContactId(ref, in: store) == john.id)
}

// ── Self-ref resolution: fn fallback when uid is missing ───────────────────────
@Test @MainActor func selfRefFallsBackToFnWhenUidMissing() {
    let store = comprehensiveStore()
    let john = store.contactsByUid["john-smith"]!
    let ref = SelfContactRef(uid: nil, fn: "  JOHN SMITH  ")  // uppercased/padded, like a hand-edited file
    #expect(SessionStore.resolveSelfContactId(ref, in: store) == john.id)
}

// ── Self-ref resolution: a stale uid falls through to fn, same as the JS ───────
@Test @MainActor func selfRefFallsBackToFnWhenUidUnresolved() {
    let store = comprehensiveStore()
    let john = store.contactsByUid["john-smith"]!
    let ref = SelfContactRef(uid: "no-longer-exists", fn: "John Smith")
    #expect(SessionStore.resolveSelfContactId(ref, in: store) == john.id)
}

// ── Self-ref resolution: neither matches → nil ─────────────────────────────────
@Test @MainActor func selfRefMissReturnsNil() {
    let store = comprehensiveStore()
    let ref = SelfContactRef(uid: "does-not-exist", fn: "Nobody Here")
    #expect(SessionStore.resolveSelfContactId(ref, in: store) == nil)

    #expect(SessionStore.resolveSelfContactId(nil, in: store) == nil)
}

// ── Never persist an empty contact set (JS `_persistSession` guard) ────────────
@Test @MainActor func emptyContactsSaveIsNoOp() {
    let store = AppStore()
    #expect(store.contacts.isEmpty)

    let dir = tempSessionDir()
    let session = SessionStore(directory: dir)
    session.save(from: store)

    #expect(!FileManager.default.fileExists(atPath: dir.path))
}

// ── Corrupted session.json → restore fails gracefully, never crashes ──────────
@Test @MainActor func corruptedSessionJSONReturnsFalseWithoutCrashing() throws {
    let dir = tempSessionDir()
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try "{ not valid json at all".write(
        to: dir.appendingPathComponent("session.json"), atomically: true, encoding: .utf8)
    try "BEGIN:VCARD\nEND:VCARD\n".write(
        to: dir.appendingPathComponent("data.vcf"), atomically: true, encoding: .utf8)

    let session = SessionStore(directory: dir)
    let store = AppStore()
    let restored = session.restore(into: store)

    #expect(restored == false)
    #expect(store.contacts.isEmpty)
}

// ── Missing session entirely → restore returns false, no crash ────────────────
@Test @MainActor func missingSessionReturnsFalse() {
    let dir = tempSessionDir()
    let session = SessionStore(directory: dir)
    let store = AppStore()
    #expect(session.restore(into: store) == false)
}

// ── clear() removes settings + data file ───────────────────────────────────────
@Test @MainActor func clearRemovesSavedSession() {
    let store = comprehensiveStore()
    let dir = tempSessionDir()
    let session = SessionStore(directory: dir)
    session.save(from: store)
    #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("session.json").path))

    session.clear()
    #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("session.json").path))
    #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("data.vcf").path))

    // A second clear on an already-empty directory is a harmless no-op.
    session.clear()
}

// ── Autosave debounce: scheduling twice quickly performs exactly one write ────
@Test @MainActor func autosaveDebounceCoalescesToSingleWrite() async throws {
    let store = comprehensiveStore()
    let dir = tempSessionDir()
    let session = SessionStore(directory: dir, debounceInterval: .milliseconds(50))

    session.scheduleAutosave(from: store)
    // Fired again before the first debounce elapses — should cancel-and-replace,
    // not produce two writes.
    try await Task.sleep(for: .milliseconds(10))
    session.scheduleAutosave(from: store)

    // Nothing written yet — both schedules are still debouncing.
    #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("session.json").path))

    try await Task.sleep(for: .milliseconds(150))

    let settingsURL = dir.appendingPathComponent("session.json")
    #expect(FileManager.default.fileExists(atPath: settingsURL.path))
    let firstSavedAt = SessionStore.readSettings(from: settingsURL)?.savedAt

    // No further writes happen on their own.
    try await Task.sleep(for: .milliseconds(100))
    let secondSavedAt = SessionStore.readSettings(from: settingsURL)?.savedAt
    #expect(firstSavedAt == secondSavedAt)
}
