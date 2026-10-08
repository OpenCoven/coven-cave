import XCTest
@testable import CovenCave

/// The iOS app's use of the event socket (#5867): the endpoint it builds, how
/// invalidations reach the existing loaders, and how AppModel configures the
/// socket from the iOS rollout field.
@MainActor
final class CaveEventPlaneIntegrationTests: XCTestCase {
    // MARK: Endpoint

    func testLoopbackWithoutACredentialConnectsPlain() throws {
        let endpoint = try XCTUnwrap(CaveEventPlaneEndpoint.make(
            connection: CaveConnection(host: "http://127.0.0.1:3020"),
            credential: { _ in nil }
        ))
        XCTAssertEqual(endpoint.url.absoluteString, "ws://127.0.0.1:3020/api/events-ws")
        XCTAssertNil(endpoint.credential)
    }

    func testALegacyTokenTravelsOnlyOverTLSBoundToItsOrigin() throws {
        let endpoint = try XCTUnwrap(CaveEventPlaneEndpoint.make(
            connection: CaveConnection(host: "https://cave.example.test:8443"),
            credential: { _ in "legacy-token" }
        ))
        XCTAssertEqual(endpoint.url.absoluteString, "wss://cave.example.test:8443/api/events-ws")
        XCTAssertEqual(endpoint.credential, "legacy-token")
        XCTAssertEqual(endpoint.credentialOrigin, "https://cave.example.test:8443")
        XCTAssertNil(endpoint.origin)
    }

    func testAManagedDeviceGrantGetsNoSocket() {
        // Device access keeps WebSocket scopes off managed grants; REST's own
        // resolver refuses one for wss, and the builder refuses it regardless.
        XCTAssertNil(CaveEventPlaneEndpoint.make(
            connection: CaveConnection(host: "https://desktop.example.ts.net:8443"),
            credential: { _ in throw CaveError.insecureCredentialTransport }
        ))
        XCTAssertNil(CaveEventPlaneEndpoint.make(
            connection: CaveConnection(host: "https://desktop.example.ts.net:8443"),
            credential: { _ in "cave-device-v1.grant" }
        ))
    }

    func testARefusedCredentialMeansNoSocket() {
        XCTAssertNil(CaveEventPlaneEndpoint.make(
            connection: CaveConnection(host: "https://cave.example.test"),
            credential: { _ in throw CaveError.credentialOriginMismatch }
        ))
    }

    func testACredentialNeverGoesToARemotePlaintextHost() {
        XCTAssertNil(CaveEventPlaneEndpoint.make(
            connection: CaveConnection(host: "http://100.64.0.8:3020"),
            credential: { _ in "legacy-token" }
        ))
    }

    // MARK: Router

    private final class LoadLog {
        var counts: [String: Int] = [:]
        var tasksLoaded = true
        var gate: CheckedContinuation<Void, Never>?
        var holdSessions = false
    }

    private func router(_ log: LoadLog) -> CaveEventRefreshRouter {
        CaveEventRefreshRouter(loaders: .init(
            sessions: {
                log.counts["sessions", default: 0] += 1
                if log.holdSessions {
                    await withCheckedContinuation { log.gate = $0 }
                }
            },
            tasks: { log.counts["tasks", default: 0] += 1 },
            tasksLoaded: { log.tasksLoaded },
            familiars: { log.counts["familiars", default: 0] += 1 },
            daemon: { log.counts["daemon", default: 0] += 1 }
        ))
    }

    private func invalidation(_ topic: CaveEventTopic, version: Int = 1) -> CaveEventInvalidation {
        CaveEventInvalidation(epoch: "boot-a", seq: version, topic: topic, version: version, entityIds: nil)
    }

    func testEachTopicReachesItsOwnLoader() async {
        let log = LoadLog()
        let router = router(log)
        for topic in [CaveEventTopic.sessions, .board, .familiars, .daemon, .runs] {
            router.receive(invalidation(topic))
        }
        await router.idle()
        XCTAssertEqual(log.counts, ["sessions": 1, "tasks": 1, "familiars": 1, "daemon": 1])
    }

    func testABoardNobodyLoadedIsNotFetched() async {
        let log = LoadLog()
        log.tasksLoaded = false
        let router = router(log)
        router.receive(invalidation(.board))
        await router.idle()
        XCTAssertNil(log.counts["tasks"])
    }

    func testABurstDuringARefreshCostsExactlyOneMorePass() async throws {
        let log = LoadLog()
        log.holdSessions = true
        let router = router(log)
        router.receive(invalidation(.sessions, version: 2))
        for _ in 0..<50 where log.gate == nil { try await Task.sleep(for: .milliseconds(2)) }
        XCTAssertNotNil(log.gate, "the first refresh is running")
        router.receive(invalidation(.sessions, version: 3))
        router.receive(invalidation(.sessions, version: 4))
        router.receive(invalidation(.sessions, version: 5))
        log.holdSessions = false
        log.gate?.resume()
        log.gate = nil
        await router.idle()
        XCTAssertEqual(log.counts["sessions"], 2, "one in flight, then one pass for everything that landed during it")
    }

