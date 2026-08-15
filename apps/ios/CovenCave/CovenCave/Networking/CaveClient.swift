import Foundation

/// The minimal client surface the connection bootstrap needs — lets tests
/// drive the single-flight refresh and concurrent bootstrap without a live
/// desktop. `CaveClient` conforms with its existing methods unchanged.
protocol CaveBootstrapClient: Sendable {
    func ping() async -> Bool
    func familiars() async throws -> [Familiar]
    func fetchTheme() async throws -> ThemeSnapshot
    func operatorProfile() async throws -> OperatorProfile
}

/// REST + streaming client for the Coven Cave desktop API.
/// When the desktop is token-gated (COVEN_CAVE_ACCESS_TOKEN), every request —
/// REST and SSE alike — carries the paired credential as a Bearer header. This
/// is required for the Tailscale app path because it exposes the full API.
struct CaveClient {
    var connection: CaveConnection
    private let injectedSession: URLSession?

    init(connection: CaveConnection, session: URLSession? = nil) {
        self.connection = connection
        self.injectedSession = session
    }

    /// `POST /api/voice/session` request. The desktop resolves the familiar's
    /// provider and mints any provider credential server-side.
    struct VoiceSessionRequest: Codable, Sendable {
        var familiarId: String
        var sessionId: String
    }

    /// A prior conversation turn supplied by provider grants that need local
    /// context to continue the call.
    struct VoiceSessionSeedTurn: Codable, Sendable {
        var role: String
        var content: String
    }

    /// Provider-specific connection details. Known fields stay explicit while
    /// optional metadata lets later transports select their own connection
    /// path without teaching this client about provider secrets.
    struct VoiceSessionConnection: Codable, Sendable {
        var kind: String
        var url: String?
        var model: String?
        var voice: String?
        var familiarId: String?
        var sessionId: String?
        var voiceId: String?
        var modelId: String?
        var instructions: String?
        var conversationSeed: [VoiceSessionSeedTurn]?
    }

    /// A short-lived server-minted grant. This contains an ephemeral client
    /// secret when one is needed; it is never the desktop's OPENAI_API_KEY.
    struct VoiceSessionGrant: Codable, Sendable {
        var provider: String
        var clientSecret: String
        var expiresAt: String
        var connection: VoiceSessionConnection
    }

    /// Wire response from `POST /api/voice/session`.
    struct VoiceSessionResponse: Codable, Sendable {
        var ok: Bool
        var grant: VoiceSessionGrant?
        var callId: String?
        var error: String?
    }

    private struct VoiceSessionErrorEnvelope: Decodable {
        var error: String?
        var hint: String?
        var missingKey: String?
        var providerMessage: String?

