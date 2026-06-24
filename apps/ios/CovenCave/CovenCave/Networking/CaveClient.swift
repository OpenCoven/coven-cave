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

    struct BoardPatchResponse: Decodable {
        var ok: Bool
        var error: String?
        var card: BoardCard?
    }

    /// Encodable that always emits `sessionId` (null when clearing) — the board
    /// patch only updates a field when its key is present in the body.
    private struct SessionPatch: Encodable {
        let sessionId: String?
        enum CodingKeys: String, CodingKey { case sessionId }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            if let sessionId { try c.encode(sessionId, forKey: .sessionId) }
            else { try c.encodeNil(forKey: .sessionId) }
        }
    }

    /// PATCH a card's linked chat session (`PATCH /api/board/{id}`). Pass nil to
    /// unlink. Returns the server's updated card.
    @discardableResult
    func updateTaskSession(cardId: String, sessionId: String?) async throws -> BoardCard {
        let payload = try JSONEncoder().encode(SessionPatch(sessionId: sessionId))
        return try await patchTask(cardId: cardId, payload: payload)
    }

    /// Fields a task edit can carry. Only the non-nil ones are sent, since the
    /// board patch updates a field only when its key is present in the body.
    struct TaskFieldsPatch: Encodable {
        var status: CardStatus?
        var priority: CardPriority?
        var steps: [CardStep]?
        var notes: String?
        enum CodingKeys: String, CodingKey { case status, priority, steps, notes }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            if let status { try c.encode(status.rawValue, forKey: .status) }
            if let priority { try c.encode(priority.rawValue, forKey: .priority) }
            if let steps { try c.encode(steps, forKey: .steps) }
            if let notes { try c.encode(notes, forKey: .notes) }
        }
    }

    /// PATCH a task's editable fields (status, priority, steps, notes). Returns
    /// the server's updated card. Pass `notes: ""` to clear the notes.
    @discardableResult
    func updateTask(cardId: String, status: CardStatus? = nil, priority: CardPriority? = nil,
                    steps: [CardStep]? = nil, notes: String? = nil) async throws -> BoardCard {
        let payload = try JSONEncoder().encode(
            TaskFieldsPatch(status: status, priority: priority, steps: steps, notes: notes))
        return try await patchTask(cardId: cardId, payload: payload)
    }

    /// PATCH a task's title.
    @discardableResult
    func updateTaskTitle(cardId: String, title: String) async throws -> BoardCard {
        let payload = try JSONSerialization.data(withJSONObject: ["title": title])
        return try await patchTask(cardId: cardId, payload: payload)
    }

    /// PATCH a task's start/due dates (date-only "yyyy-MM-dd" strings). Both keys
    /// are always sent so passing nil clears that date.
    @discardableResult
    func updateTaskDates(cardId: String, startDate: String?, endDate: String?) async throws -> BoardCard {
        let payload = try JSONSerialization.data(withJSONObject: [
            "startDate": startDate.map { $0 as Any } ?? NSNull(),
            "endDate": endDate.map { $0 as Any } ?? NSNull(),
        ])
        return try await patchTask(cardId: cardId, payload: payload)
    }

    /// `DELETE /api/board/{id}` — remove a task.
    func deleteTask(cardId: String) async throws {
        let req = try request("api/board/\(cardId)", method: "DELETE")
        let (_, resp) = try await session.data(for: req)
        try Self.check(resp)
    }

    private func patchTask(cardId: String, payload: Data) async throws -> BoardCard {
        let req = try request("api/board/\(cardId)", method: "PATCH", body: payload)
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        let decoded = try JSONDecoder().decode(BoardPatchResponse.self, from: data)
        if let card = decoded.card { return card }
        throw CaveError.transport(decoded.error ?? "Task update did not return a card.")
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

    // MARK: - Model control

    private func urlQuery(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
    }

    /// The model this chat resolves to, plus the pickable menu for its runtime.
    func chatModelState(familiarId: String, sessionId: String?) async throws -> ChatModelStateResponse {
        var path = "api/chat/model-state?familiarId=\(urlQuery(familiarId))"
        if let sessionId, !sessionId.isEmpty { path += "&sessionId=\(urlQuery(sessionId))" }
        let req = try request(path)
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(ChatModelStateResponse.self, from: data)
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    /// Set the model for this chat (`session` scope) or the familiar (`familiar-default`).
    @discardableResult
    func setChatModel(familiarId: String, sessionId: String?, model: String, scope: String) async throws -> ChatModelStateResponse {
        var body: [String: String] = ["familiarId": familiarId, "model": model, "scope": scope]
        if let sessionId, !sessionId.isEmpty { body["sessionId"] = sessionId }
        let payload = try JSONEncoder().encode(body)
        let req = try request("api/chat/model-state", method: "PATCH", body: payload)
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(ChatModelStateResponse.self, from: data)
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    // MARK: - Chat streaming

    /// An image attachment the server delivers to the familiar alongside the
    /// prompt. `dataUrl` is a `data:image/...;base64,...` string.
    struct ChatAttachment: Encodable {
        var name: String
        var mimeType: String
        var dataUrl: String
    }

    struct SendBody: Encodable {
        var familiarId: String
        var prompt: String
        var sessionId: String?
        var attachments: [ChatAttachment]?
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

    // MARK: - Theme

    /// `GET /api/theme` — the desktop's active theme + resolved colour tokens, so
    /// the app chrome can match the desktop appearance. Same connection as
    /// `api/familiars` etc.; one-way (desktop → iOS).
    func fetchTheme() async throws -> ThemeSnapshot {
        let req = try request("api/theme")
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(ThemeResponse.self, from: data).theme
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    // MARK: - Reading list (library)

    private struct ReadingListResponse: Decodable { var items: [ReadingItem] }
    private struct ReadingItemResponse: Decodable { var ok: Bool; var item: ReadingItem? }

    /// `GET /api/library/reading` — the reading list, newest first (server-sorted).
    func reading() async throws -> [ReadingItem] {
        let req = try request("api/library/reading")
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(ReadingListResponse.self, from: data).items
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    /// `GET /api/inbox` — the reminders/inbox feed, filtered to reminders.
    func reminders() async throws -> [Reminder] {
        let req = try request("api/inbox")
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(InboxResponse.self, from: data).items
                .filter { $0.kind == "reminder" }
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    /// `DELETE /api/inbox/{id}` — remove a reminder.
    func deleteReminder(id: String) async throws {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let req = try request("api/inbox/\(escaped)", method: "DELETE")
        let (_, resp) = try await session.data(for: req)
        try Self.check(resp)
    }

    struct ReminderActionResponse: Decodable { var ok: Bool; var error: String?; var item: Reminder? }

    /// `POST /api/inbox/{id}/{action}` — done / dismiss / snooze. Returns the
    /// server's updated item when present.
    @discardableResult
    private func inboxAction(_ id: String, _ action: String, body: Data? = nil) async throws -> Reminder? {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let req = try request("api/inbox/\(escaped)/\(action)", method: "POST", body: body)
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        return try? JSONDecoder().decode(ReminderActionResponse.self, from: data).item
    }

    @discardableResult func markReminderDone(id: String) async throws -> Reminder? { try await inboxAction(id, "done") }
    @discardableResult func dismissReminder(id: String) async throws -> Reminder? { try await inboxAction(id, "dismiss") }
    @discardableResult func snoozeReminder(id: String, minutes: Int) async throws -> Reminder? {
        try await inboxAction(id, "snooze", body: try JSONEncoder().encode(["minutes": minutes]))
    }

    private struct ReadingPatch: Encodable {
        var id: String
        var status: String
        var progress: Double?   // synthesised Encodable omits this when nil
    }

    /// `PATCH /api/library/reading` — change an item's status (and optionally
    /// progress). Returns the server's updated item.
    @discardableResult
    func updateReading(id: String, status: ReadingStatus, progress: Double? = nil) async throws -> ReadingItem? {
        let payload = try JSONEncoder().encode(ReadingPatch(id: id, status: status.rawValue, progress: progress))
        let req = try request("api/library/reading", method: "PATCH", body: payload)
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp)
        return try? JSONDecoder().decode(ReadingItemResponse.self, from: data).item
    }

    /// `DELETE /api/library/reading?id=…` — remove an item.
    func deleteReading(id: String) async throws {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id
        let req = try request("api/library/reading?id=\(escaped)", method: "DELETE")
        let (_, resp) = try await session.data(for: req)
        try Self.check(resp)
    }

    // MARK: - Helpers

    private static func check(_ resp: URLResponse) throws {
        guard let http = resp as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw CaveError.badResponse(http.statusCode)
        }
    }
}
