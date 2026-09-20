import XCTest
import UIKit
import SwiftUI
import Synchronization
@testable import CovenCave

private final class TestPerformanceClock: CavePerformanceClock {
    private struct State {
        var index = 0
    }

    private let values: [Duration]
    private let state: Mutex<State>

    init(values: [Duration]) {
        self.values = values.isEmpty ? [.zero] : values
        self.state = Mutex(State())
    }

    func now() -> Duration {
        state.withLock { state in
            let currentIndex = min(state.index, values.count - 1)
            let value = values[currentIndex]
            if state.index < values.count - 1 {
                state.index += 1
            }
            return value
        }
    }
}

private final class CountingPerformanceClock: CavePerformanceClock {
    private struct State {
        var callCount = 0
    }

    private let value: Duration
    private let state: Mutex<State>

    var callCount: Int {
        state.withLock { $0.callCount }
    }

    init(value: Duration = .zero) {
        self.value = value
        self.state = Mutex(State())
    }

    func now() -> Duration {
        state.withLock { state in
            state.callCount += 1
            return value
        }
    }
}

private enum RecorderTestError: Error, Equatable {
    case expected
}

private struct PerformanceDrawerAnimationProbe: View {
    let app: AppModel
    var body: some View {
        Color.blue.frame(width: 20, height: 20)
            .offset(x: app.navigationDrawerOpen ? 100 : 0)
            .animation(.linear(duration: 0.2), value: app.navigationDrawerOpen)
    }
}

@MainActor
final class CavePerformanceTests: XCTestCase {
    func testBaselineSpanNamesStayStable() {
        XCTAssertEqual(
            CavePerformanceSpanName.baseline.map(\.rawValue),
            [
                "drawer.open",
                "destination.stable-frame",
                "search.query",
                "chat.first-rich-render",
                "chat.list-projection",
            ]
        )
    }

    func testMeasureRecordsDurationAndCount() async {
        let recorder = CavePerformanceRecorder(enabled: true)
        let clock = TestPerformanceClock(values: [.zero, .milliseconds(12)])

        let value = await recorder.measure("bootstrap", clock: clock) { 42 }

        XCTAssertEqual(value, 42)
        XCTAssertEqual(recorder.snapshot()["bootstrap"]?.count, 1)
        XCTAssertEqual(recorder.snapshot()["bootstrap"]?.latestMilliseconds, 12)
        XCTAssertEqual(recorder.snapshot()["bootstrap"]?.maximumMilliseconds, 12)
    }

    func testMeasureKeepsMaximumAcrossSamples() async {
        let recorder = CavePerformanceRecorder(enabled: true)

        _ = await recorder.measure("bootstrap", clock: TestPerformanceClock(values: [.zero, .milliseconds(4)])) { () }
        _ = await recorder.measure("bootstrap", clock: TestPerformanceClock(values: [.zero, .milliseconds(9)])) { () }

        XCTAssertEqual(recorder.snapshot()["bootstrap"], CavePerformanceSample(count: 2,
                                                                               latestMilliseconds: 9,
                                                                               maximumMilliseconds: 9))
    }

    func testCounterAccumulatesDeterministically() {
        let recorder = CavePerformanceRecorder(enabled: true)

        recorder.increment("network.request")
        recorder.increment("network.request", by: 2)

        XCTAssertEqual(recorder.counter("network.request"), 3)
    }

    func testSynchronousMeasureRecordsDurationAndCount() {
        let recorder = CavePerformanceRecorder(enabled: true)
        let clock = TestPerformanceClock(values: [.zero, .milliseconds(7)])

        let value = recorder.measureSynchronous("markdown.webview.init", clock: clock) { 42 }

        XCTAssertEqual(value, 42)
        XCTAssertEqual(recorder.snapshot()["markdown.webview.init"],
                       CavePerformanceSample(count: 1,
                                             latestMilliseconds: 7,
                                             maximumMilliseconds: 7))
    }

