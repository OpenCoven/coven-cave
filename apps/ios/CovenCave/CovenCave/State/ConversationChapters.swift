import Foundation

/// Source references only. Display dates and local message IDs never enter the
/// canonical chapter algorithm.
struct ChapterSourceTurn: Equatable {
    var id: String
    var parentId: String? = nil
    var role: String = "user"
    var createdAt: String?
}

struct ConversationChapter: Identifiable, Equatable {
    let id: String
    let conversationId: String
    let day: String
    let firstTurnId: String
    var lastTurnId: String
    var turnCount: Int
}

struct ConversationChapterIndex: Equatable {
    enum Status: Equatable {
        case complete, needsRefresh, partial, unavailable
    }
    var status: Status
    var chapters: [ConversationChapter] = []

    static let needsRefresh = Self(status: .needsRefresh)
    static let unavailable = Self(status: .unavailable)
}

enum ConversationChapters {
    static let algorithm = "utc-day-v1"
    static let preferenceKey = "cave.continuity.chapters.enabled"

    private static let chapterTimestampPattern = try! NSRegularExpression(
        pattern: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$"#
    )
    private static let displayTimestampPattern = try! NSRegularExpression(
        pattern: #"^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?(Z|([+-])([0-9]{2}):([0-9]{2}))$"#
    )

    // Proleptic Gregorian arithmetic matches JavaScript's UTC calendar,
    // including year 0000. Foundation formatters introduce an era/cutover.
    private static func daysBeforeYear(_ year: Int) -> Int {
        365 * year + (year + 3) / 4 - (year + 99) / 100 + (year + 399) / 400
    }

