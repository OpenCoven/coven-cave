import XCTest
@testable import CovenCave

/// The iOS event-socket actor against an in-memory transport and a manual
/// clock (#5864). No server, no wall-clock waits beyond scheduling slack.
final class CaveEventSocketTests: XCTestCase {
    private let endpoint = CaveEventSocket.Endpoint(
        url: URL(string: "wss://cave.example.test:8443/api/events-ws")!,
        credential: "device-token",
        credentialOrigin: "https://cave.example.test:8443"
    )

    // MARK: Fixture

    private struct Fixture {
        let socket: CaveEventSocket
        let transports: FakeTransportFactory
        let clock: ManualSleeper
        let deliveries: DeliveryLog
        let health: HealthLog

        var transport: FakeCaveEventTransport { transports.made.last! }
    }

    private func makeFixture(random: Double = 0.5) -> Fixture {
        let transports = FakeTransportFactory()
        let clock = ManualSleeper()
        let health = HealthLog()
        let socket = CaveEventSocket(
            clientId: "ios-test",
            transportFactory: { transports.make() },
            sleep: { try await clock.sleep($0) },
            random: { random },
            onHealthChange: { await health.record($0) }
        )
        return Fixture(socket: socket, transports: transports, clock: clock, deliveries: DeliveryLog(), health: health)
    }

    /// Active, configured, subscribed to `topics`, opened, helloed and ready.
    private func readyFixture(
        mode: CaveEventRolloutMode = .primary,
        topics: Set<CaveEventTopic> = [.sessions],
        epoch: String = "boot-a",
        seq: Int = 42,
        versions: [String: Int] = [:]
    ) async throws -> Fixture {
        let fixture = makeFixture()
        await fixture.socket.configure(endpoint: endpoint, mode: mode)
        await fixture.socket.setSceneActive(true)
        _ = await fixture.socket.subscribe(topics: topics) { [log = fixture.deliveries] in await log.record($0) }
        try await waitUntil { fixture.transports.made.count == 1 }
        fixture.transport.completeOpen()
        try await waitUntil { fixture.transport.sentTypes == ["hello"] }
        fixture.transport.serverSend(ready(epoch: epoch, seq: seq, topics: topics, versions: versions))
        try await waitUntilAsync { await fixture.socket.stateSnapshot() == .ready }
        return fixture
    }

    private func ready(epoch: String, seq: Int, topics: Set<CaveEventTopic>, versions: [String: Int] = [:]) -> String {
        json(["type": "ready", "protocol": 1, "epoch": epoch, "seq": seq, "topics": topics.sorted().map(\.rawValue), "versions": versions])
    }

    private func invalidate(_ topic: CaveEventTopic, seq: Int, version: Int, epoch: String = "boot-a") -> String {
        json(["type": "invalidate", "protocol": 1, "epoch": epoch, "seq": seq, "topic": topic.rawValue, "version": version])
    }

    private func json(_ object: [String: Any]) -> String {
        String(decoding: try! JSONSerialization.data(withJSONObject: object), as: UTF8.self)
    }

    // MARK: Demand

    func testZeroSubscribersKeepsSocketClosed() async throws {
        let fixture = makeFixture()
        await fixture.socket.configure(endpoint: endpoint, mode: .primary)
        await fixture.socket.setSceneActive(true)
        try await settle()
        XCTAssertEqual(fixture.transports.made.count, 0)
        let state = await fixture.socket.stateSnapshot()
        XCTAssertEqual(state, .idle)
    }

    func testOffModeNeverConnects() async throws {
        let fixture = makeFixture()
        await fixture.socket.configure(endpoint: endpoint, mode: .off)
        await fixture.socket.setSceneActive(true)
        _ = await fixture.socket.subscribe(topics: [.board]) { _ in }
        try await settle()
        XCTAssertEqual(fixture.transports.made.count, 0)
        let state = await fixture.socket.stateSnapshot()
        XCTAssertEqual(state, .disabled)
    }

