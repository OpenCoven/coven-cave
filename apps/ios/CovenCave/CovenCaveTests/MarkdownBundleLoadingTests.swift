import UIKit
import WebKit
import XCTest
@testable import CovenCave

final class MarkdownBundleLoadingTests: XCTestCase {
    func testPackagedStartupBundleExcludesDiagramPayload() throws {
        let html = try XCTUnwrap(Bundle.main.url(forResource: "markdown", withExtension: "html"))
        let bytes = try Data(contentsOf: html).count
        XCTAssertLessThan(bytes, 512 * 1024)
        let diagram = try XCTUnwrap(Bundle.main.url(forResource: "markdown-mermaid", withExtension: "js"))
        XCTAssertGreaterThan(try Data(contentsOf: diagram).count, 0)
    }

    @MainActor
    func testDiagramEngineLoadsOnlyForSettledDiagramsAndIsReused() async throws {
        let coordinator = MarkdownWebView.Coordinator()
        let window = mount(coordinator.webView)
        defer { unmount(window, coordinator: coordinator) }
        try await waitUntilReady(coordinator.webView)

        let webView = coordinator.webView
        let prose = try await webView.callAsyncJavaScript("""
            await window.caveRender('**Hello**\\n\\n```swift\\nlet value = 1\\n```');
            return !!document.querySelector('strong') &&
                !!document.querySelector('code .hljs-keyword') &&
                typeof window.caveMermaid === 'undefined' &&
                document.querySelectorAll('script[src]').length === 0;
            """, arguments: [:], contentWorld: .page)
        XCTAssertEqual(prose as? Bool, true, "Ordinary formatted replies must not load diagram code")

        let diagram = "```mermaid\nflowchart LR\nA --> B\n```"
        let streaming = try await webView.callAsyncJavaScript("""
            await window.caveRender(md, {streaming: true});
            return document.getElementById('root').textContent.includes('rendering on completion') &&
                typeof window.caveMermaid === 'undefined' &&
                document.querySelectorAll('script[src]').length === 0;
            """, arguments: ["md": diagram], contentWorld: .page)
        XCTAssertEqual(streaming as? Bool, true, "Incomplete diagrams must remain lightweight")

        let settled = try await webView.callAsyncJavaScript("""
            await window.caveRender(md, {streaming: false});
            return !!document.querySelector('.cm-mermaid-diagram svg') &&
                document.querySelectorAll('script[src$="markdown-mermaid.js"]').length === 1;
            """, arguments: ["md": diagram], contentWorld: .page)
        XCTAssertEqual(settled as? Bool, true, "The bundled local script must render a real SVG")

        let repeated = try await webView.callAsyncJavaScript("""
            const plugin = window.caveMermaid;
            await window.caveRender(md, {reader: true, theme: 'sepia'});
            return plugin === window.caveMermaid &&
                !!document.querySelector('.cm-mermaid-diagram svg') &&
                document.querySelectorAll('script[src$="markdown-mermaid.js"]').length === 1;
            """, arguments: ["md": diagram], contentWorld: .page)
        XCTAssertEqual(repeated as? Bool, true, "Reader rerenders must reuse the loaded engine")
    }

    @MainActor
    func testMissingDiagramResourceReportsFailureAndPreservesReadableSource() async throws {
        let coordinator = MarkdownWebView.Coordinator()
        let window = mount(coordinator.webView)
        defer { unmount(window, coordinator: coordinator) }
        try await waitUntilReady(coordinator.webView)

        _ = try await coordinator.webView.evaluateJavaScript("""
            const append = document.head.appendChild.bind(document.head);
            document.head.appendChild = function(node) {
                if (node.tagName === 'SCRIPT') node.src = 'missing-diagram-test.js';
                return append(node);
            }; true;
            """)
        var failures = 0
        coordinator.onFailure = { failures += 1 }
        let markdown = "```mermaid\nflowchart LR\nA --> B\n```"
        coordinator.apply(markdown: markdown, streaming: false,
                          fontScale: 1, theme: .dark, accentHex: nil, reader: false)

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(5))
        while failures == 0, clock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(failures, 1, "Resource failure must reach the native readable fallback")
        let visible = try await coordinator.webView.evaluateJavaScript(
            "document.getElementById('root').textContent"
        )
        XCTAssertEqual(visible as? String, markdown)
    }

    @MainActor
    private func mount(_ webView: WKWebView) -> UIWindow {
        let host = UIViewController()
        host.view = webView
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        window.rootViewController = host
        window.isHidden = false
        host.view.layoutIfNeeded()
        return window
    }

    @MainActor
    private func unmount(_ window: UIWindow, coordinator: MarkdownWebView.Coordinator) {
        coordinator.invalidate()
        window.isHidden = true
        window.rootViewController = nil
    }

    @MainActor
    private func waitUntilReady(_ webView: WKWebView) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(30))
        while clock.now < deadline {
            if (try? await webView.evaluateJavaScript("typeof window.caveRender === 'function'")) as? Bool == true {
                return
            }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("The packaged markdown renderer did not become ready")
        throw NSError(domain: "MarkdownBundleLoadingTests", code: 1)
    }
}
