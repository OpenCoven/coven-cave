import XCTest
import UIKit
import WebKit
import Vision
@testable import CovenCave

/// The reported native height must include the final line after WebKit reflow.
final class MarkdownPaintedReflowTests: XCTestCase {
    @MainActor
    func testWidthReflowKeepsTheLastLinePaintedInsideTheNativeBubble() async throws {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)
        defer { coordinator.invalidate() }
        let webView = coordinator.webView
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = true
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.frame = CGRect(x: 0, y: 0, width: 360, height: 200)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previousKeyWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 400, height: 800)
        window.windowLevel = .alert + 1
        window.backgroundColor = .black
        window.rootViewController = UIViewController()
        window.rootViewController!.view.backgroundColor = .black
        window.rootViewController!.view.addSubview(webView)
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            previousKeyWindow?.makeKey()
        }
        var reportedHeight: CGFloat = 0
        coordinator.onHeight = { height in
            reportedHeight = height
            webView.frame.size.height = height
        }
        let paragraph = "A wrapping paragraph with enough words to change height when its width changes."
        coordinator.apply(markdown: Array(repeating: paragraph, count: 3).joined(separator: "\n\n") + "\n\nBOTTOM ANCHOR ZEBRA",
                          streaming: false, fontScale: 1, theme: .dark, accentHex: nil, reader: false)
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(30))
        while recorder.snapshot()["markdown.render.settled"] == nil, clock.now < deadline {
            await Task.yield()
        }
        XCTAssertNotNil(recorder.snapshot()["markdown.render.settled"])
        let before = try await webView.callAsyncJavaScript(
            "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.ceil(document.body.getBoundingClientRect().height);",
            arguments: [:], in: nil, contentWorld: .page) as? Double
        let initial = try XCTUnwrap(before)
        // A blank snapshot is a harness failure, not evidence of clipping.
        var initialDrawn = ""
        let paintDeadline = clock.now.advanced(by: .seconds(10))
        while !initialDrawn.contains("bottom anchor zebra"), clock.now < paintDeadline {
            let initialImage = try await webView.takeSnapshot(configuration: nil)
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            try VNImageRequestHandler(cgImage: try XCTUnwrap(initialImage.cgImage)).perform([request])
            initialDrawn = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ").lowercased()
            await Task.yield()
        }
        XCTAssertTrue(initialDrawn.contains("bottom anchor zebra"), "initial native paint must be visible before exercising reflow")
        print("INITIAL PAINT \(initialDrawn)")
        webView.frame.size.width = 180
        let after = try await webView.callAsyncJavaScript(
            "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.ceil(document.body.getBoundingClientRect().height);",
            arguments: [:], in: nil, contentWorld: .page) as? Double
        let reflowed = try XCTUnwrap(after)
        XCTAssertGreaterThan(reflowed, initial + 60)
        let reportDeadline = clock.now.advanced(by: .seconds(3))
        while abs(Double(reportedHeight) - reflowed) > 0.5, clock.now < reportDeadline {
            await Task.yield()
        }
        let config = WKSnapshotConfiguration()
        config.rect = webView.bounds
        config.afterScreenUpdates = true
        let captured = try await webView.takeSnapshot(configuration: config)
        let snapshot = try XCTUnwrap(captured)
        let attachment = XCTAttachment(image: snapshot)
        attachment.name = "Native bubble after width reflow"
        attachment.lifetime = .keepAlways
        add(attachment)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try XCTUnwrap(snapshot.cgImage)).perform([request])
        let drawn = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ").lowercased()
        print("PAINTED REFLOW initial=\(initial) document=\(reflowed) native=\(reportedHeight) drawn=\(drawn)")
        XCTAssertTrue(drawn.contains("bottom anchor zebra"), "the last line is actually painted inside the native height, not clipped below it")
    }
}