    private static func monthLengths(_ year: Int) -> [Int] {
        [31, year.isMultiple(of: 4) && (!year.isMultiple(of: 100) || year.isMultiple(of: 400)) ? 29 : 28,
         31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    }

    /// Preserve historical display dates and orphan-echo ordering independently
    /// of the stricter chapter metadata contract enforced by `utcDay`.
    static func sourceDate(_ value: String?) -> Date? {
        guard let value,
              let match = displayTimestampPattern.firstMatch(
                in: value, range: NSRange(value.startIndex..., in: value)
              ), match.range.length == value.utf16.count else { return nil }
        func group(_ index: Int) -> String {
            guard let range = Range(match.range(at: index), in: value) else { return "" }
            return String(value[range])
        }
        guard let hour = Int(group(2)), hour < 24,
              let minute = Int(group(3)), minute < 60,
              let second = Int(group(4)), second < 60 else { return nil }
        let parts = group(1).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        let (year, month, day) = (parts[0], parts[1], parts[2])
        guard (1...12).contains(month) else { return nil }
        let lengths = monthLengths(year)
        guard (1...lengths[month - 1]).contains(day) else { return nil }
        let dayNumber = daysBeforeYear(year) + lengths.prefix(month - 1).reduce(0, +) + day - 1
        var offset = 0
        if group(5) != "Z" {
            guard let hours = Int(group(7)), hours < 24,
                  let minutes = Int(group(8)), minutes < 60 else { return nil }
            offset = (hours * 60 + minutes) * 60 * (group(6) == "+" ? 1 : -1)
        }
        let fraction: Double
        if let dot = value.firstIndex(of: ".") {
            let digits = value[value.index(after: dot)...].prefix(while: { $0.isNumber }).prefix(3)
            fraction = Double("0.\(digits)") ?? 0
        } else {
            fraction = 0
        }
        let absoluteSeconds = Double(dayNumber * 86_400 + hour * 3_600 + minute * 60 + second - offset) + fraction
        guard absoluteSeconds >= 0, absoluteSeconds < Double(daysBeforeYear(10_000) * 86_400) else { return nil }
        return Date(timeIntervalSince1970: absoluteSeconds - Double(daysBeforeYear(1970) * 86_400))
    }

    static func utcDay(_ value: String?) -> String? {
        guard let value,
              let match = chapterTimestampPattern.firstMatch(
                in: value, range: NSRange(value.startIndex..., in: value)
              ), match.range.length == value.utf16.count,
              sourceDate(value) != nil else { return nil }
        return String(value.prefix(10))
    }

    /// Preserve unlinked legacy order; otherwise validate the ancestor chain.
    /// Missing/ambiguous leaves never fall back to sorting a raw tree.
    static func activeBranch(_ turns: [ChapterSourceTurn], activeLeafId: String?) -> [ChapterSourceTurn]? {
        var byId: [String: ChapterSourceTurn] = [:]
        for turn in turns {
            guard !turn.id.isEmpty, byId.updateValue(turn, forKey: turn.id) == nil else { return nil }
        }
        guard !turns.isEmpty else { return [] }
        // Legacy transcripts carry no tree links. Their stored sequence is
        // authoritative, even when source clocks move backwards.
        if (activeLeafId == nil || activeLeafId == ""),
           turns.allSatisfy({ $0.parentId == nil }) {
            return turns
        }
        let structural = turns.filter { !($0.role == "system" && $0.parentId == nil) }
        let leaf: String
        if let activeLeafId, !activeLeafId.isEmpty {
            leaf = activeLeafId
        } else {
            let parents = Set(structural.compactMap(\.parentId))
            let leaves = structural.filter { !parents.contains($0.id) }
            guard leaves.count == 1 else { return nil }
            leaf = leaves[0].id
        }
        var reverse: [ChapterSourceTurn] = []
        var seen = Set<String>()
        var next: String? = leaf
        while let id = next {
            guard let turn = byId[id],
                  seen.insert(id).inserted else { return nil }
            reverse.append(turn)
            next = turn.parentId
        }
        // An inferred path must contain every structural turn. Ancestor
        // system roots also belong to the path; unseen system echoes do not.
        if activeLeafId == nil || activeLeafId == "" {
            guard structural.allSatisfy({ seen.contains($0.id) }) else { return nil }
        }
        var chain = Array(reverse.reversed())
        let echoes = turns.filter { $0.role == "system" && $0.parentId == nil && !seen.contains($0.id) }
        if !echoes.isEmpty {
            // Match the production web resolver's orphan-system insertion,
            // without ever sorting the selected ancestor chain.
            // Missing dates compare as epoch; malformed dates remain unordered.
            // Only chapter derivation rejects their metadata, not body access.
            func at(_ turn: ChapterSourceTurn) -> TimeInterval {
                guard let value = turn.createdAt, !value.isEmpty else { return 0 }
                return sourceDate(value)?.timeIntervalSince1970 ?? .nan
            }
            let ordered = echoes.sorted {
                let a = at($0)
                let b = at($1)
                if a != b { return a < b }
                return $0.id.utf16.lexicographicallyPrecedes($1.id.utf16)
            }
            if ordered.allSatisfy({ at($0).isFinite }) {
                var woven: [ChapterSourceTurn] = []
                woven.reserveCapacity(chain.count + ordered.count)
                var position = 0
                for echo in ordered {
                    let date = at(echo)
                    while position < chain.count && !(at(chain[position]) > date) {
                        woven.append(chain[position])
                        position += 1
                    }
                    woven.append(echo)
                }
                woven.append(contentsOf: chain[position...])
                chain = woven
            } else {
                for echo in ordered {
                    let date = at(echo)
                    let position = chain.firstIndex { at($0) > date } ?? chain.endIndex
                    chain.insert(echo, at: position)
                }
            }
        }
        return chain
    }

    static func build(conversationId: String, activeBranch: [ChapterSourceTurn],
                      partial: Bool = false) -> ConversationChapterIndex {
        // A page-local first turn is not proof of a stable first anchor.
        guard !partial else { return .init(status: .partial) }
        guard !conversationId.isEmpty, !activeBranch.isEmpty else { return .unavailable }
        var chapters: [ConversationChapter] = []
        var seen = Set<String>()
        for turn in activeBranch {
            guard !turn.id.isEmpty, seen.insert(turn.id).inserted,
                  let day = utcDay(turn.createdAt) else { return .unavailable }
            if chapters.last?.day == day {
                chapters[chapters.count - 1].turnCount += 1
                chapters[chapters.count - 1].lastTurnId = turn.id
            } else {
                guard let data = try? JSONSerialization.data(
                    withJSONObject: [algorithm, conversationId, turn.id],
                    options: [.withoutEscapingSlashes]
                ), let id = String(data: data, encoding: .utf8) else { return .unavailable }
                chapters.append(ConversationChapter(
                    id: id, conversationId: conversationId, day: day,
                    firstTurnId: turn.id, lastTurnId: turn.id, turnCount: 1
                ))
            }
        }
        return .init(status: .complete, chapters: chapters)
    }
}
