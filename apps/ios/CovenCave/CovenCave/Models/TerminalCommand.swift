import Foundation

/// The small command vocabulary owned by the native terminal composer.
///
/// This deliberately does not share chat's slash catalog: terminal input is
/// shell input by default, so an unrecognised slash token must reach the PTY.
enum TerminalCommand: Equatable {
    case help
    case clear
    case chooseWorkingDirectory

    struct Suggestion: Identifiable, Equatable {
        let command: TerminalCommand
        let name: String
        let description: String

        var id: String { name }
    }

    enum Disposition: Equatable {
        case local(TerminalCommand)
        case send(String)
        case empty
    }

    static let suggestions = [
        Suggestion(command: .help, name: "/help", description: "Show terminal commands"),
        Suggestion(command: .clear, name: "/clear", description: "Clear the shell screen"),
        Suggestion(command: .chooseWorkingDirectory, name: "/cwd", description: "Choose a working directory"),
    ]

    /// Recognise only the terminal vocabulary. Everything else, including
    /// absolute paths such as `/usr/bin/env`, remains shell input.
    static func parse(_ draft: String) -> Disposition {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .empty }

        switch trimmed.lowercased() {
        case "/help", "/?":
            return .local(.help)
        case "/clear", "/cls":
            return .local(.clear)
        case "/cwd":
            return .local(.chooseWorkingDirectory)
        default:
            return .send(trimmed)
        }
    }

    static func matches(_ draft: String) -> [Suggestion] {
        guard draft.hasPrefix("/"), !draft.contains(where: \.isWhitespace) else { return [] }
        let query = draft.lowercased()
        return suggestions.filter { $0.name.hasPrefix(query) }
    }
}
