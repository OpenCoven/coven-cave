import Foundation
import Observation

/// A message as shown in the thread UI. For group threads, assistant messages
/// carry the `familiarId` that produced them so we can attribute + colour them.
struct DisplayMessage: Identifiable, Codable, Hashable {
    /// `system` carries inline slash-command output (help, `/daemon`,
    /// results) — rendered as a centred note, never sent to a familiar.
    enum Role: String, Codable { case user, assistant, system }
    var id: String = UUID().uuidString
    var role: Role
    var familiarId: String?
    var text: String
    var streaming: Bool = false
    var isError: Bool = false
    var createdAt: Date = Date()
    /// Image attachments sent with this (user) message, as `data:` URLs.
    var attachmentDataUrls: [String] = []
    /// Composed while the desktop was unreachable; waiting for reconnect.
    /// Optional so messages persisted before offline compose still decode.
    var queued: Bool?

    var isQueued: Bool { queued == true }
}

/// Plain Codable snapshot used for on-disk persistence.
struct ThreadSnapshot: Codable, Identifiable {
    var id: String
    var title: String
    var familiarIds: [String]
    var sessionIds: [String: String]
    var messages: [DisplayMessage]
    var updatedAt: Date
    /// Optional so snapshots written before archiving existed still decode.
    var archived: Bool?
    var pinned: Bool?
    var muted: Bool?
}

/// A conversation thread. One familiar = a direct chat; several = a group.
///
/// The server has no multi-familiar concept, so a group is N parallel server
/// sessions (one `sessionId` per familiar) presented in a single UI. Sending a
/// message fans the prompt out to every familiar concurrently and streams each
/// reply into its own attributed bubble.
@Observable
@MainActor
final class ChatThread: Identifiable, Hashable {
    nonisolated static func == (lhs: ChatThread, rhs: ChatThread) -> Bool { lhs === rhs }
    nonisolated func hash(into hasher: inout Hasher) { hasher.combine(ObjectIdentifier(self)) }

    let id: String
    var title: String
    var familiarIds: [String]
    var sessionIds: [String: String]
    var messages: [DisplayMessage]
    var updatedAt: Date
    var archived: Bool = false
    var pinned: Bool = false
    var muted: Bool = false

    var isGroup: Bool { familiarIds.count > 1 }
    var activeStreams: Int { messages.filter { $0.streaming }.count }
    var isStreaming: Bool { activeStreams > 0 }

    init(id: String = UUID().uuidString,
         title: String,
         familiarIds: [String],
         sessionIds: [String: String] = [:],
         messages: [DisplayMessage] = []) {
        self.id = id
        self.title = title
        self.familiarIds = familiarIds
        self.sessionIds = sessionIds
        self.messages = messages
        self.updatedAt = Date()
    }

    convenience init(snapshot s: ThreadSnapshot) {
        self.init(id: s.id, title: s.title, familiarIds: s.familiarIds,
                  sessionIds: s.sessionIds, messages: s.messages)
        self.updatedAt = s.updatedAt
        self.archived = s.archived ?? false
        self.pinned = s.pinned ?? false
        self.muted = s.muted ?? false
    }

    var snapshot: ThreadSnapshot {
        ThreadSnapshot(id: id, title: title, familiarIds: familiarIds,
                       sessionIds: sessionIds, messages: messages,
                       updatedAt: updatedAt, archived: archived, pinned: pinned, muted: muted)
    }

    /// Send a user message and stream replies from every familiar in the thread.
    ///
    /// `displayText` lets a caller show a short label in the user bubble while
    /// sending a longer prompt to the familiar (e.g. a slash command that shows
    /// the ask but sends a fuller instruction).
    func send(_ text: String, displayText: String? = nil,
              attachments: [CaveClient.ChatAttachment] = [],
              client: CaveClient, onChange: @escaping () -> Void) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // An image with no caption is a valid prompt (the familiar reads it).
        guard !trimmed.isEmpty || !attachments.isEmpty else { return }
        let shown = (displayText?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap {
            $0.isEmpty ? nil : $0
        } ?? trimmed

        let userMessage = DisplayMessage(role: .user, familiarId: nil, text: shown,
                                         attachmentDataUrls: attachments.map(\.dataUrl))
        messages.append(userMessage)
        updatedAt = Date()
        onChange()

        for familiarId in familiarIds {
            let placeholder = DisplayMessage(role: .assistant, familiarId: familiarId,
                                             text: "", streaming: true)
            messages.append(placeholder)
            let messageId = placeholder.id
            Task { await self.stream(familiarId: familiarId, prompt: trimmed,
                                     attachments: attachments, into: messageId,
                                     userMessageId: userMessage.id,
                                     client: client, onChange: onChange) }
        }
    }

