import SwiftUI
import UIKit

struct MessageBubble: View {
    let message: DisplayMessage
    var isGroup: Bool
    var familiar: Familiar?
    var isLast: Bool = false
    var onDelete: () -> Void
    var onSuggestion: (String) -> Void = { _ in }
    var onOpenReader: ((String) -> Void)? = nil
    /// Regenerate this reply (assistant messages only); nil hides the action.
    var onRetry: (() -> Void)? = nil

    @State private var mdHeight: CGFloat = 0
    /// Set when the markdown WebView can't render (missing/stale bundle, JS
    /// error) — flips this bubble back to plain `Text` so the reply is never
    /// shown as a blank sliver.
    @State private var markdownFailed = false

    private var isUser: Bool { message.role == .user }

    /// Compact send time under the bubble — time only for today, with an
    /// abbreviated date for older messages.
    private var timestampText: String {
        if Calendar.current.isDateInToday(message.createdAt) {
            return message.createdAt.formatted(date: .omitted, time: .shortened)
        }
        return message.createdAt.formatted(date: .abbreviated, time: .shortened)
    }

    /// Long-press actions shared by the bubble and the system note: copy the
    /// text, optionally retry (regenerate), and delete.
    @ViewBuilder private var messageActions: some View {
        if !message.text.isEmpty {
            Button {
                UIPasteboard.general.string = message.text
                Haptics.tap()
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }
        }
        if canOpenReader {
            Button {
                onOpenReader?(parsed.visible)
                Haptics.tap()
            } label: {
                Label("Open in Reader", systemImage: "text.page")
            }
        }
        if let onRetry {
            Button(action: onRetry) {
                Label("Retry", systemImage: "arrow.clockwise")
            }
        }
        Button(role: .destructive, action: onDelete) {
            Label("Delete Message", systemImage: "trash")
        }
    }

    /// Assistant text minus the `<coven:next-paths>` block (parsed into chips).
    private var parsed: (visible: String, suggestions: [String]) {
        isUser ? (message.text, []) : NextPaths.extract(message.text)
    }

    /// Render the desktop-parity markdown WebView. Assistant replies always do —
    /// now including while streaming (the WebView renders live, throttled). A
    /// *user* message only renders markdown when it actually contains some, so
    /// plain chatter stays fast native Text. Error messages stay native Text.
    private var rendersMarkdown: Bool {
        guard !message.isError, !parsed.visible.isEmpty, !markdownFailed else { return false }
        if isUser { return MarkdownDetect.hasMarkdown(message.text) }
        return true
    }

    private var canOpenReader: Bool {
        !isUser && !message.streaming && !message.isError && !parsed.visible.isEmpty && onOpenReader != nil
    }

    var body: some View {
        if message.role == .system {
            systemNote
        } else {
            chatBubble
        }
    }

