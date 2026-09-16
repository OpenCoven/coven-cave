import SwiftUI

/// A destination on the Chats navigation stack. Selecting a familiar drills into
/// that familiar's thread list; selecting a thread opens the conversation. Both
/// are pushed onto one shared stack so the back button walks the chain.
enum ChatRoute: Hashable {
    case familiar(Familiar)
    case thread(ChatThread)
}

@MainActor
enum ChatNewConversationContext {
    static func fixedFamiliarId(
        selection: ChatRoute?,
        detailPath: [ChatRoute]
    ) -> String? {
        guard let visibleRoute = detailPath.last ?? selection else { return nil }
        switch visibleRoute {
        case .familiar(let familiar):
            return familiar.id
        case .thread(let thread):
            let familiarIds = ChatProjectSelection.familiarKey(thread.familiarIds)
            return familiarIds.count == 1 ? familiarIds[0] : nil
        }
    }
}

/// Global, resumable conversations. A chat owns its project binding; the
/// sidebar's search, archive filter, and selection never change that binding.
struct ChatsHomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showNewChat = false
    @State private var fixedNewChatFamiliarId: String?
    @State private var query = ""
    /// Drives the accent glow on the search field while it's being edited.
    @FocusState private var searchFocused: Bool
    /// The sidebar selection: a familiar (drills into its threads in the detail
    /// column) or a thread/group (opens the chat directly). On iPad the detail
    /// fills the pane beside the list; on iPhone `NavigationSplitView` collapses
    /// and selecting pushes, so the drill-down behaviour is unchanged.
    @State private var selection: ChatRoute?
    @State private var preferredCompactColumn: NavigationSplitViewColumn = .sidebar
    /// Navigation *within* the detail column — e.g. a familiar's thread list
    /// pushing a conversation. Reset whenever the sidebar selection changes.
    @State private var detailPath: [ChatRoute] = []
    @State private var showArchived = false
    @State private var renamingThread: ChatThread?
    @State private var pendingDelete: ChatThread?
    @State private var exportArchive: ExportArchive?
    @State private var appliedPreviewLaunchIntent = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Anchors the iOS 18 zoom transition: thread rows mark themselves as
    /// sources; the pushed conversation zooms out of its row.
    @Namespace private var zoomNamespace

    var body: some View {
        splitView
        .threadRenameAlert($renamingThread) { thread, name in
            app.renameThread(thread, to: name)
        }
        .confirmationDialog(
            "Delete this chat?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { thread in
            Button("Delete", role: .destructive) {
                if lastThreadId == thread.id {
                    detailPath = []
                    selection = nil
                }
                app.deleteThread(thread)
            }
            Button("Cancel", role: .cancel) {}
        } message: { thread in
            Text(thread.title)
        }
        .sheet(item: $exportArchive) { archive in
            ActivityView(items: [archive.url])
        }
        .onAppear {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-open-familiars") {
                presentGeneralNewChat()
            }
            applyPreviewLaunchIntent()
            #endif
        }
    }

    private var splitView: some View {
        let snapshot = ChatListSnapshot(
            threads: app.chatThreads,
            sessions: app.chatServerSessions,
            familiars: app.familiars,
            query: query,
            includeArchived: showArchived
        )
        return NavigationSplitView(preferredCompactColumn: $preferredCompactColumn) {
            Group {
                if snapshot.entries.isEmpty && query.isEmpty && snapshot.archivedCount == 0 {
                    if let error = app.familiarsError ?? app.sessionsError {
                        loadFailure(error)
                    } else {
                        emptyState
                    }
                } else if snapshot.entries.isEmpty && !query.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    homeList(snapshot)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                if app.selectedTab != .settings { header(snapshot) }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if app.selectedTab != .settings { homeSearchBar }
            }
            .sheet(
                isPresented: $showNewChat,
                onDismiss: {
                    fixedNewChatFamiliarId = nil
                }
            ) {
                NewChatView(
                    fixedFamiliarId: fixedNewChatFamiliarId
                ) { thread in
                    showNewChat = false
                    open(.thread(thread))
                }
            }
            .refreshable {
                await app.loadFamiliars()
                await app.loadSessions()
            }
            // Sessions load once; reconnects and pull-to-refresh handle
            // subsequent reloads, so re-appearing destinations don't refetch the list.
            .task { if !app.sessionsLoaded { await app.loadSessions() } }
            .onAppear {
                _ = app.resolvePendingProjectNavigationIntent()
                consumeGlobalRequests()
                selectMostRecentThreadIfNeeded()
            }
            .onChange(of: app.threads.map(\.id)) { _, _ in
                _ = app.resolvePendingProjectNavigationIntent()
                selectMostRecentThreadIfNeeded()
            }
            // A slash command (`/new`, `/familiar <name>`) or a chat link asked to
            // open a specific thread — surface it in the detail column.
            .onChange(of: app.threadToOpen) { _, thread in
                consumeThreadRequest(thread)
            }
            .onChange(of: app.newChatRequested) { _, requested in
                guard requested else { return }
                presentContextualNewChat()
                app.newChatRequested = false
            }
            .onChange(of: app.chatSearchRequested) { _, requested in
                guard requested else { return }
                revealChatSearch()
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
        .onChange(of: selection) { _, selected in
            detailPath = []
            preferredCompactColumn = selected == nil ? .sidebar : .detail
        }
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
                    chatDestination(thread, applyZoom: false)
                case nil:
                    ContentUnavailableView {
                        Label("Select a chat", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Choose a conversation, or start a new chat.")
                    }
                }
            }
            .navigationDestination(for: ChatRoute.self) { route in
                switch route {
                case .familiar(let familiar):
                    familiarChat(familiar)
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
        chatDestination(thread, applyZoom: true)
    }

    /// Threads whose roots are malformed stay visible for recovery/export/delete
    /// in Unassigned, but they never mount a sendable chat surface.
    @ViewBuilder
    private func chatDestination(
        _ thread: ChatThread,
        applyZoom: Bool,
        recoveryAction: (() -> Void)? = nil
    ) -> some View {
        switch app.threadOpenFailure(for: thread) {
        case nil:
            if !applyZoom {
                ChatView(thread: thread)
                    .id(thread.id)
            } else if reduceMotion {
                ChatView(thread: thread)
                    .id(thread.id)
            } else {
                ChatView(thread: thread)
                    .id(thread.id)
                    .navigationTransition(.zoom(sourceID: thread.id, in: zoomNamespace))
            }
        case .projectCatalogUnavailable?:
            ProgressView("Loading project context…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .invalidProjectMetadata?:
            ThreadOpenRecoveryView(
                actionTitle: recoveryAction == nil ? nil : "View chat list",
                action: recoveryAction
            )
        }
    }

    /// A familiar's conversation: its landing thread, or an invitation to start
    /// one. Session switching happens in ChatView's config card, not here.
    @ViewBuilder
    private func familiarChat(_ familiar: Familiar) -> some View {
        if let thread = app.globalLandingDirectThread(for: familiar.id) {
            chatDestination(
                thread,
                applyZoom: false,
                recoveryAction: { detailPath = [.familiar(familiar)] }
            )
        } else if let session = app.globalServerOnlySessions(for: familiar.id).first {
            FamiliarServerLandingView(
                familiar: familiar,
                session: session,
                recoveryAction: { detailPath = [.familiar(familiar)] }
            )
        } else {
            ContentUnavailableView {
                Label("No chats with \(familiar.displayName)", systemImage: "bubble.left.and.bubble.right")
            } description: {
                Text("Choose this familiar and its chat access to begin.")
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
        presentNewChat(fixedFamiliarId: familiar.id)
    }

    private func presentNewChat(fixedFamiliarId: String? = nil) {
        self.fixedNewChatFamiliarId = fixedFamiliarId
        showNewChat = true
    }

    private func presentContextualNewChat() {
        presentNewChat(
            fixedFamiliarId: ChatNewConversationContext.fixedFamiliarId(
                selection: selection,
                detailPath: detailPath
            )
        )
    }

    private func presentGeneralNewChat() {
        presentNewChat()
    }

    private func header(_ snapshot: ChatListSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                CircularIconButton(systemImage: "line.3.horizontal",
                                   label: "Open navigation") {
                    app.navigationDrawerOpen = true
                }
                if dynamicTypeSize.isAccessibilitySize {
                    Text("Chats")
                        .font(.system(.title2, design: .serif).weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                } else if sizeClass == .regular {
                    EditorialSurfaceTitle(title: "Chats", large: true)
                } else {
                    EditorialSurfaceTitle(
                        title: "Chats",
                        detail: visibleConversationLabel(snapshot.entries.count),
                        large: true
                    )
                }
                Spacer(minLength: 0)
                Menu {
                    Button { showArchived.toggle() } label: {
                        Label(
                            showArchived ? "Hide archived" : "Show archived (\(snapshot.archivedCount))",
                            systemImage: "archivebox"
                        )
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Chat list options")
            }
            if dynamicTypeSize.isAccessibilitySize || sizeClass == .regular,
               let detail = visibleConversationLabel(snapshot.entries.count) {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(chrome.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .glassChrome(.top)
    }

    private var homeSearchBar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 18))
                    .foregroundStyle(searchFocused ? chrome.accent : chrome.textSecondary)
                TextField("Search chats…", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($searchFocused)
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: dockControlSize)
            .glass(.control, in: Capsule())
            .accentGlow(active: searchFocused)

            Button {
                presentContextualNewChat()
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(chrome.accentForeground)
                    .frame(width: dockControlSize, height: dockControlSize)
                    .background(
                        chrome.accentGradient,
                        in: RoundedRectangle(cornerRadius: dockCornerRadius, style: .continuous)
                    )
            }
            .buttonStyle(.glassPress)
            .accessibilityLabel("New chat")
        }
        .padding(verticalSizeClass == .compact ? 6 : 8)
        .frame(maxWidth: sizeClass == .regular ? 560 : .infinity)
        .glass(.elevated, cornerRadius: verticalSizeClass == .compact ? 20 : 24)
        .padding(.horizontal, sizeClass == .regular ? 24 : 12)
        .padding(.bottom, verticalSizeClass == .compact ? 4 : 8)
        .frame(maxWidth: .infinity)
    }

    private func visibleConversationLabel(_ count: Int) -> String? {
        guard count > 0 else { return nil }
        return count == 1
            ? "1 conversation"
            : "\(count) conversations"
    }

    private var dockControlSize: CGFloat {
        verticalSizeClass == .compact ? 44 : 48
    }

    private var dockCornerRadius: CGFloat {
        verticalSizeClass == .compact ? 14 : 16
    }

    private func homeList(_ snapshot: ChatListSnapshot) -> some View {
        List(selection: $selection) {
            ForEach(snapshot.entries) { entry in
                Group {
                    switch entry.conversation {
                    case .local(let thread):
                        ThreadRow(
                            thread: thread,
                            activityAt: entry.updatedAt,
                            isSelected: sizeClass == .regular && selection == .thread(thread)
                        )
                            .tag(ChatRoute.thread(thread))
                            .matchedTransitionSource(id: thread.id, in: zoomNamespace)
                            .contextMenu { threadActions(thread, activityAt: entry.updatedAt) }
                            .swipeActions(edge: .leading) {
                                Button { app.setThreadPinned(thread, !thread.pinned) } label: {
                                    Label(thread.pinned ? "Unpin" : "Pin", systemImage: "pin")
                                }
                                .tint(chrome.accent)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) { pendingDelete = thread } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                Button { app.setThreadArchived(thread, !thread.archived) } label: {
                                    Label(thread.archived ? "Unarchive" : "Archive", systemImage: "archivebox")
                                }
                                .tint(chrome.accent)
                            }
                    case .server(let session):
                        Button {
                            _ = app.requestOpenServerSession(session, fallbackFamiliarId: session.familiarId)
                        } label: {
                            ServerSessionRow(session: session)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .accessibilityIdentifier("Chat row \(entry.id)")
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(sizeClass == .compact ? Color.clear : nil)
            }
            if snapshot.entries.isEmpty && snapshot.archivedCount > 0 {
                Button("Show archived chats (\(snapshot.archivedCount))") { showArchived = true }
                    .frame(minHeight: 44)
            }
        }
        .listStyle(.plain)
        .themedListBackground()
    }

    @ViewBuilder
    private func threadActions(_ thread: ChatThread, activityAt: Date) -> some View {
        Button { renamingThread = thread } label: {
            Label("Rename", systemImage: "pencil")
        }
        if !app.isRecoveryOnlyThread(thread) {
            Button { _ = app.duplicateThread(thread) } label: {
                Label("Duplicate", systemImage: "plus.square.on.square")
            }
        }
        Button { app.setThreadPinned(thread, !thread.pinned) } label: {
            Label(thread.pinned ? "Unpin" : "Pin", systemImage: "pin")
        }
        Button { app.setThreadMuted(thread, !thread.muted) } label: {
            Label(thread.muted ? "Unmute" : "Mute", systemImage: "bell")
        }
        Button { app.setThreadArchived(thread, !thread.archived) } label: {
            Label(thread.archived ? "Unarchive" : "Archive", systemImage: "archivebox")
        }
        Button {
            app.markThreadViewed(thread, through: activityAt)
        } label: {
            Label("Mark read", systemImage: "checkmark.circle")
        }
        Button {
            do {
                exportArchive = ExportArchive(url: try app.exportThreadsZip([thread]))
            } catch {
                app.showToast("Could not export chat: \(error.localizedDescription)",
                              systemImage: "exclamationmark.triangle", style: .warning)
            }
        } label: {
            Label("Export chat", systemImage: "square.and.arrow.up")
        }
        Button(role: .destructive) { pendingDelete = thread } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    private func consumeGlobalRequests() {
        consumeThreadRequest(app.threadToOpen)
        if app.newChatRequested {
            presentContextualNewChat()
            app.newChatRequested = false
        }
        if app.chatSearchRequested {
            revealChatSearch()
        }
    }

    private func revealChatSearch() {
        if sizeClass == .compact {
            detailPath = []
            selection = nil
            preferredCompactColumn = .sidebar
        }
        searchFocused = true
        app.chatSearchRequested = false
    }

    /// Fill an empty iPad detail without stealing the iPhone's conversation list.
    private func selectMostRecentThreadIfNeeded() {
        #if DEBUG
        guard !ProcessInfo.processInfo.arguments.contains("--ui-preview-chats-home") else { return }
        #endif
        guard sizeClass == .regular,
              selection == nil,
              !showNewChat,
              app.threadToOpen == nil,
              app.pendingProjectNavigationIntent == nil,
              !app.newChatRequested
        else { return }

        if let thread = app.chatThreads.filter({ !$0.archived })
            .max(by: { $0.updatedAt < $1.updatedAt }) {
            open(.thread(thread))
        }
    }

    /// Consume a cross-destination thread handoff on first appearance and on
    /// later updates. Clearing the one-shot intent prevents re-appearance from
    /// reopening the same conversation.
    private func consumeThreadRequest(_ thread: ChatThread?) {
        guard let thread else { return }
        if lastThreadId != thread.id { open(.thread(thread)) }
        preferredCompactColumn = .detail
        app.threadToOpen = nil
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Start a conversation", systemImage: "bubble.left.and.bubble.right")
        } description: {
            Text("Choose a familiar for a new chat. Your conversations will stay here.")
        } actions: {
            Button("New chat") { presentGeneralNewChat() }
                .buttonStyle(.borderedProminent)
        }
    }

    #if DEBUG
    private func applyPreviewLaunchIntent() {
        let arguments = ProcessInfo.processInfo.arguments
        guard !appliedPreviewLaunchIntent,
              arguments.contains("--ui-open-contextual-new-chat")
        else { return }

        appliedPreviewLaunchIntent = true
        if let thread = app.chatThreads.filter({ !$0.archived })
            .max(by: { $0.updatedAt < $1.updatedAt }) {
            selection = .thread(thread)
        }
        presentContextualNewChat()
    }
    #endif

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

private struct FamiliarServerLandingView: View {
    @Environment(AppModel.self) private var app
    let familiar: Familiar
    let session: SessionRow
    var recoveryAction: (() -> Void)? = nil

    @State private var thread: ChatThread?

    var body: some View {
        Group {
            if let thread {
                switch app.threadOpenFailure(for: thread) {
                case nil:
                    ChatView(thread: thread)
                        .id(thread.id)
                case .projectCatalogUnavailable?:
                    ProgressView("Loading project context…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .invalidProjectMetadata?:
                    ThreadOpenRecoveryView(
                        actionTitle: recoveryAction == nil ? nil : "View chat list",
                        action: recoveryAction
                    )
                }
            } else {
                ProgressView("Opening chat…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onAppear {
                        guard thread == nil else { return }
                        thread = app.openServerSession(session, familiarId: familiar.id)
                    }
            }
        }
    }
}

private struct ThreadOpenRecoveryView: View {
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        ContentUnavailableView {
            Label("This chat needs recovery", systemImage: "folder.badge.questionmark")
        } description: {
            Text(
                "Its project metadata could not be resolved. It stays in your chat list so you can export or delete it, but sending is unavailable."
            )
        } actions: {
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
            }
        }
    }
}

struct ThreadRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let thread: ChatThread
    var activityAt: Date? = nil
    var isSelected = false

    private var familiars: [Familiar] { thread.familiarIds.compactMap(app.familiar) }
    private var lastMessage: DisplayMessage? { thread.messages.last }
    private var activityDate: Date { max(activityAt ?? thread.updatedAt, thread.updatedAt) }
    private var primaryColor: Color { isSelected ? chrome.accentForeground : chrome.textPrimary }
    private var secondaryColor: Color { isSelected ? chrome.accentForeground : chrome.textSecondary }
    private var accentColor: Color { isSelected ? chrome.accentForeground : chrome.accent }
    private var hasUnread: Bool {
        guard let seen = app.seenBoundary(for: thread) else { return false }
        return activityDate > seen
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if thread.isGroup {
                AvatarClusterView(familiars: familiars, size: 48)
            } else {
                AvatarView(familiar: familiars.first,
                           url: familiars.first.flatMap { app.client?.avatarURL(for: $0) },
                           size: 48, showStatus: true)
            }
            VStack(alignment: .leading, spacing: 3) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        title
                        Spacer(minLength: 8)
                        relativeTime
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        title
                        relativeTime
                    }
                }
                Text(familiars.map(\.displayName).joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(secondaryColor)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                if let draftText = app.threadDrafts[thread.id] {
                    // A persisted unsent draft outranks the last-message
                    // preview (standard messenger affordance — makes drafts
                    // discoverable from the list).
                    (Text("Draft: ").foregroundStyle(accentColor)
                        + Text(draftText.replacingOccurrences(of: "\n", with: " ")))
                        .font(.subheadline)
                        .foregroundStyle(secondaryColor)
                        .lineLimit(2)
                } else {
                    Text(previewText)
                        .font(.subheadline)
                        .foregroundStyle(secondaryColor)
                        .lineLimit(2)
                }
            }
        }
        .frame(minHeight: 44)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        // Collapse title, status glyphs, time, and preview into one spoken element.
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    /// One spoken summary of the row: title, status, last activity, preview.
    private var accessibilityText: String {
        var parts: [String] = [thread.title]
        parts.append(contentsOf: familiars.map(\.displayName))
        if hasUnread { parts.append("unread") }
        if thread.archived { parts.append("archived") }
        if thread.isGroup { parts.append("group chat") }
        if thread.pinned { parts.append("pinned") }
        if thread.muted { parts.append("muted") }
        parts.append("last active " + Self.relativeFormatter.localizedString(for: activityDate, relativeTo: Date()))
        if let draftText = app.threadDrafts[thread.id] {
            parts.append("draft: " + draftText)
        } else {
            parts.append(previewText)
        }
        return parts.joined(separator: ", ")
    }

    private static let relativeFormatter = RelativeDateTimeFormatter()

    private var title: some View {
        HStack(spacing: 6) {
            Text(thread.title)
                .font(.headline)
                .foregroundStyle(primaryColor)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                .layoutPriority(1)
            if hasUnread {
                Circle().fill(accentColor).frame(width: 8, height: 8)
            }
            if thread.pinned {
                Image(systemName: "pin.fill").foregroundStyle(accentColor)
            }
            if thread.muted {
                Image(systemName: "bell.slash.fill").foregroundStyle(secondaryColor)
            }
            if thread.isGroup {
                Image(systemName: "person.2.fill").foregroundStyle(secondaryColor)
            }
            if thread.archived {
                Image(systemName: "archivebox").foregroundStyle(secondaryColor)
            }
        }
        .font(.caption2)
    }

    private var relativeTime: some View {
        Text(activityDate, format: .relative(presentation: .numeric))
            .font(.caption)
            .foregroundStyle(secondaryColor)
            .lineLimit(1)
    }

    private var previewText: String {
        if activityDate > thread.updatedAt { return "New activity on another device" }
        guard let last = lastMessage else { return "Tap to start chatting" }
        if last.streaming && last.text.isEmpty { return "…" }
        let prefix = last.role == .user ? "\(app.operatorDisplayName): " : ""
        return prefix + last.text.replacingOccurrences(of: "\n", with: " ")
    }
}
