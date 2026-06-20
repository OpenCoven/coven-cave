import SwiftUI

struct MessageBubble: View {
    let message: DisplayMessage
    var isGroup: Bool
    var familiar: Familiar?

    private var isUser: Bool { message.role == .user }

    var body: some View {
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
            }

            if !isUser { Spacer(minLength: 48) }
        }
    }

    @ViewBuilder private var bubble: some View {
        if message.text.isEmpty && message.streaming {
            TypingIndicator()
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(bubbleBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        } else {
            Text(message.text.isEmpty ? " " : message.text)
                .textSelection(.enabled)
                .foregroundStyle(isUser ? Color.white : Color.primary)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(bubbleBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    if message.streaming {
                        StreamingDot().padding(6)
                    }
                }
        }
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
