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
    /// The exact prompt sent over the wire when the visible user bubble is a
    /// shortened label (diagram/forward actions). Keeping it separate makes a
    /// crash-time replay or manual retry semantically identical to the original
    /// send. nil means `text` is already the wire prompt.
    var sendPrompt: String?
    var streaming: Bool = false
    var isError: Bool = false
    var createdAt: Date = Date()
    /// Image attachments sent with this (user) message, as `data:` URLs.
    var attachmentDataUrls: [String] = []
    /// Composed while the desktop was unreachable; waiting for reconnect.
    /// Optional so messages persisted before offline compose still decode.
    var queued: Bool?
    /// A queued durability marker can also cover an ordinary online send until
    /// every fan-out leg settles. This distinguishes that brief in-flight state
    /// in the UI while making it replay-eligible after suspension or a crash.
    var queuedDispatchInFlight: Bool?
    /// Familiar fan-out targets that already produced a definitive result
    /// while this durable queued turn was replaying. Optional for snapshots
    /// written before acknowledgement-safe replay shipped.
    var queuedCompletedFamiliarIds: [String]?
    /// Stable client delivery identity per familiar. A replay persists this
    /// before POSTing, then resumes or reconciles the exact server run after a
    /// suspension instead of comparing prompt text (two intentional "hello"
    /// turns are distinct deliveries). Optional for older snapshots.
    var queuedRunIdsByFamiliarId: [String: String]?
    /// Targets whose stable run id was durably marked as dispatched. If Cave
    /// dies after that marker but before the response is saved, replay must
    /// resume/reconcile the id and never issue a second POST automatically.
    var queuedAttemptedFamiliarIds: [String]?
    /// Immutable fan-out captured when the user composed the turn. Membership
    /// of a group can change while the phone is offline; replaying against the
    /// live thread membership would skip an original target or send to a new
    /// one the user never selected. Optional for pre-migration snapshots.
    var queuedTargetFamiliarIds: [String]?
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
    var isQueuedDispatchInFlight: Bool { queued == true && queuedDispatchInFlight == true }
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
            sendPrompt: message.sendPrompt,
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

    /// Only explicit terminal outcomes advance one durable group fan-out leg.
    /// A stopped placeholder is not proof: cancellation and exact-transcript
    /// recovery failure also stop rendering while their run remains unsettled.
    var completesQueuedFanOutLeg: Bool {
        self == .acknowledged || self == .failed
    }
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
              onConnectionFailure: ((Error) -> Void)? = nil,
              liveDispatchLeaseIsCurrent: @escaping () -> Bool,
              persistBeforeDispatch: @escaping () async -> Bool,
              persistAfterRollback: @escaping () async -> Bool,
              onDeliverySettled: (() -> Void)? = nil,
              client: CaveClient, onChange: @escaping () -> Void) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // An image with no caption is a valid prompt (the familiar reads it).
        guard !trimmed.isEmpty || !attachments.isEmpty else { return }
        guard requireSendProvenance(to: familiarIds) else { return }
        let shown = (displayText?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap {
            $0.isEmpty ? nil : $0
        } ?? trimmed
        let deliveryRunIds = familiarIds.reduce(into: [String: String]()) { runIds, familiarId in
            runIds[familiarId] = UUID().uuidString
        }

        let userMessage = DisplayMessage(
            role: .user, familiarId: nil, text: shown,
            sendPrompt: shown == trimmed ? nil : trimmed,
            attachmentDataUrls: attachments.map(\.dataUrl),
            queued: true,
            queuedDispatchInFlight: true,
            queuedRunIdsByFamiliarId: deliveryRunIds,
            queuedAttemptedFamiliarIds: familiarIds,
            queuedTargetFamiliarIds: familiarIds,
            reasoningEffort: reasoningEffort, responseSpeed: responseSpeed,
            modelControls: modelControls.isEmpty ? nil : modelControls,
            modelOverride: modelOverride,
            modelOverrideScope: modelOverrideScope)
        messages.append(userMessage)
        updatedAt = Date()
        onChange()

        var deliveries: [(familiarId: String, messageId: String, runId: String)] = []
        for familiarId in familiarIds {
            guard let runId = deliveryRunIds[familiarId],
                  claimActiveDelivery(
                      userMessageId: userMessage.id,
                      familiarId: familiarId,
                      runId: runId
                  ) else {
                continue
            }
            let placeholder = DisplayMessage(role: .assistant, familiarId: familiarId,
                                             text: "", streaming: true)
            messages.append(placeholder)
            deliveries.append((familiarId, placeholder.id, runId))
        }
        onChange()

        // Persist every fan-out id and attempted marker as one checkpoint
        // before any child request can start. A suspension can therefore
        // reconcile each exact delivery rather than repeat a prompt.
        Task {
            guard await persistBeforeDispatch(),
                  !Task.isCancelled,
                  liveDispatchLeaseIsCurrent() else {
                mutate(userMessage.id) {
                    $0.queuedDispatchInFlight = false
                    $0.queuedRunIdsByFamiliarId = nil
                    $0.queuedAttemptedFamiliarIds = nil
                }
                for delivery in deliveries {
                    mutate(delivery.messageId) {
                        $0.text = "Cave couldn’t save this delivery before sending. Try again."
                        $0.isError = true
                        $0.streaming = false
                    }
                    releaseActiveDelivery(
                        userMessageId: userMessage.id,
                        familiarId: delivery.familiarId,
                        runId: delivery.runId
                    )
                }
                updatedAt = Date()
                // A competing lifecycle flush can supersede the checkpoint
                // write after snapshotting these attempted markers, making the
                // await above return false while that newer stale snapshot still
                // lands. Immediately persist the rollback before yielding the
                // failure; the ordinary debounced onChange is not a durability
                // boundary if iOS suspends us in the next instant.
                onChange()
                _ = await persistAfterRollback()
                onDeliverySettled?()
                return
            }
            for delivery in deliveries {
                Task {
                    await self.stream(
                        familiarId: delivery.familiarId,
                        prompt: trimmed,
                        attachments: attachments,
                        into: delivery.messageId,
                        userMessageId: userMessage.id,
                        reasoningEffort: reasoningEffort,
                        responseSpeed: responseSpeed,
                        modelControls: modelControls,
                        modelOverride: modelOverride,
                        modelOverrideScope: modelOverrideScope ?? (modelOverride == nil ? nil : .session),
                        runId: delivery.runId,
                        activeDeliveryClaimed: true,
                        liveDispatchLeaseIsCurrent: liveDispatchLeaseIsCurrent,
                        persistAfterProvablyUnsentRollback: persistAfterRollback,
                        client: client,
                        onChange: onChange,
                        onStreamResult: onStreamResult,
                        onConnectionFailure: onConnectionFailure,
                        onDeliverySettled: onDeliverySettled
                    )
                }
            }
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
            queuedTargetFamiliarIds: familiarIds,
            reasoningEffort: reasoningEffort, responseSpeed: responseSpeed,
            modelControls: modelControls.isEmpty ? nil : modelControls,
            modelOverride: modelOverride,
            modelOverrideScope: modelOverrideScope)
        message.queued = true
        messages.append(message)
        updatedAt = Date()
    }

    /// Send every queued (offline-composed) message through the normal fan-out,
    /// oldest first, once the desktop is reachable. The queue bit stays durable
    /// until every familiar has produced either an acknowledgement or a visible
    /// terminal error. Before the first POST for a target, its stable run id and
    /// attempted marker are flushed to disk. A restart therefore resumes or
    /// reconciles that exact id instead of comparing prompt text or sending a
    /// second POST. Sequential replay preserves compose order; per-familiar
    /// progress and live ownership protect partial group fan-out.
    func replayQueued(client: CaveClient,
                      onConnectionFailure: ((Error) -> Void)? = nil,
                      dispatchLeaseIsCurrent: @escaping () -> Bool,
                      persistBeforeDispatch: @escaping () async -> Bool,
                      persistAfterRollback: @escaping () async -> Bool,
                      onChange: @escaping () -> Void) async {
        guard !replayingQueued else { return }
        replayingQueued = true
        defer { replayingQueued = false }
        while let queuedMessage = messages.first(where: { $0.isQueued }) {
            guard !Task.isCancelled else { return }
            let targets = queuedMessage.queuedTargetFamiliarIds
                ?? queuedMessage.queuedRunIdsByFamiliarId.map { Array($0.keys).sorted() }
                ?? familiarIds
            guard requireSendProvenance(to: targets) else { return }
            let queuedId = queuedMessage.id
            let prompt = queuedMessage.sendPrompt ?? queuedMessage.text
            let attachments = Self.attachments(fromDataUrls: queuedMessage.attachmentDataUrls)
            let reasoningEffort = queuedMessage.reasoningEffort
            let responseSpeed = queuedMessage.responseSpeed
            let modelControls = queuedMessage.modelControls ?? [:]
            var completed = Set(queuedMessage.queuedCompletedFamiliarIds ?? [])
            for familiarId in targets where !completed.contains(familiarId) {
                guard !Task.isCancelled else { return }
                // A sibling from the original concurrent fan-out can still be
                // streaming when another leg proves offline and queues their
                // shared user bubble. Never start a second request for it.
                guard !isActiveDelivery(userMessageId: queuedId, familiarId: familiarId) else {
                    return
                }
                // A target whose reply for this turn is already on screen must
                // not be replayed: the shared user bubble stays queued only for
                // the legs that still need delivery, and re-adopting the
                // existing reply would insert a second bubble for one server
                // turn (cave-bm3qq). The completed marker can lag the thread —
                // a snapshot written between this target's success and its
                // durable completed list — so the thread itself is the
                // authority here, and the marker is healed in the same pass.
                // Only a server-NAMED reply (one adopted from the transcript)
                // is skipped: a partial bubble a cancelled stream left behind
                // must still be reconciled on the next reconnect.
                if let settled = replayPlaceholder(
                    after: queuedId,
                    familiarId: familiarId
                ), !settled.streaming,
                   settled.serverTurnId != nil {
                    completed.insert(familiarId)
                    mutate(queuedId) {
                        $0.queuedCompletedFamiliarIds = completed.sorted()
                    }
                    continue
                }
                let existingPlaceholder = replayPlaceholder(
                    after: queuedId,
                    familiarId: familiarId
                )
                // Reconciliation may need to clear a cursor-zero resume target,
                // but a transient GET failure is not permission to overwrite a
                // reply already persisted on the phone. Restore this exact value
                // on retryLater and let the next reconnect try the same run id.
                let placeholderBeforeReconciliation = existingPlaceholder
                let placeholder = existingPlaceholder ?? DisplayMessage(
                    role: .assistant,
                    familiarId: familiarId,
                    text: "",
                    streaming: true
                )
                let insertedPlaceholder = existingPlaceholder == nil
                if insertedPlaceholder {
                    guard let insertAt = replayInsertionIndex(after: queuedId) else { return }
                    messages.insert(placeholder, at: insertAt)
                } else {
                    // Resume starts at cursor zero, so retaining persisted text
                    // would append the same buffered prefix a second time.
                    mutate(placeholder.id) {
                        $0.serverTurnId = nil
                        $0.text = ""
                        $0.isError = false
                        $0.streaming = true
                        $0.activity = nil
                    }
                }

                let persistedRunId = messages.first(where: { $0.id == queuedId })?
                    .queuedRunIdsByFamiliarId?[familiarId]
                var runId = persistedRunId
                let attempted = messages.first(where: { $0.id == queuedId })?
                    .queuedAttemptedFamiliarIds?.contains(familiarId) == true

                if let existingRunId = runId, attempted {
                    let reconciliation = await reconcileQueuedRun(
                        runId: existingRunId,
                        familiarId: familiarId,
                        into: placeholder.id,
                        userMessageId: queuedId,
                        client: client,
                        onChange: onChange
                    )
                    guard !Task.isCancelled else {
                        if insertedPlaceholder {
                            messages.removeAll { $0.id == placeholder.id }
                        } else if let placeholderBeforeReconciliation {
                            mutate(placeholder.id) { $0 = placeholderBeforeReconciliation }
                        }
                        onChange()
                        return
                    }
                    switch reconciliation {
                    case .completed:
                        break
                    case .unconfirmed:
                        mutate(placeholder.id) {
                            $0.text = "Cave couldn’t confirm the previous delivery. Retry this reply to send it again."
                            $0.isError = true
                            $0.streaming = false
                        }
                    case .retryLater(let error):
                        if insertedPlaceholder {
                            messages.removeAll { $0.id == placeholder.id }
                        } else if let placeholderBeforeReconciliation {
                            mutate(placeholder.id) { $0 = placeholderBeforeReconciliation }
                        } else {
                            mutate(placeholder.id) { $0.streaming = false }
                        }
                        onConnectionFailure?(error)
                        onChange()
                        return
                    }
                    completed.insert(familiarId)
                    mutate(queuedId) {
                        $0.queuedCompletedFamiliarIds = completed.sorted()
                    }
                    updatedAt = Date()
                    onChange()
                    continue
                }

                if runId == nil { runId = UUID().uuidString }
                guard let runId else {
                    messages.removeAll { $0.id == placeholder.id }
                    return
                }

                // Persist the stable id and at-most-once boundary in the same
                // atomic snapshot before network I/O. If that write fails, fail
                // closed: no request leaves the phone.
                mutate(queuedId) {
                    var runIds = $0.queuedRunIdsByFamiliarId ?? [:]
                    runIds[familiarId] = runId
                    $0.queuedRunIdsByFamiliarId = runIds
                    var attemptedIds = Set($0.queuedAttemptedFamiliarIds ?? [])
                    attemptedIds.insert(familiarId)
                    $0.queuedAttemptedFamiliarIds = attemptedIds.sorted()
                }
                updatedAt = Date()
                onChange()
                guard await persistBeforeDispatch(),
                      !Task.isCancelled,
                      dispatchLeaseIsCurrent() else {
                    mutate(queuedId) {
                        var attemptedIds = Set($0.queuedAttemptedFamiliarIds ?? [])
                        attemptedIds.remove(familiarId)
                        $0.queuedAttemptedFamiliarIds = attemptedIds.isEmpty
                            ? nil
                            : attemptedIds.sorted()
                        if persistedRunId == nil {
                            var runIds = $0.queuedRunIdsByFamiliarId ?? [:]
                            runIds.removeValue(forKey: familiarId)
                            $0.queuedRunIdsByFamiliarId = runIds.isEmpty ? nil : runIds
                        }
                    }
                    mutate(placeholder.id) {
                        $0.text = "Cave couldn’t save this delivery before sending. It will retry after reconnecting."
                        $0.isError = true
                        $0.streaming = false
                    }
                    updatedAt = Date()
                    // The checkpoint may have reached disk before cancellation
                    // invalidated its endpoint lease. Persist this local rollback
                    // without that network lease so a process kill cannot revive
                    // an unsent leg as "attempted" on the next launch.
                    _ = await persistAfterRollback()
                    onChange()
                    return
                }

                // Cancellation after the checkpoint but before `stream` begins
                // proves this leg never left the phone. Roll its boundary back so
                // an endpoint re-pair can safely deliver it to the replacement.
                guard !Task.isCancelled, dispatchLeaseIsCurrent() else {
                    mutate(queuedId) {
                        var attemptedIds = Set($0.queuedAttemptedFamiliarIds ?? [])
                        attemptedIds.remove(familiarId)
                        $0.queuedAttemptedFamiliarIds = attemptedIds.isEmpty
                            ? nil
                            : attemptedIds.sorted()
                        if persistedRunId == nil {
                            var runIds = $0.queuedRunIdsByFamiliarId ?? [:]
                            runIds.removeValue(forKey: familiarId)
                            $0.queuedRunIdsByFamiliarId = runIds.isEmpty ? nil : runIds
                        }
                    }
                    if insertedPlaceholder {
                        messages.removeAll { $0.id == placeholder.id }
                    } else if let placeholderBeforeReconciliation {
                        mutate(placeholder.id) { $0 = placeholderBeforeReconciliation }
                    }
                    updatedAt = Date()
                    // Network ownership is gone, but the proven-pre-POST rollback
                    // still owns local durability. Its save must not be fenced by
                    // the superseded endpoint/flush id.
                    _ = await persistAfterRollback()
                    onChange()
                    return
                }

                let streamOutcome = await stream(
                    familiarId: familiarId,
                    prompt: prompt,
                    attachments: attachments,
                    into: placeholder.id,
                    userMessageId: queuedId,
                    reasoningEffort: reasoningEffort,
                    responseSpeed: responseSpeed,
                    modelControls: modelControls,
                    modelOverride: queuedMessage.modelOverride,
                    modelOverrideScope: queuedMessage.modelOverrideScope ?? (queuedMessage.modelOverride == nil ? nil : .session),
                    runId: runId,
                    liveDispatchLeaseIsCurrent: dispatchLeaseIsCurrent,
                    persistAfterProvablyUnsentRollback: persistAfterRollback,
                    client: client,
                    onChange: onChange,
                    onConnectionFailure: onConnectionFailure
                )
                // A provably-unsent reconnect failure removes its placeholder
                // and leaves the durable queue bit set. Stop without spinning;
                // the next supervisor success resumes this familiar only.
                guard streamOutcome.completesQueuedFanOutLeg,
                      let settled = messages.first(where: { $0.id == placeholder.id }),
                      !settled.streaming else { return }
                completed.insert(familiarId)
                mutate(queuedId) {
                    $0.queuedCompletedFamiliarIds = completed.sorted()
                }
                updatedAt = Date()
                onChange()
            }
            mutate(queuedId) {
                $0.queued = false
                $0.queuedDispatchInFlight = nil
                $0.queuedCompletedFamiliarIds = nil
                $0.queuedRunIdsByFamiliarId = nil
                $0.queuedAttemptedFamiliarIds = nil
                $0.queuedTargetFamiliarIds = nil
            }
            updatedAt = Date()
            onChange()
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
    ///
    /// A GROUP message is one bubble over several server sessions, so this can
    /// be several deletes rather than one — see `serverDeleteTarget` for how
    /// they are located and `persistDelete` for what happens when only some of
    /// them land. `familiarNames` is only ever read to write that report: the
    /// thread knows familiar ids and the sentence is read back to a person, so
    /// the display names come from the view that has them.
    func deleteMessage(_ messageId: String, client: CaveClient?,
                       familiarNames: [String: String] = [:],
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
                                      client: client, familiarNames: familiarNames,
                                      onChange: onChange)
        }
    }

    /// The tail of this thread's serialized server deletes. Nothing renders
    /// it, so it stays out of observation. See `deleteMessage`.
    @ObservationIgnored private var pendingServerDelete: Task<Void, Never>?

    /// Where a message lives on the server, when it lives there at all — one
    /// entry per session that can be holding a copy of it.
    ///
    /// A group used to be refused outright here, and the reason was real: a
    /// group is N independent server sessions presented as one transcript, so
    /// `familiarIds.first` names an arbitrary one of them and a position in
    /// the merged local list answers to no position in any of their turn
    /// lists. What was missing was not a session id but a PROJECTION. Session
    /// F's turn list is exactly the sub-sequence of this thread's messages
    /// that F was sent: every user prompt, because `send` fans one prompt out
    /// to every familiar, plus the replies F itself produced and no other
    /// familiar's. Take that sub-sequence and the merged list resolves into as
    /// many honest per-session transcripts as the thread has familiars, each
    /// of which the existing prefix-agreement matcher can check position by
    /// position exactly as it does for a direct chat.
    ///
    /// So the shape of the answer follows the shape of the message. An
    /// assistant bubble carries the `familiarId` that produced it, which names
    /// exactly one session — one delete, and no way to fail halfway. A user
    /// bubble was fanned out, so it is N server turns with N different ids,
    /// and deleting it is N deletes; `persistDelete` owns what that means when
    /// only some of them land. A direct chat is the same code with one entry,
    /// not a special case beside it.
    ///
    /// A queued send, inline slash output, and a thread with no session yet
    /// have nothing on the server to remove, and for those the local removal
    /// is already the whole truth.
    private func serverDeleteTarget(for message: DisplayMessage,
                                    at index: Int) -> ServerDeleteTarget? {
        guard !message.isQueued,
              // Inline slash output is local-only — but a `system` turn the
              // server named on a restore is a real turn there (the server
              // persists chain-less system turns) and deletes like any other.
              // Refusing every system message would leave those undeletable
              // by the silent local splice this whole path exists to end.
              message.role != .system || message.serverTurnId != nil
        else { return nil }
        let group = isGroup
        let sessions: [ServerDeleteTarget.Session] = holders(of: message).compactMap { familiarId in
            guard let sessionId = sessionIds[familiarId], !sessionId.isEmpty else { return nil }
            guard let projected = Self.sessionTurn(message, in: familiarId, isGroup: group) else {
                return nil
            }
            // Messages this session never received do not occupy a turn in it,
            // so they must not be counted when locating one. Kept whole rather
            // than counted: naming a turn by position is only safe if the
            // positions before it can be checked against that session's own
            // transcript.
            let preceding = messages[..<index].compactMap {
                Self.sessionTurn($0, in: familiarId, isGroup: group)
            }
            return ServerDeleteTarget.Session(familiarId: familiarId, sessionId: sessionId,
                                              message: projected, preceding: preceding)
        }
        return sessions.isEmpty ? nil : ServerDeleteTarget(sessions: sessions)
    }

    /// Which of this thread's familiars could be holding this message.
    ///
    /// A reply lives in exactly one session — the one that produced it — so
    /// deleting it anywhere else would remove a different familiar's turn. A
    /// user prompt went to all of them, because that is what `send` does.
    private func holders(of message: DisplayMessage) -> [String] {
        guard message.role == .assistant else { return familiarIds }
        if let familiarId = message.familiarId { return [familiarId] }
        // An unattributed reply can only be a direct chat's, where there is one
        // session and it is that one. In a group it names no session at all,
        // and picking one would be the arbitrary `familiarIds.first` this whole
        // projection exists to replace.
        return isGroup ? [] : familiarIds
    }

    private struct ServerDeleteTarget {
        /// Every server session that can hold this message: one for a direct
        /// chat or a group reply, N for a group's user turn.
        let sessions: [Session]

        struct Session {
            let familiarId: String
            let sessionId: String
            /// The message as THIS session's transcript sees it — see
            /// `sessionTurn(_:in:isGroup:)`. Its `serverTurnId`, when it has
            /// one, names a turn in this session and no other.
            let message: DisplayMessage
            /// Every local message before it that occupies a turn in THIS
            /// session, in order. Its COUNT is the ordinal used to name a
            /// message the server has never named to us, and its contents are
            /// what proves that ordinal actually lines up with this session's
            /// transcript.
            let preceding: [DisplayMessage]
        }
    }

    /// This message as one session's transcript sees it, or nil when that
    /// session never held it.
    ///
    /// This is the whole of what makes a group addressable. Dropping another
    /// familiar's reply is not tidying: counted, each of the N-1 replies the
    /// fan-out produced for the other familiars would push every later
    /// position that many turns too far down THIS session's turn list, and the
    /// ordinal would name a stranger's turn.
    ///
    /// The turn id is narrowed for the same reason the position is. A
    /// `serverTurnId` names a turn in the one session whose transcript handed
    /// it over. In a direct chat that is the only session there is, so it
    /// stands. In a group, adoption is the only route that names anything and
    /// it only ever names a reply, so an id on a fanned-out user turn cannot
    /// have come from the session being asked — comparing it there would
    /// report a disagreeing transcript that is nothing but the wrong
    /// session's id. Stripped, the turn falls back to role-and-text under the
    /// same prefix agreement as any message the server never named.
    nonisolated private static func sessionTurn(_ message: DisplayMessage,
                                                in familiarId: String,
                                                isGroup: Bool) -> DisplayMessage? {
        guard occupiesServerTurn(message) else { return nil }
        if message.role == .assistant {
            if let owner = message.familiarId { return owner == familiarId ? message : nil }
            return isGroup ? nil : message
        }
        guard isGroup else { return message }
        var projected = message
        projected.serverTurnId = nil
        return projected
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

    /// Delete this message from every session that holds it — naming all of
    /// the turns before removing any of them.
    ///
    /// The two phases are the point. A group's user turn is N deletes, and
    /// discovering at the third session that the turn cannot be named would
    /// leave two sessions deleted and two not, over a message nothing can put
    /// back. Resolving first turns every "we cannot say where it is" refusal —
    /// the common one, and the only one this code can provoke — into a refusal
    /// that has changed nothing at all, so it rolls back cleanly and costs the
    /// user a swipe.
    ///
    /// What survives that is a delete that was named in every session and then
    /// refused by some of them: a desktop that went away between requests. That
    /// one cannot be made atomic from here — the route deletes one turn in one
    /// session and has no undelete — so it is reported rather than hidden.
    private func persistDelete(of message: DisplayMessage, at index: Int,
                               target: ServerDeleteTarget, client: CaveClient,
                               familiarNames: [String: String],
                               onChange: @escaping () -> Void) async {
        var deletions: [(familiarId: String, sessionId: String, turnId: String)] = []
        for session in target.sessions {
            switch await resolveTurn(in: session, client: client) {
            case .named(let turnId):
                deletions.append((session.familiarId, session.sessionId, turnId))
            case .absent:
                // This session's transcript agreed as far as it goes and ends
                // before the message — a prompt whose fan-out never reached
                // this familiar. There is nothing here to delete, and that is
                // not a reason to refuse the sessions that do hold it.
                continue
            case .unresolved(let reason):
                // Nothing has been deleted yet, so refusing is free.
                rollBack(message, to: index, reason: reason, onChange: onChange)
                return
            }
        }
        var failures: [(familiarId: String, reason: String)] = []
        for deletion in deletions {
            do {
                try await client.deleteConversationTurn(sessionId: deletion.sessionId,
                                                        turnId: deletion.turnId)
            } catch {
                // Keep going: every session that still answers is one fewer
                // surviving copy, and the report below wants the whole list.
                failures.append((deletion.familiarId, error.localizedDescription))
            }
        }
        guard let firstFailure = failures.first else { return }
        if failures.count == deletions.count {
            // Nothing landed anywhere. The server is in exactly the state it
            // was in before the swipe, so put the message back and say why —
            // the direct chat's behaviour, and the one every "desktop
            // unreachable" failure takes whatever the thread's shape.
            rollBack(message, to: index, reason: firstFailure.reason, onChange: onChange)
            return
        }
        reportPartialDelete(failures, familiarNames: familiarNames, onChange: onChange)
    }

    /// What one session says about where this message is, if anywhere.
    private enum ServerTurnResolution {
        case named(String)
        case absent
        /// The session could not be asked, or answered with a transcript that
        /// does not line up. Either way we cannot name a turn, and guessing is
        /// how a delete removes a stranger's message.
        case unresolved(String)
    }

    /// Name this message's turn inside one session, without deleting anything.
    private func resolveTurn(in session: ServerDeleteTarget.Session,
                             client: CaveClient) async -> ServerTurnResolution {
        if let known = session.message.serverTurnId, !known.isEmpty { return .named(known) }
        // A message composed in this session has no server-assigned id yet,
        // and nothing in the send path hands one back. Reading the
        // conversation is the only way to name the turn — and the read has
        // THREE outcomes a `try?` collapses into one:
        //
        //  - it THROWS 404: `GET /api/chat/conversation/{id}` answers 404 when
        //    the server holds no transcript for this chat (see that route's
        //    final `not found`). The desktop was reached and told us it has
        //    nothing, so the local removal was already the whole delete for
        //    this session. Blaming the network here would be a lie AND would
        //    put back a message no server copy will ever resurrect.
        //  - it THROWS anything else: a real failure, report it.
        //  - it RETURNS nil: same answer as the 404, reached through the
        //    narrow `conversation: null` shape the route uses when a board
        //    card claims the session but no transcript exists yet.
        let convo: Conversation?
        do {
            convo = try await client.conversation(sessionId: session.sessionId)
        } catch CaveError.badResponse(404) {
            return .absent
        } catch {
            return .unresolved(error.localizedDescription)
        }
        guard let convo else { return .absent }
        switch Self.turnMatch(for: session.message, following: session.preceding,
                              in: convo.turns) {
        case .named(let id):
            return .named(id)
        case .absent:
            return .absent
        case .ambiguous:
            // The server HAS a transcript and it does not line up with ours,
            // so we cannot say whether it holds this message. Saying nothing
            // would leave the bubble gone here and the turn alive there — a
            // silent local-only delete, which is the bug this whole path
            // exists to end, not a success.
            //
            // "Refresh and try again" is real advice in a DIRECT chat and only
            // there: pull-to-refresh calls `reload`, the transcript comes back
            // from the server with a `serverTurnId` on every message, and the
            // next swipe deletes by name without the matcher at all. `reload`
            // opens with `guard !isGroup`, so a group has no such route — the
            // gesture is a no-op and the sentence would be sending someone to
            // pull at a list that cannot change. Say what is true instead.
            return .unresolved(
                isGroup
                    ? "the desktop's copy of this chat has changed and a group chat can't be refreshed to catch up"
                    : "the desktop's copy of this chat has changed; refresh and try again")
        }
    }

    /// Say out loud that a delete landed in some of a group's sessions and not
    /// others, and deliberately leave the message removed.
    ///
    /// Rolling back is the wrong instrument here, and it is worth being exact
    /// about why, because everywhere else on this path rolling back is the
    /// honest move. It is honest there because nothing happened. Here
    /// something did: the turn is really gone from at least one session and
    /// the route has no undelete, so re-inserting the bubble would assert
    /// copies the server has already destroyed. Worse, it would assert them
    /// unrecoverably — those sessions' transcripts have moved, so the next
    /// swipe's prefix walk finds them disagreeing, refuses as `ambiguous`, and
    /// the copies that DID survive can never be deleted at all. Keeping the
    /// removal is the description that is true of most sessions and leaves the
    /// user somewhere to go.
    ///
    /// The one thing never done here is nothing. An unreported partial delete
    /// is the silent local-only delete this whole path exists to end, just with
    /// fewer sessions holding the evidence.
    private func reportPartialDelete(_ failures: [(familiarId: String, reason: String)],
                                     familiarNames: [String: String],
                                     onChange: @escaping () -> Void) {
        let names = failures.map { familiarNames[$0.familiarId] ?? $0.familiarId }
        let reason = failures[0].reason
        // Most `localizedDescription`s already end in a full stop, and
        // "… status 404.." is a shabby thing to read back to someone.
        let detail = reason.hasSuffix(".") ? String(reason.dropLast()) : reason
        appendSystem(
            "That message was deleted, but it is still in this chat with "
                + "\(names.joined(separator: ", ")) — \(detail).",
            isError: true)
        updatedAt = Date()
        onChange()
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
    ///
    /// Reused unchanged for a group, one session at a time. `preceding` is by
    /// then the session's own projection rather than the whole merged list
    /// (see `sessionTurn(_:in:isGroup:)`), so what arrives here is the same
    /// question it has always answered: does one local transcript line up with
    /// one server transcript, position by position. It also happens to be the
    /// only guard that catches a fan-out that reached some familiars and not
    /// others — that session's turns are shifted, the walk disagrees, and the
    /// delete is refused rather than aimed at whatever sits at the ordinal.
    ///
    /// One sentence above does NOT survive the move, and it is the one about
    /// the price of refusing. A direct chat pays a swipe: refreshing reloads
    /// the transcript, every message comes back named, and the retry needs no
    /// matching. `reload` refuses groups, so a group has no way to re-acquire
    /// those ids — a session whose turns are shifted stays shifted, and every
    /// later delete in the thread is refused for as long as the thread lives.
    /// That is still the right side to err on (the alternative is deleting a
    /// stranger's turn) but it is a standing cost, not a swipe, and the
    /// refusal says so rather than promising a refresh that does nothing.
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
    ///
    /// It also drops the bubble's `serverTurnId`. A retry is an ordinary send —
    /// `SendBody` carries no branch or replace field — so the server appends a
    /// NEW turn pair and keeps the old assistant turn where it was. Holding on
    /// to that id would point this bubble at a turn whose text it no longer
    /// shows, and a delete would then remove the superseded turn while the
    /// reply on screen stayed. Nil is the honest state: the server has never
    /// named THIS reply to us, so a delete goes through the transcript matcher
    /// like any other unnamed message.
    func retry(_ messageId: String, client: CaveClient,
               onConnectionFailure: ((Error) -> Void)? = nil,
               onChange: @escaping () -> Void) {
        guard let idx = messages.firstIndex(where: { $0.id == messageId }),
              messages[idx].role == .assistant,
              let familiarId = messages[idx].familiarId else { return }
        let source = messages[..<idx].last(where: { $0.role == .user })
        let prompt = source?.sendPrompt ?? source?.text ?? ""
        let retryModel = source?.retryModel(for: familiarId)
        let modelBinding = ChatModelTurnBinding.resolveRetry(
            retryModel: retryModel,
            originalScope: source?.modelOverrideScope
        )
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard requireSendProvenance(to: [familiarId]) else { return }
        mutate(messageId) {
            $0.serverTurnId = nil
            $0.text = ""; $0.isError = false; $0.streaming = true; $0.activity = nil
        }
        updatedAt = Date()
        onChange()
        Task { await self.stream(familiarId: familiarId, prompt: prompt,
                                 into: messageId,
                                 reasoningEffort: source?.reasoningEffort,
                                 responseSpeed: source?.responseSpeed,
                                 modelControls: source?.modelControls ?? [:],
                                 modelOverride: modelBinding.modelOverride,
                                 modelOverrideScope: modelBinding.scope,
                                 client: client, onChange: onChange,
                                 onConnectionFailure: onConnectionFailure) }
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
    /// In-memory ownership for every live familiar leg of a user turn. Normal
    /// group fan-out claims all targets synchronously before spawning tasks, so
    /// one fast offline failure cannot make queued replay duplicate a sibling
    /// task that has not started executing yet. This is intentionally not
    /// persisted: after hydration, stable run ids reconcile any interrupted leg.
    @ObservationIgnored private var activeDeliveries: [String: [String: String]] = [:]

    private func claimActiveDelivery(userMessageId: String, familiarId: String,
                                     runId: String) -> Bool {
        var familiars = activeDeliveries[userMessageId] ?? [:]
        guard familiars[familiarId] == nil else { return false }
        familiars[familiarId] = runId
        activeDeliveries[userMessageId] = familiars
        return true
    }

    private func releaseActiveDelivery(userMessageId: String, familiarId: String,
                                       runId: String) {
        guard var familiars = activeDeliveries[userMessageId] else { return }
        // A stale task must not release a newer retry that owns the same leg.
        guard familiars[familiarId] == runId else { return }
        familiars.removeValue(forKey: familiarId)
        if familiars.isEmpty {
            activeDeliveries.removeValue(forKey: userMessageId)
        } else {
            activeDeliveries[userMessageId] = familiars
        }
    }

    private func isActiveDelivery(userMessageId: String, familiarId: String) -> Bool {
        activeDeliveries[userMessageId]?[familiarId] != nil
    }

    private func ownsActiveDelivery(userMessageId: String, familiarId: String,
                                    runId: String) -> Bool {
        activeDeliveries[userMessageId]?[familiarId] == runId
    }

    /// Revoke one live fan-out leg that was checkpointed but never reached the
    /// network. The matching run id is part of the guard: an obsolete child
    /// task must never erase a newer retry for the same familiar. Sibling
    /// delivery markers and completions remain intact for exact reconciliation.
    @discardableResult
    func rollbackLiveDeliveryBeforeDispatch(
        userMessageId: String,
        familiarId: String,
        messageId: String,
        runId: String
    ) -> Bool {
        guard let userMessage = messages.first(where: { $0.id == userMessageId }),
              userMessage.queuedRunIdsByFamiliarId?[familiarId] == runId,
              userMessage.queuedAttemptedFamiliarIds?.contains(familiarId) == true
        else { return false }

        messages.removeAll { $0.id == messageId }
        mutate(userMessageId) {
            $0.queued = true
            $0.queuedDispatchInFlight = false
            var runIds = $0.queuedRunIdsByFamiliarId ?? [:]
            if runIds[familiarId] == runId {
                runIds.removeValue(forKey: familiarId)
            }
            $0.queuedRunIdsByFamiliarId = runIds.isEmpty ? nil : runIds
            var attemptedIds = Set($0.queuedAttemptedFamiliarIds ?? [])
            attemptedIds.remove(familiarId)
            $0.queuedAttemptedFamiliarIds = attemptedIds.isEmpty
                ? nil
                : attemptedIds.sorted()
        }
        updatedAt = Date()
        return true
    }

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

    @discardableResult
    private func stream(familiarId: String, prompt: String,
                        attachments: [CaveClient.ChatAttachment] = [], into messageId: String,
                        userMessageId: String? = nil,
                        reasoningEffort: ChatThinkingEffort? = nil,
                        responseSpeed: ChatResponseSpeed? = nil,
                        modelControls: [String: String] = [:],
                        modelOverride: String? = nil,
                        modelOverrideScope: ChatModelOverrideScope? = nil,
                        runId suppliedRunId: String? = nil,
                        activeDeliveryClaimed: Bool = false,
                        liveDispatchLeaseIsCurrent: (() -> Bool)? = nil,
                        persistAfterProvablyUnsentRollback: (() async -> Bool)? = nil,
                        client: CaveClient, onChange: @escaping () -> Void,
                        onStreamResult: ((ChatSendResult) -> Void)? = nil,
                        onConnectionFailure: ((Error) -> Void)? = nil,
                        onDeliverySettled: (() -> Void)? = nil) async -> ChatSendOutcome {
        // Per-send token: the server keys its resumable run buffer under this
        // (cave-h40l), so even a brand-new chat (no sessionId yet) can
        // re-attach mid-turn after a transport drop. Queued replay supplies a
        // durably persisted token; ordinary sends mint one here.
        let runId = suppliedRunId ?? UUID().uuidString
        var ownsActiveDelivery = false
        if let userMessageId {
            if activeDeliveryClaimed {
                guard self.ownsActiveDelivery(
                    userMessageId: userMessageId,
                    familiarId: familiarId,
                    runId: runId
                ) else { return .noAcknowledgement }
                ownsActiveDelivery = true
            } else {
                guard claimActiveDelivery(
                    userMessageId: userMessageId,
                    familiarId: familiarId,
                    runId: runId
                ) else { return .noAcknowledgement }
                ownsActiveDelivery = true
            }
        }
        defer {
            if ownsActiveDelivery, let userMessageId {
                releaseActiveDelivery(
                    userMessageId: userMessageId,
                    familiarId: familiarId,
                    runId: runId
                )
            }
            onDeliverySettled?()
        }

        guard !Task.isCancelled else { return .cancelled }

        // A live send can suspend while its durability checkpoint reaches disk.
        // Re-pairing or disconnecting during that await revokes the captured
        // endpoint. Check again inside every fan-out child, immediately before
        // request construction/network setup, so a late-scheduled sibling
        // cannot POST through the old CaveClient. This rollback is one leg only.
        if let liveDispatchLeaseIsCurrent, !liveDispatchLeaseIsCurrent() {
            guard let userMessageId,
                  rollbackLiveDeliveryBeforeDispatch(
                      userMessageId: userMessageId,
                      familiarId: familiarId,
                      messageId: messageId,
                      runId: runId
                  ) else { return .cancelled }
            onChange()
            if let persistAfterProvablyUnsentRollback {
                _ = await persistAfterProvablyUnsentRollback()
            }
            return .queued
        }

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
        ) else {
            mutate(messageId) {
                $0.text = "Cave couldn’t start this delivery. It will retry when its chat context is available."
                $0.isError = true
                $0.streaming = false
            }
            if let userMessageId {
                mutate(userMessageId) { $0.queuedDispatchInFlight = false }
            }
            updatedAt = Date()
            onChange()
            return .noAcknowledgement
        }
        var receivedAnyEvent = false
        // Resume cursor: the last applied frame's SSE id (run-buffer seq).
        var cursor = 0
        var sawDone = false
        var outcome = ChatSendOutcome.noAcknowledgement
        let coalescer = StreamCoalescer()
        do {
            for try await frame in client.sendStream(
                body,
                preflight: { liveDispatchLeaseIsCurrent?() ?? true },
                onRequestStarted: {
                    ChatTurnNotifier.shared.turnStarted(
                        thread: self,
                        familiarId: familiarId,
                        messageId: messageId
                    )
                }
            ) {
                receivedAnyEvent = true
                apply(frame.event, into: messageId, familiarId: familiarId,
                      userMessageId: userMessageId,
                      sawDone: &sawDone, coalescer: coalescer, onChange: onChange)
                if let id = frame.id { cursor = id }
            }
            // A complete chat stream always carries `.done`. URLSession can
            // otherwise report a graceful EOF when a proxy/backend disappears,
            // which used to turn a truncated partial answer into an
            // acknowledged success and leave AppModel falsely connected.
            guard sawDone else { throw URLError(.networkConnectionLost) }
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
            if error is CaveClient.SendPreflightRevoked {
                guard let userMessageId,
                      rollbackLiveDeliveryBeforeDispatch(
                          userMessageId: userMessageId,
                          familiarId: familiarId,
                          messageId: messageId,
                          runId: runId
                      ) else { return .cancelled }
                onChange()
                if let persistAfterProvablyUnsentRollback {
                    _ = await persistAfterProvablyUnsentRollback()
                }
                let result = ChatSendResult(
                    familiarId: familiarId,
                    userMessageId: userMessageId,
                    assistantMessageId: messageId,
                    outcome: .queued
                )
                onStreamResult?(result)
                return .queued
            }
            if error is CancellationError || Task.isCancelled {
                mutate(messageId) { $0.streaming = false }
                outcome = .cancelled
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
                return outcome
            }
            let serverError = error as? CaveError
            // These connect-level errors plus zero response frames prove that
            // the POST never reached Cave. Later recovery GETs can fail for the
            // same offline reason, but that cannot erase the stronger original
            // evidence and turn an auto-replayable send into manual retry.
            let deliveryProvenUnsent = !receivedAnyEvent
                && Self.isOfflineTransportError(error)
            var recovery = InterruptedStreamRecovery(accepted: receivedAnyEvent)
            var recoveryError: Error?
            if serverError?.isDefinitiveServerResponse != true {
                do {
                    recovery.merge(try await resumeInterruptedStream(
                        runId: runId,
                        cursor: cursor,
                        into: messageId,
                        familiarId: familiarId,
                        userMessageId: userMessageId,
                        sawDone: &sawDone,
                        coalescer: coalescer,
                        client: client,
                        onChange: onChange
                    ))
                    try Task.checkCancellation()
                    if !recovery.completed {
                        switch try await resyncInterruptedTurn(
                            familiarId: familiarId,
                            runId: runId,
                            into: messageId,
                            userMessageId: userMessageId,
                            client: client
                        ) {
                        case .completed:
                            recovery.completed = true
                            recovery.accepted = true
                        case .pending:
                            // The exact run-id user turn exists server-side. Its
                            // reply is not yet adoptable, but automatic reposting is
                            // forbidden because the original delivery was accepted.
                            recovery.accepted = true
                        case .absent:
                            break
                        }
                    }
                    try Task.checkCancellation()
                } catch is CancellationError {
                    mutate(messageId) { $0.streaming = false }
                    outcome = .cancelled
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
                    return outcome
                } catch {
                    recoveryError = error
                }
            }
            if let recoveryError,
               !(deliveryProvenUnsent && !recovery.accepted) {
                // The POST/run may have been accepted, but exact transcript
                // adoption is temporarily unavailable. Keep the durable run id
                // and queued bit so the next reconnect performs another GET/
                // resume; never turn this uncertainty into an automatic repost.
                applyProjectRecovery(for: recoveryError)
                onConnectionFailure?(recoveryError)
                mutate(messageId) { $0.streaming = false }
                outcome = .noAcknowledgement
            } else if !recovery.completed {
                applyProjectRecovery(for: error)
                onConnectionFailure?(error)
                if let userMessageId, !recovery.accepted, deliveryProvenUnsent {
                    // The send never reached the server (no route, DNS failure,
                    // refused connection — and not a single SSE event came
                    // back): queue the prompt for the next reconnect instead
                    // of dead-ending in a red bubble. Ambiguous failures
                    // (timeouts, drops after first byte) stay on the error
                    // path — replaying those could double the turn.
                    //
                    // A group's shared user bubble is one message over several
                    // sessions. If THIS familiar's reply for the turn already
                    // sits in the thread settled — a re-attempt of a leg that
                    // already produced its reply — removing it and re-queueing
                    // the shared bubble would hand the next replay a duplicate
                    // adoption target (cave-bm3qq). The leg is already done:
                    // leave the reply where it is, and the queue clears when
                    // the remaining legs settle.
                    let alreadySettled = settledReplyExists(
                        after: userMessageId,
                        familiarId: familiarId,
                        excluding: messageId
                    )
                    messages.removeAll { $0.id == messageId }
                    if !alreadySettled {
                        mutate(userMessageId) {
                            $0.queued = true
                            $0.queuedDispatchInFlight = false
                            var runIds = $0.queuedRunIdsByFamiliarId ?? [:]
                            runIds.removeValue(forKey: familiarId)
                            $0.queuedRunIdsByFamiliarId = runIds.isEmpty ? nil : runIds
                            var attemptedIds = Set($0.queuedAttemptedFamiliarIds ?? [])
                            attemptedIds.remove(familiarId)
                            $0.queuedAttemptedFamiliarIds = attemptedIds.isEmpty
                                ? nil
                                : attemptedIds.sorted()
                        }
                        // A leg whose reply already sits in the thread settled
                        // must not be re-queued for replay: its bubble is
                        // already on screen, and a fresh replay would re-adopt
                        // it into a second bubble for the same server turn
                        // (cave-bm3qq). The shared bubble stays queued only for
                        // the legs still pending, and a settled leg never
                        // re-enters the queue.
                        // The attempted marker was checkpointed before POST.
                        // This transport class proves the POST never left the
                        // phone, so make its removal durable immediately;
                        // degraded state blocks AppModel's follow-up queue
                        // flush and iOS may suspend before the ordinary 400ms
                        // onChange debounce fires.
                        if let persistAfterProvablyUnsentRollback {
                            _ = await persistAfterProvablyUnsentRollback()
                        }
                    }
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
                    receivedAnyEvent: recovery.accepted,
                    sawDone: sawDone
                )
            }
        }
        if outcome.completesQueuedFanOutLeg,
           let userMessageId,
           let assistant = messages.first(where: { $0.id == messageId }),
           !assistant.streaming {
            markQueuedFamiliarCompleted(userMessageId, familiarId: familiarId)
            if activeDeliveryClaimed {
                clearQueuedDeliveryIfComplete(userMessageId)
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
        return outcome
    }

    /// Apply one stream event to the thread — shared by the original send
    /// stream and the mid-turn resume stream so both render identically.
    private func apply(_ event: StreamEvent, into messageId: String, familiarId: String,
                       userMessageId: String?,
                       sawDone: inout Bool, coalescer: StreamCoalescer, onChange: @escaping () -> Void) {
        switch event {
        case .session(let sid):
            if !sid.isEmpty {
                sessionIds[familiarId] = sid
                // Persist the address needed for exact run-id reconciliation
                // as soon as the server names a new conversation.
                onChange()
            }
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
    private struct InterruptedStreamRecovery {
        var completed = false
        var accepted = false

        mutating func merge(_ other: InterruptedStreamRecovery) {
            completed = completed || other.completed
            accepted = accepted || other.accepted
        }
    }

    private static func isResumeGap(_ event: StreamEvent) -> Bool {
        guard case .progress(let id, _, _, _, _) = event else { return false }
        return id == "resume-gap"
    }

    private func resumeInterruptedStream(runId: String, cursor: Int, into messageId: String,
                                         familiarId: String, userMessageId: String?,
                                         sawDone: inout Bool,
                                         coalescer: StreamCoalescer,
                                         client: CaveClient, onChange: @escaping () -> Void) async throws -> InterruptedStreamRecovery {
        var nextCursor = cursor
        var recovery = InterruptedStreamRecovery()
        var sawResumeGap = false
        for attempt in 0..<3 {
            if attempt > 0 {
                try await Task.sleep(for: .milliseconds(600 * Int64(attempt)))
            }
            try Task.checkCancellation()
            do {
                for try await frame in client.resumeStream(runId: runId, cursor: nextCursor) {
                    try Task.checkCancellation()
                    recovery.accepted = true
                    if Self.isResumeGap(frame.event) { sawResumeGap = true }
                    apply(frame.event, into: messageId, familiarId: familiarId,
                          userMessageId: userMessageId,
                          sawDone: &sawDone, coalescer: coalescer, onChange: onChange)
                    if let id = frame.id { nextCursor = id }
                }
                try Task.checkCancellation()
                // A normal 2xx resume that closes without frames still proves
                // the exact run buffer existed (it may have been reaped between
                // the route's existence probe and subscription). That evidence
                // forbids clearing the run marker and automatically POSTing it.
                recovery.accepted = true
                flush(coalescer, into: messageId, onChange: onChange)
                // The resume stream closes when the run finishes. Without a
                // done event the run may still be live (our tail dropped
                // again) — retry from the advanced cursor.
                if sawDone {
                    if !sawResumeGap {
                        mutate(messageId) { $0.streaming = false }
                        recovery.completed = true
                    }
                    return recovery
                }
            } catch is CaveClient.NoResumableRun {
                flush(coalescer, into: messageId, onChange: onChange)
                // Nothing buffered under that run — turn ended long ago or
                // the server restarted. Post-hoc resync owns recovery.
                return recovery
            } catch {
                if error is CancellationError || Task.isCancelled {
                    throw CancellationError()
                }
                flush(coalescer, into: messageId, onChange: onChange)
                // Transport still flaky — back off and retry from the cursor.
            }
        }
        return recovery
    }

    /// After a transport failure mid-stream, pull the persisted conversation
    /// and adopt the server's copy of this exact client delivery. Prompt text
    /// is deliberately irrelevant: repeated prompts are separate turns, while
    /// `attentionClearOperationId` is the run id persisted on the user turn.
    private func resyncInterruptedTurn(familiarId: String, runId: String, into messageId: String,
                                       userMessageId: String?,
                                       client: CaveClient) async throws -> PersistedQueuedRun {
        // Give the server a beat to flush the transcript after the drop.
        try await Task.sleep(for: .milliseconds(600))
        try Task.checkCancellation()
        return try await adoptServerTurnIfPresent(
            runId: runId,
            familiarId: familiarId,
            into: messageId,
            userMessageId: userMessageId,
            client: client
        )
    }

    private enum PersistedQueuedRun: Equatable {
        case absent
        case pending
        case completed
    }

    private enum QueuedRunReconciliation {
        case completed
        case unconfirmed
        case retryLater(Error)
    }

    /// An attempted queued run is never POSTed twice. First re-attach to the
    /// server's run buffer by its stable id; if the buffer aged out, reconcile
    /// the exact id persisted on the conversation's user turn. A missing or
    /// incomplete accepted run becomes a visible manual-retry result rather
    /// than an automatic duplicate.
    private func reconcileQueuedRun(
        runId: String,
        familiarId: String,
        into messageId: String,
        userMessageId: String,
        client: CaveClient,
        onChange: @escaping () -> Void
    ) async -> QueuedRunReconciliation {
        var sawDone = false
        var sawResumeGap = false
        let coalescer = StreamCoalescer()
        do {
            for try await frame in client.resumeStream(runId: runId, cursor: 0) {
                try Task.checkCancellation()
                if Self.isResumeGap(frame.event) { sawResumeGap = true }
                apply(
                    frame.event,
                    into: messageId,
                    familiarId: familiarId,
                    userMessageId: userMessageId,
                    sawDone: &sawDone,
                    coalescer: coalescer,
                    onChange: onChange
                )
            }
            try Task.checkCancellation()
            flush(coalescer, into: messageId, onChange: onChange)
            guard sawDone else {
                return .retryLater(URLError(.networkConnectionLost))
            }
            if !sawResumeGap {
                mutate(messageId) {
                    $0.streaming = false
                    if let settled = ActivityFold.settle($0.activitySteps, success: !$0.isError) {
                        $0.activity = settled
                    }
                }
                return .completed
            }
            // A retained run-buffer tail can contain `.done` while its earlier
            // text was evicted. Only the exact persisted conversation is a
            // complete reply in that case; fall through to adopt it by run id.
        } catch is CaveClient.NoResumableRun {
            flush(coalescer, into: messageId, onChange: onChange)
        } catch {
            flush(coalescer, into: messageId, onChange: onChange)
            return .retryLater(error)
        }

        do {
            switch try await adoptServerTurnIfPresent(
                runId: runId,
                familiarId: familiarId,
                into: messageId,
                userMessageId: userMessageId,
                client: client
            ) {
            case .completed:
                return .completed
            case .pending, .absent:
                return .unconfirmed
            }
        } catch CaveError.badResponse(404) {
            return .unconfirmed
        } catch {
            return .retryLater(error)
        }
    }

    /// Find a persisted user turn by its exact client run id and adopt only its
    /// direct assistant child. Conversation history is a tree, so proximity in
    /// the flat turn array is not proof that two turns belong together.
    private func adoptServerTurnIfPresent(
        runId: String,
        familiarId: String,
        into messageId: String,
        userMessageId: String?,
        client: CaveClient
    ) async throws -> PersistedQueuedRun {
        guard let sessionId = sessionIds[familiarId], !sessionId.isEmpty else {
            return .absent
        }
        guard let convo = try await client.conversation(sessionId: sessionId) else {
            return .absent
        }
        try Task.checkCancellation()
        guard let userIndex = convo.turns.lastIndex(where: {
            $0.role == "user" && $0.attentionClearOperationId == runId
        }) else {
            return .absent
        }
        let userTurn = convo.turns[userIndex]
        guard let reply = convo.turns.last(where: {
            $0.role == "assistant" && $0.parentId == userTurn.id
        }) else {
            return .pending
        }
        // A familiar whose session already owns this exact server turn must
        // never be re-adopted. The completion marker can lag the thread (a
        // snapshot written between a sibling's success and its durable
        // completed list, or a thread hydrated from a version that never
        // recorded one), so ownership is read from the thread itself: a second
        // bubble carrying `reply.id` would give this session's per-session
        // projection two replies for one server turn, and the prefix walk that
        // names later deletes would disagree forever (cave-bm3qq). The reply is
        // already on screen; fold away the empty shell this adoption was about
        // to fill and treat the leg as already settled.
        if messages.contains(where: {
            $0.id != messageId
                && $0.role == .assistant
                && $0.familiarId == familiarId
                && $0.serverTurnId == reply.id
        }) {
            if let shell = messages.first(where: { $0.id == messageId }),
               shell.serverTurnId == nil, shell.text.isEmpty, !shell.isError {
                messages.removeAll { $0.id == messageId }
            }
            return .completed
        }
        if let userMessageId {
            mutate(userMessageId) {
                $0.recordRetryModel(
                    reply.responseMetadata?.retryModel ?? userTurn.modelOverride,
                    for: familiarId
                )
            }
        }
        mutate(messageId) {
            $0.serverTurnId = reply.id
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
        return .completed
    }

    /// Connect-level failures where the request provably never reached the
    /// server — safe to queue without risking a duplicate turn. Anything
    /// ambiguous (timeouts, drops after first byte) is excluded: for those
    /// the resync/error path decides.
    nonisolated static func isOfflineTransportError(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost,
             .dnsLookupFailed, .dataNotAllowed,
             .internationalRoamingOff:
            return true
        default:
            return false
        }
    }

    /// Place replayed replies after their own user bubble and any earlier
    /// familiar replies, but before the next user turn. Keeping the current
    /// bubble queued for durability means "first queued message" is its own
    /// index and would invert assistant/user order.
    private func replayInsertionIndex(after userMessageId: String) -> Int? {
        guard let userIndex = messages.firstIndex(where: { $0.id == userMessageId }) else {
            return nil
        }
        let replyStart = messages.index(after: userIndex)
        return messages[replyStart..<messages.endIndex]
            .firstIndex(where: { $0.role == .user }) ?? messages.endIndex
    }

    /// Reuse the reply bubble that belongs to this exact queued user turn.
    /// Searching only until the next user keeps repeated prompts and later
    /// branches from borrowing each other's assistant placeholders.
    private func replayPlaceholder(after userMessageId: String,
                                   familiarId: String) -> DisplayMessage? {
        guard let userIndex = messages.firstIndex(where: { $0.id == userMessageId }) else {
            return nil
        }
        let replyStart = messages.index(after: userIndex)
        let replyEnd = messages[replyStart..<messages.endIndex]
            .firstIndex(where: { $0.role == .user }) ?? messages.endIndex
        return messages[replyStart..<replyEnd].last(where: {
            $0.role == .assistant && $0.familiarId == familiarId
        })
    }

    /// Does this thread already hold a settled assistant reply for this
    /// familiar, after the given user turn? The completion marker can lag the
    /// thread (a snapshot written between a sibling's success and its durable
    /// completed list, or a thread hydrated from a version that never recorded
    /// one), so the thread itself is the authority on whether a leg has already
    /// produced its reply. `excluding` names the bubble being filled right now,
    /// so a mid-flight stream's own shell is never read as a prior success.
    private func settledReplyExists(after userMessageId: String,
                                    familiarId: String,
                                    excluding messageId: String?) -> Bool {
        guard let userIndex = messages.firstIndex(where: { $0.id == userMessageId }),
              userIndex + 1 <= messages.endIndex else { return false }
        return messages[(userIndex + 1)...].contains { candidate in
            guard candidate.id != messageId,
                  candidate.role == .assistant,
                  candidate.familiarId == familiarId,
                  !candidate.streaming else { return false }
            if candidate.serverTurnId != nil { return true }
            return !candidate.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func markQueuedFamiliarCompleted(_ userMessageId: String, familiarId: String) {
        guard messages.first(where: { $0.id == userMessageId })?.isQueued == true else {
            return
        }
        mutate(userMessageId) {
            var completed = Set($0.queuedCompletedFamiliarIds ?? [])
            completed.insert(familiarId)
            $0.queuedCompletedFamiliarIds = completed.sorted()
        }
    }

    /// Online sends are also durable until every original fan-out leg settles.
    /// Clear that transient replay marker before result callbacks (notably the
    /// forwarded-thread hydration gate) observe the acknowledged user turn.
    private func clearQueuedDeliveryIfComplete(_ userMessageId: String) {
        guard let message = messages.first(where: { $0.id == userMessageId }),
              message.isQueued else { return }
        let targets = message.queuedTargetFamiliarIds
            ?? message.queuedRunIdsByFamiliarId.map { Array($0.keys) }
            ?? familiarIds
        let completed = Set(message.queuedCompletedFamiliarIds ?? [])
        guard Set(targets).isSubset(of: completed) else { return }
        mutate(userMessageId) {
            $0.queued = false
            $0.queuedDispatchInFlight = nil
            $0.queuedCompletedFamiliarIds = nil
            $0.queuedRunIdsByFamiliarId = nil
            $0.queuedAttemptedFamiliarIds = nil
            $0.queuedTargetFamiliarIds = nil
        }
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
        userMessageId _: String?,
        receivedAnyEvent: Bool,
        sawDone: Bool
    ) -> ChatSendOutcome {
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
