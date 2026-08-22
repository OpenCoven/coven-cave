import Foundation
import Observation

/// A message as shown in the thread UI. For group threads, assistant messages
/// carry the `familiarId` that produced them so we can attribute + colour them.
struct DisplayMessage: Identifiable, Codable, Hashable {
    /// `system` carries inline slash-command output (help, `/daemon`,
    /// results) — rendered as a centred note, never sent to a familiar.
    enum Role: String, Codable { case user, assistant, system }
    var id: String = UUID().uuidString
    /// The server's id for this turn, when the transcript it came from was a
    /// server transcript. `id` above cannot be used for this: it is minted
    /// locally on compose and stays stable across the persisted snapshot, so
    /// overwriting it on restore would rewrite the identity every open. nil
    /// means the server has never named this message to us — a message
    /// composed in this session, a queued send, or inline slash output — and a
    /// delete of one of those has nothing to remove on the server.
    /// Optional so snapshots written before durable message delete decode.
    var serverTurnId: String?
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
    /// Per-send response controls. Optional so snapshots written before the
    /// controls shipped remain decodable and replay with current defaults.
    var reasoningEffort: ChatThinkingEffort?
    var responseSpeed: ChatResponseSpeed?
    /// Capability-aware values requested for this selected model. Legacy
    /// fields above stay readable for old snapshots only.
    var modelControls: [String: String]?
    /// Runtime-confirmed controls reported on the completed assistant turn.
    var appliedControls: [String: String]?
    var requestedControls: [String: String]?
    var forwardedControls: [String: String]?
    var promptGuidanceControls: [String: String]?
    var rejectedControlFamilies: [String]?
    /// Model application facts from the completed turn. These use the same
    /// requested/desired/confirmed vocabulary as web response metadata.
    var requestedModel: String?
    var desiredModel: String?
    var forwardedModel: String?
    var confirmedModel: String?
    var modelSource: String?
    var modelApplicationState: String?
    var modelApplicationReason: String?
    /// Explicit model selected for this turn. Persisted so offline replay and
    /// retry preserve the user's choice.
    var modelOverride: String?
    /// A group turn can fan out through different familiar/session defaults.
    /// Done metadata records the honest retry model for each reply target.
    var modelOverridesByFamiliar: [String: String]?
    /// Wire scope retained only while a queued message waits to send. Optional
    /// for snapshots written before turn-scoped model binding shipped.
    var modelOverrideScope: ChatModelOverrideScope?
    /// Agent working steps (tool calls / progress lines) surfaced while this
    /// assistant reply streamed. Optional so older persisted messages decode.
    var activity: [ActivityStep]?

    var isQueued: Bool { queued == true }
    var activitySteps: [ActivityStep] { activity ?? [] }
}

extension DisplayMessage {
    mutating func recordRetryModel(_ model: String?, for familiarId: String) {
        guard let model = model?.trimmingCharacters(in: .whitespacesAndNewlines),
              !model.isEmpty else { return }
        var models = modelOverridesByFamiliar ?? [:]
        models[familiarId] = model
        modelOverridesByFamiliar = models
    }

    func retryModel(for familiarId: String) -> String? {
        modelOverridesByFamiliar?[familiarId] ?? modelOverride
    }

    /// Rebuild one persisted server turn without dropping response controls
    /// that retry depends on.
    static func restored(from turn: ChatTurn, familiarId: String?) -> DisplayMessage {
        let role = Role(rawValue: turn.role) ?? .assistant
        // Sub-expressions are hoisted out of the initializer call deliberately:
        // inline, the two ternaries plus the nested flatMap/map closure pushed
        // this literal past the type checker's time limit and the whole target
        // failed to compile. Keep them as typed locals.
        let metadata = turn.responseMetadata
        let resolvedModel = metadata?.retryModel ?? turn.modelOverride
        let overridesByFamiliar: [String: String]? = resolvedModel.flatMap { model in
            familiarId.map { [$0: model] }
        }
        let activity: [ActivityStep]? = role == .assistant
            ? ActivityFold.steps(fromTools: turn.tools)
            : nil
        // Argument order follows DisplayMessage's stored-property order —
        // appliedControls is declared before requestedControls, and the
        // memberwise initializer requires that order.
        return DisplayMessage(
            serverTurnId: turn.id,
            role: role,
            familiarId: role == .assistant ? familiarId : nil,
            text: turn.text,
            isError: turn.isError ?? false,
            reasoningEffort: turn.reasoningEffort,
            responseSpeed: turn.responseSpeed,
            modelControls: turn.modelControls,
            appliedControls: metadata?.appliedControls,
            requestedControls: metadata?.requestedControls,
            forwardedControls: metadata?.forwardedControls,
            promptGuidanceControls: metadata?.promptGuidanceControls,
            rejectedControlFamilies: metadata?.rejectedControlFamilies,
            requestedModel: metadata?.requestedModel,
            desiredModel: metadata?.desiredModel,
            forwardedModel: metadata?.forwardedModel,
            confirmedModel: metadata?.confirmedModel,
            modelSource: metadata?.modelSource,
            modelApplicationState: metadata?.modelApplicationState,
            modelApplicationReason: metadata?.modelApplicationReason,
            modelOverride: resolvedModel,
            modelOverridesByFamiliar: overridesByFamiliar,
            modelOverrideScope: turn.modelOverrideScope,
            activity: activity
        )
    }

