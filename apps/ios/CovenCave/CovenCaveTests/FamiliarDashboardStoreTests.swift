import XCTest
@testable import CovenCave

/// The refresh, cancellation, deduplication and merge rules of the Familiar
/// hub's dashboard store (`cave-9rwd.2`).
///
/// Every assertion here is about BEHAVIOUR — which request was made, what the
/// store published, which value survived — rather than about the presence of a
/// method or the spelling of a state.
final class FamiliarDashboardStoreTests: XCTestCase {

    // MARK: - Loading

    @MainActor
    func testFirstLoadPublishesASnapshotAndSettlesReady() async throws {
        let loader = StubDashboardLoader(payload: try FamiliarDashboardFixtures.payload())
        let store = FamiliarDashboardStore()

        let launched = await store.refresh(familiarId: "nova", using: loader)

        XCTAssertTrue(launched)
        let entry = store.entry(for: "nova")
        XCTAssertEqual(entry.phase, .ready)
        XCTAssertNil(entry.error)
        XCTAssertNotNil(entry.lastLoadedAt)
        let snapshot = try XCTUnwrap(entry.snapshot)
        XCTAssertEqual(snapshot.identity.displayName, "Nova")
        XCTAssertEqual(snapshot.overview.presentation, .fresh)
        XCTAssertEqual(snapshot.overview.data?.sessions.active.total, 1)
        XCTAssertEqual(snapshot.overview.data?.sessions.recent.total, 4)
    }

    /// A refresh over content already on screen must not report itself as a
    /// first load — that is what drives the hub to a skeleton and blanks a
    /// perfectly good dashboard every 30 seconds.
    @MainActor
    func testRefreshOverExistingContentDoesNotClaimToBeAFirstLoad() async throws {
        let payload = try FamiliarDashboardFixtures.payload()
        let loader = StubDashboardLoader(payload: payload)
        let start = FamiliarDashboardTestGate()
        let release = FamiliarDashboardTestGate()
        let store = FamiliarDashboardStore()

        _ = await store.refresh(familiarId: "nova", using: loader)
        XCTAssertEqual(store.entry(for: "nova").phase, .ready)

        await loader.hold(start: start, release: release)
        let second = Task { await store.refresh(familiarId: "nova", using: loader) }
        await start.wait()

        XCTAssertEqual(store.entry(for: "nova").phase, .refreshing)
        XCTAssertNotNil(store.entry(for: "nova").snapshot, "content stays mounted while refreshing")

        await release.open()
        _ = await second.value
        XCTAssertEqual(store.entry(for: "nova").phase, .ready)
    }

    @MainActor
    func testFirstLoadFailureWithNothingCachedIsAFullSurfaceFailure() async {
        let loader = StubDashboardLoader(outcomes: [.failure(.transport("no route"))])
        let store = FamiliarDashboardStore()

        _ = await store.refresh(familiarId: "nova", using: loader)

        let entry = store.entry(for: "nova")
        XCTAssertEqual(entry.phase, .failed)
        XCTAssertTrue(entry.showsFullSurfaceError)
        XCTAssertNil(entry.snapshot)
        XCTAssertNil(entry.lastLoadedAt)
        XCTAssertEqual(entry.error, .transport("no route"))
    }

    // MARK: - Last-known-good and staleness