    // MARK: AppModel

    private func makeApp(
        capability: CaveEventCapability,
        transports: FakeTransportFactory
    ) -> AppModel {
        let defaults = UserDefaults(suiteName: "CaveEventPlaneIntegrationTests-\(UUID().uuidString)")!
        let socket = CaveEventSocket(clientId: "ios-test", transportFactory: { transports.make() })
        return AppModel(
            defaults: defaults,
            restoreLocalState: false,
            loadPersistedConnection: false,
            eventSocket: socket,
            eventCapabilityLoader: { _ in capability },
            eventEndpointResolver: { CaveEventPlaneEndpoint.make(connection: $0, credential: { _ in nil }) }
        )
    }

    private func capability(ios: CaveEventRolloutMode, web: CaveEventRolloutMode = .primary) -> CaveEventCapability {
        CaveEventCapability(
            enabled: true,
            protocolVersion: 1,
            path: CaveEventWire.path,
            topics: CaveEventTopic.allCases,
            rolloutMode: .init(web: web, ios: ios)
        )
    }

    func testThePrimaryCapabilityOpensOneSocketForTheAppTopics() async throws {
        let transports = FakeTransportFactory()
        let app = makeApp(capability: capability(ios: .primary), transports: transports)
        app.connection = CaveConnection(host: "http://127.0.0.1:3020")
        await app.refreshEventPlane()
        await app.eventSocket.setSceneActive(true)
        try await waitUntil { transports.made.first?.openRequests.count == 1 }
        XCTAssertEqual(transports.made.first?.openRequests.first?.url?.absoluteString, "ws://127.0.0.1:3020/api/events-ws")
        transports.made.first?.completeOpen()
        try await waitUntil { transports.made.first?.sentTypes == ["hello"] }
        XCTAssertEqual(transports.made.first?.sentObjects.first?["topics"] as? [String], ["sessions", "board", "familiars", "daemon"])
        let mode = await app.eventSocket.rolloutMode()
        XCTAssertEqual(mode, .primary)

        await app.eventSocket.setSceneActive(false)
        XCTAssertEqual(transports.made.first?.closeCodes, [1001], "background closes the socket")
    }

    func testIOSNeverBorrowsTheWebRolloutMode() async throws {
        let transports = FakeTransportFactory()
        let app = makeApp(capability: capability(ios: .off, web: .primary), transports: transports)
        app.connection = CaveConnection(host: "http://127.0.0.1:3020")
        await app.refreshEventPlane()
        await app.eventSocket.setSceneActive(true)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(transports.made.count, 0)
        let state = await app.eventSocket.stateSnapshot()
        XCTAssertEqual(state, .disabled)
    }

    func testForgettingTheConnectionTurnsTheSocketOff() async throws {
        let transports = FakeTransportFactory()
        let app = makeApp(capability: capability(ios: .shadow), transports: transports)
        app.connection = CaveConnection(host: "http://127.0.0.1:3020")
        await app.refreshEventPlane()
        await app.eventSocket.setSceneActive(true)
        try await waitUntil { transports.made.count == 1 }
        app.connection = nil
        await app.refreshEventPlane()
        let mode = await app.eventSocket.rolloutMode()
        XCTAssertEqual(mode, .off)
        XCTAssertEqual(transports.made.first?.closeCodes, [1001])
    }

    func testHealthReachesTheModel() async throws {
        let transports = FakeTransportFactory()
        let app = makeApp(capability: capability(ios: .shadow), transports: transports)
        app.connection = CaveConnection(host: "http://127.0.0.1:3020")
        await app.refreshEventPlane()
        await app.eventSocket.setSceneActive(true)
        try await waitUntil { transports.made.count == 1 }
        transports.made.first?.completeOpen()
        try await waitUntil { transports.made.first?.sentTypes == ["hello"] }
        transports.made.first?.serverSend(#"{"type":"ready","protocol":1,"epoch":"boot-a","seq":0,"topics":["sessions","board","familiars","daemon"],"versions":{}}"#)
        try await waitUntil { app.eventPlaneHealth.state == .ready }
        XCTAssertEqual(app.eventPlaneHealth.mode, .shadow)
        XCTAssertEqual(app.eventPlaneHealth.readyTopics, [.sessions, .board, .familiars, .daemon])
    }

    private func waitUntil(_ condition: @escaping @MainActor () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<400 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("condition never held", file: file, line: line)
    }
}