    /// Restore the persisted transcript and attach an assistant's authoritative
    /// retry model to the preceding user request, which owns retry inputs.
    static func restoredTranscript(from turns: [ChatTurn], familiarId: String?) -> [DisplayMessage] {
        var messages = turns.map { restored(from: $0, familiarId: familiarId) }
        for index in turns.indices where turns[index].role == "assistant" {
            guard let retryModel = turns[index].responseMetadata?.retryModel,
                  let familiarId,
                  let userIndex = messages[..<index].lastIndex(where: { $0.role == .user })
            else { continue }
            messages[userIndex].recordRetryModel(retryModel, for: familiarId)
        }
        return messages
    }

    /// Copy transcript content under a fresh message id while retaining the
    /// controls needed to retry the copied turn faithfully.
    static func duplicate(of message: DisplayMessage) -> DisplayMessage {
        DisplayMessage(
            role: message.role,
            familiarId: message.familiarId,
            text: message.text,
            isError: message.isError,
            attachmentDataUrls: message.attachmentDataUrls,
            reasoningEffort: message.reasoningEffort,
            responseSpeed: message.responseSpeed,
            modelControls: message.modelControls,
            appliedControls: message.appliedControls,
            requestedControls: message.requestedControls,
            forwardedControls: message.forwardedControls,
            promptGuidanceControls: message.promptGuidanceControls,
            rejectedControlFamilies: message.rejectedControlFamilies,
            requestedModel: message.requestedModel,
            desiredModel: message.desiredModel,
            forwardedModel: message.forwardedModel,
            confirmedModel: message.confirmedModel,
            modelSource: message.modelSource,
            modelApplicationState: message.modelApplicationState,
            modelApplicationReason: message.modelApplicationReason,
            modelOverride: message.modelOverride,
            modelOverridesByFamiliar: message.modelOverridesByFamiliar,
            modelOverrideScope: message.modelOverrideScope,
            activity: message.activity
        )
    }
}

enum ChatSendOutcome: Equatable {
    case acknowledged
    case queued
    case failed
    case cancelled
    case noAcknowledgement
}

struct ChatSendResult: Equatable {
    var familiarId: String
    var userMessageId: String?
    var assistantMessageId: String
    var outcome: ChatSendOutcome
}

enum ForwardedLandingHydrationGate {
    @MainActor
    static func shouldReload(thread: ChatThread, after result: ChatSendResult) -> Bool {
        guard result.outcome == .acknowledged,
              let userMessageId = result.userMessageId,
              let userMessage = thread.messages.first(where: { $0.id == userMessageId }),
              !userMessage.isQueued,
              let assistantMessage = thread.messages.first(where: {
                  $0.id == result.assistantMessageId
              }),
              assistantMessage.role == .assistant,
              assistantMessage.familiarId == result.familiarId,
              !assistantMessage.streaming,
              !assistantMessage.isError
        else { return false }
        return true
    }
}