    func testInactiveSceneKeepsSocketClosed() async throws {
        let fixture = makeFixture()
        await fixture.socket.configure(endpoint: endpoint, mode: .primary)
        _ = await fixture.socket.subscribe(topics: [.board]) { _ in }
        try await settle()
        XCTAssertEqual(fixture.transports.made.count, 0)
    }

    func testFirstSubscriberOpensWithTheBearerCredentialAndSendsHello() async throws {
        let fixture = makeFixture()
        await fixture.socket.configure(endpoint: endpoint, mode: .shadow)
        await fixture.socket.setSceneActive(true)
        let token = await fixture.socket.subscribe(topics: [.sessions, .board]) { _ in }
        try await waitUntil { fixture.transports.made.first?.openRequests.count == 1 }
        let request = try XCTUnwrap(fixture.transport.openRequests.first)
        XCTAssertEqual(request.url, endpoint.url)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer device-token")
        fixture.transport.completeOpen()
        try await waitUntil { fixture.transport.sentTypes == ["hello"] }
        let hello = try XCTUnwrap(fixture.transport.sentObjects.first)
        XCTAssertEqual(hello["topics"] as? [String], ["sessions", "board"])
        XCTAssertEqual(hello["clientId"] as? String, "ios-test")
        XCTAssertNil(hello["resume"], "a first connection has no cursor")

        await fixture.socket.unsubscribe(token)
        try await waitUntil { fixture.transport.closeCodes == [1001] }
    }

    func testCredentialOriginMismatchRefusesToOpen() async throws {
        let fixture = makeFixture()
        let foreign = CaveEventSocket.Endpoint(url: endpoint.url, credential: "device-token", credentialOrigin: "https://other.example.test")
        await fixture.socket.configure(endpoint: foreign, mode: .primary)
        await fixture.socket.setSceneActive(true)
        _ = await fixture.socket.subscribe(topics: [.board]) { _ in }
        try await settle()
        XCTAssertEqual(fixture.transports.made.count, 0)
        let state = await fixture.socket.stateSnapshot()
        XCTAssertEqual(state, .degraded("credential origin mismatch"))
    }

    func testCredentialToRemotePlaintextIsRefused() async throws {
        let fixture = makeFixture()
        let plaintext = CaveEventSocket.Endpoint(
            url: URL(string: "ws://100.64.0.8:3020/api/events-ws")!,
            credential: "device-token",
            credentialOrigin: "http://100.64.0.8:3020"
        )
        await fixture.socket.configure(endpoint: plaintext, mode: .primary)
        await fixture.socket.setSceneActive(true)
        _ = await fixture.socket.subscribe(topics: [.board]) { _ in }
        try await settle()
        XCTAssertEqual(fixture.transports.made.count, 0)
    }

    // MARK: Readiness and subscriptions

    func testReadyBarrierMarksSubscribedTopicsReady() async throws {
        let fixture = try await readyFixture(topics: [.sessions, .board])
        let sessions = await fixture.socket.topicReady(.sessions)
        let runs = await fixture.socket.topicReady(.runs)
        XCTAssertTrue(sessions)
        XCTAssertFalse(runs)
        let health = await fixture.health.last
        XCTAssertEqual(health?.readyTopics, [.sessions, .board])
    }

    func testALateTopicStaysUnreadyUntilTheReplacementBarrier() async throws {
        let fixture = try await readyFixture(topics: [.sessions])
        _ = await fixture.socket.subscribe(topics: [.board]) { _ in }
        try await waitUntil { fixture.transport.sentTypes == ["hello", "subscribe"] }
        XCTAssertEqual(fixture.transport.sentObjects.last?["topics"] as? [String], ["sessions", "board"], "a complete replacement")
        var board = await fixture.socket.topicReady(.board)
        XCTAssertFalse(board)
        let sessions = await fixture.socket.topicReady(.sessions)
        XCTAssertTrue(sessions, "an unchanged topic stays ready")
        fixture.transport.serverSend(ready(epoch: "boot-a", seq: 42, topics: [.sessions, .board]))
        try await waitUntilAsync { await fixture.socket.topicReady(.board) }
        board = await fixture.socket.topicReady(.board)
        XCTAssertTrue(board)
    }

    // MARK: Delivery

