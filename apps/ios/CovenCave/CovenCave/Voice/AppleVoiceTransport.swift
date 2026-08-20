import AVFoundation
import Speech

/// The UI layer adapts its existing `ChatThread` stream to this small seam.
/// Apple-native calls are intentionally turn-based: listen, recognize, send,
/// then speak the completed response before listening again.
@MainActor
protocol VoiceTurnSending: AnyObject {
    func sendRecognizedTurn(_ text: String, familiarId: String,
                            sessionId: String?, projectRoot: String?,
                            onSessionBound: (@MainActor @Sendable (String) -> Void)?) async throws -> VoiceTurnReply
}

extension VoiceTurnSending {
    func sendRecognizedTurn(_ text: String, familiarId: String,
                            sessionId: String?, projectRoot: String?) async throws -> VoiceTurnReply {
        try await sendRecognizedTurn(
            text,
            familiarId: familiarId,
            sessionId: sessionId,
            projectRoot: projectRoot,
            onSessionBound: nil
        )
    }
}

struct VoiceTurnReply: Sendable {
    let segmentID: String
    let text: String
    let sessionId: String?
}

@MainActor
final class AppleVoiceTransport: NSObject, VoiceCallTransport, AVSpeechSynthesizerDelegate {
    private static let lateReplyBindingGrace: Duration = .seconds(30)

    var onEvent: (@MainActor (VoiceCallEvent) -> Void)?

    private let recognizer: SFSpeechRecognizer?
    private let audioEngine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private let turnSender: VoiceTurnSending
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var responseTask: Task<Void, Never>?
    private var context: VoiceCallTransportContext?
    private var active = false
    private var listening = false
    private var muted = false
    private var currentSessionId: String?
    private var currentProjectRoot: String?
    private var userRevision = 0
    private var userSegmentID = ""
    private var lateReplyBindingDeadlineTask: Task<Void, Never>?

    init(turnSender: VoiceTurnSending, recognizer: SFSpeechRecognizer? = SFSpeechRecognizer()) {
        self.turnSender = turnSender
        self.recognizer = recognizer
        super.init()
        synthesizer.delegate = self
    }

    func start(with context: VoiceCallTransportContext) async throws {
        guard !active else { return }
        self.context = context
        currentSessionId = context.sessionId
        currentProjectRoot = context.projectRoot
        active = true
        onEvent?(.connected)
        beginListening()
    }

    func setMuted(_ muted: Bool) {
        self.muted = muted
        if muted { stopRecognition() }
        else if active, !synthesizer.isSpeaking { beginListening() }
    }

    func stop() {
        guard active else { return }
        active = false
        if currentSessionId != nil {
            responseTask?.cancel()
        } else {
            armLateReplyBindingDeadlineIfNeeded()
        }
        stopRecognition()
        synthesizer.stopSpeaking(at: .immediate)
        context = nil
    }

    private func beginListening() {
        guard active, !muted, !listening, let recognizer, recognizer.isAvailable else {
            if active, !muted { onEvent?(.failed("speech_recognizer_unavailable")) }
            return
        }
        userRevision = 0
        userSegmentID = UUID().uuidString
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request
        let node = audioEngine.inputNode
        let format = node.outputFormat(forBus: 0)
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            stopRecognition()
            onEvent?(.failed("speech_audio_engine_failed"))
            return
        }
        listening = true
        onEvent?(.listening)
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in self?.receiveRecognition(result: result, error: error) }
        }
    }

    private func receiveRecognition(result: SFSpeechRecognitionResult?, error: Error?) {
        guard active, listening else { return }
        if let result {
            let text = result.bestTranscription.formattedString
            if !text.isEmpty {
                userRevision += 1
                onEvent?(.partial(role: .user, text: text, segmentID: userSegmentID, revision: userRevision))
            }
            if result.isFinal { completeRecognition(text) }
        } else if error != nil {
            stopRecognition()
            onEvent?(.failed("speech_recognition_failed"))
        }
    }

    private func completeRecognition(_ text: String) {
        guard active else { return }
        let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
        stopRecognition()
        guard !prompt.isEmpty, let context else {
            if active { beginListening() }
            return
        }
        guard currentSessionId != nil || currentProjectRoot != nil else {
            reportSendFailure(VoiceTurnSendError.missingLaunchContext)
            return
        }
        onEvent?(.final(role: .user, text: prompt, segmentID: userSegmentID))
        onEvent?(.processing)
        clearLateReplyBindingDeadline()
        responseTask = Task { [weak self, turnSender] in
            defer {
                self?.clearLateReplyBindingDeadline()
                self?.responseTask = nil
            }
            do {
                let reply = try await turnSender.sendRecognizedTurn(
                    prompt,
                    familiarId: context.familiarId,
                    sessionId: self?.currentSessionId ?? context.sessionId,
                    projectRoot: self?.currentProjectRoot ?? context.projectRoot,
                    onSessionBound: { [weak self] sessionId in
                        self?.updateSessionBinding(from: sessionId)
                        self?.cancelPendingReplyAfterHangupIfNeeded()
                    }
                )
                guard !Task.isCancelled else { return }
                self?.updateSessionBinding(from: reply.sessionId)
                self?.cancelPendingReplyAfterHangupIfNeeded()
                self?.speak(reply)
            } catch {
                guard !Task.isCancelled else { return }
                self?.reportSendFailure(error)
            }
        }
    }

    private func speak(_ reply: VoiceTurnReply) {
        guard active, !reply.text.isEmpty else { return }
        onEvent?(.final(role: .assistant, text: reply.text, segmentID: reply.segmentID))
        onEvent?(.speaking)
        synthesizer.speak(AVSpeechUtterance(string: reply.text))
    }

    private func updateSessionBinding(from sessionId: String?) {
        guard let sessionId = sessionId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !sessionId.isEmpty,
              sessionId != currentSessionId
        else { return }
        currentSessionId = sessionId
        onEvent?(.sessionBound(sessionId))
    }

    private func cancelPendingReplyAfterHangupIfNeeded() {
        guard !active, currentSessionId != nil else { return }
        clearLateReplyBindingDeadline()
        responseTask?.cancel()
    }

    private func armLateReplyBindingDeadlineIfNeeded() {
        guard lateReplyBindingDeadlineTask == nil,
              responseTask != nil
        else { return }
        lateReplyBindingDeadlineTask = Task { [weak self] in
            try? await Task.sleep(for: Self.lateReplyBindingGrace)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.lateReplyBindingDeadlineTask = nil
                self?.responseTask?.cancel()
            }
        }
    }

    private func clearLateReplyBindingDeadline() {
        lateReplyBindingDeadlineTask?.cancel()
        lateReplyBindingDeadlineTask = nil
    }

    private func reportSendFailure(_ error: Error) {
        guard active else { return }
        let code: String
        if let caveError = error as? CaveError, caveError.requiresProjectSelection {
            code = VoiceTurnSendError.missingLaunchContext.errorDescription ?? "voice_turn_project_required"
        } else if let localized = error as? LocalizedError,
                  let description = localized.errorDescription,
                  description.hasPrefix("voice_turn_") {
            code = description
        } else {
            code = "voice_turn_send_failed"
        }
        onEvent?(.failed(code))
    }

    private func stopRecognition() {
        guard listening || request != nil || recognitionTask != nil else { return }
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        recognitionTask?.cancel()
        request = nil
        recognitionTask = nil
        listening = false
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in self?.beginListening() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {}
}