    func testExplicitSpanRecordsAcrossAnAsynchronousBoundary() {
        let recorder = CavePerformanceRecorder(enabled: true)
        let clock = TestPerformanceClock(values: [.zero, .milliseconds(19)])

        let span = recorder.begin("markdown.webview.init", clock: clock)
        recorder.end(span)
        recorder.end(span)

        XCTAssertEqual(recorder.snapshot()["markdown.webview.init"],
                       CavePerformanceSample(count: 1,
                                             latestMilliseconds: 19,
                                             maximumMilliseconds: 19))
    }

    func testSpanLifecycleDiscardsSupersededSpansAndFinishesActiveSpansExactlyOnce() {
        let recorder = CavePerformanceRecorder(enabled: true)
        let clock = TestPerformanceClock(
            values: [
                .zero,
                .milliseconds(4),
                .milliseconds(10),
                .milliseconds(20),
                .milliseconds(30),
                .milliseconds(41),
            ]
        )
        let lifecycle = CavePerformanceSpanLifecycle(recorder: recorder)

        lifecycle.begin(.drawerOpen, clock: clock)
        lifecycle.begin(.drawerOpen, clock: clock)
        lifecycle.finish(.drawerOpen)
        lifecycle.finish(.drawerOpen)
        lifecycle.begin(.searchQuery, clock: clock)
        lifecycle.finishAll()
        lifecycle.finishAll()

        XCTAssertEqual(
            recorder.snapshot()[CavePerformanceSpanName.drawerOpen.rawValue],
            CavePerformanceSample(count: 1,
                                  latestMilliseconds: 6,
                                  maximumMilliseconds: 6)
        )
        XCTAssertEqual(
            recorder.snapshot()[CavePerformanceSpanName.searchQuery.rawValue],
            CavePerformanceSample(count: 1,
                                  latestMilliseconds: 10,
                                  maximumMilliseconds: 10)
        )
    }

    func testSupersededFrameCallbackCannotFinishTheCurrentVisit() {
        let recorder = CavePerformanceRecorder(enabled: true)
        let lifecycle = CavePerformanceSpanLifecycle(recorder: recorder)
        let clock = TestPerformanceClock(values: [.zero, .milliseconds(4), .milliseconds(9)])
        lifecycle.begin(.destinationStableFrame, clock: clock)
        let previous = lifecycle.span(for: .destinationStableFrame)
        lifecycle.begin(.destinationStableFrame, clock: clock)
        let current = lifecycle.span(for: .destinationStableFrame)

        lifecycle.finish(.destinationStableFrame, matching: previous)
        XCTAssertTrue(lifecycle.isActive(.destinationStableFrame))
        XCTAssertNil(recorder.snapshot()[CavePerformanceSpanName.destinationStableFrame.rawValue])
        lifecycle.finish(.destinationStableFrame, matching: current)
        XCTAssertFalse(lifecycle.isActive(.destinationStableFrame))
        XCTAssertEqual(recorder.snapshot()[CavePerformanceSpanName.destinationStableFrame.rawValue]?.count, 1)
    }

    func testSpanLifecycleCancellationDoesNotRecordASuccessfulSample() {
        let recorder = CavePerformanceRecorder(enabled: true)
        let clock = TestPerformanceClock(values: [.zero, .milliseconds(12)])
        let lifecycle = CavePerformanceSpanLifecycle(recorder: recorder)

        lifecycle.begin(.searchQuery, clock: clock)
        lifecycle.cancel(.searchQuery)
        lifecycle.finish(.searchQuery)

        XCTAssertNil(recorder.snapshot()[CavePerformanceSpanName.searchQuery.rawValue])
    }

