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
    private var entries: [Entry] {
        let local = app.directThreads(for: familiar.id).map(Entry.local)
        let server = app.serverOnlySessions(for: familiar.id).map(Entry.server)
        return (local + server).sorted { $0.date > $1.date }
    }

    var body: some View {
        Group {
            if entries.isEmpty {
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
                Button(action: startNewChat) {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("New chat")
            }
        }
        .refreshable { await app.loadSessions() }
        .task { await app.loadSessions() }
    }

    private var threadList: some View {
        List {
            ForEach(entries) { entry in
                Button { open(entry) } label: { row(entry) }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
            .onDelete(perform: delete)
        }
        .listStyle(.plain)
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

    /// Swipe-to-delete removes on-device threads; a server-only session can't be
    /// deleted from here (it lives on the desktop), so those rows are skipped.
    private func delete(_ offsets: IndexSet) {
        for index in offsets {
            if case .local(let thread) = entries[index] { app.deleteThread(thread) }
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
