import Foundation

enum ChatTimelineEntry: Identifiable, Hashable {
    case text(id: String, text: String)
    case tool(ActivityStep)
    case reasoning(ChatReasoningBlock)

    var id: String {
        switch self {
        case .text(let id, _): id
        case .tool(let step): "tool:\(step.id)"
        case .reasoning(let block): "reasoning:\(block.id)"
        }
    }
    var kind: String {
        switch self {
        case .text: "text"
        case .tool: "tool"
        case .reasoning: "reasoning"
        }
    }
}

/// The web timeline's observation/UTF-16 contract. Layout never grants a
/// marker authority and never guesses chronology from timestamps or names.
enum ChatActivityTimeline {
    private struct Positioned {
        var entry: ChatTimelineEntry
        var sequence: Int
        var offset: Int
    }
    private struct Marker {
        var range: NSRange
        var name: String
        var group: String?
    }
    private static let markerOpener = try! NSRegularExpression(pattern: #"<coven:([a-zA-Z-]+)\b"#)
    private static let groupAttribute = try! NSRegularExpression(pattern: #"\bgroup="([^"]+)""#)
    private static let richLine = try! NSRegularExpression(pattern: #"[`*_~<>\[\]\\]|^\s*(?:[-+]\s|\d+[.)]\s|#{1,6}\s|>|\|)"#)

    static func entries(text: String, steps: [ActivityStep], reasoning: [ChatReasoningBlock]) -> [ChatTimelineEntry]? {
        var positioned: [Positioned] = []
        var runs = Set<String>()
        for step in steps where step.kind == .tool {
            guard let activity = step.activity?.validated(callId: step.id, status: step.status.rawValue),
                  let sequence = activity.sequence, let offset = step.textOffset, offset >= 0 else { return nil }
            runs.insert(activity.runId)
            positioned.append(Positioned(entry: .tool(step), sequence: sequence, offset: offset))
        }
        for block in reasoning {
            guard let block = block.validated, let observation = block.observation,
                  let sequence = observation.sequence, let offset = block.textOffset else { return nil }
            runs.insert(observation.runId)
            positioned.append(Positioned(entry: .reasoning(block), sequence: sequence, offset: offset))
        }
        guard !positioned.isEmpty, runs.count == 1,
              Set(positioned.map(\.sequence)).count == positioned.count,
              Set(positioned.map { $0.entry.id }).count == positioned.count else { return nil }
        let source = text as NSString
        let boundaries = boundaries(in: text)
        for index in positioned.indices {
            let offset = positioned[index].offset
            var low = 0
            var high = boundaries.count
            while low < high {
                let middle = low + (high - low) / 2
                if boundaries[middle] < offset { low = middle + 1 } else { high = middle }
            }
            positioned[index].offset = offset <= 0 ? 0 : low < boundaries.count ? boundaries[low] : source.length
        }
        positioned.sort { $0.offset == $1.offset ? $0.sequence < $1.sequence : $0.offset < $1.offset }
        var result: [ChatTimelineEntry] = []
        var cursor = 0
        var preceding = "start"
        for item in positioned {
            if item.offset > cursor {
                let span = source.substring(with: NSRange(location: cursor, length: item.offset - cursor))
                if !span.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    result.append(.text(id: "prose:\(preceding)", text: span))
                }
                cursor = item.offset
            }
            result.append(item.entry)
            preceding = item.entry.id
        }
        if cursor < source.length {
            let span = source.substring(from: cursor)
            if !span.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                result.append(.text(id: "prose:\(preceding)", text: span))
            }
        }
        return result
    }

    private static func boundaries(in text: String) -> [Int] {
        let source = text as NSString
        var markers: [Marker] = []
        var cursor = 0
        while cursor < source.length,
              let match = markerOpener.firstMatch(in: text, range: NSRange(location: cursor, length: source.length - cursor)) {
            let name = source.substring(with: match.range(at: 1))
            var end = source.length
            var quoted = false
            var index = NSMaxRange(match.range)
            while index < source.length {
                let char = source.character(at: index)
                if char == 34 { quoted.toggle() }
                if char == 62 && !quoted { end = index + 1; break }
                index += 1
            }
            let raw = source.substring(with: NSRange(location: match.range.location, length: end - match.range.location))
            if !raw.hasSuffix("/>") {
                let close = source.range(of: "</coven:\(name)>", range: NSRange(location: end, length: source.length - end))
                if close.location != NSNotFound { end = NSMaxRange(close) }
            }
            let group = groupAttribute.firstMatch(in: raw, range: NSRange(location: 0, length: (raw as NSString).length))
                .map { (raw as NSString).substring(with: $0.range(at: 1)) }
            markers.append(Marker(range: NSRange(location: match.range.location, length: end - match.range.location), name: name, group: group))
            cursor = end
        }
        let masked = NSMutableString(string: text)
        for marker in markers.reversed() {
            let content = source.substring(with: marker.range)
            // Preserve UTF-16 length even when a marker contains emoji.
            let replacement = content.utf16.map { $0 == 10 || $0 == 13 ? $0 : UInt16(32) }
            masked.replaceCharacters(in: marker.range, with: String(decoding: replacement, as: UTF16.self))
        }
        let maskedText = masked as String
        let code = AssistantResponseProjection.markdownCodeRanges(in: maskedText)
            .map { NSRange($0, in: maskedText) }.sorted { $0.location < $1.location }
        var atomic = code + markers.map(\.range)
        // Streaming inline code may not have its closing delimiter yet. Keep
        // that tail together, and support inline code spanning newlines.
        let units = maskedText as NSString
        cursor = 0
        var codeIndex = 0
        while cursor < units.length {
            // Both cursors move forward. Re-scanning every prior code range
            // for every prose character makes long tool transcripts quadratic.
            while codeIndex < code.count && NSMaxRange(code[codeIndex]) <= cursor { codeIndex += 1 }
            if codeIndex < code.count && cursor >= code[codeIndex].location {
                cursor = NSMaxRange(code[codeIndex]); continue
            }
            guard units.character(at: cursor) == 96 else { cursor += 1; continue }
            let start = cursor
            while cursor < units.length && units.character(at: cursor) == 96 { cursor += 1 }
            let length = cursor - start
            var search = cursor
            var searchCodeIndex = codeIndex
            var end = units.length
            while search < units.length {
                while searchCodeIndex < code.count && NSMaxRange(code[searchCodeIndex]) <= search { searchCodeIndex += 1 }
                if searchCodeIndex < code.count && search >= code[searchCodeIndex].location {
                    search = NSMaxRange(code[searchCodeIndex]); continue
                }
                guard units.character(at: search) == 96 else { search += 1; continue }
                let run = search
                while search < units.length && units.character(at: search) == 96 { search += 1 }
                if search - run == length { end = search; break }
            }
            atomic.append(NSRange(location: start, length: end - start)); cursor = end
            codeIndex = searchCodeIndex
        }
        var decks: [String: NSRange] = [:]
        var previous: Marker?
        for marker in markers where !code.contains(where: { NSLocationInRange(marker.range.location, $0) }) {
            if marker.name == "image", let group = marker.group {
                let start = decks[group]?.location ?? marker.range.location
                decks[group] = NSRange(location: start, length: NSMaxRange(marker.range) - start)
            }
            if ["image", "approve"].contains(marker.name), let prior = previous, prior.name == marker.name,
               source.substring(with: NSRange(location: NSMaxRange(prior.range), length: marker.range.location - NSMaxRange(prior.range)))
                .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                atomic.append(NSRange(location: prior.range.location, length: NSMaxRange(marker.range) - prior.range.location))
            }
            previous = marker
        }
        atomic += decks.values
        var points = markers.flatMap { [$0.range.location, NSMaxRange($0.range)] }
        var position = 0
        var previousBlank = false
        var fence: String?
        var plainParagraph = true
        for line in text.components(separatedBy: "\n") {
            let lead = line.trimmingCharacters(in: .whitespaces)
            let blank = lead.isEmpty
            if fence == nil && previousBlank && !blank { points.append(position) }
            let marker = lead.hasPrefix("```") ? "```" : lead.hasPrefix("~~~") ? "~~~" : nil
            if let marker, fence == nil || fence == marker { fence = fence == nil ? marker : nil }
            previousBlank = fence == nil && blank
            let length = (line as NSString).length
            plainParagraph = plainParagraph && richLine.firstMatch(in: line, range: NSRange(location: 0, length: length)) == nil
            if position + length < source.length && plainParagraph { points.append(position + length + 1) }
            if blank { plainParagraph = true }
            position += length + 1
        }
        let orderedAtomic = atomic.sorted { $0.location < $1.location }
        var atomicIndex = 0
        var coveredUntil = 0
        return Set(points).filter { $0 >= 0 && $0 <= source.length }.sorted().filter { point in
            // Strict start/end comparisons preserve the safe seam between
            // touching ranges while overlapping ranges remain indivisible.
            while atomicIndex < orderedAtomic.count && orderedAtomic[atomicIndex].location < point {
                coveredUntil = max(coveredUntil, NSMaxRange(orderedAtomic[atomicIndex]))
                atomicIndex += 1
            }
            return point >= coveredUntil
        }
    }
}
