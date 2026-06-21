import SwiftUI

struct ChatsHomeView: View {
    @Environment(AppModel.self) private var app
    @State private var showNewChat = false
    @State private var showSettings = false
    @State private var path: [ChatThread] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if app.threads.isEmpty {
                    emptyState
                } else {
                    threadList
                }
            }
            .navigationTitle("Chats")
            .navigationDestination(for: ChatThread.self) { thread in
                ChatView(thread: thread)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showNewChat = true } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .sheet(isPresented: $showNewChat) {
                NewChatView { thread in
                    showNewChat = false
                    path.append(thread)
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .refreshable { await app.loadFamiliars() }
            .onAppear(perform: openDeepLinkedThread)
            // A slash command (`/new`, `/familiar <name>`) asked to open a thread.
            .onChange(of: app.threadToOpen) { _, thread in
                guard let thread else { return }
                if path.last?.id != thread.id { path.append(thread) }
                app.threadToOpen = nil
            }
        }
    }

    /// Open a thread named by the `CAVE_OPEN_THREAD` launch env var. This is the
    /// same hook Phase 2 notification taps will use to jump straight into a chat.
    private func openDeepLinkedThread() {
        guard path.isEmpty,
              let id = ProcessInfo.processInfo.environment["CAVE_OPEN_THREAD"],
              let thread = app.threads.first(where: { $0.id == id }) else { return }
        path.append(thread)
    }

    private var threadList: some View {
        List {
            ForEach(app.threads) { thread in
                Button { path.append(thread) } label: {
                    ThreadRow(thread: thread)
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
            .onDelete { offsets in
                offsets.map { app.threads[$0] }.forEach(app.deleteThread)
            }
        }
        .listStyle(.plain)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No chats yet", systemImage: "bubble.left.and.bubble.right")
        } description: {
            Text("Start a conversation with one familiar — or group several together.")
        } actions: {
            Button("New chat") { showNewChat = true }
                .buttonStyle(.borderedProminent)
        }
    }
}

struct ThreadRow: View {
    @Environment(AppModel.self) private var app
    let thread: ChatThread

    private var familiars: [Familiar] { thread.familiarIds.compactMap(app.familiar) }
    private var lastMessage: DisplayMessage? { thread.messages.last }

    var body: some View {
        HStack(spacing: 12) {
            if thread.isGroup {
                AvatarClusterView(familiars: familiars, size: 48)
            } else {
                AvatarView(familiar: familiars.first,
                           url: familiars.first.flatMap { app.client?.avatarURL(for: $0) },
                           size: 48)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(thread.title).font(.headline).lineLimit(1)
                    if thread.isGroup {
                        Image(systemName: "person.2.fill")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(thread.updatedAt, format: .relative(presentation: .numeric))
                        .font(.caption).foregroundStyle(.tertiary)
                }
                Text(previewText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private var previewText: String {
        guard let last = lastMessage else { return "Tap to start chatting" }
        if last.streaming && last.text.isEmpty { return "…" }
        let prefix = last.role == .user ? "You: " : ""
        return prefix + last.text.replacingOccurrences(of: "\n", with: " ")
    }
}
