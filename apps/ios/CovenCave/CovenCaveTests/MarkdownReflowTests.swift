import XCTest
import UIKit
import WebKit
@testable import CovenCave

/// Native auto-height bubbles must follow WebKit reflow without a new render.
final class MarkdownReflowTests: XCTestCase {
    @MainActor
    func testWidthReflowPublishesTheNewNativeHeightWithoutRenderingAgain() async throws {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)
        defer { coordinator.invalidate() }
        let webView = coordinator.webView
        webView.frame = CGRect(x: 0, y: 0, width: 360, height: 200)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        window.rootViewController = UIViewController()
        window.rootViewController!.view.addSubview(webView)
        window.isHidden = false
        defer { window.isHidden = true }
        var reportedHeight: CGFloat = 0
        coordinator.onHeight = { reportedHeight = $0 }
        coordinator.apply(markdown: Array(repeating: "A wrapping paragraph with enough words to change height when its width changes.", count: 12).joined(separator: "\n\n"),
                          streaming: false, fontScale: 1, theme: .dark, accentHex: nil, reader: false)
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(30))
        while recorder.snapshot()["markdown.render.settled"] == nil, clock.now < deadline {
            await Task.yield()
        }
        XCTAssertNotNil(recorder.snapshot()["markdown.render.settled"])
        // Drain the render's two-frame report before changing only native width.
        let before = try await webView.callAsyncJavaScript("await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.ceil(document.body.getBoundingClientRect().height);", arguments: [:], in: nil, contentWorld: .page) as? Double
        let initial = try XCTUnwrap(before)
        XCTAssertGreaterThan(initial, 0)
        let renderCount = recorder.snapshot()["markdown.render.settled"]?.count
        webView.frame.size.width = 180
        let after = try await webView.callAsyncJavaScript("await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.ceil(document.body.getBoundingClientRect().height);", arguments: [:], in: nil, contentWorld: .page) as? Double
        let reflowed = try XCTUnwrap(after)
        XCTAssertGreaterThan(reflowed, initial + 100, "the real bundled document actually reflowed")
        let reportDeadline = clock.now.advanced(by: .seconds(3))
        while abs(Double(reportedHeight) - reflowed) > 0.5, clock.now < reportDeadline {
            await Task.yield()
        }
        print("REFLOW initial=\(initial) document=\(reflowed) native=\(reportedHeight)")
        XCTAssertEqual(Double(reportedHeight), reflowed, accuracy: 0.5,
                       "the bubble must receive the new document height after width-only reflow")
        XCTAssertEqual(recorder.snapshot()["markdown.render.settled"]?.count, renderCount,
                       "height recovery does not require re-rendering the same markdown")
    }
}
