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
    }
    let content: Content
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
}

/// Full-screen zoom surface with a close button. Images zoom natively; HTML
/// fragments (tables/diagrams/images) render in a pinch-zoomable WebView styled
/// with the same markdown CSS so they look like the chat.
struct ZoomableContentView: View {
    let target: ZoomTarget
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            Group {
                switch target.content {
                case .image(let image): ZoomableImageView(image: image)
                case .html(let html): ZoomableHTMLView(html: html)
                }
            }
            .ignoresSafeArea(edges: .bottom)

            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 30))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.35))
                    .padding(8)
            }
            .accessibilityLabel("Close")
            .padding(.top, 8)
            .padding(.trailing, 12)
        }
        .statusBarHidden(true)
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