    func testPrimaryDeliversFreshInvalidationsAndSuppressesDuplicatesAndOlderVersions() async throws {
        let fixture = try await readyFixture(topics: [.sessions], versions: ["sessions": 3])
        fixture.transport.serverSend(invalidate(.sessions, seq: 43, version: 3))   // not newer than the barrier
        fixture.transport.serverSend(invalidate(.sessions, seq: 44, version: 4))
        fixture.transport.serverSend(invalidate(.sessions, seq: 44, version: 5))   // duplicate sequence
        fixture.transport.serverSend(invalidate(.sessions, seq: 45, version: 4))   // older version
        fixture.transport.serverSend(invalidate(.sessions, seq: 46, version: 6))
        try await waitUntilAsync { await fixture.deliveries.versions == [4, 6] }
        let diagnostics = await fixture.socket.diagnostics()
        XCTAssertEqual(diagnostics.duplicatesSuppressed, 3)
        XCTAssertEqual(diagnostics.invalidationsDelivered[.sessions], 2)
    }

    func testShadowRecordsAndAcknowledgesWithoutCallingHandlers() async throws {
        let fixture = try await readyFixture(mode: .shadow, topics: [.board])
        fixture.transport.serverSend(invalidate(.board, seq: 43, version: 1))
        try await waitUntilAsync { await fixture.socket.diagnostics().invalidationsObserved[.board] == 1 }
        try await advance(fixture.clock, by: .seconds(1), once: CaveEventSocket.ackInterval)
        try await waitUntil { fixture.transport.sentTypes.last == "ack" }
        let delivered = await fixture.deliveries.versions
        XCTAssertEqual(delivered, [])
        let ready = await fixture.socket.topicReady(.board)
        XCTAssertTrue(ready, "shadow is healthy; callers just don't pause polls on it")
    }

    func testInvalidationsBeforeTheBarrierAreHeldUntilReady() async throws {
        let fixture = makeFixture()
        await fixture.socket.configure(endpoint: endpoint, mode: .primary)
        await fixture.socket.setSceneActive(true)
        _ = await fixture.socket.subscribe(topics: [.board]) { [log = fixture.deliveries] in await log.record($0) }
        try await waitUntil { fixture.transports.made.count == 1 }
        fixture.transport.completeOpen()
        try await waitUntil { fixture.transport.sentTypes == ["hello"] }
        fixture.transport.serverSend(invalidate(.board, seq: 7, version: 2))
        try await waitUntilAsync { await fixture.socket.diagnostics().invalidationsObserved[.board] == 1 }
        let early = await fixture.deliveries.versions
        XCTAssertEqual(early, [])
        fixture.transport.serverSend(ready(epoch: "boot-a", seq: 7, topics: [.board], versions: ["board": 2]))
        try await waitUntilAsync { await fixture.deliveries.versions == [2] }
    }

    func testResyncDeliversAFullInvalidationPerTopic() async throws {
        let fixture = try await readyFixture(topics: [.sessions, .board])
        fixture.transport.serverSend(json([
            "type": "resync-required", "protocol": 1, "epoch": "boot-a", "seq": 50,
            "topics": ["sessions", "board"], "reason": "replay-gap",
        ]))
        try await waitUntilAsync { await fixture.deliveries.topics.count == 2 }
        let topics = await fixture.deliveries.topics
        XCTAssertEqual(Set(topics), [.sessions, .board])
        let versions = await fixture.deliveries.versions
        XCTAssertEqual(versions, [0, 0])
    }

    // MARK: Acknowledgements

    func testAcknowledgesTheHighestSequenceAtMostOncePerSecond() async throws {
        let fixture = try await readyFixture(topics: [.sessions])
        for (index, seq) in [43, 44, 45].enumerated() {
            fixture.transport.serverSend(invalidate(.sessions, seq: seq, version: index + 1))
        }
        try await waitUntilAsync { await fixture.deliveries.versions.count == 3 }
        XCTAssertEqual(fixture.transport.sentTypes, ["hello"], "no ack before the interval")
        try await advance(fixture.clock, by: .seconds(1), once: CaveEventSocket.ackInterval)
        try await waitUntil { fixture.transport.sentTypes == ["hello", "ack"] }
        XCTAssertEqual(fixture.transport.sentObjects.last?["seq"] as? Int, 45)
        fixture.clock.advance(by: .seconds(5))
        try await settle()
        XCTAssertEqual(fixture.transport.sentTypes, ["hello", "ack"], "nothing new, no second ack")
    }

