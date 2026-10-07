import Foundation

// MARK: - Familiar

/// A familiar as returned by `GET /api/familiars`.
struct Familiar: Identifiable, Codable, Hashable {
    let id: String
    var displayName: String
    var role: String?
    var description: String?
    var pronouns: String?
    var color: String?
    var status: String?
    var harness: String?
    var model: String?
    var icon: String?
    var avatarUrl: String?
    var activeSessions: Int?
    var memoryFreshness: String?
    /// Profile/configuration fields published by GET /api/familiars. These
    /// remain optional so a newer phone can still describe an older Cave
    /// truthfully as "Not set" instead of failing the entire roster decode.
    var familiarType: String? = nil
    var note: String? = nil
    var imageProvider: String? = nil
    var imageModel: String? = nil
    var imageSize: String? = nil
    var imageQuality: String? = nil
    var autoSelfReport: Bool? = nil
    /// Voice configuration published by Familiar Studio. All three remain
    /// optional so phones can decode familiars created before voice support.
    var voiceProvider: String? = nil
    var voiceModel: String? = nil
    var voiceName: String? = nil

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case role, description, pronouns, color, status, harness, model, icon
        case avatarUrl
        case activeSessions = "active_sessions"
        case memoryFreshness = "memory_freshness"
        case familiarType, note
        case voiceProvider, voiceModel, voiceName
        case imageProvider, imageModel, imageSize, imageQuality, autoSelfReport
    }
}

struct FamiliarsResponse: Codable {
    let ok: Bool
    let error: String?
    let familiars: [Familiar]
}

// MARK: - Theme

/// The desktop's published appearance (`GET /api/theme`). `tokens` are resolved
/// hex strings keyed by CSS custom-property name (e.g. `--bg-base`), so the app
/// can use them directly without knowing the desktop's CSS preset definitions.
struct ThemeSnapshot: Codable {
    var themeId: String
    var mode: String
    var tokens: [String: String]
    var updatedAt: String
}

struct ThemeResponse: Codable {
    let ok: Bool
    let theme: ThemeSnapshot
}

// MARK: - Sessions

struct FlowSessionReference: Codable, Hashable {
    let flowId: String
    let runId: String
    var missionId: String?
    var iteration: Int?
}

/// A chat session as returned by `GET /api/sessions/list`.
struct SessionRow: Identifiable, Codable, Hashable {
    let id: String
    var title: String
    var harness: String?
    var model: String?
    /// Concrete session runtime (`local:<cwd>` or `ssh:<host>:<cwd>`), when
    /// published by `/api/sessions/list`.
    var runtime: String?
    var status: String?
    var familiarId: String?
    var createdAt: String?
    var updatedAt: String?
    var archivedAt: String?
    /// Pinned by the user; chat lists sort pinned rows to the top. The server
    /// omits the key entirely when unpinned, so absence decodes as nil.
    var pinned: Bool? = nil
    /// Launch provenance for first-turn continuity across clients.
    var projectRoot: String? = nil
    /// Provenance from /api/sessions/list — generator surfaces (journal,
    /// canvas, cron, …) tag their runs so chat lists can hide them.
    var origin: String?
    /// Daemon-only runs the server flags as generated (not user chats).
    var generated: Bool?
    var flow: FlowSessionReference? = nil
    /// Server-authored "does this chat want something from you" evidence
    /// (`chat-attention.ts`). Absent from older servers, which reads as none.
    var attention: SessionAttention? = nil
    /// The pull request the chat's work produced, when the server resolved one
    /// (`SessionPullRequestContext` in `src/lib/types.ts`).
    var pullRequest: SessionPullRequest? = nil

    enum CodingKeys: String, CodingKey {
        case id, title, harness, model, runtime, status
        case familiarId
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case archivedAt = "archived_at"
        case pinned
        case projectRoot = "project_root"
        case origin, generated
        case flow
        case attention, pullRequest
    }

    var isFlowRun: Bool { origin == "flow" || flow != nil }

