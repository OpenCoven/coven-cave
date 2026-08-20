import Foundation
import Observation

/// Owns the lifecycle of one live voice call from the UI's perspective: it
/// selects the transport from the familiar's voice metadata, mints a Realtime
/// grant when needed, builds the engine's `VoiceCallCoordinator`, and offers
/// the on-device call as a graceful fallback when a grant can't be minted.
///
/// The pure decisions (transport plan, phase→copy, error→recovery) live in
/// `VoiceTransportPlanner` / `VoiceCallCopy` so they can be tested without a
/// simulator; this type is the thin @MainActor glue that wires them to the
/// engine and the network.
@MainActor
@Observable
final class LiveVoiceCallModel {
    /// The pre-call / call lifecycle the surface renders around the engine's
    /// own `VoiceCallState`.
    enum Launch: Equatable {
        /// Nothing has started yet.
        case idle
        /// Minting a Realtime grant on the desktop, before any coordinator.
        case minting
        /// A coordinator is running; read `state.phase` for the live status.
        case live
        /// A Realtime grant could not be minted; offering the on-device call.
        case fallbackOffer(VoiceCallErrorCopy)
        /// No desktop connection at all — neither transport can run.
        case unavailable(VoiceCallErrorCopy)
    }

    let familiar: Familiar
    /// The transport the familiar's metadata asked for. The live call may run
    /// on-device instead if the operator accepts the fallback offer.
    let plannedMode: VoiceCallMode

    private(set) var launch: Launch = .idle
    private(set) var state: VoiceCallState

    private let onSessionEstablished: ((String) -> Void)?
    private let onSessionDiscarded: ((String) -> Void)?
    private let onCleanupWarning: ((String) -> Void)?
    private let client: CaveClient?
    private let makeRealtimeTransport: () -> any VoiceCallTransport
    private let makeNativeTransport: (CaveClient) -> any VoiceCallTransport
    private let makeMediaSession: () -> any VoiceMediaSessionManaging
    private var coordinator: VoiceCallCoordinator?
    private var didBindThreadSession = false
    private var autoCreatedSessionId: String?
    private var hasCommittedConversationContent = false
    @ObservationIgnored private var cleanupTask: Task<Void, Never>?

    init(
        familiar: Familiar,
        sessionId: String?,
        projectRoot: String?,
        client: CaveClient?,
        onSessionEstablished: ((String) -> Void)? = nil,
        onSessionDiscarded: ((String) -> Void)? = nil,
        onCleanupWarning: ((String) -> Void)? = nil,
        makeRealtimeTransport: (() -> any VoiceCallTransport)? = nil,
        makeNativeTransport: ((CaveClient) -> any VoiceCallTransport)? = nil,
        makeMediaSession: (() -> any VoiceMediaSessionManaging)? = nil
    ) {
        self.familiar = familiar
        self.onSessionEstablished = onSessionEstablished
        self.onSessionDiscarded = onSessionDiscarded
        self.onCleanupWarning = onCleanupWarning
        self.client = client
        self.makeRealtimeTransport = makeRealtimeTransport ?? { OpenAIRealtimeTransport() }
        self.makeNativeTransport = makeNativeTransport ?? {
            AppleVoiceTransport(turnSender: CaveVoiceTurnSender(client: $0))
        }
        self.makeMediaSession = makeMediaSession ?? { VoiceMediaSession() }
        let mode = VoiceTransportPlanner.plan(for: familiar)
        self.plannedMode = mode
        self.state = VoiceCallState(
            mode: mode,
            sessionId: Self.normalized(sessionId),
            projectRoot: Self.normalized(projectRoot)
        )
    }

    /// The mode the current (or most recent) coordinator runs. Drives the copy
    /// so a call that fell back to on-device is described as on-device.
    var activeMode: VoiceCallMode { state.mode }

    var isMuted: Bool { state.isMuted }

    func start() async {
        switch plannedMode {
        case .realtime: await startRealtime()
        case .native: await startOnDevice()
        }
    }

    func toggleMute() {
        guard let coordinator, !state.phase.isTerminal else { return }
        coordinator.setMuted(!state.isMuted)
    }

    func end() {
        if let coordinator {
            coordinator.end()
        } else if !state.phase.isTerminal {
            state.send(.end)
        }
        scheduleAutoCreatedSessionCleanupIfNeeded()
    }

    /// Rebuild a fresh coordinator and retry the transport that just failed.
    func retry() async {
        await waitForPendingCleanup()
        let mode = state.mode
        resetForRestart(mode: mode)
        switch mode {
        case .realtime: await startRealtime()
        case .native: await startOnDevice()
        }
    }

    /// Accept the on-device fallback after a Realtime grant couldn't be minted.
    func acceptOnDeviceFallback() async {
        await waitForPendingCleanup()
        resetForRestart(mode: .native)
        await startOnDevice()
    }

    func waitForPendingCleanup() async {
        await cleanupTask?.value
    }

    // MARK: - Transport startup

