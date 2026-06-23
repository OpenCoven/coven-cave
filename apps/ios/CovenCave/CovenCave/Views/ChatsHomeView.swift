import SwiftUI

/// A destination on the Chats navigation stack. Selecting a familiar drills into
/// that familiar's thread list; selecting a thread opens the conversation. Both
/// are pushed onto one shared stack so the back button walks the chain.
enum ChatRoute: Hashable {
    case familiar(Familiar)
    case thread(ChatThread)
}

/// The Chats tab: a list of familiars (tap one to see its threads) plus any
/// group chats as their own rows. Tapping a familiar pushes `FamiliarThreadsView`;
/// tapping a thread pushes `ChatView`.
struct ChatsHomeView: View {
    @Environment(AppModel.self) private var app
    @State private var showNewChat = false
    @State private var query = ""
    @State private var path: [ChatRoute] = []
    @State private var renamingThread: ChatThread?
    /// A group thread awaiting delete confirmation (swipe or context menu).
    @State private var pendingDelete: ChatThread?
    @State private var editMode: EditMode = .inactive
    /// Reveal archived group chats in the list.
    @State private var showArchived = false

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if app.familiars.isEmpty && app.threads.isEmpty {
                    emptyState
                } else if filteredFamiliars.isEmpty && filteredGroups.isEmpty && matchingThreads.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    homeList
                }
            }
            // Flush large-title header at the very top, matching Read / Tasks
            // (which hide the nav bar and supply their own top inset) so
            // every tab's header aligns. Search + compose stay in the bottom bar.
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) { header }
            .navigationDestination(for: ChatRoute.self) { route in
                switch route {
                case .familiar(let familiar):
                    FamiliarThreadsView(familiar: familiar, path: $path)
                case .thread(let thread):
                    ChatView(thread: thread)
                }
            }
            // Search + compose live in a floating bottom bar (iMessage-style),
            // not the top toolbar; Settings is now its own tab.
            .safeAreaInset(edge: .bottom) { bottomBar }
            .sheet(isPresented: $showNewChat) {
                NewChatView { thread in
                    showNewChat = false
                    path.append(.thread(thread))
                }
            }
            .refreshable {
                await app.loadFamiliars()
                await app.loadSessions()
            }
            .task { await app.loadSessions() }
            .onAppear(perform: openDeepLinkedThread)
            // A slash command (`/new`, `/familiar <name>`) or a task link asked to
            // open a specific thread — push it straight onto the stack.
            .onChange(of: app.threadToOpen) { _, thread in
                guard let thread else { return }
                if lastThreadId != thread.id { path.append(.thread(thread)) }
                app.threadToOpen = nil
            }
        }
    }

    /// The id of the thread currently on top of the stack, if any (so a repeat
    /// `requestOpen` of the same thread doesn't double-push it).
    private var lastThreadId: String? {
        if case .thread(let t) = path.last { return t.id }
        return nil
    }

    /// Open a thread named by the `CAVE_OPEN_THREAD` launch env var. This is the
    /// same hook Phase 2 notification taps will use to jump straight into a chat.
    private func openDeepLinkedThread() {
        guard path.isEmpty,
              let id = ProcessInfo.processInfo.environment["CAVE_OPEN_THREAD"],
              let thread = app.threads.first(where: { $0.id == id }) else { return }
        path.append(.thread(thread))
    }

    /// Large-title header pinned to the top, mirroring the Read / Tasks tabs
    /// so every tab's title aligns at the same flush position.
    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Chats")
                .font(.largeTitle.weight(.bold))
            Spacer()
            if canReorder {
                Button(editMode.isEditing ? "Done" : "Reorder") {
                    withAnimation { editMode = editMode.isEditing ? .inactive : .active }
                }
                .font(.subheadline.weight(.medium))
            } else if !app.familiars.isEmpty {
                Text("^[\(app.familiars.count) familiar](inflect: true)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .background(.bar)
    }

    /// Reordering is only meaningful with ≥2 familiars and no active search
    /// filter (drag indices must map to the full, unfiltered list).
    private var canReorder: Bool {
        app.familiars.count > 1 && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var homeList: some View {
        List {
            Section(filteredFamiliars.isEmpty ? "" : "Familiars") {
                ForEach(filteredFamiliars) { familiar in
                    NavigationLink(value: ChatRoute.familiar(familiar)) {
                        FamiliarRow(familiar: familiar)
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }
                .onMove { source, destination in
                    app.moveFamiliar(fromOffsets: source, toOffset: destination)
                }
            }
            if !filteredGroups.isEmpty || archivedGroupCount > 0 {
                Section {
                    ForEach(filteredGroups) { thread in
                        Button { path.append(.thread(thread)) } label: {
                            ThreadRow(thread: thread)
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) { pendingDelete = thread } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button { app.setThreadArchived(thread, !thread.archived) } label: {
                                Label(thread.archived ? "Unarchive" : "Archive",
                                      systemImage: thread.archived ? "tray.and.arrow.up" : "archivebox")
                            }
                            .tint(.indigo)
                        }
                        .swipeActions(edge: .leading) {
                            Button { renamingThread = thread } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                            .tint(.accentColor)
                            Button { app.setThreadPinned(thread, !thread.pinned) } label: {
                                Label(thread.pinned ? "Unpin" : "Pin",
                                      systemImage: thread.pinned ? "pin.slash" : "pin")
                            }
                            .tint(.orange)
                        }
                        .contextMenu {
                            Button { renamingThread = thread } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                            Button { app.setThreadPinned(thread, !thread.pinned) } label: {
                                Label(thread.pinned ? "Unpin" : "Pin",
                                      systemImage: thread.pinned ? "pin.slash" : "pin")
                            }
                            Button { app.setThreadArchived(thread, !thread.archived) } label: {
                                Label(thread.archived ? "Unarchive" : "Archive",
                                      systemImage: thread.archived ? "tray.and.arrow.up" : "archivebox")
                            }
                            Button(role: .destructive) { pendingDelete = thread } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                } header: {
                    Text("Groups")
                } footer: {
                    if archivedGroupCount > 0 {
                        Button {
                            withAnimation { showArchived.toggle() }
                        } label: {
                            Label(showArchived ? "Hide archived"
                                               : "Show \(archivedGroupCount) archived",
                                  systemImage: showArchived ? "chevron.up" : "archivebox")
                                .font(.footnote)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                    }
                }
            }
            if !matchingThreads.isEmpty {
                Section("Chats") {
                    ForEach(matchingThreads) { thread in
                        Button { path.append(.thread(thread)) } label: {
                            ThreadRow(thread: thread)
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .contextMenu {
                            Button { renamingThread = thread } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                            Button { app.setThreadPinned(thread, !thread.pinned) } label: {
                                Label(thread.pinned ? "Unpin" : "Pin",
                                      systemImage: thread.pinned ? "pin.slash" : "pin")
                            }
                            Button { app.setThreadArchived(thread, !thread.archived) } label: {
                                Label(thread.archived ? "Unarchive" : "Archive",
                                      systemImage: thread.archived ? "tray.and.arrow.up" : "archivebox")
                            }
                            Button(role: .destructive) { pendingDelete = thread } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .environment(\.editMode, $editMode)
        .threadRenameAlert($renamingThread) { thread, name in app.renameThread(thread, to: name) }
        .confirmationDialog("Delete this chat?",
                            isPresented: deleteDialogBinding,
                            titleVisibility: .visible,
                            presenting: pendingDelete) { thread in
            Button("Delete", role: .destructive) { app.deleteThread(thread) }
            Button("Cancel", role: .cancel) {}
        } message: { thread in Text(thread.title) }
        // A search filters the list, so indices stop matching the full familiar
        // array — leave reorder mode if the user starts searching.
        .onChange(of: query) { _, q in
            if !q.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { editMode = .inactive }
        }
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    /// Direct (non-group) threads matching the search query by title, a member's
    /// name, or message text. Empty while not searching (groups have their own
    /// section; this surfaces individual conversations otherwise filed under a
    /// familiar).
    private var matchingThreads: [ChatThread] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return [] }
        return app.threads
            .filter { !$0.isGroup && (showArchived || !$0.archived) }
            .filter { thread in
                if thread.title.lowercased().contains(q) { return true }
                if thread.familiarIds.compactMap(app.familiar)
                    .contains(where: { $0.displayName.lowercased().contains(q) }) { return true }
                return thread.messages.contains { $0.text.lowercased().contains(q) }
            }
            .sorted { a, b in
                if a.pinned != b.pinned { return a.pinned }
                return a.updatedAt > b.updatedAt
            }
    }

    /// Familiars matching the search query (name or role). Empty query → all.
    private var filteredFamiliars: [Familiar] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return app.familiars }
        return app.familiars.filter {
            $0.displayName.lowercased().contains(q) || ($0.role?.lowercased().contains(q) ?? false)
        }
    }

    /// Group threads matching the search query (title or a member's name).
    /// Number of archived group chats (drives the show/hide-archived toggle).
    private var archivedGroupCount: Int { app.groupThreads.filter(\.archived).count }

    private var filteredGroups: [ChatThread] {
        let base = app.groupThreads.filter { showArchived || !$0.archived }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return base }
        return base.filter { thread in
            if thread.title.lowercased().contains(q) { return true }
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
            Label("No familiars yet", systemImage: "bubble.left.and.bubble.right")
        } description: {
            Text("Pull to refresh once your desktop is connected, or start a group chat.")
        } actions: {
            Button("New chat") { showNewChat = true }
                .buttonStyle(.borderedProminent)
        }
    }
}

/// A familiar row on the Chats home: avatar, name, role, and a trailing summary
/// of how many conversations they have and when they were last active.
struct FamiliarRow: View {
    @Environment(AppModel.self) private var app
    let familiar: Familiar

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(familiar: familiar,
                       url: app.client?.avatarURL(for: familiar),
                       size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(familiar.displayName).font(.headline).lineLimit(1)
                if let role = familiar.role, !role.isEmpty {
                    Text(role).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                let count = app.threadCount(for: familiar.id)
                if let last = app.lastActivity(for: familiar.id) {
                    Text(last, format: .relative(presentation: .numeric))
                        .font(.caption).foregroundStyle(.tertiary)
                }
                Text(count == 0 ? "No chats" : "^[\(count) chat](inflect: true)")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
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
                    if thread.pinned {
                        Image(systemName: "pin.fill")
                            .font(.caption2).foregroundStyle(.orange)
                    }
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
