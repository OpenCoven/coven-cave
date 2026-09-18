import XCTest
@testable import CovenCave

/// Server-only chat rows (#5429): the conversation exists as a session on the
/// desktop and this device has no local thread for it. These cover the pure
/// reconciliation the archive/pin/delete actions are built on, and the refusal
/// path #5430 actually specifies: a mutation the server rejects must put the
/// row back and say so with a Retry.
@MainActor
final class ServerSessionActionsTests: XCTestCase {
    func testArchivingMovesRowOutOfTheActiveList() {
        let row = session("s1")

        let placed = AppModel.placingServerSession(
            active: [row, session("s2")],
            archived: [],
            archiving(row)
        )

        XCTAssertEqual(placed.active.map(\.id), ["s2"])
        XCTAssertEqual(placed.archived.map(\.id), ["s1"])
    }

    func testUnarchivingMovesRowBackIntoTheActiveList() {
        let archived = archiving(session("s1"))

        let placed = AppModel.placingServerSession(
            active: [session("s2")],
            archived: [archived],
            unarchiving(archived)
        )

        XCTAssertEqual(placed.active.map(\.id).sorted(), ["s1", "s2"])
        XCTAssertTrue(placed.archived.isEmpty)
    }

    /// A pin must not relocate the row: an archived chat that gets pinned stays
    /// archived.
    func testPinningAnArchivedRowKeepsItArchived() {
        var pinned = archiving(session("s1"))
        pinned.pinned = true

        let placed = AppModel.placingServerSession(
            active: [],
            archived: [archiving(session("s1"))],
            pinned
        )

        XCTAssertTrue(placed.active.isEmpty)
        XCTAssertEqual(placed.archived.map(\.id), ["s1"])
        XCTAssertEqual(placed.archived.first?.pinned, true)
    }

    func testPlacingReplacesRatherThanDuplicatingAnExistingRow() {
        let row = session("s1")

        let placed = AppModel.placingServerSession(active: [row], archived: [], row)

        XCTAssertEqual(placed.active.map(\.id), ["s1"])
    }

    func testRemovingReturnsTheRowFromEitherList() {
        let active = session("s1")
        let archived = archiving(session("s2"))

        let fromActive = AppModel.removingServerSession(
            active: [active], archived: [archived], id: "s1")
        XCTAssertEqual(fromActive.removed?.id, "s1")
        XCTAssertTrue(fromActive.active.isEmpty)
        XCTAssertEqual(fromActive.archived.map(\.id), ["s2"])

        let fromArchived = AppModel.removingServerSession(
            active: [active], archived: [archived], id: "s2")
        XCTAssertEqual(fromArchived.removed?.id, "s2")
        XCTAssertEqual(fromArchived.active.map(\.id), ["s1"])
        XCTAssertTrue(fromArchived.archived.isEmpty)
    }

    func testRemovingAnUnknownIdReportsNothingRemoved() {
        let result = AppModel.removingServerSession(
            active: [session("s1")], archived: [], id: "missing")

        XCTAssertNil(result.removed)
        XCTAssertEqual(result.active.map(\.id), ["s1"])
    }

    /// The load path used to be `sessions.filter { $0.archivedAt == nil }`,
    /// which dropped archived rows on the floor — archiving a server row made
    /// it unreachable from the phone. Both halves must survive the split.
    func testPartitioningKeepsArchivedRowsInsteadOfDiscardingThem() {
        let partitioned = AppModel.partitioningLoadedSessions(
            [session("s1"), archiving(session("s2"))],
            active: [],
            archived: [],
            inFlight: []
        )

        XCTAssertEqual(partitioned.active.map(\.id), ["s1"])
        XCTAssertEqual(partitioned.archived.map(\.id), ["s2"])
    }

    /// Local intent wins while a PATCH is settling: a fetch that predates the
    /// write must not restore the value the user just changed.
    func testPartitioningKeepsTheOptimisticValueForAnInFlightRow() {
        let stale = session("s1")

        let partitioned = AppModel.partitioningLoadedSessions(
            [stale],
            active: [],
            archived: [archiving(stale)],
            inFlight: ["s1"]
        )

        XCTAssertTrue(partitioned.active.isEmpty)
        XCTAssertEqual(partitioned.archived.map(\.id), ["s1"])
    }

    /// An in-flight row that is no longer held locally is an optimistic delete.
    /// Reviving it from a stale fetch would make a deleted chat flicker back.
    func testPartitioningDropsARowWhoseDeleteIsStillInFlight() {
        let partitioned = AppModel.partitioningLoadedSessions(
            [session("s1"), session("s2")],
            active: [session("s2")],
            archived: [],
            inFlight: ["s1"]
        )

        XCTAssertEqual(partitioned.active.map(\.id), ["s2"])
        XCTAssertTrue(partitioned.archived.isEmpty)
    }

    /// Only rows with a write in flight are protected; everything else follows
    /// the server, so a change made on another client still lands here.
    func testPartitioningFollowsTheServerForRowsWithNoWriteInFlight() {
        let partitioned = AppModel.partitioningLoadedSessions(
            [archiving(session("s1"))],
            active: [session("s1")],
            archived: [],
            inFlight: []
        )

        XCTAssertTrue(partitioned.active.isEmpty)
        XCTAssertEqual(partitioned.archived.map(\.id), ["s1"])
    }

    func testArchiveStampIsParseableISO8601() {
        let stamp = AppModel.serverSessionArchiveStamp(Date(timeIntervalSince1970: 1_700_000_000))

        XCTAssertNotNil(caveParseISO(stamp))
    }

