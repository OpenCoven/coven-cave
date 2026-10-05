import XCTest
@testable import CovenCave

@MainActor
final class ChatRetryDispatchTests: XCTestCase {
    private func thread() -> ChatThread {
        let attemptId = UUID().uuidString
        let summary = ChatReasoningBlock(
            schemaVersion: 1, id: "\(attemptId):summary", representation: "provider-summary",
            phase: "complete", text: "Previous attempt summary", disclosure: "display-safe",
            observation: .init(runId: UUID().uuidString, attemptId: attemptId,
                source: "runtime-report", producer: .init(harness: "claude", version: "2.1.288"),
                firstObservedAt: 1, updatedAt: 2, completedAt: 2, binding: "unavailable")
        )
        return ChatThread(
            title: "Retry",
            familiarIds: ["nova", "ember"],
            sessionIds: ["nova": "session-nova"],
            projectRoot: "/repos/cave",
            messages: [
                DisplayMessage(role: .user, text: "Original prompt", sendPrompt: "Exact wire prompt"),
                DisplayMessage(
                    serverTurnId: "server-original",
                    role: .assistant,
                    familiarId: "nova",
                    text: "The original reply",
                    isError: true,
                    requestedModel: "chosen-model",
                    runtimeIdentity: .init(schemaVersion: 1, harness: "claude", version: "2.1.288", model: "claude-opus-5-5"),
                    reasoningBlocks: [summary]
                ),
            ]
        )
    }

    private var client: CaveClient {
        CaveClient(connection: CaveConnection(host: "http://127.0.0.1:9"))
    }

    func testRevocationAfterRetryReturnsRestoresAndPersistsOriginalReply() async throws {
        let thread = thread()
        let original = thread.messages
        var current = true
        var persisted = 0
        var refusals = 0
        let task = try XCTUnwrap(thread.retry(
            original[1].id,
            client: client,
            liveDispatchLeaseIsCurrent: { current },
            persistAfterRefusal: { persisted += 1; return true },
            onRefusal: { refusals += 1 },
            onChange: {}
        ))
        XCTAssertTrue(thread.messages[1].streaming)
        XCTAssertNotNil(original[1].reasoningBlocks?.first?.validated)
        XCTAssertNil(thread.messages[1].runtimeIdentity, "A new attempt cannot claim the previous runtime report.")
        XCTAssertNil(thread.messages[1].reasoningBlocks, "The previous attempt's summaries must not survive into the retry.")
        current = false
        await task.value
        XCTAssertEqual(thread.messages, original)
        XCTAssertEqual(persisted, 1)
        XCTAssertEqual(refusals, 1)
    }

    func testDeferredNetworkPreflightRechecksAuthorityAndRestoresOriginalReply() async throws {
        let thread = thread()
        let original = thread.messages
        var preflights = 0
        var refusals = 0
        let task = try XCTUnwrap(thread.retry(
            original[1].id,
            client: client,
            liveDispatchLeaseIsCurrent: {
                preflights += 1
                // The stream-entry check succeeds; the separate MainActor task
                // immediately before CaveClient constructs its POST refuses.
                return preflights == 1
            },
            persistAfterRefusal: { true },
            onRefusal: { refusals += 1 },
            onChange: {}
        ))
        await task.value
        XCTAssertEqual(preflights, 2)
        XCTAssertEqual(refusals, 1)
        XCTAssertEqual(thread.messages, original)
    }

    func testQueuedReplayClearsPreviousAttemptEvidenceBeforeCheckpoint() async {
        let thread = thread()
        thread.messages[0].queued = true
        thread.messages[0].queuedTargetFamiliarIds = ["nova"]
        thread.messages[0].queuedContext = .init(projectRoot: thread.projectRoot, sessionIds: thread.sessionIds)
        thread.messages[1].serverTurnId = nil
        var checkpoints = 0
        await thread.replayQueued(
            client: client,
            onConnectionFailure: { XCTFail("No network request should start: \($0)") },
            dispatchLeaseIsCurrent: { true },
            targetAccessIsCurrent: { _, target in target == "nova" },
            onAccessRefused: { _ in XCTFail("The original project binding remains valid.") },
            persistBeforeDispatch: {
                checkpoints += 1
                XCTAssertTrue(thread.messages[1].streaming)
                XCTAssertNil(thread.messages[1].runtimeIdentity)
                XCTAssertNil(thread.messages[1].reasoningBlocks)
                return false
            },
            persistAfterRollback: { true }, onChange: {}
        )
        XCTAssertEqual(checkpoints, 1)
        XCTAssertTrue(thread.messages[0].isQueued)
        XCTAssertNil(thread.messages[1].runtimeIdentity)
        XCTAssertNil(thread.messages[1].reasoningBlocks)
    }

    func testRootSessionAndRosterDriftBeforeDeferredPOSTFailClosed() async throws {
        let mutations: [(ChatThread) -> Void] = [
            { $0.projectRoot = "/repos/replacement" },
            { $0.sessionIds["nova"] = "replacement-session" },
            { $0.familiarIds = ["nova", "other"] },
        ]
        for mutate in mutations {
            let thread = thread()
            let original = thread.messages
            var preflights = 0
            var refusals = 0
            let task = try XCTUnwrap(thread.retry(
                original[1].id,
                client: client,
                liveDispatchLeaseIsCurrent: {
                    preflights += 1
                    mutate(thread)
                    return true
                },
                persistAfterRefusal: { true },
                onRefusal: { refusals += 1 },
                onChange: {}
            ))
            await task.value
            XCTAssertEqual(preflights, 1, "The frozen binding must reject before calling external authority again.")
            XCTAssertEqual(refusals, 1)
            XCTAssertEqual(thread.messages, original)
        }
    }

    func testRefusalDoesNotOverwriteANewerTranscriptEdit() async throws {
        let thread = thread()
        let messageId = thread.messages[1].id
        var refusals = 0
        let task = try XCTUnwrap(thread.retry(
            messageId,
            client: client,
            liveDispatchLeaseIsCurrent: {
                thread.updateText(messageId, "Newer transcript")
                return false
            },
            persistAfterRefusal: { XCTFail("No rollback should be persisted over a newer edit."); return false },
            onRefusal: { refusals += 1 },
            onChange: {}
        ))
        await task.value
        XCTAssertEqual(thread.messages[1].text, "Newer transcript")
        XCTAssertEqual(refusals, 1)
    }

    func testFrozenSendBindingAllowsSiblingSessionEstablishmentButNotRetargeting() {
        let thread = thread()
        let send = ChatDispatchBinding(thread: thread)
        let retry = ChatDispatchBinding(thread: thread, familiarIds: ["nova"])
        thread.sessionIds["ember"] = "newly-established-sibling"
        XCTAssertTrue(send.matches(thread))
        XCTAssertTrue(retry.matches(thread, includingSessions: true))
        thread.sessionIds["nova"] = "replacement"
        XCTAssertFalse(send.matches(thread), "an established send target must not switch sessions")
        XCTAssertFalse(retry.matches(thread, includingSessions: true))
        thread.projectRoot = "/repos/replacement"
        XCTAssertFalse(send.matches(thread))
    }
}
