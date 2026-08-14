import XCTest
@testable import CovenCave

final class MarkdownRenderSignatureTests: XCTestCase {
    func testStyleOnlyChangesDoNotChangeRenderSignature() {
        let signature = MarkdownRenderSignature(markdown: "Hello", streaming: false, reader: true)
        let initialStyle = MarkdownStyleSignature(fontScale: 1, theme: .dark, accentHex: nil)
        let updatedStyle = MarkdownStyleSignature(fontScale: 1.25, theme: .sepia, accentHex: "#9386d0")

        XCTAssertEqual(signature, MarkdownRenderSignature(markdown: "Hello", streaming: false, reader: true))
        XCTAssertNotEqual(initialStyle, updatedStyle)
    }

    func testMarkdownChangeChangesRenderSignature() {
        XCTAssertNotEqual(
            MarkdownRenderSignature(markdown: "Before", streaming: false, reader: false),
            MarkdownRenderSignature(markdown: "After", streaming: false, reader: false)
        )
    }

    func testStreamingChangeChangesRenderSignature() {
        XCTAssertNotEqual(
            MarkdownRenderSignature(markdown: "Hello", streaming: true, reader: false),
            MarkdownRenderSignature(markdown: "Hello", streaming: false, reader: false)
        )
    }

    func testReaderChangeChangesRenderSignature() {
        XCTAssertNotEqual(
            MarkdownRenderSignature(markdown: "Hello", streaming: false, reader: true),
            MarkdownRenderSignature(markdown: "Hello", streaming: false, reader: false)
        )
    }

    @MainActor
    func testCoordinatorRecordsInitializationAndSkippedRender() async throws {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)

        coordinator.apply(
            markdown: "Hello",
            streaming: false,
            fontScale: 1,
            theme: .dark,
            accentHex: nil,
            reader: false
        )
        coordinator.apply(
            markdown: "Hello",
            streaming: false,
            fontScale: 1,
            theme: .dark,
            accentHex: nil,
            reader: false
        )

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(10))
        while recorder.snapshot()["markdown.webview.init"] == nil, clock.now < deadline {
            try await Task.sleep(for: .milliseconds(50))
        }

        let initialization = recorder.snapshot()["markdown.webview.init"]
        XCTAssertEqual(initialization?.count, 1)
        XCTAssertGreaterThanOrEqual(initialization?.latestMilliseconds ?? -1, 0)
        XCTAssertEqual(recorder.counter("markdown.render.skipped"), 1)
        print(
            "IOS_PERF markdown.webview.init.latest_ms=\(initialization?.latestMilliseconds ?? -1) " +
            "markdown.render.skipped=\(recorder.counter("markdown.render.skipped"))"
        )
        _ = coordinator.webView
    }

    @MainActor
    func testSettledRenderRecordsPerformanceSpan() async throws {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)

        coordinator.apply(
            markdown: "**Measured render**",
            streaming: false,
            fontScale: 1,
            theme: .dark,
            accentHex: nil,
            reader: false
        )

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(10))
        while recorder.snapshot()["markdown.render.settled"] == nil, clock.now < deadline {
            try await Task.sleep(for: .milliseconds(50))
        }

        let render = recorder.snapshot()["markdown.render.settled"]
        XCTAssertEqual(render?.count, 1)
        XCTAssertGreaterThanOrEqual(render?.latestMilliseconds ?? -1, 0)
        print("IOS_PERF markdown.render.settled.latest_ms=\(render?.latestMilliseconds ?? -1)")
        _ = coordinator.webView
    }

    @MainActor
    func testStreamingRenderRecordsPerformanceSpan() async throws {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)

        coordinator.apply(
            markdown: "Measured stream",
            streaming: true,
            fontScale: 1,
            theme: .dark,
            accentHex: nil,
            reader: false
        )

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(10))
        while recorder.snapshot()["markdown.render.streaming"] == nil, clock.now < deadline {
            try await Task.sleep(for: .milliseconds(50))
        }

        let render = recorder.snapshot()["markdown.render.streaming"]
        XCTAssertEqual(render?.count, 1)
        XCTAssertGreaterThanOrEqual(render?.latestMilliseconds ?? -1, 0)
        print("IOS_PERF markdown.render.streaming.latest_ms=\(render?.latestMilliseconds ?? -1)")
        _ = coordinator.webView
    }
}
