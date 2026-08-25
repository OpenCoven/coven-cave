import Foundation

/// Client mirror of the shared, versioned Familiar dashboard READ contract.
///
/// The server side lives in `src/lib/familiar-dashboard.ts` and is served by
/// `GET /api/familiars/[id]/dashboard`. Everything here is a decode-only
/// projection of that contract: no derivation, no defaults that invent facts.
///
/// ## The property this file exists to preserve on the client
///
/// The server contract's whole purpose is that a source FAILURE never renders
/// as an honest ABSENCE. That guarantee is worth nothing if the phone throws it
/// away while decoding, so the decoding rules here are deliberately asymmetric:
///
/// - **Section state is strict.** `state` is a closed set in v1 and it is the
///   load-bearing field. An unrecognised value fails the decode rather than
///   being coerced into anything, because every coercion is a lie in one
///   direction or the other ("fresh" hides a failure, "unavailable" invents
///   one).
/// - **Issue codes and sources are lenient.** They are diagnostics. Wiring a
///   sixth source into the loader adds a code additively, and a phone that
///   discarded a whole dashboard over an unfamiliar diagnostic string would
///   turn a better server into a broken client.
/// - **`now.kind` degrades to `.unknown`.** An unrecognised kind means the
///   client has no basis for "working" or "idle" — which is exactly what
///   `.unknown` already means. It must never fall back to `.idle`, which is a
///   POSITIVE claim the client is not entitled to make.
enum FamiliarDashboardContract {
    /// The version this build understands, sent as `?v=` so a server that can
    /// only serve a different shape refuses (400) instead of answering with
    /// something this client would mis-decode.
    static let version = 1
}

/// The ONE place the dashboard's HTTP path is spelled.
///
/// `cave-9p6zm` is an open question about whether this read belongs on
/// `/api/client/v1/*` rather than the legacy `/api/familiars/*` surface. It
/// shipped on legacy and this client does not anticipate a move — but the path
/// is written once so a later move is an edit here, not a search.
enum FamiliarDashboardEndpoint {
    static let basePath = "api/familiars"

    /// `familiarId` must already be percent-encoded as a single path segment.
    static func path(encodedFamiliarId: String) -> String {
        "\(basePath)/\(encodedFamiliarId)/dashboard?v=\(FamiliarDashboardContract.version)"
    }
}

// MARK: - Extensible string codes

/// A machine-readable reason a section is less than `fresh`.
///
/// Modelled as a `RawRepresentable` struct rather than an enum so an
/// unrecognised code round-trips instead of failing the decode — see the
/// asymmetry note at the top of this file.
struct FamiliarDashboardIssueCode: RawRepresentable, Hashable, Sendable, Decodable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }

    init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    static let familiarUnavailable = Self(rawValue: "familiar_unavailable")
    static let sessionsUnavailable = Self(rawValue: "sessions_unavailable")
    static let sessionsDegraded = Self(rawValue: "sessions_degraded")
    static let tasksUnavailable = Self(rawValue: "tasks_unavailable")
    static let remindersUnavailable = Self(rawValue: "reminders_unavailable")
    static let memoryUnavailable = Self(rawValue: "memory_unavailable")
    static let contractUnavailable = Self(rawValue: "contract_unavailable")
    static let selfReportsUnavailable = Self(rawValue: "self_reports_unavailable")
    static let metricSnapshotsUnavailable = Self(rawValue: "metric_snapshots_unavailable")
    static let responseBudgetExceeded = Self(rawValue: "response_budget_exceeded")

    /// Exactly the codes this build's server declares. Used by the copy table
    /// and by tests; an issue outside it is rendered with generic copy rather
    /// than discarded.
    static let known: [Self] = [
        .familiarUnavailable, .sessionsUnavailable, .sessionsDegraded,
        .tasksUnavailable, .remindersUnavailable,
        .memoryUnavailable, .contractUnavailable, .selfReportsUnavailable,
        .metricSnapshotsUnavailable,
        .responseBudgetExceeded,
    ]
}

