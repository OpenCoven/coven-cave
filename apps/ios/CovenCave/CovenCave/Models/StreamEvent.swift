import Foundation

/// A display-text edit, never a tool execution or authority event.
struct TextOffsetCorrection: Codable {
    var after: Int
    var delta: Int

    var validated: TextOffsetCorrection? {
        guard after >= 0, after <= 9_007_199_254_740_991,
              delta >= -9_007_199_254_740_991, delta <= 9_007_199_254_740_991 else { return nil }
        return self
    }

    func rebase(_ offset: Int?) -> Int? {
        guard let offset, offset >= after, validated != nil else { return offset }
        return max(after, offset + delta)
    }

    static func decode(_ value: Any?) -> TextOffsetCorrection? {
        guard let value, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let correction = try? JSONDecoder().decode(Self.self, from: data) else { return nil }
        return correction.validated
    }
}

/// Events emitted by the `POST /api/chat/send` SSE stream.
/// Each `data:` line is one JSON object discriminated by `kind`.
enum StreamEvent {
    case session(sessionId: String)
    case user(text: String)
    case runtimeIdentity(ChatRuntimeIdentity)
    case reasoning(ChatReasoningBlock)
    case assistantChunk(text: String)
    case assistantReplace(text: String, correction: TextOffsetCorrection? = nil)
    case progress(id: String?, label: String, detail: String?, status: String?, durationMs: Int?)
    case toolUse(id: String?, name: String, input: String?, output: String?, status: String?, durationMs: Int?, activity: ToolActivity? = nil)
    case done(isError: Bool, sessionId: String?, requestedModel: String?, desiredModel: String?, forwardedModel: String?, confirmedModel: String?, modelSource: String?, modelApplicationState: String?, modelApplicationReason: String?, retryModel: String?, requestedControls: [String: String]?, forwardedControls: [String: String]?, promptGuidanceControls: [String: String]?, appliedControls: [String: String]?, rejectedControlFamilies: [String]?, runtimeIdentity: ChatRuntimeIdentity? = nil)
    case error(message: String)
    case unknown(kind: String)

    /// Decode one SSE `data:` payload into a `StreamEvent`. Returns nil for keep-alives.
    static func decode(_ json: String) -> StreamEvent? {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let kind = obj["kind"] as? String else {
            return nil
        }
        switch kind {
        case "session":
            return .session(sessionId: obj["sessionId"] as? String ?? "")
        case "user":
            return .user(text: obj["text"] as? String ?? "")
        case "response_metadata":
            let metadata = obj["responseMetadata"] as? [String: Any]
            guard let identity = ChatRuntimeIdentity.decodeMetadata(metadata) else {
                return .unknown(kind: kind)
            }
            return .runtimeIdentity(identity)
        case "reasoning":
            guard let block = ChatReasoningBlock.decode(obj["block"]) else { return .unknown(kind: kind) }
            return .reasoning(block)
        case "assistant_chunk":
            return .assistantChunk(text: obj["text"] as? String ?? "")
        case "assistant_replace":
            return .assistantReplace(text: obj["text"] as? String ?? "", correction: TextOffsetCorrection.decode(obj["toolOffsetCorrection"]))
        case "progress":
            return .progress(
                id: obj["id"] as? String,
                label: obj["label"] as? String ?? "",
                detail: obj["detail"] as? String,
                status: obj["status"] as? String,
                durationMs: obj["durationMs"] as? Int
            )
        case "tool_use":
            return .toolUse(
                id: obj["id"] as? String,
                name: obj["name"] as? String ?? "tool",
                input: obj["input"] as? String,
                output: obj["output"] as? String,
                status: obj["status"] as? String,
                durationMs: obj["durationMs"] as? Int,
                activity: ToolActivity.decode(obj["activity"], callId: obj["id"] as? String, status: obj["status"] as? String)
            )
        case "done":
            let responseMetadata = obj["responseMetadata"] as? [String: Any]
            return .done(
                isError: obj["isError"] as? Bool ?? false,
                sessionId: obj["sessionId"] as? String,
                requestedModel: responseMetadata?["requestedModel"] as? String,
                desiredModel: responseMetadata?["desiredModel"] as? String,
                forwardedModel: responseMetadata?["forwardedModel"] as? String,
                confirmedModel: responseMetadata?["confirmedModel"] as? String,
                modelSource: responseMetadata?["modelSource"] as? String,
                modelApplicationState: responseMetadata?["modelApplicationState"] as? String,
                modelApplicationReason: responseMetadata?["modelApplicationReason"] as? String,
                retryModel: responseMetadata?["retryModel"] as? String,
                requestedControls: responseMetadata?["requestedControls"] as? [String: String],
                forwardedControls: responseMetadata?["forwardedControls"] as? [String: String],
                promptGuidanceControls: responseMetadata?["promptGuidanceControls"] as? [String: String],
                appliedControls: responseMetadata?["appliedControls"] as? [String: String],
                rejectedControlFamilies: responseMetadata?["rejectedControlFamilies"] as? [String],
                runtimeIdentity: ChatRuntimeIdentity.decodeMetadata(responseMetadata)
            )
        case "error":
            return .error(message: obj["message"] as? String ?? "Unknown error")
        default:
            return .unknown(kind: kind)
        }
    }
}
