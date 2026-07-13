// SessionSettings — Codable mirror of the JS session payload built by
// `_persistSession` (js/app-session.js). The serialized contact list itself is
// NOT part of this struct: `SessionStore` writes it separately to a sibling
// `data.<ext>` file (JS keeps content + settings in one IndexedDB record; the
// native app splits them into two files on disk — see SessionStore's header
// comment for why).
//
// Field mapping (JS `_persistSession` payload key → Swift property):
//   fileLabel                → fileLabel
//   formatId                 → formatID
//   content                  → (lives in the sibling data.<ext> file instead)
//   savedAt                  → savedAt (Date, encoded/decoded as ISO 8601)
//   selfContactRef           → selfContactRef (SelfContactRef?)
//   showInferred             → showInferred
//   showLikelyFamily         → showLikelyFamily
//   showLikelyConnections    → showLikelyConnections
//   showIsolated             → showIsolated
//   showVirtual              → showVirtual
//   suggestExtendedFamily    → suggestExtendedFamily
//   sidebarControlsCollapsed → sidebarControlsCollapsed (round-tripped for the
//     eventual sidebar UI; AppStore has no matching property yet — see
//     SessionStore's integration notes)
//   contactSortMode          → contactSortMode
//   graphMode                → graphModeRaw (String; see `graphMode` below)
//   mainViewMode             → workspaceMode
//   (none — native-only)     → themeOverride
//   (none — native-only)     → schemaVersion

import ConstellationGraphModel
import Foundation

/// "Follow system" theme preference. Native-only: the JS app only ever tracks
/// light/dark (js/app-theme.js `_applyInitialTheme`/`_setTheme`), with no
/// "follow the OS" option. Persisted here so a relaunch restores the user's
/// choice; `ConstellationUI`'s theme support owns applying it.
public enum ThemeOverride: String, Sendable, Codable, CaseIterable {
    case system
    case light
    case dark
}

/// Reference used to re-resolve the "me" contact after a reparse. Mirrors the
/// JS `_selfContactRef()` shape exactly (`{ uid, fn }`); resolution (uid first,
/// fn fallback) is ported in `SessionStore._resolveSelfContactId` equivalent.
public struct SelfContactRef: Sendable, Equatable, Codable {
    public var uid: String?
    public var fn: String?

    public init(uid: String?, fn: String?) {
        self.uid = uid
        self.fn = fn
    }
}

/// Persisted session settings (`session.json`).
public struct SessionSettings: Sendable, Equatable, Codable {
    /// Bump when the on-disk shape changes incompatibly. `SessionStore`
    /// currently reads/writes only `currentSchemaVersion`; a mismatched
    /// version is treated as absent (see `SessionStore.restore`).
    public static let currentSchemaVersion = 1

    public var schemaVersion: Int
    public var fileLabel: String
    /// Adapter id: "vcard" | "markdown" | "tsv" (JS `formatId`).
    public var formatID: String
    public var savedAt: Date
    public var selfContactRef: SelfContactRef?
    public var showInferred: Bool
    public var showLikelyFamily: Bool
    public var showLikelyConnections: Bool
    public var showIsolated: Bool
    public var showVirtual: Bool
    public var suggestExtendedFamily: Bool
    public var sidebarControlsCollapsed: Bool
    public var contactSortMode: ContactSortMode
    /// Raw `GraphBuildMode.rawValue`. Stored as a string (rather than the enum
    /// directly) because legacy values need JS-identical normalization on
    /// read — see `graphMode` below.
    public var graphModeRaw: String
    public var workspaceMode: WorkspaceMode
    public var themeOverride: ThemeOverride

    public init(
        schemaVersion: Int = SessionSettings.currentSchemaVersion,
        fileLabel: String,
        formatID: String,
        savedAt: Date,
        selfContactRef: SelfContactRef?,
        showInferred: Bool,
        showLikelyFamily: Bool,
        showLikelyConnections: Bool,
        showIsolated: Bool,
        showVirtual: Bool,
        suggestExtendedFamily: Bool,
        sidebarControlsCollapsed: Bool,
        contactSortMode: ContactSortMode,
        graphMode: GraphBuildMode,
        workspaceMode: WorkspaceMode,
        themeOverride: ThemeOverride
    ) {
        self.schemaVersion = schemaVersion
        self.fileLabel = fileLabel
        self.formatID = formatID
        self.savedAt = savedAt
        self.selfContactRef = selfContactRef
        self.showInferred = showInferred
        self.showLikelyFamily = showLikelyFamily
        self.showLikelyConnections = showLikelyConnections
        self.showIsolated = showIsolated
        self.showVirtual = showVirtual
        self.suggestExtendedFamily = suggestExtendedFamily
        self.sidebarControlsCollapsed = sidebarControlsCollapsed
        self.contactSortMode = contactSortMode
        self.graphModeRaw = graphMode.rawValue
        self.workspaceMode = workspaceMode
        self.themeOverride = themeOverride
    }

    /// Decodes `graphModeRaw` exactly like `_restorePersistedSession`
    /// (js/app-session.js lines 140–149): the pre-toggle "family-explicit" /
    /// "likely-family" / "likely-connections" modes were superseded by the
    /// `showLikelyFamily`/`showLikelyConnections` toggles and are folded back
    /// to `.connections` on restore (as is anything unrecognized); only
    /// `"geographic"` survives as a distinct persisted mode.
    public var graphMode: GraphBuildMode {
        graphModeRaw == GraphBuildMode.geographic.rawValue ? .geographic : .connections
    }
}
