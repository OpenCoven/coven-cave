import SwiftUI
import WebKit

/// Reader colour theme — overrides the bundle's prose CSS variables. Code blocks
/// stay dark in every theme (a dark code card on a light page is intentional).
enum ReaderTheme: String, CaseIterable, Identifiable {
    case dark, light, sepia
    var id: String { rawValue }
    var label: String {
        switch self {
        case .dark: return "Dark"
        case .light: return "Light"
        case .sepia: return "Sepia"
        }
    }
    var icon: String {
        switch self {
        case .dark: return "moon.fill"
        case .light: return "sun.max.fill"
        case .sepia: return "book.fill"
        }
    }
    /// SwiftUI page background behind the (transparent) WebView, matched to the
    /// CSS `bg` the renderer paints so there's no seam at the edges.
    var background: Color {
        switch self {
        case .dark: return .black
        case .light: return .white
        case .sepia: return Color(red: 0.957, green: 0.925, blue: 0.847)
        }
    }
}

/// A heading reported by the renderer, used to build the reader's table of
/// contents. `index` is its document order so native can ask the WebView to
/// scroll to it without translating coordinates.
struct ReaderHeading: Identifiable, Equatable {
    let id = UUID()
    let index: Int
    let level: Int
    let text: String
}

/// A request to scroll the reader to a heading. The `token` makes repeated taps
/// on the same heading distinct so the command re-fires.
struct ReaderScrollCommand: Equatable { var index: Int; var token: Int }

