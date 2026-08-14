import XCTest
@testable import CovenCave

@MainActor
final class ThreadDeleteReconciliationTests: XCTestCase {
    func testSuppressingDeletedSessionsPreventsImmediateServerOnlyReappearance() {
        let deleted = session("session-a", familiarId: "nyx")
        let unrelated = session("session-b", familiarId: "milo")

        let result = AppModel.suppressServerSessions(
            [deleted, unrelated],
            withIDs: ["session-a"]
        )

        XCTAssertEqual(result.remaining.map(\.id), ["session-b"])
        XCTAssertEqual(result.suppressed.map(\.id), ["session-a"])
    }

    func testPartialRollbackPreservesOrderAfterEarlierSelectedDeleteSucceeds() {
        let a = thread("A")
        let b = thread("B")
        let c = thread("C")

        let restored = AppModel.restoringDeletedThreads(
            current: [c],
            removed: [(index: 0, thread: a), (index: 1, thread: b)],
            restoring: [b.id]
        )

        XCTAssertEqual(restored.map(\.id), ["B", "C"])
    }

    func testPartialRollbackPreservesMultipleFailedRowsAroundSuccessfulDeletes() {
        let a = thread("A")
        let b = thread("B")
        let c = thread("C")
        let d = thread("D")

        let restored = AppModel.restoringDeletedThreads(
            current: [d],
            removed: [
                (index: 0, thread: a),
                (index: 1, thread: b),
                (index: 2, thread: c),
            ],
            restoring: [a.id, c.id]
        )

        XCTAssertEqual(restored.map(\.id), ["A", "C", "D"])
    }

    private func thread(_ id: String) -> ChatThread {
        ChatThread(id: id, title: id, familiarIds: ["nyx"])
    }

    private func session(_ id: String, familiarId: String) -> SessionRow {
        SessionRow(
            id: id,
            title: id,
            harness: nil,
            model: nil,
            runtime: nil,
            status: nil,
            familiarId: familiarId,
            createdAt: nil,
            updatedAt: nil,
            archivedAt: nil
        )
    }
}
