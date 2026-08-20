import Foundation

enum ProjectContext: Codable, Hashable, Identifiable, Sendable {
    enum SelectionReason: Equatable, Sendable {
        case suppliedSelection
        case localThread
        case serverSession
        case taskHistory
        case alphabeticalFallback
        case unassignedFallback
        case none
    }

    struct SelectionDecision: Equatable, Sendable {
        var context: ProjectContext?
        var reason: SelectionReason
    }

    case project(ProjectInfo)
    case unassigned

    var id: String {
        switch self {
        case .project(let project):
            return "project:\(project.id)"
        case .unassigned:
            return "unassigned"
        }
    }

    var projectId: String? {
        switch self {
        case .project(let project):
            return project.id
        case .unassigned:
            return nil
        }
    }

    var root: String? {
        switch self {
        case .project(let project):
            return project.root
        case .unassigned:
            return nil
        }
    }

    var displayName: String {
        switch self {
        case .project(let project):
            return project.name
        case .unassigned:
            return "Unassigned"
        }
    }

    @MainActor
    func matches(thread: ChatThread) -> Bool {
        switch self {
        case .project(let project):
            return ProjectRootResolver.matches(thread.projectRoot, projectRoot: project.root)
        case .unassigned:
            return ProjectRootResolver.normalized(thread.projectRoot) == nil
        }
    }

    @MainActor
    func matches(thread: ChatThread, registeredProjects: [ProjectInfo] = []) -> Bool {
        matches(thread: thread, using: ProjectRootResolver.Index(projects: registeredProjects))
    }

    func matches(session: SessionRow) -> Bool {
        switch self {
        case .project(let project):
            return ProjectRootResolver.matches(session.projectRoot, projectRoot: project.root)
        case .unassigned:
            return ProjectRootResolver.normalized(session.projectRoot) == nil
        }
    }

    func matches(session: SessionRow, registeredProjects: [ProjectInfo] = []) -> Bool {
        matches(session: session, using: ProjectRootResolver.Index(projects: registeredProjects))
    }

    func matches(task: BoardCard) -> Bool {
        switch self {
        case .project(let project):
            return Self.normalizedTaskProjectID(task.projectId) == project.id
        case .unassigned:
            return Self.normalizedTaskProjectID(task.projectId) == nil
        }
    }

    func matches(task: BoardCard, registeredProjects: [ProjectInfo]) -> Bool {
        matches(task: task, registeredProjectIDs: Set(registeredProjects.map(\.id)))
    }

    private func matches(task: BoardCard, registeredProjectIDs: Set<String>) -> Bool {
        let resolvedProjectID = Self.registeredTaskProjectID(
            task.projectId,
            registeredProjectIDs: registeredProjectIDs
        )
        switch self {
        case .project(let project):
            return resolvedProjectID == project.id
        case .unassigned:
            return resolvedProjectID == nil
        }
    }

    @MainActor
    static func defaultSelection(
        restored: ProjectContext?,
        projects: [ProjectInfo],
        threads: [ChatThread],
        sessions: [SessionRow],
        tasks: [BoardCard],
        allowAlphabeticalFallback: Bool = true
    ) -> ProjectContext? {
        selectionDecision(
            restored: restored,
            projects: projects,
            threads: threads,
            sessions: sessions,
            tasks: tasks,
            allowAlphabeticalFallback: allowAlphabeticalFallback
        ).context
    }

