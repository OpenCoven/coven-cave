import Foundation

/// REST + streaming client for the Coven Cave desktop API.
/// When the desktop is token-gated (COVEN_CAVE_ACCESS_TOKEN), every request —
/// REST and SSE alike — carries the paired credential as a Bearer header. This
/// is required for the Tailscale app path because it exposes the full API.
struct CaveClient {
    var connection: CaveConnection

    private var base: URL {
        get throws {
            guard let url = connection.baseURL else { throw CaveError.notConfigured }
            return url
        }
    }

    /// One shared session for REST calls. A `URLSession` is never deallocated
    /// once created, so building one per request (the old computed property)
    /// leaked sessions and re-negotiated TLS on every call; a single shared
    /// instance keeps connections pooled and warm.
    private static let restSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    /// Dedicated session for chat SSE streams. `timeoutIntervalForResource`
    /// bounds the WHOLE transfer (the per-request `timeoutInterval` only
    /// resets the idle clock), so sharing the REST session's cap silently
    /// killed any reply that streamed longer than it — long agentic turns
    /// died mid-stream at the old 60s cap. Streams get a day-long resource
    /// window; the idle timeout still catches a genuinely dead connection.
    private static let streamSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 600
        config.timeoutIntervalForResource = 24 * 3600
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    private var session: URLSession { Self.restSession }

    func data(for req: URLRequest) async throws -> (Data, URLResponse) {
        let method = (req.httpMethod ?? "GET").uppercased()
        let retryDelays: [Duration] = ["GET", "HEAD"].contains(method)
            ? [.milliseconds(350), .seconds(1)]
            : []
        for attempt in 0...retryDelays.count {
            do {
                return try await session.data(for: req)
            } catch {
                guard attempt < retryDelays.count, Self.isTransient(error) else { throw error }
                try await Task.sleep(for: retryDelays[attempt])
            }
        }
        throw CaveError.transport("Network request failed.")
    }

    private static func isTransient(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .timedOut, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost,
             .dnsLookupFailed, .notConnectedToInternet, .internationalRoamingOff,
             .callIsActive, .dataNotAllowed:
            return true
        default:
            return false
        }
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        // `appendingPathComponent` percent-encodes "?" to "%3F", which turns a
        // path like "api/journal?date=…" into a bogus path segment the server
        // 404s on. Split the query off, append only the path, then reattach the
        // query as a real query string. Callers already percent-encode values
        // (urlQuery), so set `percentEncodedQuery` to avoid double-encoding.
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let pathPart = String(parts[0])
        let queryPart = parts.count > 1 ? String(parts[1]) : nil
        var url = try base.appendingPathComponent(pathPart)
        if let queryPart, !queryPart.isEmpty {
            guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                throw CaveError.notConfigured
            }
            comps.percentEncodedQuery = queryPart
            guard let composed = comps.url else { throw CaveError.notConfigured }
            url = composed
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = CaveConnection.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    // MARK: - Pairing

    private struct TokenRefreshResponse: Decodable {
        var ok: Bool
        var token: String?
        var expiresAt: Double?
    }

    /// Rolling renewal: exchange the current credential for a fresh 30-day
    /// token. Returns the new token, or nil when the desktop has no refresh
    /// endpoint (503) or the credential can't refresh — callers treat nil as "keep
    /// using what we have".
    func refreshAccessToken() async -> String? {
        guard let req = try? request("api/mobile-token/refresh", method: "POST") else { return nil }
        guard let (data, resp) = try? await data(for: req),
              let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let decoded = try? JSONDecoder().decode(TokenRefreshResponse.self, from: data),
              decoded.ok, let token = decoded.token, !token.isEmpty
        else { return nil }
        return token
    }

    // MARK: - Health