/// Plain Codable snapshot used for on-disk persistence.
struct ThreadSnapshot: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var familiarIds: [String]
    var sessionIds: [String: String]
    /// Authorized launch provenance for every first turn in this thread.
    /// Optional so snapshots created before project-scoped chat still decode.
    var projectRoot: String? = nil
    var messages: [DisplayMessage]
    /// A model chosen before this thread has a server session. Optional so
    /// snapshots written before model selection shipped still decode.
    var pendingModelOverride: String?
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
    var projectRoot: String?
    /// Thread-owned so two unsent chats never share a view-local model choice.
    var pendingModelOverride: String?
    /// Structural changes (append/insert/remove/replace — here or from
    /// AppModel) re-derive the transcript rows and id index. Streamed text
    /// deltas go through `mutate`, which updates one row in place instead.
    var messages: [DisplayMessage] {
        didSet {
            guard !inPlaceMutation else { return }
            rebuildTranscript()
        }
    }
    /// Derived render model for the transcript: day dividers interleaved with
    /// messages. `ChatView` renders this directly, so separator placement is
    /// computed once per structural change, not once per body evaluation.
    private(set) var transcriptRows: [TranscriptRow] = []
    var updatedAt: Date
    var archived: Bool = false
    var pinned: Bool = false
    var muted: Bool = false
    /// Set when a pre-session send is rejected for project provenance so the
    /// UI can repair the thread without discarding the draft or transcript.
    var needsProjectSelection: Bool = false

    var isGroup: Bool { familiarIds.count > 1 }
    var activeStreams: Int { messages.filter { $0.streaming }.count }
    var isStreaming: Bool { activeStreams > 0 }

    init(id: String = UUID().uuidString,
         title: String,
         familiarIds: [String],
         sessionIds: [String: String] = [:],
         projectRoot: String? = nil,
         messages: [DisplayMessage] = [],
         pendingModelOverride: String? = nil) {
        self.id = id
        self.title = title
        self.familiarIds = familiarIds
        self.sessionIds = sessionIds
        self.projectRoot = projectRoot
        self.messages = messages
        self.pendingModelOverride = pendingModelOverride
        self.updatedAt = Date()
        rebuildTranscript()  // didSet doesn't fire during init
    }

    convenience init(snapshot s: ThreadSnapshot) {
        self.init(id: s.id, title: s.title, familiarIds: s.familiarIds,
                  sessionIds: s.sessionIds, projectRoot: s.projectRoot,
                  messages: s.messages,
                  pendingModelOverride: s.pendingModelOverride)
        self.updatedAt = s.updatedAt
        self.archived = s.archived ?? false
        self.pinned = s.pinned ?? false
        self.muted = s.muted ?? false
    }

    var snapshot: ThreadSnapshot {
        ThreadSnapshot(id: id, title: title, familiarIds: familiarIds,
                       sessionIds: sessionIds, projectRoot: projectRoot,
                       messages: messages,
                       pendingModelOverride: pendingModelOverride,
                       updatedAt: updatedAt, archived: archived, pinned: pinned, muted: muted)
    }

    /// Send a user message and stream replies from every familiar in the thread.
    ///
    /// `displayText` lets a caller show a short label in the user bubble while
    /// sending a longer prompt to the familiar (e.g. a slash command that shows
    /// the ask but sends a fuller instruction).
    func send(_ text: String, displayText: String? = nil,
              attachments: [CaveClient.ChatAttachment] = [],
              reasoningEffort: ChatThinkingEffort? = nil,
              responseSpeed: ChatResponseSpeed? = nil,
              modelControls: [String: String] = [:],
              modelOverride: String? = nil,
              modelOverrideScope: ChatModelOverrideScope? = nil,
              onStreamResult: ((ChatSendResult) -> Void)? = nil,
              client: CaveClient, onChange: @escaping () -> Void) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // An image with no caption is a valid prompt (the familiar reads it).
        guard !trimmed.isEmpty || !attachments.isEmpty else { return }
        guard requireSendProvenance(to: familiarIds) else { return }
        let shown = (displayText?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap {
            $0.isEmpty ? nil : $0
        } ?? trimmed

        let userMessage = DisplayMessage(
            role: .user, familiarId: nil, text: shown,
            attachmentDataUrls: attachments.map(\.dataUrl),
            reasoningEffort: reasoningEffort, responseSpeed: responseSpeed,
            modelControls: modelControls.isEmpty ? nil : modelControls,
            modelOverride: modelOverride,
            modelOverrideScope: modelOverrideScope)
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
                                     reasoningEffort: reasoningEffort,
                                     responseSpeed: responseSpeed,
                                     modelControls: modelControls,
                                     modelOverride: modelOverride,
                                     modelOverrideScope: modelOverrideScope ?? (modelOverride == nil ? nil : .session),
                                     client: client, onChange: onChange,
                                     onStreamResult: onStreamResult) }
        }
    }

    /// Offline compose: park the prose on the thread as a `queued` user
    /// message — no placeholder bubbles, nothing touches the network. It
    /// persists with the thread and `replayQueued` sends it on the next
    /// reconnect. Prose only: slash commands never route here.
    func enqueue(_ text: String, attachments: [CaveClient.ChatAttachment] = [],
                 reasoningEffort: ChatThinkingEffort? = nil,
                 responseSpeed: ChatResponseSpeed? = nil,
                 modelControls: [String: String] = [:],
                 modelOverride: String? = nil,
                 modelOverrideScope: ChatModelOverrideScope? = nil) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !attachments.isEmpty else { return }
        guard requireSendProvenance(to: familiarIds) else { return }
        var message = DisplayMessage(
            role: .user, familiarId: nil, text: trimmed,
            attachmentDataUrls: attachments.map(\.dataUrl),
            reasoningEffort: reasoningEffort, responseSpeed: responseSpeed,
            modelControls: modelControls.isEmpty ? nil : modelControls,
            modelOverride: modelOverride,
            modelOverrideScope: modelOverrideScope)
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
            guard requireSendProvenance(to: familiarIds) else { return }
            let queuedId = queuedMessage.id
            let prompt = queuedMessage.text
            let attachments = Self.attachments(fromDataUrls: queuedMessage.attachmentDataUrls)
            let reasoningEffort = queuedMessage.reasoningEffort
            let responseSpeed = queuedMessage.responseSpeed
            let modelControls = queuedMessage.modelControls ?? [:]
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
                             userMessageId: queuedId,
                             reasoningEffort: reasoningEffort,
                             responseSpeed: responseSpeed,
                             modelControls: modelControls,
                             modelOverride: queuedMessage.modelOverride,
                             modelOverrideScope: queuedMessage.modelOverrideScope ?? (queuedMessage.modelOverride == nil ? nil : .session),
                             client: client, onChange: onChange)
                // Re-queued mid-replay (offline again) — stop; don't spin.
                if messages.first(where: { $0.id == queuedId })?.isQueued == true { return }
            }
        }
    }

    /// Remove one message — durably, wherever the server has a copy of it.
    ///
    /// This used to be an array splice and nothing else: iOS dropped the
    /// message from its in-memory thread, rewrote its own snapshot file, and
    /// told nobody. The message came back on reinstall and never disappeared
    /// on any other client. `DELETE /api/chat/conversation/{id}/turns/{turnId}`
    /// is the server half; this is the client half.
    ///
    /// Optimistic, because a delete that waits on the tailnet reads as a
    /// broken swipe. If the server refuses, the message goes back at the index
    /// it left from — not appended — and the failure is said out loud as an
    /// inline note. A silent local-only delete is the exact bug being fixed,
    /// so failing quietly here would only move it.
    func deleteMessage(_ messageId: String, client: CaveClient?,
                       onChange: @escaping () -> Void) {
        guard let index = messages.firstIndex(where: { $0.id == messageId }) else { return }
        let removed = messages[index]
        // Resolved BEFORE the removal: the ordinal is this message's position
        // among the turns the server can see, and removing it first would
        // shift every later message onto the wrong turn.
        let target = serverDeleteTarget(for: removed, at: index)
        // No client and a message the server owns: refuse rather than remove.
        // Removing here would be a local-only delete with nothing left to
        // report it later — the original bug, reached by a different door.
        guard client != nil || target == nil else {
            appendSystem("That message can't be deleted while the desktop is unreachable.",
                         isError: true)
            updatedAt = Date()
            onChange()
            return
        }
        messages.remove(at: index)
        updatedAt = Date()
        onChange()

        guard let client, let target else { return }
        // One at a time, per thread. A second swipe lands well inside the
        // first request, and a message with no server id is named by reading
        // the conversation — a read that would still be showing the turn the
        // first delete is in the middle of removing. Its transcript then
        // disagrees with ours, which is a refusal, so the second delete of a
        // two-swipe cleanup would fail for no reason but timing. Chaining
        // costs nothing visible: the bubble is already gone by here.
        let previous = pendingServerDelete
        pendingServerDelete = Task { [weak self] in
            _ = await previous?.value
            await self?.persistDelete(of: removed, at: index, target: target,
                                      client: client, onChange: onChange)
        }
    }

    /// The tail of this thread's serialized server deletes. Nothing renders
    /// it, so it stays out of observation. See `deleteMessage`.
    @ObservationIgnored private var pendingServerDelete: Task<Void, Never>?

    /// Where a message lives on the server, when it lives there at all.
    ///
    /// Deliberately narrow, and the group exclusion is load-bearing rather
    /// than incidental: a group is N independent server sessions presented as
    /// one transcript, so `familiarIds.first` names an arbitrary one of them
    /// and a position in the merged local list answers to no position in any
    /// of their turn lists. A direct chat is the only shape with one session
    /// to address. Group messages also mostly carry no server turn id —
    /// `reload` no-ops for groups and `AppModel.loadHistory` only ever runs
    /// against a thread it built with a single familiar — but replay CAN
    /// adopt one, so it is the guard below that holds, not the absence of an
    /// id.
    ///
    /// A queued send, inline slash output, and a thread with no session yet
    /// have nothing on the server to remove either, and for those the local
    /// removal is already the whole truth.
    private func serverDeleteTarget(for message: DisplayMessage,
                                    at index: Int) -> ServerDeleteTarget? {
        guard !isGroup, !message.isQueued,
              // Inline slash output is local-only — but a `system` turn the
              // server named on a restore is a real turn there (the server
              // persists chain-less system turns) and deletes like any other.
              // Refusing every system message would leave those undeletable
              // by the silent local splice this whole path exists to end.
              message.role != .system || message.serverTurnId != nil,
              let familiarId = familiarIds.first,
              let sessionId = sessionIds[familiarId], !sessionId.isEmpty else { return nil }
        // Messages the server never receives do not occupy a turn, so they
        // must not be counted when locating one. Kept whole rather than
        // counted: naming a turn by position is only safe if the positions
        // before it can be checked against the server's own transcript.
        let preceding = messages[..<index].filter { Self.occupiesServerTurn($0) }
        return ServerDeleteTarget(sessionId: sessionId, turnId: message.serverTurnId,
                                  preceding: preceding)
    }

    private struct ServerDeleteTarget {
        let sessionId: String
        /// Known only for a message the server has already named to us — on a
        /// restore, or on the replay that adopted a reply the server had.
        let turnId: String?
        /// Every local message before this one that occupies a server turn,
        /// in order. Its COUNT is the ordinal used to name a message composed
        /// in this session — one that has never been through a restore and so
        /// carries no `serverTurnId` — and its contents are what proves that
        /// ordinal actually lines up with the server's transcript.
        let preceding: [DisplayMessage]
    }

    /// Does this message hold a position in the server's turn list?
    ///
    /// A message the server named on a restore does, whatever its role: a
    /// restored `system` turn sits in `conversation.turns` like any other, and
    /// skipping it here would shift every later ordinal one turn early. A
    /// message the server never named counts only if it is the kind that gets
    /// sent — inline slash output and a queued send never become turns.
    nonisolated private static func occupiesServerTurn(_ message: DisplayMessage) -> Bool {
        if message.serverTurnId != nil { return true }
        return message.role != .system && !message.isQueued
    }

    private func persistDelete(of message: DisplayMessage, at index: Int,
                               target: ServerDeleteTarget, client: CaveClient,
                               onChange: @escaping () -> Void) async {
        let turnId: String
        if let known = target.turnId, !known.isEmpty {
            turnId = known
        } else {
            // A message composed in this session has no server-assigned id
            // yet, and nothing in the send path hands one back. Reading the
            // conversation is the only way to name the turn — and the read
            // has THREE outcomes a `try?` collapses into one:
            //
            //  - it THROWS 404: `GET /api/chat/conversation/{id}` answers 404
            //    when the server holds no transcript for this chat (see that
            //    route's final `not found`). The desktop was reached and told
            //    us it has nothing, so the local removal was already the whole
            //    delete. Blaming the network here would be a lie AND would put
            //    back a message no server copy will ever resurrect.
            //  - it THROWS anything else: a real failure, report it.
            //  - it RETURNS nil: same answer as the 404, reached through the
            //    narrow `conversation: null` shape the route uses when a board
            //    card claims the session but no transcript exists yet.
            let convo: Conversation?
            do {
                convo = try await client.conversation(sessionId: target.sessionId)
            } catch CaveError.badResponse(404) {
                return
            } catch {
                rollBack(message, to: index, reason: error.localizedDescription,
                         onChange: onChange)
                return
            }
            guard let convo else { return }
            switch Self.turnMatch(for: message, following: target.preceding, in: convo.turns) {
            case .named(let id):
                turnId = id
            case .absent:
                return
            case .ambiguous:
                // The server HAS a transcript and it does not line up with
                // ours, so we cannot say whether it holds this message. Saying
                // nothing would leave the bubble gone here and the turn alive
                // there — a silent local-only delete, which is the bug this
                // whole path exists to end, not a success.
                rollBack(message, to: index,
                         reason: "the desktop's copy of this chat has changed; refresh and try again",
                         onChange: onChange)
                return
            }
        }
        do {
            try await client.deleteConversationTurn(sessionId: target.sessionId, turnId: turnId)
        } catch {
            rollBack(message, to: index, reason: error.localizedDescription, onChange: onChange)
        }
    }

    /// What the server's transcript says about a message it never named.
    private enum ServerTurnMatch {
        /// The transcript lines up and this turn is the message.
        case named(String)
        /// The transcript lines up as far as it goes and simply ends before
        /// this message: the server never received it, so the local removal
        /// was already the whole delete.
        case absent
        /// The transcript disagrees. Whether the server holds this message is
        /// unknowable from here, so neither deleting nor claiming success is
        /// honest.
        case ambiguous
    }

    /// Name a turn from the server's own transcript, and refuse unless the
    /// transcript names it beyond doubt.
    ///
    /// Position alone deletes a stranger's turn as soon as the two transcripts
    /// drift, and they drift routinely: a reply that failed ambiguously (or
    /// was cancelled) leaves a local bubble with no server turn behind it, and
    /// every ordinal after it is then one too high. Role and text agreeing at
    /// the drifted position is not enough on its own either — a chat is full
    /// of repeated short turns ("ok", "continue", "y"), and an off-by-two in
    /// an alternating transcript lands on the same role every single time.
    ///
    /// So the ordinal has to be backed by a transcript that lines up, not by
    /// arithmetic alone: EVERY position before it must agree too — by turn id
    /// for the messages the server already named, by role and text for the
    /// rest — and only then is the turn sitting at the ordinal this message.
    ///
    /// A unique role+text match elsewhere in the transcript is deliberately
    /// NOT accepted as a second route. It would rescue a drifted ordinal, but
    /// it would also delete an older identical turn for a message the server
    /// never received at all, which is the failure that cannot be undone.
    ///
    /// Refusing costs the user a swipe: the message stays, with a note saying
    /// so, and one refresh later it carries a `serverTurnId` and deletes by
    /// name with no matching involved. Deleting the wrong turn costs someone
    /// else's message, permanently. The cheap mistake is the one to make.
    ///
    /// The prefix is walked BEFORE the ordinal so a refusal can say which kind
    /// it is. Running off the end of a transcript that has agreed the whole
    /// way is the server being behind us — every message from there on is one
    /// it never received — while a disagreement inside the transcript says
    /// nothing at all about where this message is. Only the first of those is
    /// evidence that the local removal was the whole delete.
    nonisolated private static func turnMatch(for message: DisplayMessage,
                                              following preceding: [DisplayMessage],
                                              in turns: [ChatTurn]) -> ServerTurnMatch {
        for position in preceding.indices {
            guard position < turns.count else { return .absent }
            guard Self.turn(turns[position], is: preceding[position]) else { return .ambiguous }
        }
        let ordinal = preceding.count
        guard ordinal < turns.count else { return .absent }
        guard Self.turn(turns[ordinal], is: message) else { return .ambiguous }
        return .named(turns[ordinal].id)
    }

    /// Is this server turn this local message? By id whenever the server has
    /// named the message to us — the only comparison that cannot coincide —
    /// and by role and text for a message it never named.
    ///
    /// Text is compared with the edges trimmed because the two sides store the
    /// same reply differently: `chat/send` persists the assistant turn as
    /// `text.trim()`, while the stream that filled the local bubble appended
    /// every chunk exactly as it arrived. A reply that ends in a newline would
    /// otherwise read as a disagreeing transcript and refuse every later
    /// delete in the session. The guard's strength is the whole prefix
    /// agreeing, not one turn matching byte for byte.
    nonisolated private static func turn(_ turn: ChatTurn, is message: DisplayMessage) -> Bool {
        if let serverTurnId = message.serverTurnId { return turn.id == serverTurnId }
        guard turn.role == message.role.rawValue else { return false }
        return turn.text.trimmingCharacters(in: .whitespacesAndNewlines)
            == message.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Put a rolled-back message back where it left from and say why it is
    /// still there. The index can have moved while the request was in flight
    /// (a reply streamed in, another delete landed), so it is clamped rather
    /// than trusted.
    private func rollBack(_ message: DisplayMessage, to index: Int, reason: String,
                          onChange: @escaping () -> Void) {
        if !messages.contains(where: { $0.id == message.id }) {
            messages.insert(message, at: min(max(index, 0), messages.count))
        }
        // Most `localizedDescription`s already end in a full stop, and
        // "… status 404.." is a shabby thing to read back to someone.
        let detail = reason.hasSuffix(".") ? String(reason.dropLast()) : reason
        appendSystem("That message was not deleted — \(detail).", isError: true)
        updatedAt = Date()
        onChange()
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
        let source = messages[..<idx].last(where: { $0.role == .user })
        let prompt = source?.text ?? ""
        let retryModel = source?.retryModel(for: familiarId)
        let modelBinding = ChatModelTurnBinding.resolveRetry(
            retryModel: retryModel,
            originalScope: source?.modelOverrideScope
        )
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard requireSendProvenance(to: [familiarId]) else { return }
        mutate(messageId) { $0.text = ""; $0.isError = false; $0.streaming = true; $0.activity = nil }
        updatedAt = Date()
        onChange()
        Task { await self.stream(familiarId: familiarId, prompt: prompt,
                                 into: messageId,
                                 reasoningEffort: source?.reasoningEffort,
                                 responseSpeed: source?.responseSpeed,
                                 modelControls: source?.modelControls ?? [:],
                                 modelOverride: modelBinding.modelOverride,
                                 modelOverrideScope: modelBinding.scope,
                                 client: client, onChange: onChange) }
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
        messages = DisplayMessage.restoredTranscript(from: convo.turns, familiarId: familiarId)
        updatedAt = Date()
    }

    private var replayingQueued = false

    var canChangeProject: Bool {
        !sessionIds.values.contains {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    var canSendMessages: Bool {
        canSend(to: familiarIds)
    }

    /// Re-open project selection only while launch provenance is still mutable.
    /// Once any server session exists, its recorded project remains authoritative.
    @discardableResult
    func applyProjectRecovery(for error: Error) -> Bool {
        guard (error as? CaveError)?.requiresProjectSelection == true,
              canChangeProject
        else { return false }
        projectRoot = nil
        needsProjectSelection = true
        return true
    }

    private var normalizedProjectRoot: String? {
        guard let trimmed = projectRoot?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    private func canSend(to familiarIds: [String]) -> Bool {
        if normalizedProjectRoot != nil { return true }
        return familiarIds.allSatisfy {
            guard let sessionID = sessionIds[$0] else { return false }
            return !sessionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func requireSendProvenance(to familiarIds: [String]) -> Bool {
        guard canSend(to: familiarIds) else {
            if canChangeProject { needsProjectSelection = true }
            return false
        }
        return true
    }

    func makeSendBody(
        familiarId: String,
        prompt: String,
        attachments: [CaveClient.ChatAttachment] = [],
        runId: String,
        reasoningEffort: ChatThinkingEffort? = nil,
        responseSpeed: ChatResponseSpeed? = nil,
        modelControls: [String: String] = [:],
        modelOverride: String? = nil,
        modelOverrideScope: ChatModelOverrideScope? = nil
    ) -> CaveClient.SendBody? {
        let rawSessionID = sessionIds[familiarId]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let sessionID = rawSessionID?.isEmpty == false ? rawSessionID : nil
        let projectRoot = normalizedProjectRoot
        guard projectRoot != nil || sessionID != nil else { return nil }

        return CaveClient.SendBody(
            familiarId: familiarId,
            prompt: prompt,
            sessionId: sessionID,
            projectRoot: projectRoot,
            attachments: attachments.isEmpty ? nil : attachments,
            runId: runId,
            reasoningEffort: reasoningEffort,
            responseSpeed: responseSpeed,
            modelControls: modelControls.isEmpty ? nil : modelControls,
            modelOverride: modelOverride,
            modelOverrideScope: modelOverrideScope
        )
    }

    /// O(1) id → `messages` position for the stream's hot mutation path.
    @ObservationIgnored private var transcriptIndex = TranscriptIndex()
    /// id → `transcriptRows` position, so a text delta patches its row in place.
    @ObservationIgnored private var rowPositionByMessageID: [String: Int] = [:]
    /// Set while `mutate` writes `messages[idx]` so the `didSet` doesn't
    /// re-derive rows for a text-only change.
    @ObservationIgnored private var inPlaceMutation = false

    /// Re-derive rows + indexes after a structural change. `Calendar.current`
    /// matches the day-divider semantics the view previously computed.
    private func rebuildTranscript() {
        transcriptIndex.rebuild(messages: messages)
        let rows = TranscriptRow.rows(for: messages)
        var rowPositions = [String: Int](minimumCapacity: messages.count)
        for (position, row) in rows.enumerated() {
            if case .message(let message) = row { rowPositions[message.id] = position }
        }
        transcriptRows = rows
        rowPositionByMessageID = rowPositions
    }

    private func stream(familiarId: String, prompt: String,
                        attachments: [CaveClient.ChatAttachment] = [], into messageId: String,
                        userMessageId: String? = nil,
                        reasoningEffort: ChatThinkingEffort? = nil,
                        responseSpeed: ChatResponseSpeed? = nil,
                        modelControls: [String: String] = [:],
                        modelOverride: String? = nil,
                        modelOverrideScope: ChatModelOverrideScope? = nil,
                        client: CaveClient, onChange: @escaping () -> Void,
                        onStreamResult: ((ChatSendResult) -> Void)? = nil) async {
        // Per-send token: the server keys its resumable run buffer under this
        // (cave-h40l), so even a brand-new chat (no sessionId yet) can
        // re-attach mid-turn after a transport drop.
        let runId = UUID().uuidString
        guard let body = makeSendBody(
            familiarId: familiarId,
            prompt: prompt,
            attachments: attachments,
            runId: runId,
            reasoningEffort: reasoningEffort,
            responseSpeed: responseSpeed,
            modelControls: modelControls,
            modelOverride: modelOverride,
            modelOverrideScope: modelOverrideScope
        ) else { return }
        ChatTurnNotifier.shared.turnStarted(thread: self, familiarId: familiarId,
                                            messageId: messageId)
        var receivedAnyEvent = false
        // Resume cursor: the last applied frame's SSE id (run-buffer seq).
        var cursor = 0
        var sawDone = false
        var outcome = ChatSendOutcome.noAcknowledgement
        let coalescer = StreamCoalescer()
        do {
            for try await frame in client.sendStream(body) {
                receivedAnyEvent = true
                apply(frame.event, into: messageId, familiarId: familiarId,
                      userMessageId: userMessageId,
                      sawDone: &sawDone, coalescer: coalescer, onChange: onChange)
                if let id = frame.id { cursor = id }
            }
            flush(coalescer, into: messageId, onChange: onChange)
            mutate(messageId) {
                $0.streaming = false
                if let settled = ActivityFold.settle($0.activitySteps, success: true) {
                    $0.activity = settled
                }
            }
            outcome = settledSendOutcome(
                assistantMessageId: messageId,
                userMessageId: userMessageId,
                receivedAnyEvent: receivedAnyEvent,
                sawDone: sawDone
            )
        } catch {
            // Transport interruption (network handoff, backgrounding, desktop
            // blip). The run is usually STILL LIVE server-side — re-attach to
            // its buffered stream first and keep rendering in real time
            // (cave-h40l). Only when no resumable run exists (finished long
            // ago / server restarted) fall back to adopting the persisted
            // transcript.
            flush(coalescer, into: messageId, onChange: onChange)
            let serverError = error as? CaveError
            var recovered = false
            if serverError?.isDefinitiveServerResponse != true {
                recovered = await resumeInterruptedStream(
                    runId: runId,
                    cursor: cursor,
                    into: messageId,
                    familiarId: familiarId,
                    userMessageId: userMessageId,
                    sawDone: &sawDone,
                    coalescer: coalescer,
                    client: client,
                    onChange: onChange
                )
                if !recovered {
                    recovered = await resyncInterruptedTurn(
                        familiarId: familiarId,
                        prompt: prompt,
                        into: messageId,
                        userMessageId: userMessageId,
                        client: client
                    )
                }
            }
            if !recovered {
                applyProjectRecovery(for: error)
                if let userMessageId, !receivedAnyEvent, Self.isOfflineTransportError(error) {
                    // The send never reached the server (no route, DNS failure,
                    // refused connection — and not a single SSE event came
                    // back): queue the prompt for the next reconnect instead
                    // of dead-ending in a red bubble. Ambiguous failures
                    // (timeouts, drops after first byte) stay on the error
                    // path — replaying those could double the turn.
                    messages.removeAll { $0.id == messageId }
                    mutate(userMessageId) { $0.queued = true }
                    outcome = .queued
                } else {
                    mutate(messageId) {
                        if $0.text.isEmpty { $0.text = error.localizedDescription }
                        $0.isError = true; $0.streaming = false
                        if let settled = ActivityFold.settle($0.activitySteps, success: false) {
                            $0.activity = settled
                        }
                    }
                    outcome = error is CancellationError ? .cancelled : .failed
                }
            } else {
                outcome = settledSendOutcome(
                    assistantMessageId: messageId,
                    userMessageId: userMessageId,
                    receivedAnyEvent: receivedAnyEvent,
                    sawDone: sawDone
                )
            }
        }
        updatedAt = Date()
        onChange()
        ChatTurnNotifier.shared.turnFinished(thread: self, messageId: messageId)
        onStreamResult?(
            ChatSendResult(
                familiarId: familiarId,
                userMessageId: userMessageId,
                assistantMessageId: messageId,
                outcome: outcome
            )
        )
    }

    /// Apply one stream event to the thread — shared by the original send
    /// stream and the mid-turn resume stream so both render identically.
    private func apply(_ event: StreamEvent, into messageId: String, familiarId: String,
                       userMessageId: String?,
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
        case .assistantReplace(let text):
            flush(coalescer, into: messageId, onChange: onChange)
            mutate(messageId) { $0.text = text; $0.streaming = true }
            onChange()
        case .done(let isError, let sid, let requestedModel, let desiredModel, let forwardedModel, let confirmedModel, let modelSource, let modelApplicationState, let modelApplicationReason, let retryModel, let requestedControls, let forwardedControls, let promptGuidanceControls, let appliedControls, let rejectedControlFamilies):
            if let sid, !sid.isEmpty { sessionIds[familiarId] = sid }
            flush(coalescer, into: messageId, onChange: onChange)
            if let userMessageId {
                mutate(userMessageId) { $0.recordRetryModel(retryModel, for: familiarId) }
            }
            mutate(messageId) {
                $0.streaming = false
                $0.requestedControls = requestedControls
                $0.promptGuidanceControls = promptGuidanceControls
                $0.appliedControls = appliedControls
                $0.rejectedControlFamilies = rejectedControlFamilies
                $0.forwardedControls = forwardedControls
                $0.requestedModel = requestedModel
                $0.desiredModel = desiredModel
                $0.forwardedModel = forwardedModel
                $0.confirmedModel = confirmedModel
                $0.modelSource = modelSource
                $0.modelApplicationState = modelApplicationState
                $0.modelApplicationReason = modelApplicationReason
                if isError { $0.isError = true }
                // A persisted "running" step would spin forever after reload —
                // the turn is over, so settle the trail with its outcome.
                if let settled = ActivityFold.settle($0.activitySteps, success: !isError) {
                    $0.activity = settled
                }
            }
            sawDone = true
        case .toolUse, .progress:
            // Agent activity: orders of magnitude rarer than tokens, so each
            // event mutates directly (no coalescing) — but drain buffered
            // prose first so the text a step interrupted lands before the
            // activity chip advances past it.
            flush(coalescer, into: messageId, onChange: onChange)
            var changed = false
            var stepLabel: String?
            mutate(messageId) {
                guard let folded = ActivityFold.fold($0.activitySteps, event: event) else { return }
                $0.activity = folded
                changed = true
                stepLabel = folded.currentStep?.title
            }
            if changed {
                onChange()
                ChatTurnNotifier.shared.turnStatus(thread: self, label: stepLabel)
            }
        case .error(let message):
            flush(coalescer, into: messageId, onChange: onChange)
            mutate(messageId) {
                if $0.text.isEmpty { $0.text = message }
                $0.isError = true; $0.streaming = false
                if let settled = ActivityFold.settle($0.activitySteps, success: false) {
                    $0.activity = settled
                }
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
                                         familiarId: String, userMessageId: String?,
                                         sawDone: inout Bool,
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
                          userMessageId: userMessageId,
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
                                       userMessageId: String?,
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
        if let userMessageId {
            mutate(userMessageId) {
                $0.recordRetryModel(reply.responseMetadata?.retryModel ?? convo.turns[lastUser].modelOverride, for: familiarId)
            }
        }
        mutate(messageId) {
            $0.text = reply.text
            $0.isError = reply.isError ?? false
            $0.streaming = false
            $0.requestedModel = reply.responseMetadata?.requestedModel
            $0.desiredModel = reply.responseMetadata?.desiredModel
            $0.forwardedModel = reply.responseMetadata?.forwardedModel
            $0.confirmedModel = reply.responseMetadata?.confirmedModel
            $0.modelSource = reply.responseMetadata?.modelSource
            $0.modelApplicationState = reply.responseMetadata?.modelApplicationState
            $0.modelApplicationReason = reply.responseMetadata?.modelApplicationReason
            $0.requestedControls = reply.responseMetadata?.requestedControls
            $0.forwardedControls = reply.responseMetadata?.forwardedControls
            $0.promptGuidanceControls = reply.responseMetadata?.promptGuidanceControls
            $0.appliedControls = reply.responseMetadata?.appliedControls
            $0.rejectedControlFamilies = reply.responseMetadata?.rejectedControlFamilies
            if let settled = ActivityFold.settle($0.activitySteps,
                                                 success: !(reply.isError ?? false)) {
                $0.activity = settled
            }
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
            // The server named this turn to us, so carry its id: an adopted
            // reply is server-owned, and without the id a later delete has to
            // guess at it by position instead of naming it.
            messages.insert(DisplayMessage(serverTurnId: reply.id,
                                           role: .assistant, familiarId: familiarId,
                                           text: reply.text, isError: reply.isError ?? false,
                                           activity: ActivityFold.steps(fromTools: reply.tools)),
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

    /// In-place update of one message — the stream's hot path (every coalesced
    /// text flush lands here). O(1) via the transcript index instead of an
    /// O(n) scan, and patches the matching row without re-deriving separators
    /// (a mutate never changes `createdAt`, so separators can't move).
    private func mutate(_ messageId: String, _ body: (inout DisplayMessage) -> Void) {
        guard let idx = transcriptIndex.position(of: messageId),
              idx < messages.count, messages[idx].id == messageId else { return }
        var message = messages[idx]
        body(&message)
        assert(message.createdAt == messages[idx].createdAt,
               "mutate must not change createdAt — separators are not re-derived on this path")
        inPlaceMutation = true
        messages[idx] = message
        inPlaceMutation = false
        if let rowIdx = rowPositionByMessageID[messageId] {
            transcriptRows[rowIdx] = .message(message)
        }
    }

    private func settledSendOutcome(
        assistantMessageId: String,
        userMessageId: String?,
        receivedAnyEvent: Bool,
        sawDone: Bool
    ) -> ChatSendOutcome {
        if let userMessageId,
           messages.first(where: { $0.id == userMessageId })?.isQueued == true {
            return .queued
        }
        guard let assistantMessage = messages.first(where: { $0.id == assistantMessageId }) else {
            return receivedAnyEvent ? .failed : .noAcknowledgement
        }
        if assistantMessage.isError { return .failed }
        if sawDone { return .acknowledged }
        let response = assistantMessage.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return response.isEmpty ? .noAcknowledgement : .acknowledged
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
