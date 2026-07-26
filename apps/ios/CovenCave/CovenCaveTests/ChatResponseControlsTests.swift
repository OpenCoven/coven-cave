import XCTest
@testable import CovenCave

final class ChatResponseControlsTests: XCTestCase {
    private actor Gate {
        private var opened = false
        private var waiters: [CheckedContinuation<Void, Never>] = []

        func open() {
            opened = true
            for waiter in waiters { waiter.resume() }
            waiters.removeAll()
        }

        func wait() async {
            if opened { return }
            await withCheckedContinuation { waiters.append($0) }
        }
    }

    private actor EventLog {
        private var events: [String] = []

        func append(_ event: String) {
            events.append(event)
        }

        func snapshot() -> [String] {
            events
        }
    }

    func testSupportedWireValuesStayStable() {
        XCTAssertEqual(ChatThinkingEffort.allCases.map(\.rawValue), ["low", "medium", "high"])
        XCTAssertEqual(ChatResponseSpeed.allCases.map(\.rawValue), ["fast", "balanced", "careful"])
        XCTAssertEqual(ChatModelOverrideScope.nextMessage.rawValue, "next-message")
    }

    func testSendBodyEncodesResponseControls() throws {
        let body = CaveClient.SendBody(
            familiarId: "nyx",
            prompt: "Review the branch",
            sessionId: nil,
            attachments: nil,
            runId: "run-1",
            reasoningEffort: .medium,
            responseSpeed: .careful,
            modelOverride: "anthropic/claude-opus-4-6",
            modelOverrideScope: .session
        )

        let data = try JSONEncoder().encode(body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json["reasoningEffort"] as? String, "medium")
        XCTAssertEqual(json["responseSpeed"] as? String, "careful")
        XCTAssertEqual(json["modelOverride"] as? String, "anthropic/claude-opus-4-6")
        XCTAssertEqual(json["modelOverrideScope"] as? String, "session")
    }

    @MainActor
    func testPendingModelOverridePersistsWithItsThread() {
        let thread = ChatThread(title: "New Nyx chat", familiarIds: ["nyx"])
        thread.pendingModelOverride = "anthropic/claude-opus-4-6"

        let restored = ChatThread(snapshot: thread.snapshot)

        XCTAssertEqual(restored.pendingModelOverride, "anthropic/claude-opus-4-6")
    }

    func testPluginReconciliationPermitsOnlyAnAppliedMatchingCatalog() {
        XCTAssertTrue(
            MarketplacePluginMutationReconciliation.isConfirmed(
                .applied, installed: true, expectedInstalled: true))
    }

    func testPluginReconciliationRejectsUnconfirmedCatalogStates() {
        XCTAssertFalse(
            MarketplacePluginMutationReconciliation.isConfirmed(
                .superseded, installed: true, expectedInstalled: true))
        XCTAssertFalse(
            MarketplacePluginMutationReconciliation.isConfirmed(
                .failed, installed: true, expectedInstalled: true))
        XCTAssertFalse(
            MarketplacePluginMutationReconciliation.isConfirmed(
                .applied, installed: nil, expectedInstalled: true))
        XCTAssertFalse(
            MarketplacePluginMutationReconciliation.isConfirmed(
                .applied, installed: false, expectedInstalled: true))
    }

    func testModelRequestCoordinatorRejectsOlderGetAfterMutationBegins() throws {
        var coordinator = ChatModelRequestCoordinator()
        let target = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-1")
        let get = try XCTUnwrap(coordinator.beginLoad(for: target))
        _ = coordinator.beginMutation(for: target)

        XCTAssertFalse(coordinator.canApplyLoad(get, for: target))
    }

    func testModelRequestCoordinatorRejectsGetWhileMutationIsInFlight() {
        var coordinator = ChatModelRequestCoordinator()
        let target = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-1")
        _ = coordinator.beginMutation(for: target)

        XCTAssertNil(coordinator.beginLoad(for: target))
    }

    func testModelRequestCoordinatorDrainsNewestSuppressedLoadAfterLatestMutation() throws {
        var coordinator = ChatModelRequestCoordinator()
        let target = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-1")
        let mutation = coordinator.beginMutation(for: target)
        let firstSuppressed = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-2")
        let newestSuppressed = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-3")

        XCTAssertNil(coordinator.beginLoad(for: firstSuppressed))
        XCTAssertNil(coordinator.beginLoad(for: newestSuppressed))

        let drained = try XCTUnwrap(coordinator.finishMutation(mutation))
        XCTAssertEqual(drained, newestSuppressed)
        let finalLoad = try XCTUnwrap(coordinator.beginLoad(for: drained))
        XCTAssertTrue(coordinator.canApplyLoad(finalLoad, for: drained))
        XCTAssertFalse(coordinator.canApplyLoad(finalLoad, for: target))
    }

    func testOlderMutationFinishCannotUnlockOrDrainNewerMutation() {
        var coordinator = ChatModelRequestCoordinator()
        let firstTarget = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-1")
        let latestTarget = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-2")
        let suppressedTarget = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-3")
        let first = coordinator.beginMutation(for: firstTarget)
        let latest = coordinator.beginMutation(for: latestTarget)
        XCTAssertNil(coordinator.beginLoad(for: suppressedTarget))

        XCTAssertNil(coordinator.finishMutation(first))
        XCTAssertTrue(coordinator.canApplyMutation(latest, for: latestTarget))
        XCTAssertEqual(coordinator.finishMutation(latest), suppressedTarget)
    }

    func testSupersededFinalReconciliationIsSilent() throws {
        let target = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-1")

        var supersededByLoad = ChatModelRequestCoordinator()
        let staleLoad = try XCTUnwrap(supersededByLoad.beginLoad(for: target))
        _ = try XCTUnwrap(supersededByLoad.beginLoad(for: target))
        XCTAssertEqual(
            supersededByLoad.reconciliationOutcome(for: staleLoad, currentTarget: target, failed: false),
            .superseded)

        var supersededByMutation = ChatModelRequestCoordinator()
        let finalLoad = try XCTUnwrap(supersededByMutation.beginLoad(for: target))
        _ = supersededByMutation.beginMutation(for: target)
        XCTAssertEqual(
            supersededByMutation.reconciliationOutcome(
                for: finalLoad, currentTarget: target, failed: false),
            .superseded)
        XCTAssertEqual(ChatModelReconciliationOutcome.superseded.messageDisposition, .none)
    }

    @MainActor
    func testModelMutationQueueRunsSelectionsInNetworkOrder() async {
        let queue = ChatModelMutationQueue()
        let log = EventLog()
        let firstStarted = Gate()
        let releaseFirst = Gate()

        let first = queue.enqueue {
            await log.append("A started")
            await firstStarted.open()
            await releaseFirst.wait()
            await log.append("A completed")
        }
        await firstStarted.wait()

        let second = queue.enqueue {
            await log.append("B started")
            await log.append("B completed")
        }
        let whileFirstRuns = await log.snapshot()
        XCTAssertEqual(whileFirstRuns, ["A started"])

        await releaseFirst.open()
        await first.value
        await second.value
        let completionOrder = await log.snapshot()
        XCTAssertEqual(completionOrder, ["A started", "A completed", "B started", "B completed"])
    }
}
