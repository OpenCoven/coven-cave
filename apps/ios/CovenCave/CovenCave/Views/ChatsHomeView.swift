import SwiftUI

struct ChatsHomeView: View {
    @Environment(AppModel.self) private var app
    @State private var showNewChat = false
    @State private var query = ""
    @State private var path: [ChatThread] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if app.threads.isEmpty {
                    emptyState
                } else if filteredThreads.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    threadList
                }
            }
            // Flush large-title header at the very top, matching Canvas / Read /
            // Tasks (which hide the nav bar and supply their own top inset) so
            // every tab's header aligns. Search + compose stay in the bottom bar.
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) { header }
            .navigationDestination(for: ChatThread.self) { thread in
                ChatView(thread: thread)
            }
            // Search + compose live in a floating bottom bar (iMessage-style),
            // not the top toolbar; Settings is now its own tab.
            .safeAreaInset(edge: .bottom) { bottomBar }
            .sheet(isPresented: $showNewChat) {
                NewChatView { thread in
                    showNewChat = false
                    path.append(thread)
                }
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

    /// Large-title header pinned to the top, mirroring the Canvas / Read / Tasks
    /// tabs so every tab's title aligns at the same flush position.
    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Chats")
                .font(.largeTitle.weight(.bold))
            Spacer()
            if !app.threads.isEmpty {
                Text("^[\(app.threads.count) chat](inflect: true)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .background(.bar)
    }

    private var threadList: some View {
        List {
            ForEach(filteredThreads) { thread in
                Button { path.append(thread) } label: {
                    ThreadRow(thread: thread)
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
            .onDelete { offsets in
                offsets.map { filteredThreads[$0] }.forEach(app.deleteThread)
            }
        }
        .listStyle(.plain)
    }

    /// Threads matching the search query (title, last-message preview, or a
    /// participating familiar's name). Empty query shows everything.
    private var filteredThreads: [ChatThread] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return app.threads }
        return app.threads.filter { thread in
            if thread.title.lowercased().contains(q) { return true }
            if let last = thread.messages.last?.text, last.lowercased().contains(q) { return true }
            return thread.familiarIds.compactMap(app.familiar).contains {
                $0.displayName.lowercased().contains(q)
            }
        }
    }

    /// Floating bottom bar: a search field beside a circular compose button,
    /// styled after iOS Messages.
    private var bottomBar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(.regularMaterial, in: Capsule())

            Button {
                showNewChat = true
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 19, weight: .medium))
                    .frame(width: 50, height: 50)
                    .background(.regularMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("New chat")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
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
