import SwiftUI

/// A small confirmation banner that floats in from the top and auto-dismisses.
/// Used to acknowledge slash commands ("Transcript cleared", "Saved to
/// Bookmarks") without stealing focus from the conversation.
struct ToastView: View {
    let message: ToastMessage

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: message.systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tint)
            Text(message.text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
                .lineLimit(2)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(.regularMaterial, in: Capsule())
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

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let message {
                ToastView(message: message)
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .id(message.id)
                    .onAppear { scheduleDismiss(message.id) }
                    // Tap to dismiss immediately.
                    .onTapGesture { withAnimation(.snappy) { self.message = nil } }
            }
        }
        .animation(.snappy(duration: 0.28), value: message)
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