    @MainActor
    func testWholeRequestFailureKeepsTheSnapshotAndMarksEverySectionStale() async throws {
        let good = try FamiliarDashboardFixtures.payload()
        let loader = StubDashboardLoader(
            outcomes: [.success(good), .failure(.transport("desktop asleep"))])
        let store = FamiliarDashboardStore()

        _ = await store.refresh(familiarId: "nova", using: loader)
        let firstLoadedAt = store.entry(for: "nova").lastLoadedAt
        _ = await store.refresh(familiarId: "nova", using: loader)

        let entry = store.entry(for: "nova")
        XCTAssertEqual(entry.phase, .ready, "content is still renderable, so this is not a dead surface")
        XCTAssertEqual(entry.error, .transport("desktop asleep"))
        let snapshot = try XCTUnwrap(entry.snapshot)
        XCTAssertTrue(snapshot.overview.isStale)
        XCTAssertTrue(snapshot.profile.isStale)
        XCTAssertTrue(snapshot.analytics.isStale)
        XCTAssertTrue(snapshot.hasAnyStaleSection)
        XCTAssertNotNil(snapshot.overview.data, "stale means old, not gone")
        XCTAssertEqual(
            snapshot.overview.serverState, .fresh,
            "the retained value keeps the state it was actually served with")
        XCTAssertEqual(
            snapshot.overview.generatedAt, FamiliarDashboardFixtures.generatedAt,
            "a failed refresh must never restamp old data as newly assembled")
        XCTAssertEqual(
            entry.lastLoadedAt, firstLoadedAt,
            "lastLoadedAt records the last SUCCESS")
    }

    @MainActor
    func testASectionThatGoesUnavailableKeepsItsLastGoodValueAndSaysWhy() async throws {
        let good = try FamiliarDashboardFixtures.payload()
        let degraded = try FamiliarDashboardFixtures.payload(
            generatedAt: "2026-08-23T12:00:30.000Z",
            overview: FamiliarDashboardFixtures.section(
                state: "unavailable",
                data: nil,
                generatedAt: "2026-08-23T12:00:30.000Z",
                issues: [
                    FamiliarDashboardFixtures.issue(
                        source: "sessions", code: "sessions_unavailable", retryable: true)
                ]
            )
        )
        let loader = StubDashboardLoader(outcomes: [.success(good), .success(degraded)])
        let store = FamiliarDashboardStore()

        _ = await store.refresh(familiarId: "nova", using: loader)
        _ = await store.refresh(familiarId: "nova", using: loader)

        let snapshot = try XCTUnwrap(store.snapshot(for: "nova"))
        XCTAssertEqual(snapshot.overview.presentation, .stale)
        XCTAssertNotNil(snapshot.overview.data)
        XCTAssertEqual(snapshot.overview.generatedAt, FamiliarDashboardFixtures.generatedAt)
        XCTAssertEqual(snapshot.overview.refreshIssues.first?.code, .sessionsUnavailable)
        XCTAssertTrue(snapshot.overview.isRetryable)
        // The sections that DID refresh are not dragged down with it.
        XCTAssertEqual(snapshot.profile.presentation, .fresh)
        XCTAssertEqual(snapshot.analytics.presentation, .fresh)
        // …and the newest identity is adopted rather than retained.
        XCTAssertEqual(snapshot.generatedAt, "2026-08-23T12:00:30.000Z")
    }

    @MainActor
    func testAnUnavailableSectionWithNoPriorValueStaysUnavailable() async throws {
        let payload = try FamiliarDashboardFixtures.payload(
            overview: FamiliarDashboardFixtures.section(
                state: "unavailable",
                data: nil,
                issues: [
                    FamiliarDashboardFixtures.issue(
                        source: "memory", code: "memory_unavailable", retryable: false)
                ]
            )
        )
        let store = FamiliarDashboardStore()

        _ = await store.refresh(
            familiarId: "nova", using: StubDashboardLoader(payload: payload))

        let snapshot = try XCTUnwrap(store.snapshot(for: "nova"))
        XCTAssertEqual(snapshot.overview.presentation, .unavailable)
        XCTAssertNil(snapshot.overview.data)
        XCTAssertFalse(snapshot.overview.isStale)
        XCTAssertEqual(snapshot.overview.visibleIssues.first?.code, .memoryUnavailable)
        XCTAssertFalse(
            snapshot.overview.isRetryable,
            "a familiar with no memory on disk will not grow one on a retry")
    }

