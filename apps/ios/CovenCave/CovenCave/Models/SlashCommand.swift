import Foundation

/// Native slash-command catalog for the iOS app.
///
/// Mirrors the web/TUI vocabulary (`src/lib/slash-commands.ts` →
/// `coven/crates/coven-cli/src/tui/chat/app.rs`) so a muscle-memory `/clear`,
/// `/board`, `/save …` does the same thing on the phone as on the desktop.
/// Aliases are first-class: `/h`, `/cls`, `/q` resolve to their canonical command.
///
/// Each command also carries an `action` (what it does on mobile) and an
/// `availability`. Commands whose surface only exists on the desktop are still
/// recognised and answered with an honest redirect rather than being silently
/// sent to the familiar as text, but they are not shown in mobile command lists.
struct SlashCommand: Identifiable, Hashable {
    enum Section: String, CaseIterable {
        case chat, familiar, daemon, view, launch

        var label: String {
            switch self {
            case .chat: return "Chat"
            case .familiar: return "Familiars"
            case .daemon: return "Daemon"
            case .view: return "View / Sessions"
            case .launch: return "Launch"
            }
        }
    }

    /// Whether the command has a real surface on mobile, or politely redirects.
    enum Availability { case native, desktopOnly }

    /// What dispatch should do when this command runs.
    enum Action: Hashable {
        case help                  // present the Commands reference sheet
        case clearTranscript
        case quitToList            // pop back to the chat list
        case newChat               // start a fresh chat with the same familiar(s)
        case familiarPicker        // switch familiar (arg = name) or open the picker
        case openSessions          // jump to the Chats list
        case openBoard             // switch to the Tasks tab
        case openDeveloper(String) // switch to Developer and select a section
        case sendAsPrompt          // /run /codex /claude — send the args as a message
        case saveLink              // /save <url> … — route a URL into the library
        case daemonStatus          // /daemon — fetch + show status inline
        case doctor                // /doctor — run `coven doctor` inline
        case switchModel           // /model — pick or set the chat model
        case desktopOnly(String)   // recognised, but lives on the desktop
    }

    let name: String
    var aliases: [String] = []
    let hint: String
    let description: String
    var argPlaceholder: String?
    let section: Section
    let availability: Availability
    let action: Action

    var id: String { name }

    /// Every typeable token for this command (canonical name + aliases).
    var tokens: [String] { [name] + aliases }
}

enum SlashCatalog {
    /// The full catalog, ordered for display. Kept in lock-step with the web
    /// `SLASH_COMMANDS` array so the two surfaces never drift.
    static let all: [SlashCommand] = [
        // MARK: Chat
        SlashCommand(name: "/help", aliases: ["/h"], hint: "show help",
                     description: "Show every command grouped by section.",
                     section: .chat, availability: .native, action: .help),
        SlashCommand(name: "/clear", aliases: ["/cls"], hint: "clear transcript",
                     description: "Clear the local view (the session is untouched).",
                     section: .chat, availability: .native, action: .clearTranscript),
        SlashCommand(name: "/quit", aliases: ["/exit", "/q"], hint: "back to chats",
                     description: "Close this chat and return to the chat list.",
                     section: .chat, availability: .native, action: .quitToList),
        SlashCommand(name: "/new", hint: "new chat",
                     description: "Start a fresh chat with the same familiar.",
                     section: .chat, availability: .native, action: .newChat),
        SlashCommand(name: "/palette", hint: "commands",
                     description: "Open the command reference.",
                     section: .chat, availability: .native, action: .help),
        SlashCommand(name: "/shortcuts", aliases: ["/keys"], hint: "commands",
                     description: "Show the command reference.",
                     section: .chat, availability: .native, action: .help),
        SlashCommand(name: "/model", aliases: ["/m"], hint: "switch model",
                     description: "Pick or set the model for this chat. Pass an id/name or open the picker.",
                     argPlaceholder: "model", section: .chat,
                     availability: .native, action: .switchModel),

        // MARK: Familiar
        SlashCommand(name: "/familiar", aliases: ["/agent"], hint: "switch",
                     description: "Open the familiar picker. Pass a name to switch directly.",
                     argPlaceholder: "name", section: .familiar,
                     availability: .native, action: .familiarPicker),

        // MARK: Daemon / health
        SlashCommand(name: "/daemon", hint: "daemon status",
                     description: "Show the desktop daemon status inline.",
                     section: .daemon, availability: .native, action: .daemonStatus),
        SlashCommand(name: "/doctor", hint: "setup checks",
                     description: "Run `coven doctor` and print the result inline.",
                     section: .daemon, availability: .native, action: .doctor),

        // MARK: View / Sessions
        SlashCommand(name: "/sessions", hint: "all sessions",
                     description: "Open the chat list.",
                     section: .view, availability: .native, action: .openSessions),
        SlashCommand(name: "/chats", aliases: ["/agents", "/chat"], hint: "Chats",
                     description: "Switch back to the Chats view.",
                     section: .view, availability: .native, action: .openSessions),
        SlashCommand(name: "/board", hint: "Tasks",
                     description: "Open the Tasks board.",
                     section: .view, availability: .native, action: .openBoard),
        SlashCommand(name: "/save", aliases: ["/bookmark", "/read"],
                     hint: "/save <url> [bookmarks|reading|github] [#tag]",
                     description: "Route a URL into the library (auto-classified).",
                     argPlaceholder: "url …", section: .view,
                     availability: .native, action: .saveLink),
        SlashCommand(name: "/journal", hint: "Journal",
                     description: "Your daily journal — open it on the desktop.",
                     section: .view, availability: .desktopOnly, action: .desktopOnly("Journal")),
        SlashCommand(name: "/inbox", hint: "Schedules",
                     description: "Schedules live on the desktop.",
                     section: .view, availability: .desktopOnly, action: .desktopOnly("Schedules")),
        SlashCommand(name: "/remind", hint: "new reminder",
                     description: "Create a reminder — on the desktop for now.",
                     argPlaceholder: "when + text", section: .view,
                     availability: .desktopOnly, action: .desktopOnly("Reminders")),
        SlashCommand(name: "/terminal", aliases: ["/comux"], hint: "Terminal",
                     description: "Open the Developer terminal.",
                     section: .view, availability: .native, action: .openDeveloper("terminal")),
        SlashCommand(name: "/projects", hint: "Projects",
                     description: "Open the Developer code browser.",
                     section: .view, availability: .native, action: .openDeveloper("code")),
        SlashCommand(name: "/attach", hint: "open session",
                     description: "Open a daemon session by id — desktop for now.",
                     argPlaceholder: "session-id", section: .view,
                     availability: .desktopOnly, action: .desktopOnly("Attach session")),
        SlashCommand(name: "/tui", hint: "open in Coven Code",
                     description: "Open the session in the desktop Coven Code TUI.",
                     section: .view, availability: .desktopOnly, action: .desktopOnly("Coven Code")),
        SlashCommand(name: "/toggle-agent", hint: "toggle panel",
                     description: "Toggle the Familiar Chat side panel on desktop.",
                     section: .view, availability: .desktopOnly,
                     action: .desktopOnly("Familiar side panel")),

        // MARK: Launch
        SlashCommand(name: "/run", hint: "run task",
                     description: "Run a task through the active familiar.",
                     argPlaceholder: "task…", section: .launch,
                     availability: .native, action: .sendAsPrompt),
        SlashCommand(name: "/codex", hint: "codex runtime",
                     description: "Send a task (runs through the active familiar on mobile).",
                     argPlaceholder: "task…", section: .launch,
                     availability: .native, action: .sendAsPrompt),
        SlashCommand(name: "/claude", hint: "claude runtime",
                     description: "Send a task (runs through the active familiar on mobile).",
                     argPlaceholder: "task…", section: .launch,
                     availability: .native, action: .sendAsPrompt),
    ]

