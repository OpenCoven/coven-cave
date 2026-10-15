import Foundation

/// What the composer draft is asking for right now, so the chat view can show
/// one suggestion surface at a time: the `/command` list, a command's argument
/// picker (`/model op…`, `/familiar no…`), or an `@mention`.
///
/// Mirrors the desktop composer's `activeInvocation` in
/// `src/lib/use-inline-slash-menus.ts` + `src/lib/slash-skill.ts`:
///
/// - A bare `/token` with no whitespace is still a *command* lookup, so typing
///   `/skill` lists both `/skill` and `/skills` before either picker opens.
/// - Once whitespace follows a recognised native command that declares an
///   `argCompletion`, the draft is an *argument* lookup; the partial is the text
///   after the first whitespace, filtered live by the picker.
/// - Otherwise the trailing `@token` (group chats only) is a *mention* lookup.
///
/// SwiftUI's `TextField` exposes no caret, so detection is trailing-token
/// based, not caret-scoped like the web hook. That is the documented v1 limit.
enum ComposerIntent: Equatable {
    /// Typing the first word after `/` — show the command list.
    case commands(prefix: String)
    /// A native command with an argument picker, plus the partial argument.
    case argument(SlashCommand, partial: String)
    /// Trailing `@partial` — show the familiar mention picker.
    case mention(partial: String)
    case none

    static func detect(_ draft: String, allowsMentions: Bool) -> ComposerIntent {
        if draft.hasPrefix("/") {
            if SlashInput.isTypingCommand(draft) {
                return .commands(prefix: draft)
            }
            if let argument = argumentIntent(draft) {
                return argument
            }
            // A command with free-text arguments (`/run tell @nova …`) falls
            // through so a mention can still be completed mid-sentence.
        }
        if allowsMentions, let partial = MentionInput.partial(draft) {
            return .mention(partial: partial)
        }
        return .none
    }

    /// `/model op` → `.argument(/model, "op")` when the leading token resolves
    /// to a native command that declares an argument picker. Multi-line drafts
    /// are never argument lookups: a newline means the user is composing prose.
    private static func argumentIntent(_ draft: String) -> ComposerIntent? {
        guard !draft.contains("\n"),
              let firstSpace = draft.firstIndex(of: " ") else { return nil }
        let token = String(draft[draft.startIndex..<firstSpace])
        guard let command = SlashCatalog.command(for: token),
              command.availability == .native,
              command.argCompletion != .none else { return nil }
        let partial = String(draft[draft.index(after: firstSpace)...])
            .trimmingCharacters(in: .whitespaces)
        return .argument(command, partial: partial)
    }
}

/// Pure row builder for `ComposerArgumentMenu`, kept out of the view so the
/// filtering rules are unit-testable without SwiftUI.
enum ComposerArgumentRows {
    static func rows(for command: SlashCommand, partial: String,
                     familiars: [Familiar], models: [ChatModelOption],
                     skills: [SkillOption] = [], prompts: [PromptOption] = []) -> [ComposerArgumentRow] {
        let q = partial.lowercased()
        func hit(_ fields: String?...) -> Bool {
            q.isEmpty || fields.contains { $0?.lowercased().contains(q) == true }
        }
        switch command.argCompletion {
        case .familiar:
            return familiars
                .filter { hit($0.displayName, $0.id) }
                .map { ComposerArgumentRow(id: $0.id, title: $0.displayName, subtitle: $0.role,
                                           value: $0.id, familiar: $0) }
        case .model:
            return models
                .filter { hit($0.label, $0.id) }
                .map { ComposerArgumentRow(id: $0.id, title: $0.label,
                                           subtitle: $0.id == $0.label ? nil : $0.id, value: $0.id) }
        case .skill:
            // `/skills` takes the whole remainder as its filter, like the desktop.
            return SkillInvocation.filter(skills, partial: partial)
                .map { ComposerArgumentRow(id: $0.id, title: $0.name,
                                           subtitle: $0.description ?? ($0.id == $0.name ? nil : $0.id),
                                           value: $0.id) }
        case .prompt:
            return PromptPick.filter(prompts, partial: partial)
                .map { ComposerArgumentRow(id: $0.id, title: $0.name, subtitle: $0.description, value: $0.id) }
        case .none:
            return []
        }
    }
}
