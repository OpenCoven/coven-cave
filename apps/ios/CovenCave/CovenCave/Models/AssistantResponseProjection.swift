import Foundation

struct AssistantResponseProjection: Equatable {
    let visible: String
    let suggestions: [String]
    let previewURLs: [URL]

    private final class CacheEntry: NSObject {
        let projection: AssistantResponseProjection

        init(_ projection: AssistantResponseProjection) {
            self.projection = projection
        }
    }

    private static let cache: NSCache<NSString, CacheEntry> = {
        let cache = NSCache<NSString, CacheEntry>()
        cache.countLimit = 128
        cache.totalCostLimit = 2_000_000
        return cache
    }()

    private static let githubMarkerExpression = try! NSRegularExpression(
        pattern: #"<coven:github(?!-)\b((?:[^">]|"[^"]*")*?)/?>"#
    )
    private static let genericControlExpression = try! NSRegularExpression(
        pattern: #"</?coven:[A-Za-z0-9-]+\b(?:[^">]|"[^"]*")*?/?>"#
    )
    private static let attributeExpression = try! NSRegularExpression(
        pattern: #"([A-Za-z-]+)="([^"]*)""#
    )
    private static let angleCitationExpression = try! NSRegularExpression(
        pattern: #"^<(https?://[^\s>]+)>"#
    )
    private static let plainCitationExpression = try! NSRegularExpression(
        pattern: #"^(https?://[^\s]+)"#
    )
    private static let citationReferenceExpression = try! NSRegularExpression(
        pattern: #"\[\^([^\]]+)\]"#
    )
    static func parse(_ raw: String, streaming: Bool = false) -> AssistantResponseProjection {
        let cacheKey = "\(streaming ? 1 : 0):\(raw)" as NSString
        if let cached = cache.object(forKey: cacheKey) {
            return cached.projection
        }

        let protected = protectMarkdownCode(in: raw)
        let nextPaths = NextPaths.extract(protected.text)
        let controls = extractControls(from: nextPaths.visible)
        let cited = streaming ? controls.visible : renderCitations(in: controls.visible)
        let bareURLs = bareLineURLs(in: cited)
        let previews = Array(deduplicated(controls.githubURLs + bareURLs).prefix(2))

        let projection = AssistantResponseProjection(
            visible: protected.restore(in: normalize(cited)),
            suggestions: nextPaths.suggestions.map { protected.restore(in: $0) },
            previewURLs: previews
        )
        cache.setObject(CacheEntry(projection), forKey: cacheKey, cost: raw.utf8.count)
        return projection
    }

    private struct ControlExtraction {
        let visible: String
        let githubURLs: [URL]
    }

    private struct Citation {
        let label: String
        let url: URL
    }

    private static func extractControls(from text: String) -> ControlExtraction {
        var urls: [URL] = []
        let visible = text
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line in
                extractControls(from: String(line), githubURLs: &urls)
            }
            .joined(separator: "\n")