/// Which source degraded. `budget` is not a data source — it is the
/// response-budget enforcer, which can shed a whole section.
struct FamiliarDashboardSource: RawRepresentable, Hashable, Sendable, Decodable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }

    init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    static let familiar = Self(rawValue: "familiar")
    static let sessions = Self(rawValue: "sessions")
    static let tasks = Self(rawValue: "tasks")
    static let reminders = Self(rawValue: "reminders")
    static let memory = Self(rawValue: "memory")
    static let contract = Self(rawValue: "contract")
    static let selfReports = Self(rawValue: "self_reports")
    static let metricSnapshots = Self(rawValue: "metric_snapshots")
    static let budget = Self(rawValue: "budget")
}

/// The closed set of top-level refusals the route can answer with.
struct FamiliarDashboardErrorCode: RawRepresentable, Hashable, Sendable, Decodable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }

    init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    static let invalidFamiliarId = Self(rawValue: "invalid_familiar_id")
    static let familiarNotFound = Self(rawValue: "familiar_not_found")
    static let unsupportedVersion = Self(rawValue: "unsupported_version")
    static let dashboardUnavailable = Self(rawValue: "dashboard_unavailable")
}

// MARK: - Section state

/// The four states the SERVER may emit. Closed in v1, and strict on decode.
enum FamiliarDashboardServerSectionState: String, Decodable, Sendable, CaseIterable {
    case fresh
    case partial
    case empty
    case unavailable
}

/// What a section should PRESENT as, which is a superset of what the server
/// emits: `stale` is a client fact (we are still showing a value the server
/// could not replace) and the server has no cache with which to claim it.
enum FamiliarDashboardSectionPresentation: String, Sendable, CaseIterable, Equatable {
    case fresh
    case partial
    case empty
    case unavailable
    case stale

    init(_ serverState: FamiliarDashboardServerSectionState) {
        switch serverState {
        case .fresh: self = .fresh
        case .partial: self = .partial
        case .empty: self = .empty
        case .unavailable: self = .unavailable
        }
    }

    /// True when the section has nothing renderable behind it. `empty` is a
    /// POSITIVE claim ("every source answered, and the answer was nothing") and
    /// is deliberately NOT in this set.
    var hasNoData: Bool { self == .unavailable }
}

struct FamiliarDashboardIssue: Decodable, Hashable, Sendable {
    var source: FamiliarDashboardSource
    var code: FamiliarDashboardIssueCode
    /// Whether asking again might get a different answer.
    var retryable: Bool

    init(source: FamiliarDashboardSource, code: FamiliarDashboardIssueCode, retryable: Bool) {
        self.source = source
        self.code = code
        self.retryable = retryable
    }

    private enum CodingKeys: String, CodingKey { case source, code, retryable }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        source = try container.decode(FamiliarDashboardSource.self, forKey: .source)
        code = try container.decode(FamiliarDashboardIssueCode.self, forKey: .code)
        retryable = try container.decodeIfPresent(Bool.self, forKey: .retryable) ?? false
    }
}

// MARK: - Payload leaves

/// A bounded list that always says how much the client is NOT seeing.
struct FamiliarDashboardBoundedList<Element: Decodable & Hashable & Sendable>:
    Decodable, Hashable, Sendable {
    var items: [Element]
    /// Total available BEFORE the server's cap. `total > items.count` means
    /// the list is bounded and the UI owes the reader that fact.
    var total: Int

    init(items: [Element], total: Int) {
        self.items = items
        self.total = total
    }

    private enum CodingKeys: String, CodingKey { case items, total }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = try container.decodeIfPresent([Element].self, forKey: .items) ?? []
        total = try container.decodeIfPresent(Int.self, forKey: .total) ?? 0
    }

    var isBounded: Bool { total > items.count }
    var hidden: Int { max(0, total - items.count) }
}

struct FamiliarDashboardIdentity: Decodable, Hashable, Sendable {
    var id: String
    var displayName: String
    var role: String?
    var pronouns: String?
    var avatarUrl: String?
    var presence: String?
    var lastSeen: String?

    init(
        id: String,
        displayName: String,
        role: String? = nil,
        pronouns: String? = nil,
        avatarUrl: String? = nil,
        presence: String? = nil,
        lastSeen: String? = nil
    ) {
        self.id = id
        self.displayName = displayName
        self.role = role
        self.pronouns = pronouns
        self.avatarUrl = avatarUrl
        self.presence = presence
        self.lastSeen = lastSeen
    }
}

