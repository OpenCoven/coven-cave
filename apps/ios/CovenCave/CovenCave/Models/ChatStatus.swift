import Foundation

/// What a conversation is doing, and whether it wants something from you, as
/// one word for the chat list (#5850).
///
/// The first six cases mirror `src/lib/session-lifecycle.ts` exactly — the
/// desktop's ONE vocabulary — including its precedence: failed wins, live work
/// outranks attention, an `approval` or `credentials` ask is Blocked rather
/// than Awaiting you. `readyToArchive` is the phone's addition: a chat whose
/// PR has merged and that is otherwise settled has finished its work.
///
/// Pure value type: no IO, no transcript reads, so the list snapshot can
/// derive it for every row without observing streamed text.
enum ChatLifecycle: String, CaseIterable, Hashable {
    case running
    case blocked
    case awaiting
    case failed
    case readyToArchive
    case completed
    case idle

    /// The only word this state is ever spelled with (desktop parity).
    var label: String {
        switch self {
        case .running: return "Running"
        case .blocked: return "Blocked"
        case .awaiting: return "Awaiting you"
        case .failed: return "Failed"
        case .readyToArchive: return "Ready to archive"
        case .completed: return "Completed"
        case .idle: return "Idle"
        }
    }

    /// Urgency inside Needs you, then the rest: blocked → failed → awaiting,
    /// the desktop's NEEDS_YOU_RANK, followed by live and settled states.
    var urgencyRank: Int {
        switch self {
        case .blocked: return 0
        case .failed: return 1
        case .awaiting: return 2
        case .running: return 3
        case .readyToArchive: return 4
        case .completed: return 5
        case .idle: return 6
        }
    }
}

/// The pull request axis, independent of the lifecycle: GitHub's own words.
enum ChatPullRequestState: String, Hashable {
    case open, draft, merged, closed
    /// A PR exists but its GitHub state is unverified — claim the link only.
    case unknown
}

struct ChatPullRequestBadge: Hashable {
    let state: ChatPullRequestState
    let number: Int?
    let url: URL?

    /// "PR #42 · merged"; an unverified state names only the PR.
    var label: String {
        let number = number.map { " #\($0)" } ?? ""
        return state == .unknown ? "PR\(number)" : "PR\(number) · \(state.rawValue)"
    }

    init?(_ pr: SessionPullRequest?) {
        guard let pr else { return nil }
        let resolved = pr.url.flatMap(URL.init(string:))
            ?? {
                guard let repo = pr.repo, let number = pr.number else { return nil }
                return URL(string: "https://github.com/\(repo)/pull/\(number)")
            }()
        guard resolved != nil || pr.number != nil else { return nil }
        let state = (pr.state ?? "").lowercased()
        switch state {
        case "merged": self.state = .merged
        case "closed": self.state = .closed
        case _ where pr.draft == true || state == "draft": self.state = .draft
        case "open": self.state = .open
        default: self.state = .unknown
        }
        number = pr.number
        url = resolved
    }
}

/// Everything a chat row needs to say about status, resolved once.
struct ChatStatusSummary: Hashable {
    let lifecycle: ChatLifecycle
    /// Why the chat is waiting (`input`, `decision`, `approval`,
    /// `credentials`), when it is.
    let reason: String?
    /// When the chat started waiting on you.
    let since: Date?
    /// The familiar spoke last and nobody came back, but it asked nothing.
    /// Still reads "Awaiting you" (desktop parity), just quietly, and stays
    /// out of Needs you so that count stays actionable.
    let quiet: Bool
    let pullRequest: ChatPullRequestBadge?

    static let settled = ChatStatusSummary(
        lifecycle: .completed, reason: nil, since: nil, quiet: false, pullRequest: nil
    )

    /// Stopped on you: what the Needs you filter collects.
    var needsYou: Bool {
        switch lifecycle {
        case .blocked, .failed: return true
        case .awaiting: return !quiet
        default: return false
        }
    }

    /// The short qualifier after the label: "approval", "credentials", …
    var reasonPhrase: String? {
        switch reason {
        case "approval": return "needs approval"
        case "credentials": return "needs credentials"
        case "decision": return "needs a decision"
        case "input": return "needs your reply"
        default: return nil
        }
    }

    /// One spoken sentence for VoiceOver.
    var accessibilityText: String {
        var parts = [lifecycle.label]
        if let reasonPhrase, lifecycle == .blocked || lifecycle == .awaiting {
            parts.append(reasonPhrase)
        }
        if let pullRequest { parts.append(pullRequest.label) }
        return parts.joined(separator: ", ")
    }

    /// Statuses the desktop treats as live work (`ACTIVE_SESSION_STATUSES`
    /// plus the queue): they outrank attention and are never archivable.
    private static let liveStatuses: Set<String> = ["running", "starting", "queued"]

