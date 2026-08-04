import Foundation

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

    private let sessionId: String
    private let client: CaveClient?
    private var coordinator: VoiceCallCoordinator?

    init(familiar: Familiar, sessionId: String, client: CaveClient?) {
        self.familiar = familiar
        self.sessionId = sessionId
        self.client = client
        let mode = VoiceTransportPlanner.plan(for: familiar)
        self.plannedMode = mode
        self.state = VoiceCallState(mode: mode)
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
        coordinator?.end()
    }

    /// Rebuild a fresh coordinator and retry the transport that just failed.
    func retry() async {
        let mode = state.mode
        resetForRestart(mode: mode)
        switch mode {
        case .realtime: await startRealtime()
        case .native: await startOnDevice()
        }
    }

    /// Accept the on-device fallback after a Realtime grant couldn't be minted.
    func acceptOnDeviceFallback() async {
        resetForRestart(mode: .native)
        await startOnDevice()
    }

    // MARK: - Transport startup

    private func startRealtime() async {
        guard let client else {
            launch = .unavailable(disconnectedCopy)
            return
        }
        launch = .minting
        do {
            let response = try await client.mintVoiceSession(
                familiarId: familiar.id, sessionId: sessionId
            )
            let context = VoiceCallTransportContext(
                familiarId: familiar.id, sessionId: sessionId, grant: response.grant
            )
            await launchCoordinator(
                mode: .realtime,
                transport: OpenAIRealtimeTransport(),
                mediaSession: VoiceMediaSession(),
                context: context
            )
        } catch {
            // A grant we couldn't mint is the fallback trigger, not a dead end.
            launch = .fallbackOffer(VoiceCallCopy.mintFailureFallback(error.localizedDescription))
        }
    }

    private func startOnDevice() async {
        guard let client else {
            launch = .unavailable(disconnectedCopy)
            return
        }
        let context = VoiceCallTransportContext(
            familiarId: familiar.id, sessionId: sessionId, grant: nil
        )
        await launchCoordinator(
            mode: .native,
            transport: AppleVoiceTransport(turnSender: CaveVoiceTurnSender(client: client)),
            mediaSession: VoiceMediaSession(),
            context: context
        )
    }

    private func launchCoordinator(mode: VoiceCallMode, transport: VoiceCallTransport,
                                   mediaSession: VoiceMediaSessionManaging,
                                   context: VoiceCallTransportContext) async {
        let coordinator = VoiceCallCoordinator(
            mode: mode, transport: transport, mediaSession: mediaSession, context: context
        )
        coordinator.onStateChange = { [weak self] state in self?.state = state }
        self.coordinator = coordinator
        self.state = coordinator.state
        launch = .live
        await coordinator.start()
    }

    private func resetForRestart(mode: VoiceCallMode) {
        coordinator = nil
        state = VoiceCallState(mode: mode)
        launch = .idle
    }

    private var disconnectedCopy: VoiceCallErrorCopy {
        VoiceCallErrorCopy(
            title: "Not connected",
            message: "Connect to your desktop to start a voice call with \(familiar.displayName).",
            recovery: .dismiss,
            offersOnDeviceFallback: false
        )
    }
}