struct FamiliarDashboardSession: Decodable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var status: String
    var updatedAt: String
    /// True for daemon runs with no human conversation behind them.
    var generated: Bool

    init(id: String, title: String, status: String, updatedAt: String, generated: Bool) {
        self.id = id
        self.title = title
        self.status = status
        self.updatedAt = updatedAt
        self.generated = generated
    }

    private enum CodingKeys: String, CodingKey { case id, title, status, updatedAt, generated }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        status = try container.decodeIfPresent(String.self, forKey: .status) ?? "unknown"
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
        generated = try container.decodeIfPresent(Bool.self, forKey: .generated) ?? false
    }
}

struct FamiliarDashboardMemoryEntry: Decodable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var updatedAt: String
    var verification: String

    init(id: String, title: String, updatedAt: String, verification: String) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
        self.verification = verification
    }

    private enum CodingKeys: String, CodingKey { case id, title, updatedAt, verification }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
        verification = try container.decodeIfPresent(String.self, forKey: .verification) ?? "unknown"
    }
}

struct FamiliarDashboardTaskDependency: Decodable, Hashable, Sendable, Identifiable {
    var id: String
    var kind: String
    var label: String
}

struct FamiliarDashboardTask: Decodable, Hashable, Sendable, Identifiable {
    struct NextStep: Decodable, Hashable, Sendable {
        var summary: String
        var requiresApproval: Bool
    }

    var id: String
    var title: String
    var status: String
    var priority: String
    var projectId: String?
    var sessionId: String?
    var updatedAt: String
    var unresolvedDependencies: FamiliarDashboardBoundedList<FamiliarDashboardTaskDependency>
    var primaryBlockerId: String?
    var nextStep: NextStep?
}

struct FamiliarDashboardReminder: Decodable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var body: String?
    var status: String
    var fireAt: String?
    var firedAt: String?
    var updatedAt: String
    var familiarId: String
}

struct FamiliarDashboardAttention: Decodable, Hashable, Sendable, Identifiable {
    var id: String
    var source: String
    var kind: String
    var title: String
    var targetId: String
}

/// What this Familiar is doing right now.
///
/// `idle` and `unknown` are different values on purpose. `idle` is a POSITIVE
/// claim — the session list was read and nothing is running. `unknown` is what
/// the server says when it has no basis for either answer. Collapsing the two
/// is precisely the failure-as-absence lie the contract exists to stop, so an
/// unrecognised `kind` degrades to `.unknown` and never to `.idle`.
enum FamiliarDashboardNow: Decodable, Hashable, Sendable {
    case session(id: String, title: String, updatedAt: String)
    case task(id: String, title: String, nextStep: String, updatedAt: String)
    case idle
    case unknown

    private enum CodingKeys: String, CodingKey { case kind, id, title, nextStep, updatedAt }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decodeIfPresent(String.self, forKey: .kind) ?? ""
        switch kind {
        case "session":
            self = .session(
                id: try container.decodeIfPresent(String.self, forKey: .id) ?? "",
                title: try container.decodeIfPresent(String.self, forKey: .title) ?? "",
                updatedAt: try container.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
            )
        case "task":
            self = .task(
                id: try container.decodeIfPresent(String.self, forKey: .id) ?? "",
                title: try container.decodeIfPresent(String.self, forKey: .title) ?? "",
                nextStep: try container.decodeIfPresent(String.self, forKey: .nextStep) ?? "",
                updatedAt: try container.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
            )
        case "idle":
            self = .idle
        default:
            self = .unknown
        }
    }
}

struct FamiliarDashboardOverview: Decodable, Hashable, Sendable {
    struct Live: Decodable, Hashable, Sendable {
        var harness: String?
        var model: String?
        var activeSessionCount: Int
        var memoryFreshestAt: String?
    }

    struct Sessions: Decodable, Hashable, Sendable {
        var active: FamiliarDashboardBoundedList<FamiliarDashboardSession>
        var recent: FamiliarDashboardBoundedList<FamiliarDashboardSession>
    }

    struct Memory: Decodable, Hashable, Sendable {
        var entries: FamiliarDashboardBoundedList<FamiliarDashboardMemoryEntry>
        /// Newest canonical-memory update for this familiar, or nil.
        var freshestAt: String?
    }