    /// The single most important distinction the contract draws. `empty` is a
    /// positive claim; `unavailable` is a failure. A client that renders them
    /// the same way shows a calm, wrong screen.
    @MainActor
    func testEmptyIsNeverConfusedWithUnavailable() async throws {
        let payload = try FamiliarDashboardFixtures.payload(
            overview: FamiliarDashboardFixtures.section(
                state: "empty", data: FamiliarDashboardFixtures.emptyOverviewData)
        )
        let store = FamiliarDashboardStore()

        _ = await store.refresh(
            familiarId: "nova", using: StubDashboardLoader(payload: payload))

        let snapshot = try XCTUnwrap(store.snapshot(for: "nova"))
        XCTAssertEqual(snapshot.overview.presentation, .empty)
        XCTAssertNotNil(snapshot.overview.data, "empty carries real, empty data")
        XCTAssertTrue(snapshot.overview.issues.isEmpty)
        XCTAssertFalse(snapshot.overview.presentation.hasNoData)
        XCTAssertEqual(snapshot.overview.data?.now, .idle)
    }

    /// The server promises `data === null ⟺ state === "unavailable"`. If it
    /// ever breaks that promise, the DATA is believed, not the label.
    @MainActor
    func testASectionClaimingFreshWithNoDataIsTreatedAsUnavailable() async throws {
        let payload = try FamiliarDashboardFixtures.payload(
            analytics: FamiliarDashboardFixtures.section(state: "fresh", data: nil)
        )
        let store = FamiliarDashboardStore()

        _ = await store.refresh(
            familiarId: "nova", using: StubDashboardLoader(payload: payload))

        let snapshot = try XCTUnwrap(store.snapshot(for: "nova"))
        XCTAssertEqual(snapshot.analytics.presentation, .unavailable)
        XCTAssertNil(snapshot.analytics.data)
    }

    @MainActor
    func testAPartialSectionRendersItsContentAndKeepsItsCaveats() async throws {
        let payload = try FamiliarDashboardFixtures.payload(
            overview: FamiliarDashboardFixtures.section(
                state: "partial",
                data: FamiliarDashboardFixtures.overviewData,
                issues: [
                    FamiliarDashboardFixtures.issue(
                        source: "memory", code: "memory_unavailable", retryable: true)
                ]
            )
        )
        let store = FamiliarDashboardStore()

        _ = await store.refresh(
            familiarId: "nova", using: StubDashboardLoader(payload: payload))

        let snapshot = try XCTUnwrap(store.snapshot(for: "nova"))
        XCTAssertEqual(snapshot.overview.presentation, .partial)
        XCTAssertNotNil(snapshot.overview.data)
        XCTAssertEqual(snapshot.overview.issues.count, 1)
        XCTAssertTrue(snapshot.overview.refreshIssues.isEmpty)
    }

    // MARK: - Missing familiar

    @MainActor
    func testANotFoundFamiliarDropsItsCachedDashboard() async throws {
        let good = try FamiliarDashboardFixtures.payload()
        let loader = StubDashboardLoader(
            outcomes: [.success(good), .failure(.familiarNotFound)])
        let store = FamiliarDashboardStore()

        _ = await store.refresh(familiarId: "nova", using: loader)
        XCTAssertNotNil(store.snapshot(for: "nova"))
        _ = await store.refresh(familiarId: "nova", using: loader)

        let entry = store.entry(for: "nova")
        XCTAssertEqual(entry.phase, .missing)
        XCTAssertNil(
            entry.snapshot,
            "a deleted Familiar's sessions must not keep rendering as though it were still there")
        XCTAssertEqual(entry.error, .familiarNotFound)
        XCTAssertFalse(FamiliarDashboardError.familiarNotFound.isRetryable)
    }

    // MARK: - Deduplication

