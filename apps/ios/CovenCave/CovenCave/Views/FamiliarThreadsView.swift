import SwiftUI

/// The threads belonging to a single familiar. Reached by tapping a familiar on
/// the Chats home; lists every conversation with that familiar — on-device
/// threads merged with server sessions started elsewhere (desktop/web) — newest
/// first, each opening into its own distinct chat. A "New chat" action starts a
/// fresh, separate thread.
struct FamiliarThreadsView: View {
    @Environment(AppModel.self) private var app
    let familiar: Familiar
    @Binding var path: [ChatRoute]
    @State private var renamingThread: ChatThread?
    /// An on-device thread awaiting delete confirmation (swipe or context menu).
    @State private var pendingDelete: ChatThread?
    /// Reveal archived on-device threads.
    @State private var showArchived = false
    /// Multi-select bulk-delete mode.
    @State private var selectMode = false
    @State private var selectedIds: Set<String> = []
    @State private var confirmingBulkDelete = false
    @State private var exportArchive: ExportArchive?

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
    /// Archived on-device threads stay hidden until the user opts in.
    private var entries: [Entry] {
        let local = app.directThreads(for: familiar.id)
            .filter { showArchived || !$0.archived }
            .map(Entry.local)
        let server = app.serverOnlySessions(for: familiar.id).map(Entry.server)
        return (local + server).sorted { $0.date > $1.date }
    }

    /// Number of archived on-device threads (drives the show/hide toggle).
    private var archivedLocalCount: Int {
        app.directThreads(for: familiar.id).filter(\.archived).count
    }

    var body: some View {
        Group {
            if entries.isEmpty && archivedLocalCount == 0 {
                emptyState
            } else {
                threadList
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
                if !selectMode && hasLocalThreads {
                    Button("Select") { withAnimation { selectMode = true } }
                }
            }
        }
        .refreshable { await app.loadSessions() }
        .task { await app.loadSessions() }
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
                .background(.bar)
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
    private var hasLocalThreads: Bool { !app.directThreads(for: familiar.id).isEmpty }
    private var allLocalSelected: Bool {
        !localThreads.isEmpty && Set(localThreads.map(\.id)).isSubset(of: selectedIds)
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
        if allLocalSelected { selectedIds.removeAll() } else { selectedIds = Set(localThreads.map(\.id)) }
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
        if case .local(let thread) = entry {
            Image(systemName: selectedIds.contains(thread.id) ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(selectedIds.contains(thread.id) ? Color.accentColor : Color.secondary)
        } else {
            Image(systemName: "circle").font(.title3).foregroundStyle(.quaternary)
        }
    }

    @ViewBuilder
    private func row(_ entry: Entry) -> some View {
        switch entry {
        case .local(let thread):
            ThreadRow(thread: thread)
        case .server(let session):
            ServerSessionRow(session: session)
        }
    }

    private func open(_ entry: Entry) {
        switch entry {
        case .local(let thread):
            path.append(.thread(thread))
        case .server(let session):
            // Bind the server session to a local thread (and pull its history),
            // then open it like any other.
            let thread = app.openServerSession(session, familiarId: familiar.id)
            path.append(.thread(thread))
        }
    }

    private func startNewChat() {
        let thread = app.startFreshThread(familiarIds: [familiar.id], title: familiar.displayName)
        Haptics.tap()
        path.append(.thread(thread))
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
