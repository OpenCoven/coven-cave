import AVFoundation
import Speech

enum VoiceCallMediaError: LocalizedError {
    case microphoneDenied
    case speechRecognitionDenied

    var errorDescription: String? {
        switch self {
        case .microphoneDenied: "microphone_denied"
        case .speechRecognitionDenied: "speech_recognition_denied"
        }
    }
}

/// Process-wide audio session owner for one live call. Notifications are
/// detached before deactivation, so an old route/interruption cannot revive a
/// new or already-ended coordinator.
@MainActor
final class VoiceMediaSession: VoiceMediaSessionManaging {
    var onInterruption: (@MainActor () -> Void)?
    var onRouteChange: (@MainActor () -> Void)?

    private let session: AVAudioSession
    private var observers: [NSObjectProtocol] = []

    init(session: AVAudioSession = .sharedInstance()) {
        self.session = session
    }

    func prepare(mode: VoiceCallMode, needsSpeechRecognition: Bool) async throws {
        guard await requestMicrophonePermission() else { throw VoiceCallMediaError.microphoneDenied }
        if needsSpeechRecognition, !(await requestSpeechPermission()) {
            throw VoiceCallMediaError.speechRecognitionDenied
        }

        try session.setCategory(.playAndRecord, mode: .voiceChat,
                                options: [.allowBluetoothHFP, .defaultToSpeaker])
        try session.setActive(true)
        observeAudioChanges()
    }

    func stop() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }
    }

    private func requestSpeechPermission() async -> Bool {
        let status = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        return status == .authorized
    }

    private func observeAudioChanges() {
        observers.forEach(NotificationCenter.default.removeObserver)
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
                guard let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      type == AVAudioSession.InterruptionType.began.rawValue else { return }
                Task { @MainActor in self?.onInterruption?() }
            },
            center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
                guard let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                      reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
                Task { @MainActor in self?.onRouteChange?() }
            }
        ]
    }
}
