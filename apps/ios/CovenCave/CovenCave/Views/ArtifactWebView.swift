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
    var onSelect: ((CanvasComponentTarget) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.setURLSchemeHandler(
            context.coordinator.sandboxSchemeHandler,
            forURLScheme: "cave-sandbox"
        )
        config.userContentController.add(
            context.coordinator,
            contentWorld: Coordinator.inspectorWorld,
            name: "caveCanvasSelection"
        )
        config.userContentController.addUserScript(
            WKUserScript(
                source: Coordinator.selectionScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true,
                in: Coordinator.inspectorWorld
            )
        )
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
        context.coordinator.onSelect = onSelect
        context.coordinator.sandboxSchemeHandler.configure(
            baseURL: serverBaseURL,
            accessToken: CaveConnection.accessToken
        )
        // Reload only when the rendered document actually changes (refine swaps
        // the code in place) — avoids a flash on every SwiftUI update pass.
        let doc = artifact.kind == .react
            ? CanvasArtifact.buildReactSrcDoc(artifact.code, sandboxBase: "cave-sandbox://assets")
            : CanvasArtifact.buildPreviewSrcDoc(artifact.code)
        let base: URL? = nil
        let signature = "\(base?.absoluteString ?? "")\u{1}\(doc.hashValue)"
        guard context.coordinator.lastSignature != signature else { return }
        context.coordinator.lastSignature = signature
        webView.loadHTMLString(doc, baseURL: base)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: "caveCanvasSelection",
            contentWorld: Coordinator.inspectorWorld
        )
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        static let inspectorWorld = WKContentWorld.world(name: "CovenCanvasInspector")
        var lastSignature: String?
        var onSelect: ((CanvasComponentTarget) -> Void)?
        fileprivate let sandboxSchemeHandler = SandboxSchemeHandler()

        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard message.name == "caveCanvasSelection",
                  let body = message.body as? [String: String],
                  let selector = body["selector"], !selector.isEmpty
            else { return }
            onSelect?(CanvasComponentTarget(
                selector: String(selector.prefix(500)),
                label: String((body["label"] ?? "").prefix(200)),
                excerpt: String((body["excerpt"] ?? "").prefix(1_000))
            ))
        }

        // Keep the preview contained: the first load (about:blank → srcdoc) is
        // allowed; afterwards, a user-driven navigation to a real URL opens in
        // the system browser instead of replacing the preview.
        nonisolated func webView(_ webView: WKWebView,
                                 decidePolicyFor navigationAction: WKNavigationAction,
                                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let url = navigationAction.request.url
            let isExternal = url?.scheme == "http" || url?.scheme == "https"
            if isExternal, let url {
                decisionHandler(.cancel)
                if navigationAction.navigationType == .linkActivated {
                    Task { @MainActor in await UIApplication.shared.open(url) }
                }
                return
            }
            decisionHandler(.allow)
        }

        fileprivate static let selectionScript = """
        (() => {
          const meaningful = (element) =>
            element instanceof Element &&
            !["HTML", "BODY", "SCRIPT", "STYLE", "META", "LINK"].includes(element.tagName);
          const selectorFor = (element) => {
            const testId = element.getAttribute("data-testid");
            if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
            if (element.id) return `#${CSS.escape(element.id)}`;
            const parts = [];
            let current = element;
            while (meaningful(current) && parts.length < 8) {
              let part = current.tagName.toLowerCase();
              const siblings = current.parentElement
                ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName)
                : [];
              if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
              parts.unshift(part);
              current = current.parentElement;
            }
            return parts.join(" > ");
          };
          document.addEventListener("click", (event) => {
            if (!event.isTrusted || !meaningful(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            const element = event.target;
            document.querySelectorAll("[data-cave-selected]").forEach((node) =>
              node.removeAttribute("data-cave-selected"));
            element.setAttribute("data-cave-selected", "");
            if (!document.getElementById("cave-selection-style")) {
              const style = document.createElement("style");
              style.id = "cave-selection-style";
              style.textContent = "[data-cave-selected]{outline:2px solid #7c3aed!important;outline-offset:2px!important}";
              document.head.appendChild(style);
            }
            window.webkit.messageHandlers.caveCanvasSelection.postMessage({
              selector: selectorFor(element),
              label: (element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 200),
              excerpt: (element.outerHTML || "").slice(0, 1000)
            });
          }, true);
        })();
        """
    }
}

fileprivate final class SandboxSchemeHandler: NSObject, WKURLSchemeHandler {
    private let lock = NSLock()
    private var baseURL: URL?
    private var accessToken: String?
    private var tasks: [ObjectIdentifier: URLSessionDataTask] = [:]

    func configure(baseURL: URL?, accessToken: String?) {
        lock.lock()
        self.baseURL = baseURL
        self.accessToken = accessToken
        lock.unlock()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask)
        let filename = urlSchemeTask.request.url?.lastPathComponent ?? ""
        guard ["react-runtime.js", "tailwind.js"].contains(filename) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        lock.lock()
        let baseURL = self.baseURL
        let accessToken = self.accessToken
        lock.unlock()
        guard let url = baseURL?.appendingPathComponent("sandbox/\(filename)") else {
            urlSchemeTask.didFailWithError(CaveError.notConfigured)
            return
        }

        var request = URLRequest(url: url)
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            self?.lock.lock()
            self?.tasks.removeValue(forKey: identifier)
            self?.lock.unlock()
            if let error {
                urlSchemeTask.didFailWithError(error)
                return
            }
            guard let data,
                  let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode)
            else {
                urlSchemeTask.didFailWithError(CaveError.transport("Sandbox runtime unavailable."))
                return
            }
            let response = URLResponse(
                url: urlSchemeTask.request.url ?? url,
                mimeType: "application/javascript",
                expectedContentLength: data.count,
                textEncodingName: "utf-8"
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        }
        lock.lock()
        tasks[identifier] = task
        lock.unlock()
        task.resume()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask)
        lock.lock()
        let task = tasks.removeValue(forKey: identifier)
        lock.unlock()
        task?.cancel()
    }
}
