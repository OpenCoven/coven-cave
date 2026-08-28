import SwiftUI

enum ProjectContextCopy {
    static let loadFailureFallback =
        "Cave reached your desktop, but it couldn’t finish loading project access."
    static let noProjectsTitle = "No projects yet"
    static let noProjectsMessage =
        "Open Coven Cave on your desktop and add a project folder to group chats by codebase, then retry here."
    static let cachedAccessBanner = "Showing cached project access"
    static let unassignedRecovery =
        "Projectless or unregistered work needs recovery. Add or repair a project folder on your desktop."
}

struct ProjectContextCounts: Equatable, Sendable {
    let chatCount: Int
    let familiarCount: Int
    let taskCount: Int

    var summary: String? {
        let parts = [
            chatCount > 0 ? "\(chatCount) chat\(chatCount == 1 ? "" : "s")" : nil,
            familiarCount > 0 ? "\(familiarCount) familiar\(familiarCount == 1 ? "" : "s")" : nil,
            taskCount > 0 ? "\(taskCount) task\(taskCount == 1 ? "" : "s")" : nil,
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

struct ProjectSwitcherRowModel: Identifiable, Equatable, Sendable {
    let context: ProjectContext
    let counts: ProjectContextCounts
    let isSelected: Bool
    let recoveryText: String?

    var id: String { context.id }
}

enum ProjectSwitcherState: Equatable, Sendable {
    case loading
    case firstLoadError(message: String)
    case emptyNoProjects
    case loaded(rows: [ProjectSwitcherRowModel], cachedError: String?)
}

enum ProjectContextGateState: Equatable, Sendable {
    case ready
    case loading
    case retryableError(message: String)
    case noProjects

    var title: String {
        switch self {
        case .ready:
            return ""
        case .loading:
            return "Loading project access"
        case .retryableError:
            return "Couldn’t load project access"
        case .noProjects:
            return ProjectContextCopy.noProjectsTitle
        }
    }

    var message: String {
        switch self {
        case .ready:
            return ""
        case .loading:
            return "Pulling project membership and the active context from your desktop."
        case .retryableError(let message):
            return message.isEmpty ? ProjectContextCopy.loadFailureFallback : message
        case .noProjects:
            return ProjectContextCopy.noProjectsMessage
        }
    }

    var systemImage: String {
        switch self {
        case .ready, .loading, .retryableError:
            return "folder.badge.questionmark"
        case .noProjects:
            return "folder.badge.plus"
        }
    }

    var showsRetry: Bool {
        switch self {
        case .ready, .loading:
            return false
        case .retryableError, .noProjects:
            return true
        }
    }
}

extension AppModel {
    @MainActor
    var projectContextGateState: ProjectContextGateState {
        if projectMembershipLoaded {
            if projectContext != nil {
                return .ready
            }
            if projectsLoaded && projects.isEmpty {
                return .noProjects
            }
        }
        if let message = projectContextError {
            return .retryableError(message: message)
        }
        return .loading
    }

    @MainActor
    var projectSwitcherState: ProjectSwitcherState {
        guard projectMembershipLoaded else {
            if let message = projectContextError {
                return .firstLoadError(message: message)
            }
            return .loading
        }

        let rows = availableProjectContexts.map { context in
            ProjectSwitcherRowModel(
                context: context,
                counts: projectContextCounts(for: context),
                isSelected: projectContext == context,
                recoveryText: context == .unassigned ? ProjectContextCopy.unassignedRecovery : nil
            )
        }

        if !rows.isEmpty {
            return .loaded(rows: rows, cachedError: projectContextError)
        }
        if projectsLoaded && projects.isEmpty {
            return .emptyNoProjects
        }
        if let message = projectContextError {
            return .firstLoadError(message: message)
        }
        return .loading
    }

    @MainActor
    var availableProjectContexts: [ProjectContext] {
        var contexts = projects.map(ProjectContext.project)
        if hasRecoverableUnassignedArtifacts {
            contexts.append(.unassigned)
        }
        return contexts
    }

    @MainActor
    var hasRecoverableUnassignedArtifacts: Bool {
        ProjectContext.hasUnassignedArtifacts(
            threads: threads,
            sessions: serverSessions,
            tasks: tasks,
            registeredProjects: projects
        )
    }

    @MainActor
    func projectContextCounts(for context: ProjectContext) -> ProjectContextCounts {
        ProjectContextCounts(
            chatCount: visibleThreads(for: context).count + visibleServerOnlySessions(for: context).count,
            familiarCount: scopedFamiliars(for: context).count,
            taskCount: tasks.filter { context.matches(task: $0, registeredProjects: projects) }.count
        )
    }

    @MainActor
    func retryProjectContextLoad() async {
        guard connection != nil else { return }
        if connectionState == .connected {
            await loadProjectContext()
        } else {
            await connectWithRetry()
        }
    }

    @MainActor
    private func visibleThreads(for context: ProjectContext) -> [ChatThread] {
        threads.filter { !$0.archived && context.matches(thread: $0, registeredProjects: projects) }
    }

    @MainActor
    private func visibleServerOnlySessions(for context: ProjectContext) -> [SessionRow] {
        let boundSessionIDs = Set(
            threads
                .flatMap(\.sessionIds.values)
                .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        )
        return serverSessions.filter { session in
            context.matches(session: session, registeredProjects: projects)
                && session.archivedAt == nil
                && !session.isGeneratedRun
                && !boundSessionIDs.contains(session.id)
        }
    }

    @MainActor
    private func scopedFamiliars(for context: ProjectContext) -> [Familiar] {
        switch context {
        case .project(let selected):
            let projectID = project(selected.id)?.id ?? selected.id
            let allowed = projectMembership.familiarIDs(forProjectID: projectID)
            guard !allowed.isEmpty else { return [] }
            return familiars.filter { allowed.contains($0.id) }
        case .unassigned:
            let byID = Dictionary(
                familiars.map { ($0.id, $0) },
                uniquingKeysWith: { first, _ in first }
            )
            let ids = ProjectContext.unassignedFamiliarIDs(
                threads: threads,
                sessions: serverSessions,
                tasks: tasks,
                registeredProjects: projects
            )
            return ids.compactMap { byID[$0] }
        }
    }
}

struct ProjectContextButton: View {
    @Environment(AppModel.self) private var app
    let action: () -> Void

    var body: some View {
        PillSelector(
            label: "Projects",
            sublabel: contextLabel,
            active: app.projectContext != nil,
            fillsWidth: true,
            accessibilityHint: "Opens the project switcher.",
            action: action
        ) {
            ProjectContextGlyph(context: app.projectContext, size: 28)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 44)
        .accessibilityIdentifier("Project context button")
        .accessibilityLabel("Projects")
        .accessibilityValue(accessibilityValue)
    }

    @MainActor
    private var contextLabel: String {
        switch app.projectContextGateState {
        case .ready:
            return app.projectContext?.displayName ?? "Choose a project"
        case .loading:
            return "Loading projects"
        case .retryableError:
            return "Project access"
        case .noProjects:
            return "No projects"
        }
    }

    @MainActor
    private var accessibilityValue: String {
        switch app.projectContextGateState {
        case .ready:
            return app.projectContext?.displayName ?? "Choose a project"
        case .loading:
            return "Loading project access"
        case .retryableError:
            return "Retry required"
        case .noProjects:
            return "No projects configured"
        }
    }
}

struct ProjectSwitcherView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch app.projectSwitcherState {
                case .loading:
                    loadingState
                case .firstLoadError(let message):
                    failureState(message: message)
                case .emptyNoProjects:
                    noProjectsState
                case .loaded(let rows, let cachedError):
                    loadedState(rows: rows, cachedError: cachedError)
                }
            }
            .navigationTitle("Switch project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
        }
        .themedSheetBackground()
    }

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
            Text("Loading project access…")
                .font(.headline)
            Text("Pulling your projects, grants, and active context from the desktop.")
                .font(.subheadline)
                .foregroundStyle(chrome.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func failureState(message: String) -> some View {
        ContentUnavailableView {
            Label("Couldn’t load project access", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message.isEmpty ? ProjectContextCopy.loadFailureFallback : message)
        } actions: {
            Button("Retry") {
                Task { await app.retryProjectContextLoad() }
            }
            .buttonStyle(.borderedProminent)
            .frame(minWidth: 44, minHeight: 44)
        }
    }

    private var noProjectsState: some View {
        ContentUnavailableView {
            Label(ProjectContextCopy.noProjectsTitle, systemImage: "folder.badge.plus")
        } description: {
            Text(ProjectContextCopy.noProjectsMessage)
        } actions: {
            Button("Retry") {
                Task { await app.retryProjectContextLoad() }
            }
            .buttonStyle(.borderedProminent)
            .frame(minWidth: 44, minHeight: 44)
        }
    }

    private func loadedState(
        rows: [ProjectSwitcherRowModel],
        cachedError: String?
    ) -> some View {
        List(rows) { row in
            Button {
                if !row.isSelected {
                    app.switchProject(to: row.context)
                }
                dismiss()
            } label: {
                ProjectSwitcherRow(row: row)
            }
            .buttonStyle(.plain)
            .listRowBackground(Color.clear)
            .listRowSeparatorTint(chrome.border.opacity(0.6))
        }
        .listStyle(.plain)
        .themedListBackground()
        .safeAreaInset(edge: .top, spacing: 0) {
            if cachedError != nil {
                ProjectContextRetryBanner(label: ProjectContextCopy.cachedAccessBanner) {
                    Task { await app.retryProjectContextLoad() }
                }
            }
        }
    }
}

struct ProjectContextGateView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @State private var showingSettings = false

