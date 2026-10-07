import UIKit
import WebKit
import XCTest
@testable import CovenCave

final class MarkdownBundleLoadingTests: XCTestCase {
    @MainActor
    func testNativePlainParagraphsMatchPackagedVisibleText() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-plain-paragraph-v1", withExtension: "json"))
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        let coordinator = MarkdownWebView.Coordinator()
        let window = mount(coordinator.webView)
        defer { unmount(window, coordinator: coordinator) }
        try await waitUntilReady(coordinator.webView)
        for item in cases {
            let source = try XCTUnwrap(item["source"] as? String)
            guard let paragraph = MarkdownDetect.plainTimelineParagraph(source) else { continue }
            let id = try XCTUnwrap(item["id"] as? String)
            let result = try await coordinator.webView.callAsyncJavaScript("""
                await window.caveRender(source);
                const nodes = [...document.querySelector('.cm-preview').children];
                return {plain: nodes.length === 1 && nodes[0].tagName === 'P' && nodes[0].children.length === 0,
                        text: nodes[0]?.innerText};
                """, arguments: ["source": source], contentWorld: .page)
            let report = try XCTUnwrap(result as? [String: Any])
            XCTAssertEqual(report["plain"] as? Bool, true, id)
            XCTAssertEqual(report["text"] as? String, paragraph, id)
        }
    }

    @MainActor
    func testTimelinePreservesPackagedMarkdownSemantics() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "runtime-timeline-v1", withExtension: "json"))
        let corpus = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let scenarios = try XCTUnwrap(corpus["scenarios"] as? [[String: Any]])
        let coordinator = MarkdownWebView.Coordinator()
        let window = mount(coordinator.webView)
        defer { unmount(window, coordinator: coordinator) }
        try await waitUntilReady(coordinator.webView)
        for scenario in scenarios where scenario["renderParity"] as? Bool == true {
            let id = try XCTUnwrap(scenario["id"] as? String)
            let source = try XCTUnwrap(scenario["text"] as? String)
            let raw: [String: Any] = ["id": id, "role": "assistant", "text": source,
                                      "tools": try XCTUnwrap(scenario["tools"])]
            let turn = try JSONDecoder().decode(ChatTurn.self, from: JSONSerialization.data(withJSONObject: raw))
            let message = DisplayMessage.restored(from: turn, familiarId: "fixture")
            let entries = try XCTUnwrap(ChatActivityTimeline.entries(text: source, steps: message.activitySteps, reasoning: []))
            let spans = entries.compactMap { entry -> String? in
                if case .text(_, let value) = entry { return value }; return nil
            }
            let result = try await coordinator.webView.callAsyncJavaScript("""
                const render = async text => {
                    await window.caveRender(text);
                    return [...document.querySelector('.cm-preview').children].map(node => ({
                        tag: node.tagName, text: node.textContent,
                        links: [...node.querySelectorAll('a')].map(a => a.getAttribute('href'))
                    }));
                };
                const baseline = await render(source);
                const split = [];
                for (const text of spans) split.push(...await render(text));
                return {same: JSON.stringify(baseline) === JSON.stringify(split),
                        links: split.flatMap(node => node.links)};
                """, arguments: ["source": source, "spans": spans], contentWorld: .page)
            let report = try XCTUnwrap(result as? [String: Any])
            XCTAssertEqual(report["same"] as? Bool, true, id)
            XCTAssertEqual(report["links"] as? [String], scenario["expectedLinks"] as? [String], id)
        }
    }

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
                document.querySelectorAll('script[src$="markdown-highlight.js"]').length === 1 &&
                document.querySelectorAll('script[src$="markdown-mermaid.js"]').length === 0;
            """, arguments: [:], contentWorld: .page)
        XCTAssertEqual(prose as? Bool, true, "Ordinary formatted replies must not load diagram code")

        let diagram = "```mermaid\nflowchart LR\nA --> B\n```"
        let streaming = try await webView.callAsyncJavaScript("""
            await window.caveRender(md, {streaming: true});
            return document.getElementById('root').textContent.includes('rendering on completion') &&
                typeof window.caveMermaid === 'undefined' &&
                document.querySelectorAll('script[src$="markdown-highlight.js"]').length === 1 &&
                document.querySelectorAll('script[src$="markdown-mermaid.js"]').length === 0;
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