    // MARK: Lifecycle

    func testBackgroundClosesAndForegroundResumesFromTheCursor() async throws {
        let fixture = try await readyFixture(topics: [.sessions], epoch: "boot-a", seq: 42)
        fixture.transport.serverSend(invalidate(.sessions, seq: 43, version: 1))
        try await waitUntilAsync { await fixture.deliveries.versions == [1] }
        await fixture.socket.setSceneActive(false)
        XCTAssertEqual(fixture.transport.closeCodes, [1001])
        var isReady = await fixture.socket.topicReady(.sessions)
        XCTAssertFalse(isReady)

        await fixture.socket.setSceneActive(true)
        try await waitUntil { fixture.transports.made.count == 2 }
        fixture.transport.completeOpen()
        try await waitUntil { fixture.transport.sentTypes == ["hello"] }
        let resume = try XCTUnwrap(fixture.transport.sentObjects.first?["resume"] as? [String: Any])
        XCTAssertEqual(resume["epoch"] as? String, "boot-a")
        XCTAssertEqual(resume["seq"] as? Int, 43)
        fixture.transport.serverSend(ready(epoch: "boot-a", seq: 43, topics: [.sessions]))
        try await waitUntilAsync { await fixture.socket.topicReady(.sessions) }
        isReady = await fixture.socket.topicReady(.sessions)
        XCTAssertTrue(isReady)
    }

