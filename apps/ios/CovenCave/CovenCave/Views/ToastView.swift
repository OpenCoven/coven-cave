import SwiftUI

/// A small confirmation banner that floats in from the top and auto-dismisses.
/// Used to acknowledge slash commands ("Transcript cleared", "Saved to
/// Bookmarks") without stealing focus from the conversation.
struct ToastView: View {
    let message: ToastMessage

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: message.systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
            Text(message.text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
                .lineLimit(2)
            // A failed mutation can offer a way forward (cave-ioswipe.1):
            // tapping Retry runs the action and the toast's tap-to-dismiss
            // clears the banner so the retry's own feedback takes over.
            if let actionTitle = message.actionTitle, message.action != nil {
                Button {
                    message.action?()
                } label: {
                    Text(actionTitle)
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(tint)
                .controlSize(.small)
                .accessibilityLabel("\(actionTitle): \(message.text)")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .glassFill(.elevated, in: Capsule())
        .overlay(Capsule().strokeBorder(tint.opacity(0.35), lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        .padding(.horizontal, 24)
    }

    private var tint: Color {
        switch message.style {
        case .success: return .green
        case .info: return .accentColor
        case .warning: return .orange
        case .error: return .red
        }
    }
}

private struct ToastModifier: ViewModifier {
    @Binding var message: ToastMessage?
    @State private var dismissTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let message {
                ToastView(message: message)
                    .padding(.top, 6)
                    // Slide in by default; fade only when Reduce Motion is on.
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                    .id(message.id)
                    .onAppear { scheduleDismiss(message.id) }
                    // Tap to dismiss immediately.
                    .onTapGesture { withAnimation(reduceMotion ? nil : .snappy) { self.message = nil } }
            }
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: message)
    }

    private func scheduleDismiss(_ id: UUID) {
        dismissTask?.cancel()
        dismissTask = Task {
            try? await Task.sleep(for: .seconds(2.6))
            guard !Task.isCancelled, message?.id == id else { return }
            withAnimation(.snappy) { message = nil }
        }
    }
}

extension View {
    /// Float a transient `ToastMessage` over this view; binding clears on dismiss.
    func toast(_ message: Binding<ToastMessage?>) -> some View {
        modifier(ToastModifier(message: message))
    }
}