    /// Commands that have a real native iOS target. Desktop-only commands stay
    /// parseable in `all`, but the mobile autocomplete/help surfaces use this.
    static let available: [SlashCommand] = all.filter { $0.availability == .native }

    /// alias/name → command, for O(1) canonical resolution.
    private static let byToken: [String: SlashCommand] = {
        var map: [String: SlashCommand] = [:]
        for command in all {
            for token in command.tokens { map[token.lowercased()] = command }
        }
        return map
    }()

    /// Resolve a leading `/token` to its command, or nil if unknown.
    static func command(for token: String) -> SlashCommand? {
        guard token.hasPrefix("/") else { return nil }
        return byToken[token.lowercased()]
    }

    /// Typeahead: every native command whose name or an alias starts with `prefix`.
    /// `prefix` is the partial first word, e.g. `/sa`. Empty after `/` → all.
    static func matches(_ prefix: String) -> [SlashCommand] {
        guard prefix.hasPrefix("/") else { return [] }
        let q = prefix.lowercased()
        if q == "/" { return available }
        return available.filter { command in
            command.tokens.contains { $0.lowercased().hasPrefix(q) }
        }
    }
}

/// A parsed composer input: either a recognised command (+ its arguments),
/// an unknown `/token`, or plain prose to send as a message.
enum SlashInput {
    case command(SlashCommand, args: String)
    case unknown(token: String)
    case prose(String)

    /// Parse raw composer text. Only treats it as a command when it starts with
    /// `/` and the leading token has no embedded slash beyond the first char.
    static func parse(_ raw: String) -> SlashInput {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/") else { return .prose(trimmed) }

        let firstSpace = trimmed.firstIndex(where: { $0 == " " || $0 == "\n" })
        let token = firstSpace.map { String(trimmed[trimmed.startIndex..<$0]) } ?? trimmed
        let args = firstSpace
            .map { String(trimmed[trimmed.index(after: $0)...]) }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""

        if let command = SlashCatalog.command(for: token) {
            return .command(command, args: args)
        }
        return .unknown(token: token)
    }

    /// Whether the in-progress text should surface the autocomplete menu:
    /// a leading `/` on the first word (no whitespace committed yet).
    static func isTypingCommand(_ raw: String) -> Bool {
        guard raw.hasPrefix("/") else { return false }
        return !raw.contains(" ") && !raw.contains("\n")
    }
}

/// Parsed `/save` arguments — Swift port of `src/lib/slash-save-parser.ts`.
struct SlashSaveArgs {
    var url: String?
    var listHint: String?
    var tags: [String]
}

/// `/save <url> [bookmarks|reading|github] [#tag…]`. Returns a nil url when the
/// first token isn't a valid http(s) URL.
func parseSaveArgs(_ args: String) -> SlashSaveArgs {
    let tokens = args
        .split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" })
        .map(String.init)
    guard let first = tokens.first,
          let url = URL(string: first),
          let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https" else {
        return SlashSaveArgs(url: nil, listHint: nil, tags: [])
    }
    let validHints: Set<String> = ["bookmarks", "reading", "github"]
    var listHint: String?
    var tags: [String] = []
    for token in tokens.dropFirst() {
        if token.hasPrefix("#") {
            let tag = String(token.dropFirst())
            if !tag.isEmpty { tags.append(tag) }
        } else if validHints.contains(token) {
            listHint = token
        }
    }
    return SlashSaveArgs(url: first, listHint: listHint, tags: tags)
}
