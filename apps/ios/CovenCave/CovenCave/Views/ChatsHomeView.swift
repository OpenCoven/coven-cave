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
    @Environment(\.scenePhase) private var scenePhase
    @State private var showNewChat = false
    @State private var fixedNewChatFamiliarId: String?
    @State private var query = ""
    @State private var searchMeasurementRevision: UInt64 = 0
    @State private var searchMeasurement: CavePerformanceSpan?
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
    /// Narrow the home list to conversations one familiar takes part in
    /// (direct threads, groups they belong to, and their server-only rows).
    /// Like search and the archive toggle, this is list organisation only —
    /// it never changes a chat's project binding or selection.
    @State private var familiarFilter: String?
    /// Narrow the home list to conversations bound to one registered project
    /// (or to Unassigned history). List organisation only, like the familiar
    /// filter: it never changes a chat's binding or the app's scope.
    @State private var projectFilter: ChatListSnapshot.ProjectFilter?
    /// Needs you / Running / Ready to archive (#5850). List organisation only,
    /// like the project filter; nil is All.
    @State private var statusFilter: ChatStatusFilter?
    /// The Reflections section starts collapsed so review runs never push
    /// live chats down; opening it once is remembered across launches. It is
    /// read once and written on toggle rather than held in `@AppStorage`, so
    /// the whole list never subscribes to the defaults store.
    @State private var reflectionsExpanded = UserDefaults.standard.bool(forKey: Self.reflectionsExpandedKey)
    private static let reflectionsExpandedKey = "cave.chats.reflectionsExpanded"
    @State private var renamingThread: ChatThread?
    @State private var pendingDelete: ChatThread?
    /// Server-only rows have no ChatThread to hand the existing dialog, so
    /// they get their own confirmation (#5429).
    @State private var pendingServerDelete: SessionRow?
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
        .confirmationDialog(
            "Delete this chat?",
            isPresented: Binding(
                get: { pendingServerDelete != nil },
                set: { if !$0 { pendingServerDelete = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingServerDelete
        ) { session in
            Button("Delete", role: .destructive) { app.deleteServerSession(session) }
            Button("Cancel", role: .cancel) {}
        } message: { session in
            Text(session.title)
        }
        .sheet(item: $exportArchive) { archive in
            ActivityView(items: [archive.url])
        }
        .onDisappear { cancelSearchMeasurement() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { cancelSearchMeasurement() }
        }
        // Observed in a child view: reading `selectedTab` here would make every
        // destination switch re-render the whole Chats list (#5651).
        .background(SettingsSelectionObserver { cancelSearchMeasurement() })
        .onAppear {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-open-familiars") {
                presentGeneralNewChat()
            }
            applyPreviewLaunchIntent()
            #endif
        }
    }

    private func cancelSearchMeasurement() {
        app.performanceRecorder.cancel(searchMeasurement)
        searchMeasurement = nil
    }

    private func publishSearchQuery(_ value: String) {
        guard value != query else { return }
        if app.performanceRecorder.isEnabled {
            cancelSearchMeasurement()
            if scenePhase == .active, app.selectedTab != .settings {
                searchMeasurement = app.performanceRecorder.begin(CavePerformanceSpanName.searchQuery.rawValue)
                searchMeasurementRevision &+= 1
            }
        }
        query = value
    }

    private var splitView: some View {
        // Both server lists go in; the snapshot owns the archived filter, so
        // the "Show archived" count includes server-only rows (#5429).
        let snapshot = app.performanceRecorder.measureSynchronous(
            CavePerformanceSpanName.chatListProjection.rawValue
        ) {
            app.chatListSnapshotCache.resolve(
                threads: app.chatThreads,
                sessions: app.chatServerSessions + app.chatArchivedServerSessions,
                familiars: app.familiars,
                projects: app.projects,
                reflections: app.threadReflectionSessions,
                query: query,
                includeArchived: showArchived,
                familiarId: familiarFilter,
                projectFilter: projectFilter,
                statusFilter: statusFilter
            )
        }
        return NavigationSplitView(preferredCompactColumn: $preferredCompactColumn) {
            Group {
                if snapshot.entries.isEmpty && query.isEmpty && familiarFilter == nil
                    && snapshot.archivedCount == 0 && projectFilter == nil && statusFilter == nil
                    && snapshot.reflections.isEmpty {
                    if let error = app.familiarsError ?? app.sessionsError {
                        loadFailure(error)
                    } else {
                        emptyState
                    }
                } else if snapshot.entries.isEmpty && !query.isEmpty && snapshot.reflections.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else if snapshot.entries.isEmpty && snapshot.reflections.isEmpty,
                          familiarFilter != nil || projectFilter != nil {
                    filterEmptyState(snapshot)
                } else {
                    homeList(snapshot)
                }
            }
            .background {
                if app.performanceRecorder.isEnabled {
                    let revision = searchMeasurementRevision
                    let measurement = searchMeasurement
                    CavePerformanceStableFrame(token: "chat-search-\(revision)") {
                        guard revision == searchMeasurementRevision else { return }
                        app.performanceRecorder.end(measurement)
                    }
                    .frame(width: 0, height: 0)
                    .accessibilityHidden(true)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                HiddenUnderSettings { header(snapshot) }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HiddenUnderSettings { homeSearchBar }
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
                await app.refreshChats()
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
                    familiarFilterPicker(snapshot)
                    Divider()
                    Button { showArchived.toggle() } label: {
                        Label(
                            showArchived ? "Hide archived" : "Show archived (\(snapshot.archivedCount))",
                            systemImage: "archivebox"
                        )
                    }
                } label: {
                    // The same round glass well as the navigation button, so
                    // the header's two controls read as a matched pair.
                    Image(systemName: familiarFilter == nil ? "ellipsis" : "line.3.horizontal.decrease")
                        .font(.system(size: ChatChrome.control * 0.44, weight: .semibold))
                        .foregroundStyle(familiarFilter == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(chrome.accent))
                        .scaledControlFrame(ChatChrome.control)
                        .glass(.control, in: Circle())
                        .accentGlow(active: familiarFilter != nil)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(familiarFilter == nil ? "Chat list options" : "Chat list options, filtered by familiar")
                .accessibilityIdentifier("Chat list options")
            }
            if dynamicTypeSize.isAccessibilitySize || sizeClass == .regular,
               let detail = visibleConversationLabel(snapshot.entries.count) {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(chrome.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if ChatStatusFilterStrip.isVisible(counts: snapshot.statusCounts, selection: statusFilter) {
                ChatStatusFilterStrip(counts: snapshot.statusCounts, selection: $statusFilter)
            }
            let projectChoices = projectFilterChoices(snapshot)
            if projectChoices.count > 1 || projectFilter != nil {
                // At accessibility sizes one chip fills the screen width, so
                // the strip becomes a single menu naming the current choice.
                if dynamicTypeSize.isAccessibilitySize {
                    projectFilterMenu(projectChoices)
                } else {
                    projectFilterStrip(projectChoices)
                }
            }
            // Sticky in the header, right above the list it acts on, so it
            // stays in reach however far the ready list scrolls.
            if statusFilter == .readyToArchive, !snapshot.entries.isEmpty {
                archiveReadyRow(count: snapshot.entries.count)
            }
            if let familiarId = familiarFilter {
                familiarFilterChip(familiarId)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .glassChrome(.top)
    }

    /// Familiars offered by the filter: everyone with at least one conversation
    /// (active or archived), by display name. A filter that names a familiar
    /// with no chats left (all deleted) stays listed so it can be cleared.
    private func filterableFamiliars(_ snapshot: ChatListSnapshot) -> [Familiar] {
        app.familiars
            .filter { snapshot.familiarIds.contains($0.id) || $0.id == familiarFilter }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }

    private func familiarDisplayName(_ familiarId: String) -> String {
        app.familiars.first { $0.id == familiarId }?.displayName ?? familiarId
    }

    /// "Filter by familiar" submenu: one checkmarked choice, "All" first.
    @ViewBuilder
    private func familiarFilterPicker(_ snapshot: ChatListSnapshot) -> some View {
        let familiars = filterableFamiliars(snapshot)
        Menu {
            Picker("Filter by familiar", selection: $familiarFilter) {
                Label("All familiars", systemImage: "person.2").tag(String?.none)
                ForEach(familiars) { familiar in
                    Text(familiar.displayName).tag(Optional(familiar.id))
                }
            }
            .pickerStyle(.inline)
        } label: {
            Label(
                familiarFilter.map { "Familiar: \(familiarDisplayName($0))" } ?? "Filter by familiar",
                systemImage: "line.3.horizontal.decrease.circle"
            )
        }
        .disabled(familiars.isEmpty && familiarFilter == nil)
    }

    /// The active filter, visible without opening the menu, and one tap to clear.
    private func familiarFilterChip(_ familiarId: String) -> some View {
        Button { withAnimation { familiarFilter = nil } } label: {
            HStack(spacing: 6) {
                Image(systemName: "line.3.horizontal.decrease.circle")
                Text(familiarDisplayName(familiarId))
                    .lineLimit(1)
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(chrome.accent)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .glass(.control, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear familiar filter, \(familiarDisplayName(familiarId))")
        .accessibilityIdentifier("Familiar filter chip")
    }

    /// Offer only projects with chats under the current search, familiar and
    /// archive settings. All projects remains available to clear a selection
    /// whose last matching chat disappeared.
    private func projectFilterChoices(_ snapshot: ChatListSnapshot) -> [ChatListSnapshot.ProjectFilter] {
        var choices: [ChatListSnapshot.ProjectFilter] = snapshot.projectIds
            .sorted {
                let order = projectDisplayName($0).localizedCaseInsensitiveCompare(projectDisplayName($1))
                return order == .orderedSame ? $0 < $1 : order == .orderedAscending
            }
            .map { .project(id: $0) }
        if snapshot.hasUnassigned {
            choices.append(.unassigned)
        }
        return choices
    }

    private func projectDisplayName(_ projectId: String) -> String {
        app.project(projectId)?.name ?? "Unavailable project"
    }

    private func projectFilterName(_ filter: ChatListSnapshot.ProjectFilter) -> String {
        switch filter {
        case .project(let id): return projectDisplayName(id)
        case .unassigned: return "Unassigned"
        }
    }

    private func projectFilterSymbol(_ filter: ChatListSnapshot.ProjectFilter) -> String {
        filter == .unassigned ? "tray" : "folder"
    }

    /// One-tap project filter: "All" first, then each project with chats. It
    /// appears only when there is more than one place to choose between.
    private func projectFilterStrip(_ choices: [ChatListSnapshot.ProjectFilter]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                projectFilterChip(nil, label: "All projects", systemImage: "square.grid.2x2")
                ForEach(choices, id: \.self) { choice in
                    projectFilterChip(
                        choice,
                        label: projectFilterName(choice),
                        systemImage: projectFilterSymbol(choice)
                    )
                }
            }
            // Inset to the header's text edge, but scroll edge to edge.
            .padding(.horizontal, 14)
        }
        .padding(.horizontal, -14)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filter by project")
        .accessibilityIdentifier("Project filter")
    }

    /// The strip at accessibility text sizes. There each chip is about as
    /// wide as the screen, so reaching a project meant swiping chip by chip;
    /// one full-width control names the current choice and opens every choice
    /// at once. Same filter, same choices, same order.
    private func projectFilterMenu(_ choices: [ChatListSnapshot.ProjectFilter]) -> some View {
        let current = projectFilter.map(projectFilterName) ?? "All projects"
        let active = projectFilter != nil
        return Menu {
            Picker("Filter by project", selection: $projectFilter) {
                Label("All projects", systemImage: "square.grid.2x2")
                    .tag(ChatListSnapshot.ProjectFilter?.none)
                ForEach(choices, id: \.self) { choice in
                    Label(projectFilterName(choice), systemImage: projectFilterSymbol(choice))
                        .tag(Optional(choice))
                }
            }
            .pickerStyle(.inline)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: projectFilter.map(projectFilterSymbol) ?? "square.grid.2x2")
                    .accessibilityHidden(true)
                Text(current)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down")
                    .accessibilityHidden(true)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(active ? chrome.accent : chrome.textSecondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .glass(.control, cornerRadius: 22)
            .accentGlow(active: active)
            .contentShape(Rectangle())
        }
        // Rigid height, so the menu never competes with the title row for
        // vertical room in the header.
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityLabel("Filter by project")
        .accessibilityValue(current)
        .accessibilityIdentifier("Project filter menu")
    }

    private func projectFilterChip(
        _ choice: ChatListSnapshot.ProjectFilter?,
        label: String,
        systemImage: String
    ) -> some View {
        let selected = projectFilter == choice
        return Button {
            Haptics.tap()
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) {
                projectFilter = choice
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .accessibilityHidden(true)
                Text(label)
                    .lineLimit(1)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(selected ? chrome.accentForeground : chrome.textSecondary)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background {
                if selected {
                    Capsule().fill(chrome.accentGradient)
                }
            }
            .glass(.control, in: Capsule())
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.glassPress)
        .accessibilityLabel(choice == nil ? "All projects" : "Project, \(label)")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(choice == nil ? "Project filter All" : "Project filter \(label)")
    }

    /// Nothing left once the familiar or project filter applies (search, if
    /// any, already matched nothing on its own branch).
    private func filterEmptyState(_ snapshot: ChatListSnapshot) -> some View {
        let familiarName = familiarFilter.map(familiarDisplayName)
        let projectName = projectFilter.map(projectFilterName)
        let title: String
        switch (familiarName, projectName) {
        case let (familiar?, project?): title = "No chats with \(familiar) in \(project)"
        case let (familiar?, nil): title = "No chats with \(familiar)"
        case let (nil, project?): title = "No chats in \(project)"
        case (nil, nil): title = "No chats"
        }
        let clearHint = familiarName != nil && projectName != nil ? "clear a filter" : "clear the filter"
        return ContentUnavailableView {
            Label(title, systemImage: "line.3.horizontal.decrease.circle")
        } description: {
            Text(
                snapshot.archivedCount > 0 && !showArchived
                    ? "Archived chats are hidden. Show archived, or \(clearHint)."
                    : familiarName.map { "Start a new chat with \($0), or \(clearHint)." }
                        ?? "Choose another project, or \(clearHint)."
            )
        } actions: {
            if projectFilter != nil {
                Button("Show all projects") { projectFilter = nil }
            }
            if familiarFilter != nil {
                Button("Show all familiars") { familiarFilter = nil }
            }
            if let familiarId = familiarFilter,
               let familiar = app.familiars.first(where: { $0.id == familiarId }),
               let familiarName {
                Button("New chat with \(familiarName)") { startNewChat(with: familiar) }
            }
        }
    }

    private var homeSearchBar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 18))
                    .foregroundStyle(searchFocused ? chrome.accent : chrome.textSecondary)
                TextField("Search chats…", text: Binding(get: { query }, set: publishSearchQuery))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($searchFocused)
                if !query.isEmpty {
                    Button {
                        publishSearchQuery("")
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
                            isSelected: sizeClass == .regular && selection == .thread(thread),
                            status: entry.status
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
                        .contextMenu { serverSessionActions(session) }
                        .swipeActions(edge: .leading) {
                            Button {
                                app.setServerSessionPinned(session, session.pinned != true)
                            } label: {
                                Label(session.pinned == true ? "Unpin" : "Pin", systemImage: "pin")
                            }
                            .tint(chrome.accent)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) { pendingServerDelete = session } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button {
                                app.setServerSessionArchived(session, session.archivedAt == nil)
                            } label: {
                                Label(
                                    session.archivedAt == nil ? "Archive" : "Unarchive",
                                    systemImage: "archivebox"
                                )
                            }
                            .tint(chrome.accent)
                        }
                    }
                }
                .accessibilityIdentifier("Chat row \(entry.id)")
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(rowBackground(for: entry))
                // A tinted field is its own card: separators would cut
                // through its rounded edges.
                .listRowSeparator(
                    ChatStatusTint.rowField(entry.status, accent: chrome.accent) != nil ? .hidden : .automatic,
                    edges: .all
                )
            }
            if snapshot.entries.isEmpty && snapshot.archivedCount > 0 {
                Button("Show archived chats (\(snapshot.archivedCount))") { showArchived = true }
                    .frame(minHeight: 44)
            }
            if !snapshot.reflections.isEmpty {
                reflectionsSection(snapshot.reflections)
            }
        }
        .listStyle(.plain)
        .themedListBackground()
        .overlay {
            if let statusFilter, snapshot.entries.isEmpty {
                statusFilterEmptyState(statusFilter)
            }
        }
    }

    /// Phones draw rows on the themed list background; iPad keeps the system
    /// background so its selection highlight shows. Either way a chat that is
    /// stopped on you gets its status field — except the selected iPad row,
    /// whose highlight already says where you are.
    private func rowBackground(for entry: ChatListSnapshot.Entry) -> AnyView? {
        let selected: Bool = switch entry.conversation {
        case .local(let thread): sizeClass == .regular && selection == .thread(thread)
        case .server: false
        }
        let flags = ChatStatusTint.rowField(entry.status, accent: chrome.accent) != nil
            || entry.status.lifecycle == .failed
        guard flags, !selected else { return sizeClass == .compact ? AnyView(Color.clear) : nil }
        return AnyView(ChatStatusRowBackground(
            status: entry.status,
            plain: sizeClass == .compact ? .clear : Color(uiColor: .systemBackground)
        ))
    }

    /// The Ready-to-archive view's one bulk action. Archiving is reversible,
    /// so it acts at once and offers Undo in the toast (the iOS pattern for a
    /// reversible bulk action) rather than asking first.
    private func archiveReadyRow(count: Int) -> some View {
        let tint = ChatStatusTint.color(.readyToArchive, accent: chrome.accent)
        return Button {
            archiveReadyChats()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "archivebox.fill")
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(count == 1 ? "Archive this chat" : "Archive all \(count)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(chrome.textPrimary)
                    Text("Their pull requests merged")
                        .font(.caption)
                        .foregroundStyle(chrome.textSecondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(tint.opacity(0.22), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.glassPress)
        .accessibilityLabel(count == 1 ? "Archive this chat" : "Archive all \(count) ready chats")
        .accessibilityHint("Their pull requests merged. Undo is offered afterwards.")
        .accessibilityIdentifier("Archive ready chats")
    }

    /// Re-resolves at confirm time, so a chat that started running or asked
    /// something since the dialog opened is left alone.
    private func archiveReadyChats() {
        let ready = app.chatListSnapshotCache.resolve(
            threads: app.chatThreads,
            sessions: app.chatServerSessions + app.chatArchivedServerSessions,
            familiars: app.familiars,
            projects: app.projects,
            reflections: app.threadReflectionSessions,
            query: query,
            includeArchived: false,
            familiarId: familiarFilter,
            projectFilter: projectFilter,
            statusFilter: .readyToArchive
        ).entries
        var threads: [ChatThread] = []
        var sessions: [SessionRow] = []
        for entry in ready {
            switch entry.conversation {
            case .local(let thread):
                if thread.isStreaming { continue }
                threads.append(thread)
            case .server(let session):
                sessions.append(session)
            }
        }
        let total = threads.count + sessions.count
        guard total > 0 else { return }
        for thread in threads { app.setThreadArchived(thread, true) }
        for session in sessions { app.setServerSessionArchived(session, true) }
        Haptics.success()
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) { statusFilter = nil }
        app.showToast(
            total == 1 ? "Archived 1 chat" : "Archived \(total) chats",
            systemImage: "archivebox.fill",
            actionTitle: "Undo"
        ) { [app] in
            for thread in threads { app.setThreadArchived(thread, false) }
            for session in sessions { app.setServerSessionArchived(session, false) }
        }
    }

    private func statusFilterEmptyState(_ filter: ChatStatusFilter) -> some View {
        let copy: (title: String, symbol: String, detail: String) = switch filter {
        case .needsYou: ("Nothing needs you", "checkmark.seal",
                         "No chat is blocked, failed, or waiting on your answer.")
        case .running: ("Nothing running", "moon.zzz",
                        "No familiar is working on a chat right now.")
        case .readyToArchive: ("Nothing to archive", "archivebox",
                               "Chats whose pull request merged show up here.")
        }
        return ContentUnavailableView {
            Label(copy.title, systemImage: copy.symbol)
        } description: {
            Text(copy.detail)
        } actions: {
            Button("Show all chats") {
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) { statusFilter = nil }
            }
        }
    }

    /// Thread-reflection review runs, apart from live chats and collapsed by
    /// default (the web rail's Reflections group). A row opens like any
    /// server-only chat; pin is absent because a reflection never joins the
    /// live list, so there is nothing for it to rise above.
    @ViewBuilder
    private func reflectionsSection(_ reflections: [ChatListSnapshot.Entry]) -> some View {
        Section {
            if reflectionsExpanded {
                ForEach(reflections) { entry in
                    if case .server(let session) = entry.conversation {
                        Button {
                            _ = app.requestOpenServerSession(session, fallbackFamiliarId: session.familiarId)
                        } label: {
                            ServerSessionRow(session: session)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button { app.setServerSessionArchived(session, true) } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            Button(role: .destructive) { pendingServerDelete = session } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) { pendingServerDelete = session } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button { app.setServerSessionArchived(session, true) } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            .tint(chrome.accent)
                        }
                        .accessibilityIdentifier("Chat row \(entry.id)")
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(sizeClass == .compact ? Color.clear : nil)
                    }
                }
            }
        } header: {
            Button {
                Haptics.tap()
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) {
                    reflectionsExpanded.toggle()
                }
                UserDefaults.standard.set(reflectionsExpanded, forKey: Self.reflectionsExpandedKey)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: reflectionsExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption.weight(.bold))
                    Text("Reflections")
                    Spacer()
                    Text("\(reflections.count)")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.14), in: Capsule())
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(chrome.textSecondary)
            .accessibilityLabel("Reflections, \(reflections.count) review\(reflections.count == 1 ? "" : "s")")
            .accessibilityValue(reflectionsExpanded ? "Expanded" : "Collapsed")
            .accessibilityIdentifier("Reflections section")
        }
    }

    /// Archive, pin and delete for a conversation the desktop owns that this
    /// device has no local thread for. Rename, Duplicate, Mute, Mark read and
    /// Export are deliberately absent: each needs thread-local state a server
    /// row does not have yet (#5429).
    @ViewBuilder
    private func serverSessionActions(_ session: SessionRow) -> some View {
        Button {
            app.setServerSessionPinned(session, session.pinned != true)
        } label: {
            Label(session.pinned == true ? "Unpin" : "Pin", systemImage: "pin")
        }
        Button {
            app.setServerSessionArchived(session, session.archivedAt == nil)
        } label: {
            Label(
                session.archivedAt == nil ? "Archive" : "Unarchive",
                systemImage: "archivebox"
            )
        }
        Button(role: .destructive) { pendingServerDelete = session } label: {
            Label("Delete", systemImage: "trash")
        }
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
    /// From the list snapshot (#5850); a live local turn folds in here, ahead
    /// of the next list poll reporting it.
    var status: ChatStatusSummary? = nil

    private var effectiveStatus: ChatStatusSummary? {
        let streaming = lastMessage?.streaming == true
        guard let status else { return streaming ? ChatStatusSummary.settled.streaming(true) : nil }
        return status.streaming(streaming)
    }

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
                AvatarClusterView(familiars: familiars, size: 48,
                                  source: { app.client?.familiarAvatarSource(for: $0) })
            } else {
                AvatarView(familiar: familiars.first,
                           source: familiars.first.flatMap { app.client?.familiarAvatarSource(for: $0) },
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
                ChatStatusCaption(
                    status: effectiveStatus,
                    names: familiars.map(\.displayName).joined(separator: ", "),
                    nameColor: secondaryColor
                )
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
        if let effectiveStatus, effectiveStatus.lifecycle != .completed || effectiveStatus.pullRequest != nil {
            parts.append(effectiveStatus.accessibilityText)
        }
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

/// Shows its content except while Settings is the selected destination. It
/// reads `selectedTab` in its own body, so a destination switch re-renders only
/// this inset. Reading it in `ChatsHomeView.body` re-ran the list projection
/// and SwiftUI's diff of every chat row on each switch, even though Chats
/// stays mounted behind Settings (#5651).
private struct HiddenUnderSettings<Content: View>: View {
    @Environment(AppModel.self) private var app
    @ViewBuilder var content: Content

    var body: some View {
        if app.selectedTab != .settings { content }
    }
}

/// Calls `onEnterSettings` when Settings becomes the selected destination,
/// without making the view that owns it observe `selectedTab` (#5651).
private struct SettingsSelectionObserver: View {
    @Environment(AppModel.self) private var app
    let onEnterSettings: () -> Void

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
            .onChange(of: app.selectedTab) { _, tab in
                if tab == .settings { onEnterSettings() }
            }
    }
}