    /// Inline slash-command output — a subtle monospaced card so it reads as
    /// system feedback rather than a familiar's reply.
    private var systemNote: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: message.isError ? "exclamationmark.triangle.fill" : "terminal.fill")
                .font(.caption)
                .foregroundStyle(message.isError ? Color.red : Color.secondary)
                .padding(.top, 2)
            Text(message.text.isEmpty ? " " : message.text)
                .font(.callout.monospaced())
                .foregroundStyle(message.isError ? Color.red : Color.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color(.secondarySystemBackground).opacity(0.6),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 1)
        )
        .padding(.horizontal, 24)
        .contextMenu { messageActions }
    }

    private var chatBubble: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isUser { Spacer(minLength: 48) }

            if !isUser, isGroup {
                AvatarView(familiar: familiar, size: 28)
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 3) {
                if !isUser, isGroup, let name = familiar?.displayName {
                    Text(name)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.color(for: familiar))
                        .padding(.leading, 4)
                }
                if !message.attachmentDataUrls.isEmpty {
                    attachmentImages
                        .contextMenu { messageActions }
                }
                // Hide the (empty) text bubble for image-only messages.
                if !parsed.visible.isEmpty || message.attachmentDataUrls.isEmpty {
                    bubble
                        .contextMenu { messageActions }
                }

                if !message.streaming {
                    Text(timestampText)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .padding(isUser ? .trailing : .leading, 6)
                }

                if !isUser, isLast, !message.streaming, !parsed.suggestions.isEmpty {
                    SuggestionPills(suggestions: parsed.suggestions, onTap: onSuggestion)
                }
            }

            if !isUser { Spacer(minLength: 48) }
        }
    }

    @ViewBuilder private var attachmentImages: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
            ForEach(message.attachmentDataUrls, id: \.self) { url in
                if let image = UIImage.fromDataUrl(url) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 240, maxHeight: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(Color(.separator).opacity(0.4), lineWidth: 1))
                        // Tap to enlarge the attachment full-screen (pinch-zoom).
                        .onTapGesture { ContentZoom.image(image) }
                        .accessibilityAddTraits(.isButton)
                        .accessibilityHint("Tap to enlarge")
                }
            }
        }
    }

    @ViewBuilder private var bubble: some View {
        if message.text.isEmpty && message.streaming {
            TypingIndicator()
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(bubbleBackground, in: bubbleShape)
        } else if rendersMarkdown {
            MarkdownWebView(markdown: parsed.visible, height: $mdHeight,
                            streaming: message.streaming && !isUser,
                            onFailure: { markdownFailed = true })
                .frame(height: max(mdHeight, 1))
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(bubbleBackground, in: bubbleShape)
                .overlay(alignment: .topTrailing) {
                    if canOpenReader {
                        Button {
                            onOpenReader?(parsed.visible)
                            Haptics.tap()
                        } label: {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .padding(7)
                                .background(.thinMaterial, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .padding(6)
                        .accessibilityLabel("Open response in reader")
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if message.streaming && !isUser { StreamingDot().padding(6) }
                }
        } else {
            Text(parsed.visible.isEmpty ? " " : parsed.visible)
                .textSelection(.enabled)
                .foregroundStyle(isUser ? Color.white : Color.primary)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(bubbleBackground, in: bubbleShape)
                .overlay(alignment: .bottomTrailing) {
                    if message.streaming {
                        StreamingDot().padding(6)
                    }
                }
        }
    }

    private var bubbleShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: isUser ? 22 : 26, style: .continuous)
    }

    private var bubbleBackground: Color {
        if message.isError { return Color.red.opacity(0.85) }
        if isUser { return Color.accentColor }
        return Color(.secondarySystemBackground)
    }
}

struct TypingIndicator: View {
    @State private var phase = 0.0
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { i in
                Circle().frame(width: 6, height: 6)
                    .foregroundStyle(.secondary)
                    .opacity(phase == Double(i) ? 1 : 0.3)
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.5).repeatForever()) { phase = 2 }
        }
    }
}

struct StreamingDot: View {
    @State private var on = false
    var body: some View {
        Circle().frame(width: 6, height: 6)
            .foregroundStyle(.secondary)
            .opacity(on ? 1 : 0.2)
            .onAppear { withAnimation(.easeInOut(duration: 0.6).repeatForever()) { on = true } }
    }
}

/// Follow-up suggestion chips parsed from the assistant's `<coven:next-paths>`
/// block. The first is the recommended path (accent); tapping sends it.
struct SuggestionPills: View {
    let suggestions: [String]
    var onTap: (String) -> Void

    var body: some View {
        // Full-width, rounded-rect chips (vs. the old left-aligned FlowRow of
        // content-hugging capsules). Each suggestion is a sentence, so it gets
        // its own full-width row with centered text; the recommended one keeps
        // the accent + ✦ sparkle.
        VStack(spacing: 6) {
            ForEach(Array(suggestions.enumerated()), id: \.offset) { index, suggestion in
                Button { onTap(suggestion) } label: {
                    HStack(spacing: 5) {
                        if index == 0 {
                            Image(systemName: "sparkle").font(.system(size: 10, weight: .semibold))
                        }
                        Text(suggestion)
                            .font(.caption.weight(.medium))
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(index == 0 ? Color.accentColor : Color.primary)
                    .background(
                        index == 0 ? Color.accentColor.opacity(0.16) : Color(.secondarySystemBackground),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(
                            index == 0 ? Color.accentColor.opacity(0.45) : Color(.separator).opacity(0.5),
                            lineWidth: 1
                        )
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
    }
}
