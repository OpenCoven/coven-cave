import XCTest
@testable import CovenCave

/// #5850: the chat list's status vocabulary mirrors session-lifecycle.ts and
/// adds Ready to archive for chats whose PR merged.
@MainActor
final class ChatStatusTests: XCTestCase {
    private let merged = SessionPullRequest(repo: "OpenCoven/coven-cave", number: 42,
                                            state: "merged", attribution: "branch")

    private func lifecycle(
        _ status: String?, _ attention: SessionAttention? = nil,
        pr: SessionPullRequest? = nil, archived: Bool = false, pinned: Bool = false
    ) -> ChatLifecycle {
        ChatStatusSummary.derive(status: status, attention: attention, pullRequest: pr,
                                 archived: archived, pinned: pinned).lifecycle
    }

    func testDesktopPrecedenceFailedThenLiveThenAttention() {
        XCTAssertEqual(lifecycle("failed", .init(state: "awaiting-human", reason: "approval")), .failed)
        XCTAssertEqual(lifecycle("running"), .running)
        XCTAssertEqual(lifecycle("queued"), .running)
        XCTAssertEqual(lifecycle("completed"), .completed)
        XCTAssertEqual(lifecycle("paused"), .idle)
        // Unknown daemon words read as a finished run, like chatSessionStatusKey.
        XCTAssertEqual(lifecycle("orphaned"), .completed)
    }

    func testApprovalAndCredentialsAreBlockedOtherAsksAwait() {
        XCTAssertEqual(lifecycle("completed", .init(state: "awaiting-human", reason: "approval")), .blocked)
        XCTAssertEqual(lifecycle("completed", .init(state: "overdue-human", reason: "credentials")), .blocked)
        XCTAssertEqual(lifecycle("completed", .init(state: "awaiting-human", reason: "input")), .awaiting)
        XCTAssertEqual(lifecycle("completed", .init(state: "overdue-human", reason: "decision")), .awaiting)
    }

    func testLeftHangingIsAQuietWaitOutsideNeedsYou() {
        let summary = ChatStatusSummary.derive(
            status: "completed", attention: .init(state: "left-hanging"),
            pullRequest: nil, archived: false, pinned: false
        )
        XCTAssertEqual(summary.lifecycle, .awaiting)
        XCTAssertTrue(summary.quiet)
        XCTAssertFalse(summary.needsYou)
    }

    func testMergedPrMakesASettledOrLeftHangingChatReadyToArchive() {
        XCTAssertEqual(lifecycle("completed", pr: merged), .readyToArchive)
        XCTAssertEqual(lifecycle("completed", .init(state: "left-hanging"), pr: merged), .readyToArchive)
    }

    func testExplicitAskFailureRunningPinAndArchiveOutrankTheMerge() {
        XCTAssertEqual(lifecycle("completed", .init(state: "awaiting-human", reason: "input"), pr: merged), .awaiting)
        XCTAssertEqual(lifecycle("completed", .init(state: "awaiting-human", reason: "approval"), pr: merged), .blocked)
        XCTAssertEqual(lifecycle("failed", pr: merged), .failed)
        XCTAssertEqual(lifecycle("running", pr: merged), .running)
        XCTAssertEqual(lifecycle("completed", pr: merged, pinned: true), .completed)
        XCTAssertEqual(lifecycle("completed", pr: merged, archived: true), .completed)
    }

    /// Mirrors merged-chat-auto-archive.ts: only a merge of the chat's OWN
    /// branch settles it, and keep marks and extension windows opt out.
    func testOnlyABranchMergeOutsideTheDesktopOptOutsIsReady() {
        var mentioned = merged
        mentioned.attribution = "transcript"
        XCTAssertEqual(lifecycle("completed", pr: mentioned), .completed)
        XCTAssertEqual(lifecycle("completed", .init(state: "left-hanging"), pr: mentioned), .awaiting)
        var legacy = merged
        legacy.attribution = nil
        XCTAssertEqual(lifecycle("completed", pr: legacy), .readyToArchive)

        let now = Date(timeIntervalSince1970: 1_000_000)
        func derived(keep: Bool = false, until: Date? = nil) -> ChatLifecycle {
            ChatStatusSummary.derive(status: "completed", attention: nil, pullRequest: merged,
                                     archived: false, pinned: false, keep: keep,
                                     archiveDeferredUntil: until, now: now).lifecycle
        }
        XCTAssertEqual(derived(keep: true), .completed)
        XCTAssertEqual(derived(until: now.addingTimeInterval(60)), .completed)
        XCTAssertEqual(derived(until: now.addingTimeInterval(-60)), .readyToArchive)
    }

    func testArchivedChatWantsNothing() {
        XCTAssertEqual(lifecycle("completed", .init(state: "awaiting-human", reason: "input"), archived: true), .completed)
    }