    // MARK: - Fixtures

    // MARK: - Refused mutations restore the row and offer a Retry (#5430)

    func testRefusedArchiveRestoresTheRowAndOffersRetry() async throws {
        let row = session("s1")
        let app = makeApp(failing: ServerSessionTestFailure.refused)
        app.serverSessions = [row]

        app.setServerSessionArchived(row, true)

        // Optimistic apply lands first: the row leaves the active list at once.
        XCTAssertTrue(app.serverSessions.isEmpty)
        XCTAssertEqual(app.archivedServerSessions.map(\.id), ["s1"])

        try await waitForFailureToast(on: app)

        XCTAssertEqual(app.serverSessions.map(\.id), ["s1"], "a refused archive puts the row back")
        XCTAssertTrue(app.archivedServerSessions.isEmpty, "and takes it out of the archived list")
        XCTAssertEqual(app.toast?.actionTitle, "Retry", "the operator is offered a way forward")
        XCTAssertNotNil(app.toast?.action)
        XCTAssertEqual(app.toast?.style, .error)
    }

    func testRefusedDeleteRestoresTheRowAndOffersRetry() async throws {
        let archived = archiving(session("s2"))
        let app = makeApp(failing: ServerSessionTestFailure.refused)
        app.archivedServerSessions = [archived]

        app.deleteServerSession(archived)

        XCTAssertTrue(app.archivedServerSessions.isEmpty)

        try await waitForFailureToast(on: app)

        XCTAssertEqual(
            app.archivedServerSessions.map(\.id),
            ["s2"],
            "a refused delete restores the row to the list it came from",
        )
        XCTAssertTrue(app.serverSessions.isEmpty, "and not to the active one")
        XCTAssertEqual(app.toast?.actionTitle, "Retry")
        XCTAssertNotNil(app.toast?.action)
    }

    func testRefusedPinRestoresThePreviousFlag() async throws {
        var pinned = session("s3")
        pinned.pinned = true
        let app = makeApp(failing: ServerSessionTestFailure.refused)
        app.serverSessions = [pinned]

        app.setServerSessionPinned(pinned, false)

        XCTAssertEqual(app.serverSessions.first?.pinned, false)

        try await waitForFailureToast(on: app)

        XCTAssertEqual(app.serverSessions.first?.pinned, true, "the refused unpin rolls back")
    }

    // MARK: - Helpers

    private func makeApp(failing error: Error) -> AppModel {
        let defaults = UserDefaults(suiteName: "server-session-actions-\(UUID().uuidString)")!
        let app = AppModel(
            defaults: defaults,
            restoreLocalState: false,
            coreResourceClientFactory: { _ in FailingServerSessionClient(error: error) }
        )
        app.connection = CaveConnection(host: "http://cave.test:3000")
        return app
    }

    /// The mutation runs in a detached task, so the assertions have to wait for
    /// it rather than assume a scheduling order.
    ///
    /// Waiting for *any* toast is not enough: `deleteServerSession` posts its
    /// optimistic "Chat deleted" confirmation synchronously, so a bare
    /// `toast != nil` check returns before the refusal is even sent and reads
    /// the success banner as the failure one.
    private func waitForFailureToast(
        on app: AppModel,
        timeout: TimeInterval = 5,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while app.toast?.style != .error {
            if Date() >= deadline {
                XCTFail("timed out waiting for the failure toast", file: file, line: line)
                return
            }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
    }

    private func session(_ id: String) -> SessionRow {
        SessionRow(
            id: id,
            title: id,
            harness: nil,
            model: nil,
            runtime: nil,
            status: nil,
            familiarId: "nyx",
            createdAt: nil,
            updatedAt: nil,
            archivedAt: nil
        )
    }

    private func archiving(_ row: SessionRow) -> SessionRow {
        var next = row
        next.archivedAt = "2026-09-15T00:00:00Z"
        return next
    }

    private func unarchiving(_ row: SessionRow) -> SessionRow {
        var next = row
        next.archivedAt = nil
        return next
    }
}

enum ServerSessionTestFailure: Error {
    case refused
}

/// Core-resource seam that answers every read emptily and refuses every
/// server-session mutation, so the rollback and Retry contract can be driven
/// without a process-global URLProtocol shim.
private final class FailingServerSessionClient:
    AppModelCoreResourceClient, ServerSessionMutatingClient, @unchecked Sendable
{
    private let error: Error

    init(error: Error) { self.error = error }

    func ping() async -> Bool { true }
    func projects() async throws -> [ProjectInfo] { [] }
    func projectGrants() async throws -> ProjectGrantsResponse { ProjectGrantsResponse(ok: true) }
    func familiars() async throws -> [Familiar] { [] }
    func sessions(includeArchived: Bool = false) async throws -> [SessionRow] { [] }
    func tasks() async throws -> [BoardCard] { [] }
    func fetchTheme() async throws -> ThemeSnapshot {
        ThemeSnapshot(themeId: "cave", mode: "dark", tokens: [:], updatedAt: "2026-09-17T00:00:00Z")
    }
    func operatorProfile() async throws -> OperatorProfile {
        OperatorProfile(name: "Val", pronouns: nil, avatarPresent: false, avatarUpdatedAt: nil)
    }
    func refreshAccessToken() async -> String? { nil }

    func setSessionFlags(sessionId: String, archived: Bool?, pinned: Bool?) async throws {
        throw error
    }

    func deleteSession(sessionId: String) async throws {
        throw error
    }
}
