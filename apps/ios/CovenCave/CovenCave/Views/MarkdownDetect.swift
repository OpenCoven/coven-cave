import Foundation

/// Cheap heuristic: does this text contain block/inline markdown worth rendering
/// through the WebView? Assistant replies always render markdown; a *user*
/// message only does when it actually contains markdown — plain chatter stays
/// native `Text` (fast, fully selectable).
enum MarkdownDetect {
    static func hasMarkdown(_ text: String) -> Bool {
        if text.isEmpty { return false }
        // Fenced code anywhere is the strongest signal.
        if text.contains("```") { return true }

        // Line-anchored block syntax: headings, list markers, blockquotes,
        // ordered lists, and table rows.
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.drop(while: { $0 == " " })
            if line.isEmpty { continue }
            if line.hasPrefix("# ") || line.hasPrefix("## ") || line.hasPrefix("### ")
                || line.hasPrefix("#### ") || line.hasPrefix("##### ") || line.hasPrefix("###### ") {
                return true
            }
            if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") || line.hasPrefix("> ") {
                return true
            }
            // Ordered list: "1. " / "12. "
            if let first = line.first, first.isNumber,
               let dot = line.firstIndex(of: "."),
               line[line.startIndex..<dot].allSatisfy(\.isNumber),
               line.index(after: dot) < line.endIndex,
               line[line.index(after: dot)] == " " {
                return true
            }
            // Table row: at least two pipes.
            if line.filter({ $0 == "|" }).count >= 2 { return true }
        }

        // Inline emphasis / code / links.
        if text.range(of: #"`[^`]+`"#, options: .regularExpression) != nil { return true }
        if text.range(of: #"\*\*[^*]+\*\*"#, options: .regularExpression) != nil { return true }
        if text.range(of: #"\[[^\]]+\]\([^)]+\)"#, options: .regularExpression) != nil { return true }
        return false
    }
}
