import Foundation

/// The voice transport selected from a familiar's published voice metadata.
enum VoiceCallMode: String, Equatable, Sendable {
    case realtime
    case native

    static func forVoiceProvider(_ provider: String?) -> VoiceCallMode {
        provider == "openai" ? .realtime : .native
    }
}

/// Observable lifecycle for a live voice call. Terminal phases never accept
/// transport callbacks again, so a stopped call cannot reactivate audio.
enum VoiceCallPhase: Equatable, Sendable {
    case idle
    case requestingPermission
    case connecting
    case listening
    case processing
    case speaking
    case error(String)
    case ended

    var isTerminal: Bool {
        switch self {
        case .error, .ended:
            true
        default:
            false
        }
    }
}

enum VoiceTranscriptRole: String, Equatable, Sendable {
    case user
    case assistant
}

/// A stable transcript identity lets SwiftUI update a partial in place rather
/// than replacing the surrounding reader content.
struct VoiceTranscriptRow: Identifiable, Equatable, Sendable {
    /// Stable UI identity derived from the transport's correlation key.
    let id: String
    /// Correlates retries and partial/final callbacks for one utterance.
    let segmentID: String
    let role: VoiceTranscriptRole
    var text: String
    var isFinal: Bool
    /// Last accepted partial revision. Lower or equal revisions are stale.
    var partialRevision: Int?

    init(segmentID: String, role: VoiceTranscriptRole, text: String,
         isFinal: Bool, partialRevision: Int? = nil) {
        self.id = "\(role.rawValue)::\(segmentID)"
        self.segmentID = segmentID
        self.role = role
        self.text = text
        self.isFinal = isFinal
        self.partialRevision = partialRevision
    }
}

/// Intent originating from the call sheet. These commands remain independent
/// from transport callbacks so either voice transport can use the same state.
enum VoiceCallCommand: Equatable, Sendable {
    case start
    case setMuted(Bool)
    case end
    case setTranscriptExpanded(Bool)
}

/// Events emitted by a voice transport or permission coordinator.
enum VoiceCallEvent: Equatable, Sendable {
    case permissionGranted
    case permissionDenied
    case connected
    case listening
    case processing
    case speaking
    case partial(role: VoiceTranscriptRole, text: String, segmentID: String, revision: Int)
    case final(role: VoiceTranscriptRole, text: String, segmentID: String)
    case failed(String)
}

/// UI-independent call state shared by the Realtime and Apple-native paths.
struct VoiceCallState: Equatable, Sendable {
    let mode: VoiceCallMode
    private(set) var phase: VoiceCallPhase = .idle
    private(set) var isMuted = false
    private(set) var isTranscriptExpanded = false
    private(set) var transcript: [VoiceTranscriptRow] = []

    init(mode: VoiceCallMode) {
        self.mode = mode
    }

    var isAudioActive: Bool {
        phase == .listening || phase == .speaking
    }

    var shouldCaptureAudio: Bool {
        phase == .listening && !isMuted
    }

    var shouldPlayAudio: Bool {
        phase == .speaking && !isMuted
    }

    mutating func send(_ command: VoiceCallCommand) {
        switch command {
        case .start where phase == .idle:
            phase = .requestingPermission
        case .setMuted(let muted) where !phase.isTerminal:
            isMuted = muted
        case .end where !phase.isTerminal:
            isMuted = true
            phase = .ended
        case .setTranscriptExpanded(let expanded):
            isTranscriptExpanded = expanded
        default:
            break
        }
    }

    mutating func receive(_ event: VoiceCallEvent) {
        guard !phase.isTerminal else { return }

        switch event {
        case .permissionGranted where phase == .requestingPermission:
            phase = .connecting
        case .permissionDenied where phase == .requestingPermission:
            fail("microphone_denied")
        case .connected where phase == .connecting:
            phase = .listening
        case .listening where phase == .connecting || phase == .processing || phase == .speaking:
            phase = .listening
        case .processing where phase == .listening:
            phase = .processing
        case .speaking where phase == .listening || phase == .processing:
            phase = .speaking
        case .partial(let role, let text, let segmentID, let revision) where acceptsTranscript:
            upsertPartial(role: role, text: text, segmentID: segmentID, revision: revision)
        case .final(let role, let text, let segmentID) where acceptsTranscript:
            finalize(role: role, text: text, segmentID: segmentID)
        case .failed(let message) where acceptsTransportFailure:
            fail(message)
        default:
            break
        }
    }

    private var acceptsTranscript: Bool {
        phase == .listening || phase == .processing || phase == .speaking
    }

    private var acceptsTransportFailure: Bool {
        phase == .requestingPermission || phase == .connecting || acceptsTranscript
    }

    private mutating func upsertPartial(role: VoiceTranscriptRole, text: String,
                                        segmentID: String, revision: Int) {
        guard !text.isEmpty, !segmentID.isEmpty else { return }

        if let index = transcript.firstIndex(where: {
            $0.role == role && $0.segmentID == segmentID
        }) {
            guard !transcript[index].isFinal else { return }
            guard revision > (transcript[index].partialRevision ?? .min) else { return }
            transcript[index].text = text
            transcript[index].partialRevision = revision
        } else {
            transcript.append(VoiceTranscriptRow(
                segmentID: segmentID, role: role, text: text, isFinal: false,
                partialRevision: revision
            ))
        }
    }

    private mutating func finalize(role: VoiceTranscriptRole, text: String,
                                   segmentID: String) {
        guard !text.isEmpty, !segmentID.isEmpty else { return }

        if let index = transcript.firstIndex(where: {
            $0.role == role && $0.segmentID == segmentID
        }) {
            guard !transcript[index].isFinal else { return }
            transcript[index].text = text
            transcript[index].isFinal = true
        } else {
            transcript.append(VoiceTranscriptRow(
                segmentID: segmentID, role: role, text: text, isFinal: true
            ))
        }
    }

    private mutating func fail(_ message: String) {
        isMuted = true
        phase = .error(message)
    }
}