    func testInvalidFrameClosesWith4402AndBacksOff() async throws {
        let fixture = try await readyFixture(topics: [.board])
        fixture.transport.serverSend(#"{"type":"invalidate","protocol":1,"epoch":"boot-a","seq":43,"topic":"secrets","version":1}"#)
        try await waitUntil { fixture.transport.closeCodes == [CaveEventCloseCode.invalidFrame] }
        try await waitUntilAsync { await fixture.socket.stateSnapshot() == .backingOff(attempt: 1) }
        let diagnostics = await fixture.socket.diagnostics()
        XCTAssertEqual(diagnostics.invalidServerMessages, 1)
        let ready = await fixture.socket.topicReady(.board)
        XCTAssertFalse(ready, "a broken connection is never ready")
        try await advance(fixture.clock, by: .milliseconds(500), once: .milliseconds(500))
        try await waitUntil { fixture.transports.made.count == 2 }
    }

    func testBackoffIsJitteredAndDoubles() async throws {
        let fixture = makeFixture(random: 0)   // the low edge: 80% of the base delay
        await fixture.socket.configure(endpoint: endpoint, mode: .primary)
        await fixture.socket.setSceneActive(true)
        _ = await fixture.socket.subscribe(topics: [.board]) { _ in }
        try await waitUntil { fixture.transports.made.count == 1 }
        fixture.transport.failOpen()
        try await waitUntilAsync { await fixture.socket.stateSnapshot() == .backingOff(attempt: 1) }
        try await advance(fixture.clock, by: .milliseconds(399), once: .milliseconds(400))
        try await settle()
        XCTAssertEqual(fixture.transports.made.count, 1)
        fixture.clock.advance(by: .milliseconds(1))
        try await waitUntil { fixture.transports.made.count == 2 }
        fixture.transport.failOpen()
        try await waitUntilAsync { await fixture.socket.stateSnapshot() == .backingOff(attempt: 2) }
        try await advance(fixture.clock, by: .milliseconds(799), once: .milliseconds(800))
        try await settle()
        XCTAssertEqual(fixture.transports.made.count, 2)
        fixture.clock.advance(by: .milliseconds(1))
        try await waitUntil { fixture.transports.made.count == 3 }
    }

    func testOpenTimesOutAfterEightSeconds() async throws {
        let fixture = makeFixture()
        await fixture.socket.configure(endpoint: endpoint, mode: .primary)
        await fixture.socket.setSceneActive(true)
        _ = await fixture.socket.subscribe(topics: [.board]) { _ in }
        try await waitUntil { fixture.transports.made.count == 1 }
        try await advance(fixture.clock, by: .milliseconds(7_999), once: CaveEventSocket.connectTimeout)
        try await settle()
        let connecting = await fixture.socket.stateSnapshot()
        XCTAssertEqual(connecting, .connecting)
        fixture.clock.advance(by: .milliseconds(1))
        try await waitUntilAsync { await fixture.socket.stateSnapshot() == .backingOff(attempt: 1) }
        XCTAssertFalse(fixture.transports.made[0].closeCodes.isEmpty, "the stalled transport was closed")
    }

    func testUnsupportedProtocolCloseDegradesWithoutRetrying() async throws {
        let fixture = try await readyFixture(topics: [.board])
        fixture.transport.serverClose(code: CaveEventCloseCode.unsupportedProtocol)
        try await waitUntilAsync { await fixture.socket.stateSnapshot() == .degraded("unsupported protocol") }
        fixture.clock.advance(by: .seconds(60))
        try await settle()
        XCTAssertEqual(fixture.transports.made.count, 1)
    }

    func testANewEndpointStartsOverWithoutACursor() async throws {
        let fixture = try await readyFixture(topics: [.sessions], seq: 42)
        let other = CaveEventSocket.Endpoint(
            url: URL(string: "wss://other.example.test/api/events-ws")!,
            credential: "other-token",
            credentialOrigin: "https://other.example.test"
        )
        await fixture.socket.configure(endpoint: other, mode: .primary)
        try await waitUntil { fixture.transports.made.count == 2 }
        fixture.transport.completeOpen()
        try await waitUntil { fixture.transport.sentTypes == ["hello"] }
        XCTAssertNil(fixture.transport.sentObjects.first?["resume"])
    }

    // MARK: Waiting

    /// Advance once the actor is actually asleep for `pending`, so the clock
    /// never moves before the sleep it is meant to end was registered.
    private func advance(_ clock: ManualSleeper, by step: Duration, once pending: Duration, file: StaticString = #filePath, line: UInt = #line) async throws {
        try await waitUntil({ clock.hasSleeper(for: pending) }, file: file, line: line)
        clock.advance(by: step)
    }

    private func settle() async throws {
        try await Task.sleep(for: .milliseconds(30))
    }

    private func waitUntil(_ condition: @escaping () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<400 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("condition never held", file: file, line: line)
    }

    private func waitUntilAsync(_ condition: @escaping () async -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<400 {
            if await condition() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("condition never held", file: file, line: line)
    }
}

// MARK: - Test doubles

actor DeliveryLog {
    private(set) var events: [CaveEventInvalidation] = []
    func record(_ event: CaveEventInvalidation) { events.append(event) }
    var versions: [Int] { events.map(\.version) }
    var topics: [CaveEventTopic] { events.map(\.topic) }
}

actor HealthLog {
    private(set) var entries: [CaveEventSocket.Health] = []
    func record(_ health: CaveEventSocket.Health) { entries.append(health) }
    var last: CaveEventSocket.Health? { entries.last }
}

final class FakeTransportFactory: @unchecked Sendable {
    private let lock = NSLock()
    private var transports: [FakeCaveEventTransport] = []

    var made: [FakeCaveEventTransport] {
        lock.lock()
        defer { lock.unlock() }
        return transports
    }

    func make() -> FakeCaveEventTransport {
        let transport = FakeCaveEventTransport()
        lock.lock()
        transports.append(transport)
        lock.unlock()
        return transport
    }
}

final class FakeCaveEventTransport: CaveEventSocketTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    private var sentFrames: [String] = []
    private var codes: [Int] = []
    private var openContinuation: CheckedContinuation<Void, Error>?
    private var receiveContinuation: CheckedContinuation<URLSessionWebSocketTask.Message, Error>?
    private var inbox: [Result<URLSessionWebSocketTask.Message, Error>] = []
    private var closed: CaveEventTransportClosed?
    /// An outcome the test decided before the actor's open call arrived.
    private var earlyOpen: Result<Void, Error>?

    var openRequests: [URLRequest] { locked { requests } }
    var closeCodes: [Int] { locked { codes } }
    var sentObjects: [[String: Any]] {
        locked { sentFrames }.compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    }
    var sentTypes: [String] { sentObjects.compactMap { $0["type"] as? String } }

    func open(_ request: URLRequest) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            lock.lock()
            requests.append(request)
            if let closed {
                lock.unlock()
                continuation.resume(throwing: closed)
                return
            }
            if let early = earlyOpen {
                earlyOpen = nil
                lock.unlock()
                continuation.resume(with: early)
                return
            }
            openContinuation = continuation
            lock.unlock()
        }
    }

    func completeOpen() { finishOpen(.success(())) }

    func failOpen() { finishOpen(.failure(URLError(.cannotConnectToHost))) }

    private func finishOpen(_ result: Result<Void, Error>) {
        lock.lock()
        guard let continuation = openContinuation else {
            earlyOpen = result
            lock.unlock()
            return
        }
        openContinuation = nil
        lock.unlock()
        continuation.resume(with: result)
    }

    func send(_ text: String) async throws {
        try locked {
            if let closed { throw closed }
            sentFrames.append(text)
        }
    }

    func receive() async throws -> URLSessionWebSocketTask.Message {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URLSessionWebSocketTask.Message, Error>) in
            lock.lock()
            if !inbox.isEmpty {
                let next = inbox.removeFirst()
                lock.unlock()
                continuation.resume(with: next)
                return
            }
            if let closed {
                lock.unlock()
                continuation.resume(throwing: closed)
                return
            }
            receiveContinuation = continuation
            lock.unlock()
        }
    }

    func sendPing() async throws {}

    func serverSend(_ text: String) {
        deliver(.success(.string(text)))
    }

    func serverClose(code: Int) {
        let error = CaveEventTransportClosed(code: code)
        lock.lock()
        closed = error
        let continuation = receiveContinuation
        receiveContinuation = nil
        lock.unlock()
        continuation?.resume(throwing: error)
    }

    func close(code: Int, reason: String?) {
        let error = CaveEventTransportClosed(code: code)
        lock.lock()
        codes.append(code)
        if closed == nil { closed = error }
        let open = openContinuation
        let receive = receiveContinuation
        openContinuation = nil
        receiveContinuation = nil
        lock.unlock()
        open?.resume(throwing: error)
        receive?.resume(throwing: error)
    }

    private func deliver(_ result: Result<URLSessionWebSocketTask.Message, Error>) {
        lock.lock()
        if let continuation = receiveContinuation {
            receiveContinuation = nil
            lock.unlock()
            continuation.resume(with: result)
            return
        }
        inbox.append(result)
        lock.unlock()
    }

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }
}

/// A clock the test advances by hand. Sleeps honor cancellation.
final class ManualSleeper: @unchecked Sendable {
    private let lock = NSLock()
    private var now: Duration = .zero
    private var sleepers: [UUID: (deadline: Duration, duration: Duration, continuation: CheckedContinuation<Void, Error>)] = [:]

    /// True once something is asleep for exactly `duration`.
    func hasSleeper(for duration: Duration) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return sleepers.values.contains { $0.duration == duration }
    }

    func sleep(_ duration: Duration) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                lock.lock()
                if Task.isCancelled {
                    lock.unlock()
                    continuation.resume(throwing: CancellationError())
                    return
                }
                sleepers[id] = (now + duration, duration, continuation)
                lock.unlock()
            }
        } onCancel: {
            lock.lock()
            let sleeper = sleepers.removeValue(forKey: id)
            lock.unlock()
            sleeper?.continuation.resume(throwing: CancellationError())
        }
    }

    func advance(by duration: Duration) {
        lock.lock()
        now += duration
        let due = sleepers.filter { $0.value.deadline <= now }
        for id in due.keys { sleepers[id] = nil }
        lock.unlock()
        for sleeper in due.values { sleeper.continuation.resume() }
    }
}
