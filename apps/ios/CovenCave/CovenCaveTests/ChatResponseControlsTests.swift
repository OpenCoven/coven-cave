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
            projectRoot: "/repos/cave",
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
        XCTAssertEqual(json["projectRoot"] as? String, "/repos/cave")
        XCTAssertNil(json["sessionId"])
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

    @MainActor
    func testQueuedTurnPersistsItsModelScope() throws {
        let thread = ChatThread(
            title: "Nyx chat",
            familiarIds: ["nyx"],
            sessionIds: ["nyx": "session-1"]
        )
        thread.enqueue(
            "Review the branch",
            modelOverride: "anthropic/claude-opus-4-6",
            modelOverrideScope: .nextMessage
        )

        let restored = ChatThread(snapshot: thread.snapshot)
        let queued = try XCTUnwrap(restored.messages.first)

        XCTAssertEqual(queued.modelOverride, "anthropic/claude-opus-4-6")
        XCTAssertEqual(queued.modelOverrideScope, .nextMessage)
    }

    func testServerReloadRestoresTurnControlsForRetry() throws {
        let data = try XCTUnwrap(
            """
            {
              "id": "turn-1",
              "role": "user",
              "text": "Review the branch",
              "reasoningEffort": "medium",
              "responseSpeed": "careful",
              "modelOverride": "anthropic/claude-opus-4-6"
            }
            """.data(using: .utf8)
        )
        let turn = try JSONDecoder().decode(ChatTurn.self, from: data)

        let restored = DisplayMessage.restored(from: turn, familiarId: "nyx")

        XCTAssertEqual(restored.reasoningEffort, .medium)
        XCTAssertEqual(restored.responseSpeed, .careful)
        XCTAssertEqual(restored.modelOverride, "anthropic/claude-opus-4-6")
        XCTAssertEqual(restored.retryModel(for: "nyx"), "anthropic/claude-opus-4-6")
    }

    func testDuplicatingTurnPreservesRetryControls() {
        let original = DisplayMessage(
            role: .user,
            familiarId: nil,
            text: "Review the branch",
            attachmentDataUrls: ["data:image/png;base64,AAAA"],
            reasoningEffort: .medium,
            responseSpeed: .careful,
            modelOverride: "anthropic/claude-opus-4-6",
            modelOverridesByFamiliar: [
                "nyx": "anthropic/claude-opus-4-6",
                "milo": "openai/gpt-5.6-sol",
            ]
        )

        let copied = DisplayMessage.duplicate(of: original)

        XCTAssertNotEqual(copied.id, original.id)
        XCTAssertEqual(copied.reasoningEffort, .medium)
        XCTAssertEqual(copied.responseSpeed, .careful)
        XCTAssertEqual(copied.modelOverride, "anthropic/claude-opus-4-6")
        XCTAssertEqual(copied.retryModel(for: "milo"), "openai/gpt-5.6-sol")
    }

    func testDoneMetadataCarriesTheHonestRetryModel() throws {
        let event = try XCTUnwrap(StreamEvent.decode(
            """
            {"kind":"done","isError":false,"sessionId":"session-1",
             "responseMetadata":{"retryModel":"openai/gpt-5.6-sol"}}
            """
        ))

        guard case .done(let isError, let sessionId, let retryModel) = event else {
            return XCTFail("expected done event")
        }
        XCTAssertFalse(isError)
        XCTAssertEqual(sessionId, "session-1")
        XCTAssertEqual(retryModel, "openai/gpt-5.6-sol")
    }

    func testGroupTurnRetainsOneRetryModelPerFamiliar() {
        var message = DisplayMessage(role: .user, familiarId: nil, text: "Review this")

        message.recordRetryModel("anthropic/claude-opus-4-6", for: "nyx")
        message.recordRetryModel("openai/gpt-5.6-sol", for: "milo")

        XCTAssertEqual(message.retryModel(for: "nyx"), "anthropic/claude-opus-4-6")
        XCTAssertEqual(message.retryModel(for: "milo"), "openai/gpt-5.6-sol")
    }

    func testDelayedExistingSessionPatchStillBindsImmediateTurn() {
        let confirmed = ChatModelState(
            familiarId: "nyx",
            harness: "claude",
            runtime: nil,
            effectiveModel: "anthropic/claude-sonnet-4-5",
            source: "session",
            applicationState: nil,
            reason: nil
        )

        let binding = ChatModelTurnBinding.resolve(
            pendingModel: "anthropic/claude-opus-4-6",
            confirmedState: confirmed,
            hasSession: true
        )

        XCTAssertEqual(binding.modelOverride, "anthropic/claude-opus-4-6")
        XCTAssertEqual(binding.scope, .nextMessage)
    }

    func testConfirmedSessionModelBindsSubsequentTurnsAndRetries() {
        let confirmed = ChatModelState(
            familiarId: "nyx",
            harness: "claude",
            runtime: nil,
            effectiveModel: "anthropic/claude-opus-4-6",
            source: "session",
            applicationState: nil,
            reason: nil
        )

        let binding = ChatModelTurnBinding.resolve(
            pendingModel: nil,
            confirmedState: confirmed,
            hasSession: true
        )

        XCTAssertEqual(binding.modelOverride, "anthropic/claude-opus-4-6")
        XCTAssertEqual(binding.scope, .nextMessage)
    }

    func testPreSessionModelPersistsAsSessionIntent() {
        let binding = ChatModelTurnBinding.resolve(
            pendingModel: "anthropic/claude-opus-4-6",
            confirmedState: nil,
            hasSession: false
        )

        XCTAssertEqual(binding.modelOverride, "anthropic/claude-opus-4-6")
        XCTAssertEqual(binding.scope, .session)
    }

    func testPendingModelClearsOnlyAfterMatchingSessionConfirmation() {
        let pending = "anthropic/claude-opus-4-6"
        let inherited = ChatModelState(
            familiarId: "nyx",
            harness: "claude",
            runtime: nil,
            effectiveModel: pending,
            source: "familiar-default",
            applicationState: nil,
            reason: nil
        )
        let staleSession = ChatModelState(
            familiarId: "nyx",
            harness: "claude",
            runtime: nil,
            effectiveModel: "anthropic/claude-sonnet-4-5",
            source: "session",
            applicationState: nil,
            reason: nil
        )
        let confirmedSession = ChatModelState(
            familiarId: "nyx",
            harness: "claude",
            runtime: nil,
            effectiveModel: pending,
            source: "session",
            applicationState: nil,
            reason: nil
        )

        XCTAssertFalse(ChatModelTurnBinding.shouldClearPending(
            pending,
            confirmedState: inherited,
            hasSession: true
        ))
        XCTAssertFalse(ChatModelTurnBinding.shouldClearPending(
            pending,
            confirmedState: staleSession,
            hasSession: true
        ))
        XCTAssertFalse(ChatModelTurnBinding.shouldClearPending(
            pending,
            confirmedState: confirmedSession,
            hasSession: false
        ))
        XCTAssertTrue(ChatModelTurnBinding.shouldClearPending(
            pending,
            confirmedState: confirmedSession,
            hasSession: true
        ))
    }

    func testRuntimeDefaultClearHasNoTurnOverrideAndClearsAfterConfirmation() {
        let confirmedRuntimeDefault = ChatModelState(
            familiarId: "grok",
            harness: "grok",
            runtime: nil,
            effectiveModel: "",
            source: "runtime-default",
            applicationState: nil,
            reason: nil
        )
        let staleSession = ChatModelState(
            familiarId: "grok",
            harness: "grok",
            runtime: nil,
            effectiveModel: "xai/grok-4",
            source: "session",
            applicationState: nil,
            reason: nil
        )

        let binding = ChatModelTurnBinding.resolve(
            pendingModel: "",
            confirmedState: staleSession,
            hasSession: true
        )

        XCTAssertNil(binding.modelOverride)
        XCTAssertNil(binding.scope)
        XCTAssertFalse(ChatModelTurnBinding.shouldClearPending(
            "",
            confirmedState: staleSession,
            hasSession: true
        ))
        XCTAssertTrue(ChatModelTurnBinding.shouldClearPending(
            "",
            confirmedState: confirmedRuntimeDefault,
            hasSession: true
        ))
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

    func testPluginTransportFailureCanBeConfirmedByMatchingCatalog() {
        XCTAssertEqual(
            MarketplacePluginMutationReconciliation.disposition(
                mutationFailed: true,
                catalogOutcome: .applied,
                installed: true,
                expectedInstalled: true
            ),
            .confirmed
        )
    }

    func testPluginTransportFailureWithUnchangedCatalogRemainsFailed() {
        XCTAssertEqual(
            MarketplacePluginMutationReconciliation.disposition(
                mutationFailed: true,
                catalogOutcome: .applied,
                installed: false,
                expectedInstalled: true
            ),
            .mutationFailed
        )
    }

    func testPluginRefreshFailureNeverConfirmsMutation() {
        XCTAssertEqual(
            MarketplacePluginMutationReconciliation.disposition(
                mutationFailed: false,
                catalogOutcome: .failed,
                installed: true,
                expectedInstalled: true
            ),
            .refreshFailed
        )
        XCTAssertEqual(
            MarketplacePluginMutationReconciliation.disposition(
                mutationFailed: true,
                catalogOutcome: .failed,
                installed: true,
                expectedInstalled: true
            ),
            .refreshFailed
        )
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

    func testNewerOfflineIntentSilencesOlderMutationFinish() {
        var coordinator = ChatModelRequestCoordinator()
        let target = ChatModelRequestTarget(familiarId: "nyx", sessionId: "session-1")
        let mutation = coordinator.beginMutation(for: target)

        coordinator.beginIntent(for: target)

        XCTAssertNil(coordinator.finishMutation(mutation))
        XCTAssertNotNil(coordinator.beginLoad(for: target))
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
