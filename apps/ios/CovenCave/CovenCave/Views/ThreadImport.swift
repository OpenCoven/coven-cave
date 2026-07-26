import Foundation

/// A chat transcript parsed back out of Markdown (see `AppModel.exportMarkdown`).
struct ParsedThread {
    struct Turn { let who: String; let text: String }
    var title: String = ""
    var participants: [String] = []
    var turns: [Turn] = []
}

/// Parse the app's exported Markdown transcript: a `# title`, an optional
/// `_Chat with …_` participant line, and `**Author**`-delimited turns. Tuned to
/// the export format — a lone `**…**` line is treated as an author header.
func parseThreadMarkdown(_ text: String) -> ParsedThread {
    var result = ParsedThread()
    var currentWho: String?
    var buffer: [String] = []

    func flush() {
        guard let who = currentWho else { buffer.removeAll(); return }
        let body = buffer.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if !body.isEmpty { result.turns.append(.init(who: who, text: body)) }
        buffer.removeAll()
    }

    for line in text.components(separatedBy: "\n") {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if currentWho == nil, result.title.isEmpty, trimmed.hasPrefix("# ") {
            result.title = String(trimmed.dropFirst(2)).trimmingCharacters(in: .whitespaces)
            continue
        }
        if currentWho == nil, result.participants.isEmpty,
           trimmed.hasPrefix("_Chat with "), trimmed.hasSuffix("_") {
            let inner = String(trimmed.dropFirst("_Chat with ".count).dropLast())
            result.participants = inner.components(separatedBy: ", ")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            continue
        }
        if trimmed.count > 4, trimmed.hasPrefix("**"), trimmed.hasSuffix("**") {
            flush()
            currentWho = String(trimmed.dropFirst(2).dropLast(2))
            continue
        }
        if currentWho != nil { buffer.append(line) }
    }
    flush()
    return result
}