    /// Compose one session's daemon status, attention evidence and PR into a
    /// summary. `streaming` is a live local turn this device can see before the
    /// next list poll reports it.
    static func derive(
        status: String?,
        attention: SessionAttention?,
        pullRequest: SessionPullRequest?,
        archived: Bool,
        pinned: Bool,
        streaming: Bool = false
    ) -> ChatStatusSummary {
        let pr = ChatPullRequestBadge(pullRequest)
        let key = (status ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        if streaming || liveStatuses.contains(key) {
            return ChatStatusSummary(lifecycle: .running, reason: nil, since: nil,
                                     quiet: false, pullRequest: pr)
        }
        if key == "failed" {
            return ChatStatusSummary(lifecycle: .failed, reason: nil, since: nil,
                                     quiet: false, pullRequest: pr)
        }
        // An archived chat is settled by definition — it wants nothing.
        let attention = archived ? nil : attention
        let state = attention?.state ?? "none"
        let merged = pr?.state == .merged

        if state != "none" && !state.isEmpty {
            let reason = attention?.reason
            let since = caveParseISO(attention?.since)
            if reason == "approval" || reason == "credentials" {
                return ChatStatusSummary(lifecycle: .blocked, reason: reason, since: since,
                                         quiet: false, pullRequest: pr)
            }
            let leftHanging = state == "left-hanging"
            // A merged PR answers a chat that was merely left hanging: the
            // familiar's last word was the work landing. An explicit ask still
            // outranks the merge.
            if leftHanging && merged && !pinned {
                return ChatStatusSummary(lifecycle: .readyToArchive, reason: nil, since: nil,
                                         quiet: false, pullRequest: pr)
            }
            return ChatStatusSummary(lifecycle: .awaiting, reason: reason, since: since,
                                     quiet: leftHanging, pullRequest: pr)
        }
        if merged && !pinned && !archived {
            return ChatStatusSummary(lifecycle: .readyToArchive, reason: nil, since: nil,
                                     quiet: false, pullRequest: pr)
        }
        return ChatStatusSummary(lifecycle: key == "paused" ? .idle : .completed,
                                 reason: nil, since: nil, quiet: false, pullRequest: pr)
    }

    static func derive(_ session: SessionRow, streaming: Bool = false) -> ChatStatusSummary {
        derive(status: session.status, attention: session.attention,
               pullRequest: session.pullRequest, archived: session.archivedAt != nil,
               pinned: session.pinned == true, streaming: streaming)
    }

    /// A local thread may be bound to several sessions (a group chat, one per
    /// familiar). It reads as its most urgent member — live work first, so a
    /// running familiar is never hidden behind another one's old ask — and
    /// carries the most telling PR among them.
    static func combine(_ summaries: [ChatStatusSummary]) -> ChatStatusSummary? {
        guard !summaries.isEmpty else { return nil }
        func rank(_ s: ChatStatusSummary) -> Int {
            if s.lifecycle == .running { return -1 }
            // A quiet wait is less urgent than any explicit one or a failure.
            if s.lifecycle == .awaiting && s.quiet { return 3 }
            return s.lifecycle.urgencyRank
        }
        // Ranks put every unsettled member ahead of Ready to archive, so the
        // lead is only Ready when no member is still working or waiting.
        let lead = summaries.min { rank($0) < rank($1) }!
        let pr = lead.pullRequest ?? summaries.lazy.compactMap(\.pullRequest).first
        return ChatStatusSummary(lifecycle: lead.lifecycle, reason: lead.reason,
                                 since: lead.since, quiet: lead.quiet, pullRequest: pr)
    }

    /// A pinned chat is one you chose to keep in view, so it is never offered
    /// for archiving; it reads Completed instead.
    func pinned(_ isPinned: Bool) -> ChatStatusSummary {
        guard isPinned, lifecycle == .readyToArchive else { return self }
        return ChatStatusSummary(lifecycle: .completed, reason: nil, since: nil,
                                 quiet: false, pullRequest: pullRequest)
    }

    /// A summary with a live local stream folded in.
    func streaming(_ isStreaming: Bool) -> ChatStatusSummary {
        guard isStreaming, lifecycle != .running else { return self }
        return ChatStatusSummary(lifecycle: .running, reason: nil, since: nil,
                                 quiet: false, pullRequest: pullRequest)
    }
}

/// The home's status filter. `nil` in the snapshot means All.
enum ChatStatusFilter: String, CaseIterable, Hashable, Identifiable {
    case needsYou
    case running
    case readyToArchive

    var id: String { rawValue }

    var label: String {
        switch self {
        case .needsYou: return "Needs you"
        case .running: return "Running"
        case .readyToArchive: return "Ready to archive"
        }
    }

    /// The chip's word; rows and VoiceOver keep the full `label`.
    var chipLabel: String { self == .readyToArchive ? "Ready" : label }

    func matches(_ status: ChatStatusSummary) -> Bool {
        switch self {
        case .needsYou: return status.needsYou
        case .running: return status.lifecycle == .running
        case .readyToArchive: return status.lifecycle == .readyToArchive
        }
    }
}
