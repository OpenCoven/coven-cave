import SwiftUI
import WebKit

/// A real terminal emulator (xterm.js) in a WKWebView, driven by `PtyTerminal`.
///
/// Raw PTY output bytes are forwarded into xterm (base64, so split multibyte
/// UTF-8 reassembles correctly); xterm's char-mode keystrokes and fit-derived
/// resizes come back out. This replaces the stripped line-discipline so the
/// phone terminal renders colours and full-screen TUIs (vim/htop/less) exactly
/// like the desktop.
struct XtermWebView: UIViewRepresentable {
    let terminal: PtyTerminal
    /// Char-mode keystrokes from xterm → caller forwards to pty-ws.
    var onInput: (String) -> Void
    /// Fit-derived terminal size → caller forwards a resize to pty-ws.
    var onResize: (Int, Int) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(terminal: terminal, onInput: onInput, onResize: onResize)
    }

    func makeUIView(context: Context) -> WKWebView { context.coordinator.webView }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.onInput = onInput
        context.coordinator.onResize = onResize
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let webView: WKWebView
        let terminal: PtyTerminal
        var onInput: (String) -> Void
        var onResize: (Int, Int) -> Void

        private var ready = false
        private var pending: [String] = []   // base64 output queued before the page loads

        init(terminal: PtyTerminal,
             onInput: @escaping (String) -> Void,
             onResize: @escaping (Int, Int) -> Void) {
            self.terminal = terminal
            self.onInput = onInput
            self.onResize = onResize

            let config = WKWebViewConfiguration()
            let ucc = WKUserContentController()
            config.userContentController = ucc
            webView = WKWebView(frame: .zero, configuration: config)
            super.init()

            ucc.add(self, name: "term")
            webView.navigationDelegate = self
            webView.scrollView.bounces = false
            webView.isOpaque = true
            webView.backgroundColor = UIColor(red: 0x16 / 255, green: 0x18 / 255, blue: 0x1d / 255, alpha: 1)

            if let url = Bundle.main.url(forResource: "terminal", withExtension: "html") {
                webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            }

            // Raw PTY output → xterm. Clearing on (re)connect avoids duplicating
            // the scrollback the server replays after a reconnect.
            terminal.onData = { [weak self] bytes in self?.write(bytes) }
            terminal.onReset = { [weak self] in self?.clear() }
        }

        private func write(_ bytes: Data) {
            let b64 = bytes.base64EncodedString()
            guard ready else { pending.append(b64); return }
            eval("window.caveTerm.write(b);", ["b": b64])
        }

        private func clear() {
            pending.removeAll()
            guard ready else { return }
            eval("window.caveTerm.clear();", [:])
        }

        /// Raise the soft keyboard by focusing xterm's hidden textarea.
        func focus() { eval("window.caveTerm.focus();", [:]) }

        /// Re-measure after a layout change (rotation, keyboard).
        func fit() { eval("window.caveTerm.fit();", [:]) }

        private func eval(_ js: String, _ args: [String: Any]) {
            Task { @MainActor [weak self] in
                _ = try? await self?.webView.callAsyncJavaScript(js, arguments: args, contentWorld: .page)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            ready = true
            let queued = pending
            pending.removeAll()
            for b in queued { eval("window.caveTerm.write(b);", ["b": b]) }
        }

        nonisolated func userContentController(
            _ controller: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }
            Task { @MainActor in
                switch type {
                case "input":
                    if let data = body["data"] as? String { self.onInput(data) }
                case "resize":
                    if let cols = body["cols"] as? Int, let rows = body["rows"] as? Int {
                        self.onResize(cols, rows)
                    }
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
