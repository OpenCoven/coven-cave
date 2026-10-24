import SwiftUI
import WebKit
import XCTest
@testable import CovenCave

final class MarkdownWebViewLifecycleTests: XCTestCase {
    @MainActor
    func testInlineImageZoomUsesBoundedDownsampling() async throws {
        try await assertInlineDownsampling(prefix: "data:image/png;base64,")
    }

    @MainActor
    func testMixedCaseDataURLUsesBoundedDownsampling() async throws {
        try await assertInlineDownsampling(prefix: "DATA:IMAGE/PNG;base64,")
    }

    @MainActor
    private func assertInlineDownsampling(prefix: String) async throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let source = UIGraphicsImageRenderer(size: CGSize(width: 5000, height: 1), format: format).image { context in
            UIColor.black.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 5000, height: 1))
        }
        let data = try XCTUnwrap(source.pngData())
        let coordinator = MarkdownWebView.Coordinator()
        defer { coordinator.invalidate() }
        let presented = expectation(description: "Inline zoom presents a bounded native image")
        let token = NotificationCenter.default.addObserver(forName: .caveZoomContent, object: nil, queue: .main) { note in
            guard let target = note.object as? ZoomTarget, case .image(let image) = target.content else {
                XCTFail("Expected a native image")
                presented.fulfill()
                return
            }
            XCTAssertLessThanOrEqual(image.cgImage?.width ?? Int.max, 4096)
            presented.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(token) }
        coordinator.presentImage(src: prefix + data.base64EncodedString(), fallbackHTML: "")
        await fulfillment(of: [presented], timeout: 5)
    }

    @MainActor
    func testInlineImageFailureDoesNotRenderUnboundedFallback() async {
        let coordinator = MarkdownWebView.Coordinator()
        defer { coordinator.invalidate() }
        let presented = expectation(description: "Unsupported image has a safe error")
        let unsafeHTML = "<img src='https://example.invalid/unbounded.png'>"
        let token = NotificationCenter.default.addObserver(forName: .caveZoomContent, object: nil, queue: .main) { note in
            guard let target = note.object as? ZoomTarget, case .html(let html) = target.content else {
                XCTFail("Expected a static failure message")
                presented.fulfill()
                return
            }
            XCTAssertFalse(html.contains("<img"))
            XCTAssertFalse(html.contains("example.invalid"))
            XCTAssertTrue(html.contains("Couldn't open"))
            presented.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(token) }
        coordinator.presentImage(src: "file:///private/unsupported.png", fallbackHTML: unsafeHTML)
        await fulfillment(of: [presented], timeout: 5)
    }

    @MainActor
    func testInvalidatingOwnerCancelsPendingImagePresentation() async {
        let coordinator = MarkdownWebView.Coordinator()
        let presented = expectation(description: "Disposed owner must not open zoom")
        presented.isInverted = true
        let token = NotificationCenter.default.addObserver(forName: .caveZoomContent, object: nil, queue: .main) { _ in
            presented.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(token) }
        coordinator.presentImage(src: "data:image/png;base64,broken", fallbackHTML: "<img src='unbounded'>")
        coordinator.invalidate()
        await fulfillment(of: [presented], timeout: 0.2)
    }

    @MainActor
    func testAuthorityChangeCancelsPendingImagePresentation() async {
        let coordinator = MarkdownWebView.Coordinator()
        defer { coordinator.invalidate() }
        let presented = expectation(description: "Old authority must not open zoom")
        presented.isInverted = true
        let token = NotificationCenter.default.addObserver(forName: .caveZoomContent, object: nil, queue: .main) { _ in
            presented.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(token) }
        coordinator.presentImage(src: "data:image/png;base64,broken", fallbackHTML: "")
        NotificationCenter.default.post(name: .caveImageAuthorityChanged, object: nil)
        await fulfillment(of: [presented], timeout: 0.2)
    }

    @MainActor
    func testAuthorityChangeRejectsQueuedImageBridgeMessage() async {
        let coordinator = MarkdownWebView.Coordinator()
        defer { coordinator.invalidate() }
        let presented = expectation(description: "Queued old-authority message must not open zoom")
        presented.isInverted = true
        let token = NotificationCenter.default.addObserver(forName: .caveZoomContent, object: nil, queue: .main) { _ in
            presented.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(token) }
        coordinator.enqueueScriptBody(["type": "enlarge", "kind": "image", "src": "file:///unsupported.png"])
        NotificationCenter.default.post(name: .caveImageAuthorityChanged, object: nil)
        await fulfillment(of: [presented], timeout: 0.2)
    }

    @MainActor
    func testRapidReplacementPresentsOnlyTheLastImage() async throws {
        let coordinator = MarkdownWebView.Coordinator()
        defer { coordinator.invalidate() }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8), format: format).image { context in
            UIColor.black.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        let source = "data:image/png;base64," + (try XCTUnwrap(image.pngData())).base64EncodedString()
        let presented = expectation(description: "Only the final tap presents")
        var count = 0
        let token = NotificationCenter.default.addObserver(forName: .caveZoomContent, object: nil, queue: .main) { note in
            count += 1
            guard let target = note.object as? ZoomTarget, case .image = target.content else {
                XCTFail("A replaced image failure must not present")
                presented.fulfill()
                return
            }
            presented.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(token) }
        for _ in 0..<30 {
            coordinator.presentImage(src: "file:///unsupported.png", fallbackHTML: "")
        }
        coordinator.presentImage(src: source, fallbackHTML: "")
        await fulfillment(of: [presented], timeout: 5)
        await drainMainQueue()
        XCTAssertEqual(count, 1)
    }

    @MainActor
    func testContentReplacementRejectsQueuedImageBridgeMessage() async {
        let coordinator = MarkdownWebView.Coordinator()
        defer { coordinator.invalidate() }
        coordinator.apply(markdown: "Old message", streaming: false, fontScale: 1,
                          theme: .dark, accentHex: nil, reader: false)
        let presented = expectation(description: "A queued tap from replaced content must not open zoom")
        presented.isInverted = true
        let token = NotificationCenter.default.addObserver(forName: .caveZoomContent, object: nil, queue: .main) { _ in
            presented.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(token) }
        coordinator.enqueueScriptBody(["type": "enlarge", "kind": "image", "src": "file:///old-image.png"])
        coordinator.apply(markdown: "Replacement message", streaming: false, fontScale: 1,
                          theme: .dark, accentHex: nil, reader: false)
        await fulfillment(of: [presented], timeout: 0.2)
    }

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
        XCTAssertEqual(recorder.counter("markdown.webview.created"), 1)
        XCTAssertEqual(recorder.counter("markdown.webview.invalidated"), 1,
                       "repeated teardown must not undercount active renderer ownership")
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
    func testRepeatedTeardownDoesNotAccumulateCoordinators() async throws {
        // Bound in-flight WebKit startups while retaining all 100 lifetime
        // checks. Swift deallocation does not finish asynchronous process startup.
        for _ in 0..<10 {
            var coordinators: [MarkdownWebView.Coordinator?] = autoreleasepool {
                (0..<10).map { _ in MarkdownWebView.Coordinator() }
            }
            defer { coordinators.forEach { $0?.invalidate() } }
            for index in coordinators.indices {
                weak var observed = coordinators[index]
                let webView = coordinators[index]!.webView
                try await waitForRenderer(webView)
                autoreleasepool {
                    MarkdownWebView.dismantleUIView(webView, coordinator: coordinators[index]!)
                    coordinators[index] = nil
                    XCTAssertNil(observed)
                    XCTAssertNil(webView.navigationDelegate)
                }
            }
        }
    }

    @MainActor
    private func waitForRenderer(_ webView: WKWebView) async throws {
        let loaded = expectation(description: "Bundled renderer navigation completed")
        var completed = false
        let observation = webView.observe(\.isLoading, options: [.initial, .new]) { view, change in
            if change.newValue == false, view.url?.isFileURL == true, !completed {
                completed = true
                loaded.fulfill()
            }
        }
        await fulfillment(of: [loaded], timeout: 30)
        observation.invalidate()
        guard completed else {
            throw NSError(domain: "RendererReadiness", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Navigation did not finish: \(String(describing: webView.url))"])
        }
        let evaluated = expectation(description: "Bundled renderer script is ready")
        var ready = false
        var diagnostic = "JavaScript readiness callback did not complete"
        webView.evaluateJavaScript("""
            JSON.stringify({ready: typeof window.caveRender === 'function', url: location.href,
                            state: document.readyState, scripts: document.scripts.length,
                            errors: window.__caveTestErrors})
            """) { result, error in
            diagnostic = error.map { String(describing: $0) } ?? String(describing: result)
            if let json = result as? String,
               let data = json.data(using: .utf8),
               let state = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                ready = state["ready"] as? Bool == true
            }
            evaluated.fulfill()
        }
        await fulfillment(of: [evaluated], timeout: 5)
        XCTAssertTrue(ready, "The bundled renderer must be ready before proceeding: \(diagnostic)")
        guard ready else { throw NSError(domain: "RendererReadiness", code: 2) }
    }

    @MainActor
    func testTransientStreamingFailureCanRecoverWithSettledRender() async throws {
        let recorder = CavePerformanceRecorder(enabled: true)
        let coordinator = MarkdownWebView.Coordinator(performanceRecorder: recorder)
        coordinator.webView.configuration.userContentController.addUserScript(WKUserScript(source: """
            window.__caveTestErrors = [];
            window.addEventListener('error', event => window.__caveTestErrors.push(event.message));
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // A real render needs a visible, sized web view. An unattached zero-size
        // view can defer WebContent startup on a cold CI simulator.
        let host = UIViewController()
        host.view = coordinator.webView
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previousKeyWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 480)
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        defer {
            coordinator.invalidate()
            window.isHidden = true
            window.rootViewController = nil
            previousKeyWindow?.makeKeyAndVisible()
        }
        try await waitForRenderer(coordinator.webView)
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
        let streamingCompleted = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            // XCTest may evaluate predicates off the actor; read the recorder
            // on its owning actor without a handwritten polling/sleep loop.
            let completed: @MainActor () -> Bool = {
                recorder.snapshot()["markdown.render.streaming"]?.count == 1
            }
            if Thread.isMainThread { return MainActor.assumeIsolated { completed() } }
            return DispatchQueue.main.sync { MainActor.assumeIsolated { completed() } }
        }, object: nil)
        await fulfillment(of: [streamingCompleted], timeout: 5)
        await drainMainQueue()
        XCTAssertEqual(recorder.snapshot()["markdown.render.streaming"]?.count, 1)
        XCTAssertEqual(failures, 0, "A streaming rejection must not trigger terminal fallback")

        var settledHeight: CGFloat?
        let settled = expectation(description: "Settled render completed after streaming rejection")
        coordinator.onHeight = {
            if settledHeight == nil { settled.fulfill() }
            settledHeight = $0
        }
        coordinator.apply(markdown: "Complete", streaming: false,
                          fontScale: 1, theme: .dark, accentHex: nil, reader: false)
        await fulfillment(of: [settled], timeout: 5)
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
