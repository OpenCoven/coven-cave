import Foundation

/// Detects and edits an in-progress `@` mention in the composer draft: a
/// familiar in a group chat, or a project file in a one-to-one chat (#6104).
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
    /// still matches (returns "") so the picker opens immediately. As on the
    /// desktop (`fileMentionToken`), the `@` must start the token and the text
    /// after it holds no second `@`, so an address like `val@example.com` or
    /// `@a@b` never opens the picker. A `/` is allowed so paths keep filtering.
    static func partial(_ draft: String) -> String? {
        let token = trailingToken(draft)
        guard token.hasPrefix("@") else { return nil }
        let partial = token.dropFirst()
        guard !partial.contains("@") else { return nil }
        return String(partial)
    }

    /// Replace the trailing `@token` with `@<name> ` (a familiar's display
    /// name or a file's repo-relative path, then a space) so the user can keep
    /// typing.
    static func insert(name: String, into draft: String) -> String {
        let token = trailingToken(draft)
        let base = String(draft.dropLast(token.count))
        return base + "@\(name) "
    }
}
