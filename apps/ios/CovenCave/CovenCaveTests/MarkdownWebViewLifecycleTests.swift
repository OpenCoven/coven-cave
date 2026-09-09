import SwiftUI
import WebKit
import XCTest
@testable import CovenCave

final class MarkdownWebViewLifecycleTests: XCTestCase {
    @MainActor
    func testRegisteredHandlerDoesNotRetainCoordinator() {
        // Keep WebKit/configuration alive deliberately. Before the weak
        // forwarding handler this leaves the coordinator retained.
        autoreleasepool {
            var coordinator: MarkdownWebView.Coordinator? = .init()
            weak var observed = coordinator
            let webView = coordinator!.webView
            coordinator = nil
            XCTAssertNil(observed, "The script-handler back-reference must be weak")
            webView.stopLoading()
            webView.configuration.userContentController.removeScriptMessageHandler(forName: "cave")
        }
    }

    @MainActor
    func testDismantleIsIdempotentAndClearsCallbacks() {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)
        coordinator.onHeight = { _ in XCTFail("Disposed renderer published height") }
        coordinator.onHeadings = { _ in XCTFail("Disposed renderer published headings") }
        coordinator.onFailure = { XCTFail("Disposed renderer published failure") }

        MarkdownWebView.dismantleUIView(coordinator.webView, coordinator: coordinator)
        MarkdownWebView.dismantleUIView(coordinator.webView, coordinator: coordinator)

        XCTAssertTrue(coordinator.isInvalidated)
        XCTAssertNil(coordinator.webView.navigationDelegate)
        XCTAssertNil(coordinator.webView.uiDelegate)
        XCTAssertNil(coordinator.onHeight)
        XCTAssertNil(coordinator.onHeadings)
        XCTAssertNil(coordinator.onFailure)
        XCTAssertEqual(recorder.snapshot()["markdown.webview.init"]?.count, 1)
    }

    @MainActor
    func testLateReadyAndApplyCannotReviveDisposedRenderer() async {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)
        coordinator.apply(markdown: "Pending", streaming: true,
                          fontScale: 1, theme: .dark, accentHex: nil, reader: false)
        coordinator.invalidate()
        coordinator.webView(coordinator.webView, didFinish: nil)
        coordinator.apply(markdown: "Late", streaming: false,
                          fontScale: 1, theme: .dark, accentHex: nil, reader: false)
        coordinator.applyScroll(.init(index: 0, token: 1))
        coordinator.setScrollable(true)
        await drainMainQueue()

        XCTAssertTrue(coordinator.isInvalidated)
        XCTAssertFalse(coordinator.webView.scrollView.isScrollEnabled)
        XCTAssertNil(recorder.snapshot()["markdown.render.streaming"])
        XCTAssertNil(recorder.snapshot()["markdown.render.settled"])
    }

    @MainActor
    func testQueuedFailureIsSuppressedAfterDismantle() async {
        let coordinator = MarkdownWebView.Coordinator()
        var failures = 0
        coordinator.onFailure = { failures += 1 }
        coordinator.webViewWebContentProcessDidTerminate(coordinator.webView)
        coordinator.invalidate()
        await drainMainQueue()
        XCTAssertEqual(failures, 0)
    }

    @MainActor
    func testWebContentTerminationReportsOnceAndCannotRestartRendering() async {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)
        defer { coordinator.invalidate() }
        var failures = 0
        coordinator.onFailure = { failures += 1 }
        coordinator.webViewWebContentProcessDidTerminate(coordinator.webView)
        coordinator.webViewWebContentProcessDidTerminate(coordinator.webView)
        // A ready callback already queued by WebKit must not clear failure.
        coordinator.webView(coordinator.webView, didFinish: nil)
        coordinator.apply(markdown: "Complete source stays with the caller",
                          streaming: false, fontScale: 1, theme: .dark,
                          accentHex: nil, reader: false)
        await drainMainQueue()

        XCTAssertEqual(failures, 1)
        XCTAssertNil(recorder.snapshot()["markdown.render.settled"])
        XCTAssertNil(recorder.snapshot()["markdown.render.streaming"])
    }

    @MainActor
    func testRepeatedTeardownDoesNotAccumulateCoordinators() {
        for _ in 0..<100 {
            autoreleasepool {
                var coordinator: MarkdownWebView.Coordinator? = .init()
                weak var observed = coordinator
                let webView = coordinator!.webView
                MarkdownWebView.dismantleUIView(webView, coordinator: coordinator!)
                coordinator = nil
                XCTAssertNil(observed)
                XCTAssertNil(webView.navigationDelegate)
            }
        }
    }

    @MainActor
    func testSwiftUIUnmountCallsProductionDismantle() async throws {
        var host: UIHostingController<AnyView>? = UIHostingController(rootView: AnyView(
            MarkdownWebView(markdown: "Lifecycle probe", height: .constant(100))
        ))
        var window: UIWindow? = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 480))
        window?.rootViewController = host
        window?.isHidden = false
        let hostingView = try XCTUnwrap(host?.view)
        hostingView.setNeedsLayout()
        hostingView.layoutIfNeeded()
        let clock = ContinuousClock()
        let mountDeadline = clock.now.advanced(by: .seconds(5))
        while findWebView(in: hostingView) == nil, clock.now < mountDeadline {
            try await Task.sleep(for: .milliseconds(10))
            hostingView.layoutIfNeeded()
        }
        let webView = try XCTUnwrap(findWebView(in: hostingView))
        var coordinator: MarkdownWebView.Coordinator? = try XCTUnwrap(
            webView.navigationDelegate as? MarkdownWebView.Coordinator
        )
        weak var observed = coordinator

        host?.rootView = AnyView(EmptyView())
        hostingView.setNeedsLayout()
        hostingView.layoutIfNeeded()
        let unmountDeadline = clock.now.advanced(by: .seconds(5))
        while coordinator?.isInvalidated == false, clock.now < unmountDeadline {
            try await Task.sleep(for: .milliseconds(10))
            hostingView.layoutIfNeeded()
        }
        XCTAssertEqual(coordinator?.isInvalidated, true)
        XCTAssertNil(webView.navigationDelegate)
        coordinator = nil
        window?.isHidden = true
        window?.rootViewController = nil
        window = nil
        host = nil
        await drainMainQueue()
        let releaseDeadline = clock.now.advanced(by: .seconds(5))
        while observed != nil, clock.now < releaseDeadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertNil(observed, "The removed SwiftUI row must release its coordinator")
    }

    @MainActor
    private func drainMainQueue() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { continuation.resume() }
        }
    }

    @MainActor
    private func findWebView(in view: UIView) -> WKWebView? {
        if let webView = view as? WKWebView { return webView }
        for subview in view.subviews {
            if let result = findWebView(in: subview) { return result }
        }
        return nil
    }
}
