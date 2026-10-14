import Foundation

extension CaveClient {
    struct ScheduledReplyRequest: Encodable {
        let id: String
        let sendAt: String
        let message: SendBody
    }
    struct ScheduledReply: Decodable, Identifiable {
        struct Message: Decodable { let prompt: String }
        let id: String
        let sendAt: String
        let status: String
        let message: Message
        let error: String?
        var date: Date? {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter.date(from: sendAt) ?? ISO8601DateFormatter().date(from: sendAt)
        }
        var statusLabel: String {
            switch status {
            case "scheduled": return "Scheduled"
            case "sending": return "Delivery started — check chat"
            case "sent": return "Sent"
            case "failed": return "Failed — check chat"
            case "cancelled": return "Cancelled"
            default: return "Delivery unconfirmed — check chat before sending again"
            }
        }
    }
    private struct ScheduledReplyReceipt: Decodable { struct Item: Decodable { let status: String }; let item: Item }
    private struct ScheduledRepliesResponse: Decodable { let ok: Bool; let items: [ScheduledReply] }
    private func scheduledPath(sessionId: String, id: String? = nil) -> String {
        var components = URLComponents()
        components.path = "api/chat/scheduled"
        components.queryItems = [URLQueryItem(name: "sessionId", value: sessionId)]
        if let id { components.queryItems?.append(URLQueryItem(name: "id", value: id)) }
        return components.string!
    }
    func scheduledReplies(sessionId: String) async throws -> [ScheduledReply] {
        let req = try request(scheduledPath(sessionId: sessionId))
        let (data, response) = try await data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.serverResponseError(statusCode: status, data: data) }
        return try JSONDecoder().decode(ScheduledRepliesResponse.self, from: data).items
    }
    func scheduleReply(_ value: ScheduledReplyRequest) async throws {
        let req = try request("api/chat/scheduled", method: "POST", body: JSONEncoder().encode(value))
        let (data, response) = try await data(for: req, retryingIdempotentMutation: true)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.serverResponseError(statusCode: status, data: data) }
        let receipt = try JSONDecoder().decode(ScheduledReplyReceipt.self, from: data)
        guard ["scheduled", "sending", "sent"].contains(receipt.item.status) else {
            throw CaveError.serverResponse(status: receipt.item.status == "cancelled" ? 409 : 503, code: "schedule_terminal",
                message: "This reply is \(receipt.item.status). Check the chat before scheduling again.")
        }
    }
    func cancelScheduledReply(id: String, sessionId: String) async throws {
        let req = try request(scheduledPath(sessionId: sessionId, id: id), method: "DELETE")
        let (data, response) = try await data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.serverResponseError(statusCode: status, data: data) }
    }
}
