import SwiftUI

/// Each chronological prose span owns its WebView height and fallback state.
/// Full-message actions remain on MessageBubble; the rendering path is shared
/// with older unsegmented messages.
struct MessageProseView: View {
    let message: DisplayMessage
    let projection: AssistantResponseProjection
    var isLast: Bool = false
    var preferNativePlainText = false
    var deferOffscreenMarkdown = false
    var onOpenReader: ((String) -> Void)? = nil
    var onContentHeightChange: (() -> Void)? = nil
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @State private var mdHeight: CGFloat = 0
    @State private var markdownFailed = false
    @State private var isNearViewport = false
    @State private var markdownReady = false
    private var isUser: Bool { message.role == .user }

    var body: some View {
        bubble(projection)
            .onGeometryChange(for: Bool.self) { geometry in
                guard deferOffscreenMarkdown, let viewport = geometry.bounds(of: .scrollView) else { return true }
                // Prefetch one viewport on either side. Report only crossings,
                // not a state mutation for every scrolling pixel.
                return CGRect(origin: .zero, size: geometry.size)
                    .intersects(viewport.insetBy(dx: 0, dy: -viewport.height))
            } action: { isNearViewport = $0 }
            .onChange(of: keepsMarkdownMounted) { _, mounted in
                if !mounted { markdownReady = false }
            }
    }

    private var keepsMarkdownMounted: Bool {
        !deferOffscreenMarkdown || message.streaming || voiceOverEnabled || isNearViewport
    }

    private var measuredHeight: Binding<CGFloat> {
        Binding(get: { markdownReady ? mdHeight : 0 }, set: {
            mdHeight = $0
            markdownReady = $0 > 1
        })
    }

    private func canOpenReader(_ projection: AssistantResponseProjection) -> Bool {
        !isUser && !message.streaming && !message.isError && !projection.visible.isEmpty && onOpenReader != nil
    }

    private func rendersMarkdown(_ projection: AssistantResponseProjection) -> Bool {
        guard !message.isError, !projection.visible.isEmpty, !markdownFailed else { return false }
        if isUser { return MarkdownDetect.hasMarkdown(message.text) }
        return true
    }

    private func nativeParagraph(_ projection: AssistantResponseProjection) -> String? {
        guard preferNativePlainText, !isUser, !message.streaming, !message.isError else { return nil }
        return MarkdownDetect.plainTimelineParagraph(projection.visible)
    }

    @ViewBuilder private func bubble(_ projection: AssistantResponseProjection) -> some View {
        if message.text.isEmpty && message.streaming {
            VStack(alignment: .leading, spacing: 8) {
                TypingIndicator()
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .background(bubbleBackground, in: bubbleShape)
                // While the newest reply gathers itself, surface one rotating
                // grimoire tip (design's thinking-hint card).
                if isLast {
                    GrimoireHintCard()
                }
            }
        } else if let paragraph = nativeParagraph(projection) {
            Text(verbatim: paragraph)
                .font(.subheadline)
                .textSelection(.enabled)
                .foregroundStyle(Color.primary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.trailing, canOpenReader(projection) ? 44 : 0)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .frame(maxWidth: .infinity, minHeight: canOpenReader(projection) ? 56 : 0, alignment: .leading)
                .background(bubbleBackground, in: bubbleShape)
                .overlay(alignment: .topTrailing) { readerControl(projection) }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { _ in
                    onContentHeightChange?()
                }
        } else if rendersMarkdown(projection) {
            let ready = keepsMarkdownMounted && markdownReady
            ZStack(alignment: .topLeading) {
                if keepsMarkdownMounted {
                    MarkdownWebView(markdown: projection.visible, height: measuredHeight,
                                streaming: message.streaming && !isUser,
                                theme: colorScheme == .light ? .light : .dark,
                                accentHex: chrome.accentHex,
                                onFailure: { markdownFailed = true },
                                measureFirstRichRender: message.role == .assistant)
                    .frame(height: max(mdHeight, 1))
                    .opacity(ready ? 1 : 0)
                    .accessibilityHidden(!ready)
                }
                if !ready {
                    markdownLoadingPlaceholder(projection)
                        // Retain measured geometry when WebKit unloads. The
                        // placeholder supplies geometry before the first render.
                        .frame(height: mdHeight > 1 ? mdHeight : nil, alignment: .topLeading)
                }
            }
                .padding(.trailing, canOpenReader(projection) ? 44 : 0)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .frame(minHeight: canOpenReader(projection) ? 56 : 0)
                .background(bubbleBackground, in: bubbleShape)
                .overlay(alignment: .topTrailing) { readerControl(projection) }
                .overlay(alignment: .bottomTrailing) {
                    if message.streaming && !isUser { StreamingDot().padding(6) }
                }
                .onChange(of: mdHeight) { _, newHeight in
                    guard newHeight > 1 else { return }
                    onContentHeightChange?()
                }
        } else {
            Text(projection.visible.isEmpty ? " " : projection.visible)
                .textSelection(.enabled)
                .foregroundStyle(isUser ? chrome.accentForeground : Color.primary)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(bubbleBackground, in: bubbleShape)
                .overlay(alignment: .bottomTrailing) {
                    if message.streaming {
                        StreamingDot().padding(6)
                    }
                }
        }
    }

    @ViewBuilder private func readerControl(_ projection: AssistantResponseProjection) -> some View {
        if canOpenReader(projection) {
            Button {
                onOpenReader?(projection.visible)
                Haptics.tap()
            } label: {
                Image(systemName: "arrow.up.left.and.arrow.down.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(7)
                    .glassFill(.control, in: Circle())
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(6)
            .accessibilityLabel("Open response in reader")
        }
    }

    private func markdownLoadingPlaceholder(_ projection: AssistantResponseProjection) -> some View {
        Text(projection.visible)
            .textSelection(.enabled)
            .foregroundStyle(Color.primary)
            .lineLimit(12)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel(projection.visible)
    }

    private var bubbleShape: UnevenRoundedRectangle {
        if isUser {
            UnevenRoundedRectangle(
                topLeadingRadius: 18, bottomLeadingRadius: 18,
                bottomTrailingRadius: 6, topTrailingRadius: 18,
                style: .continuous
            )
        } else {
            UnevenRoundedRectangle(
                topLeadingRadius: 18, bottomLeadingRadius: 6,
                bottomTrailingRadius: 18, topTrailingRadius: 18,
                style: .continuous
            )
        }
    }

    /// Bubble fills: errors stay red; the user's bubble is a soft vertical
    /// accent gradient (readable text comes from `chrome.accentForeground`);
    /// the assistant's bubble sits on the theme's raised surface so it tracks
    /// the desktop palette — the fallback palette resolves to the same
    /// `secondarySystemBackground` as before.
    private var bubbleBackground: AnyShapeStyle {
        if message.isError { return AnyShapeStyle(Color.red.opacity(0.85)) }
        if isUser { return AnyShapeStyle(chrome.accentGradient) }
        return AnyShapeStyle(chrome.bgRaised)
    }
}