    func testInactiveSceneCancelsAndSuppressesSpansUntilReactivated() {
        let recorder = CavePerformanceRecorder(enabled: true)
        let clock = TestPerformanceClock(
            values: [.zero, .milliseconds(10), .milliseconds(20)]
        )
        let lifecycle = CavePerformanceSpanLifecycle(recorder: recorder)

        lifecycle.begin(.drawerOpen, clock: clock)
        lifecycle.setSceneActive(false)
        lifecycle.finish(.drawerOpen)
        lifecycle.begin(.searchQuery, clock: clock)
        lifecycle.finish(.searchQuery)

        XCTAssertTrue(recorder.snapshot().isEmpty)

        lifecycle.setSceneActive(true)
        lifecycle.begin(.searchQuery, clock: clock)
        lifecycle.finish(.searchQuery)

        XCTAssertEqual(
            recorder.snapshot()[CavePerformanceSpanName.searchQuery.rawValue]?.count,
            1
        )
    }

    func testMeasureEvictsOldestDistinctSampleWhenSampleKeyLimitIsReached() async {
        let recorder = CavePerformanceRecorder(enabled: true, sampleKeyLimit: 2)

        _ = await recorder.measure("bootstrap", clock: TestPerformanceClock(values: [.zero, .milliseconds(4)])) { () }
        _ = await recorder.measure("network.bootstrap", clock: TestPerformanceClock(values: [.zero, .milliseconds(8)])) { () }
        _ = await recorder.measure("bootstrap", clock: TestPerformanceClock(values: [.zero, .milliseconds(12)])) { () }
        _ = await recorder.measure("media.decode", clock: TestPerformanceClock(values: [.zero, .milliseconds(16)])) { () }

        XCTAssertEqual(recorder.snapshot(), [
            "network.bootstrap": CavePerformanceSample(count: 1, latestMilliseconds: 8, maximumMilliseconds: 8),
            "media.decode": CavePerformanceSample(count: 1, latestMilliseconds: 16, maximumMilliseconds: 16)
        ])
    }

    func testIncrementEvictsOldestDistinctCounterWhenCounterKeyLimitIsReached() {
        let recorder = CavePerformanceRecorder(enabled: true, counterKeyLimit: 2)

        recorder.increment("network.request")
        recorder.increment("image.decode")
        recorder.increment("network.request", by: 3)
        recorder.increment("markdown.render")

        XCTAssertEqual(recorder.counter("network.request"), 0)
        XCTAssertEqual(recorder.counter("image.decode"), 1)
        XCTAssertEqual(recorder.counter("markdown.render"), 1)
    }

    func testDisabledMeasureReturnsValueWithoutRecordingOrReadingClock() async {
        let recorder = CavePerformanceRecorder(enabled: false)
        let clock = CountingPerformanceClock(value: .milliseconds(99))

        let value = await recorder.measure("bootstrap", clock: clock) { 42 }

        XCTAssertEqual(value, 42)
        XCTAssertEqual(clock.callCount, 0)
        XCTAssertTrue(recorder.snapshot().isEmpty)
    }

