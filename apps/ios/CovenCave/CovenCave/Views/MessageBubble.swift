import SwiftUI

struct MessageBubble: View {
    let message: DisplayMessage
    var isGroup: Bool
    var familiar: Familiar?
    var isLast: Bool = false
    var onDelete: () -> Void
    var onSuggestion: (String) -> Void = { _ in }

    @State private var mdHeight: CGFloat = 0

    private var isUser: Bool { message.role == .user }

    /// Assistant text minus the `<coven:next-paths>` block (parsed into chips).
    private var parsed: (visible: String, suggestions: [String]) {
        isUser ? (message.text, []) : NextPaths.extract(message.text)
    }

    /// Render the desktop-parity markdown WebView only for a settled, non-error
    /// assistant reply. Streaming / user / error messages stay native Text.
    private var rendersMarkdown: Bool {
        !isUser && !message.streaming && !message.isError && !parsed.visible.isEmpty
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
        .contextMenu {
            Button(role: .destructive, action: onDelete) {
                Label("Delete", systemImage: "trash")
            }
        }
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
                bubble
                    .contextMenu {
                        Button(role: .destructive, action: onDelete) {
                            Label("Delete Message", systemImage: "trash")
                        }
                    }

                if !isUser, isLast, !message.streaming, !parsed.suggestions.isEmpty {
                    SuggestionPills(suggestions: parsed.suggestions, onTap: onSuggestion)
                }
            }

            if !isUser { Spacer(minLength: 48) }
        }
    }

    @ViewBuilder private var bubble: some View {
        if message.text.isEmpty && message.streaming {
            TypingIndicator()
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(bubbleBackground, in: bubbleShape)
        } else if rendersMarkdown {
            MarkdownWebView(markdown: parsed.visible, height: $mdHeight)
                .frame(height: max(mdHeight, 1))
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(bubbleBackground, in: bubbleShape)
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
        FlowRow(spacing: 6) {
            ForEach(Array(suggestions.enumerated()), id: \.offset) { index, suggestion in
                Button { onTap(suggestion) } label: {
                    HStack(spacing: 4) {
                        if index == 0 {
                            Image(systemName: "sparkle").font(.system(size: 10, weight: .semibold))
                        }
                        Text(suggestion).font(.caption.weight(.medium)).lineLimit(2)
                    }
                    .padding(.horizontal, 11).padding(.vertical, 6)
                    .foregroundStyle(index == 0 ? Color.accentColor : Color.primary)
                    .background(
                        index == 0 ? Color.accentColor.opacity(0.16) : Color(.secondarySystemBackground),
                        in: Capsule()
                    )
                    .overlay(
                        Capsule().strokeBorder(
                            index == 0 ? Color.accentColor.opacity(0.45) : Color(.separator).opacity(0.5),
                            lineWidth: 1
                        )
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 6)
        .padding(.leading, 4)
    }
}
