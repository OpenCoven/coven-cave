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

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case role, description, pronouns, color, status, harness, model, icon
        case avatarUrl
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

    enum CodingKeys: String, CodingKey {
        case id, title, harness, model, status
        case familiarId
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case archivedAt = "archived_at"
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

    enum CodingKeys: String, CodingKey {
        case id, role, text, reasoning, tools
        case createdAt
        case isError
        case usage
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
