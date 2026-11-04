import Vision
import XCTest

/// #6090: the transcript moving away from the latest reply after the reader has
/// reached it. Accessibility frames report off-screen WebView content as
/// hittable, so every check reads what is actually drawn, from a screenshot.
final class ChatScrollBounceUITests: XCTestCase {
    private let bottomMarker = "bottom marker q3k9z"
    private let streamingTail = "tail q3k9z"
    private var tracePath = ""
    private var metricsPath = ""

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    override func tearDown() {
        let app = XCUIApplication()
        app.terminate()
        _ = app.wait(for: .notRunning, timeout: 5)
        if let trace = try? String(contentsOfFile: tracePath, encoding: .utf8) {
            print("=== SCROLL TRACE \(name) ===\n\(trace)\n=== END SCROLL TRACE ===")
        } else {
            print("=== SCROLL TRACE \(name): unavailable at \(tracePath) ===")
        }
        try? FileManager.default.removeItem(atPath: tracePath)
        try? FileManager.default.removeItem(atPath: metricsPath)
        super.tearDown()
    }

    private func launch(_ argument: String, thread: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        _ = app.wait(for: .notRunning, timeout: 5)
        tracePath = NSTemporaryDirectory() + "cave-scroll-trace-\(UUID().uuidString).log"
        app.launchArguments = [argument, "--performance-instrumentation"]
        if argument == "--ui-preview-large-rich-chat-scroll" {
            app.launchArguments.append("--timeline-performance-rich")
        }
        app.launchEnvironment["CAVE_OPEN_THREAD"] = thread
        app.launchEnvironment["CAVE_SCROLL_TRACE_PATH"] = tracePath
        metricsPath = NSTemporaryDirectory() + "cave-scroll-metrics-\(UUID().uuidString).json"
        app.launchEnvironment["CAVE_SCROLL_METRICS_PATH"] = metricsPath
        app.launch()
        return app
    }

    private func drawnText() -> String {
        guard let image = XCUIScreen.main.screenshot().image.cgImage else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try? VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
            .lowercased()
    }

    private func isDrawn(_ needle: String) -> Bool {
        drawnText().contains(needle)
    }

    private func waitUntilDrawn(_ needle: String, timeout: TimeInterval = 30) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if isDrawn(needle) { return true }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return false
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Finger moves slowly up, the way a reader drags while looking at the text.
    private func slowDragTowardLatest(_ transcript: XCUIElement) {
        let start = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        let end = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
    }

    /// Reach the needle using `step`, then require it to stay drawn while the
    /// reader does nothing. Losing it after arrival is the reported bounce.
    private func assertReturnsAndStays(_ needle: String, _ transcript: XCUIElement, attempts: Int,
                                       _ what: String, step: () -> Void) {
        var arrived = false
        for attempt in 0..<attempts {
            step()
            if isDrawn(needle) {
                print("=== \(what): arrived after \(attempt + 1) steps ===")
                arrived = true
                break
            }
        }
        attachScreenshot("\(what): arrival")
        XCTAssertTrue(arrived, "\(what): the reader can reach the latest reply")

        var lost = 0
        for sample in 0..<12 {
            Thread.sleep(forTimeInterval: 0.5)
            if !isDrawn(needle) {
                lost += 1
                attachScreenshot("\(what): lost at sample \(sample)")
            }
        }
        attachScreenshot("\(what): settled")
        XCTAssertEqual(lost, 0, "\(what): the latest reply stays on screen once reached")
    }

    private func openRich(_ argument: String, thread: String, needle: String) -> (XCUIApplication, XCUIElement) {
        let app = launch(argument, thread: thread)
        let transcript = app.scrollViews["Chat transcript"].firstMatch
        XCTAssertTrue(transcript.waitForExistence(timeout: 30), "the transcript opens")
        XCTAssertTrue(waitUntilDrawn(needle), "the transcript opens on the latest reply")
        return (app, transcript)
    }

    @MainActor
    func testFlickingBackToLatestStaysOnLatest() {
        let (_, transcript) = openRich("--ui-preview-rich-chat-scroll",
                                       thread: "ui-preview-rich-chat-scroll", needle: bottomMarker)
        for _ in 0..<6 { transcript.swipeDown() }
        XCTAssertFalse(isDrawn(bottomMarker), "the reader left the latest reply")
        assertReturnsAndStays(bottomMarker, transcript, attempts: 40, "Flick") {
            transcript.swipeUp()
        }
    }