    /// Offline compose: park the prose on the thread as a `queued` user
    /// message — no placeholder bubbles, nothing touches the network. It
    /// persists with the thread and `replayQueued` sends it on the next
    /// reconnect. Prose only: slash commands never route here.
    func enqueue(_ text: String, attachments: [CaveClient.ChatAttachment] = []) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !attachments.isEmpty else { return }
        var message = DisplayMessage(role: .user, familiarId: nil, text: trimmed,
                                     attachmentDataUrls: attachments.map(\.dataUrl))
        message.queued = true
        messages.append(message)
        updatedAt = Date()
    }

    /// Send every queued (offline-composed) message through the normal
    /// fan-out, oldest first, now that the desktop is reachable. Before
    /// re-sending, ask the server whether the turn already landed — the
    /// original send may have reached it right as the transport died — and
    /// adopt the existing reply instead of doubling the turn. Sequential so
    /// turns land in compose order; a re-drop mid-replay re-queues through
    /// the stream error path and the next reconnect picks it back up.
    func replayQueued(client: CaveClient, onChange: @escaping () -> Void) async {
        guard !replayingQueued else { return }
        replayingQueued = true
        defer { replayingQueued = false }
        while let queuedMessage = messages.first(where: { $0.isQueued }) {
            let queuedId = queuedMessage.id
            let prompt = queuedMessage.text
            let attachments = Self.attachments(fromDataUrls: queuedMessage.attachmentDataUrls)
            mutate(queuedId) { $0.queued = false }
            updatedAt = Date()
            onChange()
            for familiarId in familiarIds {
                if await adoptServerTurnIfPresent(prompt: prompt, familiarId: familiarId,
                                                  client: client) {
                    onChange()
                    continue
                }
                let placeholder = DisplayMessage(role: .assistant, familiarId: familiarId,
                                                 text: "", streaming: true)
                // Replies slot in before any still-queued later prompts so the
                // transcript keeps compose order.
                let insertAt = messages.firstIndex(where: { $0.isQueued }) ?? messages.endIndex
                messages.insert(placeholder, at: insertAt)
                await stream(familiarId: familiarId, prompt: prompt,
                             attachments: attachments, into: placeholder.id,
                             userMessageId: queuedId, client: client, onChange: onChange)
                // Re-queued mid-replay (offline again) — stop; don't spin.
                if messages.first(where: { $0.id == queuedId })?.isQueued == true { return }
            }
        }
    }

    func deleteMessage(_ messageId: String) {
        messages.removeAll { $0.id == messageId }
        updatedAt = Date()
    }

    /// Re-run a failed (or the latest) assistant reply in place: reset its bubble
    /// to streaming and re-stream the SAME familiar with the prompt that produced
    /// it. Re-streaming one familiar — not `send`'s fan-out — means a single
    /// familiar's failure in a group is retried without re-firing the others, and
    /// a 1:1 retry doesn't duplicate the user prompt. No-ops if the bubble has no
    /// familiar or no preceding user prompt to replay.
    func retry(_ messageId: String, client: CaveClient, onChange: @escaping () -> Void) {
        guard let idx = messages.firstIndex(where: { $0.id == messageId }),
              messages[idx].role == .assistant,
              let familiarId = messages[idx].familiarId else { return }
        let prompt = messages[..<idx].last(where: { $0.role == .user })?.text ?? ""
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        mutate(messageId) { $0.text = ""; $0.isError = false; $0.streaming = true }
        updatedAt = Date()
        onChange()
        Task { await self.stream(familiarId: familiarId, prompt: prompt,
                                 into: messageId, client: client, onChange: onChange) }
    }

    /// Append an inline system note (slash-command output) and return its id so
    /// callers can stream into it — e.g. `/daemon`'s "running…" → result.
    @discardableResult
    func appendSystem(_ text: String, isError: Bool = false) -> String {
        let message = DisplayMessage(role: .system, familiarId: nil, text: text, isError: isError)
        messages.append(message)
        updatedAt = Date()
        return message.id
    }

    /// Replace the text of a previously-appended message (by id).
    func updateText(_ messageId: String, _ text: String, isError: Bool = false) {
        mutate(messageId) { $0.text = text; if isError { $0.isError = true } }
        updatedAt = Date()
    }

    /// Remove every message, keeping the thread (mirrors web `/clear`).
    func clearMessages() {
        messages.removeAll()
        updatedAt = Date()
    }

    /// Re-fetch this thread's conversation from the server and replace the local
    /// messages — backs pull-to-refresh, so a chat advanced on another device
    /// catches up. Direct threads only: a group is N independent sessions with no
    /// shared turn ordering to merge. Skipped while streaming (and when there's no
    /// server session yet) so an in-flight reply is never clobbered.
    /// Re-sync a direct chat from the server. No-ops for groups / streaming /
    /// unsent threads; THROWS on a real fetch failure so the caller (pull to
    /// refresh) can surface it instead of failing silently.
    func reload(client: CaveClient) async throws {
        guard !isGroup, !isStreaming,
              let familiarId = familiarIds.first,
              let sessionId = sessionIds[familiarId] else { return }
        guard let convo = try await client.conversation(sessionId: sessionId) else { return }
        messages = convo.turns.map { turn in
            let role = DisplayMessage.Role(rawValue: turn.role) ?? .assistant
            return DisplayMessage(role: role,
                                  familiarId: role == .assistant ? familiarId : nil,
                                  text: turn.text,
                                  isError: turn.isError ?? false)
        }
        updatedAt = Date()
    }

    private var replayingQueued = false

    private func stream(familiarId: String, prompt: String,
                        attachments: [CaveClient.ChatAttachment] = [], into messageId: String,
                        userMessageId: String? = nil,
                        client: CaveClient, onChange: @escaping () -> Void) async {
        // Per-send token: the server keys its resumable run buffer under this
        // (cave-h40l), so even a brand-new chat (no sessionId yet) can
        // re-attach mid-turn after a transport drop.
        let runId = UUID().uuidString
        let body = CaveClient.SendBody(familiarId: familiarId, prompt: prompt,
                                       sessionId: sessionIds[familiarId],
                                       attachments: attachments.isEmpty ? nil : attachments,
                                       runId: runId)
        var receivedAnyEvent = false
        // Resume cursor: the last applied frame's SSE id (run-buffer seq).
        var cursor = 0
        var sawDone = false
        let coalescer = StreamCoalescer()
        do {
            for try await frame in client.sendStream(body) {
                receivedAnyEvent = true
                apply(frame.event, into: messageId, familiarId: familiarId,
                      sawDone: &sawDone, coalescer: coalescer, onChange: onChange)
                if let id = frame.id { cursor = id }
            }
            flush(coalescer, into: messageId, onChange: onChange)
            mutate(messageId) { $0.streaming = false }
        } catch {
            // Transport interruption (network handoff, backgrounding, desktop
            // blip). The run is usually STILL LIVE server-side — re-attach to
            // its buffered stream first and keep rendering in real time
            // (cave-h40l). Only when no resumable run exists (finished long
            // ago / server restarted) fall back to adopting the persisted
            // transcript.
            flush(coalescer, into: messageId, onChange: onChange)
            let resumed = await resumeInterruptedStream(runId: runId, cursor: cursor,
                                                        into: messageId, familiarId: familiarId,
                                                        sawDone: &sawDone, coalescer: coalescer,
                                                        client: client, onChange: onChange)
            var recovered = resumed
            if !recovered {
                recovered = await resyncInterruptedTurn(familiarId: familiarId, prompt: prompt,
                                                        into: messageId, client: client)
            }
            if !recovered {
                if let userMessageId, !receivedAnyEvent, Self.isOfflineTransportError(error) {
                    // The send never reached the server (no route, DNS failure,
                    // refused connection — and not a single SSE event came
                    // back): queue the prompt for the next reconnect instead
                    // of dead-ending in a red bubble. Ambiguous failures
                    // (timeouts, drops after first byte) stay on the error
                    // path — replaying those could double the turn.
                    messages.removeAll { $0.id == messageId }
                    mutate(userMessageId) { $0.queued = true }
                } else {
                    mutate(messageId) {
                        if $0.text.isEmpty { $0.text = error.localizedDescription }
                        $0.isError = true; $0.streaming = false
                    }
                }
            }
        }
        updatedAt = Date()
        onChange()
    }

    /// Apply one stream event to the thread — shared by the original send
    /// stream and the mid-turn resume stream so both render identically.
    private func apply(_ event: StreamEvent, into messageId: String, familiarId: String,
                       sawDone: inout Bool, coalescer: StreamCoalescer, onChange: @escaping () -> Void) {
        switch event {
        case .session(let sid):
            if !sid.isEmpty { sessionIds[familiarId] = sid }
        case .assistantChunk(let chunk):
            // Coalesce tokens: buffer chunk text and flush to the message on a
            // short cadence instead of mutating the (observed) messages array +
            // firing onChange() on EVERY token. A fast stream can emit tokens
            // faster than a frame, and each mutate reassigns messages[idx] on an
            // @Observable class — invalidating the whole list — so per-token
            // updates caused a render/scroll storm. Coalescing flushes at most
            // ~every 50ms while keeping streaming visibly live.
            coalescer.append(chunk) { [weak self] in
                guard let self else { return }
                self.flush(coalescer, into: messageId, onChange: onChange)
            }
        case .done(let isError, let sid):
            if let sid, !sid.isEmpty { sessionIds[familiarId] = sid }
            flush(coalescer, into: messageId, onChange: onChange)
            mutate(messageId) { $0.streaming = false; if isError { $0.isError = true } }
            sawDone = true
        case .error(let message):
            flush(coalescer, into: messageId, onChange: onChange)
            mutate(messageId) {
                if $0.text.isEmpty { $0.text = message }
                $0.isError = true; $0.streaming = false
            }
        default:
            break
        }
    }

    /// Drain any buffered stream text into the message and notify observers.
    /// Idempotent: a no-op when the buffer is empty, so terminal paths can call
    /// it unconditionally.
    private func flush(_ coalescer: StreamCoalescer, into messageId: String,
                       onChange: @escaping () -> Void) {
        guard let pending = coalescer.drain() else { return }
        mutate(messageId) { $0.text += pending }
        onChange()
    }

    /// Re-attach to the still-live run after a transport drop: replay past
    /// the cursor, then tail live until the turn ends. A few short-backoff
    /// attempts ride out the network still settling (Wi-Fi handoff, tunnel
    /// re-established). Returns true when the bubble finished live; false
    /// falls back to the post-hoc transcript resync.
    private func resumeInterruptedStream(runId: String, cursor: Int, into messageId: String,
                                         familiarId: String, sawDone: inout Bool,
                                         coalescer: StreamCoalescer,
                                         client: CaveClient, onChange: @escaping () -> Void) async -> Bool {
        var nextCursor = cursor
        for attempt in 0..<3 {
            if attempt > 0 {
                try? await Task.sleep(for: .milliseconds(600 * Int64(attempt)))
            }
            do {
                for try await frame in client.resumeStream(runId: runId, cursor: nextCursor) {
                    apply(frame.event, into: messageId, familiarId: familiarId,
                          sawDone: &sawDone, coalescer: coalescer, onChange: onChange)
                    if let id = frame.id { nextCursor = id }
                }
                flush(coalescer, into: messageId, onChange: onChange)
                // The resume stream closes when the run finishes. Without a
                // done event the run may still be live (our tail dropped
                // again) — retry from the advanced cursor.
                if sawDone {
                    mutate(messageId) { $0.streaming = false }
                    return true
                }
            } catch is CaveClient.NoResumableRun {
                flush(coalescer, into: messageId, onChange: onChange)
                // Nothing buffered under that run — turn ended long ago or
                // the server restarted. Post-hoc resync owns recovery.
                return false
            } catch {
                flush(coalescer, into: messageId, onChange: onChange)
                // Transport still flaky — back off and retry from the cursor.
            }
        }
        return false
    }

    /// After a transport failure mid-stream, pull the persisted conversation
    /// and adopt the server's copy of the interrupted reply. Anchors on the
    /// prompt: the reply must be an assistant turn AFTER a final user turn
    /// carrying exactly what we sent, and must extend what already streamed
    /// into the bubble. Anything else means the reply never persisted (or
    /// belongs to an older exchange) and the caller falls back to the error
    /// path. Returns true when the bubble recovered.
    private func resyncInterruptedTurn(familiarId: String, prompt: String, into messageId: String,
                                       client: CaveClient) async -> Bool {
        guard let sessionId = sessionIds[familiarId], !sessionId.isEmpty else { return false }
        // Give the server a beat to flush the transcript after the drop.
        try? await Task.sleep(for: .milliseconds(600))
        guard let convo = try? await client.conversation(sessionId: sessionId),
              let lastUser = convo.turns.lastIndex(where: { $0.role == "user" }),
              convo.turns[lastUser].text == prompt,
              let reply = convo.turns[(lastUser + 1)...].last(where: { $0.role == "assistant" })
        else { return false }
        let streamed = messages.first(where: { $0.id == messageId })?.text ?? ""
        guard !reply.text.isEmpty, reply.text.hasPrefix(streamed) else { return false }
        mutate(messageId) {
            $0.text = reply.text
            $0.isError = reply.isError ?? false
            $0.streaming = false
        }
        return true
    }

    /// Connect-level failures where the request provably never reached the
    /// server — safe to queue without risking a duplicate turn. Anything
    /// ambiguous (timeouts, drops after first byte) is excluded: for those
    /// the resync/error path decides.
    nonisolated static func isOfflineTransportError(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost,
             .dnsLookupFailed, .networkConnectionLost, .dataNotAllowed,
             .internationalRoamingOff:
            return true
        default:
            return false
        }
    }

    /// True when the conversation's tail already carries this exact prompt —
    /// the original send made it through before the transport died, so
    /// replaying would double the turn. Adopts the server's reply (when the
    /// harness already answered) into the transcript. New sessions can't
    /// have the turn.
    private func adoptServerTurnIfPresent(prompt: String, familiarId: String,
                                          client: CaveClient) async -> Bool {
        guard let sessionId = sessionIds[familiarId], !sessionId.isEmpty else { return false }
        guard let convo = try? await client.conversation(sessionId: sessionId),
              let lastUser = convo.turns.lastIndex(where: { $0.role == "user" }),
              convo.turns[lastUser].text == prompt else { return false }
        if let reply = convo.turns[(lastUser + 1)...].last(where: { $0.role == "assistant" }) {
            let insertAt = messages.firstIndex(where: { $0.isQueued }) ?? messages.endIndex
            messages.insert(DisplayMessage(role: .assistant, familiarId: familiarId,
                                           text: reply.text, isError: reply.isError ?? false),
                            at: insertAt)
            updatedAt = Date()
        }
        return true
    }

    /// Rebuild sendable attachments from persisted `data:` URLs (the only
    /// attachment form a queued message keeps). Names are synthesized — the
    /// server only needs the mime type and payload.
    nonisolated static func attachments(fromDataUrls dataUrls: [String]) -> [CaveClient.ChatAttachment] {
        dataUrls.enumerated().map { index, dataUrl in
            let mime = dataUrl.dropFirst("data:".count).prefix(while: { $0 != ";" && $0 != "," })
            let ext = mime.split(separator: "/").last.map(String.init) ?? "png"
            return CaveClient.ChatAttachment(name: "queued-\(index + 1).\(ext)",
                                             mimeType: mime.isEmpty ? "image/png" : String(mime),
                                             dataUrl: dataUrl)
        }
    }

    private func mutate(_ messageId: String, _ body: (inout DisplayMessage) -> Void) {
        guard let idx = messages.firstIndex(where: { $0.id == messageId }) else { return }
        var message = messages[idx]
        body(&message)
        messages[idx] = message
    }
}