    var now: FamiliarDashboardNow
    var presence: String?
    var live: Live
    var tasks: FamiliarDashboardBoundedList<FamiliarDashboardTask>
    var sessions: Sessions
    var memory: Memory
    var attention: FamiliarDashboardBoundedList<FamiliarDashboardAttention>
    var reminders: FamiliarDashboardBoundedList<FamiliarDashboardReminder>

    private enum CodingKeys: String, CodingKey {
        case now, presence, live, tasks, sessions, memory, attention, reminders
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        now = try container.decode(FamiliarDashboardNow.self, forKey: .now)
        presence = try container.decodeIfPresent(String.self, forKey: .presence)
        sessions = try container.decode(Sessions.self, forKey: .sessions)
        memory = try container.decode(Memory.self, forKey: .memory)
        live = try container.decodeIfPresent(Live.self, forKey: .live)
            ?? Live(
                harness: nil,
                model: nil,
                activeSessionCount: sessions.active.total,
                memoryFreshestAt: memory.freshestAt
            )
        tasks = try container.decodeIfPresent(
            FamiliarDashboardBoundedList<FamiliarDashboardTask>.self, forKey: .tasks
        ) ?? .init(items: [], total: 0)
        attention = try container.decodeIfPresent(
            FamiliarDashboardBoundedList<FamiliarDashboardAttention>.self, forKey: .attention
        ) ?? .init(items: [], total: 0)
        reminders = try container.decodeIfPresent(
            FamiliarDashboardBoundedList<FamiliarDashboardReminder>.self, forKey: .reminders
        ) ?? .init(items: [], total: 0)
    }
}

struct FamiliarDashboardProfile: Decodable, Hashable, Sendable {
    /// Where the effective model came from. `unconfigured` is a real, distinct
    /// answer, not the same as "the Coven default happens to be null".
    struct Runtime: Decodable, Hashable, Sendable {
        var harness: String?
        var defaultHarness: String?
        var harnessOverride: String?
        var model: String?
        var modelProvenance: String?
    }

    struct Glyph: Decodable, Hashable, Sendable {
        var icon: String?
        var emoji: String?
        var color: String?
    }

    struct Configuration: Decodable, Hashable, Sendable {
        var note: String?
        var autoSelfReport: Bool

        private enum CodingKeys: String, CodingKey { case note, autoSelfReport }

        init(note: String?, autoSelfReport: Bool) {
            self.note = note
            self.autoSelfReport = autoSelfReport
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            note = try container.decodeIfPresent(String.self, forKey: .note)
            autoSelfReport =
                try container.decodeIfPresent(Bool.self, forKey: .autoSelfReport) ?? false
        }
    }

    struct ContractSummary: Decodable, Hashable, Sendable {
        var propertiesPassed: Int
        var propertiesTotal: Int
        var violations: FamiliarDashboardBoundedList<String>
        var warnings: FamiliarDashboardBoundedList<String>
    }

    var description: String?
    var familiarType: String?
    var runtime: Runtime
    var glyph: Glyph
    var configuration: Configuration
    /// Null when this familiar has no contract files on disk — an honest
    /// absence, distinct from `contract_unavailable`, which is a failure.
    var contract: ContractSummary?
}

/// Copy-only projection used by the native Profile surface.
///
/// Keeping absent-state decisions here makes them unit-testable and prevents
/// individual rows from quietly disagreeing about whether nil means zero,
/// inherited, or unavailable. Section failure is handled one level above this
/// projection; values that reach these helpers were read successfully and are
/// therefore either configured or truthfully absent.
enum FamiliarProfilePresentation {
    static let notSet = "Not set"

