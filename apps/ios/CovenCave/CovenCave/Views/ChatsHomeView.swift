import SwiftUI

/// A destination on the Chats navigation stack. Selecting a familiar drills into
/// that familiar's thread list; selecting a thread opens the conversation. Both
/// are pushed onto one shared stack so the back button walks the chain.
enum ChatRoute: Hashable {
    case familiar(Familiar)
    case thread(ChatThread)
}

/// The Chats tab, redesigned per the 2026-07 design handoff (screen 1a): a
/// horizontal familiar rail (tap one to see its threads) above one unified
/// "Recent" list of every conversation — direct and group — sorted by recency.
/// Tapping a rail avatar pushes `FamiliarThreadsView`; tapping a row opens
/// the conversation.
struct ChatsHomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showNewChat = false
    @State private var query = ""
    /// Drives the accent glow on the search field while it's being edited.
    @FocusState private var searchFocused: Bool
    /// The sidebar selection: a familiar (drills into its threads in the detail
    /// column) or a thread/group (opens the chat directly). On iPad the detail
    /// fills the pane beside the list; on iPhone `NavigationSplitView` collapses
    /// and selecting pushes, so the drill-down behaviour is unchanged.
    @State private var selection: ChatRoute?
    /// Navigation *within* the detail column — e.g. a familiar's thread list
    /// pushing a conversation. Reset whenever the sidebar selection changes.
    @State private var detailPath: [ChatRoute] = []
    @State private var renamingThread: ChatThread?
    /// A thread awaiting delete confirmation (swipe or context menu).
    @State private var pendingDelete: ChatThread?
    /// Rail avatars aren't List rows, so familiar reordering happens in a
    /// dedicated drag-to-reorder sheet instead of List edit mode.
    @State private var showReorder = false
    /// Reveal archived chats in the list.
    @State private var showArchived = false
    /// Left slide-out drawer (menu button in the header).
    @State private var drawerOpen = false
    /// All-familiars roster sheet (drawer's Familiars destination).
    @State private var showFamiliars = false
    @State private var showProjects = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Anchors the iOS 18 zoom transition: thread rows mark themselves as
    /// sources; the pushed conversation zooms out of its row.
    @Namespace private var zoomNamespace

    var body: some View {
        ZStack(alignment: .leading) {
            splitView
                // The list stays visible behind the drawer — dimmed by the
                // drawer's scrim and nudged right for depth (unless the user
                // prefers reduced motion).
                .offset(x: drawerOpen && !reduceMotion ? 16 : 0)
                .animation(reduceMotion ? nil : .snappy(duration: 0.24), value: drawerOpen)
            ChatDrawer(isOpen: $drawerOpen,
                       openThread: { open(.thread($0)) },
                       newChat: { showNewChat = true },
                       openFamiliars: { showFamiliars = true })
        }
        // The drawer overlays this tab's content only, so the tab bar would
        // otherwise float above it — hide the bar while the drawer is open.
        .toolbar(drawerOpen ? .hidden : .automatic, for: .tabBar)
        .sheet(isPresented: $showFamiliars) {
            FamiliarsListView { open(.familiar($0)) }
        }
        .onAppear {
            #if DEBUG
            // Snapshot hook: `simctl launch … --ui-open-drawer` opens the
            // drawer on boot so automated screenshots can verify it.
            if ProcessInfo.processInfo.arguments.contains("--ui-open-drawer") {
                drawerOpen = true
            }
            if ProcessInfo.processInfo.arguments.contains("--ui-open-familiars") {
                showFamiliars = true
            }
            #endif
        }
    }

    private var splitView: some View {
        NavigationSplitView {
            Group {
                if app.familiars.isEmpty && app.threads.isEmpty {
                    emptyState
                } else if filteredFamiliars.isEmpty && recentThreads.isEmpty {
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
            .sheet(isPresented: $showNewChat) {
                NewChatView { thread in
                    showNewChat = false
                    open(.thread(thread))
                }
            }
            .fullScreenCover(isPresented: $showProjects) {
                ProjectsPanel { showProjects = false }
            }
            .refreshable {
                await app.loadFamiliars()
                await app.loadSessions()
            }
            // Sessions load once; reconnects and pull-to-refresh handle
            // subsequent reloads, so re-appearing tabs don't refetch the list.
            .task { if !app.sessionsLoaded { await app.loadSessions() } }
            .onAppear {
                openDeepLinkedThread()
                openRequestedFamiliar()
            }
            // A slash command (`/new`, `/familiar <name>`) or a task link asked to
            // open a specific thread — surface it in the detail column.
            .onChange(of: app.threadToOpen) { _, thread in
                guard let thread else { return }
                if lastThreadId != thread.id { open(.thread(thread)) }
                app.threadToOpen = nil
            }
            .onChange(of: app.familiarToOpen) { _, _ in openRequestedFamiliar() }
            .sidebarColumn()
        } detail: {
            detailColumn
        }
        // Keep the list visible beside the conversation on iPad; on iPhone the
        // split view still collapses to a single navigation stack.
        .navigationSplitViewStyle(.balanced)
        // A new sidebar selection starts a fresh detail navigation (so a familiar
        // opens at its thread list, not a stale pushed conversation).
        .onChange(of: selection) { _, _ in detailPath = [] }
    }

    /// The detail column: the selected familiar's thread list (which pushes a
    /// conversation onto `detailPath`), the selected conversation directly, or a
    /// placeholder on iPad when nothing is chosen yet.
    @ViewBuilder private var detailColumn: some View {
        NavigationStack(path: $detailPath) {
            Group {
                switch selection {
                case .familiar(let familiar):
                    FamiliarThreadsView(familiar: familiar, path: $detailPath,
                                        zoomNamespace: zoomNamespace)
                case .thread(let thread):
                    ChatView(thread: thread)
                case nil:
                    ContentUnavailableView {
                        Label("Select a chat", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Pick a familiar or conversation to start.")
                    }
                }
            }
            .navigationDestination(for: ChatRoute.self) { route in
                switch route {
                case .familiar(let familiar):
                    FamiliarThreadsView(familiar: familiar, path: $detailPath,
                                        zoomNamespace: zoomNamespace)
                case .thread(let thread):
                    chatDestination(thread)
                }
            }
        }
    }

    /// The pushed conversation, zooming out of its thread row (iOS 18 zoom
    /// transition; the row is the `matchedTransitionSource`). Reduce Motion
    /// keeps the standard push. Selection-driven opens (home list) have no
    /// row source and use the default presentation either way.
    @ViewBuilder
    private func chatDestination(_ thread: ChatThread) -> some View {
        if reduceMotion {
            ChatView(thread: thread)
        } else {
            ChatView(thread: thread)
                .navigationTransition(.zoom(sourceID: thread.id, in: zoomNamespace))
        }
    }

    /// Open a route in the detail column (clearing any in-progress detail
    /// navigation first), used by deep links and the new-chat sheet.
    private func open(_ route: ChatRoute) {
        detailPath = []
        selection = route
    }

    /// The id of the conversation currently shown in the detail column, if any
    /// (so a repeat `requestOpen` of the same thread doesn't re-select it). Covers
    /// both a directly-selected thread and one pushed under a familiar.
    private var lastThreadId: String? {
        if case .thread(let t) = detailPath.last { return t.id }
        if case .thread(let t) = selection { return t.id }
        return nil
    }

    /// Open a thread named by the `CAVE_OPEN_THREAD` launch env var. This is the
    /// same hook Phase 2 notification taps will use to jump straight into a chat.
    /// Start a brand-new chat with a familiar and open it (familiar-row action).
    private func startNewChat(with familiar: Familiar) {
        let thread = app.startFreshThread(familiarIds: [familiar.id])
        open(.thread(thread))
    }

    private func openDeepLinkedThread() {
        guard selection == nil,
              let id = ProcessInfo.processInfo.environment["CAVE_OPEN_THREAD"],
              let thread = app.threads.first(where: { $0.id == id }) else { return }
        open(.thread(thread))
    }

    private func openRequestedFamiliar() {
        guard let familiar = app.familiarToOpen else { return }
        open(.familiar(familiar))
        app.familiarToOpen = nil
    }

    /// Large-title header pinned to the top, mirroring the Read / Tasks tabs
    /// so every tab's title aligns at the same flush position.
    private var header: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                CircularIconButton(systemImage: "line.3.horizontal",
                                   active: drawerOpen,
                                   label: "Menu") {
                    drawerOpen = true
                }
                Text("Chats")
                    .font(.largeTitle.weight(.bold))
                Spacer()
                if canReorder {
                    Button("Reorder") { showReorder = true }
                        .font(.subheadline.weight(.medium))
                }
                CircularIconButton(systemImage: "folder",
                                   label: "Projects") {
                    showProjects = true
                }
                CircularIconButton(systemImage: "square.and.pencil",
                                   label: "New chat") {
                    showNewChat = true
                }
            }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search chats…", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($searchFocused)
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
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(chrome.bgRaised, in: Capsule())
            .overlay(Capsule().stroke(chrome.border.opacity(0.7), lineWidth: 1))
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .glassChrome(.top)
    }

    /// Reordering is only meaningful with ≥2 familiars and no active search
    /// filter (the sheet reorders the full, unfiltered list).
    private var canReorder: Bool {
        app.familiars.count > 1 && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var homeList: some View {
        List(selection: $selection) {
            Section {
                ForEach(recentThreads) { thread in
                    RecentThreadRow(thread: thread)
                    .tag(ChatRoute.thread(thread))
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    // Rows sit flush on the themed floor (design 1a); iPad keeps
                    // the default cell background so the sidebar selection
                    // highlight stays visible.
                    .listRowBackground(sizeClass == .compact ? Color.clear : nil)
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
                        Button { app.duplicateThread(thread) } label: {
                            Label("Duplicate", systemImage: "plus.square.on.square")
                        }
                        Button { app.setThreadPinned(thread, !thread.pinned) } label: {
                            Label(thread.pinned ? "Unpin" : "Pin",
                                  systemImage: thread.pinned ? "pin.slash" : "pin")
                        }
                        Button { app.setThreadMuted(thread, !thread.muted) } label: {
                            Label(thread.muted ? "Unmute" : "Mute",
                                  systemImage: thread.muted ? "bell" : "bell.slash")
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
                if recentThreads.isEmpty && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("No conversations yet — tap a familiar above to start one.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }
            } header: {
                Text("Recent")
                    .font(.caption.weight(.semibold))
                    .kerning(0.8)
                    .textCase(.uppercase)
            } footer: {
                if archivedCount > 0 {
                    Button {
                        withAnimation { showArchived.toggle() }
                    } label: {
                        Label(showArchived ? "Hide archived"
                                           : "Show \(archivedCount) archived",
                              systemImage: showArchived ? "chevron.up" : "archivebox")
                            .font(.footnote)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.plain)
        .themedListBackground()
        .threadRenameAlert($renamingThread) { thread, name in app.renameThread(thread, to: name) }
        .confirmationDialog("Delete this chat?",
                            isPresented: deleteDialogBinding,
                            titleVisibility: .visible,
                            presenting: pendingDelete) { thread in
            Button("Delete", role: .destructive) { app.deleteThread(thread) }
            Button("Cancel", role: .cancel) {}
        } message: { thread in Text(thread.title) }
        .sheet(isPresented: $showReorder) { ReorderFamiliarsSheet() }
    }

    /// The horizontal familiar rail (design 1a): 56pt avatars with presence
    /// dots and an unread accent dot, name below. Tapping drills into that
    /// familiar's thread list, exactly like the old vertical rows.
    private var familiarRail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 14) {
                ForEach(filteredFamiliars) { familiar in
                    FamiliarRailItem(familiar: familiar) {
                        open(.familiar(familiar))
                    } newChat: {
                        startNewChat(with: familiar)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 6)
        }
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    /// The unified "Recent" list (design 1a): every conversation — direct and
    /// group — newest first, pinned on top, filtered by the search query
    /// (title, a member's name, or message text).
    private var recentThreads: [ChatThread] {
        let base = app.threads.filter { showArchived || !$0.archived }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filtered = q.isEmpty ? base : base.filter { thread in
            if thread.title.lowercased().contains(q) { return true }
            if thread.familiarIds.compactMap(app.familiar)
                .contains(where: { $0.displayName.lowercased().contains(q) }) { return true }
            return thread.messages.contains { $0.text.lowercased().contains(q) }
        }
        return filtered.sorted { a, b in
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

    /// Number of archived chats (drives the show/hide-archived toggle).
    private var archivedCount: Int { app.threads.filter(\.archived).count }

    /// Floating bottom bar: a search field beside a circular compose button,
    /// styled after iOS Messages — accent-infused frosted glass that tracks the
    /// desktop theme and degrades to a solid surface under Reduce Transparency.
    private var bottomBar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($searchFocused)
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
            .glass(.control, in: Capsule())
            .accentGlow(active: searchFocused)

            // The Diary — Pencil-handwriting experiment. iPad only: the page is
            // sized for Pencil writing, so the entry point hides on iPhone.
            // Presented from RootView (app.diaryPresented) so a connection
            // flap swapping the tab tree can't dismiss it mid-reply.
            if sizeClass == .regular {
                Button {
                    app.diaryPresented = true
                } label: {
                    Image(systemName: "book.closed")
                        .font(.system(.title3, weight: .medium))
                        .scaledControlFrame(50)
                        .glass(.control, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open the Diary — write with Apple Pencil")
            }

            Button {
                showNewChat = true
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(.title3, weight: .medium))
                    .scaledControlFrame(50)
                    .glass(.control, in: Circle())
                    .accentGlow(active: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("New chat")
            .keyboardShortcut("n", modifiers: .command)
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

/// One familiar on the horizontal rail: 56pt avatar with presence dot, an
/// accent unread dot at the top corner, and the name beneath.
struct FamiliarRailItem: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let familiar: Familiar
    var open: () -> Void
    var newChat: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(spacing: 6) {
                AvatarView(familiar: familiar,
                           url: app.client?.avatarURL(for: familiar),
                           size: 56, showStatus: true)
                    .overlay(alignment: .topTrailing) {
                        if app.hasUnread(familiar.id) {
                            Circle()
                                .fill(chrome.accent)
                                .overlay(Circle().strokeBorder(chrome.bgBase, lineWidth: 2))
                                .frame(width: 12, height: 12)
                                .offset(x: 1, y: -1)
                        }
                    }
                Text(familiar.displayName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(width: 62)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(action: newChat) {
                Label("New chat", systemImage: "square.and.pencil")
            }
            if app.hasUnread(familiar.id) {
                Button { app.markFamiliarViewed([familiar.id]) } label: {
                    Label("Mark all read", systemImage: "checkmark.circle")
                }
            }
        }
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Opens chats with this familiar")
    }

    private var accessibilityText: String {
        var parts: [String] = [familiar.displayName]
        if app.hasUnread(familiar.id) { parts.append("unread") }
        let count = app.threadCount(for: familiar.id)
        parts.append(count == 1 ? "1 chat" : "\(count) chats")
        return parts.joined(separator: ", ")
    }
}

/// A conversation on the unified "Recent" list (design 1a): 46pt avatar,
/// name + relative time on the top line, a one-line preview below — with a
/// bold sender prefix in group chats — and an accent dot when unread.
struct RecentThreadRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let thread: ChatThread

    private var familiars: [Familiar] { thread.familiarIds.compactMap(app.familiar) }
    private var lastMessage: DisplayMessage? { thread.messages.last }

    var body: some View {
        HStack(spacing: 13) {
            if thread.isGroup {
                AvatarClusterView(familiars: familiars, size: 42)
            } else {
                AvatarView(familiar: familiars.first,
                           url: familiars.first.flatMap { app.client?.avatarURL(for: $0) },
                           size: 42, showStatus: true)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(thread.title).font(.headline).lineLimit(1)
                    if thread.pinned {
                        Image(systemName: "pin.fill")
                            .font(.caption2).foregroundStyle(.orange)
                            .accessibilityLabel("Pinned")
                    }
                    if thread.muted {
                        Image(systemName: "bell.slash.fill")
                            .font(.caption2).foregroundStyle(.secondary)
                            .accessibilityLabel("Muted")
                    }
                    if thread.isGroup {
                        Image(systemName: "person.2.fill")
                            .font(.caption2).foregroundStyle(.secondary)
                            .accessibilityLabel("Group chat")
                    }
                    Spacer(minLength: 8)
                    Text(thread.updatedAt, format: .relative(presentation: .numeric))
                        .font(.caption).foregroundStyle(.tertiary)
                }
                preview
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if isUnread {
                Text("1")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(chrome.accentForeground)
                    .frame(minWidth: 20, minHeight: 20)
                    .background(chrome.accent, in: Capsule())
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
        // Collapse title, status glyphs, time, and preview into one spoken element.
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    /// Newer activity than the last time this thread's familiars were viewed,
    /// and not something you just said yourself.
    private var isUnread: Bool {
        guard lastMessage?.role != .user,
              let boundary = app.seenBoundary(for: thread) else { return false }
        return thread.updatedAt > boundary
    }

    @ViewBuilder private var preview: some View {
        if let draftText = app.threadDrafts[thread.id] {
            // A persisted unsent draft outranks the last-message preview
            // (standard messenger affordance — makes drafts discoverable).
            Text("Draft: ").foregroundStyle(chrome.accent)
                + Text(draftText.replacingOccurrences(of: "\n", with: " "))
        } else if let last = lastMessage {
            if last.streaming && last.text.isEmpty {
                Text("…")
            } else if let prefix = senderPrefix(for: last) {
                Text(prefix + ": ").foregroundStyle(.primary).fontWeight(.medium)
                    + Text(flattened(last.text))
            } else {
                Text(flattened(last.text))
            }
        } else {
            Text("Tap to start chatting")
        }
    }

    /// "You" for your own last message; the sender's name in group chats
    /// (design 1a shows **Sable:** on group rows). Direct familiar replies
    /// carry no prefix — the row's title already names them.
    private func senderPrefix(for message: DisplayMessage) -> String? {
        if message.role == .user { return "You" }
        guard thread.isGroup else { return nil }
        return message.familiarId.flatMap { app.familiar($0)?.displayName }
    }

    private func flattened(_ text: String) -> String {
        text.replacingOccurrences(of: "\n", with: " ")
    }

    /// One spoken summary of the row: title, status, last activity, preview.
    private var accessibilityText: String {
        var parts: [String] = [thread.title]
        if isUnread { parts.append("unread") }
        if thread.isGroup { parts.append("group chat") }
        if thread.pinned { parts.append("pinned") }
        if thread.muted { parts.append("muted") }
        parts.append("last active " + Self.relativeFormatter.localizedString(for: thread.updatedAt, relativeTo: Date()))
        if let draftText = app.threadDrafts[thread.id] {
            parts.append("draft: " + draftText)
        } else if let last = lastMessage {
            let prefix = senderPrefix(for: last).map { $0 + ": " } ?? ""
            parts.append(prefix + flattened(last.text))
        }
        return parts.joined(separator: ", ")
    }

    private static let relativeFormatter = RelativeDateTimeFormatter()
}

/// Drag-to-reorder sheet for the familiar rail (rail avatars aren't List rows,
/// so reordering lives here instead of List edit mode).
struct ReorderFamiliarsSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(app.familiars) { familiar in
                    FamiliarRow(familiar: familiar)
                }
                .onMove { source, destination in
                    app.moveFamiliar(fromOffsets: source, toOffset: destination)
                }
            }
            .listStyle(.plain)
            .themedListBackground()
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Reorder familiars")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .themedSheetBackground()
        .presentationDetents([.medium, .large])
    }
}

/// A familiar row (avatar, name, role, trailing chat count + last activity),
/// used by the reorder sheet.
struct FamiliarRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let familiar: Familiar

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(familiar: familiar,
                       url: app.client?.avatarURL(for: familiar),
                       size: 48, showStatus: true)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    // Unread: activity newer than the last time you opened it.
                    if app.hasUnread(familiar.id) {
                        Circle().fill(chrome.accent).frame(width: 7, height: 7)
                    }
                    Text(familiar.displayName).font(.headline).lineLimit(1)
                }
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
        // Read the whole row as one VoiceOver element instead of four fragments.
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Opens chats with this familiar")
    }

    /// One spoken summary of the row: name, role, chat count, last activity.
    private var accessibilityText: String {
        var parts: [String] = [familiar.displayName]
        if app.hasUnread(familiar.id) { parts.append("unread") }
        if let role = familiar.role, !role.isEmpty { parts.append(role) }
        let count = app.threadCount(for: familiar.id)
        parts.append(count == 1 ? "1 chat" : "\(count) chats")
        if let last = app.lastActivity(for: familiar.id) {
            parts.append("last active " + Self.relativeFormatter.localizedString(for: last, relativeTo: Date()))
        }
        return parts.joined(separator: ", ")
    }

    private static let relativeFormatter = RelativeDateTimeFormatter()
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
                            .accessibilityLabel("Pinned")
                    }
                    if thread.muted {
                        Image(systemName: "bell.slash.fill")
                            .font(.caption2).foregroundStyle(.secondary)
                            .accessibilityLabel("Muted")
                    }
                    if thread.isGroup {
                        Image(systemName: "person.2.fill")
                            .font(.caption2).foregroundStyle(.secondary)
                            .accessibilityLabel("Group chat")
                    }
                    Spacer()
                    Text(thread.updatedAt, format: .relative(presentation: .numeric))
                        .font(.caption).foregroundStyle(.tertiary)
                }
                if let draftText = app.threadDrafts[thread.id] {
                    // A persisted unsent draft outranks the last-message
                    // preview (standard messenger affordance — makes drafts
                    // discoverable from the list).
                    (Text("Draft: ").foregroundStyle(Color.accentColor)
                        + Text(draftText.replacingOccurrences(of: "\n", with: " ")))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                } else {
                    Text(previewText)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        // Collapse title, status glyphs, time, and preview into one spoken element.
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    /// One spoken summary of the row: title, status, last activity, preview.
    private var accessibilityText: String {
        var parts: [String] = [thread.title]
        if thread.isGroup { parts.append("group chat") }
        if thread.pinned { parts.append("pinned") }
        if thread.muted { parts.append("muted") }
        parts.append("last active " + Self.relativeFormatter.localizedString(for: thread.updatedAt, relativeTo: Date()))
        if let draftText = app.threadDrafts[thread.id] {
            parts.append("draft: " + draftText)
        } else {
            parts.append(previewText)
        }
        return parts.joined(separator: ", ")
    }

    private static let relativeFormatter = RelativeDateTimeFormatter()

    private var previewText: String {
        guard let last = lastMessage else { return "Tap to start chatting" }
        if last.streaming && last.text.isEmpty { return "…" }
        let prefix = last.role == .user ? "\(app.operatorDisplayName): " : ""
        return prefix + last.text.replacingOccurrences(of: "\n", with: " ")
    }
}