    private var state: ProjectContextGateState { app.projectContextGateState }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 16) {
                Image(systemName: state.systemImage)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(chrome.accent)
                    .frame(width: 68, height: 68)
                    .background(chrome.bgRaised, in: RoundedRectangle(cornerRadius: 18))
                    .accessibilityHidden(true)

                Text(state.title)
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)

                Text(state.message)
                    .font(.body)
                    .foregroundStyle(chrome.textSecondary)
                    .multilineTextAlignment(.center)

                if state == .loading {
                    ProgressView()
                        .controlSize(.large)
                        .padding(.top, 4)
                }

                if state.showsRetry {
                    buttonRow
                } else {
                    settingsButton
                }
            }
            .padding(24)
            .frame(maxWidth: 520)
            .glass(.raised, cornerRadius: 24)

            Spacer()
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $showingSettings) {
            SettingsView(presentedModally: true)
        }
    }

    private var buttonRow: some View {
        VStack(spacing: 12) {
            Button("Retry") {
                Task { await app.retryProjectContextLoad() }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .frame(minWidth: 44, minHeight: 44)
            .accessibilityIdentifier("Project context retry")

            settingsButton
        }
    }

    private var settingsButton: some View {
        Button("Settings") {
            if app.hasLoadedSurfaces {
                app.selectedTab = .settings
            } else {
                showingSettings = true
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .frame(minWidth: 44, minHeight: 44)
        .accessibilityIdentifier("Project context settings")
    }
}

private struct ProjectSwitcherRow: View {
    @Environment(\.chrome) private var chrome
    let row: ProjectSwitcherRowModel

    var body: some View {
        HStack(spacing: 13) {
            ProjectContextGlyph(context: row.context, size: 40)

            VStack(alignment: .leading, spacing: 3) {
                Text(row.context.displayName)
                    .font(.headline)
                    .foregroundStyle(chrome.textPrimary)

                if let summary = row.counts.summary {
                    Text(summary)
                        .font(.subheadline)
                        .foregroundStyle(chrome.textSecondary)
                }

                if let recoveryText = row.recoveryText {
                    Text(recoveryText)
                        .font(.caption)
                        .foregroundStyle(chrome.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: 12)

            if row.isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(row.isSelected ? chrome.bgRaised : Color.clear)
        )
        .accessibilityIdentifier("Project row \(row.id)")
        .accessibilityElement(children: .combine)
        .accessibilityValue(row.isSelected ? "Selected" : "")
    }

    private var tint: Color {
        switch row.context {
        case .project(let project):
            return Color(hex: project.color) ?? chrome.accent
        case .unassigned:
            return chrome.textSecondary
        }
    }
}

private struct ProjectContextGlyph: View {
    @Environment(\.chrome) private var chrome
    let context: ProjectContext?
    var size: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(tint.opacity(0.18))
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: symbolName)
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(tint)
            }
    }

    private var tint: Color {
        switch context {
        case .project(let project):
            return Color(hex: project.color) ?? chrome.accent
        case .unassigned:
            return chrome.textSecondary
        case nil:
            return chrome.accent
        }
    }

    private var symbolName: String {
        switch context {
        case .project:
            return "folder.fill"
        case .unassigned:
            return "tray.full.fill"
        case nil:
            return "folder.badge.questionmark"
        }
    }
}

private struct ProjectContextRetryBanner: View {
    @Environment(\.chrome) private var chrome
    let label: String
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
            Text(label)
                .font(.footnote)
            Spacer()
            Button("Retry", action: retry)
                .font(.footnote.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .foregroundStyle(chrome.textSecondary)
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .background(chrome.bgRaised)
    }
}