    @MainActor
    func testSlowDragBackToLatestStaysOnLatest() {
        let (_, transcript) = openRich("--ui-preview-rich-chat-scroll",
                                       thread: "ui-preview-rich-chat-scroll", needle: bottomMarker)
        for _ in 0..<2 { transcript.swipeDown() }
        XCTAssertFalse(isDrawn(bottomMarker), "the reader left the latest reply")
        assertReturnsAndStays(bottomMarker, transcript, attempts: 60, "Slow drag") {
            self.slowDragTowardLatest(transcript)
        }
    }

    @MainActor
    func testSmallDragsAtLatestStayOnLatest() {
        let (_, transcript) = openRich("--ui-preview-rich-chat-scroll",
                                       thread: "ui-preview-rich-chat-scroll", needle: bottomMarker)
        func drag(from fromY: CGFloat, to toY: CGFloat) {
            let start = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: fromY))
            let end = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: toY))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        var lost = 0
        for pass in 0..<6 {
            // A nudge away with momentum can legitimately carry the marker off
            // screen with no layout change, so it is never sampled. Only the
            // pull back to the end is: nothing the reader did asks to leave it.
            if !pass.isMultiple(of: 2) { drag(from: 0.5, to: 0.53) }
            drag(from: 0.6, to: 0.5)
            for sample in 0..<3 {
                Thread.sleep(forTimeInterval: 0.5)
                if !isDrawn(bottomMarker) {
                    lost += 1
                    attachScreenshot("Small drag: lost at pass \(pass) sample \(sample)")
                }
            }
        }
        attachScreenshot("Small drag: settled")
        XCTAssertEqual(lost, 0, "small drags at the end of the transcript do not move it away")
    }

    @MainActor
    func testFlickingBackToStreamingReplyStaysOnLatest() {
        let (_, transcript) = openRich("--ui-preview-rich-streaming-chat-scroll",
                                       thread: "ui-preview-rich-streaming-chat-scroll", needle: streamingTail)
        for _ in 0..<4 { transcript.swipeDown() }
        XCTAssertFalse(isDrawn(streamingTail), "the reader left the latest reply")
        assertReturnsAndStays(streamingTail, transcript, attempts: 40, "Streaming flick") {
            transcript.swipeUp()
        }
    }

    @MainActor
    func testThousandMessageConversationKeepsRichRenderingBounded() {
        let (app, transcript) = openRich("--ui-preview-large-rich-chat-scroll",
            thread: "ui-preview-large-rich-chat-scroll", needle: bottomMarker)
        let capture = app.buttons["Capture timeline metrics"].firstMatch
        XCTAssertTrue(capture.waitForExistence(timeout: 5))
        var capturedCount = 0

        func captureAndCheck() {
            capture.tap()
            let expectedCount = capturedCount + 1
            let deadline = Date().addingTimeInterval(5)
            var capturedData: Data?
            var capturedSamples: [[String: Any]]?
            while Date() < deadline {
                if let data = try? Data(contentsOf: URL(fileURLWithPath: metricsPath)),
                   let report = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let samples = report["captures"] as? [[String: Any]], samples.count == expectedCount {
                    capturedData = data
                    capturedSamples = samples
                    break
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            guard let data = capturedData, let sample = capturedSamples?.last,
                  let attached = sample["attachedWebViews"] as? Int,
                  let counters = sample["counters"] as? [String: Int],
                  let created = counters["markdown.webview.created"],
                  let invalidated = counters["markdown.webview.invalidated"] else {
                XCTFail("real view-hierarchy and renderer ownership metrics must be captured")
                return
            }
            capturedCount = expectedCount
            XCTAssertEqual(sample["index"] as? Int, capturedCount - 1)
            XCTAssertEqual(sample["messageCount"] as? Int, 1_001)
            // A generous fixture guard, not a production memory-budget claim:
            // 500 historical rich replies must not create 500 resident WebViews.
            XCTAssertLessThanOrEqual(attached, 16)
            XCTAssertGreaterThan(attached, 0)
            XCTAssertGreaterThan(created, 0)
            XCTAssertGreaterThan(counters["markdown.webview.first-render"] ?? 0, 0)
            XCTAssertGreaterThanOrEqual(created - invalidated, 0)
            XCTAssertLessThanOrEqual(created - invalidated, 16)
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = "1,001-message renderer and app-footprint metrics"
            attachment.lifetime = .keepAlways
            add(attachment)
        }

        captureAndCheck()
        for _ in 0..<2 {
            for _ in 0..<4 { transcript.swipeDown() }
            captureAndCheck()
            let jump = app.buttons["Scroll to latest"].firstMatch
            XCTAssertTrue(jump.waitForExistence(timeout: 5))
            jump.tap()
            XCTAssertTrue(waitUntilDrawn(bottomMarker))
            captureAndCheck()
        }
        attachScreenshot("1,001-message conversation after revisiting history")
    }
}
