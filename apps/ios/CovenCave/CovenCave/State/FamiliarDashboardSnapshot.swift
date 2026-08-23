import Foundation

/// One section as the CLIENT holds it, which is not the same thing as the
/// section the server sent.
///
/// The difference is `stale`. The server has no dashboard cache, so it can
/// never tell a phone "the value you are already showing is still the best one
/// available" — only the phone knows what it is holding. When a refresh cannot
/// replace a section, the previous value is kept and PRESENTED as stale while
/// everything describing that value — its server state, its `generatedAt`, its
/// issues — stays exactly as the server originally sent it. A refresh that
/// failed must never be able to make old data look newly assembled.
struct FamiliarDashboardClientSection<Payload: Decodable & Hashable & Sendable>:
    Hashable, Sendable {
    /// What this section should render as.
    var presentation: FamiliarDashboardSectionPresentation
    /// The state the server gave for the data actually being shown. On a stale
    /// section this is the ORIGINAL state, not `unavailable`.
    var serverState: FamiliarDashboardServerSectionState
    /// When the data being shown was assembled. Never advanced by a failed
    /// refresh — that is the whole point of keeping it.
    var generatedAt: String
    var data: Payload?
    /// Issues the server attached to the data being shown.
    var issues: [FamiliarDashboardIssue]
    /// Why the NEWEST attempt could not replace this section. Empty unless the
    /// section is stale, and deliberately separate from `issues` so a tab can
    /// say "this is from 11:04, and here is why it hasn't moved" rather than
    /// blending a live failure into the retained value's own caveats.
    var refreshIssues: [FamiliarDashboardIssue]

    init(
        presentation: FamiliarDashboardSectionPresentation,
        serverState: FamiliarDashboardServerSectionState,
        generatedAt: String,
        data: Payload?,
        issues: [FamiliarDashboardIssue] = [],
        refreshIssues: [FamiliarDashboardIssue] = []
    ) {
        self.presentation = presentation
        self.serverState = serverState
        self.generatedAt = generatedAt
        self.data = data
        self.issues = issues
        self.refreshIssues = refreshIssues
    }

    var isStale: Bool { presentation == .stale }

    /// True only when there is genuinely nothing to draw. `empty` is NOT in
    /// here: it is a positive claim that every source answered and the answer
    /// was nothing, and a tab is entitled to render it as a calm empty state.
    var hasNothingToShow: Bool { data == nil }

    /// Whether a retry could plausibly change this section.
    ///
    /// No issues at all means the desktop broke its own contract (an
    /// `unavailable` section must name a cause). Offering the retry is the
    /// safer default there: withholding it strands a person on a dead screen
    /// over a diagnostic the server failed to send.
    var isRetryable: Bool {
        let considered = refreshIssues.isEmpty ? issues : refreshIssues
        return considered.isEmpty || FamiliarDashboardIssueCopy.anyRetryable(considered)
    }

    /// The issues a tab should surface: the newest failure when the section is
    /// stale, otherwise the caveats attached to the data itself.
    var visibleIssues: [FamiliarDashboardIssue] {
        refreshIssues.isEmpty ? issues : refreshIssues
    }

    /// Fold one freshly received section into whatever the client already had.
    ///
    /// The rule in one sentence: **a section that arrives with data replaces
    /// what was there; a section that arrives with nothing only replaces what
    /// was there if there was nothing there either.**
    static func merged(
        previous: Self?,
        incoming: FamiliarDashboardWireSection<Payload>
    ) -> Self {
        // `effectiveState` believes the data over the label — see its note.
        let state = incoming.effectiveState
        guard state == .unavailable else {
            return Self(
                presentation: FamiliarDashboardSectionPresentation(state),
                serverState: state,
                generatedAt: incoming.generatedAt,
                data: incoming.data,
                issues: incoming.issues,
                refreshIssues: []
            )
        }

        if let previous, previous.data != nil {
            return Self(
                presentation: .stale,
                serverState: previous.serverState,
                generatedAt: previous.generatedAt,
                data: previous.data,
                issues: previous.issues,
                refreshIssues: incoming.issues
            )
        }

        return Self(
            presentation: .unavailable,
            serverState: .unavailable,
            generatedAt: incoming.generatedAt,
            data: nil,
            issues: incoming.issues,
            refreshIssues: []
        )
    }

    /// Mark a section stale because the WHOLE request failed — a transport
    /// error, a 503, a body this build cannot read. There are no server issues
    /// to attach in that case; the reason lives on the entry.
    func markedStale() -> Self {
        guard data != nil else { return self }
        var copy = self
        copy.presentation = .stale
        return copy
    }
}