        var message: String? {
            guard let error, !error.isEmpty else { return nil }
            let detail = hint ?? providerMessage
                ?? missingKey.map { "Missing \($0)." }
            return detail.map { "\(error): \($0)" } ?? error
        }
    }

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
        let session = injectedSession ?? self.session
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
        if let token = try CaveConnection.credentialForRequest(to: url) {
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

    // MARK: - Voice

    /// Mint a voice-call grant through Cave. The desktop keeps provider API
    /// keys in its vault; iOS receives only the short-lived response grant.
    func mintVoiceSession(familiarId: String, sessionId: String) async throws -> VoiceSessionResponse {
        let payload = try JSONEncoder().encode(
            VoiceSessionRequest(familiarId: familiarId, sessionId: sessionId)
        )
        let req = try request("api/voice/session", method: "POST", body: payload)
        let (data, resp) = try await data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            if let envelope = try? JSONDecoder().decode(VoiceSessionErrorEnvelope.self, from: data),
               let message = envelope.message {
                throw CaveError.transport(message)
            }
            try Self.check(resp)
        }
        let decoded: VoiceSessionResponse
        do {
            decoded = try JSONDecoder().decode(VoiceSessionResponse.self, from: data)
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
        try Self.check(resp)
        guard decoded.ok, decoded.grant != nil, decoded.callId != nil else {
            throw CaveError.transport(decoded.error ?? "Voice session was not granted.")
        }
        return decoded
    }

    // MARK: - Marketplace

    func marketplacePlugins() async throws -> [MarketplacePlugin] {
        let req = try request("api/marketplace")
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(MarketplaceResponse.self, from: data).plugins
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

    func marketplaceLogoURL(for plugin: MarketplacePlugin) -> URL? {
        guard let path = plugin.logo?.assetPath,
              let base = connection.baseURL,
              let resolved = URL(string: path, relativeTo: base)?.absoluteURL,
              var components = URLComponents(
                url: resolved,
                resolvingAgainstBaseURL: false)
        else { return nil }
        if let token = try? CaveConnection.credentialForRequest(to: resolved) {
            components.queryItems = [
                URLQueryItem(name: "coven_access_token", value: token),
            ]
        }
        return components.url
    }

    func installMarketplacePlugin(id: String) async throws {
        try await mutateMarketplacePlugin(path: "api/marketplace/install", id: id)
    }

    func uninstallMarketplacePlugin(id: String) async throws {
        try await mutateMarketplacePlugin(path: "api/marketplace/uninstall", id: id)
    }

    private func mutateMarketplacePlugin(path: String, id: String) async throws {
        struct Body: Encodable { let id: String }
        struct Response: Decodable { let ok: Bool; let error: String? }
        let payload = try JSONEncoder().encode(Body(id: id))
        let req = try request(path, method: "POST", body: payload)
        let (data, resp) = try await data(for: req)
        let decoded = try? JSONDecoder().decode(Response.self, from: data)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw CaveError.transport(decoded?.error ?? "The plugin change was not accepted.")
        }
        guard decoded?.ok == true else {
            throw CaveError.transport(decoded?.error ?? "The plugin change was not accepted.")
        }
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
        if let token = try? CaveConnection.credentialForRequest(to: comps.url ?? base) {
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

    /// Server-side flags a session patch can carry.
    ///
    /// The contract is that an unset field is ABSENT from the body:
    /// `/api/sessions/{id}` updates a flag only when its key is present, so
    /// sending `false` for a flag the caller never touched would silently
    /// unarchive a chat you only meant to pin. Synthesised `Encodable` already
    /// omits nil optionals, so this encoder is not correcting it — it is
    /// stating the requirement at the point it matters, so that adding a
    /// non-optional field or a `?? false` default reads as the mistake it is.
    struct SessionFlagsPatch: Encodable {
        var archived: Bool?
        var pinned: Bool?
        enum CodingKeys: String, CodingKey { case archived, pinned }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            if let archived { try c.encode(archived, forKey: .archived) }
            if let pinned { try c.encode(pinned, forKey: .pinned) }
        }
    }

    /// `PATCH /api/sessions/{id}` — archive/summon and pin/unpin. Both flags are
    /// optional; pass only what changed.
    func setSessionFlags(sessionId: String, archived: Bool? = nil, pinned: Bool? = nil) async throws {
        let escaped = sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionId
        let payload = try JSONEncoder().encode(SessionFlagsPatch(archived: archived, pinned: pinned))
        let req = try request("api/sessions/\(escaped)", method: "PATCH", body: payload)
        let (_, resp) = try await data(for: req)
        try Self.check(resp)
    }

    /// `DELETE /api/sessions/{id}` — sacrifice a session (tombstoned in cave
    /// state, so the call is idempotent and safe to retry).
    func deleteSession(sessionId: String) async throws {
        let escaped = sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionId
        let req = try request("api/sessions/\(escaped)", method: "DELETE")
        let (_, resp) = try await data(for: req)
        try Self.check(resp)
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
    /// `previewModel` is read-only and resolves controls for a staged model
    /// before a new chat has a server session or durable model intent.
    func chatModelState(
        familiarId: String,
        sessionId: String?,
        previewModel: String? = nil
    ) async throws -> ChatModelStateResponse {
        var path = "api/chat/model-state?familiarId=\(urlQuery(familiarId))"
        if let sessionId, !sessionId.isEmpty { path += "&sessionId=\(urlQuery(sessionId))" }
        if let previewModel { path += "&model=\(urlQuery(previewModel))" }
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
    func setChatModel(familiarId: String, sessionId: String?, model: String?, scope: String) async throws -> ChatModelStateResponse {
        struct Body: Encodable {
            let familiarId: String
            let sessionId: String?
            let model: String?
            let scope: String

            enum CodingKeys: String, CodingKey {
                case familiarId, sessionId, model, scope
            }

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(familiarId, forKey: .familiarId)
                try container.encodeIfPresent(sessionId, forKey: .sessionId)
                if let model {
                    try container.encode(model, forKey: .model)
                } else {
                    try container.encodeNil(forKey: .model)
                }
                try container.encode(scope, forKey: .scope)
            }
        }
        let payload = try JSONEncoder().encode(
            Body(familiarId: familiarId, sessionId: sessionId, model: model, scope: scope))
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
        var projectRoot: String?
        var attachments: [ChatAttachment]?
        /// Per-send client token (cave-h40l): the server keys its resumable
        /// run buffer under this, so a NEW chat (no sessionId yet) is still
        /// re-attachable after a transport drop.
        var runId: String? = nil
        /// Real per-send controls consumed by `/api/chat/send`.
        /// Legacy fields remain decodable/encodable for older callers and
        /// persisted turns, but new capability-aware sends leave them nil.
        /// A nil value must not become an implicit prompt-only request.
        var reasoningEffort: ChatThinkingEffort? = nil
        var responseSpeed: ChatResponseSpeed? = nil
        var modelControls: [String: String]? = nil
        /// A model selected before the first server session exists travels with
        /// the send instead of mutating the familiar's global default.
        var modelOverride: String? = nil
        var modelOverrideScope: ChatModelOverrideScope? = nil
    }

    /// One decoded SSE frame: the event plus the server's `id:` (the run
    /// buffer seq). Consumers update their resume cursor AFTER applying the
    /// event, so a drop can never skip or double a frame on resume.
    struct StreamFrame {
        let event: StreamEvent
        /// Resume cursor as of this frame — nil until the server sends ids.
        let id: Int?
    }

    private struct ServerErrorEnvelope: Decodable {
        var error: String?
        var code: String?
        var hint: String?
    }

    static let serverErrorBodyLimit = 65_536

    static func serverResponseError(statusCode: Int, data: Data) -> CaveError {
        let bounded = Data(data.prefix(serverErrorBodyLimit))
        guard let envelope = try? JSONDecoder().decode(
            ServerErrorEnvelope.self,
            from: bounded
        ) else {
            return .serverResponse(status: statusCode, code: nil, message: nil)
        }
        let message = [envelope.error, envelope.hint]
            .compactMap { value -> String? in
                guard let value else { return nil }
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
            .first
        return .serverResponse(
            status: statusCode,
            code: envelope.code,
            message: message
        )
    }

    private static func readServerErrorBody(
        from bytes: URLSession.AsyncBytes
    ) async throws -> Data {
        var body = Data()
        body.reserveCapacity(serverErrorBodyLimit)
        for try await byte in bytes {
            guard body.count < serverErrorBodyLimit else { break }
            body.append(byte)
        }
        return body
    }

    /// Open the SSE stream for a chat send. Yields decoded frames — keep the
    /// last applied frame's `id` to resume mid-turn via `resumeStream`.
    func sendStream(_ body: SendBody) -> AsyncThrowingStream<StreamFrame, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let payload = try JSONEncoder().encode(body)
                    var req = try request("api/chat/send", method: "POST", body: payload)
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    req.timeoutInterval = 600

                    let (bytes, resp) = try await Self.streamSession.bytes(for: req)
                    if let http = resp as? HTTPURLResponse,
                       !(200..<300).contains(http.statusCode) {
                        let data = try await Self.readServerErrorBody(from: bytes)
                        throw Self.serverResponseError(
                            statusCode: http.statusCode,
                            data: data
                        )
                    }

                    var parser = SSELineParser()
                    for try await line in bytes.lines {
                        if let event = parser.consume(line) {
                            continuation.yield(StreamFrame(event: event, id: parser.lastEventId))
                        }
                    }
                    // Flush any trailing event with no terminating blank line.
                    if let event = parser.flush() {
                        continuation.yield(StreamFrame(event: event, id: parser.lastEventId))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Signals `GET /api/chat/stream` had no buffered run for the key — the
    /// turn finished long ago or the server restarted. Callers fall back to
    /// the post-hoc transcript resync.
    struct NoResumableRun: Error {}

    /// Re-attach to a LIVE chat run after a transport drop (cave-h40l).
    /// Replays buffered events past `cursor` (the last applied frame id),
    /// then tails the run live; the server disarms its detach-cap kill while
    /// a tail is attached. Throws `NoResumableRun` on 404.
    func resumeStream(runId: String, cursor: Int) -> AsyncThrowingStream<StreamFrame, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var req = try request("api/chat/stream?runId=\(urlQuery(runId))&cursor=\(cursor)")
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    req.timeoutInterval = 600

                    let (bytes, resp) = try await Self.streamSession.bytes(for: req)
                    if (resp as? HTTPURLResponse)?.statusCode == 404 {
                        throw NoResumableRun()
                    }
                    try Self.check(resp)

                    var parser = SSELineParser()
                    for try await line in bytes.lines {
                        if let event = parser.consume(line) {
                            continuation.yield(StreamFrame(event: event, id: parser.lastEventId))
                        }
                    }
                    if let event = parser.flush() {
                        continuation.yield(StreamFrame(event: event, id: parser.lastEventId))
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

    /// What a bulk call actually did, per item (cave-ioswipe.2). The endpoint
    /// echoes only what it changed, so an id requested but present in NEITHER
    /// list did not take effect — that absence is the per-item failure signal,
    /// and it is why a partial failure no longer has to revert the whole batch.
    struct BulkInboxOutcome: Decodable {
        var ok: Bool
        var updated: [Reminder]
        var deletedIds: [String]

        enum CodingKeys: String, CodingKey { case ok, updated, deletedIds }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            ok = (try? c.decode(Bool.self, forKey: .ok)) ?? true
            updated = (try? c.decode([Reminder].self, forKey: .updated)) ?? []
            deletedIds = (try? c.decode([String].self, forKey: .deletedIds)) ?? []
        }
    }

    /// `POST /api/inbox/bulk` — one round trip for read/unread/dismiss/done/
    /// delete over many ids, replacing N sequential per-id calls.
    ///
    /// Snooze is deliberately NOT routed here: the endpoint has no `snooze`
    /// action and no slot for its `minutes` argument. AppModel fans that one out
    /// with bounded concurrency instead, which the bead's acceptance criteria
    /// allow ("one round trip OR bounded concurrency"). Extending the server
    /// action set is a separate, deliberate change — not something to slip in.
    func bulkInboxAction(_ action: String, ids: [String]) async throws -> BulkInboxOutcome {
        let body = try JSONSerialization.data(withJSONObject: ["action": action, "ids": ids])
        let req = try request("api/inbox/bulk", method: "POST", body: body)
        let (data, resp) = try await data(for: req)
        try Self.check(resp)
        do {
            return try JSONDecoder().decode(BulkInboxOutcome.self, from: data)
        } catch {
            throw CaveError.decoding(String(describing: error))
        }
    }

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


    // MARK: - Canvas (generated artifacts)


    // MARK: - Helpers

    private static func check(_ resp: URLResponse) throws {
        guard let http = resp as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw CaveError.badResponse(http.statusCode)
        }
    }
}

extension CaveClient: CaveBootstrapClient {}
