import Foundation

/// The demand-driven event-plane client on iOS (#5864).
///
/// One socket, open only while the scene is active, the rollout mode isn't
/// `off`, an endpoint is configured and at least one subscriber wants a topic.
/// It carries invalidations only. Subscribers keep loading through their own
/// REST owners; an invalidation just tells them a snapshot may be stale.
///
/// - `shadow` validates, sequences, acknowledges and counts events, and calls
///   no handler, so polling stays authoritative.
/// - `primary` also delivers each fresh invalidation to the handlers of its
///   topic. A topic is ready, which lets a caller pause its fallback poll,
///   only after the server's `ready` barrier installed it.
///
/// Everything time-based (open timeout, ack throttle, ping, backoff) goes
/// through the injected `sleep`, and backoff jitter through `random`.
actor CaveEventSocket {
    enum State: Equatable, Sendable {
        case disabled
        case idle
        case connecting
        case ready
        case backingOff(attempt: Int)
        case degraded(String)
    }

    struct SubscriptionToken: Hashable, Sendable {
        let id: UUID
    }

    /// Where to connect, and the credential bound to that origin.
    struct Endpoint: Equatable, Sendable {
        let url: URL
        let credential: String?
        /// The origin the credential was issued for. Required with a credential.
        let credentialOrigin: String?
    }

    struct Health: Equatable, Sendable {
        let mode: CaveEventRolloutMode
        let state: State
        let readyTopics: Set<CaveEventTopic>
    }

    struct Diagnostics: Equatable, Sendable {
        var connectAttempts = 0
        var opens = 0
        var reconnects = 0
        var invalidationsObserved: [CaveEventTopic: Int] = [:]
        var invalidationsDelivered: [CaveEventTopic: Int] = [:]
        var duplicatesSuppressed = 0
        var resyncs = 0
        var acknowledgementsSent = 0
        var invalidServerMessages = 0
    }

    typealias Handler = @Sendable (CaveEventInvalidation) async -> Void
    typealias Sleep = @Sendable (Duration) async throws -> Void

    static let connectTimeout: Duration = .seconds(8)
    static let ackInterval: Duration = .seconds(1)
    static let pingInterval: Duration = .seconds(25)
    static let backoffInitial: Duration = .milliseconds(500)
    static let backoffMax: Duration = .seconds(30)

    private let clientId: String
    private let transportFactory: @Sendable () -> any CaveEventSocketTransport
    private let sleep: Sleep
    private let random: @Sendable () -> Double
    private let onHealthChange: (@Sendable (Health) async -> Void)?

    private var mode: CaveEventRolloutMode = .off
    private var endpoint: Endpoint?
    private var sceneActive = false
    private var subscriptions: [UUID: (topics: Set<CaveEventTopic>, handler: Handler)] = [:]

    private var state: State = .disabled
    private var lastHealth: Health?
    private var counters = Diagnostics()

    // One connection at a time. `generation` changes on every teardown, so a
    // task finishing for an older connection can tell and stand down.
    private var generation = 0
    private var transport: (any CaveEventSocketTransport)?
    private var openTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var ackTask: Task<Void, Never>?
    private var backoffTask: Task<Void, Never>?
    private var attempts = 0
    private var protocolRefused = false

    // Protocol state for the current server epoch, kept across reconnects so a
    // foreground resumes from where the background left off.
    private var cursor: CaveEventResumeCursor?
    private var ackedSeq = 0
    private var versions: [CaveEventTopic: Int] = [:]
    /// The set named in this connection's latest hello or subscribe.
    private var sentTopics: Set<CaveEventTopic>?
    private var readyTopics: Set<CaveEventTopic> = []
    private var barrierSeen = false
    /// Invalidations that arrived before this connection's barrier, in order.
    private var pending: [CaveEventInvalidation] = []

    init(
        clientId: String = "ios-\(UUID().uuidString.prefix(8).lowercased())",
        transportFactory: @escaping @Sendable () -> any CaveEventSocketTransport = { URLSessionCaveEventTransport() },
        sleep: @escaping Sleep = { try await Task.sleep(for: $0) },
        random: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) },
        onHealthChange: (@Sendable (Health) async -> Void)? = nil
    ) {
        self.clientId = clientId
        self.transportFactory = transportFactory
        self.sleep = sleep
        self.random = random
        self.onHealthChange = onHealthChange
    }

    // MARK: Public API

    /// Point the socket at an endpoint in a rollout mode. A different endpoint
    /// starts over: its cursor and versions belong to another server.
    func configure(endpoint: Endpoint?, mode: CaveEventRolloutMode) async {
        if endpoint != self.endpoint {
            await teardown(code: 1001)
            cancelBackoff()
            self.endpoint = endpoint
            cursor = nil
            ackedSeq = 0
            versions = [:]
            pending = []
            attempts = 0
            protocolRefused = false
        }
        if mode != self.mode { protocolRefused = false }
        self.mode = mode
        await reconcile()
    }

    func setSceneActive(_ active: Bool) async {
        guard active != sceneActive else { return }
        sceneActive = active
        if active {
            // A foreground is a fresh chance after a protocol refusal or a
            // long backoff, as the web client's capability re-read is.
            protocolRefused = false
            attempts = 0
        }
        await reconcile()
    }

    func subscribe(topics: Set<CaveEventTopic>, handler: @escaping Handler) async -> SubscriptionToken {
        let token = SubscriptionToken(id: UUID())
        subscriptions[token.id] = (topics, handler)
        await reconcile()
        return token
    }

    func unsubscribe(_ token: SubscriptionToken) async {
        subscriptions[token.id] = nil
        pending.removeAll { !wantedTopics.contains($0.topic) }
        await reconcile()
    }

    func stateSnapshot() -> State { state }

    func rolloutMode() -> CaveEventRolloutMode { mode }

    /// True only while connected and the latest barrier installed `topic`.
    func topicReady(_ topic: CaveEventTopic) -> Bool {
        state == .ready && readyTopics.contains(topic)
    }

    func diagnostics() -> Diagnostics { counters }

    // MARK: Connection lifecycle

    private var wantedTopics: Set<CaveEventTopic> {
        subscriptions.values.reduce(into: Set<CaveEventTopic>()) { $0.formUnion($1.topics) }
    }

    private var shouldConnect: Bool {
        mode != .off && endpoint != nil && sceneActive && !wantedTopics.isEmpty
    }

    private func reconcile() async {
        guard shouldConnect else {
            await teardown(code: 1001)
            cancelBackoff()
            await setState(mode == .off ? .disabled : .idle)
            return
        }
        if protocolRefused { return }
        if let transport, let sent = sentTopics {
            let wanted = wantedTopics
            if sent != wanted {
                // A complete replacement; topics it adds stay unready until the
                // server's next barrier confirms them.
                sentTopics = wanted
                readyTopics.formIntersection(wanted)
                await emitHealth()
                await send(.subscribe(topics: wanted), over: transport, generation: generation)
            }
            return
        }
        if transport != nil || backoffTask != nil { return }
        await connect()
    }

    private func connect() async {
        guard let endpoint else { return }
        if let credential = endpoint.credential, !credential.isEmpty {
            guard CaveConnection.isCredentialTransportSecure(endpoint.url),
                  let origin = CaveConnection.credentialOrigin(for: endpoint.url),
                  origin == endpoint.credentialOrigin
            else {
                await setState(.degraded("credential origin mismatch"))
                return
            }
        }
        generation += 1
        let connection = generation
        counters.connectAttempts += 1
        barrierSeen = false
        sentTopics = nil
        readyTopics = []
        let transport = transportFactory()
        self.transport = transport
        await setState(.connecting)

        var request = URLRequest(url: endpoint.url)
        request.timeoutInterval = 8
        if let credential = endpoint.credential, !credential.isEmpty {
            request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        }
        let sleep = self.sleep
        openTask = Task { [weak self] in
            let opened = await withTaskGroup(of: Bool.self) { group in
                group.addTask {
                    do {
                        try await transport.open(request)
                        return true
                    } catch {
                        return false
                    }
                }
                group.addTask {
                    do {
                        try await sleep(CaveEventSocket.connectTimeout)
                    } catch {
                        return false
                    }
                    // Unblocks the pending open, which then reports failure.
                    transport.close(code: 1001, reason: "connect timeout")
                    return false
                }
                let first = await group.next() ?? false
                group.cancelAll()
                return first
            }
            await self?.openFinished(opened, generation: connection)
        }
    }

    private func openFinished(_ opened: Bool, generation connection: Int) async {
        guard connection == generation, let transport else { return }
        openTask = nil
        guard opened else {
            await connectionFailed(generation: connection, code: 1001)
            return
        }
        counters.opens += 1
        let wanted = wantedTopics
        sentTopics = wanted
        guard await send(.hello(clientId: clientId, topics: wanted, resume: cursor), over: transport, generation: connection) else { return }
        receiveTask = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let message = try await transport.receive()
                    guard let self else { return }
                    await self.handle(message, generation: connection)
                }
            } catch {
                await self?.connectionLost(error, generation: connection)
            }
        }
        let sleep = self.sleep
        pingTask = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    try await sleep(CaveEventSocket.pingInterval)
                    try await transport.sendPing()
                }
            } catch {
                if Task.isCancelled { return }
                await self?.connectionLost(error, generation: connection)
            }
        }
    }

    @discardableResult
    private func send(_ message: CaveEventClientMessage, over transport: any CaveEventSocketTransport, generation connection: Int) async -> Bool {
        do {
            try await transport.send(message.encoded())
            return true
        } catch {
            await connectionLost(error, generation: connection)
            return false
        }
    }

    private func connectionLost(_ error: Error, generation connection: Int) async {
        guard connection == generation else { return }
        if (error as? CaveEventTransportClosed)?.code == CaveEventCloseCode.unsupportedProtocol {
            await refuseProtocol()
            return
        }
        await connectionFailed(generation: connection, code: 1001)
    }

    private func connectionFailed(generation connection: Int, code: Int) async {
        guard connection == generation else { return }
        await teardown(code: code)
        guard shouldConnect else {
            await reconcile()
            return
        }
        scheduleBackoff()
        await setState(.backingOff(attempt: attempts))
    }

    private func refuseProtocol() async {
        await teardown(code: 1000)
        protocolRefused = true
        await setState(.degraded("unsupported protocol"))
    }

    /// 500 ms doubling to 30 s, with ±20% jitter, as the web client does.
    private func scheduleBackoff() {
        let base = min(Self.backoffMax, Self.backoffInitial * (1 << min(attempts, 16)))
        let delay = min(Self.backoffMax, base * (0.8 + 0.4 * random()))
        attempts += 1
        let sleep = self.sleep
        backoffTask = Task { [weak self] in
            do {
                try await sleep(delay)
            } catch {
                return
            }
            await self?.backoffElapsed()
        }
    }

    private func backoffElapsed() async {
        backoffTask = nil
        counters.reconnects += 1
        await reconcile()
    }

    private func cancelBackoff() {
        backoffTask?.cancel()
        backoffTask = nil
    }

    private func teardown(code: Int) async {
        guard transport != nil || openTask != nil else { return }
        generation += 1
        openTask?.cancel()
        receiveTask?.cancel()
        pingTask?.cancel()
        ackTask?.cancel()
        openTask = nil
        receiveTask = nil
        pingTask = nil
        ackTask = nil
        transport?.close(code: code, reason: nil)
        transport = nil
        sentTopics = nil
        readyTopics = []
        barrierSeen = false
        await emitHealth()
    }

    // MARK: Server messages

    private func handle(_ message: URLSessionWebSocketTask.Message, generation connection: Int) async {
        guard connection == generation else { return }
        let parsed: CaveEventServerMessage
        do {
            guard case let .string(text) = message else { throw CaveEventWireError.invalid("event frames must be text") }
            parsed = try CaveEventServerMessage.parse(text)
        } catch CaveEventWireError.unsupportedProtocol {
            await refuseProtocol()
            return
        } catch {
            counters.invalidServerMessages += 1
            await connectionFailed(generation: connection, code: CaveEventCloseCode.invalidFrame)
            return
        }
        switch parsed {
        case let .ready(ready): await handleReady(ready)
        case let .invalidate(invalidation): await handleInvalidation(invalidation, generation: connection)
        case let .resyncRequired(resync): await handleResync(resync, generation: connection)
        }
    }

    private func handleReady(_ ready: CaveEventReady) async {
        if cursor?.epoch != ready.epoch {
            versions = [:]
            ackedSeq = 0
            cursor = CaveEventResumeCursor(epoch: ready.epoch, seq: ready.seq)
        } else if let current = cursor, ready.seq > current.seq {
            cursor = CaveEventResumeCursor(epoch: ready.epoch, seq: ready.seq)
        }
        for (topic, version) in ready.versions {
            versions[topic] = max(versions[topic] ?? 0, version)
        }
        readyTopics = Set(ready.topics).intersection(wantedTopics).intersection(sentTopics ?? [])
        barrierSeen = true
        attempts = 0
        await setState(.ready)
        // Replayed or resynced topics held until the barrier now go out.
        let held = pending
        pending = []
        for invalidation in held { await deliver(invalidation) }
    }

    private func handleInvalidation(_ invalidation: CaveEventInvalidation, generation connection: Int) async {
        if let current = cursor, current.epoch == invalidation.epoch, invalidation.seq <= current.seq {
            counters.duplicatesSuppressed += 1
            return
        }
        if cursor?.epoch != invalidation.epoch {
            versions = [:]
            ackedSeq = 0
        }
        cursor = CaveEventResumeCursor(epoch: invalidation.epoch, seq: invalidation.seq)
        scheduleAck(generation: connection)
        if let known = versions[invalidation.topic], invalidation.version <= known {
            counters.duplicatesSuppressed += 1
            return
        }
        versions[invalidation.topic] = invalidation.version
        counters.invalidationsObserved[invalidation.topic, default: 0] += 1
        guard wantedTopics.contains(invalidation.topic) else { return }
        if !barrierSeen {
            pending.removeAll { $0.topic == invalidation.topic }
            pending.append(invalidation)
            return
        }
        await deliver(invalidation)
    }

    private func handleResync(_ resync: CaveEventResync, generation connection: Int) async {
        counters.resyncs += 1
        if cursor?.epoch != resync.epoch { versions = [:] }
        cursor = CaveEventResumeCursor(epoch: resync.epoch, seq: resync.seq)
        ackedSeq = 0
        for topic in resync.topics where wantedTopics.contains(topic) {
            versions[topic] = nil
            let invalidation = CaveEventInvalidation(epoch: resync.epoch, seq: resync.seq, topic: topic, version: 0, entityIds: nil)
            if barrierSeen {
                await deliver(invalidation)
            } else {
                pending.removeAll { $0.topic == topic }
                pending.append(invalidation)
            }
        }
    }

    private func deliver(_ invalidation: CaveEventInvalidation) async {
        guard mode == .primary, sceneActive else { return }
        let handlers = subscriptions.values.filter { $0.topics.contains(invalidation.topic) }.map(\.handler)
        guard !handlers.isEmpty else { return }
        counters.invalidationsDelivered[invalidation.topic, default: 0] += 1
        for handler in handlers { await handler(invalidation) }
    }

    /// The highest sequence seen, at most once per `ackInterval`.
    private func scheduleAck(generation connection: Int) {
        guard ackTask == nil else { return }
        let sleep = self.sleep
        ackTask = Task { [weak self] in
            do {
                try await sleep(CaveEventSocket.ackInterval)
            } catch {
                return
            }
            await self?.flushAck(generation: connection)
        }
    }

    private func flushAck(generation connection: Int) async {
        ackTask = nil
        guard connection == generation, let transport, let cursor, cursor.seq > ackedSeq else { return }
        ackedSeq = cursor.seq
        counters.acknowledgementsSent += 1
        await send(.ack(epoch: cursor.epoch, seq: cursor.seq), over: transport, generation: connection)
    }

    // MARK: Health

    private func setState(_ next: State) async {
        state = next
        await emitHealth()
    }

    private func emitHealth() async {
        let health = Health(mode: mode, state: state, readyTopics: state == .ready ? readyTopics : [])
        guard health != lastHealth else { return }
        lastHealth = health
        await onHealthChange?(health)
    }
}
