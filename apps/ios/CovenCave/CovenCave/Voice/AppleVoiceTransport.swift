import AVFoundation
import Speech

/// The UI layer adapts its existing `ChatThread` stream to this small seam.
/// Apple-native calls are intentionally turn-based: listen, recognize, send,
/// then speak the completed response before listening again.
@MainActor
protocol VoiceTurnSending: AnyObject {
    func sendRecognizedTurn(_ text: String, familiarId: String, sessionId: String) async throws -> VoiceTurnReply
}

struct VoiceTurnReply: Sendable {
    let segmentID: String
    let text: String
}

@MainActor
final class AppleVoiceTransport: NSObject, VoiceCallTransport, AVSpeechSynthesizerDelegate {
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
    private var userRevision = 0
    private var userSegmentID = ""

    init(turnSender: VoiceTurnSending, recognizer: SFSpeechRecognizer? = SFSpeechRecognizer()) {
        self.turnSender = turnSender
        self.recognizer = recognizer
        super.init()
        synthesizer.delegate = self
    }

    func start(with context: VoiceCallTransportContext) async throws {
        guard !active else { return }
        self.context = context
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
        responseTask?.cancel()
        responseTask = nil
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
        onEvent?(.final(role: .user, text: prompt, segmentID: userSegmentID))
        onEvent?(.processing)
        responseTask = Task { [weak self, turnSender] in
            do {
                let reply = try await turnSender.sendRecognizedTurn(prompt, familiarId: context.familiarId, sessionId: context.sessionId)
                guard !Task.isCancelled else { return }
                self?.speak(reply)
            } catch {
                guard !Task.isCancelled else { return }
                self?.reportSendFailure()
            }
        }
    }

    private func speak(_ reply: VoiceTurnReply) {
        guard active, !reply.text.isEmpty else { return }
        onEvent?(.final(role: .assistant, text: reply.text, segmentID: reply.segmentID))
        onEvent?(.speaking)
        synthesizer.speak(AVSpeechUtterance(string: reply.text))
    }

    private func reportSendFailure() {
        guard active else { return }
        onEvent?(.failed("voice_turn_send_failed"))
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
