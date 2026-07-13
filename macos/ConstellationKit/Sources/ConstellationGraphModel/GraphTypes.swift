// Graph value types — port of the node / edge / hull / result shapes that
// `js/relationship-builder.js` actually emits, cross-checked against
// DESIGN_SPEC.md §8.2 (node), §8.3 (edge), §8.4 (hull), §11 (category/filter).
//
// Where the JS runtime and the spec disagree, the JS wins (per the M2 brief):
//   * the node's display field is `name` (JS `node.name = c.fn`), not the
//     spec's `label`;
//   * the JS never emits `inferredOnly`, and it flattens the contact's standard
//     fields directly onto the node rather than nesting a `contact` object — so
//     this port flattens them too (see `GraphNode`).
//   * layout / position data (d3 x·y·vx·vy·fx·fy) is intentionally NOT modeled
//     here; that belongs to the later rendering milestone.
//
// All three shapes are value types: Codable / Equatable / Sendable. Field order
// mirrors the JS object-construction order so the synthesized Codable key order
// is deterministic.

import ConstellationModel

/// A graph node — a real contact, an unresolved virtual contact, or a synthetic
/// group hub (surname / hashtag / geographic). Real nodes carry the full set of
/// standard contact fields copied across from `Contact` (JS `_makeNode` copies
/// `ContactRecord.STANDARD_FIELDS`); virtual and group nodes populate only a
/// subset and leave the remainder at their empty defaults.
public struct GraphNode: Codable, Equatable, Sendable {
    // ── Graph-only fields ────────────────────────────────────────
    public var id: String
    /// Display name (JS `node.name = c.fn`). For group nodes this is the group
    /// label ("Duplicate family", "#neighbor", "Arlington", …).
    public var name: String
    /// Structured `N` parts for real nodes; `nil` for virtual / group nodes
    /// (JS `structuredName: c.name || null`).
    public var structuredName: StructuredName?
    public var isVirtual: Bool
    public var isGroupNode: Bool
    /// Incident-edge count (drives node radius downstream). Mutated as edges form.
    public var connectionCount: Int
    /// Primary styling category: `virtual` | `company` | `other` (§11.1).
    public var category: String
    /// Filter tags (§11.2): system tags (`family` / `company` / `virtual` /
    /// `other`) plus note hashtags, minus the literal `family` hashtag.
    public var filterTags: [String]
    /// Group hub kind: `likely-surname` | `likely-tag` | `geo-country` |
    /// `geo-state` | `geo-city` | `geo-street`. `nil` for non-group nodes.
    public var groupKind: String?
    /// Geo hierarchy depth (1=country … 4=street) / surname·tag depth (1).
    public var groupDepth: Int?
    /// Member contact ids for a group hub. `nil` for non-group nodes.
    public var memberIds: [String]?

    // ── Standard contact fields (JS copies STANDARD_FIELDS, minus fn/name) ──
    public var nickname: String
    public var maidenName: String
    public var phoneticFirst: String
    public var phoneticLast: String
    public var org: String
    public var department: String
    public var phoneticOrg: String
    public var title: String
    public var gender: String
    public var isCompany: Bool
    public var altBirthday: String
    public var emails: [LabeledValue]
    public var phones: [LabeledValue]
    public var addresses: [AddressValue]
    public var birthday: String?
    public var anniversary: String?
    public var dates: [DatedValue]
    public var ims: [ImValue]
    public var socialProfiles: [SocialProfileValue]
    public var notes: [String]
    public var related: [RelatedValue]
    public var urls: [LabeledValue]
    public var photo: String?
    public var tags: [String]
    public var noteTags: [String]

    // ── Passthrough model members ────────────────────────────────
    public var customFields: OrderedDictionary<TypedField>
    public var sourceDocuments: [SourceDocument]
    public var rawVCard: String?

    public init(
        id: String,
        name: String,
        structuredName: StructuredName? = nil,
        isVirtual: Bool = false,
        isGroupNode: Bool = false,
        connectionCount: Int = 0,
        category: String = "other",
        filterTags: [String] = [],
        groupKind: String? = nil,
        groupDepth: Int? = nil,
        memberIds: [String]? = nil,
        nickname: String = "",
        maidenName: String = "",
        phoneticFirst: String = "",
        phoneticLast: String = "",
        org: String = "",
        department: String = "",
        phoneticOrg: String = "",
        title: String = "",
        gender: String = "",
        isCompany: Bool = false,
        altBirthday: String = "",
        emails: [LabeledValue] = [],
        phones: [LabeledValue] = [],
        addresses: [AddressValue] = [],
        birthday: String? = nil,
        anniversary: String? = nil,
        dates: [DatedValue] = [],
        ims: [ImValue] = [],
        socialProfiles: [SocialProfileValue] = [],
        notes: [String] = [],
        related: [RelatedValue] = [],
        urls: [LabeledValue] = [],
        photo: String? = nil,
        tags: [String] = [],
        noteTags: [String] = [],
        customFields: OrderedDictionary<TypedField> = [:],
        sourceDocuments: [SourceDocument] = [],
        rawVCard: String? = nil
    ) {
        self.id = id
        self.name = name
        self.structuredName = structuredName
        self.isVirtual = isVirtual
        self.isGroupNode = isGroupNode
        self.connectionCount = connectionCount
        self.category = category
        self.filterTags = filterTags
        self.groupKind = groupKind
        self.groupDepth = groupDepth
        self.memberIds = memberIds
        self.nickname = nickname
        self.maidenName = maidenName
        self.phoneticFirst = phoneticFirst
        self.phoneticLast = phoneticLast
        self.org = org
        self.department = department
        self.phoneticOrg = phoneticOrg
        self.title = title
        self.gender = gender
        self.isCompany = isCompany
        self.altBirthday = altBirthday
        self.emails = emails
        self.phones = phones
        self.addresses = addresses
        self.birthday = birthday
        self.anniversary = anniversary
        self.dates = dates
        self.ims = ims
        self.socialProfiles = socialProfiles
        self.notes = notes
        self.related = related
        self.urls = urls
        self.photo = photo
        self.tags = tags
        self.noteTags = noteTags
        self.customFields = customFields
        self.sourceDocuments = sourceDocuments
        self.rawVCard = rawVCard
    }
}