    static func value(_ raw: String?) -> String {
        guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return notSet }
        return value
    }

    static func model(_ profile: FamiliarDashboardProfile) -> String {
        value(profile.runtime.model)
    }

    static func modelSource(_ profile: FamiliarDashboardProfile) -> String {
        switch profile.runtime.modelProvenance {
        case "familiar": return "Familiar default"
        case "coven_default": return "Coven default"
        case "unconfigured": return "Runtime default"
        default: return "Source unavailable"
        }
    }

    static func runtime(_ profile: FamiliarDashboardProfile) -> String {
        if let harness = profile.runtime.harness?.trimmingCharacters(in: .whitespacesAndNewlines),
           !harness.isEmpty { return harness }
        if let fallback = profile.runtime.defaultHarness?.trimmingCharacters(in: .whitespacesAndNewlines),
           !fallback.isEmpty { return "\(fallback) (Coven default)" }
        return notSet
    }

    static func voice(_ familiar: Familiar) -> String {
        joined([
            familiar.voiceProvider,
            familiar.voiceModel,
            familiar.voiceName,
        ])
    }

    static func image(_ familiar: Familiar) -> String {
        joined([
            familiar.imageProvider,
            familiar.imageModel,
            familiar.imageSize,
            familiar.imageQuality,
        ])
    }

    static func memory(
        _ section: FamiliarDashboardClientSection<FamiliarDashboardOverview>
    ) -> String {
        guard let memory = section.data?.memory else { return "Unavailable" }
        guard let raw = memory.freshestAt, let date = caveParseISO(raw) else {
            return memory.entries.total == 0 ? "No memory yet" : "Freshness unavailable"
        }
        let value = date.formatted(date: .abbreviated, time: .shortened)
        return section.isStale ? "\(value) · stale" : value
    }

    static func contract(_ summary: FamiliarDashboardProfile.ContractSummary?) -> String {
        guard let summary else { return notSet }
        return "\(summary.propertiesPassed) of \(summary.propertiesTotal) checks passed"
    }

    private static func joined(_ values: [String?]) -> String {
        let present = values.compactMap { raw -> String? in
            let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return value.isEmpty ? nil : value
        }
        return present.isEmpty ? notSet : present.joined(separator: " · ")
    }
}

struct FamiliarDashboardAnalytics: Decodable, Hashable, Sendable {
    struct Averages: Decodable, Hashable, Sendable {
        var overallConfidence: Double?
        var toolReliability: Double?
        var memoryRecall: Double?
        var fileLocatability: Double?
    }

    struct SessionPulse: Decodable, Hashable, Sendable {
        var active: Int
        var recent: Int
    }

    struct Activity: Decodable, Hashable, Sendable {
        struct Day: Decodable, Hashable, Sendable {
            var date: String
            var count: Int
        }
        var availability: String
        var periodDays: Int
        var days: [Day]
        var activeSessions: Int?
        var totalSessions: Int?
        var lastActiveAt: String?
    }

    struct Confidence: Decodable, Hashable, Sendable {
        var state: String
        var band: String?
        var sampleCount: Int
        var latestReportAt: String?
    }

    struct SignalTrends: Decodable, Hashable, Sendable {
        struct Metric: Decodable, Hashable, Sendable {
            var key: String
            var label: String
            var direction: String
            var delta: Double?
        }
        var availability: String
        var periodDays: Int
        var sampleCount: Int
        var metrics: [Metric]
    }

    struct MemoryDigest: Decodable, Hashable, Sendable {
        var availability: String?
        var total: Int?
        var freshestAt: String?
        var state: String
        var sampleCount: Int
        var recall: Double?
        var fileLocatability: Double?
        var latestReportAt: String?
    }

    struct Capability: Decodable, Hashable, Sendable { var name: String; var count: Int }
    struct CapabilityGap: Decodable, Hashable, Sendable { var name: String; var importance: String }
    struct VitalCapability: Decodable, Hashable, Sendable { var name: String; var state: String }
    struct Capabilities: Decodable, Hashable, Sendable {
        var sampleCount: Int
        var used: FamiliarDashboardBoundedList<Capability>
        var lacking: FamiliarDashboardBoundedList<CapabilityGap>
        var vital: FamiliarDashboardBoundedList<VitalCapability>
    }

    struct Attention: Decodable, Hashable, Sendable {
        struct Blocker: Decodable, Hashable, Sendable {
            var id: String
            var title: String
            var impact: String
        }
        struct HealRequest: Decodable, Hashable, Sendable {
            var id: String
            var title: String
            var severity: String
            var actionKind: String
        }
        var sampleCount: Int
        var contractGaps: Int?
        var persistentBlockers: FamiliarDashboardBoundedList<Blocker>
        var healRequests: FamiliarDashboardBoundedList<HealRequest>?
    }

