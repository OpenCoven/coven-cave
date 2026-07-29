import Foundation

/// Decodes the transcript events currently sent over OpenAI Realtime's data
/// channel. Revision is local, monotonic per provider item id, and is consumed
/// by `VoiceCallState` to reject stale delivery after a reconnect.
struct OpenAIRealtimeEventDecoder {
    private var revisions: [String: Int] = [:]
    private var partialTexts: [String: String] = [:]

    mutating func decode(json: String) throws -> VoiceCallEvent? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try decode(data: data)
    }

    mutating func decode(data: Data) throws -> VoiceCallEvent? {
        let event = try JSONDecoder().decode(Event.self, from: data)
        guard let itemID = event.itemID, !itemID.isEmpty else { return nil }
        switch event.type {
        case "conversation.item.input_audio_transcription.delta":
            return partial(role: .user, text: event.delta, itemID: itemID)
        case "conversation.item.input_audio_transcription.completed":
            return final(role: .user, text: event.transcript, itemID: itemID)
        case "response.output_audio_transcript.delta":
            return partial(role: .assistant, text: event.delta, itemID: itemID)
        case "response.output_audio_transcript.done":
            return final(role: .assistant, text: event.transcript, itemID: itemID)
        default:
            return nil
        }
    }

    private mutating func partial(role: VoiceTranscriptRole, text: String?, itemID: String) -> VoiceCallEvent? {
        guard let text, !text.isEmpty else { return nil }
        let key = "\(role.rawValue)::\(itemID)"
        let revision = (revisions[key] ?? 0) + 1
        revisions[key] = revision
        let accumulated = (partialTexts[key] ?? "") + text
        partialTexts[key] = accumulated
        return .partial(role: role, text: accumulated, segmentID: itemID, revision: revision)
    }

    private mutating func final(role: VoiceTranscriptRole, text: String?, itemID: String) -> VoiceCallEvent? {
        guard let text, !text.isEmpty else { return nil }
        let key = "\(role.rawValue)::\(itemID)"
        partialTexts.removeValue(forKey: key)
        revisions.removeValue(forKey: key)
        return .final(role: role, text: text, segmentID: itemID)
    }

    private struct Event: Decodable {
        let type: String
        let itemID: String?
        let delta: String?
        let transcript: String?

        enum CodingKeys: String, CodingKey {
            case type
            case itemID = "item_id"
            case delta
            case transcript
        }
    }
}
