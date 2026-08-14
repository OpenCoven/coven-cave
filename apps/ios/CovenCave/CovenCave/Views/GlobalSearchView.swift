import SwiftUI

/// App-wide search from the Claude Design drawer. Results come only from
/// collections the native client already owns; selecting one routes through the
/// same intents as its primary surface instead of creating a second navigation
/// model inside search.
struct GlobalSearchView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @State private var query: String = {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--ui-search-query"), index + 1 < args.count {
            return args[index + 1]
        }
        #endif
        return ""
    }()

    let dismiss: () -> Void
    let openThread: (ChatThread) -> Void
    let openProject: (ProjectInfo) -> Void
    let openFamiliar: (Familiar) -> Void
    let openTask: (BoardCard) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if normalizedQuery.isEmpty {
                    ContentUnavailableView {
                        Label("Search Coven Cave", systemImage: "magnifyingglass")
                    } description: {
                        Text("Find chats, projects, familiars, and tasks.")
                    }
                } else if hasResults {
                    results
                } else {
                    ContentUnavailableView.search(text: query)
                }
            }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search everything…")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", action: dismiss)
                }
            }
            .task {
                if !app.sessionsLoaded { await app.loadSessions() }
                if !app.projectsLoaded { await app.loadProjects() }
                if !app.tasksLoaded { await app.loadTasks() }
            }
        }
        .themedSheetBackground()
    }

    private var results: some View {
        List {
            if !matchingChats.isEmpty {
                Section("Chats") {
                    ForEach(Array(matchingChats.enumerated()), id: \.offset) { _, result in
                        Button { open(result) } label: { chatRow(result) }
                        .buttonStyle(.plain)
                    }
                }
            }

            if !matchingProjects.isEmpty {
                Section("Projects") {
                    ForEach(matchingProjects) { project in
                        Button { openProject(project) } label: {
                            SearchResultRow(
                                systemImage: "folder.fill",
                                title: project.name,
                                subtitle: project.root
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if !matchingFamiliars.isEmpty {
                Section("Familiars") {
                    ForEach(matchingFamiliars) { familiar in
                        Button { openFamiliar(familiar) } label: {
                            HStack(spacing: 12) {
                                AvatarView(
                                    familiar: familiar,
                                    url: app.client?.avatarURL(for: familiar),
                                    size: 40,
                                    showStatus: true
                                )
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(familiar.displayName)
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(chrome.textPrimary)
                                    if let role = familiar.role, !role.isEmpty {
                                        Text(role)
                                            .font(.subheadline)
                                            .foregroundStyle(chrome.textSecondary)
                                            .lineLimit(1)
                                    }
                                }
                            }
                            .padding(.vertical, 2)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if !matchingTasks.isEmpty {
                Section("Tasks") {
                    ForEach(matchingTasks) { card in
                        Button { openTask(card) } label: {
                            TaskRow(card: card)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.plain)
        .themedListBackground()
    }

    private var normalizedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var hasResults: Bool {
        !matchingChats.isEmpty
            || !matchingProjects.isEmpty
            || !matchingFamiliars.isEmpty
            || !matchingTasks.isEmpty
    }

    private var matchingChats: [GlobalChatSearchResult] {
        let q = normalizedQuery
        guard !q.isEmpty else { return [] }
        let local = app.threads
            .filter { !$0.archived }
            .filter { thread in
                thread.title.lowercased().contains(q)
                    || thread.messages.last?.text.lowercased().contains(q) == true
                    || thread.familiarIds.contains {
                        app.familiar($0)?.displayName.lowercased().contains(q) == true
                    }
            }
            .map(GlobalChatSearchResult.local)
        let server = app.familiars.flatMap { familiar in
            app.serverOnlySessions(for: familiar.id)
                .filter {
                    $0.title.lowercased().contains(q)
                        || familiar.displayName.lowercased().contains(q)
                        || $0.projectRoot?.lowercased().contains(q) == true
                }
                .map { GlobalChatSearchResult.server($0, familiarId: familiar.id) }
        }
        return (local + server).sorted { $0.updatedAt > $1.updatedAt }
    }

    private var matchingProjects: [ProjectInfo] {
        let q = normalizedQuery
        guard !q.isEmpty else { return [] }
        return app.projects.filter {
            $0.name.lowercased().contains(q) || $0.root.lowercased().contains(q)
        }
    }

    private var matchingFamiliars: [Familiar] {
        let q = normalizedQuery
        guard !q.isEmpty else { return [] }
        return app.familiars.filter {
            $0.displayName.lowercased().contains(q)
                || $0.id.lowercased().contains(q)
                || $0.role?.lowercased().contains(q) == true
        }
    }

    private var matchingTasks: [BoardCard] {
        let q = normalizedQuery
        guard !q.isEmpty else { return [] }
        return app.tasks.filter { card in
            card.title.lowercased().contains(q)
                || card.notes?.lowercased().contains(q) == true
                || card.projectId.flatMap(app.project)?.name.lowercased().contains(q) == true
        }
    }

    private func threadPreview(_ thread: ChatThread) -> String? {
        guard let text = thread.messages.last?.text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !text.isEmpty
        else { return nil }
        return text
    }

    private func open(_ result: GlobalChatSearchResult) {
        switch result {
        case .local(let thread):
            openThread(thread)
        case .server(let session, let familiarId):
            openThread(app.openServerSession(session, familiarId: familiarId))
        }
    }

    @ViewBuilder
    private func chatRow(_ result: GlobalChatSearchResult) -> some View {
        switch result {
        case .local(let thread):
            SearchResultRow(
                systemImage: thread.isGroup ? "person.3.fill" : "bubble.left.fill",
                title: thread.title,
                subtitle: threadPreview(thread),
                trailing: thread.updatedAt.formatted(.relative(presentation: .numeric))
            )
        case .server(let session, let familiarId):
            SearchResultRow(
                systemImage: "desktopcomputer",
                title: session.title.isEmpty ? "Untitled chat" : session.title,
                subtitle: app.familiar(familiarId)?.displayName,
                trailing: caveParseISO(session.updatedAt)?
                    .formatted(.relative(presentation: .numeric))
            )
        }
    }
}

@MainActor
private enum GlobalChatSearchResult {
    case local(ChatThread)
    case server(SessionRow, familiarId: String)

    var updatedAt: Date {
        switch self {
        case .local(let thread): return thread.updatedAt
        case .server(let session, _): return caveParseISO(session.updatedAt) ?? .distantPast
        }
    }
}

private struct SearchResultRow: View {
    @Environment(\.chrome) private var chrome
    let systemImage: String
    let title: String
    var subtitle: String?
    var trailing: String?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(chrome.accent)
                .frame(width: 36, height: 36)
                .background(chrome.bgRaised, in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
                    .lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(chrome.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing)
                    .font(.caption)
                    .foregroundStyle(chrome.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}
