import SwiftUI

/// App-wide search from the Claude Design drawer. Results come only from
/// collections the native client already owns; selecting one routes through the
/// same intents as its primary surface instead of creating a second navigation
/// model inside search.
struct GlobalSearchView: View {
    private enum SearchScope: String, CaseIterable, Identifiable {
        case project
        case everywhere

        var id: String { rawValue }
    }

    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.scenePhase) private var scenePhase
    @State private var query: String = {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--ui-search-query"), index + 1 < args.count {
            return args[index + 1]
        }
        #endif
        return ""
    }()
    @State private var effectiveQuery: String = {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--ui-search-query"), index + 1 < args.count {
            return args[index + 1]
        }
        #endif
        return ""
    }()
    @State private var scope: SearchScope = .project
    @State private var searchRevision: UInt64 = 0
    @State private var pendingMeasuredQuery: String?
    @State private var settledMeasuredQuery = ""
    @State private var searchMeasurementTask: Task<Void, Never>?

    private struct SearchProjection {
        let chats: [GlobalChatSearchResult]
        let projects: [ProjectInfo]
        let familiars: [Familiar]
        let tasks: [BoardCard]

        var hasResults: Bool {
            !chats.isEmpty || !projects.isEmpty || !familiars.isEmpty || !tasks.isEmpty
        }
    }

    let dismiss: () -> Void
    let openThread: (ChatThread) -> Void
    let openServerSession: (SessionRow, String?) -> Void
    let openProject: (ProjectInfo) -> Void
    let openFamiliar: (Familiar) -> Void
    let openTask: (BoardCard) -> Void

    var body: some View {
        let projection = makeSearchProjection()
        NavigationStack {
            VStack(spacing: 0) {
                scopePicker
                content(projection)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: queryBinding, prompt: "Search everything…")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", action: dismiss)
                }
            }
            .task { await preloadSearchData() }
        }
        .themedSheetBackground()
        .background {
            CavePerformanceStableFrame(token: "search-\(searchRevision)") {
                guard let pendingMeasuredQuery else { return }
                app.performanceSpans.finish(.searchQuery)
                settledMeasuredQuery = pendingMeasuredQuery
                self.pendingMeasuredQuery = nil
            }
            .frame(width: 0, height: 0)
        }
        .overlay(alignment: .topLeading) {
            if CavePerformanceFixture.shouldEnable(
                arguments: ProcessInfo.processInfo.arguments
            ), !settledMeasuredQuery.isEmpty {
                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityElement()
                    .accessibilityLabel("Performance search settled")
                    .accessibilityIdentifier(
                        "Performance search settled \(settledMeasuredQuery)"
                    )
            }
        }
        .onDisappear {
            searchMeasurementTask?.cancel()
            searchMeasurementTask = nil
            pendingMeasuredQuery = nil
            app.performanceSpans.cancel(.searchQuery)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                if normalizedInputQuery != normalizedQuery {
                    scheduleSearchMeasurement(for: query)
                }
            } else {
                searchMeasurementTask?.cancel()
                searchMeasurementTask = nil
                pendingMeasuredQuery = nil
                app.performanceSpans.cancel(.searchQuery)
            }
        }
    }

    @ViewBuilder
    private func content(_ projection: SearchProjection) -> some View {
        if normalizedQuery.isEmpty {
            emptyQueryState
        } else if projection.hasResults {
            results(projection)
        } else if isLoadingSearchData {
            loadingState
        } else if let error = searchError {
            errorState(error)
        } else {
            noResultsState
        }
    }

    private var scopePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Search scope")
                .font(.caption.weight(.semibold))
                .foregroundStyle(chrome.textSecondary)
            Picker("Search scope", selection: scopeBinding) {
                Text(projectScopeLabel).tag(SearchScope.project)
                Text("Everywhere").tag(SearchScope.everywhere)
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Global search scope")
            .accessibilityIdentifier("Global search scope")
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 14)
        .background(chrome.bgBase)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(chrome.border.opacity(0.6))
                .frame(height: 1)
        }
    }

    private var emptyQueryState: some View {
        ContentUnavailableView {
            Label(emptyQueryTitle, systemImage: "magnifyingglass")
        } description: {
            Text(emptyQueryDescription)
        }
    }

    private var loadingState: some View {
        VStack(spacing: 16) {
            ProgressView(loadingCopy)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ error: String) -> some View {
        ContentUnavailableView {
            Label(errorTitle, systemImage: "exclamationmark.triangle")
        } description: {
            Text("\(error) Close search and try again once \(searchScopeRetryCopy).")
        }
    }

    private var noResultsState: some View {
        ContentUnavailableView {
            Label(noResultsTitle, systemImage: "magnifyingglass")
        } description: {
            Text(noResultsDescription)
        }
    }

    private func results(_ projection: SearchProjection) -> some View {
        List {
            if !projection.chats.isEmpty {
                Section("Chats") {
                    ForEach(projection.chats, id: \.id) { result in
                        Button { open(result) } label: { chatRow(result) }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(result.accessibilityIdentifier)
                    }
                }
            }

            if scope == .everywhere, !projection.projects.isEmpty {
                Section("Projects") {
                    ForEach(projection.projects) { project in
                        Button { openProject(project) } label: {
                            SearchResultRow(
                                systemImage: "folder.fill",
                                title: project.name,
                                subtitle: project.root
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("Global search project \(project.id)")
                    }
                }
            }

            if !projection.familiars.isEmpty {
                Section("Familiars") {
                    ForEach(projection.familiars) { familiar in
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
                                        .lineLimit(1)
                                    if let subtitle = familiarSubtitle(familiar), !subtitle.isEmpty {
                                        Text(subtitle)
                                            .font(.subheadline)
                                            .foregroundStyle(chrome.textSecondary)
                                            .lineLimit(2)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 2)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("Global search familiar \(familiar.id)")
                    }
                }
            }

            if !projection.tasks.isEmpty {
                Section("Tasks") {
                    ForEach(projection.tasks) { card in
                        Button { openTask(card) } label: {
                            SearchResultRow(
                                systemImage: card.status.systemImage,
                                title: card.title,
                                subtitle: taskSubtitle(card),
                                trailing: card.priority.label
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("Global search task \(card.id)")
                    }
                }
            }
        }
        .listStyle(.plain)
        .themedListBackground()
    }

    private var normalizedQuery: String {
        effectiveQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var normalizedInputQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var queryBinding: Binding<String> {
        Binding(
            get: { query },
            set: { newValue in
                guard newValue != query else { return }
                query = newValue
                scheduleSearchMeasurement(for: newValue)
            }
        )
    }

    private var scopeBinding: Binding<SearchScope> {
        Binding(
            get: { scope },
            set: { newValue in
                guard newValue != scope else { return }
                scope = newValue
                scheduleSearchMeasurement(for: query)
            }
        )
    }

    private func scheduleSearchMeasurement(for rawQuery: String) {
        searchMeasurementTask?.cancel()
        searchMeasurementTask = nil
        pendingMeasuredQuery = nil
        app.performanceSpans.cancel(.searchQuery)

        let measuredQuery = rawQuery
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !measuredQuery.isEmpty else {
            effectiveQuery = ""
            settledMeasuredQuery = ""
            searchRevision &+= 1
            return
        }

        searchMeasurementTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled,
                  scenePhase == .active,
                  normalizedInputQuery == measuredQuery
            else { return }
            app.performanceSpans.begin(.searchQuery)
            pendingMeasuredQuery = measuredQuery
            effectiveQuery = measuredQuery
            searchRevision &+= 1
            searchMeasurementTask = nil
        }
    }

    private func makeSearchProjection() -> SearchProjection {
        SearchProjection(
            chats: matchingChats,
            projects: matchingProjects,
            familiars: matchingFamiliars,
            tasks: matchingTasks
        )
    }

    private var projectScopeLabel: String {
        app.projectContext?.displayName ?? "Current project"
    }

    private var loadingCopy: String {
        switch scope {
        case .project:
            return "Loading search in \(projectScopeLabel)…"
        case .everywhere:
            return "Loading search everywhere…"
        }
    }

    private var errorTitle: String {
        switch scope {
        case .project:
            return "Couldn't search \(projectScopeLabel)"
        case .everywhere:
            return "Couldn't search everywhere"
        }
    }

    private var searchScopeRetryCopy: String {
        switch scope {
        case .project:
            return "\(projectScopeLabel) finishes loading"
        case .everywhere:
            return "the rest of Cave finishes loading"
        }
    }

    private var emptyQueryTitle: String {
        switch scope {
        case .project:
            return "Search \(projectScopeLabel)"
        case .everywhere:
            return "Search everywhere"
        }
    }

    private var emptyQueryDescription: String {
        switch scope {
        case .project:
            return "Find chats, familiars, and tasks in \(projectScopeLabel)."
        case .everywhere:
            return "Find chats, projects, familiars, and tasks everywhere."
        }
    }

    private var noResultsTitle: String {
        switch scope {
        case .project:
            return "No results in \(projectScopeLabel)"
        case .everywhere:
            return "No results everywhere"
        }
    }

    private var noResultsDescription: String {
        switch scope {
        case .project:
            return "Try another term or switch to Everywhere."
        case .everywhere:
            return "Try another term to search across Cave."
        }
    }

    private var isLoadingSearchData: Bool {
        !app.sessionsLoaded || !app.projectsLoaded || !app.familiarsLoaded || !app.tasksLoaded
    }

    private var searchError: String? {
        let errors: [String?]
        switch scope {
        case .project:
            errors = [app.projectContextError, app.sessionsError, app.familiarsError, app.tasksError]
        case .everywhere:
            errors = [app.projectsError, app.sessionsError, app.familiarsError, app.tasksError]
        }
        return errors.compactMap(nonEmpty).first
    }

    private var searchThreads: [ChatThread] {
        switch scope {
        case .project:
            return app.projectThreads
        case .everywhere:
            return app.chatThreads
        }
    }

    private var searchServerSessions: [SessionRow] {
        switch scope {
        case .project:
            return app.projectServerSessions
        case .everywhere:
            return app.chatServerSessions
        }
    }

    private var searchFamiliars: [Familiar] {
        switch scope {
        case .project:
            return app.projectFamiliars
        case .everywhere:
            return app.familiars
        }
    }

    private var searchTasks: [BoardCard] {
        switch scope {
        case .project:
            return app.projectTasks
        case .everywhere:
            return app.tasks
        }
    }

    private var matchingChats: [GlobalChatSearchResult] {
        let q = normalizedQuery
        guard !q.isEmpty else { return [] }

        let authoritativeSessionsByID = Dictionary(
            uniqueKeysWithValues: searchServerSessions.map { ($0.id, $0) }
        )

        let local = searchThreads
            .filter { !$0.archived }
            .filter {
                chatMatches(
                    $0,
                    authoritativeSessions: authoritativeSessions(
                        boundTo: $0,
                        sessionsByID: authoritativeSessionsByID
                    ),
                    query: q
                )
            }
            .map(GlobalChatSearchResult.local)

        let boundSessionIDs = Set(
            searchThreads
                .flatMap(sessionIDsBoundToThread)
                .filter { !$0.isEmpty }
        )
        let server = searchServerSessions
            .filter {
                $0.archivedAt == nil
                    && !$0.isGeneratedRun
                    && !boundSessionIDs.contains($0.id)
            }
            .filter { chatMatches($0, query: q) }
            .map { GlobalChatSearchResult.server($0, familiarId: $0.familiarId) }

        return (local + server).sorted { $0.updatedAt > $1.updatedAt }
    }

    private var matchingProjects: [ProjectInfo] {
        let q = normalizedQuery
        guard scope == .everywhere, !q.isEmpty else { return [] }
        return app.projects.filter { projectMatches($0, query: q) }
    }

    private var matchingFamiliars: [Familiar] {
        let q = normalizedQuery
        guard !q.isEmpty else { return [] }
        return searchFamiliars.filter { familiarMatches($0, query: q) }
    }

    private var matchingTasks: [BoardCard] {
        let q = normalizedQuery
        guard !q.isEmpty else { return [] }
        return searchTasks.filter { taskMatches($0, query: q) }
    }

    private var unassignedFamiliarIDs: Set<String> {
        Set(ProjectContext.unassignedFamiliarIDs(
            threads: app.chatThreads,
            sessions: app.chatServerSessions,
            tasks: app.tasks,
            registeredProjects: app.projects
        ))
    }

    private func projectMatches(_ project: ProjectInfo, query: String) -> Bool {
        contains(query, in: [project.name, project.root])
    }

    private func chatMatches(
        _ thread: ChatThread,
        authoritativeSessions: [SessionRow],
        query: String
    ) -> Bool {
        contains(
            query,
            in: [
                thread.title,
                threadPreview(thread),
                familiarNames(for: thread),
                app.projectContext(for: thread).displayName,
            ] + authoritativeSessions.flatMap(authoritativeChatFields)
        )
    }

    private func chatMatches(_ session: SessionRow, query: String) -> Bool {
        contains(query, in: [
            session.title,
            session.familiarId.flatMap { app.familiar($0)?.displayName },
            app.projectContext(for: session).displayName,
            session.projectRoot,
        ])
    }

    private func familiarMatches(_ familiar: Familiar, query: String) -> Bool {
        contains(query, in: [
            familiar.displayName,
            familiar.id,
            familiar.role,
            familiarContextSummary(familiar),
        ])
    }

    private func taskMatches(_ card: BoardCard, query: String) -> Bool {
        contains(query, in: [
            card.title,
            card.notes,
            taskProjectLabel(card),
            card.familiarId.flatMap { app.familiar($0)?.displayName },
            card.status.label,
            card.priority.label,
        ])
    }

    private func contains(_ query: String, in fields: [String?]) -> Bool {
        fields.compactMap(nonEmpty).contains { $0.lowercased().contains(query) }
    }

    private func sessionIDsBoundToThread(_ thread: ChatThread) -> [String] {
        thread.sessionIds.values.compactMap(nonEmpty)
    }

    private func authoritativeSessions(
        boundTo thread: ChatThread,
        sessionsByID: [String: SessionRow]
    ) -> [SessionRow] {
        sessionIDsBoundToThread(thread).compactMap { sessionsByID[$0] }
    }

    private func authoritativeChatFields(_ session: SessionRow) -> [String?] {
        [
            session.title,
            session.familiarId.flatMap { app.familiar($0)?.displayName },
            app.projectContext(for: session).displayName,
            session.projectRoot,
        ]
    }

    private func nonEmpty(_ text: String?) -> String? {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    private func threadPreview(_ thread: ChatThread) -> String? {
        guard let text = thread.messages.last?.text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !text.isEmpty
        else { return nil }
        return text
    }

    private func familiarNames(for thread: ChatThread) -> String? {
        nonEmpty(
            thread.familiarIds
                .compactMap { app.familiar($0)?.displayName }
                .joined(separator: ", ")
        )
    }

    private func taskProjectLabel(_ card: BoardCard) -> String {
        card.projectId.flatMap(app.project)?.name ?? "Unassigned"
    }

    private func taskSubtitle(_ card: BoardCard) -> String {
        [
            taskProjectLabel(card),
            card.familiarId.flatMap { app.familiar($0)?.displayName },
            card.status.label,
        ]
        .compactMap(nonEmpty)
        .joined(separator: " • ")
    }

    private func familiarSubtitle(_ familiar: Familiar) -> String? {
        let subtitle = [
            familiar.role,
            familiarContextSummary(familiar),
        ]
        .compactMap(nonEmpty)
        .joined(separator: " • ")
        return nonEmpty(subtitle)
    }

    private func familiarContextSummary(_ familiar: Familiar) -> String? {
        switch scope {
        case .project:
            return projectScopeLabel
        case .everywhere:
            var names = app.projectMembership
                .projectIDs(forFamiliarID: familiar.id)
                .compactMap(app.project)
                .map(\.name)

            if unassignedFamiliarIDs.contains(familiar.id) {
                names.append("Unassigned")
            }

            let uniqueNames = Array(Set(names)).sorted {
                let order = $0.localizedCaseInsensitiveCompare($1)
                if order == .orderedSame { return $0 < $1 }
                return order == .orderedAscending
            }
            return nonEmpty(uniqueNames.joined(separator: ", "))
        }
    }

    private func chatSubtitle(for thread: ChatThread) -> String? {
        let subtitle = [
            app.projectContext(for: thread).displayName,
            threadPreview(thread) ?? familiarNames(for: thread),
        ]
        .compactMap(nonEmpty)
        .joined(separator: " • ")
        return nonEmpty(subtitle)
    }

    private func chatSubtitle(for session: SessionRow, familiarId: String?) -> String? {
        let subtitle = [
            app.projectContext(for: session).displayName,
            (familiarId ?? session.familiarId).flatMap { app.familiar($0)?.displayName },
        ]
        .compactMap(nonEmpty)
        .joined(separator: " • ")
        return nonEmpty(subtitle)
    }

    private func open(_ result: GlobalChatSearchResult) {
        switch result {
        case .local(let thread):
            openThread(thread)
        case .server(let session, let familiarId):
            openServerSession(session, familiarId)
        }
    }

    @ViewBuilder
    private func chatRow(_ result: GlobalChatSearchResult) -> some View {
        switch result {
        case .local(let thread):
            SearchResultRow(
                systemImage: thread.isGroup ? "person.3.fill" : "bubble.left.fill",
                title: thread.title,
                subtitle: chatSubtitle(for: thread),
                trailing: thread.updatedAt.formatted(.relative(presentation: .numeric))
            )
        case .server(let session, let familiarId):
            SearchResultRow(
                systemImage: "desktopcomputer",
                title: session.title.isEmpty ? "Untitled chat" : session.title,
                subtitle: chatSubtitle(for: session, familiarId: familiarId),
                trailing: caveParseISO(session.updatedAt)?
                    .formatted(.relative(presentation: .numeric))
            )
        }
    }

    private func preloadSearchData() async {
        if !app.familiarsLoaded { await app.loadFamiliars() }
        if !app.sessionsLoaded { await app.loadSessions() }
        if !app.projectsLoaded { await app.loadProjects() }
        if !app.tasksLoaded { await app.loadTasks() }
    }
}

@MainActor
private enum GlobalChatSearchResult {
    case local(ChatThread)
    case server(SessionRow, familiarId: String?)

    var id: String {
        switch self {
        case .local(let thread):
            return "local:\(thread.id)"
        case .server(let session, _):
            return "server:\(session.id)"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .local(let thread):
            return "Global search chat \(thread.id)"
        case .server(let session, _):
            return "Global search session \(session.id)"
        }
    }

    var updatedAt: Date {
        switch self {
        case .local(let thread):
            return thread.updatedAt
        case .server(let session, _):
            return caveParseISO(session.updatedAt) ?? .distantPast
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
                        .lineLimit(2)
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
