import XCTest
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

@MainActor
final class CavePerformanceTests: XCTestCase {
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
        XCTAssertTrue(CavePerformanceRecorder.shared.isEnabled)
        #else
        XCTAssertFalse(CavePerformanceRecorder.shared.isEnabled)
        #endif
    }

    func testInstrumentationRecordRetainsSuppliedSpanName() {
        let record = CavePerformanceInstrumentationRecord(spanName: "bootstrap")

        XCTAssertEqual(record.spanName, "bootstrap")
        XCTAssertEqual(record.beginMessage, "span=bootstrap phase=begin")
        XCTAssertEqual(record.endMessage, "span=bootstrap phase=end")
    }
}
