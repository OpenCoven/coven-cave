import Foundation

/// Cave event plane, protocol v1 (#5830), on iOS (#5864).
///
/// The event socket carries invalidations only: "this snapshot may be stale",
/// never resource payloads. REST snapshots stay authoritative. These types
/// mirror `src/lib/cave-event-plane-protocol.ts` and decode the shared golden
/// fixture (`CovenCaveTests/Fixtures/cave-event-plane-v1.json`). Parsing is
/// strict and fails closed: an unknown message type, topic or protocol version
/// throws rather than being ignored.
enum CaveEventWire {
    static let protocolVersion = 1
    static let path = "/api/events-ws"
    /// Frames are bounded before parsing.
    static let maxMessageBytes = 16 * 1024
    static let maxEntityIds = 32
    static let maxEntityIdBytes = 256
    /// Client ids and epochs are opaque labels, not payloads.
    static let maxLabelBytes = 128
    /// JavaScript's `Number.MAX_SAFE_INTEGER`: the server never sends more.
    static let maxSafeInteger = 9_007_199_254_740_991
}

/// Close codes shared by the server, the TypeScript client and this client.
enum CaveEventCloseCode {
    /// Unsupported protocol version. Not retryable with the same client.
    static let unsupportedProtocol = 4400
    /// Malformed, binary, oversized or otherwise invalid frame.
    static let invalidFrame = 4402
    /// Slow consumer. Retryable with backoff.
    static let slowConsumer = 4408
}

enum CaveEventWireError: Error, Equatable {
    case invalid(String)
    case unsupportedProtocol
}

enum CaveEventTopic: String, Codable, CaseIterable, Comparable, Sendable {
    case sessions, board, runs, familiars, daemon

    /// Canonical wire order, so a topic set always encodes the same way.
    static func < (lhs: CaveEventTopic, rhs: CaveEventTopic) -> Bool {
        let order = CaveEventTopic.allCases
        return order.firstIndex(of: lhs)! < order.firstIndex(of: rhs)!
    }
}

enum CaveEventResyncReason: String, Codable, Sendable {
    case serverRestarted = "server-restarted"
    case replayGap = "replay-gap"
}

enum CaveEventRolloutMode: String, Codable, Sendable {
    case off, shadow, primary

    /// An unrecognized mode fails closed to `off`, as the server does.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = CaveEventRolloutMode(rawValue: raw.trimmingCharacters(in: .whitespaces).lowercased()) ?? .off
    }
}

struct CaveEventRolloutModes: Codable, Equatable, Sendable {
    let web: CaveEventRolloutMode
    let ios: CaveEventRolloutMode
}

/// What `/api/events/capability` offers (`{ ok, eventPlane }`).
struct CaveEventCapability: Codable, Equatable, Sendable {
    let enabled: Bool
    let protocolVersion: Int
    let path: String
    let topics: [CaveEventTopic]
    let rolloutMode: CaveEventRolloutModes

    /// The mode this iOS client may run in. The web field never applies here,
    /// and an unusable capability is `off`.
    var iosMode: CaveEventRolloutMode {
        guard enabled, protocolVersion == CaveEventWire.protocolVersion, path == CaveEventWire.path else { return .off }
        return rolloutMode.ios
    }

    static let off = CaveEventCapability(
        enabled: false,
        protocolVersion: CaveEventWire.protocolVersion,
        path: CaveEventWire.path,
        topics: [],
        rolloutMode: CaveEventRolloutModes(web: .off, ios: .off)
    )
}

struct CaveEventCapabilityResponse: Decodable {
    let eventPlane: CaveEventCapability
}

struct CaveEventCloseCodes: Codable, Equatable, Sendable {
    let `protocol`: Int
    let invalidFrame: Int
    let slowConsumer: Int
}

struct CaveEventResumeCursor: Equatable, Sendable {
    let epoch: String
    let seq: Int
}

struct CaveEventReady: Equatable, Sendable {
    let epoch: String
    let seq: Int
    let topics: [CaveEventTopic]
    let versions: [CaveEventTopic: Int]
}

