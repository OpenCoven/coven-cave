import Foundation

/// An inbox item from `GET /api/inbox`. The Reminders view shows the
/// `kind == "reminder"` items. Only the fields the app uses are modelled —
/// Codable ignores the rest (recurrence, media, source, …).
struct Reminder: Identifiable, Codable, Hashable {
    struct Link: Codable, Hashable {
        enum Kind: Hashable {
            case session
            case card
            case memory
            case url
            case other(String)

            private var rawValue: String {
                switch self {
                case .session: return "session"
                case .card: return "card"
                case .memory: return "memory"
                case .url: return "url"
                case .other(let raw): return raw
                }
            }
        }

        var kind: Kind
        var ref: String?
        var sessionId: String?
        var threadId: String?
        var cardId: String?
        var taskId: String?

        var resolvedThreadNavigationID: String? {
            switch kind {
            case .session:
                return Self.normalized(threadId) ?? Self.normalized(sessionId) ?? Self.normalized(ref)
            default:
                return nil
            }
        }

        var resolvedTaskID: String? {
            switch kind {
            case .card:
                return Self.normalized(taskId) ?? Self.normalized(cardId) ?? Self.normalized(ref)
            default:
                return nil
            }
        }

        init(
            kind: Kind,
            ref: String? = nil,
            sessionId: String? = nil,
            threadId: String? = nil,
            cardId: String? = nil,
            taskId: String? = nil
        ) {
            self.kind = kind
            self.ref = Self.normalized(ref)
            self.sessionId = Self.normalized(sessionId)
            self.threadId = Self.normalized(threadId)
            self.cardId = Self.normalized(cardId)
            self.taskId = Self.normalized(taskId)
        }

        private enum CodingKeys: String, CodingKey {
            case kind
            case ref
            case sessionId
            case threadId
            case cardId
            case taskId
        }

        private static func normalized(_ value: String?) -> String? {
            guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !trimmed.isEmpty else {
                return nil
            }
            return trimmed
        }
    }

    let id: String
    var kind: String
    var title: String
    var body: String?
    var status: String
    var fireAt: String?
    var firedAt: String?
    var createdAt: String?
    var updatedAt: String?
    var familiarId: String?
    var link: Link?

    /// Best timestamp to show / sort by.
    var whenISO: String? { fireAt ?? firedAt ?? createdAt }

    private enum CodingKeys: String, CodingKey {
        case id
        case kind
        case title
        case body
        case status
        case fireAt
        case firedAt
        case createdAt
        case updatedAt
        case familiarId
        case link
    }

    init(
        id: String,
        kind: String,
        title: String,
        body: String? = nil,
        status: String,
        fireAt: String? = nil,
        firedAt: String? = nil,
        createdAt: String? = nil,
        updatedAt: String? = nil,
        familiarId: String? = nil,
        link: Link? = nil
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.body = body
        self.status = status
        self.fireAt = fireAt
        self.firedAt = firedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.familiarId = familiarId
        self.link = link
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(String.self, forKey: .kind)
        title = try container.decode(String.self, forKey: .title)
        body = try container.decodeIfPresent(String.self, forKey: .body)
        status = try container.decode(String.self, forKey: .status)
        fireAt = try container.decodeIfPresent(String.self, forKey: .fireAt)
        firedAt = try container.decodeIfPresent(String.self, forKey: .firedAt)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        familiarId = try container.decodeIfPresent(String.self, forKey: .familiarId)
        link = try? container.decode(Link.self, forKey: .link)
    }
}

extension Reminder.Link.Kind: Codable {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw {
        case "session": self = .session
        case "card": self = .card
        case "memory": self = .memory
        case "url": self = .url
        default: self = .other(raw)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

extension Reminder.Link {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            kind: try container.decode(Kind.self, forKey: .kind),
            ref: try container.decodeIfPresent(String.self, forKey: .ref),
            sessionId: try container.decodeIfPresent(String.self, forKey: .sessionId),
            threadId: try container.decodeIfPresent(String.self, forKey: .threadId),
            cardId: try container.decodeIfPresent(String.self, forKey: .cardId),
            taskId: try container.decodeIfPresent(String.self, forKey: .taskId)
        )
    }
}

struct InboxResponse: Decodable { let ok: Bool; let items: [Reminder] }
