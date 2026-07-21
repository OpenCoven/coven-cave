import XCTest
@testable import CovenCave

final class ConnectionRefreshCoordinatorTests: XCTestCase {

    // MARK: - Test plumbing

    private actor Counter {
        private(set) var value = 0
        func increment() { value += 1 }
    }

    /// One-shot async latch: `wait()` suspends until `open()` fires (or returns
    /// immediately if it already has).
    private actor Gate {
        private var opened = false
        private var waiters: [CheckedContinuation<Void, Never>] = []
        func open() {
            opened = true
            for waiter in waiters { waiter.resume() }
            waiters.removeAll()
        }
        func wait() async {
            if opened { return }
            await withCheckedContinuation { waiters.append($0) }
        }
    }

    // MARK: - Single flight

    func testConcurrentRefreshesShareOneProbe() async {
        let coordinator = ConnectionRefreshCoordinator()
        let probes = Counter()
        let probeStarted = Gate()

        let launcher = Task {
            await coordinator.refresh {
                await probes.increment()
                await probeStarted.open()
                // Hold the probe open long enough for the joiner to attach.
                try? await Task.sleep(for: .milliseconds(300))
                return ConnectionRefreshResult.unauthorized
            }
        }
        // The joiner is only issued once the launcher's probe is running, so
        // the overlap is guaranteed rather than scheduler-lucky.
        await probeStarted.wait()
        let joiner = Task {
            await coordinator.refresh {
                await probes.increment()
                return ConnectionRefreshResult.unreachable
            }
        }

        let first = await launcher.value
        let second = await joiner.value
        // Both callers receive the launcher's outcome; the joiner's probe
        // closure never ran.
        XCTAssertEqual(first.result, .unauthorized)
        XCTAssertEqual(second.result, .unauthorized)
        XCTAssertTrue(first.launched)
        XCTAssertFalse(second.launched)
        let probeCount = await probes.value
        XCTAssertEqual(probeCount, 1)
    }

    func testRefreshAfterCompletionLaunchesAFreshProbe() async {
        let coordinator = ConnectionRefreshCoordinator()
        let probes = Counter()

        let first = await coordinator.refresh {
            await probes.increment()
            return ConnectionRefreshResult.unreachable
        }
        let second = await coordinator.refresh {
            await probes.increment()
            return ConnectionRefreshResult.unauthorized
        }

        XCTAssertEqual(first.result, .unreachable)
        XCTAssertEqual(second.result, .unauthorized)
        XCTAssertTrue(first.launched)
        XCTAssertTrue(second.launched)
        let probeCount = await probes.value
        XCTAssertEqual(probeCount, 2)
    }

    // MARK: - Joiner surface-reload intent

    func testJoinerReloadIntentIsMergedOntoTheLauncher() async {
        let coordinator = ConnectionRefreshCoordinator()
        let probeStarted = Gate()

        // Launcher does NOT want a surface reload…
        let launcher = Task {
            await coordinator.refresh(requestSurfaceReload: false) {
                await probeStarted.open()
                // Hold the probe open long enough for the joiner to attach and
                // record its intent. If the window is ever missed, the joiner
                // launches its own probe and the XCTFail below fires — the
                // test fails loudly rather than passing vacuously.
                try? await Task.sleep(for: .milliseconds(300))
                return ConnectionRefreshResult.unauthorized
            }
        }
        await probeStarted.wait()
        // …but the joiner does. Only the launcher applies the outcome, so the
        // joiner's intent must ride along with the launcher's result.
        let joiner = Task {
            await coordinator.refresh(requestSurfaceReload: true) {
                XCTFail("joiner must not launch its own probe")
                return ConnectionRefreshResult.unreachable
            }
        }

        let first = await launcher.value
        let second = await joiner.value
        XCTAssertTrue(first.launched)
        XCTAssertTrue(
            first.surfaceReloadRequested,
            "launcher must consume the joiner's OR-merged reload intent")
        XCTAssertFalse(second.launched)
        XCTAssertFalse(second.surfaceReloadRequested)
    }

