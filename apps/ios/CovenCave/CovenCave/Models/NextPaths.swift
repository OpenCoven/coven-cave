import Foundation

/// Splits the `<coven:next-paths>` suggestion block out of an assistant message,
/// mirroring the desktop's `src/lib/next-paths.ts` so the parsed chips match.
/// Streaming-safe: if the open tag is absent the text is returned unchanged.
enum NextPaths {
    private static let open = "<coven:next-paths>"
    private static let close = "</coven:next-paths>"

    static func extract(_ text: String) -> (visible: String, suggestions: [String]) {
        guard !text.isEmpty, let openRange = text.range(of: open, options: .backwards) else {
            return (text, [])
        }
        let afterOpen = openRange.upperBound
        let closeRange = text.range(of: close, range: afterOpen..<text.endIndex)
        let innerEnd = closeRange?.lowerBound ?? text.endIndex
        let blockEnd = closeRange?.upperBound ?? text.endIndex

        let inner = text[afterOpen..<innerEnd]
        let suggestions = inner
            .split(whereSeparator: \.isNewline)
            .map { line -> String in
                var s = line.trimmingCharacters(in: .whitespaces)
                for marker in ["- ", "* ", "• "] where s.hasPrefix(marker) {
                    s = String(s.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
                    break
                }
                return s
            }
            .filter { !$0.isEmpty && !$0.hasPrefix("first next step") && !$0.hasPrefix("second next step") }
            .prefix(6)

        let visible = (String(text[text.startIndex..<openRange.lowerBound]) + String(text[blockEnd...]))
            .replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
        return (visible, Array(suggestions))
    }
}
