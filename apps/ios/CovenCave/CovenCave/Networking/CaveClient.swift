import Foundation

/// REST + streaming client for the Coven Cave desktop API.
/// No auth header — trust is the Tailscale tailnet boundary.
struct CaveClient {
    var connection: CaveConnection

    private var base: URL {
        get throws {
            guard let url = connection.baseURL else { throw CaveError.notConfigured }
            return url
        }
    }

    private var session: URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        let url = try base.appendingPathComponent(path)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    // MARK: - Health

    /// Lightweight reachability probe. Hits `/api/familiars` and reports success.
    func ping() async -> Bool {
        guard let req = try? request("api/familiars") else { return false }
        do {
            let (_, resp) = try await session.data(for: req)
            return (resp as? HTTPURLResponse).map { (200..<500).contains($0.statusCode) } ?? false
        } catch {
            return false
        }
    }

    // MARK: - Familiars

    func familiars() async throws -> [Familiar] {
        let req = try request("api/familiars")
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(FamiliarsResponse.self, from: data).familiars
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    func avatarURL(for familiar: Familiar) -> URL? {
        guard let path = familiar.avatarUrl, let base = connection.baseURL else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        return URL(string: path, relativeTo: base)?.absoluteURL
    }

    // MARK: - Sessions

    func sessions(includeArchived: Bool = false) async throws -> [SessionRow] {
        let req = try request("api/sessions/list\(includeArchived ? "?includeArchived=1" : "")")
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(SessionsResponse.self, from: data).sessions
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    // MARK: - Tasks (board)

    func tasks() async throws -> [BoardCard] {
        let req = try request("api/board")
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(BoardResponse.self, from: data).cards
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    func conversation(sessionId: String) async throws -> Conversation? {
        let req = try request("api/chat/conversation/\(sessionId)")
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(ConversationResponse.self, from: data).conversation
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    // MARK: - Chat streaming

    struct SendBody: Encodable {
        var familiarId: String
        var prompt: String
        var sessionId: String?
    }

    /// Open the SSE stream for a chat send. Yields decoded `StreamEvent`s.
    func sendStream(_ body: SendBody) -> AsyncThrowingStream<StreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let payload = try JSONEncoder().encode(body)
                    var req = try request("api/chat/send", method: "POST", body: payload)
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    req.timeoutInterval = 600

                    let (bytes, resp) = try await session.bytes(for: req)
                    try Self.check(resp)

                    var dataLines: [String] = []
                    for try await line in bytes.lines {
                        let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
                        if trimmedLine.isEmpty {
                            // Blank line = event boundary. Flush accumulated data.
                            if !dataLines.isEmpty {
                                let joined = dataLines.joined(separator: "\n")
                                if let event = StreamEvent.decode(joined) {
                                    continuation.yield(event)
                                }
                                dataLines.removeAll()
                            }
                            continue
                        }
                        if trimmedLine.hasPrefix("data:") {
                            let payload = String(trimmedLine.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                            if let event = StreamEvent.decode(payload) {
                                continuation.yield(event)
                                continue
                            }
                            dataLines.append(payload)
                        }
                        // ignore other SSE fields (event:, id:, :comment)
                    }
                    // Flush any trailing event with no terminating blank line.
                    if !dataLines.isEmpty, let event = StreamEvent.decode(dataLines.joined(separator: "\n")) {
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Slash-command services

    struct DaemonStatus: Decodable {
        var running: Bool
        var apiVersion: String?
        var covenVersion: String?
        var reason: String?
        var workspacePath: String?
    }

    /// `/daemon` — desktop daemon health (`GET /api/daemon/status`).
    func daemonStatus() async throws -> DaemonStatus {
        let req = try request("api/daemon/status")
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        return try JSONDecoder().decode(DaemonStatus.self, from: data)
    }

    struct CovenExecResult: Decodable {
        var ok: Bool
        var exitCode: Int?
        var stdout: String?
        var stderr: String?
        var error: String?

        /// Combined, trimmed output for inline display.
        var output: String {
            [stdout, stderr].compactMap { $0 }
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: "\n")
        }
    }

    /// `/doctor` — run an allow-listed coven subcommand (`POST /api/coven/exec`).
    /// The server allow-lists `doctor` and `daemon`; the route can answer 5xx
    /// with a JSON body, so decode the body regardless of HTTP status.
    func covenExec(_ command: String) async throws -> CovenExecResult {
        let payload = try JSONEncoder().encode(["command": command])
        var req = try request("api/coven/exec", method: "POST", body: payload)
        req.timeoutInterval = 30
        let (data, _) = try await session.data(for: req)
        return try JSONDecoder().decode(CovenExecResult.self, from: data)
    }

    struct RouteLinkBody: Encodable {
        struct Source: Encodable {
            var kind = "slash"
            var originSessionId: String?
        }
        var url: String
        var familiar: String
        var source: Source
        var tags: [String]?
        var listHint: String?
    }

    struct RouteLinkResult: Decodable {
        var ok: Bool
        var deduped: Bool?
        var error: String?
        var item: Item?
        var classify: Classify?
        struct Item: Decodable { var title: String? }
        struct Classify: Decodable { var rule: String? }
    }

    /// `/save` — route a URL into the library (`POST /api/library/route-link`).
    func routeLink(_ body: RouteLinkBody) async throws -> RouteLinkResult {
        let payload = try JSONEncoder().encode(body)
        let req = try request("api/library/route-link", method: "POST", body: payload)
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        return try JSONDecoder().decode(RouteLinkResult.self, from: data)
    }

    // MARK: - Helpers

    private static func check(_ resp: URLResponse) throws {
        guard let http = resp as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw CaveError.badResponse(http.statusCode)
        }
    }
}