struct CaveEventInvalidation: Equatable, Sendable {
    let epoch: String
    let seq: Int
    let topic: CaveEventTopic
    /// The topic's version. A resync is delivered as version 0 with no ids.
    let version: Int
    /// Advisory. `nil` means the whole topic may be stale.
    let entityIds: [String]?
}

struct CaveEventResync: Equatable, Sendable {
    let epoch: String
    let seq: Int
    let topics: [CaveEventTopic]
    let reason: CaveEventResyncReason
}

enum CaveEventServerMessage: Equatable, Sendable {
    case ready(CaveEventReady)
    case invalidate(CaveEventInvalidation)
    case resyncRequired(CaveEventResync)

    /// Parse one text frame. Throws `.unsupportedProtocol` for another protocol
    /// version and `.invalid` for anything else that isn't a v1 server message.
    static func parse(_ text: String) throws -> CaveEventServerMessage {
        try parse(object: CaveEventJSON.decodeFrame(text))
    }

    static func parse(object message: [String: Any]) throws -> CaveEventServerMessage {
        try CaveEventJSON.requireProtocol(message)
        let epoch = try CaveEventJSON.label(message["epoch"], "epoch")
        let seq = try CaveEventJSON.count(message["seq"], "seq")
        switch message["type"] as? String {
        case "ready":
            let topics = try CaveEventJSON.topics(message["topics"])
            return .ready(CaveEventReady(
                epoch: epoch,
                seq: seq,
                topics: topics,
                versions: try CaveEventJSON.versions(message["versions"], topics: topics)
            ))
        case "invalidate":
            return .invalidate(CaveEventInvalidation(
                epoch: epoch,
                seq: seq,
                topic: try CaveEventJSON.topic(message["topic"]),
                version: try CaveEventJSON.count(message["version"], "topic version"),
                entityIds: try CaveEventJSON.entityIds(message["entityIds"])
            ))
        case "resync-required":
            guard let raw = message["reason"] as? String, let reason = CaveEventResyncReason(rawValue: raw) else {
                throw CaveEventWireError.invalid("unknown event resync reason")
            }
            return .resyncRequired(CaveEventResync(
                epoch: epoch,
                seq: seq,
                topics: try CaveEventJSON.topics(message["topics"]),
                reason: reason
            ))
        default:
            throw CaveEventWireError.invalid("unknown event message type")
        }
    }
}

/// Messages this client sends.
enum CaveEventClientMessage: Equatable, Sendable {
    case hello(clientId: String, topics: Set<CaveEventTopic>, resume: CaveEventResumeCursor?)
    /// A complete replacement of the subscribed set, answered with a fresh `ready`.
    case subscribe(topics: Set<CaveEventTopic>)
    case ack(epoch: String, seq: Int)

    var jsonObject: [String: Any] {
        switch self {
        case let .hello(clientId, topics, resume):
            var object: [String: Any] = [
                "type": "hello",
                "protocol": CaveEventWire.protocolVersion,
                "clientId": clientId,
                "topics": topics.sorted().map(\.rawValue),
            ]
            if let resume { object["resume"] = ["epoch": resume.epoch, "seq": resume.seq] }
            return object
        case let .subscribe(topics):
            return ["type": "subscribe", "protocol": CaveEventWire.protocolVersion, "topics": topics.sorted().map(\.rawValue)]
        case let .ack(epoch, seq):
            return ["type": "ack", "protocol": CaveEventWire.protocolVersion, "epoch": epoch, "seq": seq]
        }
    }

    func encoded() throws -> String {
        let data = try JSONSerialization.data(withJSONObject: jsonObject, options: [.sortedKeys])
        guard let text = String(data: data, encoding: .utf8) else { throw CaveEventWireError.invalid("unencodable event message") }
        return text
    }
}