    private func startRealtime() async {
        guard let client else {
            launch = .unavailable(disconnectedCopy)
            return
        }
        guard let projectRoot = state.projectRoot else {
            launch = .unavailable(projectRequiredCopy)
            return
        }
        launch = .minting
        do {
            let sessionId = try await realtimeSessionID(client: client, projectRoot: projectRoot)
            let response = try await client.mintVoiceSession(
                familiarId: familiar.id, sessionId: sessionId
            )
            let context = VoiceCallTransportContext(
                familiarId: familiar.id,
                sessionId: sessionId,
                projectRoot: projectRoot,
                grant: response.grant
            )
            await launchCoordinator(
                mode: .realtime,
                transport: makeRealtimeTransport(),
                mediaSession: makeMediaSession(),
                context: context
            )
        } catch let error as CaveError where error.requiresProjectSelection {
            launch = .unavailable(projectRequiredCopy)
            scheduleAutoCreatedSessionCleanupIfNeeded()
        } catch {
            // A grant we couldn't mint is the fallback trigger, not a dead end.
            launch = .fallbackOffer(VoiceCallCopy.mintFailureFallback(error.localizedDescription))
            scheduleAutoCreatedSessionCleanupIfNeeded()
        }
    }

    private func startOnDevice() async {
        guard let client else {
            launch = .unavailable(disconnectedCopy)
            return
        }
        guard let projectRoot = state.projectRoot else {
            launch = .unavailable(projectRequiredCopy)
            return
        }
        let context = VoiceCallTransportContext(
            familiarId: familiar.id,
            sessionId: state.sessionId,
            projectRoot: projectRoot,
            grant: nil
        )
        await launchCoordinator(
            mode: .native,
            transport: makeNativeTransport(client),
            mediaSession: makeMediaSession(),
            context: context
        )
    }

    private func launchCoordinator(mode: VoiceCallMode, transport: VoiceCallTransport,
                                   mediaSession: VoiceMediaSessionManaging,
                                   context: VoiceCallTransportContext) async {
        let coordinator = VoiceCallCoordinator(
            mode: mode, transport: transport, mediaSession: mediaSession, context: context
        )
        coordinator.onStateChange = { [weak self] state in
            self?.handleCoordinatorStateChange(state)
        }
        self.coordinator = coordinator
        self.state = coordinator.state
        launch = .live
        await coordinator.start()
    }

    private func resetForRestart(mode: VoiceCallMode) {
        let retryableAutoCreatedSessionId = pendingAutoCreatedSessionIdForRestart()
        coordinator = nil
        didBindThreadSession = false
        hasCommittedConversationContent = false
        autoCreatedSessionId = retryableAutoCreatedSessionId
        state = VoiceCallState(
            mode: mode,
            sessionId: state.sessionId,
            projectRoot: state.projectRoot
        )
        launch = .idle
    }

    /// Keep tracking an empty auto-created session across retry/fallback hops
    /// until transcript content binds it or the server confirms deletion.
    private func pendingAutoCreatedSessionIdForRestart() -> String? {
        guard !hasCommittedConversationContent,
              !didBindThreadSession
        else { return nil }
        return autoCreatedSessionId
    }

    private var disconnectedCopy: VoiceCallErrorCopy {
        VoiceCallErrorCopy(
            title: "Not connected",
            message: "Connect to your desktop to start a voice call with \(familiar.displayName).",
            recovery: .dismiss,
            offersOnDeviceFallback: false
        )
    }

    private var projectRequiredCopy: VoiceCallErrorCopy {
        VoiceCallCopy.error(for: "voice_turn_project_required", mode: plannedMode)
    }

    private func realtimeSessionID(client: CaveClient, projectRoot: String) async throws -> String {
        if let sessionId = state.sessionId {
            return sessionId
        }
        let sessionId = try await client.startVoiceConversation(
            familiarId: familiar.id,
            projectRoot: projectRoot
        )
        autoCreatedSessionId = sessionId
        state.receive(.sessionBound(sessionId))
        return sessionId
    }

    private func handleCoordinatorStateChange(_ nextState: VoiceCallState) {
        state = nextState
        markConversationContentIfNeeded()
        bindThreadSessionIfNeeded()
        if nextState.phase.isTerminal {
            scheduleAutoCreatedSessionCleanupIfNeeded()
        }
    }

    private func markConversationContentIfNeeded() {
        guard !hasCommittedConversationContent,
              !state.transcript.isEmpty
        else { return }
        hasCommittedConversationContent = true
        autoCreatedSessionId = nil
    }

    private func bindThreadSessionIfNeeded() {
        guard !didBindThreadSession,
              let sessionId = state.sessionId,
              !state.transcript.isEmpty
        else { return }
        didBindThreadSession = true
        hasCommittedConversationContent = true
        autoCreatedSessionId = nil
        onSessionEstablished?(sessionId)
    }

    private func scheduleAutoCreatedSessionCleanupIfNeeded() {
        guard cleanupTask == nil,
              let sessionId = autoCreatedSessionId,
              !hasCommittedConversationContent,
              !didBindThreadSession,
              let client
        else { return }

        cleanupTask = Task { @MainActor [self, sessionId, client] in
            defer { cleanupTask = nil }
            guard autoCreatedSessionId == sessionId,
                  !hasCommittedConversationContent,
                  !didBindThreadSession
            else { return }

            do {
                let deleted = try await client.discardVoiceConversationIfEmpty(sessionId: sessionId)
                guard autoCreatedSessionId == sessionId else { return }
                guard deleted else { return }
                autoCreatedSessionId = nil
                state.clearSessionBinding(matching: sessionId)
                onSessionDiscarded?(sessionId)
            } catch {
                guard autoCreatedSessionId == sessionId else { return }
                onCleanupWarning?(Self.cleanupWarningMessage(for: error))
            }
        }
    }

    private static func cleanupWarningMessage(for error: Error) -> String {
        let detail = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        if detail.isEmpty {
            return "Couldn't discard the empty voice chat. You may still see a blank thread."
        }
        return "Couldn't discard the empty voice chat. You may still see a blank thread (\(detail))."
    }

    private static func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }
}
