import SwiftUI
import WebKit

/// Renders a Canvas artifact in a WKWebView. HTML artifacts load with an opaque
/// origin (`baseURL: nil`) so they stay self-contained; React artifacts load
/// against the Cave server base URL so the offline `/sandbox/*` runtime + the
/// Tailwind engine resolve (the same assets the desktop preview uses).
///
/// Use `interactive: false` for gallery thumbnails — scrolling and touch are
/// disabled so the card behaves like a static preview that the row tap owns.
struct ArtifactWebView: UIViewRepresentable {
    let artifact: CanvasArtifact
    /// The Cave server base URL — required to preview React artifacts.
    let serverBaseURL: URL?
    var interactive: Bool = true

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = interactive
        webView.scrollView.bounces = interactive
        if !interactive {
            webView.isUserInteractionEnabled = false
            webView.scrollView.contentInset = .zero
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Reload only when the rendered document actually changes (refine swaps
        // the code in place) — avoids a flash on every SwiftUI update pass.
        let doc = artifact.previewSrcDoc
        let base = artifact.kind == .react ? serverBaseURL : nil
        let signature = "\(base?.absoluteString ?? "")\u{1}\(doc.hashValue)"
        guard context.coordinator.lastSignature != signature else { return }
        context.coordinator.lastSignature = signature
        webView.loadHTMLString(doc, baseURL: base)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var lastSignature: String?

        // Keep the preview contained: the first load (about:blank → srcdoc) is
        // allowed; afterwards, a user-driven navigation to a real URL opens in
        // the system browser instead of replacing the preview.
        nonisolated func webView(_ webView: WKWebView,
                                 decidePolicyFor navigationAction: WKNavigationAction,
                                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let url = navigationAction.request.url
            let isExternalTap = navigationAction.navigationType == .linkActivated
                && (url?.scheme == "http" || url?.scheme == "https")
            if isExternalTap, let url {
                decisionHandler(.cancel)
                Task { @MainActor in await UIApplication.shared.open(url) }
                return
            }
            decisionHandler(.allow)
        }
    }
}
