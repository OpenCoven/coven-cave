import Foundation

/// Context selected by the call sheet. Realtime receives only the short-lived
/// grant minted by Cave; the desktop vault credential never reaches iOS.
struct VoiceCallTransportContext: Sendable {
    let familiarId: String
    let sessionId: String
    let grant: CaveClient.VoiceSessionGrant?
}

@MainActor
protocol VoiceCallTransport: AnyObject {
    var onEvent: (@MainActor (VoiceCallEvent) -> Void)? { get set }
    func start(with context: VoiceCallTransportContext) async throws
    func setMuted(_ muted: Bool)
    func stop()
}

@MainActor
protocol VoiceMediaSessionManaging: AnyObject {
    var onInterruption: (@MainActor () -> Void)? { get set }
    var onRouteChange: (@MainActor () -> Void)? { get set }
    func prepare(mode: VoiceCallMode, needsSpeechRecognition: Bool) async throws
    func stop()
}

/// Owns one call's permission, audio-session, and transport lifecycle. The
/// state reducer remains the only owner of transcript revision/deduplication.
@MainActor
final class VoiceCallCoordinator {
    private(set) var state: VoiceCallState
    var onStateChange: (@MainActor (VoiceCallState) -> Void)?

    private let transport: VoiceCallTransport
    private let mediaSession: VoiceMediaSessionManaging
    private let context: VoiceCallTransportContext
    private var didCleanUp = false

    init(mode: VoiceCallMode, transport: VoiceCallTransport,
         mediaSession: VoiceMediaSessionManaging,
         context: VoiceCallTransportContext = .init(familiarId: "", sessionId: "", grant: nil)) {
        state = VoiceCallState(mode: mode)
        self.transport = transport
        self.mediaSession = mediaSession
        self.context = context
        transport.onEvent = { [weak self] event in self?.receive(event) }
        mediaSession.onInterruption = { [weak self] in self?.receive(.failed("audio_interrupted")) }
        mediaSession.onRouteChange = { [weak self] in self?.receive(.failed("audio_route_changed")) }
    }

    func start() async {
        guard state.phase == .idle else { return }
        state.send(.start)
        publish()
        do {
            try await mediaSession.prepare(mode: state.mode, needsSpeechRecognition: state.mode == .native)
            guard !state.phase.isTerminal else {
                // `end()` may have run while permission was pending. A real
                // media session can become active immediately before its async
                // prepare returns, so deactivate it again after that late return.
                mediaSession.stop()
                return
            }
            state.receive(.permissionGranted)
            publish()
            try await transport.start(with: context)
        } catch {
            if state.phase.isTerminal {
                mediaSession.stop()
                return
            }
            receive(.failed(error.localizedDescription))
        }
    }

    func setMuted(_ muted: Bool) {
        guard !state.phase.isTerminal else { return }
        state.send(.setMuted(muted))
        transport.setMuted(muted)
        publish()
    }

    func end() {
        guard !state.phase.isTerminal else { return }
        state.send(.end)
        cleanUp()
        publish()
    }

    private func receive(_ event: VoiceCallEvent) {
        guard !state.phase.isTerminal else { return }
        state.receive(event)
        if state.phase.isTerminal { cleanUp() }
        publish()
    }

    private func cleanUp() {
        guard !didCleanUp else { return }
        didCleanUp = true
        transport.onEvent = nil
        mediaSession.onInterruption = nil
        mediaSession.onRouteChange = nil
        transport.stop()
        mediaSession.stop()
    }

    private func publish() {
        onStateChange?(state)
    }
}