    func testDisabledMeasureRethrowsWithoutRecordingOrReadingClock() async {
        let recorder = CavePerformanceRecorder(enabled: false)
        let clock = CountingPerformanceClock(value: .milliseconds(99))

        do {
            _ = try await recorder.measure("bootstrap", clock: clock) {
                throw RecorderTestError.expected
            }
            XCTFail("Expected measure to rethrow the wrapped error")
        } catch let error as RecorderTestError {
            XCTAssertEqual(error, .expected)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        XCTAssertEqual(clock.callCount, 0)
        XCTAssertTrue(recorder.snapshot().isEmpty)
    }

    func testDisabledCounterIsNoOp() {
        let recorder = CavePerformanceRecorder(enabled: false)

        recorder.increment("network.request")
        recorder.increment("network.request", by: 2)

        XCTAssertEqual(recorder.counter("network.request"), 0)
    }

    func testSharedRecorderUsesCompileTimeDefault() {
        #if DEBUG
        let isDebugBuild = true
        #else
        let isDebugBuild = false
        #endif
        XCTAssertEqual(
            CavePerformanceRecorder.shared.isEnabled,
            CavePerformanceRecorder.shouldEnableShared(
                isDebugBuild: isDebugBuild,
                environment: ProcessInfo.processInfo.environment,
                arguments: ProcessInfo.processInfo.arguments
            )
        )
    }

    func testReleaseInstrumentationCanBeEnabledExplicitly() {
        XCTAssertFalse(
            CavePerformanceRecorder.shouldEnableShared(
                isDebugBuild: false,
                environment: [:],
                arguments: []
            )
        )
        XCTAssertTrue(
            CavePerformanceRecorder.shouldEnableShared(
                isDebugBuild: false,
                environment: ["CAVE_PERFORMANCE_INSTRUMENTATION": "1"],
                arguments: []
            )
        )
        XCTAssertTrue(
            CavePerformanceRecorder.shouldEnableShared(
                isDebugBuild: false,
                environment: [:],
                arguments: ["CovenCave", "--performance-instrumentation"]
            )
        )
    }

    func testPerformanceFixtureRequiresExplicitLaunchArgument() {
        XCTAssertFalse(CavePerformanceFixture.shouldEnable(arguments: []))
        XCTAssertFalse(
            CavePerformanceFixture.shouldEnable(
                arguments: ["CovenCave", "--performance-instrumentation"]
            )
        )
        XCTAssertTrue(
            CavePerformanceFixture.shouldEnable(
                arguments: ["CovenCave", "--performance-fixture"]
            )
        )
    }

    func testPerformanceFixtureDefaultsResetBetweenRuns() {
        let existing = UserDefaults(suiteName: CavePerformanceFixture.defaultsSuiteName)
        existing?.set(true, forKey: "cave.lock.enabled")

        let reset = CavePerformanceFixture.makeIsolatedDefaults()

        XCTAssertFalse(reset.bool(forKey: "cave.lock.enabled"))
    }

    func testThreadDraftPersistenceUsesInjectedDefaults() {
        let suiteName = "CavePerformanceTests.drafts.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let threadID = "fixture-thread-\(UUID().uuidString)"
        let app = AppModel(
            defaults: defaults,
            restoreLocalState: false,
            loadPersistedConnection: false
        )

        app.persistThreadDraft(threadID, text: "isolated draft")

        XCTAssertEqual(app.persistedThreadDraft(threadID), "isolated draft")
        XCTAssertEqual(app.threadDrafts[threadID], "isolated draft")
        XCTAssertNil(
            UserDefaults.standard.string(
                forKey: AppModel.draftKey(threadID)
            )
        )

        app.persistThreadDraft(threadID, text: " ")

        XCTAssertNil(app.persistedThreadDraft(threadID))
        XCTAssertNil(app.threadDrafts[threadID])
    }

    func testPerformanceFixtureHasDeterministicSafeScaleAndContent() {
        let first = CavePerformanceFixture.make()
        let second = CavePerformanceFixture.make()

        XCTAssertEqual(first.projects.count, 20)
        XCTAssertEqual(first.threads.count, 1_000)
        XCTAssertEqual(first.serverSessions.count, 1_000)
        XCTAssertEqual(first.tasks.count, 1_000)
        XCTAssertEqual(first.familiars.count, 12)
        XCTAssertEqual(first.projects.map(\.id), second.projects.map(\.id))
        XCTAssertEqual(first.threads.map(\.id), second.threads.map(\.id))
        XCTAssertEqual(first.serverSessions.map(\.id), second.serverSessions.map(\.id))
        XCTAssertEqual(first.tasks.map(\.id), second.tasks.map(\.id))
        XCTAssertTrue(first.threads.contains(where: \.isStreaming))
        XCTAssertTrue(
            first.threads
                .flatMap(\.messages)
                .contains {
                    $0.role == .assistant
                        && MarkdownDetect.hasMarkdown($0.text)
                        && $0.text.contains("```swift")
                        && $0.text.contains("| Signal | State |")
                }
        )
        XCTAssertTrue(
            ProjectContext.hasUnassignedArtifacts(
                threads: first.threads,
                sessions: first.serverSessions,
                tasks: first.tasks,
                registeredProjects: first.projects
            )
        )
        XCTAssertTrue(first.projects.allSatisfy { $0.root.hasPrefix("/performance-fixture/") })
        XCTAssertTrue(first.projects.allSatisfy { !$0.root.contains("/Users/") })
        XCTAssertTrue(
            first.projects.allSatisfy {
                first.projectMembership.familiarIDs(for: $0).count >= 3
            }
        )
    }

    func testInstrumentationRecordRetainsSuppliedSpanName() {
        let record = CavePerformanceInstrumentationRecord(spanName: "bootstrap")

        XCTAssertEqual(record.spanName, "bootstrap")
        XCTAssertEqual(record.beginMessage, "span=bootstrap phase=begin")
        XCTAssertEqual(record.endMessage, "span=bootstrap phase=end")
    }

    func testFrameReporterReschedulesReopenedTokenAndCancelsInterveningReport() async {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 100, height: 100))
        window.rootViewController = UIViewController()
        let reporter = CavePerformanceStableFrame.ReporterView()
        window.rootViewController!.view.addSubview(reporter)
        window.isHidden = false
        defer {
            reporter.cancelPendingReport()
            window.isHidden = true
        }
        let firstOpen = expectation(description: "first open")
        reporter.schedule(token: "open", minimumDelay: 0) { firstOpen.fulfill() }
        await fulfillment(of: [firstOpen], timeout: 3)

