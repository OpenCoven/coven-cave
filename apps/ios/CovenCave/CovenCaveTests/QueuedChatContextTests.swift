import XCTest
@testable import CovenCave

@MainActor
final class QueuedChatContextTests: XCTestCase {
    private let originalRoot = "/repos/original"
    private let replacementRoot = "/repos/replacement"

    func testOfflineQueueCannotAdoptAReplacementRootBeforeReplay() async {
        let chat = ChatThread(title: "Offline", familiarIds: ["nova"], projectRoot: originalRoot)
        chat.enqueue("Keep my original project")
        chat.projectRoot = replacementRoot

        await assertReplayRequiresOriginalBinding(chat)
    }

    func testOriginalQueueRootSurvivesSnapshotRoundTripAfterRetargeting() async throws {
        let chat = ChatThread(title: "Offline", familiarIds: ["nova"], projectRoot: originalRoot)
        chat.enqueue("Keep this across a restart")
        chat.projectRoot = replacementRoot
        let data = try JSONEncoder().encode(chat.snapshot)
        let restored = ChatThread(snapshot: try JSONDecoder().decode(ThreadSnapshot.self, from: data))

        await assertReplayRequiresOriginalBinding(restored)
    }

    func testFailedLiveCheckpointCannotRequeueIntoAReplacementRoot() async throws {
        let chat = ChatThread(title: "Live", familiarIds: ["nova"], projectRoot: originalRoot)
        let rolledBack = expectation(description: "the unsent turn is durable")
        chat.send(
            "Preserve this send's project",
            liveDispatchLeaseIsCurrent: { false },
            persistBeforeDispatch: {
                chat.projectRoot = self.replacementRoot
                return false
            },
            persistAfterRollback: { rolledBack.fulfill(); return true },
            client: client,
            onChange: {}
        )
        await fulfillment(of: [rolledBack], timeout: 3)
        let data = try JSONEncoder().encode(chat.snapshot)
        let restored = ChatThread(snapshot: try JSONDecoder().decode(ThreadSnapshot.self, from: data))

        await assertReplayRequiresOriginalBinding(restored)
    }

    func testLegacyQueueCapturesItsSavedRootBeforeHistoryReconciliation() async {
        let restored = legacyQueue(root: originalRoot)
        restored.projectRoot = replacementRoot

        await assertReplayRequiresOriginalBinding(restored)
    }

    func testLegacyQueueWithoutARootCannotAdoptLaterRecoveredMetadata() async {
        let restored = legacyQueue(root: nil)
        restored.projectRoot = replacementRoot

        await assertReplayRequiresOriginalBinding(restored)
    }

    func testLegacyQueueFreezesRecipientFallbackAndPreservesExplicitTargets() {
        var saved = ChatThread(title: "Legacy", familiarIds: ["nova"], projectRoot: originalRoot).snapshot
        saved.messages = [
            DisplayMessage(role: .user, text: "Saved roster", queued: true),
            DisplayMessage(
                role: .user, text: "Saved delivery", queued: true,
                queuedRunIdsByFamiliarId: ["sage": "saved-run"]
            ),
            DisplayMessage(
                role: .user, text: "Explicit recipients", queued: true,
                queuedRunIdsByFamiliarId: ["sage": "saved-run"],
                queuedTargetFamiliarIds: ["ember"]
            ),
        ]
        let restored = ChatThread(snapshot: saved)

        XCTAssertEqual(restored.messages.map(\.queuedTargetFamiliarIds), [["nova"], ["sage"], ["ember"]])
    }

    func testLegacyQueuedRecipientCannotBeReplacedBySessionRepair() async {
        var saved = ChatThread(
            title: "Legacy", familiarIds: ["nova"],
            sessionIds: ["nova": "saved-session"], projectRoot: originalRoot
        ).snapshot
        saved.messages = [DisplayMessage(role: .user, text: "Keep the saved recipient", queued: true)]
        let restored = ChatThread(snapshot: saved)
        restored.familiarIds = ["sage"]
        restored.sessionIds = ["sage": "saved-session"]

        await assertReplayRequiresOriginalBinding(restored)
    }

    func testQueuedEstablishedSessionCannotBeReplacedBeforeReplay() async {
        let chat = ChatThread(
            title: "Existing chat", familiarIds: ["nova"],
            sessionIds: ["nova": "original-session"], projectRoot: originalRoot
        )
        chat.enqueue("Keep my original conversation")
        chat.sessionIds["nova"] = "replacement-session"

        await assertReplayRequiresOriginalBinding(chat)
    }

    func testQueuedSessionIdentitySurvivesSnapshotRoundTrip() async throws {
        let chat = ChatThread(
            title: "Existing chat", familiarIds: ["nova"],
            sessionIds: ["nova": "original-session"], projectRoot: originalRoot
        )
        chat.enqueue("Keep this conversation across a restart")
        chat.sessionIds["nova"] = "replacement-session"
        let data = try JSONEncoder().encode(chat.snapshot)
        let restored = ChatThread(snapshot: try JSONDecoder().decode(ThreadSnapshot.self, from: data))

        await assertReplayRequiresOriginalBinding(restored)
    }

    func testInitiallyUnboundQueuedSessionCanBecomeEstablished() async {
        let chat = ChatThread(title: "New chat", familiarIds: ["nova"], projectRoot: originalRoot)
        chat.enqueue("Follow the session established for this chat")
        chat.sessionIds["nova"] = "newly-established-session"
        var authorizedTargets: [String] = []
        var refusedTargets: [String?] = []
        await chat.replayQueued(
            client: client,
            dispatchLeaseIsCurrent: { true },
            targetAccessIsCurrent: { root, target in
                XCTAssertEqual(root, self.originalRoot)
                authorizedTargets.append(target)
                return false
            },
            onAccessRefused: { refusedTargets.append($0) },
            persistBeforeDispatch: { false },
            persistAfterRollback: { true },
            onChange: {}
        )

        XCTAssertEqual(authorizedTargets, ["nova"])
        XCTAssertEqual(refusedTargets, ["nova"])
        XCTAssertTrue(chat.messages.first?.isQueued == true)
    }

    private var client: CaveClient {
        CaveClient(connection: CaveConnection(host: "https://unused.invalid"))
    }

    private func legacyQueue(root: String?) -> ChatThread {
        var saved = ChatThread(title: "Legacy", familiarIds: ["nova"], projectRoot: root).snapshot
        saved.messages = [DisplayMessage(role: .user, text: "Legacy queued message", queued: true)]
        return ChatThread(snapshot: saved)
    }

    private func assertReplayRequiresOriginalBinding(
        _ chat: ChatThread,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        let before = chat.snapshot
        var bindingRefusals = 0
        await chat.replayQueued(
            client: client,
            dispatchLeaseIsCurrent: { true },
            targetAccessIsCurrent: { _, _ in
                XCTFail("A replacement chat binding must be refused before checking its grants.", file: file, line: line)
                return false
            },
            onAccessRefused: { target in
                if target == nil { bindingRefusals += 1 }
            },
            persistBeforeDispatch: {
                XCTFail("A retargeted queued turn must not reach a delivery checkpoint.", file: file, line: line)
                return false
            },
            persistAfterRollback: { true },
            onChange: {}
        )
        XCTAssertEqual(bindingRefusals, 1, file: file, line: line)
        XCTAssertEqual(chat.snapshot, before, file: file, line: line)
        XCTAssertTrue(chat.messages.first?.isQueued == true, file: file, line: line)
    }
}