/// Buffers assistant stream chunks so the UI updates on a short cadence rather
/// than once per token. Each `ChatThread` mutation of the observed `messages`
/// array invalidates the whole message list, so flushing per token turned a
/// fast stream into a render/scroll storm. This accumulates text and reports
/// `shouldFlush()` at most ~every 50ms; terminal stream events drain it
/// unconditionally so the final text is always complete.
@MainActor
final class StreamCoalescer {
    private var buffer = ""
    private var flushTask: Task<Void, Never>?
    /// Max time text may sit buffered before the next flush. 50ms keeps the
    /// stream visibly live (~20 updates/sec) while collapsing token bursts.
    private let interval: Duration = .milliseconds(50)

    /// Start one delayed flush for a burst. Scheduling rather than checking
    /// elapsed time only when a new chunk arrives also drains the final chunk
    /// when a stream pauses without immediately ending.
    func append(_ chunk: String, onFlushDue: @escaping @MainActor () -> Void) {
        buffer += chunk
        guard flushTask == nil else { return }
        flushTask = Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: self.interval)
            guard !Task.isCancelled else { return }
            self.flushTask = nil
            onFlushDue()
        }
    }

    /// Returns and clears the buffered text (nil when empty), and resets the
    /// flush clock.
    func drain() -> String? {
        flushTask?.cancel()
        flushTask = nil
        guard !buffer.isEmpty else { return nil }
        let pending = buffer
        buffer = ""
        return pending
    }

    deinit { flushTask?.cancel() }
}
