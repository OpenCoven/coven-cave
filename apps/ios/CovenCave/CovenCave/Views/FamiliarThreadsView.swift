import SwiftUI

/// The threads belonging to a single familiar. Reached by tapping a familiar on
/// the Chats home; lists every conversation with that familiar — on-device
/// threads merged with server sessions started elsewhere (desktop/web) — newest
/// first, each opening into its own distinct chat. A "New chat" action starts a
/// fresh, separate thread.
struct FamiliarThreadsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let familiar: Familiar
    @Binding var path: [ChatRoute]
    /// Namespace owned by `ChatsHomeView`; local thread rows register as
    /// zoom-transition sources so the pushed conversation grows out of them.
    var zoomNamespace: Namespace.ID
    /// Picker mode. When set, choosing a row hands the thread back to the
    /// presenter instead of pushing it onto `path`.
    ///
    /// This exists because pushing does not work when the view is presented as
    /// a sheet: ChatView's session switcher wraps it in its own
    /// `NavigationStack` that is *not* bound to `path`, so every
    /// `path.append` wrote into state nothing rendered and the tap did
    /// nothing at all. Handing the thread back lets the presenter close the
    /// sheet and switch the conversation for real.
    var onSelect: ((ChatThread) -> Void)? = nil
    /// The conversation already on screen behind the picker, marked as current
    /// so switching is a visible move rather than a guess.
    var currentThreadId: String? = nil
    @State private var renamingThread: ChatThread?
    /// An on-device thread awaiting delete confirmation (swipe or context menu).
    @State private var pendingDelete: ChatThread?
    /// Reveal archived on-device threads.
    @State private var showArchived = false
    /// Filters the picker by thread title, a member's name, or message text —
    /// the search the Chats home used to own before it became a familiar list.
    @State private var query = ""
    /// Multi-select bulk-delete mode.
    @State private var selectMode = false
    @State private var selectedIds: Set<String> = []
    @State private var confirmingBulkDelete = false
    @State private var exportArchive: ExportArchive?
    /// Per-familiar permissions sheet (project access scoped to this familiar).
    @State private var showPermissions = false
    @State private var showNewChat = false
    /// One row in the list: an on-device thread or a server-only session.
    private enum Entry: Identifiable {
        case local(ChatThread)
        case server(SessionRow)

        var id: String {
            switch self {
            case .local(let t): return "local-\(t.id)"
            case .server(let r): return "server-\(r.id)"
            }
        }
        @MainActor var date: Date {
            switch self {
            case .local(let t): return t.updatedAt
            case .server(let r): return caveParseISO(r.updatedAt) ?? .distantPast
            }
        }
    }

    /// On-device threads + server-only sessions, newest activity first.
    /// Archived on-device threads stay hidden until the user opts in, and the
    /// search query narrows both kinds of row. An empty query returns everything.
    private var entries: [Entry] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let local = app.directThreads(for: familiar.id)
            .filter { showArchived || !$0.archived }
            .filter { matches($0, query: q) }
            .map(Entry.local)
        // A server-only session has no transcript on this device yet, so its
        // title is the only thing there is to match.
        let server = app.serverOnlySessions(for: familiar.id)
            .filter { q.isEmpty || $0.title.lowercased().contains(q) }
            .map(Entry.server)
        return (local + server).sorted { $0.date > $1.date }
    }

    /// A thread matches the search when its title, one of its members' names,
    /// or anything said in it contains the (already lowercased) query.
    private func matches(_ thread: ChatThread, query q: String) -> Bool {
        if q.isEmpty { return true }
        if thread.title.lowercased().contains(q) { return true }
        if thread.familiarIds.compactMap(app.familiar)
            .contains(where: { $0.displayName.lowercased().contains(q) }) { return true }
        return thread.messages.contains { $0.text.lowercased().contains(q) }
    }

    /// Number of archived on-device threads (drives the show/hide toggle).
    private var archivedLocalCount: Int {
        app.directThreads(for: familiar.id).filter(\.archived).count
    }

    var body: some View {
        VStack(spacing: 0) {
            // A query that matches nothing must keep the list (and its search
            // field) on screen, or there is no way to clear the query.
            if entries.isEmpty && archivedLocalCount == 0 && query.isEmpty {
                emptyState
            } else {
                threadList.readableListWidth(740)
            }
        }
        .navigationTitle(familiar.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(familiar.displayName).font(.headline).lineLimit(1)
                    if let role = familiar.role, !role.isEmpty {
                        Text(role).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            // Presented as a sheet there is no back button, so picker mode
            // needs an explicit way out that isn't "pick something".
            ToolbarItem(placement: .topBarLeading) {
                if isPicking && !selectMode {
                    Button("Done") { dismiss() }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if selectMode {
                    Button("Cancel") { exitSelect() }
                } else {
                    Button(action: startNewChat) {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("New chat")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if !selectMode {
                    Button { showPermissions = true } label: {
                        Image(systemName: "key")
                    }
                    .accessibilityLabel("Project access")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if !selectMode && hasLocalThreads {
                    Button("Select") { withAnimation { selectMode = true } }
                }
            }
        }
        // Pull-to-refresh is explicit user intent — always hit the server.
        .refreshable { await app.loadSessions() }
        // Re-appearance is not: reuse a list fetched moments ago (cave-ioswipe.5).
        .task { await app.loadSessionsIfStale() }
        .onAppear { app.markFamiliarViewed([familiar.id]) }
        .safeAreaInset(edge: .bottom) {
            if selectMode {
                HStack {
                    Button(allLocalSelected ? "Deselect All" : "Select All") { toggleSelectAll() }
                    Spacer()
                    Button { exportSelected() } label: {
                        Text(selectedIds.isEmpty ? "Export" : "Export (\(selectedIds.count))")
                    }
                    .disabled(selectedIds.isEmpty)
                    Spacer().frame(width: 16)
                    Button(role: .destructive) { confirmingBulkDelete = true } label: {
                        Text(selectedIds.isEmpty ? "Delete" : "Delete (\(selectedIds.count))")
                            .fontWeight(.semibold)
                    }
                    .disabled(selectedIds.isEmpty)
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
                .glassBar()
            }
        }
        .confirmationDialog(bulkDeleteTitle, isPresented: $confirmingBulkDelete, titleVisibility: .visible) {
            Button("Delete \(selectedIds.count)", role: .destructive) {
                app.deleteThreads(selectedIds)
                exitSelect()
            }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(item: $exportArchive) { archive in
            ActivityView(items: [archive.url])
        }
        .sheet(isPresented: $showPermissions) {
            FamiliarPermissionsSheet(familiar: familiar)
        }
        .sheet(isPresented: $showNewChat) {
            NewChatView(initialFamiliarIds: [familiar.id]) { thread in
                showNewChat = false
                Haptics.tap()
                // Same routing as a tapped row: in picker mode a brand-new
                // chat must reach the presenter too, or "New chat" from the
                // session switcher silently does nothing.
                choose(thread)
            }
        }
    }

    private var bulkDeleteTitle: String {
        "Delete \(selectedIds.count) chat\(selectedIds.count == 1 ? "" : "s")?"
    }

    private var threadList: some View {
        List {
            ForEach(entries) { entry in
                Button { tapEntry(entry) } label: {
                    HStack(spacing: 12) {
                        if selectMode { selectionMark(for: entry) }
                        row(entry)
                    }
                }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(
                        (selectMode && isSelected(entry)) || (isPicking && !selectMode && isCurrent(entry))
                            ? .isSelected : [])
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    // Only on-device threads can be renamed/deleted from here; a
                    // server-only session lives on the desktop, so its rows offer
                    // no swipe actions.
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if case .local(let thread) = entry {
                            Button(role: .destructive) { pendingDelete = thread } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button { app.setThreadArchived(thread, !thread.archived) } label: {
                                Label(thread.archived ? "Unarchive" : "Archive",
                                      systemImage: thread.archived ? "tray.and.arrow.up" : "archivebox")
                            }
                            .tint(.indigo)
                        }
                    }
                    .swipeActions(edge: .leading) {
                        if case .local(let thread) = entry {
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
                    }
                    .contextMenu {
                        if case .local(let thread) = entry {
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
            }
            if archivedLocalCount > 0 {
                Button {
                    withAnimation { showArchived.toggle() }
                } label: {
                    Label(showArchived ? "Hide archived" : "Show \(archivedLocalCount) archived",
                          systemImage: showArchived ? "chevron.up" : "archivebox")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
        }
        .listStyle(.plain)
        .themedListBackground()
        .searchable(text: $query, prompt: "Search chats")
        .overlay {
            if entries.isEmpty && !query.isEmpty { ContentUnavailableView.search(text: query) }
        }
        .threadRenameAlert($renamingThread) { thread, name in app.renameThread(thread, to: name) }
        .confirmationDialog("Delete this chat?",
                            isPresented: deleteDialogBinding,
                            titleVisibility: .visible,
                            presenting: pendingDelete) { thread in
            Button("Delete", role: .destructive) { app.deleteThread(thread) }
            Button("Cancel", role: .cancel) {}
        } message: { thread in Text(thread.title) }
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    // MARK: - Bulk select

    private var localThreads: [ChatThread] {
        app.directThreads(for: familiar.id).filter { showArchived || !$0.archived }
    }
    /// The local threads actually on screen. `entries` is narrowed by the
    /// archive toggle AND the search query, so this is derived from it rather
    /// than re-deriving the filters — it cannot drift from what renders.
    ///
    /// Select All uses this, not `localThreads`: selecting rows the user
    /// cannot see and then deleting them is unrecoverable (cave-2qyqu). The
    /// bulk actions still operate on `selectedIds`, so a selection made before
    /// searching survives the search rather than being silently dropped.
    private var visibleLocalThreads: [ChatThread] {
        entries.compactMap { entry in
            if case .local(let thread) = entry { return thread }
            return nil
        }
    }
    private var hasLocalThreads: Bool { !app.directThreads(for: familiar.id).isEmpty }
    private var allLocalSelected: Bool {
        !visibleLocalThreads.isEmpty && Set(visibleLocalThreads.map(\.id)).isSubset(of: selectedIds)
    }

    private func tapEntry(_ entry: Entry) {
        if selectMode {
            if case .local(let thread) = entry { toggleSelection(thread.id) }
        } else {
            open(entry)
        }
    }
    private func toggleSelection(_ id: String) {
        if selectedIds.contains(id) { selectedIds.remove(id) } else { selectedIds.insert(id) }
    }
    private func toggleSelectAll() {
        if allLocalSelected { selectedIds.removeAll() } else { selectedIds = Set(visibleLocalThreads.map(\.id)) }
    }
    private func exitSelect() {
        withAnimation { selectMode = false; selectedIds.removeAll() }
    }
    private func exportSelected() {
        let chosen = localThreads.filter { selectedIds.contains($0.id) }
        guard !chosen.isEmpty, let url = try? app.exportThreadsZip(chosen) else { return }
        exportArchive = ExportArchive(url: url)
    }

    @ViewBuilder private func selectionMark(for entry: Entry) -> some View {
        // Decorative — selection state is announced via the row's .isSelected trait.
        if case .local(let thread) = entry {
            Image(systemName: selectedIds.contains(thread.id) ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(selectedIds.contains(thread.id) ? Color.accentColor : Color.secondary)
                .accessibilityHidden(true)
        } else {
            Image(systemName: "circle").font(.title3).foregroundStyle(.quaternary)
                .accessibilityHidden(true)
        }
    }

    /// Whether a (local) thread row is selected in select mode.
    private func isSelected(_ entry: Entry) -> Bool {
        if case .local(let thread) = entry { return selectedIds.contains(thread.id) }
        return false
    }

    /// Whether a row is the conversation already open behind the picker.
    private func isCurrent(_ entry: Entry) -> Bool {
        guard let currentThreadId else { return false }
        if case .local(let thread) = entry { return thread.id == currentThreadId }
        return false
    }

    /// Picker mode — presented as a sheet to choose a session, rather than
    /// pushed as a browsable list.
    private var isPicking: Bool { onSelect != nil }

    @ViewBuilder
    private func row(_ entry: Entry) -> some View {
        switch entry {
        case .local(let thread):
            // Laid out beside the row rather than overlaid on it: ThreadRow's
            // preview runs two lines to the trailing edge, so an overlay mark
            // would print on top of the text.
            HStack(spacing: 8) {
                ThreadRow(thread: thread)
                currentMark(for: thread.id)
            }
            .matchedTransitionSource(id: thread.id, in: zoomNamespace)
        case .server(let session):
            ServerSessionRow(session: session)
        }
    }

    /// Marks the conversation already open behind the picker. Colour is not the
    /// only channel — the row also carries the `.isSelected` trait for
    /// VoiceOver, and the glyph itself is a distinct shape.
    @ViewBuilder
    private func currentMark(for threadId: String) -> some View {
        if isPicking && !selectMode && threadId == currentThreadId {
            Image(systemName: "checkmark.circle.fill")
                .font(.footnote)
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
        }
    }

    /// Hand a chosen conversation to the presenter (picker mode) or push it.
    private func choose(_ thread: ChatThread) {
        if let onSelect {
            onSelect(thread)
        } else {
            path.append(.thread(thread))
        }
    }

    private func open(_ entry: Entry) {
        switch entry {
        case .local(let thread):
            choose(thread)
        case .server(let session):
            // Bind the server session to a local thread (and pull its history),
            // then open it like any other.
            choose(app.openServerSession(session, familiarId: familiar.id))
        }
    }

    private func startNewChat() {
        showNewChat = true
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No chats with \(familiar.displayName)", systemImage: "bubble.left")
        } description: {
            Text("Start a conversation — it'll appear here and stay separate from your other chats.")
        } actions: {
            Button("New chat", action: startNewChat)
                .buttonStyle(.borderedProminent)
        }
    }
}

/// A server-side session not yet materialised on this device — tapping it pulls
/// the conversation down. Mirrors `ThreadRow`'s layout with a synced-elsewhere hint.
private struct ServerSessionRow: View {
    @Environment(AppModel.self) private var app
    let session: SessionRow

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(familiar: session.familiarId.flatMap(app.familiar),
                       url: session.familiarId.flatMap(app.familiar).flatMap { app.client?.avatarURL(for: $0) },
                       size: 48)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(session.title.isEmpty ? "Untitled chat" : session.title)
                        .font(.headline).lineLimit(1)
                    Spacer()
                    if let date = caveParseISO(session.updatedAt) {
                        Text(date, format: .relative(presentation: .numeric))
                            .font(.caption).foregroundStyle(.tertiary)
                    }
                }
                Label("Synced from another device", systemImage: "desktopcomputer")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}