    @MainActor
    static func selectionDecision(
        restored: ProjectContext?,
        projects: [ProjectInfo],
        threads: [ChatThread],
        sessions: [SessionRow],
        tasks: [BoardCard],
        allowAlphabeticalFallback: Bool = true
    ) -> SelectionDecision {
        let rootIndex = ProjectRootResolver.Index(projects: projects)
        let unassignedAvailable = hasUnassignedArtifacts(
            threads: threads,
            sessions: sessions,
            tasks: tasks,
            using: rootIndex,
            registeredProjectIDs: Set(projects.map(\.id))
        )
        let projectsByID = Dictionary(
            projects.map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )

        if let restored {
            switch restored {
            case .project(let project):
                if let current = projectsByID[project.id] {
                    return SelectionDecision(
                        context: .project(current),
                        reason: .suppliedSelection
                    )
                }
            case .unassigned:
                if unassignedAvailable {
                    return SelectionDecision(context: .unassigned, reason: .suppliedSelection)
                }
            }
        }

        if let project = mostRecentRegisteredProject(in: threads, using: rootIndex) {
            return SelectionDecision(context: .project(project), reason: .localThread)
        }

        if let project = mostRecentRegisteredProject(
            in: visibleServerSessions(sessions, excluding: threads),
            using: rootIndex
        ) {
            return SelectionDecision(context: .project(project), reason: .serverSession)
        }

        if let project = mostRecentRegisteredProject(in: tasks, projectsByID: projectsByID) {
            return SelectionDecision(context: .project(project), reason: .taskHistory)
        }

        if allowAlphabeticalFallback,
           let project = sortedProjects(projects).first {
            return SelectionDecision(context: .project(project), reason: .alphabeticalFallback)
        }

        if unassignedAvailable {
            return SelectionDecision(context: .unassigned, reason: .unassignedFallback)
        }

        return SelectionDecision(context: nil, reason: .none)
    }

    @MainActor
    static func unassignedFamiliarIDs(
        threads: [ChatThread],
        sessions: [SessionRow],
        tasks: [BoardCard],
        registeredProjects: [ProjectInfo] = []
    ) -> [String] {
        let rootIndex = ProjectRootResolver.Index(projects: registeredProjects)
        let registeredProjectIDs = Set(registeredProjects.map(\.id))
        let threadFamiliarIDs = threads
            .filter { unassigned.matches(thread: $0, using: rootIndex) }
            .flatMap(\.familiarIds)
        let sessionFamiliarIDs = sessions
            .filter { unassigned.matches(session: $0, using: rootIndex) }
            .compactMap(\.familiarId)
        let taskFamiliarIDs = tasks
            .filter { unassigned.matches(task: $0, registeredProjectIDs: registeredProjectIDs) }
            .compactMap(\.familiarId)
        return orderedDistinctIDs(threadFamiliarIDs + sessionFamiliarIDs + taskFamiliarIDs)
    }

    @MainActor
    static func hasUnassignedArtifacts(
        threads: [ChatThread],
        sessions: [SessionRow],
        tasks: [BoardCard],
        registeredProjects: [ProjectInfo] = []
    ) -> Bool {
        hasUnassignedArtifacts(
            threads: threads,
            sessions: sessions,
            tasks: tasks,
            using: ProjectRootResolver.Index(projects: registeredProjects),
            registeredProjectIDs: Set(registeredProjects.map(\.id))
        )
    }

    static func registeredProject(
        for root: String?,
        in registeredProjects: [ProjectInfo]
    ) -> ProjectInfo? {
        ProjectRootResolver.project(for: root, in: registeredProjects)
    }

    static func normalizedProjectRoot(_ value: String?) -> String? {
        ProjectRootResolver.normalized(value)
    }

    static func openContext(
        for root: String?,
        in registeredProjects: [ProjectInfo]
    ) -> ProjectContext? {
        guard let normalizedRoot = ProjectRootResolver.normalized(root) else {
            return .unassigned
        }
        guard ProjectRootResolver.canResolveCandidateRoot(normalizedRoot) else {
            return nil
        }
        let rootIndex = ProjectRootResolver.Index(projects: registeredProjects)
        if let project = rootIndex.project(for: normalizedRoot) {
            return .project(project)
        }
        return .unassigned
    }

    static func context(
        for root: String?,
        in registeredProjects: [ProjectInfo]
    ) -> ProjectContext {
        openContext(for: root, in: registeredProjects) ?? .unassigned
    }

    @MainActor
    private func matches(thread: ChatThread, using rootIndex: ProjectRootResolver.Index) -> Bool {
        switch self {
        case .project(let project):
            return rootIndex.project(for: thread.projectRoot)?.id == project.id
        case .unassigned:
            return rootIndex.project(for: thread.projectRoot) == nil
        }
    }

    private func matches(session: SessionRow, using rootIndex: ProjectRootResolver.Index) -> Bool {
        switch self {
        case .project(let project):
            return rootIndex.project(for: session.projectRoot)?.id == project.id
        case .unassigned:
            return rootIndex.project(for: session.projectRoot) == nil
        }
    }

