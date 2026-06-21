import Foundation

/// A board task as returned by `GET /api/board` (`{ ok, cards: [...] }`).
/// Mirrors the server `Card` type; only the fields the app uses are modelled
/// (Codable ignores the rest). `status`/`priority` decode leniently via raw
/// strings so an unknown future value never fails the whole list.

enum CardStatus: String, CaseIterable {
    case running, review, blocked, inbox, backlog, done

    var label: String {
        switch self {
        case .running: return "In progress"
        case .review: return "In review"
        case .blocked: return "Blocked"
        case .inbox: return "Inbox"
        case .backlog: return "Up next"
        case .done: return "Done"
        }
    }

    /// Display order for grouped sections (active work first).
    var sectionOrder: Int {
        switch self {
        case .running: return 0
        case .review: return 1
        case .blocked: return 2
        case .inbox: return 3
        case .backlog: return 4
        case .done: return 5
        }
    }

    var isActive: Bool { self != .done }
    var systemImage: String {
        switch self {
        case .running: return "play.circle.fill"
        case .review: return "eye.circle.fill"
        case .blocked: return "exclamationmark.octagon.fill"
        case .inbox: return "tray.circle.fill"
        case .backlog: return "circle.dashed"
        case .done: return "checkmark.circle.fill"
        }
    }
}

enum CardPriority: String, CaseIterable {
    case urgent, high, medium, low

    var label: String { rawValue.capitalized }
    var rank: Int {
        switch self {
        case .urgent: return 0
        case .high: return 1
        case .medium: return 2
        case .low: return 3
        }
    }
}

struct CardStep: Identifiable, Codable, Hashable {
    let id: String
    var text: String
    var done: Bool
    var doneAt: String?
}

struct BoardCard: Identifiable, Codable, Hashable {
    let id: String
    var title: String
    var notes: String?
    var statusRaw: String
    var priorityRaw: String
    var familiarId: String?
    var sessionId: String?
    var labels: [String]?
    var startDate: String?
    var endDate: String?
    var createdAt: String?
    var updatedAt: String?
    var needsHuman: Bool?
    var steps: [CardStep]?

    enum CodingKeys: String, CodingKey {
        case id, title, notes
        case statusRaw = "status"
        case priorityRaw = "priority"
        case familiarId, sessionId, labels, startDate, endDate
        case createdAt, updatedAt, needsHuman, steps
    }

    var status: CardStatus { CardStatus(rawValue: statusRaw) ?? .backlog }
    var priority: CardPriority { CardPriority(rawValue: priorityRaw) ?? .medium }

    var stepCount: Int { steps?.count ?? 0 }
    var doneStepCount: Int { steps?.filter(\.done).count ?? 0 }
    var hasSteps: Bool { stepCount > 0 }
    var stepFraction: Double { stepCount == 0 ? 0 : Double(doneStepCount) / Double(stepCount) }
    var labelList: [String] { labels ?? [] }
}

struct BoardResponse: Codable {
    let ok: Bool
    let error: String?
    let cards: [BoardCard]
}
