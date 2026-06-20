import Foundation

/// Events emitted by the `POST /api/chat/send` SSE stream.
/// Each `data:` line is one JSON object discriminated by `kind`.
enum StreamEvent {
    case session(sessionId: String)
    case user(text: String)
    case assistantChunk(text: String)
    case progress(label: String, detail: String?, status: String?)
    case toolUse(id: String?, name: String, input: String?, output: String?, status: String?)
    case done(isError: Bool, sessionId: String?)
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
        case "assistant_chunk":
            return .assistantChunk(text: obj["text"] as? String ?? "")
        case "progress":
            return .progress(
                label: obj["label"] as? String ?? "",
                detail: obj["detail"] as? String,
                status: obj["status"] as? String
            )
        case "tool_use":
            return .toolUse(
                id: obj["id"] as? String,
                name: obj["name"] as? String ?? "tool",
                input: obj["input"] as? String,
                output: obj["output"] as? String,
                status: obj["status"] as? String
            )
        case "done":
            return .done(
                isError: obj["isError"] as? Bool ?? false,
                sessionId: obj["sessionId"] as? String
            )
        case "error":
            return .error(message: obj["message"] as? String ?? "Unknown error")
        default:
            return .unknown(kind: kind)
        }
    }
}