    /// Every figure below is derived from `sampleSize` reports and no others.
    /// A client that renders an average without its sample count invites the
    /// reader to trust one report as though it were thirty.
    var sampleSize: Int
    /// Total reports on disk before the server's cap.
    var reportsTotal: Int
    var windowStart: String?
    var windowEnd: String?
    var averages: Averages
    var sessionPulse: SessionPulse
    // Additive v1 fields remain optional so a phone can still read a cached
    // snapshot written by the earlier v1 server shape during an upgrade.
    var activity: Activity? = nil
    var confidence: Confidence? = nil
    var signalTrends: SignalTrends? = nil
    var memory: MemoryDigest? = nil
    var capabilities: Capabilities? = nil
    var attention: Attention? = nil
}

// MARK: - Wire envelopes

/// One section exactly as the server sends it.
struct FamiliarDashboardWireSection<Payload: Decodable & Hashable & Sendable>:
    Decodable, Hashable, Sendable {
    var state: FamiliarDashboardServerSectionState
    /// When this section's data was assembled, not when it was requested.
    var generatedAt: String
    var data: Payload?
    var issues: [FamiliarDashboardIssue]

    init(
        state: FamiliarDashboardServerSectionState,
        generatedAt: String,
        data: Payload?,
        issues: [FamiliarDashboardIssue] = []
    ) {
        self.state = state
        self.generatedAt = generatedAt
        self.data = data
        self.issues = issues
    }

    private enum CodingKeys: String, CodingKey { case state, generatedAt, data, issues }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // Strict: an unrecognised state throws. See the file note.
        state = try container.decode(FamiliarDashboardServerSectionState.self, forKey: .state)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt) ?? ""
        data = try container.decodeIfPresent(Payload.self, forKey: .data)
        issues = try container.decodeIfPresent([FamiliarDashboardIssue].self, forKey: .issues) ?? []
    }

    /// The state this section can actually back up, which is not always the one
    /// it claims.
    ///
    /// The contract asserts `data === null ⟺ state === "unavailable"`, and the
    /// server enforces it — but that is a promise made by the other side of a
    /// network, and a client that trusts it blindly renders a `fresh` section
    /// with no data as a calm empty screen, which is the exact lie the whole
    /// contract exists to prevent. So the DATA is believed over the LABEL: a
    /// section carrying nothing is unavailable regardless of what it says.
    var effectiveState: FamiliarDashboardServerSectionState {
        data == nil ? .unavailable : state
    }
}

struct FamiliarDashboardWireSections: Decodable, Hashable, Sendable {
    var overview: FamiliarDashboardWireSection<FamiliarDashboardOverview>
    var profile: FamiliarDashboardWireSection<FamiliarDashboardProfile>
    var analytics: FamiliarDashboardWireSection<FamiliarDashboardAnalytics>
}

/// A successful `GET /api/familiars/[id]/dashboard` body.
struct FamiliarDashboardPayload: Decodable, Hashable, Sendable {
    var ok: Bool
    var version: Int
    var familiarId: String
    var generatedAt: String
    var identity: FamiliarDashboardIdentity
    var sections: FamiliarDashboardWireSections
}

/// A refused `GET /api/familiars/[id]/dashboard` body.
struct FamiliarDashboardFailurePayload: Decodable, Hashable, Sendable {
    var ok: Bool
    var error: String?
    var code: FamiliarDashboardErrorCode?
}

// MARK: - Errors

/// Why a dashboard load did not produce a snapshot.
///
/// Deliberately its own type rather than a `CaveError`: the dashboard's 403 is
/// a path REFUSAL (`invalid_familiar_id`), and `CaveError.isAuthFailure`
/// classifies an unlabelled 403 as a credential problem — routing this through
/// it would send a user back through pairing because of a malformed id.
enum FamiliarDashboardError: Error, Hashable, Sendable {
    /// No desktop endpoint is configured on this device.
    case notConfigured
    /// The id is not a valid familiar slug, so the server refused to look.
    case invalidFamiliarId
    /// Well-formed id, no such familiar in this Cave's roster.
    case familiarNotFound
    /// This build asked for a version the desktop cannot serve.
    case unsupportedVersion
    /// The dashboard itself could not be assembled (503).
    case unavailable
    /// Any other non-2xx answer.
    case refused(status: Int, code: String?)
    /// The body decoded but described a different familiar than we asked for.
    case identityMismatch(requested: String, received: String)
    case decoding(String)
    case transport(String)

