import Foundation
import SwiftUI
import UIKit
import XCTest
@testable import CovenCave

/// Counts requests by path and answers `api/chat/model-state` with a fixed
/// state. Everything else gets a 404, so an unexpected request is visible in
/// the counts rather than hanging the view.
private final class ModelStateCountingURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var counts: [String: Int] = [:]
    nonisolated(unsafe) private static var modelStateDelay: TimeInterval = 0

    static func reset(modelStateDelay delay: TimeInterval = 0) {
        lock.lock(); defer { lock.unlock() }
        counts = [:]
        modelStateDelay = delay
    }

    static func count(_ path: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return counts[path] ?? 0
    }

    /// Every path requested so far, so a test can show a reopen added nothing
    /// anywhere, not only on the path it was written for.
    static func allCounts() -> [String: Int] {
        lock.lock(); defer { lock.unlock() }
        return counts
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        Self.lock.lock()
        Self.counts[url.path, default: 0] += 1
        let delay = Self.modelStateDelay
        Self.lock.unlock()
        let isModelState = url.path == "/api/chat/model-state"
        if isModelState, delay > 0 {
            DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [self] in
                respond(url: url, isModelState: true)
            }
            return
        }
        respond(url: url, isModelState: isModelState)
    }

    private func respond(url: URL, isModelState: Bool) {
        let body = isModelState
            ? Data(#"{"ok":true,"state":{"familiarId":"nyx","harness":"claude","effectiveModel":"sonnet","source":"session"},"options":[]}"#.utf8)
            : Data(#"{"ok":false}"#.utf8)
        let response = HTTPURLResponse(
            url: url,
            statusCode: isModelState ? 200 : 404,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@Observable
@MainActor
private final class ReopenSwitch {
    var shown = true
}

/// Mounts a chat the way the Chats destination does (`.id(thread.id)`), so
/// hiding and showing it is a real close and reopen of a fresh `ChatView`.
private struct ReopenProbe: View {
    let app: AppModel
    let thread: ChatThread
    let toggle: ReopenSwitch

    var body: some View {
        NavigationStack {
            if toggle.shown {
                ChatView(thread: thread)
                    .id(thread.id)
            } else {
                Color.clear
            }
        }
        .environment(app)
    }
}

@MainActor
final class ChatModelStateCacheTests: XCTestCase {
    private static let modelStatePath = "/api/chat/model-state"

    private func response(model: String) -> ChatModelStateResponse {
        ChatModelStateResponse(
            ok: true,
            state: ChatModelState(
                familiarId: "nyx",
                harness: "claude",
                effectiveModel: model,
                source: "session"
            )
        )
    }

    func testReusesARecentAnswerUntilItExpires() {
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        let cache = ChatModelStateCache(maxAge: 30, now: { now })
        let key = ChatModelStateCache.Key(host: "cave.example", familiarId: "nyx", sessionId: "s1")

        XCTAssertNil(cache.recent(for: key), "nothing is cached before the first answer")
        cache.store(response(model: "sonnet"), for: key)
        now += 29
        XCTAssertEqual(cache.recent(for: key)?.state.effectiveModel, "sonnet", "a reopen inside the window reuses the answer")
        now += 1
        XCTAssertNil(cache.recent(for: key), "at 30 s the answer is stale and the reopen fetches")
        XCTAssertEqual(cache.count, 0, "an expired entry is dropped, not kept around")
    }

    func testAClockThatMovedBackwardsDoesNotKeepAnAnswerForever() {
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        let cache = ChatModelStateCache(maxAge: 30, now: { now })
        let key = ChatModelStateCache.Key(host: "cave.example", familiarId: "nyx", sessionId: nil)
        cache.store(response(model: "sonnet"), for: key)
        now -= 60
        XCTAssertNil(cache.recent(for: key))
    }

    func testKeysSeparateHostsAndSessions() {
        let cache = ChatModelStateCache()
        let base = ChatModelStateCache.Key(host: "a.example", familiarId: "nyx", sessionId: "s1")
        cache.store(response(model: "sonnet"), for: base)
        XCTAssertNil(cache.recent(for: .init(host: "b.example", familiarId: "nyx", sessionId: "s1")),
                     "another Cave never reads this Cave's state")
        XCTAssertNil(cache.recent(for: .init(host: "a.example", familiarId: "nyx", sessionId: "s2")),
                     "another session of the same familiar has its own state")
        XCTAssertNil(cache.recent(for: .init(host: "a.example", familiarId: "nyx", sessionId: nil)),
                     "a new chat's familiar-default state is a different request")
    }

    func testAModelChangeDropsEverySessionOfThatFamiliarOnThatHost() {
        let cache = ChatModelStateCache()
        let s1 = ChatModelStateCache.Key(host: "a.example", familiarId: "nyx", sessionId: "s1")
        let s2 = ChatModelStateCache.Key(host: "a.example", familiarId: "nyx", sessionId: nil)
        let other = ChatModelStateCache.Key(host: "a.example", familiarId: "sage", sessionId: "s3")
        let otherHost = ChatModelStateCache.Key(host: "b.example", familiarId: "nyx", sessionId: "s1")
        for key in [s1, s2, other, otherHost] { cache.store(response(model: "sonnet"), for: key) }

        cache.invalidate(host: "a.example", familiarId: "nyx")

        XCTAssertNil(cache.recent(for: s1))
        XCTAssertNil(cache.recent(for: s2), "a familiar-default change reaches sessions that inherit it")
        XCTAssertNotNil(cache.recent(for: other), "other familiars are untouched")
        XCTAssertNotNil(cache.recent(for: otherHost), "the same familiar on another Cave is untouched")
    }

    func testCapacityEvictsTheOldestStoredEntry() {
        let cache = ChatModelStateCache(capacity: 2)
        let keys = (1...3).map { ChatModelStateCache.Key(host: "a.example", familiarId: "nyx", sessionId: "s\($0)") }
        for key in keys { cache.store(response(model: "sonnet"), for: key) }
        XCTAssertEqual(cache.count, 2)
        XCTAssertNil(cache.recent(for: keys[0]))
        XCTAssertNotNil(cache.recent(for: keys[2]))
    }

    /// The budget ratified on #5292 and measured by #5748: a duplicate request
    /// caused solely by view reappearance is zero. Before the cache, every
    /// reopen of a direct chat repeated `GET api/chat/model-state`.
    func testReopeningAChatDoesNotRepeatTheModelStateRequest() async throws {
        ModelStateCountingURLProtocol.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ModelStateCountingURLProtocol.self]
        let session = URLSession(configuration: config)

        let suite = "ChatModelStateCacheTests.reopen.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let storeDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ChatModelStateCacheTests-\(UUID().uuidString)", isDirectory: true)
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: storeDirectory)
        }
        let app = AppModel(
            defaults: defaults,
            restoreLocalState: false,
            loadPersistedConnection: false,
            threadStoreURL: storeDirectory.appendingPathComponent("threads.json"),
            widgetSnapshotDefaults: defaults,
            clientSession: session
        )
        app.connection = CaveConnection(host: "model-state-reopen.invalid")
        let thread = ChatThread(title: "Nyx", familiarIds: ["nyx"], sessionIds: ["nyx": "s1"])
        let toggle = ReopenSwitch()

        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = UIHostingController(
            rootView: ReopenProbe(app: app, thread: thread, toggle: toggle)
        )
        window.isHidden = false
        window.layoutIfNeeded()
        defer { window.isHidden = true }

        // The window that every wait below uses. The control at the end shows
        // a request that is going to happen arrives inside it.
        let observationWindow: Duration = .seconds(2)

        try await waitUntil(within: .seconds(5)) {
            ModelStateCountingURLProtocol.count(Self.modelStatePath) == 1
        }
        XCTAssertEqual(ModelStateCountingURLProtocol.count(Self.modelStatePath), 1, "the first open fetches")

        // Let anything else the first open started finish, then count every
        // path: the reopen should add nothing anywhere.
        try await Task.sleep(for: .milliseconds(500))
        let beforeReopen = ModelStateCountingURLProtocol.allCounts()
        try await reopen(toggle, window: window)
        try await Task.sleep(for: observationWindow)
        XCTAssertEqual(
            ModelStateCountingURLProtocol.count(Self.modelStatePath), 1,
            "a reopen seconds later reuses the state instead of repeating the request"
        )
        XCTAssertEqual(
            ModelStateCountingURLProtocol.allCounts(), beforeReopen,
            "a reopen repeats no request for any resource"
        )

        // Control: with the cached state gone, the same reopen does fetch, and
        // inside the same window. So the assertion above was not passing only
        // because the reopened view never got as far as asking.
        app.chatModelStates.invalidate(host: "model-state-reopen.invalid", familiarId: "nyx")
        try await reopen(toggle, window: window)
        try await waitUntil(within: observationWindow) {
            ModelStateCountingURLProtocol.count(Self.modelStatePath) == 2
        }
        XCTAssertEqual(ModelStateCountingURLProtocol.count(Self.modelStatePath), 2)
    }

    /// Reopening while the first request is still in flight joins it. Without
    /// the shared in-flight request, the reopened view starts a second one.
    func testReopeningWhileTheFirstRequestIsInFlightDoesNotRepeatIt() async throws {
        ModelStateCountingURLProtocol.reset(modelStateDelay: 1.0)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ModelStateCountingURLProtocol.self]
        let suite = "ChatModelStateCacheTests.inflight.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let storeDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ChatModelStateCacheTests-\(UUID().uuidString)", isDirectory: true)
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: storeDirectory)
            ModelStateCountingURLProtocol.reset()
        }
        let app = AppModel(
            defaults: defaults,
            restoreLocalState: false,
            loadPersistedConnection: false,
            threadStoreURL: storeDirectory.appendingPathComponent("threads.json"),
            widgetSnapshotDefaults: defaults,
            clientSession: URLSession(configuration: config)
        )
        app.connection = CaveConnection(host: "model-state-inflight.invalid")
        let thread = ChatThread(title: "Nyx", familiarIds: ["nyx"], sessionIds: ["nyx": "s1"])
        let toggle = ReopenSwitch()
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = UIHostingController(
            rootView: ReopenProbe(app: app, thread: thread, toggle: toggle)
        )
        window.isHidden = false
        window.layoutIfNeeded()
        defer { window.isHidden = true }

        try await waitUntil(within: .seconds(5)) {
            ModelStateCountingURLProtocol.count(Self.modelStatePath) == 1
        }
        XCTAssertEqual(ModelStateCountingURLProtocol.count(Self.modelStatePath), 1, "the first open has sent its request")
        // The answer is held for 1 s. Close and reopen well inside that.
        try await reopen(toggle, window: window)
        // Past the held answer, plus the same observation window as above.
        try await Task.sleep(for: .seconds(3))
        XCTAssertEqual(
            ModelStateCountingURLProtocol.count(Self.modelStatePath), 1,
            "a reopen while the first request is in flight joins it instead of sending another"
        )
        XCTAssertNotNil(
            app.chatModelStates.recent(for: .init(host: "model-state-inflight.invalid", familiarId: "nyx", sessionId: "s1")),
            "the joined request still completes and is kept, even though the view that started it closed"
        )
    }

    func testAReopenJoinsARequestAlreadyInFlight() async throws {
        let cache = ChatModelStateCache()
        let key = ChatModelStateCache.Key(host: "a.example", familiarId: "nyx", sessionId: "s1")
        var fetches = 0
        // Every fetch parks here until released, so a second fetch, if the
        // cache wrongly starts one, completes too and the count below fails
        // instead of the test hanging on a continuation nobody resumes.
        var parked: [CheckedContinuation<Void, Never>] = []
        let fetch: @MainActor () async throws -> ChatModelStateResponse = {
            fetches += 1
            await withCheckedContinuation { parked.append($0) }
            return self.response(model: "sonnet")
        }
        let first = Task { try await cache.response(for: key, reusingRecent: true, fetch: fetch) }
        try await waitUntil(within: .seconds(2)) { parked.count == 1 }
        let second = Task { try await cache.response(for: key, reusingRecent: true, fetch: fetch) }
        // Give a wrongly started second fetch the chance to park as well.
        try await waitUntil(within: .milliseconds(300)) { parked.count == 2 }
        let toRelease = parked
        parked.removeAll()
        for continuation in toRelease { continuation.resume() }
        let answers = try await (first.value, second.value)
        XCTAssertEqual(fetches, 1, "the second caller joined the first request")
        XCTAssertEqual(answers.0.state.effectiveModel, answers.1.state.effectiveModel)
        XCTAssertNotNil(cache.recent(for: key), "the joined answer is kept")
    }

    func testAnAnswerThatWasInFlightAcrossAnInvalidationIsNotKept() async throws {
        let cache = ChatModelStateCache()
        let key = ChatModelStateCache.Key(host: "a.example", familiarId: "nyx", sessionId: "s1")
        var parked: [CheckedContinuation<Void, Never>] = []
        let fetch: @MainActor () async throws -> ChatModelStateResponse = {
            await withCheckedContinuation { parked.append($0) }
            return self.response(model: "before-the-change")
        }
        let pending = Task { try await cache.response(for: key, reusingRecent: true, fetch: fetch) }
        try await waitUntil(within: .seconds(2)) { parked.count == 1 }
        cache.invalidate(host: "a.example", familiarId: "nyx")
        let toRelease = parked
        parked.removeAll()
        for continuation in toRelease { continuation.resume() }
        let answer = try await pending.value
        XCTAssertEqual(answer.state.effectiveModel, "before-the-change", "the caller that asked still gets an answer")
        XCTAssertNil(cache.recent(for: key), "an answer that may predate the change is not kept for the next reopen")
    }

    func testAFreshFetchDoesNotJoinAndItsAnswerIsTheOneKept() async throws {
        let cache = ChatModelStateCache()
        let key = ChatModelStateCache.Key(host: "a.example", familiarId: "nyx", sessionId: "s1")
        cache.store(response(model: "old"), for: key)
        var fetches = 0
        let answer = try await cache.response(for: key, reusingRecent: false) {
            fetches += 1
            return self.response(model: "new")
        }
        XCTAssertEqual(fetches, 1, "a finished reply or a model change always asks the server")
        XCTAssertEqual(answer.state.effectiveModel, "new")
        XCTAssertEqual(cache.recent(for: key)?.state.effectiveModel, "new")
    }

    func testEveryModelChangePathDropsTheFamiliarOnTheCurrentHost() throws {
        let suite = "ChatModelStateCacheTests.invalidate.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let app = AppModel(defaults: defaults, restoreLocalState: false,
                           loadPersistedConnection: false, widgetSnapshotDefaults: defaults)
        app.connection = CaveConnection(host: "a.example")
        let key = try XCTUnwrap(app.chatModelStateKey(familiarId: "nyx", sessionId: "s1"))
        let other = try XCTUnwrap(app.chatModelStateKey(familiarId: "sage", sessionId: "s2"))
        app.chatModelStates.store(response(model: "sonnet"), for: key)
        app.chatModelStates.store(response(model: "sonnet"), for: other)

        app.invalidateChatModelStates(familiarId: "nyx")

        XCTAssertNil(app.chatModelStates.recent(for: key))
        XCTAssertNotNil(app.chatModelStates.recent(for: other))
    }

    private func reopen(_ toggle: ReopenSwitch, window: UIWindow) async throws {
        toggle.shown = false
        window.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(150))
        toggle.shown = true
        window.layoutIfNeeded()
    }

    private func waitUntil(
        within limit: Duration,
        _ condition: () -> Bool
    ) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: limit)
        while !condition(), clock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
    }
}
