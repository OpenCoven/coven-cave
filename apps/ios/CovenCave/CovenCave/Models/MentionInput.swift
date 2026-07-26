import Foundation

/// Detects and edits an in-progress `@familiar` mention in the composer draft.
/// Unlike a slash command (which must lead the draft), a mention is the trailing
/// whitespace-delimited token, so it can appear mid-sentence.
enum MentionInput {
    /// The trailing word currently being typed (everything after the last space
    /// or newline).
    private static func trailingToken(_ draft: String) -> String {
        String(String(draft.reversed()).prefix { $0 != " " && $0 != "\n" }.reversed())
    }

    /// The partial name after a trailing `@` (empty right after typing `@`), or
    /// nil when the trailing token isn't a mention. A bare `@` with no `@` body
    /// still matches (returns "") so the picker opens immediately.
    static func partial(_ draft: String) -> String? {
        let token = trailingToken(draft)
        guard token.hasPrefix("@") else { return nil }
        return String(token.dropFirst())
    }

    /// Replace the trailing `@token` with `@<name> ` (display name, trailing
    /// space) so the user can keep typing.
    static func insert(name: String, into draft: String) -> String {
        let token = trailingToken(draft)
        let base = String(draft.dropLast(token.count))
        return base + "@\(name) "
    }
}