    /// Copy a person can act on. Never a raw server string, never a path.
    var message: String {
        switch self {
        case .notConfigured:
            return "Connect to your Cave to load this Familiar."
        case .invalidFamiliarId:
            return "This Familiar’s identifier isn’t one the desktop will accept."
        case .familiarNotFound:
            return "This Familiar is no longer in your Cave."
        case .unsupportedVersion:
            return "Your desktop serves a different dashboard version. Update Cave on both ends."
        case .unavailable:
            return "The desktop couldn’t assemble this dashboard right now."
        case .refused(let status, _):
            return "The desktop refused the dashboard request (\(status))."
        case .identityMismatch:
            return "The desktop answered with a different Familiar’s dashboard."
        case .decoding:
            return "The desktop’s dashboard reply didn’t match what this app understands."
        case .transport:
            return "Couldn’t reach your Cave to load this dashboard."
        }
    }

    /// Whether a retry could plausibly succeed without anything else changing.
    /// A missing familiar and a rejected id are not going to fix themselves.
    var isRetryable: Bool {
        switch self {
        case .invalidFamiliarId, .familiarNotFound, .unsupportedVersion, .identityMismatch:
            return false
        case .notConfigured, .unavailable, .decoding, .transport:
            return true
        case .refused(let status, _):
            return status >= 500 || status == 429
        }
    }

    /// True when the familiar itself is gone, which is a navigation event (go
    /// back to the roster) rather than an error to retry in place.
    var isMissingFamiliar: Bool { self == .familiarNotFound }

    static func forRefusal(status: Int, code: FamiliarDashboardErrorCode?) -> Self {
        if let code {
            switch code {
            case .invalidFamiliarId: return .invalidFamiliarId
            case .familiarNotFound: return .familiarNotFound
            case .unsupportedVersion: return .unsupportedVersion
            case .dashboardUnavailable: return .unavailable
            default: break
            }
        }
        // No usable code: fall back to the status, which is still enumerable.
        switch status {
        case 403: return .invalidFamiliarId
        case 404: return .familiarNotFound
        case 400: return .unsupportedVersion
        case 503: return .unavailable
        default: return .refused(status: status, code: code?.rawValue)
        }
    }
}

// MARK: - Issue copy

/// The one place an issue code becomes words.
///
/// It exists so the Overview, Profile and Analytics tabs (`cave-9rwd.3`,
/// `.4`, `.5`) do not each invent their own sentence for `sessions_degraded`,
/// and so an unrecognised code still says something true instead of leaking a
/// raw identifier into the UI.
enum FamiliarDashboardIssueCopy {
    static func message(for issue: FamiliarDashboardIssue) -> String {
        switch issue.code {
        case .familiarUnavailable:
            return "This Familiar’s registry record couldn’t be read."
        case .sessionsUnavailable:
            return "Sessions couldn’t be read, so current work is unknown."
        case .sessionsDegraded:
            return "The session list came back incomplete."
        case .tasksUnavailable:
            return "Assigned work couldn’t be read."
        case .remindersUnavailable:
            return "Reminders couldn’t be read."
        case .memoryUnavailable:
            return "Memory couldn’t be read."
        case .contractUnavailable:
            return "The capability contract couldn’t be evaluated."
        case .selfReportsUnavailable:
            return "Self-reports couldn’t be read, so trends are missing."
        case .metricSnapshotsUnavailable:
            return "Signal history couldn’t be read, so trends are missing."
        case .responseBudgetExceeded:
            return "This section was too large to send and was left out."
        default:
            // An unfamiliar code is still a real failure; say so without
            // pretending to know which one.
            return "Part of this section couldn’t be loaded."
        }
    }

    /// One line summarising a whole section's issues, newest concern first.
    static func summary(for issues: [FamiliarDashboardIssue]) -> String? {
        guard let first = issues.first else { return nil }
        let lead = message(for: first)
        guard issues.count > 1 else { return lead }
        return "\(lead) (+\(issues.count - 1) more)"
    }

    static func anyRetryable(_ issues: [FamiliarDashboardIssue]) -> Bool {
        issues.contains { $0.retryable }
    }
}