    @MainActor
    private static func hasUnassignedArtifacts(
        threads: [ChatThread],
        sessions: [SessionRow],
        tasks: [BoardCard],
        using rootIndex: ProjectRootResolver.Index,
        registeredProjectIDs: Set<String>
    ) -> Bool {
        threads.contains { unassigned.matches(thread: $0, using: rootIndex) }
            || sessions.contains { unassigned.matches(session: $0, using: rootIndex) }
            || tasks.contains {
                unassigned.matches(task: $0, registeredProjectIDs: registeredProjectIDs)
            }
    }

    private enum CodingKeys: String, CodingKey {
        case kind
        case project
    }

    private enum Kind: String, Codable {
        case project
        case unassigned
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .project:
            guard let project = try container.decodeIfPresent(ProjectInfo.self, forKey: .project) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .project,
                    in: container,
                    debugDescription: "Project contexts must include a project payload."
                )
            }
            self = .project(project)
        case .unassigned:
            self = .unassigned
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .project(let project):
            try container.encode(Kind.project, forKey: .kind)
            try container.encode(project, forKey: .project)
        case .unassigned:
            try container.encode(Kind.unassigned, forKey: .kind)
        }
    }

    private static func normalizedTaskProjectID(_ value: String?) -> String? {
        guard let value,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return value
    }

    private static func registeredTaskProjectID(
        _ value: String?,
        registeredProjectIDs: Set<String>
    ) -> String? {
        guard let projectID = normalizedTaskProjectID(value) else { return nil }
        return registeredProjectIDs.contains(projectID) ? projectID : nil
    }

    private static func normalizedNonEmptyValue(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private static func orderedDistinctIDs(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.compactMap { value in
            guard let normalized = normalizedNonEmptyValue(value),
                  seen.insert(normalized).inserted else { return nil }
            return normalized
        }
    }

    @MainActor
    private static func mostRecentRegisteredProject(
        in threads: [ChatThread],
        using rootIndex: ProjectRootResolver.Index
    ) -> ProjectInfo? {
        threads
            .sorted {
                if $0.updatedAt == $1.updatedAt { return $0.id < $1.id }
                return $0.updatedAt > $1.updatedAt
            }
            .compactMap { rootIndex.project(for: $0.projectRoot) }
            .first
    }

    private static func mostRecentRegisteredProject(
        in sessions: [SessionRow],
        using rootIndex: ProjectRootResolver.Index
    ) -> ProjectInfo? {
        sessions
            .sorted {
                let leftUpdatedAt = normalizedNonEmptyValue($0.updatedAt)
                    .flatMap(PermissionModels.parseISO) ?? .distantPast
                let rightUpdatedAt = normalizedNonEmptyValue($1.updatedAt)
                    .flatMap(PermissionModels.parseISO) ?? .distantPast
                if leftUpdatedAt == rightUpdatedAt { return $0.id < $1.id }
                return leftUpdatedAt > rightUpdatedAt
            }
            .compactMap { rootIndex.project(for: $0.projectRoot) }
            .first
    }

    private static func mostRecentRegisteredProject(
        in tasks: [BoardCard],
        projectsByID: [String: ProjectInfo]
    ) -> ProjectInfo? {
        tasks
            .sorted(by: moreRecentTask)
            .compactMap { task in
                guard let projectID = normalizedTaskProjectID(task.projectId) else { return nil }
                return projectsByID[projectID]
            }
            .first
    }

    @MainActor
    private static func visibleServerSessions(
        _ sessions: [SessionRow],
        excluding threads: [ChatThread]
    ) -> [SessionRow] {
        let boundSessionIDs = Set(
            threads
                .flatMap(\.sessionIds.values)
                .compactMap(normalizedNonEmptyValue)
        )
        return sessions.filter { session in
            normalizedNonEmptyValue(session.archivedAt) == nil
                && !session.isGeneratedRun
                && !boundSessionIDs.contains(session.id)
        }
    }

    private static func sortedProjects(_ projects: [ProjectInfo]) -> [ProjectInfo] {
        projects.sorted {
            let order = $0.name.localizedCaseInsensitiveCompare($1.name)
            if order == .orderedSame {
                return $0.id < $1.id
            }
            return order == .orderedAscending
        }
    }

    private static func moreRecentTask(_ lhs: BoardCard, _ rhs: BoardCard) -> Bool {
        let leftUpdatedAt = normalizedNonEmptyValue(lhs.updatedAt).flatMap(caveParseISO)
        let rightUpdatedAt = normalizedNonEmptyValue(rhs.updatedAt).flatMap(caveParseISO)
        if leftUpdatedAt != rightUpdatedAt {
            return leftUpdatedAt.isMoreRecent(than: rightUpdatedAt)
        }

        let leftCreatedAt = normalizedNonEmptyValue(lhs.createdAt).flatMap(caveParseISO)
        let rightCreatedAt = normalizedNonEmptyValue(rhs.createdAt).flatMap(caveParseISO)
        if leftCreatedAt != rightCreatedAt {
            return leftCreatedAt.isMoreRecent(than: rightCreatedAt)
        }

        return lhs.id < rhs.id
    }

    private enum ProjectRootResolver {
        struct Index {
            private let registeredProjects: [(project: ProjectInfo, normalizedRoot: String)]

            init(projects: [ProjectInfo]) {
                self.registeredProjects = ProjectRootResolver.normalizedProjects(projects)
            }

            func project(for candidateRoot: String?) -> ProjectInfo? {
                guard let normalizedCandidateRoot = ProjectRootResolver.normalizedCandidateRoot(candidateRoot)
                else { return nil }

                if let exactMatch = registeredProjects.first(where: {
                    $0.normalizedRoot == normalizedCandidateRoot
                }) {
                    return exactMatch.project
                }

                return registeredProjects.first(where: {
                    ProjectRootResolver.isWorktreeRoot(normalizedCandidateRoot, within: $0.normalizedRoot)
                })?.project
            }
        }

        static func normalized(_ value: String?) -> String? {
            guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !trimmed.isEmpty
            else { return nil }

            var normalized = trimmed.replacingOccurrences(of: "\\", with: "/")
            while normalized.count > rootLength(of: normalized),
                  normalized.last == "/" {
                normalized.removeLast()
            }
            return normalized.isEmpty ? "/" : normalized
        }

        static func matches(_ candidateRoot: String?, projectRoot: String) -> Bool {
            guard let normalizedProjectRoot = normalized(projectRoot) else { return false }
            guard let resolvedProjectRoot = resolvedProjectRoot(for: candidateRoot, matching: [normalizedProjectRoot])
            else { return false }
            return resolvedProjectRoot == normalizedProjectRoot
        }

        static func project(
            for candidateRoot: String?,
            in projects: [ProjectInfo]
        ) -> ProjectInfo? {
            Index(projects: projects).project(for: candidateRoot)
        }

        static func canResolveCandidateRoot(_ value: String?) -> Bool {
            normalizedCandidateRoot(value) != nil
        }

        private static func resolvedProjectRoot(
            for candidateRoot: String?,
            matching projectRoots: [String]
        ) -> String? {
            guard let normalizedCandidateRoot = normalizedCandidateRoot(candidateRoot) else { return nil }
            let normalizedProjectRoots = projectRoots
                .compactMap(normalized)
                .sorted {
                    if $0.count == $1.count { return $0 < $1 }
                    return $0.count > $1.count
                }

            return normalizedProjectRoots.first(where: { $0 == normalizedCandidateRoot })
                ?? normalizedProjectRoots.first(where: {
                    isWorktreeRoot(normalizedCandidateRoot, within: $0)
                })
        }

        private static func normalizedProjects(
            _ projects: [ProjectInfo]
        ) -> [(project: ProjectInfo, normalizedRoot: String)] {
            projects
                .compactMap { project in
                    guard let normalizedRoot = normalized(project.root) else { return nil }
                    return (project, normalizedRoot)
                }
                .sorted {
                    if $0.normalizedRoot.count == $1.normalizedRoot.count {
                        return $0.normalizedRoot < $1.normalizedRoot
                    }
                    return $0.normalizedRoot.count > $1.normalizedRoot.count
                }
        }

        private static func normalizedCandidateRoot(_ value: String?) -> String? {
            guard let normalized = normalized(value),
                  !containsDotSegments(normalized)
            else { return nil }
            return normalized
        }

        private static func containsDotSegments(_ path: String) -> Bool {
            path.split(separator: "/", omittingEmptySubsequences: true)
                .contains { $0 == "." || $0 == ".." }
        }

        private static func isWorktreeRoot(
            _ candidateRoot: String,
            within projectRoot: String
        ) -> Bool {
            let prefix = projectRoot == "/"
                ? "/.worktrees/"
                : "\(projectRoot)/.worktrees/"
            guard candidateRoot.hasPrefix(prefix) else { return false }
            let relative = candidateRoot.dropFirst(prefix.count)
            return !relative.isEmpty && !relative.hasPrefix("/")
        }

        private static func rootLength(of path: String) -> Int {
            if path == "/" { return 1 }
            if let driveRootLength = windowsDriveRootLength(of: path) {
                return driveRootLength
            }
            if let uncRootLength = uncRootLength(of: path) {
                return uncRootLength
            }
            return 0
        }

        private static func windowsDriveRootLength(of path: String) -> Int? {
            let characters = Array(path)
            guard characters.count >= 3,
                  characters[0].isLetter,
                  characters[1] == ":",
                  characters[2] == "/"
            else { return nil }
            return 3
        }

        private static func uncRootLength(of path: String) -> Int? {
            guard path.hasPrefix("//") else { return nil }
            let segments = path.split(separator: "/", omittingEmptySubsequences: true)
            guard segments.count >= 2 else { return nil }
            return 3 + segments[0].count + segments[1].count
        }
    }
}