/// One coherent dashboard as the client holds it: the newest identity, plus
/// three sections each of which may be older than the others.
struct FamiliarDashboardSnapshot: Hashable, Sendable {
    var familiarId: String
    var version: Int
    /// When the server assembled the newest payload merged into this snapshot.
    /// Individual sections carry their own, older, stamps when they are stale.
    var generatedAt: String
    /// Never shed and never retained: identity comes from the registry read
    /// that decides found-vs-not-found, so a 200 always carries a current one.
    var identity: FamiliarDashboardIdentity
    var overview: FamiliarDashboardClientSection<FamiliarDashboardOverview>
    var profile: FamiliarDashboardClientSection<FamiliarDashboardProfile>
    var analytics: FamiliarDashboardClientSection<FamiliarDashboardAnalytics>

    static func merged(
        previous: Self?,
        payload: FamiliarDashboardPayload
    ) -> Self {
        Self(
            familiarId: payload.familiarId,
            version: payload.version,
            generatedAt: payload.generatedAt,
            identity: payload.identity,
            overview: .merged(previous: previous?.overview, incoming: payload.sections.overview),
            profile: .merged(previous: previous?.profile, incoming: payload.sections.profile),
            analytics: .merged(previous: previous?.analytics, incoming: payload.sections.analytics)
        )
    }

    func markedStale() -> Self {
        var copy = self
        copy.overview = overview.markedStale()
        copy.profile = profile.markedStale()
        copy.analytics = analytics.markedStale()
        return copy
    }

    var hasAnyStaleSection: Bool {
        overview.isStale || profile.isStale || analytics.isStale
    }
}

/// The per-Familiar cell the store publishes.
struct FamiliarDashboardEntry: Hashable, Sendable {
    enum Phase: Hashable, Sendable {
        /// Nothing has been asked for yet.
        case idle
        /// A first load is in flight and there is nothing to show meanwhile.
        case loading
        /// A refresh is in flight over a snapshot that is already on screen.
        case refreshing
        /// Settled with a snapshot. `error` may still be set, in which case the
        /// snapshot's sections say so by presenting as stale.
        case ready
        /// Settled with nothing to show. `error` says why.
        case failed
        /// The Familiar is gone (404). A navigation event, not a retry.
        case missing
    }

    var phase: Phase = .idle
    var snapshot: FamiliarDashboardSnapshot?
    /// The most recent failure. Retained while a stale snapshot is shown, so
    /// the hub can explain why what is on screen has stopped moving.
    var error: FamiliarDashboardError?
    /// The last time a load SUCCEEDED. A failed refresh never advances it.
    var lastLoadedAt: Date?
    var lastAttemptedAt: Date?

    var isBusy: Bool { phase == .loading || phase == .refreshing }

    /// True when the hub should show a full-surface error instead of content.
    var showsFullSurfaceError: Bool { phase == .failed || phase == .missing }
}

/// When the hub's 30-second refresh is allowed to run.
///
/// Extracted from the view so the rule is one testable expression rather than
/// a condition spread across a `.task` modifier, a `guard`, and a comment. All
/// three conditions are required, and the AND is the point: polling a desktop
/// from a screen nobody is looking at spends a phone's radio for nothing, and
/// polling with no endpoint configured cannot even form a request.
enum FamiliarDashboardRefreshPolicy {
    /// The cadence `cave-9rwd.2` specifies.
    static let interval: Duration = .seconds(30)

    static func shouldPoll(
        hubVisible: Bool,
        sceneActive: Bool,
        endpointConfigured: Bool
    ) -> Bool {
        hubVisible && sceneActive && endpointConfigured
    }
}
