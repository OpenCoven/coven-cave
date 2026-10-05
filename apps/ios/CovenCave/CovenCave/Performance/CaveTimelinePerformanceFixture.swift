import Foundation
import UIKit
import WebKit

/// Offline, opt-in workload. Metrics contain no response text or user data.
@MainActor
enum CaveTimelinePerformanceFixture {
    enum Shape: String, CaseIterable { case mixed, rich }

    static var shape: Shape {
        ProcessInfo.processInfo.arguments.contains("--timeline-performance-rich") ? .rich : .mixed
    }

    static var isEnabled: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        return CavePerformanceFixture.shouldEnable(arguments: arguments)
            && arguments.contains("--timeline-performance-fixture")
    }

    static var count: Int {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--timeline-performance-count"),
              arguments.indices.contains(index + 1), let value = Int(arguments[index + 1]) else { return ActivityFold.maxSteps }
        return min(ActivityFold.maxSteps, max(1, value))
    }

    static func message(from original: DisplayMessage, count: Int, shape: Shape = .mixed) -> DisplayMessage {
        var message = original
        message.streaming = false
        message.text = shape == .rich ? "**Timeline fixture start.**\n\n" : "Timeline fixture start.\n\n"
        message.activity = []
        let producer = ToolActivity.Producer(harness: "hermes", version: nil, protocol: "responses")
        for index in 0..<count {
            let id = "timeline-call-\(index)"
            message.activity?.append(ActivityStep(
                id: id, kind: .tool, title: "Read", detail: "fixture-\(index).txt", status: .ok, durationMs: 42,
                activity: ToolActivity(
                    schemaVersion: 1, runId: "57610000-0000-4000-8000-000000000003",
                    attemptId: "57610000-0000-4000-8000-000000000004", callId: id, phase: "ok",
                    source: "runtime-report", producer: producer, firstObservedAt: 100 + index,
                    sequence: index, updatedAt: 200 + index, executionObservedAt: 100 + index,
                    terminalObservedAt: 200 + index,
                    authority: ["binding": "unavailable", "approval": "unavailable", "effect": "unavailable"]
                ), textOffset: message.text.utf16.count
            ))
            message.text += shape == .rich || index.isMultiple(of: 10)
                ? "**Timeline item \(index)** with `inline code`.\n\n"
                : "Timeline item \(index): the synthetic file was read.\n\n"
        }
        message.text += "[Timeline fixture tail](https://example.com/timeline-tail)"
        return message
    }

    private static var captures: [[String: Any]] = []

    static func capture(threadID: String, expandedCount: Int, recorder: CavePerformanceRecorder) {
        guard isEnabled else { return }
        func countWebViews(_ view: UIView) -> Int {
            if view is WKWebView { return 1 }
            return view.subviews.reduce(0) { $0 + countWebViews($1) }
        }
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        let counters = ["markdown.webview.created", "markdown.webview.invalidated", "markdown.webview.first-render", "markdown.webview.failed"]
        captures.append([
            "index": captures.count, "unixSeconds": Date().timeIntervalSince1970,
            "threadID": threadID, "activityCount": count, "shape": shape.rawValue, "expandedCount": expandedCount,
            "attachedWebViews": windows.reduce(0) { $0 + countWebViews($1) },
            "appPhysicalFootprintBytes": CavePerformanceFixture.physicalFootprint() as Any? ?? NSNull(),
            "counters": Dictionary(uniqueKeysWithValues: counters.map { ($0, recorder.counter($0)) }),
            "spans": recorder.snapshot().mapValues {
                ["count": Double($0.count), "latestMilliseconds": $0.latestMilliseconds, "maximumMilliseconds": $0.maximumMilliseconds]
            },
        ])
        do {
            let directory = CavePerformanceFixture.threadStoreURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: [
                "scope": "Offline fixture; footprint is app process only, excludes WebKit processes. Reopen is same-process navigation, not network/history reload.",
                "captures": captures,
            ], options: [.prettyPrinted, .sortedKeys])
            try data.write(to: directory.appendingPathComponent("timeline-metrics.json"), options: .atomic)
        } catch {
            assertionFailure("Unable to save synthetic timeline metrics")
        }
    }
}
