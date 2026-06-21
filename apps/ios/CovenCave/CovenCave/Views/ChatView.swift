import SwiftUI

struct ChatView: View {
    @Environment(AppModel.self) private var app
    @Bindable var thread: ChatThread
    @State private var draft: String = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            messageScroll
            composer
        }
        .navigationTitle(thread.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(thread.title).font(.headline).lineLimit(1)
                    if thread.isGroup {
                        Text("\(thread.familiarIds.count) familiars")
                            .font(.caption2).foregroundStyle(.secondary)
                    } else if let role = app.familiar(thread.familiarIds.first ?? "")?.role {
                        Text(role).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var messageScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(thread.messages) { message in
                        MessageBubble(message: message,
                                      isGroup: thread.isGroup,
                                      familiar: message.familiarId.flatMap(app.familiar),
                                      onDelete: { deleteMessage(message) })
                        .id(message.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: thread.messages.last?.text) { _, _ in
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: thread.messages.count) { _, _ in
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            // Attachment / app drawer (wired in Phase 2).
            Button(action: {}) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemBackground), in: Circle())
            }
            .accessibilityLabel("Add attachment")

            // Hairline capsule with the field and a trailing control inside it:
            // a mic when empty, a filled send button once there's text.
            HStack(alignment: .bottom, spacing: 4) {
                TextField("Message", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.leading, 14)
                    .padding(.vertical, 7)
                    .focused($composerFocused)

                Group {
                    if canSend {
                        Button(action: send) {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 29))
                                .foregroundStyle(Color.accentColor)
                                .background(Circle().fill(.white).padding(3))
                        }
                        .padding(.trailing, 3)
                        .padding(.bottom, 2)
                        .transition(.scale.combined(with: .opacity))
                    } else {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 17))
                            .foregroundStyle(.secondary)
                            .padding(.trailing, 12)
                            .padding(.bottom, 8)
                    }
                }
            }
            .overlay(Capsule().strokeBorder(Color(.separator), lineWidth: 1))
            .animation(.snappy(duration: 0.18), value: canSend)
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .background(.bar)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        guard let client = app.client else { return }
        let text = draft
        draft = ""
        thread.send(text, client: client) { app.touch(thread) }
    }

    private func deleteMessage(_ message: DisplayMessage) {
        thread.deleteMessage(message.id)
        app.touch(thread)
    }
}