private extension Optional where Wrapped == Date {
    func isMoreRecent(than other: Date?) -> Bool {
        switch (self, other) {
        case let (.some(lhs), .some(rhs)):
            return lhs > rhs
        case (.some, nil):
            return true
        case (nil, .some):
            return false
        case (nil, nil):
            return false
        }
    }
}

struct ProjectMembershipIndex: Hashable, Sendable {
    private var familiarIDsByProjectID: [String: Set<String>]

    init(familiarIDsByProjectID: [String: Set<String>] = [:]) {
        self.familiarIDsByProjectID = familiarIDsByProjectID
    }

    var projectIDs: [String] {
        familiarIDsByProjectID.keys.sorted()
    }

    func familiarIDs(for project: ProjectInfo) -> Set<String> {
        familiarIDs(forProjectID: project.id)
    }

    func familiarIDs(forProjectID projectId: String) -> Set<String> {
        familiarIDsByProjectID[projectId] ?? []
    }

    func contains(_ familiarId: String, in project: ProjectInfo) -> Bool {
        contains(familiarId, inProjectID: project.id)
    }

    func contains(_ familiarId: String, inProjectID projectId: String) -> Bool {
        familiarIDsByProjectID[projectId, default: []].contains(familiarId)
    }

    func projectIDs(forFamiliarID familiarId: String) -> [String] {
        familiarIDsByProjectID.keys
            .filter { contains(familiarId, inProjectID: $0) }
            .sorted()
    }