    /// Mirrors the web's isGeneratedChatSession (chat-projects.ts): generated
    /// runs stay out of thread lists. `enhance` is the one-shot utility lane
    /// (prompt enhance, reply recommendation, thread reflection); the web has
    /// always hidden it, and without it here every "Thread you just
    /// completed…" review run landed in the phone's chat list. Legacy journal
    /// runs predate the origin tag, so their exact machine-prompt titles match
    /// too — at the truncated lengths the store actually keeps.
    var isGeneratedRun: Bool {
        if generated == true || isFlowRun { return true }
        if let origin, ["cron", "heartbeat", "canvas", "journal", "enhance"].contains(origin) { return true }
        return title.hasPrefix("Write a short narrative of my day (")
            || title.hasPrefix("Write a short, first-person reflective journal entry")
    }

    /// Mirrors the web's isThreadReflectionSession (chat-projects.ts): a
    /// "Thread you just completed…" review run, the familiar's post-thread
    /// self-report (buildThreadReflectPrompt in thread-self-report.ts). It is
    /// still a generated run, so every list and count keeps excluding it; only
    /// the chat list's collapsed Reflections section gathers these, so they
    /// stay reachable without crowding live chats. Stored titles are cut from
    /// the prompt, so this matches the opener, not the whole prompt.
    var isThreadReflection: Bool {
        guard origin == "enhance" else { return false }
        if title.hasPrefix("Thread you just completed") { return true }
        return title.drop(while: \.isWhitespace).lowercased().hasPrefix("thread you just completed")
    }
}

struct SessionsResponse: Codable {
    let ok: Bool
    let degraded: Bool?
    let error: String?
    let sessions: [SessionRow]
}

// MARK: - Conversation history

/// Cave observations are display evidence, not authorization or committed-effect receipts.
struct ToolActivity: Codable, Hashable {
    struct Producer: Codable, Hashable {
        var harness: String
        var version: String?
        var `protocol`: String?
    }
    var schemaVersion: Int
    var runId: String
    var attemptId: String
    var callId: String
    var phase: String
    var source: String
    var producer: Producer
    var firstObservedAt: Int
    var sequence: Int? = nil
    var updatedAt: Int
    var executionObservedAt: Int?
    var terminalObservedAt: Int?
    var authority: [String: String]

    func validated(callId: String, status: String?) -> ToolActivity? {
        let phases = ["requested", "running", "ok", "error", "rejected", "unknown"]
        let token = #"^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$"#
        let version = #"^v?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$"#
        guard schemaVersion == 1, self.callId == callId, !callId.isEmpty, callId.utf16.count <= 512,
              UUID(uuidString: runId) != nil, UUID(uuidString: attemptId) != nil,
              phase == status, phases.contains(phase),
              ["runtime-report", "hook-report", "application"].contains(source),
              producer.harness.range(of: token, options: .regularExpression) != nil,
              producer.version.map({ $0.utf16.count <= 128 && $0.range(of: version, options: .regularExpression) != nil }) ?? true,
              producer.protocol.map({ $0.range(of: token, options: .regularExpression) != nil }) ?? true,
              firstObservedAt >= 0, updatedAt >= firstObservedAt, updatedAt <= 9_007_199_254_740_991,
              sequence.map({ $0 >= 0 && $0 <= 9_007_199_254_740_991 }) ?? true,
              authority == ["binding": "unavailable", "approval": "unavailable", "effect": "unavailable"] else { return nil }
        for time in [executionObservedAt, terminalObservedAt].compactMap({ $0 }) {
            guard time >= firstObservedAt, time <= updatedAt else { return nil }
        }
        guard (phase == "ok" || phase == "error" || phase == "rejected") == (terminalObservedAt != nil),
              phase != "requested" || executionObservedAt == nil,
              phase != "running" || executionObservedAt != nil else { return nil }
        if let start = executionObservedAt, let end = terminalObservedAt, start > end { return nil }
        return self
    }

    static func decode(_ value: Any?, callId: String?, status: String?) -> ToolActivity? {
        guard let value, let callId, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let activity = try? JSONDecoder().decode(ToolActivity.self, from: data) else { return nil }
        return activity.validated(callId: callId, status: status)
    }

    var sourceLabel: String {
        let label = source == "hook-report" ? "Hook report" : source == "application" ? "Cave observation" : "Runtime report"
        return "\(label) · \(producer.harness)\(producer.version.map { " \($0)" } ?? " · version unavailable")"
    }
}

