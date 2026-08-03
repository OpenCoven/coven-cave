import SwiftUI

/// A destination on the Chats navigation stack. Selecting a familiar drills into
/// that familiar's thread list; selecting a thread opens the conversation. Both
/// are pushed onto one shared stack so the back button walks the chain.
enum ChatRoute: Hashable {
    case familiar(Familiar)
    case thread(ChatThread)
}

/// The Chats destination, shaped like Messages: one vertical list of
/// *familiars*, each row previewing the last thing said in that familiar's
/// landing chat. There is no cross-familiar "Recent" list — a familiar is the
/// conversation, and its other sessions live one level down.
struct ChatsHomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showNewChat = false
    @State private var initialNewChatFamiliarIds: [String] = []
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
    /// Familiar reordering happens in a dedicated drag-to-reorder sheet rather
    /// than List edit mode, which would fight the selection binding.
    @State private var showReorder = false
    /// All-familiars roster sheet.
    @State private var showFamiliars = false
    @State private var showProjects = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Anchors the iOS 18 zoom transition: thread rows mark themselves as
    /// sources; the pushed conversation zooms out of its row.
    @Namespace private var zoomNamespace

    var body: some View {
        splitView
        .sheet(isPresented: $showFamiliars) {
            FamiliarsListView { familiar in
                showFamiliars = false
                initialNewChatFamiliarIds = [familiar.id]
                Task { @MainActor in
                    await Task.yield()
                    showNewChat = true
                }
            }
        }
        .onAppear {
            #if DEBUG
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
                    if let error = app.familiarsError ?? app.sessionsError {
                        loadFailure(error)
                    } else {
                        emptyState
                    }
                } else if filteredFamiliars.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    homeList
                }
            }
            // Flush large-title header at the very top, matching Read / Tasks
            // (which hide the nav bar and supply their own top inset) so
            // every destination's header aligns. Search + compose stay in the bottom bar.
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) { header }
            .safeAreaInset(edge: .bottom, spacing: 0) { homeSearchBar }
            .sheet(
                isPresented: $showNewChat,
                onDismiss: { initialNewChatFamiliarIds = [] }
            ) {
                NewChatView(initialFamiliarIds: initialNewChatFamiliarIds) { thread in
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
            // subsequent reloads, so re-appearing destinations don't refetch the list.
            .task { if !app.sessionsLoaded { await app.loadSessions() } }
            .onAppear {
                consumeLaunchThreadIntent()
                consumeGlobalRequests()
                selectMostRecentThreadIfNeeded()
            }
            .onChange(of: app.threads.map(\.id)) { _, _ in
                consumeLaunchThreadIntent()
                selectMostRecentThreadIfNeeded()
            }
            // A slash command (`/new`, `/familiar <name>`) or a task link asked to
            // open a specific thread — surface it in the detail column.
            .onChange(of: app.threadToOpen) { _, thread in
                consumeThreadRequest(thread)
            }
            .onChange(of: app.newChatRequested) { _, requested in
                guard requested else { return }
                presentNewChat()
                app.newChatRequested = false
            }
            .onChange(of: app.chatSearchRequested) { _, requested in
                guard requested else { return }
                searchFocused = true
                app.chatSearchRequested = false
            }
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
                    familiarChat(familiar)
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

    /// A familiar's conversation: its landing thread, or an invitation to start
    /// one. Session switching happens in ChatView's config card, not here.
    @ViewBuilder
    private func familiarChat(_ familiar: Familiar) -> some View {
        if let thread = app.landingDirectThread(for: familiar.id) {
            ChatView(thread: thread)
        } else {
            ContentUnavailableView {
                Label("No chats with \(familiar.displayName)", systemImage: "bubble.left.and.bubble.right")
            } description: {
                Text("Start one to begin.")
            } actions: {
                Button("New chat") { startNewChat(with: familiar) }
            }
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

    /// Start a brand-new chat with a familiar and open it (familiar-row action).
    private func startNewChat(with familiar: Familiar) {
        presentNewChat(familiarIds: [familiar.id])
    }

    private func presentNewChat(familiarIds: [String] = []) {
        initialNewChatFamiliarIds = familiarIds
        showNewChat = true
    }

    /// Large-title header pinned to the top, mirroring the Read / Tasks
    /// destinations so every destination title aligns at the same flush position.
    private var header: some View {
        HStack(spacing: 10) {
            CircularIconButton(systemImage: "line.3.horizontal",
                               label: "Open navigation") {
                app.navigationDrawerOpen = true
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
                presentNewChat()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .glassChrome(.top)
    }

    private var homeSearchBar: some View {
        HStack(spacing: 10) {
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
            .frame(minHeight: 44)
            .background(chrome.bgRaised, in: Capsule())
            .overlay(Capsule().stroke(chrome.border.opacity(0.7), lineWidth: 1))

            CircularIconButton(systemImage: "square.and.pencil",
                               label: "New chat") {
                presentNewChat()
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .glassChrome(.bottom)
    }

    /// Reordering is only meaningful with ≥2 familiars and no active search
    /// filter (the sheet reorders the full, unfiltered list).
    private var canReorder: Bool {
        app.familiars.count > 1 && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var homeList: some View {
        List(selection: $selection) {
            ForEach(filteredFamiliars) { familiar in
                FamiliarConversationRow(familiar: familiar)
                    .tag(ChatRoute.familiar(familiar))
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    // Rows sit flush on the themed floor (design 1a); iPad keeps
                    // the default cell background so the sidebar selection
                    // highlight stays visible.
                    .listRowBackground(sizeClass == .compact ? Color.clear : nil)
                    .swipeActions(edge: .leading) {
                        Button { startNewChat(with: familiar) } label: {
                            Label("New chat", systemImage: "square.and.pencil")
                        }
                        .tint(.accentColor)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if app.hasUnread(familiar.id) {
                            Button { app.markFamiliarViewed([familiar.id]) } label: {
                                Label("Mark read", systemImage: "checkmark.circle")
                            }
                            .tint(.indigo)
                        }
                    }
                    .contextMenu {
                        Button { startNewChat(with: familiar) } label: {
                            Label("New chat", systemImage: "square.and.pencil")
                        }
                        if app.hasUnread(familiar.id) {
                            Button { app.markFamiliarViewed([familiar.id]) } label: {
                                Label("Mark all read", systemImage: "checkmark.circle")
                            }
                        }
                    }
            }
        }
        .listStyle(.plain)
        .themedListBackground()
        .sheet(isPresented: $showReorder) { ReorderFamiliarsSheet() }
    }

    private func consumeGlobalRequests() {
        consumeThreadRequest(app.threadToOpen)
        if app.newChatRequested {
            presentNewChat()
            app.newChatRequested = false
        }
        if app.chatSearchRequested {
            searchFocused = true
            app.chatSearchRequested = false
        }
    }

    private func consumeLaunchThreadIntent() {
        guard let thread = app.consumeLaunchThreadIntent() else { return }
        open(.thread(thread))
    }

    /// Open Chats at the latest active conversation without stealing focus from
    /// a deep link, cross-view handoff, New Chat, or an existing selection.
    private func selectMostRecentThreadIfNeeded() {
        guard selection == nil,
              !showNewChat,
              app.threadToOpen == nil,
              app.launchThreadId == nil,
              !app.newChatRequested,
              let thread = app.mostRecentThread
        else { return }
        open(.thread(thread))
    }

    /// Consume a cross-destination thread handoff on first appearance and on
    /// later updates. Clearing the one-shot intent prevents re-appearance from
    /// reopening the same conversation.
    private func consumeThreadRequest(_ thread: ChatThread?) {
        guard let thread else { return }
        if lastThreadId != thread.id { open(.thread(thread)) }
        app.threadToOpen = nil
    }

    /// Familiars matching the search query (name or role). Empty query → all.
    private var filteredFamiliars: [Familiar] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return app.familiars }
        return app.familiars.filter {
            $0.displayName.lowercased().contains(q) || ($0.role?.lowercased().contains(q) ?? false)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No familiars yet", systemImage: "bubble.left.and.bubble.right")
        } description: {
            Text("Pull to refresh once your desktop is connected, or start a group chat.")
        } actions: {
            Button("New chat") { presentNewChat() }
                .buttonStyle(.borderedProminent)
        }
    }

    private func loadFailure(_ error: String) -> some View {
        ContentUnavailableView {
            Label("Couldn’t load chats", systemImage: "exclamationmark.triangle")
        } description: {
            Text(error)
        } actions: {
            Button("Retry") {
                Task {
                    await app.loadFamiliars()
                    await app.loadSessions()
                }
            }
            .buttonStyle(.borderedProminent)
        }
    }
}

/// One familiar as an iMessage-style conversation row: avatar, name, a preview
/// of the last thing said in its landing chat, and when. Selection is driven by
/// the enclosing `List` tag, so the row itself is not a Button — that would
/// swallow the sidebar selection on iPad.
struct FamiliarConversationRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let familiar: Familiar

    private var thread: ChatThread? { app.landingDirectThread(for: familiar.id) }

    private var preview: String {
        guard let text = thread?.messages.last?.text, !text.isEmpty else {
            return "No messages yet"
        }
        return text.replacingOccurrences(of: "\n", with: " ")
    }

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(familiar: familiar,
                       url: app.client?.avatarURL(for: familiar),
                       size: 48, showStatus: true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(familiar.displayName)
                        .font(.body.weight(.semibold))
                        .lineLimit(1)
                    if app.hasUnread(familiar.id) {
                        Circle().fill(chrome.accent).frame(width: 8, height: 8)
                    }
                    Spacer(minLength: 4)
                    if let updated = thread?.updatedAt {
                        Text(updated, format: .relative(presentation: .numeric))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Text(preview)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(familiar.displayName). \(preview)")
    }
}

/// Drag-to-reorder sheet for the Chats home familiar list (the home List owns a
/// selection binding, so reordering lives here instead of List edit mode).
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
