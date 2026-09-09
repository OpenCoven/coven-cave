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
    func testTransientStreamingFailureCanRecoverWithSettledRender() async throws {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)
        // A real render needs a visible, sized web view. An unattached zero-size
        // view can defer WebContent startup on a cold CI simulator.
        let host = UIViewController()
        host.view = coordinator.webView
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 480))
        window.rootViewController = host
        window.isHidden = false
        host.view.layoutIfNeeded()
        defer {
            coordinator.invalidate()
            window.isHidden = true
            window.rootViewController = nil
        }
        let clock = ContinuousClock()
        let readyDeadline = clock.now.advanced(by: .seconds(30))
        var rendererReady = false
        while !rendererReady, clock.now < readyDeadline {
            rendererReady = (try? await coordinator.webView.evaluateJavaScript(
                "typeof window.caveRender === 'function'"
            )) as? Bool == true
            if !rendererReady { try await Task.sleep(for: .milliseconds(10)) }
        }
        XCTAssertTrue(rendererReady, "The bundled renderer must load before injecting a transient failure")
        guard rendererReady else { return }
        _ = try await coordinator.webView.evaluateJavaScript("""
            window.caveRender = async function(md, opts) {
                if (opts.streaming) throw new Error('transient streaming render');
                document.body.innerHTML = '<p>Settled response</p>';
                document.body.style.height = '100px';
            }; true;
            """)
        var failures = 0
        coordinator.onFailure = { failures += 1 }
        coordinator.apply(markdown: "Partial", streaming: true,
                          fontScale: 1, theme: .dark, accentHex: nil, reader: false)
        let streamDeadline = clock.now.advanced(by: .seconds(5))
        while recorder.snapshot()["markdown.render.streaming"] == nil, clock.now < streamDeadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        await drainMainQueue()
        XCTAssertEqual(recorder.snapshot()["markdown.render.streaming"]?.count, 1)
        XCTAssertEqual(failures, 0, "A streaming rejection must not trigger terminal fallback")

        var settledHeight: CGFloat?
        coordinator.onHeight = { settledHeight = $0 }
        coordinator.apply(markdown: "Complete", streaming: false,
                          fontScale: 1, theme: .dark, accentHex: nil, reader: false)
        let settledDeadline = clock.now.advanced(by: .seconds(5))
        while recorder.snapshot()["markdown.render.settled"] == nil, clock.now < settledDeadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        await drainMainQueue()
        XCTAssertEqual(recorder.snapshot()["markdown.render.settled"]?.count, 1)
        XCTAssertGreaterThan(settledHeight ?? 0, 0)
        XCTAssertEqual(failures, 0)
    }

    @MainActor
    func testSwiftUIUnmountCallsProductionDismantle() throws {
        let clock = ContinuousClock()
        weak var observed: MarkdownWebView.Coordinator?
        weak var observedWebView: WKWebView?
        var mountedWindow: UIWindow?
        defer {
            mountedWindow?.isHidden = true
            mountedWindow?.rootViewController = nil
        }
        // Drain UIKit/SwiftUI's autoreleased graph references before checking
        // deallocation, without disposing the hosting controller or its window.
        let host = try autoreleasepool {
            let state = MountedState()
            let host = UIHostingController(rootView: MountedRow(state: state))
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 480))
            mountedWindow = window
            window.rootViewController = host
            window.isHidden = false
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            let mountDeadline = clock.now.advanced(by: .seconds(5))
            while findWebView(in: host.view) == nil, clock.now < mountDeadline {
                RunLoop.main.run(until: Date().addingTimeInterval(0.01))
                host.view.layoutIfNeeded()
            }
            let webView = try XCTUnwrap(findWebView(in: host.view))
            observedWebView = webView
            let coordinator = try XCTUnwrap(
                webView.navigationDelegate as? MarkdownWebView.Coordinator
            )
            observed = coordinator
            state.mounted = false
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            let unmountDeadline = clock.now.advanced(by: .seconds(5))
            while !coordinator.isInvalidated, clock.now < unmountDeadline {
                RunLoop.main.run(until: Date().addingTimeInterval(0.01))
                host.view.layoutIfNeeded()
            }
            XCTAssertTrue(coordinator.isInvalidated)
            XCTAssertNil(webView.navigationDelegate)
            return host
        }
        let releaseDeadline = clock.now.advanced(by: .seconds(5))
        while observed != nil || observedWebView != nil, clock.now < releaseDeadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.01))
        }
        withExtendedLifetime(host) {
            XCTAssertNil(observed, "The removed SwiftUI row must release its coordinator")
            XCTAssertNil(observedWebView, "The removed SwiftUI row must release its web view")
        }
    }

    @MainActor
    private final class MountedState: ObservableObject {
        @Published var mounted = true
    }

    @MainActor
    private struct MountedRow: View {
        @ObservedObject var state: MountedState

        var body: some View {
            // Remove a row from a live graph. Replacing the hosting controller's
            // root instead can retain the retired graph until host teardown.
            if state.mounted {
                MarkdownWebView(markdown: "Lifecycle probe", height: .constant(100))
            }
        }
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
