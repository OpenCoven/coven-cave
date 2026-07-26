import Foundation
import OSLog

struct CavePerformanceSample: Equatable {
    var count: Int
    var latestMilliseconds: Double
    var maximumMilliseconds: Double
}

protocol CavePerformanceClock: Sendable {
    func now() -> Duration
}

struct ContinuousPerformanceClock: CavePerformanceClock {
    private let clock: ContinuousClock
    private let origin: ContinuousClock.Instant

    init(clock: ContinuousClock = ContinuousClock()) {
        self.clock = clock
        self.origin = clock.now
    }

    func now() -> Duration {
        origin.duration(to: clock.now)
    }
}

struct CavePerformanceInstrumentationRecord: Equatable {
    static let intervalName: StaticString = "Measure"

    let spanName: String
    let beginMessage: String
    let endMessage: String

    init(spanName: String) {
        self.spanName = spanName
        self.beginMessage = "span=\(spanName) phase=begin"
        self.endMessage = "span=\(spanName) phase=end"
    }
}

@MainActor
final class CavePerformanceRecorder {
    #if DEBUG
    private static let sharedEnabledByDefault = true
    #else
    private static let sharedEnabledByDefault = false
    #endif
    private static let defaultDistinctKeyLimit = 128

    static let shared = CavePerformanceRecorder(enabled: sharedEnabledByDefault)

    private final class Storage {
        private let sampleKeyLimit: Int
        private let counterKeyLimit: Int
        private var sampleInsertionOrder: [String] = []
        private var counterInsertionOrder: [String] = []
        var samples: [String: CavePerformanceSample] = [:]
        var counters: [String: Int] = [:]

        init(sampleKeyLimit: Int, counterKeyLimit: Int) {
            self.sampleKeyLimit = max(1, sampleKeyLimit)
            self.counterKeyLimit = max(1, counterKeyLimit)
        }

        func incrementCounter(named name: String, by amount: Int) {
            reserveKey(name,
                       values: &counters,
                       insertionOrder: &counterInsertionOrder,
                       limit: counterKeyLimit,
                       defaultValue: 0)
            counters[name, default: 0] += amount
        }

        func recordSample(named name: String, elapsed: Duration) {
            reserveKey(name,
                       values: &samples,
                       insertionOrder: &sampleInsertionOrder,
                       limit: sampleKeyLimit,
                       defaultValue: CavePerformanceSample(count: 0,
                                                           latestMilliseconds: 0,
                                                           maximumMilliseconds: 0))

            let milliseconds = elapsed.milliseconds
            var sample = samples[name] ?? CavePerformanceSample(count: 0,
                                                                latestMilliseconds: 0,
                                                                maximumMilliseconds: 0)
            sample.count += 1
            sample.latestMilliseconds = milliseconds
            sample.maximumMilliseconds = max(sample.maximumMilliseconds, milliseconds)
            samples[name] = sample
        }

        private func reserveKey<Value>(
            _ name: String,
            values: inout [String: Value],
            insertionOrder: inout [String],
            limit: Int,
            defaultValue: @autoclosure () -> Value
        ) {
            guard values[name] == nil else {
                return
            }

            if values.count >= limit, let evictedName = insertionOrder.first {
                insertionOrder.removeFirst()
                values.removeValue(forKey: evictedName)
            }

            insertionOrder.append(name)
            values[name] = defaultValue()
        }
    }

    private let storage: Storage?
    private let signposter: OSSignposter?

    var isEnabled: Bool {
        storage != nil
    }

    init(
        enabled: Bool = true,
        subsystem: String = "ai.opencoven.cave",
        category: String = "performance",
        sampleKeyLimit: Int = defaultDistinctKeyLimit,
        counterKeyLimit: Int = defaultDistinctKeyLimit
    ) {
        if enabled {
            storage = Storage(sampleKeyLimit: sampleKeyLimit, counterKeyLimit: counterKeyLimit)
            signposter = OSSignposter(subsystem: subsystem, category: category)
        } else {
            storage = nil
            signposter = nil
        }
    }

    func increment(_ name: String, by amount: Int = 1) {
        guard let storage else {
            return
        }

        storage.incrementCounter(named: name, by: amount)
    }

    func counter(_ name: String) -> Int {
        guard let storage else {
            return 0
        }

        return storage.counters[name, default: 0]
    }

    func snapshot() -> [String: CavePerformanceSample] {
        guard let storage else {
            return [:]
        }

        return storage.samples
    }

    func measure<T>(_ name: String, operation: () async throws -> T) async rethrows -> T {
        guard storage != nil, signposter != nil else {
            return try await operation()
        }

        return try await measure(name, clock: ContinuousPerformanceClock(), operation: operation)
    }

    func measure<T>(
        _ name: String,
        clock: some CavePerformanceClock,
        operation: () async throws -> T
    ) async rethrows -> T {
        guard let storage, let signposter else {
            return try await operation()
        }

        let instrumentation = CavePerformanceInstrumentationRecord(spanName: name)
        let start = clock.now()
        let intervalState = signposter.beginInterval(CavePerformanceInstrumentationRecord.intervalName,
                                                    "\(instrumentation.beginMessage, privacy: .public)")
        defer {
            record(storage, name: instrumentation.spanName, elapsed: clock.now() - start)
            signposter.endInterval(CavePerformanceInstrumentationRecord.intervalName,
                                   intervalState,
                                   "\(instrumentation.endMessage, privacy: .public)")
        }

        return try await operation()
    }

    private func record(_ storage: Storage, name: String, elapsed: Duration) {
        storage.recordSample(named: name, elapsed: elapsed)
    }
}

private extension Duration {
    var milliseconds: Double {
        let components = components
        let seconds = Double(components.seconds) * 1_000
        let attoseconds = Double(components.attoseconds) / 1_000_000_000_000_000
        return max(0, seconds + attoseconds)
    }
}
