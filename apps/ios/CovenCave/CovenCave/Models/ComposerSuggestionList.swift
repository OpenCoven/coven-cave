import Foundation

/// One row in the composer's argument picker (`/model …`, `/familiar …`).
/// `value` is what the command receives as its argument when the row is picked.
struct ComposerArgumentRow: Identifiable, Hashable {
    let id: String
    let title: String
    var subtitle: String?
    /// The argument handed to `dispatch(command, args:)` on pick.
    let value: String
    /// Shown as an avatar when the row stands for a familiar.
    var familiar: Familiar?

    static func == (lhs: ComposerArgumentRow, rhs: ComposerArgumentRow) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// One row in the composer's suggestion menu, whatever produced it (#5879).
struct ComposerSuggestionItem: Identifiable, Equatable {
    enum Kind: Equatable {
        /// A `/command` from the command list.
        case command(SlashCommand)
        /// An argument for `command`, from its picker.
        case argument(ComposerArgumentRow, command: SlashCommand)
        /// A group member for an `@mention`.
        case mention(Familiar)
    }

    let id: String
    let kind: Kind
    let title: String
    var subtitle: String?
    /// A trailing hint, e.g. a command's `name` argument placeholder.
    var detail: String?
    /// Shown as an avatar when the row stands for a familiar.
    var familiar: Familiar?
    /// Command names render monospaced, as they are typed.
    var monospaced = false
}

/// Everything the one suggestion menu shows for the current draft (#5879).
/// Built from `ComposerIntent` so commands, argument pickers and mentions
/// share one row layout, one footer and one keyboard model.
struct ComposerSuggestionList: Equatable {
    let items: [ComposerSuggestionItem]
    /// Says what a tap does: run, insert, or mention.
    let footer: String
    /// The command an argument picker belongs to, named in its footer.
    var command: SlashCommand?

    /// The menu for `intent`, or nil when there is nothing to suggest.
    static func make(
        intent: ComposerIntent,
        commands: [SlashCommand],
        argumentRows: [ComposerArgumentRow],
        mentions: [Familiar]
    ) -> ComposerSuggestionList? {
        switch intent {
        case .commands:
            guard !commands.isEmpty else { return nil }
            return ComposerSuggestionList(
                items: commands.map {
                    ComposerSuggestionItem(id: "command:\($0.name)", kind: .command($0), title: $0.name,
                                           subtitle: $0.description, detail: $0.argPlaceholder, monospaced: true)
                },
                footer: "Tap to run · type to filter")
        case let .argument(command, _):
            guard !argumentRows.isEmpty else { return nil }
            return ComposerSuggestionList(
                items: argumentRows.map {
                    ComposerSuggestionItem(id: "argument:\(command.name):\($0.id)",
                                           kind: .argument($0, command: command), title: $0.title,
                                           subtitle: $0.subtitle, familiar: $0.familiar)
                },
                footer: command.argCompletion == .prompt ? "Tap to insert · type to filter" : "Tap to run · type to filter",
                command: command)
        case .mention:
            guard !mentions.isEmpty else { return nil }
            return ComposerSuggestionList(
                items: mentions.map {
                    ComposerSuggestionItem(id: "mention:\($0.id)", kind: .mention($0), title: "@\($0.displayName)",
                                           subtitle: $0.role, familiar: $0)
                },
                footer: "Tap to mention · type to filter")
        case .none:
            return nil
        }
    }
}

/// Keyboard movement through the menu (#5879): ↑/↓ wrap at the ends, and a
/// stale index from a longer list is pulled back into range.
enum SuggestionSelection {
    static func move(_ index: Int, by step: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return ((clamp(index, count: count) + step) % count + count) % count
    }

    static func clamp(_ index: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return min(max(index, 0), count - 1)
    }
}