/// Renders markdown with the SAME pipeline as the desktop chat — the bundled
/// `markdown.html` runs `@create-markdown` + Mermaid in a transparent WKWebView.
/// Two modes:
///  - bubble (default): auto-height, non-scrolling, sits inside a chat bubble.
///    Renders live during streaming (throttled; Mermaid deferred to settle).
///  - reader (`scrollable: true`): fills the screen, scrolls internally, and
///    honours `fontScale` / `theme`, with a TOC driven by `scrollCommand`.
struct MarkdownWebView: UIViewRepresentable {
    let markdown: String
    @Binding var height: CGFloat
    /// Render live while the reply streams in (bubble mode). Renders are
    /// throttled and Mermaid is deferred to the final settle.
    var streaming: Bool = false
    /// Reader mode: scroll internally + accept font/theme/TOC commands.
    var scrollable: Bool = false
    var fontScale: CGFloat = 1
    var theme: ReaderTheme = .dark
    var scrollCommand: ReaderScrollCommand? = nil
    /// Called if the bundled renderer can't run (missing/stale `markdown.html`,
    /// `window.caveRender` undefined, or a JS error) so the caller can fall back
    /// to native `Text` instead of leaving the reply as a blank sliver.
    var onFailure: (() -> Void)? = nil
    /// Reader TOC: the renderer's headings, in document order.
    var onHeadings: (([ReaderHeading]) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView { context.coordinator.webView }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        let c = context.coordinator
        c.onHeight = { h in if abs(h - height) > 0.5 { height = h } }
        c.onFailure = onFailure
        c.onHeadings = onHeadings
        c.setScrollable(scrollable)
        c.apply(markdown: markdown, streaming: streaming,
                fontScale: fontScale, theme: theme, reader: scrollable)
        c.applyScroll(scrollCommand)
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let webView: WKWebView
        var onHeight: ((CGFloat) -> Void)?
        var onFailure: (() -> Void)?
        var onHeadings: (([ReaderHeading]) -> Void)?

        private var ready = false
        private var failed = false
        private var failedReported = false
        private var pending: String?
        private var rendering = false
        private var throttleScheduled = false
        private var lastRenderKey: String?
        private var lastStyleKey: String?
        private var lastScrollToken: Int?

        private struct Opts {
            var streaming = false
            var fontScale: CGFloat = 1
            var theme: ReaderTheme = .dark
            var reader = false
        }
        private var opts = Opts()

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
            } else {
                // The renderer bundle (gitignored, built by scripts/build-ios-markdown.mjs)
                // is missing from this build — never leave the reply blank.
                failed = true
            }
        }

        func setScrollable(_ on: Bool) {
            if webView.scrollView.isScrollEnabled != on {
                webView.scrollView.isScrollEnabled = on
                webView.scrollView.bounces = on
            }
        }

        func apply(markdown md: String, streaming: Bool, fontScale: CGFloat, theme: ReaderTheme, reader: Bool) {
            opts = Opts(streaming: streaming, fontScale: fontScale, theme: theme, reader: reader)
            if failed { reportFailure(); return }
            // Markdown / streaming / reader changes need a full re-render; a pure
            // font-size or theme change is applied without rebuilding the DOM so
            // the reader's scroll position survives.
            let renderKey = "\(streaming)|\(reader)|\(md)"
            let styleKey = "\(fontScale)|\(theme.rawValue)"
            if renderKey == lastRenderKey {
                if styleKey != lastStyleKey { lastStyleKey = styleKey; applyStyleOnly() }
                return
            }
            lastRenderKey = renderKey
            lastStyleKey = styleKey
            pending = md
            requestRender()
        }

        func applyScroll(_ cmd: ReaderScrollCommand?) {
            guard let cmd, cmd.token != lastScrollToken else { return }
            lastScrollToken = cmd.token
            guard ready, !failed else { return }
            webView.evaluateJavaScript("window.caveScrollToHeading && window.caveScrollToHeading(\(cmd.index))",
                                       completionHandler: nil)
        }

        private func applyStyleOnly() {
            guard ready, !failed else { return }
            let o = opts
            let js = "window.caveStyle && window.caveStyle({fontScale:\(Double(o.fontScale)),theme:'\(o.theme.rawValue)',reader:\(o.reader)})"
            webView.evaluateJavaScript(js, completionHandler: nil)
        }

        private func requestRender() {
            if opts.streaming {
                // Coalesce streaming deltas: render the latest pending markdown at
                // most every ~150 ms (the heavy pipeline can't run per token).
                guard !throttleScheduled else { return }
                throttleScheduled = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                    guard let self else { return }
                    self.throttleScheduled = false
                    self.flush()
                }
            } else {
                flush()
            }
        }

        private func flush() {
            guard ready, !rendering, let md = pending else { return }
            pending = nil
            rendering = true
            let o = opts
            Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    let value = try await self.webView.callAsyncJavaScript(
                        "if (typeof window.caveRender !== 'function') throw new Error('caveRender unavailable'); await window.caveRender(md, opts); return Math.ceil(document.body.getBoundingClientRect().height);",
                        arguments: [
                            "md": md,
                            "opts": [
                                "streaming": o.streaming,
                                "fontScale": Double(o.fontScale),
                                "theme": o.theme.rawValue,
                                "reader": o.reader,
                            ],
                        ],
                        contentWorld: .page
                    )
                    if let h = value as? Double, h > 0 {
                        self.onHeight?(CGFloat(h))
                    } else if !o.streaming {
                        // A settled reply that produced no height is a real failure;
                        // mid-stream transients are expected, so don't fall back then.
                        self.reportFailure()
                    }
                } catch {
                    if !o.streaming { self.reportFailure() }
                }
                self.rendering = false
                // Deltas that arrived while this render was in flight: render again.
                if self.pending != nil { self.requestRender() }
            }
        }

        private func reportFailure() {
            guard !failedReported else { return }
            failedReported = true
            failed = true
            // Defer past the current SwiftUI update cycle — `apply()` runs inside
            // `updateUIView`, and mutating the caller's @State synchronously there
            // is dropped ("Modifying state during view update").
            let callback = onFailure
            DispatchQueue.main.async { callback?() }
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
                case "headings":
                    if let arr = body["headings"] as? [[String: Any]] {
                        let hs: [ReaderHeading] = arr.compactMap { d in
                            guard let level = d["level"] as? Int,
                                  let text = d["text"] as? String, !text.isEmpty else { return nil }
                            let index = (d["index"] as? Int) ?? 0
                            return ReaderHeading(index: index, level: level, text: text)
                        }
                        self.onHeadings?(hs)
                    }
                case "link":
                    if let href = body["href"] as? String, let url = URL(string: href) {
                        await UIApplication.shared.open(url)
                    }
                case "copy":
                    if let text = body["text"] as? String, !text.isEmpty {
                        UIPasteboard.general.string = text
                        Haptics.tap()
                    }
                case "enlarge":
                    self.handleEnlarge(body)
                default:
                    break
                }
            }
        }

        /// A tapped table / Mermaid diagram / inline image, or an expanded code
        /// block — hand it to the full-screen zoom surface.
        private func handleEnlarge(_ body: [String: Any]) {
            let kind = body["kind"] as? String
            switch kind {
            case "code":
                if let html = body["html"] as? String, !html.isEmpty {
                    Haptics.tap()
                    ContentZoom.code(html: html, text: body["text"] as? String ?? "")
                }
            case "image":
                Haptics.tap()
                presentImage(src: body["src"] as? String, fallbackHTML: body["html"] as? String ?? "")
            default:
                if let html = body["html"] as? String, !html.isEmpty {
                    Haptics.tap()
                    ContentZoom.html(html)
                }
            }
        }

        /// Decode an inline image's `src` into a `UIImage` for the smooth native
        /// zoom (pinch/pan/double-tap), matching attachment behaviour. Falls back
        /// to the HTML zoom for data we can't decode (relative paths, failures).
        private func presentImage(src: String?, fallbackHTML: String) {
            if let src, !src.isEmpty {
                if let img = UIImage.fromDataUrl(src) {
                    ContentZoom.image(img)
                    return
                }
                if let url = URL(string: src), let scheme = url.scheme,
                   scheme == "http" || scheme == "https" {
                    Task { @MainActor in
                        if let (data, _) = try? await URLSession.shared.data(from: url),
                           let img = UIImage(data: data) {
                            ContentZoom.image(img)
                        } else if !fallbackHTML.isEmpty {
                            ContentZoom.html(fallbackHTML)
                        }
                    }
                    return
                }
            }
            if !fallbackHTML.isEmpty { ContentZoom.html(fallbackHTML) }
        }
    }
}
