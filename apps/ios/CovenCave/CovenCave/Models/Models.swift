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
        case voiceProvider, voiceModel, voiceName
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

/// A chat session as returned by `GET /api/sessions/list`.
struct SessionRow: Identifiable, Codable, Hashable {
    let id: String
    var title: String
    var harness: String?
    var model: String?
    var status: String?
    var familiarId: String?
    var createdAt: String?
    var updatedAt: String?
    var archivedAt: String?
    /// Launch provenance for first-turn continuity across clients.
    var projectRoot: String? = nil
    /// Provenance from /api/sessions/list — generator surfaces (journal,
    /// canvas, cron, …) tag their runs so chat lists can hide them.
    var origin: String?
    /// Daemon-only runs the server flags as generated (not user chats).
    var generated: Bool?

    enum CodingKeys: String, CodingKey {
        case id, title, harness, model, status
        case familiarId
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case archivedAt = "archived_at"
        case projectRoot = "project_root"
        case origin, generated
    }

    /// Mirrors the web's isGeneratedChatSession (chat-projects.ts): generated
    /// runs stay out of thread lists. Legacy journal runs predate the origin
    /// tag, so their exact machine-prompt titles match too — at the truncated
    /// lengths the store actually keeps.
    var isGeneratedRun: Bool {
        if generated == true { return true }
        if let origin, ["cron", "heartbeat", "canvas", "journal"].contains(origin) { return true }
        return title.hasPrefix("Write a short narrative of my day (")
            || title.hasPrefix("Write a short, first-person reflective journal entry")
    }
}

struct SessionsResponse: Codable {
    let ok: Bool
    let degraded: Bool?
    let error: String?
    let sessions: [SessionRow]
}

// MARK: - Conversation history

struct ToolCall: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    var input: String?
    var output: String?
    var status: String?
}

struct TurnUsage: Codable, Hashable {
    var inputTokens: Int?
    var outputTokens: Int?
}

/// One message turn within a conversation.
struct ChatTurn: Identifiable, Codable, Hashable {
    let id: String
    var role: String           // "user" | "assistant" | "system"
    var text: String
    var reasoning: String?
    var tools: [ToolCall]?
    var createdAt: String?
    var isError: Bool?
    var usage: TurnUsage?
    /// Response controls persisted on user turns so refresh and retry retain
    /// the exact turn semantics. Older conversations decode these as nil.
    var reasoningEffort: ChatThinkingEffort?
    var responseSpeed: ChatResponseSpeed?
    var modelOverride: String?

    enum CodingKeys: String, CodingKey {
        case id, role, text, reasoning, tools
        case createdAt
        case isError
        case usage
        case reasoningEffort, responseSpeed, modelOverride
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
