import Foundation

/// Bridges the on-device `AppleVoiceTransport` to the existing chat stream:
/// a recognized utterance is sent through `POST /api/chat/send` and the
/// assistant's completed reply is collected from the SSE frames so the
/// synthesizer can speak it. The transport is turn-based, so collapsing the
/// stream into a single final reply matches its listen→send→speak loop.
enum VoiceTurnSendError: LocalizedError {
    case missingLaunchContext

    var errorDescription: String? {
        switch self {
        case .missingLaunchContext:
            return "voice_turn_project_required"
        }
    }
}

@MainActor
final class CaveVoiceTurnSender: VoiceTurnSending {
    private let sendStream: (CaveClient.SendBody) -> AsyncThrowingStream<CaveClient.StreamFrame, Error>

    init(client: CaveClient) {
        self.sendStream = client.sendStream
    }

    init(
        sendStream: @escaping (CaveClient.SendBody) -> AsyncThrowingStream<CaveClient.StreamFrame, Error>
    ) {
        self.sendStream = sendStream
    }

    func sendRecognizedTurn(_ text: String, familiarId: String,
                            sessionId: String?, projectRoot: String?,
                            onSessionBound: (@MainActor @Sendable (String) -> Void)? = nil) async throws -> VoiceTurnReply {
        let normalizedSessionId = sessionId?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedSessionId = normalizedSessionId?.isEmpty == false ? normalizedSessionId : nil
        let normalizedProjectRoot = projectRoot?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedProjectRoot = normalizedProjectRoot?.isEmpty == false ? normalizedProjectRoot : nil
        guard resolvedSessionId != nil || resolvedProjectRoot != nil else {
            throw VoiceTurnSendError.missingLaunchContext
        }

        let body = CaveClient.SendBody(
            familiarId: familiarId,
            prompt: text,
            sessionId: resolvedSessionId,
            projectRoot: resolvedProjectRoot,
            attachments: nil,
            runId: UUID().uuidString
        )

        var reply = ""
        var boundSessionId = resolvedSessionId
        var publishedSessionId = resolvedSessionId
        do {
            for try await frame in sendStream(body) {
                if Task.isCancelled { break }
                switch frame.event {
                case .session(let sessionId):
                    publishBoundSession(
                        sessionId,
                        boundSessionId: &boundSessionId,
                        publishedSessionId: &publishedSessionId,
                        onSessionBound: onSessionBound
                    )
                case .assistantChunk(let chunk):
                    reply += chunk
                case .assistantReplace(let full):
                    reply = full
                case .error(let message):
                    throw CaveError.transport(message)
                case .done(let isError, let sessionId, _, _, _, _, _, _, _, _, _, _, _, _, _):
                    publishBoundSession(
                        sessionId,
                        boundSessionId: &boundSessionId,
                        publishedSessionId: &publishedSessionId,
                        onSessionBound: onSessionBound
                    )
                    if isError {
                        throw CaveError.transport("The familiar could not answer this turn.")
                    }
                default:
                    break
                }
                if Task.isCancelled { break }
            }
        } catch {
            guard error is CancellationError,
                  boundSessionId != nil
            else { throw error }
        }

        return VoiceTurnReply(
            segmentID: UUID().uuidString,
            text: reply,
            sessionId: boundSessionId
        )
    }

    private func publishBoundSession(
        _ sessionId: String?,
        boundSessionId: inout String?,
        publishedSessionId: inout String?,
        onSessionBound: (@MainActor @Sendable (String) -> Void)?
    ) {
        guard let trimmed = sessionId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return }
        boundSessionId = trimmed
        guard publishedSessionId != trimmed else { return }
        publishedSessionId = trimmed
        onSessionBound?(trimmed)
    }
}