        return ControlExtraction(visible: visible, githubURLs: urls)
    }

    private static func extractControls(from prose: String, githubURLs: inout [URL]) -> String {
        var rendered = prose

        let matches = githubMarkerExpression.matches(
            in: prose,
            range: NSRange(prose.startIndex..., in: prose)
        )
        for match in matches {
            if match.numberOfRanges > 1,
               let attrsRange = Range(match.range(at: 1), in: prose),
               let url = githubURL(from: parseAttributes(String(prose[attrsRange]))) {
                githubURLs.append(url)
            }
        }
        rendered = githubMarkerExpression.stringByReplacingMatches(
            in: rendered,
            range: NSRange(rendered.startIndex..., in: rendered),
            withTemplate: ""
        )

        rendered = genericControlExpression.stringByReplacingMatches(
            in: rendered,
            range: NSRange(rendered.startIndex..., in: rendered),
            withTemplate: ""
        )

        if let incomplete = rendered.range(of: "<coven:", options: .caseInsensitive) {
            rendered.removeSubrange(incomplete.lowerBound...)
        }
        return rendered
    }

    private static func parseAttributes(_ raw: String) -> [String: String] {
        var attributes: [String: String] = [:]
        for match in attributeExpression.matches(
            in: raw,
            range: NSRange(raw.startIndex..., in: raw)
        ) {
            guard match.numberOfRanges == 3,
                  let keyRange = Range(match.range(at: 1), in: raw),
                  let valueRange = Range(match.range(at: 2), in: raw) else { continue }
            attributes[String(raw[keyRange])] = String(raw[valueRange])
        }
        return attributes
    }

    private static func githubURL(from attributes: [String: String]) -> URL? {
        guard let kind = attributes["kind"],
              let repo = attributes["repo"],
              repo.range(
                  of: #"^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$"#,
                  options: .regularExpression
              ) != nil else { return nil }

        let base = "https://github.com/\(repo)"
        let destination: String?
        switch kind {
        case "pr", "issue", "review-thread":
            guard let number = positiveInteger(attributes["number"]) else { return nil }
            let path = kind == "issue" ? "issues" : "pull"
            if kind == "review-thread", let thread = positiveInteger(attributes["thread"]) {
                destination = "\(base)/\(path)/\(number)#discussion_r\(thread)"
            } else {
                destination = "\(base)/\(path)/\(number)"
            }
        case "commit":
            guard let sha = attributes["sha"],
                  sha.range(of: #"^[0-9a-fA-F]{7,40}$"#, options: .regularExpression) != nil else {
                return nil
            }
            destination = "\(base)/commit/\(sha)"
        case "run":
            guard let run = positiveInteger(attributes["run"]) else { return nil }
            destination = "\(base)/actions/runs/\(run)"
        default:
            destination = nil
        }
        return destination.flatMap(URL.init(string:))
    }

    private static func positiveInteger(_ raw: String?) -> Int? {
        guard let raw, raw.range(of: #"^\d+$"#, options: .regularExpression) != nil,
              let value = Int(raw), value > 0 else { return nil }
        return value
    }

    private static func renderCitations(in text: String) -> String {
        var definitions: [String: Citation] = [:]
        let withoutDefinitions = text
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                let line = String(line)
                guard let definition = citationDefinition(from: line) else { return line }
                if let citation = definition.citation {
                    definitions[definition.key] = citation
                    return ""
                }
                return line
            }
            .joined(separator: "\n")

        return withoutDefinitions
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line in
                replaceCitationReferences(in: String(line), definitions: definitions)
            }
            .joined(separator: "\n")
    }

    private static func citationDefinition(
        from line: String
    ) -> (key: String, citation: Citation?)? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("[^"),
              let closing = trimmed.firstIndex(of: "]"),
              trimmed.index(after: closing) < trimmed.endIndex,
              trimmed[trimmed.index(after: closing)] == ":" else { return nil }

        let keyStart = trimmed.index(trimmed.startIndex, offsetBy: 2)
        let key = String(trimmed[keyStart..<closing])
        guard !key.isEmpty else { return nil }

        let contentStart = trimmed.index(closing, offsetBy: 2)
        let content = trimmed[contentStart...].trimmingCharacters(in: .whitespaces)
        guard let parsed = citationContent(String(content)) else {
            return (key, nil)
        }
        return (key, Citation(label: parsed.label, url: parsed.url))
    }

    private static func citationContent(_ raw: String) -> (label: String, url: URL)? {
        if let destination = markdownLinkDestination(in: raw),
           let url = URL(string: destination) {
            return (providerLabel(for: url), url)
        }

        if let match = firstMatch(
            expression: angleCitationExpression,
            in: raw
        ), let url = URL(string: match[1]) {
            return (providerLabel(for: url), url)
        }

        if let match = firstMatch(
            expression: plainCitationExpression,
            in: raw
        ), let url = URL(string: match[1]) {
            return (providerLabel(for: url), url)
        }
        return nil
    }

    private static func markdownLinkDestination(in raw: String) -> String? {
        guard raw.first == "[",
              let labelEnd = raw.firstIndex(of: "]") else { return nil }
        let open = raw.index(after: labelEnd)
        guard open < raw.endIndex, raw[open] == "(" else { return nil }

        var depth = 1
        var escaped = false
        var cursor = raw.index(after: open)
        let destinationStart = cursor
        while cursor < raw.endIndex {
            let character = raw[cursor]
            if escaped {
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "(" {
                depth += 1
            } else if character == ")" {
                depth -= 1
                if depth == 0 {
                    let destination = String(raw[destinationStart..<cursor])
                        .trimmingCharacters(in: .whitespaces)
                    return destination.isEmpty ? nil : destination
                }
            }
            cursor = raw.index(after: cursor)
        }
        return nil
    }

    private static func firstMatch(
        expression: NSRegularExpression,
        in text: String
    ) -> [String]? {
        guard let match = expression.firstMatch(
            in: text,
            range: NSRange(text.startIndex..., in: text)
        ) else { return nil }

        return (0..<match.numberOfRanges).map { index in
            guard let range = Range(match.range(at: index), in: text) else { return "" }
            return String(text[range])
        }
    }

    private static func providerLabel(for url: URL) -> String {
        var host = (url.host ?? url.absoluteString).lowercased()
        if host.hasPrefix("www.") {
            host.removeFirst(4)
        }
        switch host {
        case "github.com":
            return "GitHub"
        case "quickbooks.intuit.com":
            return "QuickBooks"
        case "youtube.com", "m.youtube.com", "youtu.be":
            return "YouTube"
        default:
            return host
        }
    }

    private static func replaceCitationReferences(
        in text: String,
        definitions: [String: Citation]
    ) -> String {
        let source = text as NSString
        let matches = citationReferenceExpression.matches(
            in: text,
            range: NSRange(location: 0, length: source.length)
        )
        let rendered = NSMutableString(string: text)
        for match in matches.reversed() {
            guard match.numberOfRanges == 2 else { continue }
            let key = source.substring(with: match.range(at: 1))
            let replacement: String
            if let citation = definitions[key] {
                let escapedLabel = citation.label.replacingOccurrences(of: "]", with: #"\]"#)
                let link = "[\(escapedLabel)](\(citation.url.absoluteString))"
                let needsSpace = match.range.location > 0
                    && !(source.substring(with: NSRange(
                        location: match.range.location - 1,
                        length: 1
                    )).rangeOfCharacter(from: .whitespacesAndNewlines) != nil)
                replacement = needsSpace ? " \(link)" : link
            } else {
                continue
            }
            rendered.replaceCharacters(in: match.range, with: replacement)
        }
        return rendered as String
    }

    private static func bareLineURLs(in text: String) -> [URL] {
        var urls: [URL] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let candidate = line.trimmingCharacters(in: .whitespaces)
            if let url = URL(string: candidate),
               url.scheme == "http" || url.scheme == "https",
               !candidate.contains(where: \.isWhitespace) {
                urls.append(url)
            }
        }
        return urls
    }

    private struct ProtectedMarkdownCode {
        let text: String
        let fragments: [(token: String, source: String)]

        func restore(in value: String) -> String {
            guard !fragments.isEmpty else { return value }
            let sourcesByToken = Dictionary(
                uniqueKeysWithValues: fragments.map { ($0.token, $0.source) }
            )
            var output = ""
            output.reserveCapacity(value.count)
            var cursor = value.startIndex
            while cursor < value.endIndex,
                  let tokenStart = value[cursor...].firstIndex(of: "\u{E000}") {
                output += value[cursor..<tokenStart]
                guard let terminator = value[tokenStart...].firstIndex(of: "\u{E001}") else {
                    output += value[tokenStart...]
                    return output
                }
                let tokenEnd = value.index(after: terminator)
                let token = String(value[tokenStart..<tokenEnd])
                if let source = sourcesByToken[token] {
                    output += source
                    cursor = tokenEnd
                } else {
                    output.append(value[tokenStart])
                    cursor = value.index(after: tokenStart)
                }
            }
            output += value[cursor...]
            return output
        }
    }

    private struct MarkdownLine {
        let range: Range<String.Index>
        let contentRange: Range<String.Index>
        let content: Substring
        let isBlank: Bool
        let isIndentedCode: Bool
    }

    private struct FenceMarker {
        let character: Character
        let length: Int
    }

    private static func protectMarkdownCode(in text: String) -> ProtectedMarkdownCode {
        guard !text.isEmpty else {
            return ProtectedMarkdownCode(text: text, fragments: [])
        }

        let lines = markdownLines(in: text)
        var ranges: [Range<String.Index>] = []
        var lineIndex = 0
        while lineIndex < lines.count {
            let line = lines[lineIndex]
            if let opening = fenceMarker(in: line.content) {
                var closingIndex = lineIndex + 1
                while closingIndex < lines.count {
                    if isClosingFence(lines[closingIndex].content, for: opening) {
                        break
                    }
                    closingIndex += 1
                }
                let endIndex = closingIndex < lines.count ? closingIndex : lines.count - 1
                ranges.append(line.range.lowerBound..<lines[endIndex].contentRange.upperBound)
                lineIndex = endIndex + 1
                continue
            }

            if line.isIndentedCode {
                var endIndex = lineIndex
                var candidate = lineIndex + 1
                while candidate < lines.count {
                    let next = lines[candidate]
                    guard next.isIndentedCode || next.isBlank else { break }
                    endIndex = candidate
                    candidate += 1
                }
                while endIndex > lineIndex, lines[endIndex].isBlank {
                    endIndex -= 1
                }
                ranges.append(line.range.lowerBound..<lines[endIndex].contentRange.upperBound)
                lineIndex = endIndex + 1
                continue
            }

            ranges.append(contentsOf: inlineCodeRanges(in: text, range: line.contentRange))
            lineIndex += 1
        }

        var markerPrefix = "\u{E000}COVEN-CODE-"
        while text.contains(markerPrefix) {
            markerPrefix += "-"
        }
        var protectedText = ""
        var fragments: [(token: String, source: String)] = []
        var cursor = text.startIndex
        for (index, range) in ranges.enumerated() {
            let token = "\(markerPrefix)\(index)\u{E001}"
            protectedText += text[cursor..<range.lowerBound]
            protectedText += token
            let source = String(text[range])
            fragments.append((token, source))
            cursor = range.upperBound
        }
        protectedText += text[cursor...]
        return ProtectedMarkdownCode(text: protectedText, fragments: fragments)
    }

    private static func markdownLines(in text: String) -> [MarkdownLine] {
        var lines: [MarkdownLine] = []
        var activeListContentIndent: Int?
        var cursor = text.startIndex
        while cursor < text.endIndex {
            let newline = text[cursor...].firstIndex(of: "\n")
            let contentEnd = newline ?? text.endIndex
            let lineEnd = newline.map { text.index(after: $0) } ?? text.endIndex
            let contentRange = cursor..<contentEnd
            let content = text[contentRange]
            let leadingSpaces = content.prefix(while: { $0 == " " }).count
            let isBlank = content.allSatisfy(\.isWhitespace)
            let listContentIndent = listItemContentIndent(in: content)
            let isIndentedCode: Bool
            if isBlank {
                isIndentedCode = false
            } else if let listContentIndent {
                activeListContentIndent = listContentIndent
                isIndentedCode = false
            } else if let activeIndent = activeListContentIndent,
                      leadingSpaces >= activeIndent {
                isIndentedCode = content.hasPrefix("\t")
                    || leadingSpaces >= activeIndent + 4
            } else {
                activeListContentIndent = nil
                isIndentedCode = content.hasPrefix("\t") || leadingSpaces >= 4
            }
            lines.append(MarkdownLine(
                range: cursor..<lineEnd,
                contentRange: contentRange,
                content: content,
                isBlank: isBlank,
                isIndentedCode: isIndentedCode
            ))
            cursor = lineEnd
        }
        return lines
    }

    private static func listItemContentIndent(in line: Substring) -> Int? {
        let leadingSpaces = line.prefix(while: { $0 == " " }).count
        let markerStart = line.index(line.startIndex, offsetBy: leadingSpaces)
        guard markerStart < line.endIndex else { return nil }

        var cursor = markerStart
        let first = line[cursor]
        if first == "-" || first == "+" || first == "*" {
            cursor = line.index(after: cursor)
        } else if first.isNumber {
            var digitCount = 0
            while cursor < line.endIndex, line[cursor].isNumber, digitCount < 9 {
                cursor = line.index(after: cursor)
                digitCount += 1
            }
            guard digitCount > 0, cursor < line.endIndex,
                  line[cursor] == "." || line[cursor] == ")" else { return nil }
            cursor = line.index(after: cursor)
        } else {
            return nil
        }

        guard cursor < line.endIndex, line[cursor].isWhitespace else { return nil }
        let whitespaceStart = cursor
        while cursor < line.endIndex, line[cursor] == " " {
            cursor = line.index(after: cursor)
        }
        let padding = max(1, line.distance(from: whitespaceStart, to: cursor))
        return leadingSpaces + line.distance(from: markerStart, to: whitespaceStart) + padding
    }

    private static func fenceMarker(in line: Substring) -> FenceMarker? {
        let leadingSpaces = line.prefix(while: { $0 == " " }).count
        guard leadingSpaces <= 3 else { return nil }
        let trimmed = line.dropFirst(leadingSpaces)
        guard let character = trimmed.first, character == "`" || character == "~" else {
            return nil
        }
        let length = trimmed.prefix(while: { $0 == character }).count
        guard length >= 3 else { return nil }
        return FenceMarker(character: character, length: length)
    }

    private static func isClosingFence(_ line: Substring, for opening: FenceMarker) -> Bool {
        let leadingSpaces = line.prefix(while: { $0 == " " }).count
        guard leadingSpaces <= 3 else { return false }
        let trimmed = line.dropFirst(leadingSpaces)
        let length = trimmed.prefix(while: { $0 == opening.character }).count
        guard length >= opening.length else { return false }
        return trimmed.dropFirst(length).allSatisfy(\.isWhitespace)
    }

    private static func inlineCodeRanges(
        in text: String,
        range: Range<String.Index>
    ) -> [Range<String.Index>] {
        var ranges: [Range<String.Index>] = []
        var cursor = range.lowerBound
        while cursor < range.upperBound {
            guard text[cursor] == "`" else {
                cursor = text.index(after: cursor)
                continue
            }
            let openingStart = cursor
            let openingEnd = backtickRunEnd(in: text, from: cursor, limit: range.upperBound)
            let length = text.distance(from: openingStart, to: openingEnd)
            var search = openingEnd
            var closingEnd: String.Index?
            while search < range.upperBound {
                guard text[search] == "`" else {
                    search = text.index(after: search)
                    continue
                }
                let candidateEnd = backtickRunEnd(in: text, from: search, limit: range.upperBound)
                if text.distance(from: search, to: candidateEnd) == length {
                    closingEnd = candidateEnd
                    break
                }
                search = candidateEnd
            }
            guard let closingEnd else {
                cursor = openingEnd
                continue
            }
            ranges.append(openingStart..<closingEnd)
            cursor = closingEnd
        }
        return ranges
    }

    private static func backtickRunEnd(
        in text: String,
        from start: String.Index,
        limit: String.Index
    ) -> String.Index {
        var cursor = start
        while cursor < limit, text[cursor] == "`" {
            cursor = text.index(after: cursor)
        }
        return cursor
    }

    private static func deduplicated(_ urls: [URL]) -> [URL] {
        var seen: Set<String> = []
        return urls.filter { seen.insert($0.absoluteString).inserted }
    }

    private static func normalize(_ text: String) -> String {
        var inFence = false
        var inIndentedCode = false
        var previousProseLineWasBlank = false
        var output: [String] = []

        for substring in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(substring)
            let leadingSpaces = line.prefix(while: { $0 == " " }).count
            let trimmed = line.dropFirst(leadingSpaces)
            let isFence = leadingSpaces <= 3
                && (trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~"))
            let isIndentedLine = line.hasPrefix("\t") || leadingSpaces >= 4

            if isFence {
                output.append(line)
                inFence.toggle()
                inIndentedCode = false
                previousProseLineWasBlank = false
                continue
            }
            if inFence {
                output.append(line)
                previousProseLineWasBlank = false
                continue
            }
            if isIndentedLine {
                output.append(line)
                inIndentedCode = true
                previousProseLineWasBlank = false
                continue
            }
            if inIndentedCode && line.isEmpty {
                output.append(line)
                continue
            }
            inIndentedCode = false

            let cleaned = line.replacingOccurrences(
                of: #"[ \t]+$"#,
                with: "",
                options: .regularExpression
            )
            if cleaned.isEmpty {
                if !previousProseLineWasBlank {
                    output.append(cleaned)
                }
                previousProseLineWasBlank = true
                continue
            }
            previousProseLineWasBlank = false
            output.append(cleaned)
        }

        return output
            .joined(separator: "\n")
            .trimmingCharacters(in: .newlines)
    }
}
