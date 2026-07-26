import SwiftUI

/// Hosts a "Rename chat" alert with a text field. Drive it by setting the bound
/// `thread`; the alert seeds its field from that thread's title and calls
/// `onRename` with the new name on submit. Shared by every thread list.
private struct ThreadRenameModifier: ViewModifier {
    @Binding var thread: ChatThread?
    let onRename: (ChatThread, String) -> Void
    @State private var text = ""

    func body(content: Content) -> some View {
        content
            .onChange(of: thread?.id) { _, _ in text = thread?.title ?? "" }
            .alert("Rename chat", isPresented: presented) {
                TextField("Name", text: $text)
                Button("Cancel", role: .cancel) {}
                Button("Save") { if let thread { onRename(thread, text) } }
            }
    }

    private var presented: Binding<Bool> {
        Binding(get: { thread != nil }, set: { if !$0 { thread = nil } })
    }
}

extension View {
    /// Attach the shared rename alert, driven by a binding to the thread being
    /// renamed (set it from a context-menu "Rename" action).
    func threadRenameAlert(_ thread: Binding<ChatThread?>,
                           onRename: @escaping (ChatThread, String) -> Void) -> some View {
        modifier(ThreadRenameModifier(thread: thread, onRename: onRename))
    }
}