/// Strict field readers shared by the server-message parser and the fixture.
enum CaveEventJSON {
    static func decodeFrame(_ text: String) throws -> [String: Any] {
        guard text.utf8.count <= CaveEventWire.maxMessageBytes else {
            throw CaveEventWireError.invalid("event message exceeds 16 KiB")
        }
        let parsed: Any
        do {
            parsed = try JSONSerialization.jsonObject(with: Data(text.utf8))
        } catch {
            throw CaveEventWireError.invalid("event message is not JSON")
        }
        guard let object = parsed as? [String: Any] else { throw CaveEventWireError.invalid("event message must be an object") }
        return object
    }

    static func requireProtocol(_ message: [String: Any]) throws {
        guard let number = message["protocol"] as? NSNumber, !isBool(number), number.doubleValue == Double(CaveEventWire.protocolVersion) else {
            throw CaveEventWireError.unsupportedProtocol
        }
    }

    static func isBool(_ number: NSNumber) -> Bool {
        CFGetTypeID(number) == CFBooleanGetTypeID()
    }

    static func count(_ value: Any?, _ field: String) throws -> Int {
        guard let number = value as? NSNumber, !isBool(number) else {
            throw CaveEventWireError.invalid("event \(field) must be a non-negative safe integer")
        }
        let double = number.doubleValue
        guard double.rounded() == double, double >= 0, double <= Double(CaveEventWire.maxSafeInteger) else {
            throw CaveEventWireError.invalid("event \(field) must be a non-negative safe integer")
        }
        return number.intValue
    }

    static func label(_ value: Any?, _ field: String) throws -> String {
        guard let text = value as? String, !text.isEmpty else { throw CaveEventWireError.invalid("event \(field) must be a non-empty string") }
        guard text.utf8.count <= CaveEventWire.maxLabelBytes else { throw CaveEventWireError.invalid("event \(field) exceeds 128 bytes") }
        return text
    }

    static func topic(_ value: Any?) throws -> CaveEventTopic {
        guard let raw = value as? String, let topic = CaveEventTopic(rawValue: raw) else {
            throw CaveEventWireError.invalid("unknown event topic")
        }
        return topic
    }

    /// A duplicate-free list of allowlisted topics, in the sender's order.
    static func topics(_ value: Any?) throws -> [CaveEventTopic] {
        guard let raw = value as? [Any] else { throw CaveEventWireError.invalid("event topics must be an array") }
        var seen: [CaveEventTopic] = []
        for item in raw {
            let topic = try topic(item)
            guard !seen.contains(topic) else { throw CaveEventWireError.invalid("duplicate event topic") }
            seen.append(topic)
        }
        return seen
    }

    static func versions(_ value: Any?, topics: [CaveEventTopic]) throws -> [CaveEventTopic: Int] {
        guard let raw = value as? [String: Any] else { throw CaveEventWireError.invalid("event versions must be an object") }
        var versions: [CaveEventTopic: Int] = [:]
        for (key, version) in raw {
            guard let topic = CaveEventTopic(rawValue: key) else { throw CaveEventWireError.invalid("unknown event topic") }
            guard topics.contains(topic) else { throw CaveEventWireError.invalid("event version for an unsubscribed topic") }
            versions[topic] = try count(version, "topic version")
        }
        return versions
    }

    /// Advisory entity ids; `nil` for none.
    static func entityIds(_ value: Any?) throws -> [String]? {
        guard let value, !(value is NSNull) else { return nil }
        guard let raw = value as? [Any] else { throw CaveEventWireError.invalid("event entity ids must be an array") }
        guard raw.count <= CaveEventWire.maxEntityIds else { throw CaveEventWireError.invalid("an event names at most 32 entity ids") }
        var ids: [String] = []
        for item in raw {
            guard let id = item as? String, !id.isEmpty else { throw CaveEventWireError.invalid("event entity ids must be non-empty strings") }
            guard id.utf8.count <= CaveEventWire.maxEntityIdBytes else { throw CaveEventWireError.invalid("event entity ids are at most 256 bytes") }
            if !ids.contains(id) { ids.append(id) }
        }
        return ids.isEmpty ? nil : ids
    }
}
