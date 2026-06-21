import SwiftUI
import WebKit

/// Renders markdown with the SAME pipeline as the desktop chat — the bundled
/// `markdown.html` runs `@create-markdown` + Mermaid in a transparent,
/// auto-height, non-scrolling WKWebView so assistant replies match the desktop
/// (code blocks, tables, Mermaid diagrams) while sitting natively in the bubble.
struct MarkdownWebView: UIViewRepresentable {
    let markdown: String
    @Binding var height: CGFloat

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.onHeight = { h in
            if abs(h - height) > 0.5 { height = h }
        }
        context.coordinator.render(markdown)
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let webView: WKWebView
        var onHeight: ((CGFloat) -> Void)?
        private var ready = false
        private var pending: String?
        private var lastRendered: String?

        override init() {
            let config = WKWebViewConfiguration()
            let ucc = WKUserContentController()
            config.userContentController = ucc
            webView = WKWebView(frame: .zero, configuration: config)
            super.init()
            ucc.add(self, name: "cave")
            webView.navigationDelegate = self
            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.backgroundColor = .clear
            webView.scrollView.isScrollEnabled = false
            webView.scrollView.bounces = false
            webView.scrollView.contentInset = .zero
            if let url = Bundle.main.url(forResource: "markdown", withExtension: "html") {
                webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            }
        }

        func render(_ md: String) {
            guard md != lastRendered else { return }
            lastRendered = md
            pending = md
            flush()
        }

        private func flush() {
            guard ready, let md = pending else { return }
            pending = nil
            Task { @MainActor [weak self] in
                guard let self else { return }
                let value = try? await self.webView.callAsyncJavaScript(
                    "await window.caveRender(md); return Math.ceil(document.body.getBoundingClientRect().height);",
                    arguments: ["md": md],
                    contentWorld: .page
                )
                if let h = value as? Double { self.onHeight?(CGFloat(h)) }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            ready = true
            flush()
        }

        nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            Task { @MainActor in
                switch type {
                case "height":
                    if let h = body["height"] as? Double { self.onHeight?(CGFloat(h)) }
                case "link":
                    if let href = body["href"] as? String, let url = URL(string: href) {
                        await UIApplication.shared.open(url)
                    }
                default:
                    break
                }
            }
        }
    }
}