    func testPullRequestBadgeUsesGitHubWordsAndClaimsOnlyTheLinkOtherwise() {
        XCTAssertEqual(ChatPullRequestBadge(merged)?.label, "PR #42 · merged")
        XCTAssertEqual(ChatPullRequestBadge(.init(repo: "o/r", number: 7, state: "open", draft: true))?.state, .draft)
        XCTAssertEqual(ChatPullRequestBadge(.init(repo: "o/r", number: 7, state: "done"))?.label, "PR #7")
        XCTAssertEqual(ChatPullRequestBadge(.init(repo: "o/r", number: 7))?.url?.absoluteString,
                       "https://github.com/o/r/pull/7")
        XCTAssertNil(ChatPullRequestBadge(.init(repo: "o/r")))
    }

    func testMalformedEvidenceDecodesAsNothingInsteadOfFailingTheList() throws {
        let json = """
        {"ok":true,"sessions":[
          {"id":"a","title":"A","status":"completed","attention":"weird","pullRequest":7},
          {"id":"b","title":"B","status":"completed",
           "attention":{"state":"awaiting-human","since":"2026-10-07T10:00:00.000Z","reason":"approval"},
           "pullRequest":{"repo":"o/r","number":3,"state":"merged","attribution":"branch"}}
        ]}
        """
        let decoded = try JSONDecoder().decode(SessionsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.sessions.count, 2)
        XCTAssertEqual(decoded.sessions[0].attention?.state, "none")
        XCTAssertEqual(ChatStatusSummary.derive(decoded.sessions[0]).lifecycle, .completed)
        let blocked = ChatStatusSummary.derive(decoded.sessions[1])
        XCTAssertEqual(blocked.lifecycle, .blocked)
        XCTAssertEqual(blocked.reasonPhrase, "needs approval")
        XCTAssertEqual(blocked.pullRequest?.state, .merged)
    }

    func testGroupChatReadsAsItsMostUrgentMemberWithRunningFirst() {
        func s(_ status: String, _ attention: SessionAttention? = nil, pr: SessionPullRequest? = nil) -> ChatStatusSummary {
            .derive(status: status, attention: attention, pullRequest: pr, archived: false, pinned: false)
        }
        XCTAssertEqual(ChatStatusSummary.combine([s("completed", pr: merged), s("running")])?.lifecycle, .running)
        XCTAssertEqual(ChatStatusSummary.combine([s("failed"), s("completed", .init(state: "awaiting-human", reason: "approval"))])?.lifecycle, .blocked)
        XCTAssertEqual(ChatStatusSummary.combine([s("completed", .init(state: "left-hanging")), s("failed")])?.lifecycle, .failed)
        // Not ready while another member still waits on you.
        XCTAssertEqual(ChatStatusSummary.combine([s("completed", pr: merged), s("completed", .init(state: "left-hanging"))])?.lifecycle, .awaiting)
        XCTAssertEqual(ChatStatusSummary.combine([s("completed", pr: merged), s("completed")])?.lifecycle, .readyToArchive)
        XCTAssertNil(ChatStatusSummary.combine([]))
    }

    func testSnapshotCountsAndFiltersByStatus() {
        let local = ChatThread(id: "phone", title: "phone", familiarIds: ["nyx"], projectRoot: nil)
        local.sessionIds = ["nyx": "bound"]
        var bound = SessionRow(id: "bound", title: "Bound", status: "completed", familiarId: "nyx")
        bound.pullRequest = merged
        var blocked = SessionRow(id: "blocked", title: "Blocked", status: "completed", familiarId: "lyra",
                                 updatedAt: "2026-10-07T09:00:00.000Z")
        blocked.attention = .init(state: "awaiting-human", since: "2026-10-07T09:00:00.000Z", reason: "credentials")
        var failed = SessionRow(id: "failed", title: "Failed", status: "failed", familiarId: "lyra",
                                updatedAt: "2026-10-07T12:00:00.000Z")
        failed.attention = nil
        let running = SessionRow(id: "running", title: "Running", status: "running", familiarId: "lyra")
        var hanging = SessionRow(id: "hanging", title: "Hanging", status: "completed", familiarId: "lyra")
        hanging.attention = .init(state: "left-hanging")

        let all = ChatListSnapshot(threads: [local], sessions: [bound, blocked, failed, running, hanging],
                                   familiars: [])
        XCTAssertEqual(all.statusCounts[.needsYou], 2)
        XCTAssertEqual(all.statusCounts[.running], 1)
        XCTAssertEqual(all.statusCounts[.readyToArchive], 1)
        XCTAssertEqual(all.entries.count, 5)

        // Needs you orders blocked before failed, whatever the recency.
        let needsYou = all.filtered(query: "", includeArchived: false, statusFilter: .needsYou)
        XCTAssertEqual(needsYou.entries.map(\.id), ["server:blocked", "server:failed"])
        // Counts do not move when a chip is chosen.
        XCTAssertEqual(needsYou.statusCounts, all.statusCounts)

        let ready = all.filtered(query: "", includeArchived: false, statusFilter: .readyToArchive)
        XCTAssertEqual(ready.entries.map(\.id), ["local:phone"])

        local.pinned = true
        let pinned = ChatListSnapshot(threads: [local], sessions: [bound], familiars: [],
                                      statusFilter: .readyToArchive)
        XCTAssertTrue(pinned.entries.isEmpty)
    }
}
