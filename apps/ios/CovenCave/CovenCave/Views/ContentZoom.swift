import SwiftUI
import UIKit
import WebKit

/// A piece of chat content the user tapped to enlarge: either a native image
/// attachment, or an HTML fragment (a table / Mermaid diagram / inline image)
/// lifted out of the markdown WebView. Presented full-screen with pinch-zoom.
struct ZoomTarget: Identifiable {
    let id = UUID()
    enum Content {
        case image(UIImage)
        case html(String)
        /// A code block: the highlighted `<pre>` HTML for display plus the raw
        /// text so the zoom surface can copy it natively.
        case code(html: String, text: String)
    }
    let content: Content

    /// The raw text a "Copy" affordance should place on the pasteboard, if this
    /// target carries copyable text (code blocks do).
    var copyText: String? {
        if case .code(_, let text) = content, !text.isEmpty { return text }
        return nil
    }
}

extension Notification.Name {
    /// Posted (object: ZoomTarget) when chat content is tapped to enlarge.
    /// ChatView listens and presents the full-screen zoom cover.
    static let caveZoomContent = Notification.Name("cave.zoomContent")
}

/// Fire-and-forget entry point so any chat subview (native image bubble, the
/// markdown WebView's message handler) can request a full-screen zoom without
/// threading a closure all the way up the view tree.
enum ContentZoom {
    static func present(_ target: ZoomTarget) {
        NotificationCenter.default.post(name: .caveZoomContent, object: target)
    }
    static func image(_ image: UIImage) { present(ZoomTarget(content: .image(image))) }
    static func html(_ html: String) { present(ZoomTarget(content: .html(html))) }
    static func code(html: String, text: String) {
        present(ZoomTarget(content: .code(html: html, text: text)))
    }
}

/// Full-screen zoom surface with a close button. Images zoom natively; HTML
/// fragments (tables/diagrams/images) render in a pinch-zoomable WebView styled
/// with the same markdown CSS so they look like the chat.
struct ZoomableContentView: View {
    let target: ZoomTarget
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            Group {
                switch target.content {
                case .image(let image): ZoomableImageView(image: image)
                case .html(let html): ZoomableHTMLView(html: html)
                case .code(let html, _): ZoomableCodeView(html: html)
                }
            }
            .ignoresSafeArea(edges: .bottom)

            // Top bar: a Copy affordance (when the content carries copyable text,
            // i.e. a code block) on the left, and a Close button on the right.
            HStack {
                if let text = target.copyText {
                    Button { copy(text) } label: {
                        Label(copied ? "Copied" : "Copy",
                              systemImage: copied ? "checkmark" : "doc.on.doc")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(copied ? Color.green.opacity(0.85)
                                               : Color.white.opacity(0.16), in: Capsule())
                    }
                    .accessibilityLabel("Copy code")
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 30))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.35))
                }
                .accessibilityLabel("Close")
            }
            .padding(.top, 8)
            .padding(.horizontal, 12)
        }
        .statusBarHidden(true)
    }

    private func copy(_ text: String) {
        UIPasteboard.general.string = text
        Haptics.tap()
        withAnimation(.snappy) { copied = true }
    }
}

/// Pinch-to-zoom + drag-to-pan + double-tap-to-toggle for a native image.
private struct ZoomableImageView: View {
    let image: UIImage

    @State private var scale: CGFloat = 1
    @GestureState private var pinch: CGFloat = 1
    @State private var offset: CGSize = .zero
    @GestureState private var drag: CGSize = .zero

    private let minScale: CGFloat = 1
    private let maxScale: CGFloat = 6

    var body: some View {
        let effectiveScale = min(max(scale * pinch, minScale), maxScale)
        Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .scaleEffect(effectiveScale)
            .offset(x: offset.width + drag.width, y: offset.height + drag.height)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .gesture(
                MagnificationGesture()
                    .updating($pinch) { value, state, _ in state = value }
                    .onEnded { value in
                        scale = min(max(scale * value, minScale), maxScale)
                        if scale <= minScale { withAnimation(.easeOut(duration: 0.2)) { offset = .zero } }
                    }
            )
            .simultaneousGesture(
                DragGesture()
                    .updating($drag) { value, state, _ in
                        if scale > minScale { state = value.translation }
                    }
                    .onEnded { value in
                        guard scale > minScale else { return }
                        offset.width += value.translation.width
                        offset.height += value.translation.height
                    }
            )
            .onTapGesture(count: 2) {
                withAnimation(.easeInOut(duration: 0.22)) {
                    if scale > minScale { scale = minScale; offset = .zero } else { scale = 2.5 }
                }
            }
    }
}

/// Renders an HTML fragment (table / Mermaid SVG / `<img>`) full-screen in a
/// pinch-zoomable, scrollable WebView, styled with the bundled markdown CSS.
private struct ZoomableHTMLView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // Pinch-zoom comes from the user-scalable viewport in the document below.
        webView.loadHTMLString(Self.document(for: html), baseURL: nil)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    /// Wrap the fragment in a zoom-friendly document. The viewport allows pinch
    /// zoom (no maximum-scale, unlike the in-bubble renderer), and the markdown
    /// CSS is reused so tables/diagrams match the chat. Tables get their inline
    /// `display:block` overflow cleared so they lay out at full size.
    private static func document(for fragment: String) -> String {
        let css = (try? String(contentsOf: cssURL, encoding: .utf8)) ?? ""
        return """
        <!doctype html><html><head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=yes">
        <style>
        \(css)
        html,body { margin:0; background:transparent; }
        body { padding:18px; display:flex; min-height:100vh; align-items:center; justify-content:center; }
        #zoom { width:100%; }
        #zoom table { display:table; width:auto; min-width:100%; overflow:visible; font-size:1em; }
        #zoom img, #zoom svg { max-width:100%; height:auto; }
        </style>
        </head><body><div id="zoom">\(fragment)</div></body></html>
        """
    }

    private static var cssURL: URL {
        Bundle.main.url(forResource: "markdown", withExtension: "css")
            ?? URL(fileURLWithPath: "/dev/null")
    }
}

/// Renders a code block (its highlighted `<pre>` HTML) full-screen: top-left
/// aligned, scrollable in both axes (long lines don't wrap), pinch-zoomable, and
/// styled with the bundled markdown CSS so syntax colours match the chat.
private struct ZoomableCodeView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.indicatorStyle = .white
        webView.loadHTMLString(Self.document(for: html), baseURL: nil)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    private static func document(for fragment: String) -> String {
        let css = (try? String(contentsOf: cssURL, encoding: .utf8)) ?? ""
        return """
        <!doctype html><html><head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=yes">
        <style>
        \(css)
        html,body { margin:0; background:transparent; }
        /* leave room for the top bar; sit flush top-left so reading starts at the
           first line, and let long lines scroll horizontally rather than wrap. */
        body { padding:56px 16px 24px; }
        #zoom pre {
          margin:0; border:0; background:transparent;
          white-space:pre; overflow:visible;
        }
        #zoom code { font-size:0.95em; line-height:1.55; white-space:pre; }
        </style>
        </head><body><div id="zoom">\(fragment)</div></body></html>
        """
    }

    private static var cssURL: URL {
        Bundle.main.url(forResource: "markdown", withExtension: "css")
            ?? URL(fileURLWithPath: "/dev/null")
    }
}