    func testReloadIntentResetsForAFreshLaunch() async {
        let coordinator = ConnectionRefreshCoordinator()

        // A launcher's own intent carries through…
        let first = await coordinator.refresh(requestSurfaceReload: true) {
            ConnectionRefreshResult.unreachable
        }
        XCTAssertTrue(first.surfaceReloadRequested)

        // …and must not leak into the next, unrelated launch.
        let second = await coordinator.refresh(requestSurfaceReload: false) {
            ConnectionRefreshResult.unreachable
        }
        XCTAssertTrue(second.launched)
        XCTAssertFalse(second.surfaceReloadRequested)
    }

    // MARK: - Cancellation

    func testCancelClearsTheInFlightProbe() async {
        let coordinator = ConnectionRefreshCoordinator()
        let probes = Counter()
        let probeStarted = Gate()

        let launcher = Task {
            await coordinator.refresh { () -> ConnectionRefreshResult in
                await probes.increment()
                await probeStarted.open()
                // Cancellation must interrupt this promptly; a broken cancel
                // path parks the test here for the full five seconds and then
                // fails the `.cancelled` assertion below.
                try? await Task.sleep(for: .seconds(5))
                return Task.isCancelled ? .cancelled : .unreachable
            }
        }
        await probeStarted.wait()
        await coordinator.cancelActiveRefresh()

        let cancelled = await launcher.value
        XCTAssertEqual(cancelled.result, .cancelled)

        // The in-flight slot is clear: the next refresh launches a fresh probe
        // instead of joining the cancelled one.
        let url = URL(string: "http://cave.test:3000")!
        let next = await coordinator.refresh {
            await probes.increment()
            return ConnectionRefreshResult.found(url)
        }
        XCTAssertEqual(next.result, .found(url))
        XCTAssertTrue(next.launched)
        let probeCount = await probes.value
        XCTAssertEqual(probeCount, 2)
    }

    // MARK: - Concurrent bootstrap

    private static let stubFamiliar = Familiar(
        id: "nova", displayName: "Nova", role: nil, description: nil,
        pronouns: nil, color: nil, status: nil, harness: nil, model: nil,
        icon: nil, avatarUrl: nil)
    private static let stubTheme = ThemeSnapshot(
        themeId: "cave", mode: "dark", tokens: ["--bg-base": "#101014"],
        updatedAt: "2026-07-21T00:00:00Z")
    private static let stubProfile = OperatorProfile(
        name: "Val", pronouns: nil, avatarPresent: false, avatarUpdatedAt: nil)

    private struct StubClient: CaveBootstrapClient {
        var delay: Duration = .zero
        var themeFails = false

        func ping() async -> Bool { true }
        func familiars() async throws -> [Familiar] {
            try await Task.sleep(for: delay)
            return [ConnectionRefreshCoordinatorTests.stubFamiliar]
        }
        func fetchTheme() async throws -> ThemeSnapshot {
            try await Task.sleep(for: delay)
            if themeFails { throw CaveError.transport("theme unavailable") }
            return ConnectionRefreshCoordinatorTests.stubTheme
        }
        func operatorProfile() async throws -> OperatorProfile {
            try await Task.sleep(for: delay)
            return ConnectionRefreshCoordinatorTests.stubProfile
        }
    }

    func testBootstrapLoadsIndependentResourcesConcurrently() async throws {
        let client = StubClient(delay: .milliseconds(250))
        let clock = ContinuousClock()

        let start = clock.now
        let payload = await ConnectionBootstrap.load(using: client)
        let elapsed = clock.now - start

        // Concurrent ≈ one loader's delay; sequential would be ≥ 750 ms.
        XCTAssertLessThan(elapsed, .milliseconds(600))
        XCTAssertEqual(try payload.familiars.get(), [Self.stubFamiliar])
        XCTAssertEqual(try payload.theme.get().themeId, Self.stubTheme.themeId)
        XCTAssertEqual(try payload.profile.get(), Self.stubProfile)
    }

    func testBootstrapFailureIsIsolatedPerResource() async throws {
        let payload = await ConnectionBootstrap.load(using: StubClient(themeFails: true))

        XCTAssertThrowsError(try payload.theme.get())
        // The theme failing must not discard the other resources.
        XCTAssertEqual(try payload.familiars.get(), [Self.stubFamiliar])
        XCTAssertEqual(try payload.profile.get(), Self.stubProfile)
    }
}