    /// Lightweight reachability probe. Hits `/api/familiars` and reports success.
    func ping() async -> Bool {
        guard let req = try? request("api/familiars") else { return false }
        do {
            let (_, resp) = try await data(for: req)
            return (resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        } catch {
            return false
        }
    }

    // MARK: - Familiars

    func familiars() async throws -> [Familiar] {
        let req = try request("api/familiars")
        let (data, resp) = try await data(for: req)
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

    // MARK: - Operator profile

    /// The human operator's profile (name + avatar metadata) from
    /// `GET /api/profile`. Read-only on iOS; editing lives in the desktop's
    /// Settings → Profile.
    func operatorProfile() async throws -> OperatorProfile {
        let req = try request("api/profile")
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(OperatorProfileResponse.self, from: data).operatorProfile
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    /// URL for the operator's server avatar image (`GET /api/profile/avatar`),
    /// cache-busted by `updatedAt` so a new desktop upload invalidates the
    /// image. A plain image load can't set an `Authorization` header, so when
    /// the desktop enforces a mobile access token it is attached as a
    /// `coven_access_token` query param — the same credential the server
    /// accepts from the query string (server.ts). `nil` when unconfigured.
    func operatorAvatarURL(updatedAt: String?) -> URL? {
        guard let base = connection.baseURL,
              var comps = URLComponents(
                url: base.appendingPathComponent("api/profile/avatar"),
                resolvingAgainstBaseURL: false)
        else { return nil }
        var items: [URLQueryItem] = []
        if let updatedAt, !updatedAt.isEmpty {
            items.append(URLQueryItem(name: "v", value: updatedAt))
        }
        if let token = CaveConnection.accessToken {
            items.append(URLQueryItem(name: "coven_access_token", value: token))
        }
        if !items.isEmpty { comps.queryItems = items }
        return comps.url
    }

    // MARK: - Sessions

    func sessions(includeArchived: Bool = false) async throws -> [SessionRow] {
        let req = try request("api/sessions/list\(includeArchived ? "?includeArchived=1" : "")")
        let (data, resp) = try await data(for: req)
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
        let (data, resp) = try await data(for: req)
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
        let (_, resp) = try await data(for: req)
        try Self.check(resp)
    }

    private func patchTask(cardId: String, payload: Data) async throws -> BoardCard {
        let req = try request("api/board/\(cardId)", method: "PATCH", body: payload)
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        let decoded = try JSONDecoder().decode(BoardPatchResponse.self, from: data)
        if let card = decoded.card { return card }
        throw CaveError.transport(decoded.error ?? "Task update did not return a card.")
    }

    func conversation(sessionId: String) async throws -> Conversation? {
        let req = try request("api/chat/conversation/\(sessionId)")
        let (data, resp) = try await data(for: req)
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
        let (data, resp) = try await data(for: req)
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
        let (data, resp) = try await data(for: req)
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

                    let (bytes, resp) = try await Self.streamSession.bytes(for: req)
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
        let (data, resp) = try await data(for: req)
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
        let (data, _) = try await data(for: req)
        return try JSONDecoder().decode(CovenExecResult.self, from: data)
    }

    // MARK: - Theme

    /// `GET /api/theme` — the desktop's active theme + resolved colour tokens, so
    /// the app chrome can match the desktop appearance. Same connection as
    /// `api/familiars` etc.
    func fetchTheme() async throws -> ThemeSnapshot {
        let req = try request("api/theme")
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(ThemeResponse.self, from: data).theme
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    /// `PUT /api/theme` — override the desktop's active theme from the phone.
    /// Sends only `{themeId, mode}`: the phone can't resolve the desktop's
    /// `oklch` / `color-mix` tokens to hex, so it names the preset and lets the
    /// desktop adopt it and re-publish the resolved tokens — which the app then
    /// picks up on its next `fetchTheme` poll for full-fidelity chrome. Returns
    /// the saved snapshot.
    @discardableResult
    func publishTheme(themeId: String, mode: String) async throws -> ThemeSnapshot {
        struct Body: Encodable { let themeId: String; let mode: String }
        let payload = try JSONEncoder().encode(Body(themeId: themeId, mode: mode))
        let req = try request("api/theme", method: "PUT", body: payload)
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(ThemeResponse.self, from: data).theme
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    // MARK: - Reminders / inbox

    /// `GET /api/inbox` — the reminders/inbox feed, filtered to reminders.
    func reminders() async throws -> [Reminder] {
        let req = try request("api/inbox")
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(InboxResponse.self, from: data).items
                .filter { $0.kind == "reminder" }
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    /// `GET /api/journal` — the list of days that have a reflection.
    func journalDays() async throws -> [JournalDay] {
        let req = try request("api/journal")
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(JournalDaysResponse.self, from: data).days
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    /// `GET /api/journal?date=yyyy-MM-dd` — one day's reflection.
    func journalDay(date: String) async throws -> JournalEntry {
        let req = try request("api/journal?date=\(urlQuery(date))")
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(JournalDayResponse.self, from: data).entry
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    /// `POST /api/inbox` — create a reminder (used by the New Reminder App Intent).
    func createReminder(title: String, fireAt: Date) async throws {
        let iso = ISO8601DateFormatter().string(from: fireAt)
        let payload = try JSONSerialization.data(withJSONObject: [
            "kind": "reminder", "title": title, "fireAt": iso, "source": "user",
        ])
        let req = try request("api/inbox", method: "POST", body: payload)
        let (_, resp) = try await data(for: req)
        try Self.check(resp)
    }

    /// `DELETE /api/inbox/{id}` — remove a reminder.
    func deleteReminder(id: String) async throws {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let req = try request("api/inbox/\(escaped)", method: "DELETE")
        let (_, resp) = try await data(for: req)
        try Self.check(resp)
    }

    struct ReminderActionResponse: Decodable { var ok: Bool; var error: String?; var item: Reminder? }

    /// `POST /api/inbox/{id}/{action}` — done / dismiss / snooze. Returns the
    /// server's updated item when present.
    @discardableResult
    private func inboxAction(_ id: String, _ action: String, body: Data? = nil) async throws -> Reminder? {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let req = try request("api/inbox/\(escaped)/\(action)", method: "POST", body: body)
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        return try? JSONDecoder().decode(ReminderActionResponse.self, from: data).item
    }

    @discardableResult func markReminderDone(id: String) async throws -> Reminder? { try await inboxAction(id, "done") }
    @discardableResult func dismissReminder(id: String) async throws -> Reminder? { try await inboxAction(id, "dismiss") }
    @discardableResult func snoozeReminder(id: String, minutes: Int) async throws -> Reminder? {
        try await inboxAction(id, "snooze", body: try JSONEncoder().encode(["minutes": minutes]))
    }

    // MARK: - Content feed (Tweets · Repos)

    /// One OpenCoven repo from the curated star list. Mirrors the web
    /// `RepoItem` (src/lib/home-feed.ts).
    struct RepoFeedItem: Decodable, Identifiable {
        let id: String
        let fullName: String
        let description: String?
        let stars: Int
        let language: String?
        let url: String
        let pushedAt: String?
    }

    /// One post from the OpenCoven timeline (RSS-backed). Mirrors the web
    /// `TweetItem` (src/lib/home-feed.ts).
    struct TweetFeedItem: Decodable, Identifiable {
        let id: String
        let url: String
        let title: String
        let handle: String?
        let isoDate: String?
    }

    private struct ReposResponse: Decodable {
        let ok: Bool?
        let items: [RepoFeedItem]?
        let configured: Bool?
    }
    private struct TweetsResponse: Decodable {
        let ok: Bool?
        let items: [TweetFeedItem]?
    }

    /// Repos from the OpenCoven star list. `configured == false` means the
    /// desktop has no GitHub token yet (the list query needs one).
    func repos() async throws -> (items: [RepoFeedItem], configured: Bool) {
        let req = try request("api/github/repos")
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            let decoded = try JSONDecoder().decode(ReposResponse.self, from: data)
            return (decoded.items ?? [], decoded.configured ?? true)
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    /// Latest OpenCoven posts. `refresh` bypasses the desktop's short cache.
    func homeTweets(refresh: Bool = false) async throws -> [TweetFeedItem] {
        let req = try request("api/home-tweets" + (refresh ? "?refresh=1" : ""))
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(TweetsResponse.self, from: data).items ?? []
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    // MARK: - Helpers

    private static func check(_ resp: URLResponse) throws {
        guard let http = resp as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw CaveError.badResponse(http.statusCode)
        }
    }
}
