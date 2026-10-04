import Foundation

protocol ToolOutputLoading: Sendable {
    func toolOutput(sessionId: String, toolId: String) async throws -> String
}

/// Fixed display messages: never surface a server error body or decoder details.
enum ToolOutputError: Error, Equatable {
    case invalidRequest, unavailable, ambiguous, unauthorized, invalidResponse, tooLarge, transport

    var message: String {
        switch self {
        case .invalidRequest: "This tool has no valid saved-output reference. Close this sheet and reopen the chat."
        case .unavailable: "Output is not saved, is withheld, or is no longer available. Try again after the reply finishes."
        case .ambiguous: "This tool reference matches more than one call. Its output cannot be shown safely."
        case .unauthorized: "Access to this output was denied. Check your desktop connection and access."
        case .invalidResponse: "The desktop returned an unreadable output response. Try loading it again."
        case .tooLarge: "This output exceeds the display limit. Close this sheet to return to the tool summary."
        case .transport: "Output could not be loaded. Check your connection and try again."
        }
    }
}

extension CaveClient: ToolOutputLoading {
    /// Full results are transient, never part of the snapshot or shared URL cache.
    private static let toolOutputSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config, delegate: DeviceAccessRedirectGuard.shared, delegateQueue: nil)
    }()

    func toolOutput(sessionId: String, toolId: String) async throws -> String {
        guard !sessionId.isEmpty, sessionId.utf16.count <= 240,
              sessionId != ".", sessionId != "..",
              !sessionId.contains("/"), !sessionId.contains("\\"), !sessionId.contains("\0"),
              sessionId == sessionId.trimmingCharacters(in: .whitespacesAndNewlines),
              !toolId.isEmpty, toolId.utf16.count <= 256,
              toolId == toolId.trimmingCharacters(in: .whitespacesAndNewlines) else {
            throw ToolOutputError.invalidRequest
        }
        // Unreserved characters only for both values: '&', '+', '#', and '%'
        // must never change the query or point at another tool.
        let session = try Self.encodedPathSegment(sessionId)
        let tool = try Self.encodedPathSegment(toolId)
        var req = try request(
            "api/chat/conversation/\(session)/tool-output?toolId=\(tool)",
            pathIsPercentEncoded: true
        )
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let reader = CaveClient(connection: connection, session: injectedSession ?? Self.toolOutputSession)
        let (body, response) = try await reader.data(for: req)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, http.url == req.url else {
            // The shared redirect guard protects credentials. This detail read
            // also requires the response to belong to the exact requested tool.
            throw ToolOutputError.invalidResponse
        }
        switch http.statusCode {
        case 200: break
        case 400: throw ToolOutputError.invalidRequest
        case 401, 403: throw ToolOutputError.unauthorized
        case 404: throw ToolOutputError.unavailable
        case 409: throw ToolOutputError.ambiguous
        default: throw ToolOutputError.transport
        }
        // JSON escaping can expand a valid 256 KiB projected unit. Bound the
        // envelope separately, then enforce the server's UTF-8 display limit.
        guard body.count <= 2 * 1024 * 1024 else { throw ToolOutputError.tooLarge }
        struct Envelope: Decodable { let ok: Bool; let output: String }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: body), envelope.ok else {
            throw ToolOutputError.invalidResponse
        }
        guard envelope.output.utf8.count <= 256 * 1024 else { throw ToolOutputError.tooLarge }
        return envelope.output
    }
}