    @MainActor
    func testOverlappingRefreshesCostOneRequest() async throws {
        let loader = StubDashboardLoader(payload: try FamiliarDashboardFixtures.payload())
        let start = FamiliarDashboardTestGate()
        let release = FamiliarDashboardTestGate()
        await loader.hold(start: start, release: release)
        let store = FamiliarDashboardStore()

        // The timer tick.
        let ticker = Task { await store.refresh(familiarId: "nova", using: loader) }
        await start.wait()
        XCTAssertTrue(store.hasRequestInFlight(for: "nova"))

        // The release only fires once this test suspends, which happens after
        // the pull-to-refresh below has already joined — so the overlap is
        // guaranteed rather than scheduler-lucky.
        Task { await release.open() }
        let pullToRefreshLaunched = await store.refresh(familiarId: "nova", using: loader)
        let tickerLaunched = await ticker.value

        XCTAssertTrue(tickerLaunched)
        XCTAssertFalse(pullToRefreshLaunched, "the second caller must join the request in flight")
        let calls = await loader.callCount
        XCTAssertEqual(calls, 1)
    }

    // MARK: - Cancellation

    @MainActor
    func testSwitchingFamiliarCancelsThePreviousRequest() async throws {
        let loader = StubDashboardLoader(payload: try FamiliarDashboardFixtures.payload())
        let start = FamiliarDashboardTestGate()
        let release = FamiliarDashboardTestGate()
        await loader.hold(start: start, release: release)
        let store = FamiliarDashboardStore()

        store.activate(familiarId: "nova")
        let inFlight = Task { await store.refresh(familiarId: "nova", using: loader) }
        await start.wait()
        XCTAssertTrue(store.hasRequestInFlight(for: "nova"))

        store.activate(familiarId: "sage")
        XCTAssertFalse(store.hasRequestInFlight(for: "nova"))

        await release.open()
        _ = await inFlight.value

        let entry = store.entry(for: "nova")
        XCTAssertNil(
            entry.error,
            "a cancelled request says nothing about the desktop and must record no failure")
        XCTAssertNil(entry.snapshot)
        XCTAssertEqual(
            entry.phase, .idle,
            "a cancelled first load returns to idle rather than reading as a failure")
    }

    @MainActor
    func testACancelledRefreshNeverMarksLiveContentStale() async throws {
        let good = try FamiliarDashboardFixtures.payload()
        let loader = StubDashboardLoader(payload: good)
        let store = FamiliarDashboardStore()

        store.activate(familiarId: "nova")
        _ = await store.refresh(familiarId: "nova", using: loader)

        let start = FamiliarDashboardTestGate()
        let release = FamiliarDashboardTestGate()
        await loader.hold(start: start, release: release)
        let second = Task { await store.refresh(familiarId: "nova", using: loader) }
        await start.wait()

        store.activate(familiarId: "sage")
        await release.open()
        _ = await second.value

        let entry = store.entry(for: "nova")
        let snapshot = try XCTUnwrap(entry.snapshot)
        XCTAssertFalse(snapshot.hasAnyStaleSection, "switching tabs must not age a person's data")
        XCTAssertNil(entry.error)
        XCTAssertEqual(entry.phase, .ready)
    }

    // MARK: - Keying and eviction

    @MainActor
    func testDashboardsAreKeyedByFamiliar() async throws {
        let loader = StubDashboardLoader(outcomes: [
            .success(try FamiliarDashboardFixtures.payload(familiarId: "nova", displayName: "Nova")),
            .success(try FamiliarDashboardFixtures.payload(familiarId: "sage", displayName: "Sage")),
        ])
        let store = FamiliarDashboardStore()

        _ = await store.refresh(familiarId: "nova", using: loader)
        _ = await store.refresh(familiarId: "sage", using: loader)

        XCTAssertEqual(store.snapshot(for: "nova")?.identity.displayName, "Nova")
        XCTAssertEqual(store.snapshot(for: "sage")?.identity.displayName, "Sage")
        XCTAssertNil(store.snapshot(for: "unknown-familiar"))
        XCTAssertEqual(store.entry(for: "unknown-familiar").phase, .idle)
    }

