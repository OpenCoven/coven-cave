import Foundation

/// How the app turns a paired connection into an event-socket endpoint (#5867).
///
/// The credential is resolved the same way REST resolves it, so a socket never
/// carries a token REST would refuse to send: no plaintext to a remote host and
/// no token bound to another origin. A managed device grant is REST-only by the
/// device-access design, which keeps WebSocket scopes off it, so a phone paired
/// that way gets no socket. Any refusal means no socket, and polling carries on.
enum CaveEventPlaneEndpoint {
    static func make(
        connection: CaveConnection,
        credential: (URL) throws -> String? = { try CaveConnection.credentialForRequest(to: $0) }
    ) -> CaveEventSocket.Endpoint? {
        guard let url = connection.eventSocketURL else { return nil }
        let token: String?
        do {
            token = try credential(url)
        } catch {
            return nil
        }
        guard let token, !token.isEmpty else {
            return CaveEventSocket.Endpoint(url: url, credential: nil, credentialOrigin: nil)
        }
        guard let secureURL = connection.eventSocketURLForCredentialedRequest,
              !CaveConnection.isManagedDeviceCredential(token)
        else { return nil }
        return CaveEventSocket.Endpoint(
            url: secureURL,
            credential: token,
            credentialOrigin: CaveConnection.credentialOrigin(for: secureURL)
        )
    }
}

/// Routes primary-mode invalidations to the loaders that already own each
/// resource (#5867). It never fetches on its own account.
///
/// Each topic runs at most one refresh at a time. An invalidation that lands
/// while its topic is refreshing asks for exactly one more pass afterwards,
/// because the running request may have been answered before the change.
///
/// Nothing here pauses a poll. On 2026-10-08 Val chose to keep sessions and
/// daemon polling authoritative until the daemon offers a changefeed (#5858);
/// iOS has no task-list poll, and the familiar dashboard reads daemon-owned
/// data. Invalidations only make these lists refresh sooner.
@MainActor
final class CaveEventRefreshRouter {
    struct Loaders {
        var sessions: @MainActor () async -> Void
        var tasks: @MainActor () async -> Void
        /// Tasks refresh only once something has loaded them; an untouched
        /// board isn't fetched just because it changed.
        var tasksLoaded: @MainActor () -> Bool
        var familiars: @MainActor () async -> Void
        var daemon: @MainActor () async -> Void
    }

    private let loaders: Loaders
    private var inFlight: Set<CaveEventTopic> = []
    private var rerun: Set<CaveEventTopic> = []
    private var running: [CaveEventTopic: Task<Void, Never>] = [:]
    private(set) var refreshes: [CaveEventTopic: Int] = [:]

    init(loaders: Loaders) {
        self.loaders = loaders
    }

    func receive(_ invalidation: CaveEventInvalidation) {
        let topic = invalidation.topic
        switch topic {
        case .runs:
            // Not published until a global automations feed exists (#5843).
            return
        case .board where !loaders.tasksLoaded():
            return
        default:
            break
        }
        if inFlight.contains(topic) {
            rerun.insert(topic)
            return
        }
        inFlight.insert(topic)
        running[topic] = Task { [weak self] in await self?.run(topic) }
    }

    /// Wait for every refresh the router started. For tests and teardown.
    func idle() async {
        while let task = running.values.first {
            await task.value
        }
    }

    private func run(_ topic: CaveEventTopic) async {
        repeat {
            rerun.remove(topic)
            refreshes[topic, default: 0] += 1
            await load(topic)
        } while rerun.contains(topic)
        inFlight.remove(topic)
        running[topic] = nil
    }

    private func load(_ topic: CaveEventTopic) async {
        switch topic {
        case .sessions: await loaders.sessions()
        case .board: await loaders.tasks()
        case .familiars: await loaders.familiars()
        case .daemon: await loaders.daemon()
        case .runs: return
        }
    }
}
