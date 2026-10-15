import Foundation

/// One row of the chat transcript: a day divider or a message bubble.
///
/// Rows are derived from `ChatThread.messages` only when message identity or
/// date metadata changes (append/insert/remove/replace). Streamed text deltas
/// update the embedded message in place via `TranscriptIndex` — never a
/// per-token separator re-derivation, and never a per-body `enumerated()`
/// allocation in the view.
enum TranscriptRow: Identifiable, Equatable {
    case day(id: String, date: Date)
    case message(DisplayMessage)

    var id: String {
        switch self {
        case .day(let id, _): return id
        case .message(let message): return message.id
        }
    }

    /// Derive the row list. Mirrors the transcript's day-divider rule exactly:
    /// a divider above the first message, and above any message that opens a
    /// new calendar day relative to the one before it.
    static func rows(for messages: [DisplayMessage],
                     calendar: Calendar = .current) -> [TranscriptRow] {
        var rows: [TranscriptRow] = []
        rows.reserveCapacity(messages.count + 2)
        var previous: DisplayMessage?
        for message in messages {
            let opensDay = previous.map {
                !calendar.isDate(message.createdAt, inSameDayAs: $0.createdAt)
            } ?? true
            if opensDay {
                // Keyed to the anchoring message ("day-" cannot collide with a
                // UUID message id) so a divider's identity is stable across
                // rebuilds — SwiftUI never tears down settled rows around it.
                rows.append(.day(id: "day-\(message.id)", date: message.createdAt))
            }
            rows.append(.message(message))
            previous = message
        }
        return rows
    }
}

extension TranscriptRow {
    /// The most rows the current turn keeps out of the lazy stack, so an
    /// unusually long turn (a wide group fan-out) never mounts eagerly in full.
    static let maximumCurrentTurnRows = 8

    /// Where the current turn begins (#5933): the latest user message, with
    /// the day divider directly above it when that message opens a new day.
    /// Rows from here on stay eagerly mounted, so a send never inserts the
    /// message just sent or its pending replies into the lazy stack. Without
    /// a user message only the latest row is eager.
    static func currentTurnStart(in rows: [TranscriptRow]) -> Int {
        let latestRow = max(rows.count - 1, 0)
        guard var start = rows.lastIndex(where: { row in
            if case .message(let message) = row { return message.role == .user }
            return false
        }) else { return latestRow }
        if start > 0, case .day = rows[start - 1] { start -= 1 }
        return max(start, rows.count - maximumCurrentTurnRows)
    }
}

/// O(1) message-id → array-position lookup for the stream's hot mutation
/// path. Rebuilt after structural changes; text-only mutations reuse the
/// same index.
struct TranscriptIndex {
    private(set) var positionByMessageID: [String: Int] = [:]

    mutating func rebuild(messages: [DisplayMessage]) {
        var positions = [String: Int](minimumCapacity: messages.count)
        for (position, message) in messages.enumerated() {
            positions[message.id] = position
        }
        positionByMessageID = positions
    }

    func position(of id: String) -> Int? { positionByMessageID[id] }
}