/// A graph edge (§8.3). `source` / `target` are node ids (this port never keeps
/// d3's object-hydrated endpoints). Optional fields are present only for the
/// edge kinds that set them, matching the JS emission.
public struct GraphEdge: Codable, Equatable, Sendable {
    public var id: String
    public var source: String
    public var target: String
    public var type: String
    /// Original X-ABLabel (explicit) or org name (inferred colleague). `nil` otherwise.
    public var rawType: String?
    public var label: String
    /// Set only when the pair passes the valid-reciprocal check (§10.5).
    public var reverseLabel: String?
    /// Taxonomy category: `family` | `friend` | `work` | `neighbor` | `other`.
    public var category: String
    public var inferred: Bool
    /// Org name for inferred colleague edges.
    public var org: String?
    /// `explicit` | `likely-surname` | `likely-tag` | `geographic-hierarchy` |
    /// `geographic-membership`. `nil` for inferred org-colleague edges (JS omits it).
    public var edgeKind: String?
    /// 0…1 confidence for unconfirmed likely edges (0.45 surname, 0.38 hashtag).
    public var confidence: Double?
    public var isConfirmed: Bool?

    public init(
        id: String,
        source: String,
        target: String,
        type: String,
        rawType: String? = nil,
        label: String,
        reverseLabel: String? = nil,
        category: String,
        inferred: Bool,
        org: String? = nil,
        edgeKind: String? = nil,
        confidence: Double? = nil,
        isConfirmed: Bool? = nil
    ) {
        self.id = id
        self.source = source
        self.target = target
        self.type = type
        self.rawType = rawType
        self.label = label
        self.reverseLabel = reverseLabel
        self.category = category
        self.inferred = inferred
        self.org = org
        self.edgeKind = edgeKind
        self.confidence = confidence
        self.isConfirmed = isConfirmed
    }
}

/// A cluster hull (§8.4). A hull seed is only promoted to a rendered hull when
/// 2 or more of its members are visible (`RelationshipBuilder` filters seeds).
public struct GraphHull: Codable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var memberIds: [String]
    public var kind: String
    public var depth: Int
    public var color: String

    public init(id: String, label: String, memberIds: [String], kind: String, depth: Int, color: String) {
        self.id = id
        self.label = label
        self.memberIds = memberIds
        self.kind = kind
        self.depth = depth
        self.color = color
    }
}

/// The value returned by `RelationshipBuilder.build` — the JS `{ mode, nodes,
/// edges, hulls }` result.
public struct GraphModel: Codable, Equatable, Sendable {
    /// `connections` for every explicit-relationship view, `geographic` for the
    /// geographic view (mirrors the JS `result.mode`).
    public var mode: String
    public var nodes: [GraphNode]
    public var edges: [GraphEdge]
    public var hulls: [GraphHull]

    public init(mode: String, nodes: [GraphNode], edges: [GraphEdge], hulls: [GraphHull]) {
        self.mode = mode
        self.nodes = nodes
        self.edges = edges
        self.hulls = hulls
    }
}

/// Graph build view (JS `options.mode` string). The four explicit variants all
/// route through the same explicit-relationship builder; only `geographic`
/// diverges. (JS also has an implicit "unknown mode" branch that drops the two
/// likely-cluster toggles; that branch is unreachable here because the mode is
/// an exhaustive enum.)
public enum GraphBuildMode: String, Sendable {
    case connections
    case familyExplicit = "family-explicit"
    case likelyFamily = "likely-family"
    case likelyConnections = "likely-connections"
    case geographic
}

/// Build options — mirrors the JS `build(options)` destructured defaults exactly.
public struct GraphBuildOptions: Sendable {
    public var mode: GraphBuildMode
    public var includeInferred: Bool
    public var includeLikelyFamily: Bool
    public var includeLikelyConnections: Bool
    public var includeIsolated: Bool
    public var includeVirtual: Bool
    public var rootContactId: String?

    public init(
        mode: GraphBuildMode = .connections,
        includeInferred: Bool = true,
        includeLikelyFamily: Bool = true,
        includeLikelyConnections: Bool = true,
        includeIsolated: Bool = false,
        includeVirtual: Bool = true,
        rootContactId: String? = nil
    ) {
        self.mode = mode
        self.includeInferred = includeInferred
        self.includeLikelyFamily = includeLikelyFamily
        self.includeLikelyConnections = includeLikelyConnections
        self.includeIsolated = includeIsolated
        self.includeVirtual = includeVirtual
        self.rootContactId = rootContactId
    }
}

/// Contact-set statistics (JS `getStats`). Ordered/deterministic category maps.
public struct GraphStats: Equatable, Sendable {
    public var loadedContacts: Int
    public var realContacts: Int
    public var virtualContacts: Int
    public var totalContacts: Int
    public var realConnections: Int
    public var virtualConnections: Int
    public var totalConnections: Int
    public var visibleNodes: Int
    public var visibleGroups: Int
    public var edges: Int
    /// category → count, in first-seen (node iteration) order.
    public var categories: OrderedDictionary<Int>
    /// edge category → count, in first-seen (edge iteration) order.
    public var edgeCategories: OrderedDictionary<Int>
}
