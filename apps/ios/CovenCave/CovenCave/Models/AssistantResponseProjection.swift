import Foundation

struct AssistantResponseProjection: Equatable {
    let visible: String
    let suggestions: [String]
    let previewURLs: [URL]

    static func parse(_ raw: String) -> AssistantResponseProjection {
        let nextPaths = NextPaths.extract(raw)
        let controls = extractControls(from: nextPaths.visible)
        let cited = renderCitations(in: controls.visible)
        let bareURLs = bareLineURLs(in: cited)
        let previews = deduplicated(controls.githubURLs + bareURLs)

        return AssistantResponseProjection(
            visible: normalize(cited),
            suggestions: nextPaths.suggestions,
            previewURLs: previews
        )
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
        let visible = transformOutsideFences(text) { line in
            transformOutsideInlineCode(line) { prose in
                extractControls(from: prose, githubURLs: &urls)
            }
        }

        return ControlExtraction(visible: visible, githubURLs: urls)
    }

    private static func extractControls(from prose: String, githubURLs: inout [URL]) -> String {
        let markerPattern = #"<coven:github(?!-)\b((?:[^">]|"[^"]*")*?)/?>"#
        let genericPattern = #"</?coven:[A-Za-z0-9-]+\b(?:[^">]|"[^"]*")*?/?>"#
        var rendered = prose

        if let expression = try? NSRegularExpression(pattern: markerPattern) {
            let matches = expression.matches(
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
            rendered = expression.stringByReplacingMatches(
                in: rendered,
                range: NSRange(rendered.startIndex..., in: rendered),
                withTemplate: ""
            )
        }

        if let expression = try? NSRegularExpression(pattern: genericPattern) {
            rendered = expression.stringByReplacingMatches(
                in: rendered,
                range: NSRange(rendered.startIndex..., in: rendered),
                withTemplate: ""
            )
        }

        if let incomplete = rendered.range(of: "<coven:", options: .caseInsensitive) {
            rendered.removeSubrange(incomplete.lowerBound...)
        }
        return rendered
    }

    private static func parseAttributes(_ raw: String) -> [String: String] {
        guard let expression = try? NSRegularExpression(
            pattern: #"([A-Za-z-]+)="([^"]*)""#
        ) else { return [:] }

        var attributes: [String: String] = [:]
        for match in expression.matches(in: raw, range: NSRange(raw.startIndex..., in: raw)) {
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
        let withoutDefinitions = transformOutsideFences(text) { line in
            guard let definition = citationDefinition(from: line) else { return line }
            if let citation = definition.citation {
                definitions[definition.key] = citation
            }
            return ""
        }

        return transformOutsideFences(withoutDefinitions) { line in
            transformOutsideInlineCode(line) { prose in
                replaceCitationReferences(in: prose, definitions: definitions)
            }
        }
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
        if let match = firstMatch(
            pattern: #"^\[([^\]]+)\]\((https?://[^\s)]+)\)"#,
            in: raw
        ), let url = URL(string: match[2]) {
            return (providerLabel(for: url), url)
        }

        if let match = firstMatch(
            pattern: #"^<(https?://[^\s>]+)>"#,
            in: raw
        ), let url = URL(string: match[1]) {
            return (providerLabel(for: url), url)
        }

        if let match = firstMatch(
            pattern: #"^(https?://[^\s]+)"#,
            in: raw
        ), let url = URL(string: match[1]) {
            return (providerLabel(for: url), url)
        }
        return nil
    }

    private static func firstMatch(pattern: String, in text: String) -> [String]? {
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(
                  in: text,
                  range: NSRange(text.startIndex..., in: text)
              ) else { return nil }

        return (0..<match.numberOfRanges).map { index in
            guard let range = Range(match.range(at: index), in: text) else { return "" }
            return String(text[range])
        }
    }

    private static func providerLabel(for url: URL) -> String {
        let host = (url.host ?? url.absoluteString)
            .lowercased()
            .replacingOccurrences(of: "www.", with: "")
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
        guard let expression = try? NSRegularExpression(pattern: #"\[\^([^\]]+)\]"#) else {
            return text
        }

        let source = text as NSString
        let matches = expression.matches(in: text, range: NSRange(location: 0, length: source.length))
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
            } else if key.range(of: #"^\d{1,4}$"#, options: .regularExpression) != nil {
                replacement = ""
            } else {
                continue
            }
            rendered.replaceCharacters(in: match.range, with: replacement)
        }
        return rendered as String
    }

    private static func bareLineURLs(in text: String) -> [URL] {
        var urls: [URL] = []
        _ = transformOutsideFences(text) { line in
            let candidate = line.trimmingCharacters(in: .whitespaces)
            if let url = URL(string: candidate),
               url.scheme == "http" || url.scheme == "https",
               !candidate.contains(where: \.isWhitespace) {
                urls.append(url)
            }
            return line
        }
        return urls
    }

    private static func transformOutsideFences(
        _ text: String,
        transform: (String) -> String
    ) -> String {
        var inFence = false
        return text
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { substring in
                let line = String(substring)
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                    inFence.toggle()
                    return line
                }
                return inFence ? line : transform(line)
            }
            .joined(separator: "\n")
    }

    private static func transformOutsideInlineCode(
        _ text: String,
        transform: (String) -> String
    ) -> String {
        guard let expression = try? NSRegularExpression(pattern: #"`+[^`]*`+"#) else {
            return transform(text)
        }
        let source = text as NSString
        let matches = expression.matches(in: text, range: NSRange(location: 0, length: source.length))
        guard !matches.isEmpty else { return transform(text) }

        var output = ""
        var cursor = 0
        for match in matches {
            let proseRange = NSRange(location: cursor, length: match.range.location - cursor)
            output += transform(source.substring(with: proseRange))
            output += source.substring(with: match.range)
            cursor = NSMaxRange(match.range)
        }
        output += transform(source.substring(from: cursor))
        return output
    }

    private static func deduplicated(_ urls: [URL]) -> [URL] {
        var seen: Set<String> = []
        return urls.filter { seen.insert($0.absoluteString).inserted }
    }

    private static func normalize(_ text: String) -> String {
        text
            .replacingOccurrences(
                of: #"[ \t]+\n"#,
                with: "\n",
                options: .regularExpression
            )
            .replacingOccurrences(
                of: #"\n{3,}"#,
                with: "\n\n",
                options: .regularExpression
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
