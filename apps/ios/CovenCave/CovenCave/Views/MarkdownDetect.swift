import Foundation

/// Cheap heuristic: does this text contain block/inline markdown worth rendering
/// through the WebView? User messages use the broad heuristic. Completed
/// chronological prose can use the stricter single-paragraph path below;
/// uncertain syntax and ordinary unsegmented replies keep the WebView.
enum MarkdownDetect {
    /// A conservative subset with the same visible text as the shared parser.
    /// Do not flatten soft breaks, decode escapes, or guess Markdown semantics.
    static func plainTimelineParagraph(_ source: String) -> String? {
        guard source.range(of: #"(?:^|[\r\n])(?: {4}| {0,3}\t)"#, options: .regularExpression) == nil else { return nil }
        let text = source.trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n"))
        guard !text.isEmpty, !text.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }),
              !text.contains("  "),
              text.rangeOfCharacter(from: CharacterSet(charactersIn: "#*_[]<>`~\\|&")) == nil,
              text.range(of: #"^(?:[-+]\s|-+$|\d+[.)]\s)"#, options: .regularExpression) == nil else { return nil }
        return text
    }

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