extension ToolActivity {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decode(Int.self, forKey: .schemaVersion)
        runId = try values.decode(String.self, forKey: .runId)
        attemptId = try values.decode(String.self, forKey: .attemptId)
        callId = try values.decode(String.self, forKey: .callId)
        phase = try values.decode(String.self, forKey: .phase)
        source = try values.decode(String.self, forKey: .source)
        producer = try values.decode(Producer.self, forKey: .producer)
        firstObservedAt = try values.decode(Int.self, forKey: .firstObservedAt)
        updatedAt = try values.decode(Int.self, forKey: .updatedAt)
        executionObservedAt = try values.decodeIfPresent(Int.self, forKey: .executionObservedAt)
        terminalObservedAt = try values.decodeIfPresent(Int.self, forKey: .terminalObservedAt)
        authority = try values.decode([String: String].self, forKey: .authority)
        if values.contains(.sequence) { sequence = try values.decode(Int.self, forKey: .sequence) }
    }
}

struct ToolCall: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    var input: String?
    var output: String?
    var status: String?
    /// Wall-clock the server recorded when the call settled. Persisted with the
    /// turn, so a reloaded transcript keeps the timings a live turn showed.
    var durationMs: Int?
    var activity: ToolActivity? = nil
    var textOffset: Int? = nil
}

extension ToolCall {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        input = try values.decodeIfPresent(String.self, forKey: .input)
        output = try values.decodeIfPresent(String.self, forKey: .output)
        status = try values.decodeIfPresent(String.self, forKey: .status)
        durationMs = try values.decodeIfPresent(Int.self, forKey: .durationMs)
        activity = (try? values.decodeIfPresent(ToolActivity.self, forKey: .activity))?.validated(callId: id, status: status)
        if let offset = try? values.decode(Int.self, forKey: .textOffset), offset >= 0, offset <= 9_007_199_254_740_991 {
            textOffset = offset
        }
    }
}

struct TurnUsage: Codable, Hashable {
    var inputTokens: Int?
    var outputTokens: Int?
}

/// Safe response facts persisted by the server for transcript replay. These
/// are intentionally limited to display and retry state; provider credentials
/// and runtime configuration never cross the history boundary.
struct ChatRuntimeActivity: Codable, Hashable {
    var schemaVersion = 0
    var path = ""
    var tools = ""
    var reasoning = ""

    var validated: Self? {
        let states = ["supported", "partial", "unsupported", "unknown", "disabled"]
        guard schemaVersion == 1, ["direct", "coven", "ssh", "api", "gateway", "cli", "unknown"].contains(path),
              states.contains(tools), states.contains(reasoning) else { return nil }
        return self
    }

    var statusLines: [String] {
        guard validated != nil else { return ["Activity support: not recorded"] }
        let paths = ["direct": "Direct runtime", "coven": "Coven relay", "ssh": "SSH relay", "api": "API",
                     "gateway": "Gateway", "cli": "CLI bridge", "unknown": "Not yet selected"]
        let states = ["supported": "supported on this path", "partial": "partially supported on this path",
                      "unsupported": "not supported on this path", "unknown": "support unverified on this path",
                      "disabled": "decoding disabled for this turn"]
        return ["Runtime path: \(paths[path]!)", "Tool details: \(states[tools]!)", "Reasoning summaries: \(states[reasoning]!)"]
    }
}

extension ChatRuntimeActivity {
    init(from decoder: Decoder) throws {
        // A malformed optional report must not make a transcript unreadable.
        guard let values = try? decoder.container(keyedBy: CodingKeys.self) else { return }
        schemaVersion = (try? values.decode(Int.self, forKey: .schemaVersion)) ?? 0
        path = (try? values.decode(String.self, forKey: .path)) ?? ""
        tools = (try? values.decode(String.self, forKey: .tools)) ?? ""
        reasoning = (try? values.decode(String.self, forKey: .reasoning)) ?? ""
    }
}

struct ChatRuntimeIdentity: Codable, Hashable {
    var schemaVersion: Int
    var harness: String
    var version: String?
    var model: String?
    var activity: ChatRuntimeActivity? = nil