    @MainActor
    func testChangingEndpointDropsEveryCachedDashboard() async throws {
        let loader = StubDashboardLoader(payload: try FamiliarDashboardFixtures.payload())
        let store = FamiliarDashboardStore()

        store.setEndpointKey("mac.tailnet.ts.net")
        _ = await store.refresh(familiarId: "nova", using: loader)
        XCTAssertNotNil(store.snapshot(for: "nova"))

        store.setEndpointKey("other-mac.tailnet.ts.net")

        XCTAssertNil(
            store.snapshot(for: "nova"),
            "two Caves can hold the same familiar id; a snapshot must not survive the switch")
        XCTAssertEqual(store.cachedFamiliarCount, 0)

        // Re-declaring the SAME endpoint is not a change and must not clear.
        _ = await store.refresh(familiarId: "nova", using: loader)
        store.setEndpointKey("other-mac.tailnet.ts.net")
        XCTAssertNotNil(store.snapshot(for: "nova"))
    }

    @MainActor
    func testCacheIsBoundedAndEvictsLeastRecentlyUsed() async throws {
        let loader = StubDashboardLoader(outcomes: [
            .success(try FamiliarDashboardFixtures.payload(familiarId: "a", displayName: "A")),
            .success(try FamiliarDashboardFixtures.payload(familiarId: "b", displayName: "B")),
            .success(try FamiliarDashboardFixtures.payload(familiarId: "c", displayName: "C")),
        ])
        let store = FamiliarDashboardStore(capacity: 2)

        for id in ["a", "b", "c"] {
            store.activate(familiarId: id)
            _ = await store.refresh(familiarId: id, using: loader)
        }

        XCTAssertEqual(store.cachedFamiliarCount, 2)
        XCTAssertNil(store.snapshot(for: "a"), "the least recently used Familiar is evicted")
        XCTAssertNotNil(store.snapshot(for: "b"))
        XCTAssertNotNil(store.snapshot(for: "c"))
        XCTAssertEqual(store.activeFamiliarId, "c")
    }

    @MainActor
    func testTheFamiliarOnScreenIsNeverEvicted() async throws {
        let loader = StubDashboardLoader(outcomes: [
            .success(try FamiliarDashboardFixtures.payload(familiarId: "a", displayName: "A")),
            .success(try FamiliarDashboardFixtures.payload(familiarId: "b", displayName: "B")),
            .success(try FamiliarDashboardFixtures.payload(familiarId: "c", displayName: "C")),
        ])
        let store = FamiliarDashboardStore(capacity: 1)

        // "a" stays on screen while two other Familiars are loaded behind it.
        store.activate(familiarId: "a")
        _ = await store.refresh(familiarId: "a", using: loader)
        _ = await store.refresh(familiarId: "b", using: loader)
        _ = await store.refresh(familiarId: "c", using: loader)

        XCTAssertNotNil(
            store.snapshot(for: "a"),
            "evicting the Familiar being rendered would blank the screen it is on")
    }

    // MARK: - Refresh policy

    func testThirtySecondRefreshRequiresVisibilitySceneActivityAndAnEndpoint() {
        XCTAssertEqual(FamiliarDashboardRefreshPolicy.interval, .seconds(30))

        XCTAssertTrue(
            FamiliarDashboardRefreshPolicy.shouldPoll(
                hubVisible: true, sceneActive: true, endpointConfigured: true))

        // Every single-condition failure stops the poll. Enumerated rather than
        // spot-checked: an `||` slipped in here is invisible until a phone is
        // polling a desktop from a backgrounded app.
        XCTAssertFalse(
            FamiliarDashboardRefreshPolicy.shouldPoll(
                hubVisible: false, sceneActive: true, endpointConfigured: true))
        XCTAssertFalse(
            FamiliarDashboardRefreshPolicy.shouldPoll(
                hubVisible: true, sceneActive: false, endpointConfigured: true))
        XCTAssertFalse(
            FamiliarDashboardRefreshPolicy.shouldPoll(
                hubVisible: true, sceneActive: true, endpointConfigured: false))
        XCTAssertFalse(
            FamiliarDashboardRefreshPolicy.shouldPoll(
                hubVisible: false, sceneActive: false, endpointConfigured: false))
    }
}
