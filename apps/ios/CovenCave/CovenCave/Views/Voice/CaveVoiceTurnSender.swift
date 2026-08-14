import Foundation

/// Bridges the on-device `AppleVoiceTransport` to the existing chat stream:
/// a recognized utterance is sent through `POST /api/chat/send` and the
/// assistant's completed reply is collected from the SSE frames so the
/// synthesizer can speak it. The transport is turn-based, so collapsing the
/// stream into a single final reply matches its listen→send→speak loop.
@MainActor
final class CaveVoiceTurnSender: VoiceTurnSending {
    private let client: CaveClient

    init(client: CaveClient) {
        self.client = client
    }

    func sendRecognizedTurn(_ text: String, familiarId: String,
                            sessionId: String) async throws -> VoiceTurnReply {
        let body = CaveClient.SendBody(
            familiarId: familiarId,
            prompt: text,
            sessionId: sessionId.isEmpty ? nil : sessionId,
            projectRoot: nil,
            attachments: nil,
            runId: UUID().uuidString
        )

        var reply = ""
        for try await frame in client.sendStream(body) {
            switch frame.event {
            case .assistantChunk(let chunk):
                reply += chunk
            case .assistantReplace(let full):
                reply = full
            case .error(let message):
                throw CaveError.transport(message)
            case .done(let isError, _, _, _, _, _, _, _, _, _, _, _, _, _, _):
                if isError {
                    throw CaveError.transport("The familiar could not answer this turn.")
                }
            default:
                break
            }
        }

        return VoiceTurnReply(segmentID: UUID().uuidString, text: reply)
    }
}