        let reopened = expectation(description: "reopened")
        let staleClose = expectation(description: "superseded close")
        staleClose.isInverted = true
        reporter.schedule(token: "closed", minimumDelay: 0.1) { staleClose.fulfill() }
        reporter.schedule(token: "open", minimumDelay: 0) { reopened.fulfill() }
        await fulfillment(of: [reopened, staleClose], timeout: 0.5)
    }

    func testDetachedFrameReporterWaitsForReattachment() async throws {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 100, height: 100))
        window.rootViewController = UIViewController()
        let reporter = CavePerformanceStableFrame.ReporterView()
        window.rootViewController!.view.addSubview(reporter)
        window.isHidden = false
        defer { reporter.cancelPendingReport(); window.isHidden = true }
        var reports = 0
        reporter.schedule(token: "detached", minimumDelay: 0) { reports += 1 }
        // Let the scheduled main-queue item arm its display link, then detach
        // before the next display turn without relying on wall-clock timing.
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                reporter.removeFromSuperview()
                continuation.resume()
            }
        }
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(reports, 0)
        window.rootViewController!.view.addSubview(reporter)
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(3))
        while reports == 0, clock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(reports, 1)
    }

    func testFixtureStreamingUpdatesTranscriptAndRemainsBounded() {
        let fixture = CavePerformanceFixture.make()
        let thread = fixture.threads[0]
        let otherText = fixture.threads[1].messages[0].text
        CavePerformanceFixture.applyStreamingFrame(0, to: thread)
        let initial = thread.messages[0].text
        CavePerformanceFixture.applyStreamingFrame(199, to: thread)
        XCTAssertGreaterThan(thread.messages[0].text.count, initial.count)
        XCTAssertLessThan(thread.messages[0].text.count, 6_000)
        XCTAssertTrue(thread.messages[0].streaming)
        guard case .message(let rendered) = thread.transcriptRows.last else {
            return XCTFail("Streaming fixture must update the rendered transcript")
        }
        XCTAssertEqual(rendered.text, thread.messages[0].text)
        CavePerformanceFixture.applyStreamingFrame(200, to: thread)
        XCTAssertEqual(thread.messages[0].text, initial)
        CavePerformanceFixture.applyStreamingFrame(10, to: fixture.threads[1])
        XCTAssertEqual(fixture.threads[1].messages[0].text, otherText)
    }

    func testFixtureRefusesLiveConnectionAndPairingChanges() async {
        let suite = "CavePerformanceTests.connection.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let app = AppModel(defaults: defaults, restoreLocalState: false,
                           loadPersistedConnection: false, isPerformanceFixture: true,
                           widgetSnapshotDefaults: defaults)
        let before = defaults.dictionaryRepresentation()
        let lease = await app.configure(host: "fixture.invalid", token: "synthetic-fixture-token")
        XCTAssertNil(lease)
        XCTAssertNil(app.connection)
        app.handleDeepLink(URL(string: "covencave://connect?host=fixture.invalid&token=synthetic-fixture-token")!)
        XCTAssertNil(app.pendingPairingIntent)
        app.disconnect()
        XCTAssertTrue(NSDictionary(dictionary: before).isEqual(to: defaults.dictionaryRepresentation()))
    }

    func testDrawerPresentationWaitsForImplicitAnimationCompletion() async throws {
        let suite = "CavePerformanceTests.animation.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let app = AppModel(defaults: defaults, restoreLocalState: false,
                           loadPersistedConnection: false, isPerformanceFixture: true,
                           performanceRecorder: CavePerformanceRecorder(enabled: true),
                           widgetSnapshotDefaults: defaults)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 400))
        window.rootViewController = UIHostingController(rootView: PerformanceDrawerAnimationProbe(app: app))
        window.isHidden = false
        window.layoutIfNeeded()
        defer { window.isHidden = true; app.performanceSpans.cancelAll() }
        // Mount before changing the observed value so this is an animated update.
        try await Task.sleep(for: .milliseconds(50))
        let clock = ContinuousClock()
        let start = clock.now
        app.navigationDrawerOpen = true
        XCTAssertFalse(app.drawerPresentationReady)
        let deadline = start.advanced(by: .seconds(3))
        while !app.drawerPresentationReady, clock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(app.drawerPresentationReady)
        XCTAssertGreaterThanOrEqual(start.duration(to: clock.now), .milliseconds(150))
        XCTAssertTrue(app.performanceSpans.isActive(.drawerOpen), "Animation completion still needs a presented frame")
        app.navigationDrawerOpen = false
        XCTAssertFalse(app.performanceSpans.isActive(.drawerOpen))
    }

    func testFixtureConnectionRecoveryPreservesSyntheticConnectedState() async {
        let suite = "CavePerformanceTests.recovery.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let app = AppModel(defaults: defaults, restoreLocalState: false,
                           loadPersistedConnection: false, isPerformanceFixture: true,
                           widgetSnapshotDefaults: defaults)
        CavePerformanceFixture.install(in: app)
        app.startConnectionSupervisor()
        await app.setConnectionSupervisorActive(true)
        app.requestConnectionRecovery(.foreground)
        await app.recoverConnectionInBackground()
        await app.refreshConnection()
        await app.connectWithRetry()
        XCTAssertEqual(app.connectionState, .connected)
        XCTAssertNil(app.connection)
        XCTAssertEqual(app.threads.count, CavePerformanceFixture.localChatCount)
    }

    func testFixtureThreadWritesUseInjectedStore() async throws {
        let suite = "CavePerformanceTests.store.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storeURL = directory.appendingPathComponent("threads.json")
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        let app = AppModel(defaults: defaults, restoreLocalState: false,
                           loadPersistedConnection: false, isPerformanceFixture: true,
                           threadStoreURL: storeURL, widgetSnapshotDefaults: defaults)
        app.threads = [CavePerformanceFixture.make().threads[0]]
        let saved = await app.flushThreadsAndWait()
        XCTAssertTrue(saved)
        let retained = try await ThreadSnapshotStore(url: storeURL).load()
        XCTAssertEqual(retained.map(\.id), app.threads.map(\.id))
    }
}