    static func build(
        projects: [ProjectInfo],
        familiars: [Familiar],
        directGrants: [ProjectGrant],
        groups: [FamiliarAccessGroup],
        supremeFamiliarId: String?
    ) -> ProjectMembershipIndex {
        let supremeFamiliarId = supremeFamiliarId?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let candidateFamiliarIDs = orderedDistinctFamiliarIDs(
            familiars.map(\.id) + [supremeFamiliarId].compactMap { $0 }
        )

        var familiarIDsByProjectID: [String: Set<String>] = [:]
        for project in projects {
            var familiarIDs = Set<String>()
            for familiarId in candidateFamiliarIDs {
                if familiarId == supremeFamiliarId {
                    familiarIDs.insert(familiarId)
                    continue
                }

                let effective = PermissionModels.resolveEffectiveAccess(
                    directGrants: directGrants,
                    groups: groups,
                    familiarId: familiarId,
                    projectId: project.id
                )
                if effective.level != nil {
                    familiarIDs.insert(familiarId)
                }
            }
            familiarIDsByProjectID[project.id] = familiarIDs
        }

        return ProjectMembershipIndex(familiarIDsByProjectID: familiarIDsByProjectID)
    }

    private static func orderedDistinctFamiliarIDs(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.compactMap { value in
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, seen.insert(trimmed).inserted else { return nil }
            return trimmed
        }
    }
}