    /// Match the web display boundary: selection aliases, synthetic launch
    /// models and malformed optional fields are missing evidence.
    func validated(expectedHarness: String? = nil) -> ChatRuntimeIdentity? {
        guard schemaVersion == 1, !harness.isEmpty,
              expectedHarness == nil || expectedHarness == harness else { return nil }
        var value = self
        let version = version?.trimmingCharacters(in: .whitespacesAndNewlines)
        value.version = version?.range(of: #"^v?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$"#, options: .regularExpression) != nil ? version : nil
        let model = model?.trimmingCharacters(in: .whitespacesAndNewlines)
        let segments = model?.components(separatedBy: "/") ?? []
        let synthetic = ["codex-local", "claude-local", "copilot-local", "hermes-local", "grok-local", "openclaw-local", "\(harness)-local"]
        let aliases = ["default", "auto", "opus", "sonnet", "haiku", "latest", "unknown"]
        let safeModel = model != nil && model!.utf16.count <= 256 && !model!.contains("..")
            && segments.first?.range(of: #"^[A-Za-z0-9][A-Za-z0-9._:@+-]*$"#, options: .regularExpression) != nil
            && segments.dropFirst().allSatisfy { $0.range(of: #"^~?[A-Za-z0-9][A-Za-z0-9._:@+-]*$"#, options: .regularExpression) != nil }
            && !synthetic.contains(model!) && !aliases.contains(segments.last?.lowercased() ?? "")
        value.model = safeModel ? model : nil
        value.activity = activity?.validated
        return value
    }

    static func decode(_ value: Any?) -> ChatRuntimeIdentity? {
        guard let value, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let identity = try? JSONDecoder().decode(ChatRuntimeIdentity.self, from: data) else { return nil }
        return identity.validated()
    }

    static func decodeMetadata(_ metadata: [String: Any]?) -> ChatRuntimeIdentity? {
        guard let harness = metadata?["harness"] as? String else { return nil }
        return decode(metadata?["runtimeIdentity"])?.validated(expectedHarness: harness)
    }
}

extension ChatRuntimeIdentity {
    init(from decoder: Decoder) throws {
        let values = try? decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = (try? values?.decode(Int.self, forKey: .schemaVersion)) ?? 0
        harness = (try? values?.decode(String.self, forKey: .harness)) ?? ""
        version = try? values?.decode(String.self, forKey: .version)
        model = try? values?.decode(String.self, forKey: .model)
        activity = try? values?.decode(ChatRuntimeActivity.self, forKey: .activity)
    }
}

struct ChatTurnResponseMetadata: Codable, Hashable {
    var harness: String?
    /// Explicit user intent. An empty string is the durable runtime-default
    /// sentinel; nil means the turn had no explicit model selection.
    var requestedModel: String?
    /// Model selected by Cave after resolving familiar/session/runtime scope.
    var desiredModel: String?
    /// Native/runtime id handed to the launch boundary after Cave's transform.
    var forwardedModel: String?
    /// Model the runtime actually confirmed, when the transport can prove it.
    var confirmedModel: String?
    var modelSource: String?
    var modelApplicationState: String?
    /// Safe, user-visible explanation for a pending, rejected, or degraded
    /// model application. Provider payloads never cross this boundary.
    var modelApplicationReason: String?
    var retryModel: String?
    var requestedControls: [String: String]?
    var forwardedControls: [String: String]?
    var promptGuidanceControls: [String: String]?
    var appliedControls: [String: String]?
    var rejectedControlFamilies: [String]?
    var runtimeIdentity: ChatRuntimeIdentity?

    var reportedRuntimeIdentity: ChatRuntimeIdentity? {
        guard let harness else { return nil }
        return runtimeIdentity?.validated(expectedHarness: harness)
    }
}

/// Provider-visible summaries, separate from tool outcomes and opaque reasoning state.
struct ChatReasoningBlock: Codable, Hashable, Identifiable {
    struct Observation: Codable, Hashable {
        var runId: String
        var attemptId: String
        var source: String
        var producer: ToolActivity.Producer
        var firstObservedAt: Int
        var sequence: Int? = nil
        var updatedAt: Int
        var completedAt: Int?
        var binding: String
    }
    var schemaVersion = 0
    var id = ""
    var representation = ""
    var phase = ""
    var text: String?
    var textOffset: Int? = nil
    var disclosure = ""
    var unavailableReason: String?
    var observation: Observation?

    var validated: ChatReasoningBlock? {
        guard schemaVersion == 1, !id.isEmpty, id.utf16.count <= 512,
              ["provider-summary", "provider-progress", "application-activity", "legacy-unverified"].contains(representation),
              ["running", "complete", "unavailable"].contains(phase),
              ["display-safe", "withheld"].contains(disclosure), let observation,
              UUID(uuidString: observation.runId) != nil, UUID(uuidString: observation.attemptId) != nil,
              id.hasPrefix(observation.attemptId + ":"), observation.binding == "unavailable",
              ["runtime-report", "application"].contains(observation.source),
              observation.firstObservedAt >= 0, observation.updatedAt >= observation.firstObservedAt,
              observation.sequence.map({ $0 >= 0 && $0 <= 9_007_199_254_740_991 }) ?? true,
              textOffset.map({ $0 >= 0 && $0 <= 9_007_199_254_740_991 }) ?? true,
              observation.updatedAt <= 9_007_199_254_740_991 else { return nil }
        let token = #"^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$"#
        guard observation.producer.harness.range(of: token, options: .regularExpression) != nil,
              observation.producer.protocol.map({ $0.range(of: token, options: .regularExpression) != nil }) ?? true,
              observation.producer.version.map({ $0.utf16.count <= 128 && $0.range(of: #"^v?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$"#, options: .regularExpression) != nil }) ?? true else { return nil }
        if phase == "complete" {
            guard let end = observation.completedAt, end >= observation.firstObservedAt, end <= observation.updatedAt else { return nil }
        } else if observation.completedAt != nil || disclosure != "withheld" { return nil }
        if disclosure == "withheld" { guard text == nil else { return nil } }
        else { guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf16.count <= 16_384 else { return nil } }
        if let unavailableReason {
            guard unavailableReason == "provider-withheld", phase == "unavailable", observation.source == "runtime-report" else { return nil }
        }
        return self
    }

    static func decode(_ value: Any?) -> ChatReasoningBlock? {
        guard let value, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let block = try? JSONDecoder().decode(Self.self, from: data) else { return nil }
        return block.validated
    }

    static func merging(_ blocks: [ChatReasoningBlock]?, _ incoming: ChatReasoningBlock) -> [ChatReasoningBlock] {
        let blocks = blocks ?? []
        guard let incoming = incoming.validated else { return blocks }
        if let index = blocks.firstIndex(where: { $0.id == incoming.id }) {
            let previous = blocks[index]
            if previous.phase == "complete" || previous.phase == "unavailable" && incoming.phase == "running" { return blocks }
            var updated = blocks; updated[index] = incoming; return updated
        }
        return Array((blocks + [incoming]).prefix(64))
    }
}

extension ChatReasoningBlock {
    init(from decoder: Decoder) throws {
        // Future/malformed optional blocks cannot make an old transcript unreadable.
        guard let values = try? decoder.container(keyedBy: CodingKeys.self) else { return }
        schemaVersion = (try? values.decode(Int.self, forKey: .schemaVersion)) ?? 0
        id = (try? values.decode(String.self, forKey: .id)) ?? ""
        representation = (try? values.decode(String.self, forKey: .representation)) ?? ""
        phase = (try? values.decode(String.self, forKey: .phase)) ?? ""
        text = try? values.decodeIfPresent(String.self, forKey: .text)
        if values.contains(.textOffset) { textOffset = (try? values.decode(Int.self, forKey: .textOffset)) ?? -1 }
        disclosure = (try? values.decode(String.self, forKey: .disclosure)) ?? ""
        if values.contains(.unavailableReason) {
            unavailableReason = (try? values.decode(String.self, forKey: .unavailableReason)) ?? "invalid"
        }
        observation = try? values.decodeIfPresent(Observation.self, forKey: .observation)
    }
}

extension ChatReasoningBlock.Observation {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        runId = try values.decode(String.self, forKey: .runId)
        attemptId = try values.decode(String.self, forKey: .attemptId)
        source = try values.decode(String.self, forKey: .source)
        producer = try values.decode(ToolActivity.Producer.self, forKey: .producer)
        firstObservedAt = try values.decode(Int.self, forKey: .firstObservedAt)
        updatedAt = try values.decode(Int.self, forKey: .updatedAt)
        completedAt = try values.decodeIfPresent(Int.self, forKey: .completedAt)
        binding = try values.decode(String.self, forKey: .binding)
        if values.contains(.sequence) { sequence = try values.decode(Int.self, forKey: .sequence) }
    }
}

/// One message turn within a conversation.
struct ChatTurn: Identifiable, Codable, Hashable {
    let id: String
    var role: String           // "user" | "assistant" | "system"
    var text: String
    var reasoning: String?
    var reasoningBlocks: [ChatReasoningBlock]? = nil
    var tools: [ToolCall]?
    var createdAt: String?
    var isError: Bool?
    var usage: TurnUsage?
    /// Response controls persisted on user turns so refresh and retry retain
    /// the exact turn semantics. Older conversations decode these as nil.
    var reasoningEffort: ChatThinkingEffort?
    var responseSpeed: ChatResponseSpeed?
    var modelControls: [String: String]?
    var modelOverride: String?
    var modelOverrideScope: ChatModelOverrideScope?
    var responseMetadata: ChatTurnResponseMetadata?
    /// Exact client delivery identity persisted by the desktop on the user
    /// turn. Queued replay uses it instead of unsafe prompt-text matching.
    var attentionClearOperationId: String?
    /// Conversation-tree parent. The reply for an interrupted delivery is
    /// adopted only when this points at the exact run-owned user turn.
    var parentId: String?

    enum CodingKeys: String, CodingKey {
        case id, role, text, reasoning, reasoningBlocks, tools
        case createdAt
        case isError
        case usage
        case reasoningEffort, responseSpeed, modelControls, modelOverride, modelOverrideScope, responseMetadata
        case attentionClearOperationId, parentId
    }
}

struct Conversation: Codable {
    var sessionId: String
    var familiarId: String?
    var harness: String?
    var model: String?
    var title: String?
    var createdAt: String?
    var updatedAt: String?
    var turns: [ChatTurn]
}

struct ConversationResponse: Codable {
    let ok: Bool
    let error: String?
    let conversation: Conversation?
}

// MARK: - Chat status evidence

/// `ChatAttention` from `src/lib/chat-attention.ts`. Decoding never throws: a
/// malformed or future-shaped value reads as "no attention" instead of
/// failing the whole session list.
struct SessionAttention: Codable, Hashable {
    /// `none`, `left-hanging`, `awaiting-human` or `overdue-human`.
    var state: String
    var since: String?
    /// `input`, `decision`, `approval` or `credentials`.
    var reason: String?

    init(state: String, since: String? = nil, reason: String? = nil) {
        self.state = state
        self.since = since
        self.reason = reason
    }

    private enum CodingKeys: String, CodingKey { case state, since, reason }

    init(from decoder: Decoder) throws {
        let values = try? decoder.container(keyedBy: CodingKeys.self)
        state = (try? values?.decodeIfPresent(String.self, forKey: .state)) ?? "none"
        since = (try? values?.decodeIfPresent(String.self, forKey: .since)) ?? nil
        reason = (try? values?.decodeIfPresent(String.self, forKey: .reason)) ?? nil
    }
}

/// `SessionPullRequestContext` from `src/lib/types.ts`. Decoding never throws.
struct SessionPullRequest: Codable, Hashable {
    var repo: String?
    var number: Int?
    var url: String?
    /// GitHub's word (`open`, `merged`, `closed`, `draft`) when the server
    /// verified it; anything else claims only that a PR exists.
    var state: String?
    var draft: Bool?
    /// `branch` (authoritative) or `transcript` (the chat reported the URL).
    var attribution: String?

    init(repo: String? = nil, number: Int? = nil, url: String? = nil,
         state: String? = nil, draft: Bool? = nil, attribution: String? = nil) {
        self.repo = repo
        self.number = number
        self.url = url
        self.state = state
        self.draft = draft
        self.attribution = attribution
    }

    private enum CodingKeys: String, CodingKey { case repo, number, url, state, draft, attribution }

    init(from decoder: Decoder) throws {
        let values = try? decoder.container(keyedBy: CodingKeys.self)
        repo = (try? values?.decodeIfPresent(String.self, forKey: .repo)) ?? nil
        number = (try? values?.decodeIfPresent(Int.self, forKey: .number)) ?? nil
        url = (try? values?.decodeIfPresent(String.self, forKey: .url)) ?? nil
        state = (try? values?.decodeIfPresent(String.self, forKey: .state)) ?? nil
        draft = (try? values?.decodeIfPresent(Bool.self, forKey: .draft)) ?? nil
        attribution = (try? values?.decodeIfPresent(String.self, forKey: .attribution)) ?? nil
    }
}
