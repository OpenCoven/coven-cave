import XCTest
@testable import CovenCave

private struct StubProjectContextClient: ProjectContextLoadingClient, @unchecked Sendable {
    var projectsResult: Result<[ProjectInfo], Error>
    var grantsResult: Result<ProjectGrantsResponse, Error>
    var familiarsResult: Result<[Familiar], Error>
    var sessionsResult: Result<[SessionRow], Error> = .success([])
    var tasksResult: Result<[BoardCard], Error> = .success([])

    func projects() async throws -> [ProjectInfo] {
        try projectsResult.get()
    }

    func projectGrants() async throws -> ProjectGrantsResponse {
        try grantsResult.get()
    }

    func familiars() async throws -> [Familiar] {
        try familiarsResult.get()
    }

    func sessions() async throws -> [SessionRow] {
        try sessionsResult.get()
    }

    func tasks() async throws -> [BoardCard] {
        try tasksResult.get()
    }
}

private actor Gate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func open() {
        guard !opened else { return }
        opened = true
        for waiter in waiters { waiter.resume() }
        waiters.removeAll()
    }

    func wait() async {
        if opened { return }
        await withCheckedContinuation { waiters.append($0) }
    }
}

private actor CoreClientCallLog {
    enum HistoryCall: String, Equatable, Sendable {
        case sessions
        case tasks
    }

    private(set) var projects = 0
    private(set) var grants = 0
    private(set) var familiars = 0
    private(set) var sessions = 0
    private(set) var tasks = 0
    private(set) var historyOrder: [HistoryCall] = []
    private(set) var taskSessionUpdates: [(cardId: String, sessionId: String?)] = []
    private(set) var taskProjectUpdates: [(cardId: String, projectId: String)] = []

    func recordProjects() { projects += 1 }
    func recordGrants() { grants += 1 }
    func recordFamiliars() { familiars += 1 }
    func recordSessions() {
        sessions += 1
        historyOrder.append(.sessions)
    }

    func recordTasks() {
        tasks += 1
        historyOrder.append(.tasks)
    }

    func recordTaskSessionUpdate(cardId: String, sessionId: String?) {
        taskSessionUpdates.append((cardId, sessionId))
    }

    func recordTaskProjectUpdate(cardId: String, projectId: String) {
        taskProjectUpdates.append((cardId, projectId))
    }

    func snapshot() -> (projects: Int, grants: Int, familiars: Int, sessions: Int, tasks: Int) {
        (projects, grants, familiars, sessions, tasks)
    }

    func historyOrderSnapshot() -> [HistoryCall] {
        historyOrder
    }

    func taskSessionUpdateSnapshot() -> [(cardId: String, sessionId: String?)] {
        taskSessionUpdates
    }

    func taskProjectUpdateSnapshot() -> [(cardId: String, projectId: String)] {
        taskProjectUpdates
    }
}

private final class ControlledCoreClient: AppModelCoreResourceClient, TaskSessionUpdatingClient, TaskProjectUpdatingClient, @unchecked Sendable {
    let callLog = CoreClientCallLog()
    private let projectsResult: Result<[ProjectInfo], Error>
    private let grantsResult: Result<ProjectGrantsResponse, Error>
    private let familiarsResult: Result<[Familiar], Error>
    private let sessionsResult: Result<[SessionRow], Error>
    private let tasksResult: Result<[BoardCard], Error>
    private let taskCards: [BoardCard]
    private let taskSessionUpdateError: Error?
    private let taskProjectUpdateError: Error?
    private let themeValue: ThemeSnapshot
    private let profileValue: OperatorProfile
    private let contextStarted: Gate?
    private let contextRelease: Gate?
    private let historyStarted: Gate?
    private let historyRelease: Gate?
    private let sessionStarted: Gate?
    private let sessionRelease: Gate?
    private let taskStarted: Gate?
    private let taskRelease: Gate?

    init(
        projects: [ProjectInfo],
        grants: ProjectGrantsResponse,
        familiars: [Familiar],
        sessions: [SessionRow] = [],
        tasks: [BoardCard] = [],
        projectsResult: Result<[ProjectInfo], Error>? = nil,
        grantsResult: Result<ProjectGrantsResponse, Error>? = nil,
        familiarsResult: Result<[Familiar], Error>? = nil,
        sessionsResult: Result<[SessionRow], Error>? = nil,
        tasksResult: Result<[BoardCard], Error>? = nil,
        taskSessionUpdateError: Error? = nil,
        taskProjectUpdateError: Error? = nil,
        theme: ThemeSnapshot = ThemeSnapshot(
            themeId: "cave",
            mode: "dark",
            tokens: ["--bg-base": "#101014"],
            updatedAt: "2026-08-19T00:00:00Z"
        ),
        profile: OperatorProfile = OperatorProfile(
            name: "Val",
            pronouns: nil,
            avatarPresent: false,
            avatarUpdatedAt: nil
        ),
        contextStarted: Gate? = nil,
        contextRelease: Gate? = nil,
        historyStarted: Gate? = nil,
        historyRelease: Gate? = nil,
        sessionStarted: Gate? = nil,
        sessionRelease: Gate? = nil,
        taskStarted: Gate? = nil,
        taskRelease: Gate? = nil
    ) {
        self.projectsResult = projectsResult ?? .success(projects)
        self.grantsResult = grantsResult ?? .success(grants)
        self.familiarsResult = familiarsResult ?? .success(familiars)
        self.sessionsResult = sessionsResult ?? .success(sessions)
        self.tasksResult = tasksResult ?? .success(tasks)
        self.taskCards = tasks
        self.taskSessionUpdateError = taskSessionUpdateError
        self.taskProjectUpdateError = taskProjectUpdateError
        self.themeValue = theme
        self.profileValue = profile
        self.contextStarted = contextStarted
        self.contextRelease = contextRelease
        self.historyStarted = historyStarted
        self.historyRelease = historyRelease
        self.sessionStarted = sessionStarted
        self.sessionRelease = sessionRelease
        self.taskStarted = taskStarted
        self.taskRelease = taskRelease
    }

    func ping() async -> Bool { true }

    func projects() async throws -> [ProjectInfo] {
        await callLog.recordProjects()
        await contextStarted?.open()
        await contextRelease?.wait()
        return try projectsResult.get()
    }

    func projectGrants() async throws -> ProjectGrantsResponse {
        await callLog.recordGrants()
        await contextStarted?.open()
        await contextRelease?.wait()
        return try grantsResult.get()
    }

    func familiars() async throws -> [Familiar] {
        await callLog.recordFamiliars()
        await contextStarted?.open()
        await contextRelease?.wait()
        return try familiarsResult.get()
    }

    func sessions() async throws -> [SessionRow] {
        await callLog.recordSessions()
        await sessionStarted?.open()
        await historyStarted?.open()
        await sessionRelease?.wait()
        await historyRelease?.wait()
        return try sessionsResult.get()
    }

    func tasks() async throws -> [BoardCard] {
        await callLog.recordTasks()
        await taskStarted?.open()
        await historyStarted?.open()
        await taskRelease?.wait()
        await historyRelease?.wait()
        return try tasksResult.get()
    }

    func updateTaskSession(cardId: String, sessionId: String?) async throws -> BoardCard {
        await callLog.recordTaskSessionUpdate(cardId: cardId, sessionId: sessionId)
        if let taskSessionUpdateError {
            throw taskSessionUpdateError
        }
        guard var updated = taskCards.first(where: { $0.id == cardId }) else {
            throw NSError(
                domain: "AppModelProjectContextTests",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Missing task \(cardId)"]
            )
        }
        updated.sessionId = sessionId
        return updated
    }

    func updateTaskProject(cardId: String, projectId: String) async throws -> BoardCard {
        await callLog.recordTaskProjectUpdate(cardId: cardId, projectId: projectId)
        if let taskProjectUpdateError {
            throw taskProjectUpdateError
        }
        guard var updated = taskCards.first(where: { $0.id == cardId }) else {
            throw NSError(
                domain: "AppModelProjectContextTests",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Missing task \(cardId)"]
            )
        }
        updated.projectId = projectId
        return updated
    }

    func fetchTheme() async throws -> ThemeSnapshot { themeValue }

    func operatorProfile() async throws -> OperatorProfile { profileValue }

    func refreshAccessToken() async -> String? { nil }
}

private struct SequencedHistoryStep<Value>: @unchecked Sendable {
    let result: Result<Value, any Error>
    let started: Gate?
    let release: Gate?

    init(
        result: Result<Value, any Error>,
        started: Gate? = nil,
        release: Gate? = nil
    ) {
        self.result = result
        self.started = started
        self.release = release
    }
}

private actor SequencedHistoryPlan<Value> {
    private var steps: [SequencedHistoryStep<Value>]

    init(_ steps: [SequencedHistoryStep<Value>] = []) {
        self.steps = steps
    }

    func next(label: String) async throws -> Value {
        guard !steps.isEmpty else {
            throw NSError(
                domain: "AppModelProjectContextTests",
                code: 499,
                userInfo: [NSLocalizedDescriptionKey: "Unexpected \(label) call."]
            )
        }
        let step = steps.removeFirst()
        await step.started?.open()
        await step.release?.wait()
        return try step.result.get()
    }
}

private final class SequencedHistoryCoreClient: AppModelCoreResourceClient, @unchecked Sendable {
    let callLog = CoreClientCallLog()
    private let projectsValue: [ProjectInfo]
    private let grantsValue: ProjectGrantsResponse
    private let familiarsValue: [Familiar]
    private let sessionsPlan: SequencedHistoryPlan<[SessionRow]>
    private let tasksPlan: SequencedHistoryPlan<[BoardCard]>
    private let themeValue: ThemeSnapshot
    private let profileValue: OperatorProfile

    init(
        projects: [ProjectInfo],
        grants: ProjectGrantsResponse,
        familiars: [Familiar],
        sessionSteps: [SequencedHistoryStep<[SessionRow]>] = [],
        taskSteps: [SequencedHistoryStep<[BoardCard]>] = [],
        theme: ThemeSnapshot = ThemeSnapshot(
            themeId: "cave",
            mode: "dark",
            tokens: ["--bg-base": "#101014"],
            updatedAt: "2026-08-19T00:00:00Z"
        ),
        profile: OperatorProfile = OperatorProfile(
            name: "Val",
            pronouns: nil,
            avatarPresent: false,
            avatarUpdatedAt: nil
        )
    ) {
        self.projectsValue = projects
        self.grantsValue = grants
        self.familiarsValue = familiars
        self.sessionsPlan = SequencedHistoryPlan(sessionSteps)
        self.tasksPlan = SequencedHistoryPlan(taskSteps)
        self.themeValue = theme
        self.profileValue = profile
    }

    func ping() async -> Bool { true }
    func projects() async throws -> [ProjectInfo] { projectsValue }
    func projectGrants() async throws -> ProjectGrantsResponse { grantsValue }
    func familiars() async throws -> [Familiar] { familiarsValue }

    func sessions() async throws -> [SessionRow] {
        await callLog.recordSessions()
        return try await sessionsPlan.next(label: "sessions")
    }

    func tasks() async throws -> [BoardCard] {
        await callLog.recordTasks()
        return try await tasksPlan.next(label: "tasks")
    }

    func fetchTheme() async throws -> ThemeSnapshot { themeValue }
    func operatorProfile() async throws -> OperatorProfile { profileValue }
    func refreshAccessToken() async -> String? { nil }
}

private actor RetryingProjectGrantsPlan {
    private var remainingFailures: Int
    private let failure: Error
    private let success: ProjectGrantsResponse

    init(remainingFailures: Int, failure: Error, success: ProjectGrantsResponse) {
        self.remainingFailures = remainingFailures
        self.failure = failure
        self.success = success
    }

    func next() throws -> ProjectGrantsResponse {
        if remainingFailures > 0 {
            remainingFailures -= 1
            throw failure
        }
        return success
    }
}

private final class RetryingProjectContextCoreClient: AppModelCoreResourceClient, @unchecked Sendable {
    private let projectsValue: [ProjectInfo]
    private let familiarsValue: [Familiar]
    private let sessionsValue: [SessionRow]
    private let tasksValue: [BoardCard]
    private let grantsPlan: RetryingProjectGrantsPlan
    private let themeValue: ThemeSnapshot
    private let profileValue: OperatorProfile

    init(
        projects: [ProjectInfo],
        grants: ProjectGrantsResponse,
        familiars: [Familiar],
        sessions: [SessionRow] = [],
        tasks: [BoardCard] = [],
        failuresRemaining: Int,
        failure: Error,
        theme: ThemeSnapshot = ThemeSnapshot(
            themeId: "cave",
            mode: "dark",
            tokens: ["--bg-base": "#101014"],
            updatedAt: "2026-08-19T00:00:00Z"
        ),
        profile: OperatorProfile = OperatorProfile(
            name: "Val",
            pronouns: nil,
            avatarPresent: false,
            avatarUpdatedAt: nil
        )
    ) {
        self.projectsValue = projects
        self.familiarsValue = familiars
        self.sessionsValue = sessions
        self.tasksValue = tasks
        self.grantsPlan = RetryingProjectGrantsPlan(
            remainingFailures: failuresRemaining,
            failure: failure,
            success: grants
        )
        self.themeValue = theme
        self.profileValue = profile
    }

    func ping() async -> Bool { true }
    func projects() async throws -> [ProjectInfo] { projectsValue }
    func projectGrants() async throws -> ProjectGrantsResponse { try await grantsPlan.next() }
    func familiars() async throws -> [Familiar] { familiarsValue }
    func sessions() async throws -> [SessionRow] { sessionsValue }
    func tasks() async throws -> [BoardCard] { tasksValue }
    func fetchTheme() async throws -> ThemeSnapshot { themeValue }
    func operatorProfile() async throws -> OperatorProfile { profileValue }
    func refreshAccessToken() async -> String? { nil }
}

private actor InterleavingTaskMutationClient: AppModelCoreResourceClient, TaskFieldsUpdatingClient,
    TaskProjectUpdatingClient
{
    private let baseCard: BoardCard
    private let projectsValue: [ProjectInfo]
    private let grantsValue: ProjectGrantsResponse
    private let familiarsValue: [Familiar]
    private let projectUpdateResult: Result<BoardCard, Error>
    private let projectUpdateStarted: Gate?
    private let projectUpdateRelease: Gate?
    private let themeValue = ThemeSnapshot(
        themeId: "cave",
        mode: "dark",
        tokens: ["--bg-base": "#101014"],
        updatedAt: "2026-08-19T00:00:00Z"
    )
    private let profileValue = OperatorProfile(
        name: "Val",
        pronouns: nil,
        avatarPresent: false,
        avatarUpdatedAt: nil
    )

    init(
        baseCard: BoardCard,
        projects: [ProjectInfo],
        grants: ProjectGrantsResponse,
        familiars: [Familiar],
        projectUpdateResult: Result<BoardCard, Error>,
        projectUpdateStarted: Gate? = nil,
        projectUpdateRelease: Gate? = nil
    ) {
        self.baseCard = baseCard
        self.projectsValue = projects
        self.grantsValue = grants
        self.familiarsValue = familiars
        self.projectUpdateResult = projectUpdateResult
        self.projectUpdateStarted = projectUpdateStarted
        self.projectUpdateRelease = projectUpdateRelease
    }

    func ping() async -> Bool { true }
    func projects() async throws -> [ProjectInfo] { projectsValue }
    func projectGrants() async throws -> ProjectGrantsResponse { grantsValue }
    func familiars() async throws -> [Familiar] { familiarsValue }
    func sessions() async throws -> [SessionRow] { [] }
    func tasks() async throws -> [BoardCard] { [baseCard] }
    func fetchTheme() async throws -> ThemeSnapshot { themeValue }
    func operatorProfile() async throws -> OperatorProfile { profileValue }
    func refreshAccessToken() async -> String? { nil }

    func updateTask(
        cardId: String,
        status: CardStatus?,
        priority: CardPriority?,
        steps: [CardStep]?,
        notes: String?
    ) async throws -> BoardCard {
        guard cardId == baseCard.id else {
            throw NSError(
                domain: "AppModelProjectContextTests",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Missing task \(cardId)"]
            )
        }
        var updated = baseCard
        if let status {
            updated.statusRaw = status.rawValue
        }
        if let priority {
            updated.priorityRaw = priority.rawValue
        }
        if let steps {
            updated.steps = steps
        }
        if let notes {
            updated.notes = notes
        }
        return updated
    }

    func updateTaskTitle(cardId: String, title: String) async throws -> BoardCard {
        guard cardId == baseCard.id else {
            throw NSError(
                domain: "AppModelProjectContextTests",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Missing task \(cardId)"]
            )
        }
        var updated = baseCard
        updated.title = title
        return updated
    }

    func updateTaskDates(cardId: String, startDate: String?, endDate: String?) async throws -> BoardCard {
        guard cardId == baseCard.id else {
            throw NSError(
                domain: "AppModelProjectContextTests",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Missing task \(cardId)"]
            )
        }
        var updated = baseCard
        updated.startDate = startDate
        updated.endDate = endDate
        return updated
    }

    func updateTaskProject(cardId: String, projectId: String) async throws -> BoardCard {
        guard cardId == baseCard.id else {
            throw NSError(
                domain: "AppModelProjectContextTests",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Missing task \(cardId)"]
            )
        }
        await projectUpdateStarted?.open()
        await projectUpdateRelease?.wait()
        return try projectUpdateResult.get()
    }
}

private actor SequencedTaskMutationClient: AppModelCoreResourceClient, TaskFieldsUpdatingClient,
    TaskProjectUpdatingClient, TaskSessionUpdatingClient
{
    enum Operation: String, Equatable, Sendable {
        case status
        case priority
        case steps
        case notes
        case title
        case dates
        case project
        case session
    }

    struct Control: Sendable {
        let started: Gate?
        let release: Gate?

        init(started: Gate? = nil, release: Gate? = nil) {
            self.started = started
            self.release = release
        }
    }

    struct Call: Equatable, Sendable {
        let operation: Operation
        let detail: String
    }

    private let baseCard: BoardCard
    private let projectsValue: [ProjectInfo]
    private let grantsValue: ProjectGrantsResponse
    private let familiarsValue: [Familiar]
    private var controls: [Operation: [Control]]
    private var calls: [Call] = []
    private let themeValue = ThemeSnapshot(
        themeId: "cave",
        mode: "dark",
        tokens: ["--bg-base": "#101014"],
        updatedAt: "2026-08-19T00:00:00Z"
    )
    private let profileValue = OperatorProfile(
        name: "Val",
        pronouns: nil,
        avatarPresent: false,
        avatarUpdatedAt: nil
    )

    init(
        baseCard: BoardCard,
        projects: [ProjectInfo],
        grants: ProjectGrantsResponse,
        familiars: [Familiar],
        controls: [Operation: [Control]] = [:]
    ) {
        self.baseCard = baseCard
        self.projectsValue = projects
        self.grantsValue = grants
        self.familiarsValue = familiars
        self.controls = controls
    }

    func callsSnapshot() -> [Call] { calls }

    func ping() async -> Bool { true }
    func projects() async throws -> [ProjectInfo] { projectsValue }
    func projectGrants() async throws -> ProjectGrantsResponse { grantsValue }
    func familiars() async throws -> [Familiar] { familiarsValue }
    func sessions() async throws -> [SessionRow] { [] }
    func tasks() async throws -> [BoardCard] { [baseCard] }
    func fetchTheme() async throws -> ThemeSnapshot { themeValue }
    func operatorProfile() async throws -> OperatorProfile { profileValue }
    func refreshAccessToken() async -> String? { nil }

    private func nextControl(for operation: Operation) -> Control {
        guard var queue = controls[operation], !queue.isEmpty else { return Control() }
        let control = queue.removeFirst()
        controls[operation] = queue
        return control
    }

    private func run(
        operation: Operation,
        detail: String,
        apply: (inout BoardCard) -> Void
    ) async throws -> BoardCard {
        let control = nextControl(for: operation)
        calls.append(Call(operation: operation, detail: detail))
        await control.started?.open()
        await control.release?.wait()
        var updated = baseCard
        apply(&updated)
        return updated
    }

    private func requireCard(_ cardId: String) throws {
        guard cardId == baseCard.id else {
            throw NSError(
                domain: "AppModelProjectContextTests",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Missing task \(cardId)"]
            )
        }
    }

    private func stepDetail(_ steps: [CardStep]) -> String {
        steps.map { $0.done ? "1" : "0" }.joined(separator: "")
    }

    func updateTask(
        cardId: String,
        status: CardStatus?,
        priority: CardPriority?,
        steps: [CardStep]?,
        notes: String?
    ) async throws -> BoardCard {
        try requireCard(cardId)
        let presentCount = [status != nil, priority != nil, steps != nil, notes != nil]
            .filter { $0 }
            .count
        guard presentCount == 1 else {
            throw NSError(
                domain: "AppModelProjectContextTests",
                code: 400,
                userInfo: [NSLocalizedDescriptionKey: "Expected exactly one field mutation."]
            )
        }
        if let status {
            return try await run(operation: .status, detail: status.rawValue) {
                $0.statusRaw = status.rawValue
            }
        }
        if let priority {
            return try await run(operation: .priority, detail: priority.rawValue) {
                $0.priorityRaw = priority.rawValue
            }
        }
        if let steps {
            return try await run(operation: .steps, detail: stepDetail(steps)) {
                $0.steps = steps
            }
        }
        if let notes {
            return try await run(operation: .notes, detail: notes) {
                $0.notes = notes
            }
        }
        throw NSError(
            domain: "AppModelProjectContextTests",
            code: 400,
            userInfo: [NSLocalizedDescriptionKey: "Missing mutation payload."]
        )
    }

    func updateTaskTitle(cardId: String, title: String) async throws -> BoardCard {
        try requireCard(cardId)
        return try await run(operation: .title, detail: title) {
            $0.title = title
        }
    }

    func updateTaskDates(cardId: String, startDate: String?, endDate: String?) async throws -> BoardCard {
        try requireCard(cardId)
        return try await run(
            operation: .dates,
            detail: "\(startDate ?? "<nil>")->\(endDate ?? "<nil>")"
        ) {
            $0.startDate = startDate
            $0.endDate = endDate
        }
    }

    func updateTaskProject(cardId: String, projectId: String) async throws -> BoardCard {
        try requireCard(cardId)
        return try await run(operation: .project, detail: projectId) {
            $0.projectId = projectId
        }
    }

    func updateTaskSession(cardId: String, sessionId: String?) async throws -> BoardCard {
        try requireCard(cardId)
        return try await run(operation: .session, detail: sessionId ?? "<nil>") {
            $0.sessionId = sessionId
        }
    }
}

@MainActor
final class AppModelProjectContextTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        suiteName = "AppModelProjectContextTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private func withPreservedStandardConnectionMetadata<T>(
        seededHost: String? = nil,
        seededLastGood: [String: String]? = nil,
        operation: () async throws -> T
    ) async rethrows -> T {
        let standard = UserDefaults.standard
        let originalHost = standard.object(forKey: CaveConnection.storageKey)
        let originalLastGood = standard.object(forKey: CaveConnection.lastGoodKey)
        let originalToken = KeychainStore.string(forKey: CaveConnection.tokenKey)
        let originalTokenOrigin = KeychainStore.string(forKey: CaveConnection.tokenOriginKey)

        defer {
            if let originalHost {
                standard.set(originalHost, forKey: CaveConnection.storageKey)
            } else {
                standard.removeObject(forKey: CaveConnection.storageKey)
            }
            if let originalLastGood {
                standard.set(originalLastGood, forKey: CaveConnection.lastGoodKey)
            } else {
                standard.removeObject(forKey: CaveConnection.lastGoodKey)
            }
            if let originalToken {
                KeychainStore.set(originalToken, forKey: CaveConnection.tokenKey)
            } else {
                KeychainStore.remove(CaveConnection.tokenKey)
            }
            if let originalTokenOrigin {
                KeychainStore.set(originalTokenOrigin, forKey: CaveConnection.tokenOriginKey)
            } else {
                KeychainStore.remove(CaveConnection.tokenOriginKey)
            }
        }

        if let seededHost {
            standard.set(seededHost, forKey: CaveConnection.storageKey)
        } else {
            standard.removeObject(forKey: CaveConnection.storageKey)
        }
        if let seededLastGood {
            standard.set(seededLastGood, forKey: CaveConnection.lastGoodKey)
        } else {
            standard.removeObject(forKey: CaveConnection.lastGoodKey)
        }
        KeychainStore.remove(CaveConnection.tokenKey)
        KeychainStore.remove(CaveConnection.tokenOriginKey)

        return try await operation()
    }

    @discardableResult
    private func connect(_ app: AppModel, host: String = "http://cave.test:3000") -> CaveConnection {
        let connection = CaveConnection(host: host)
        app.connection = connection
        return connection
    }

    private func projectContextStorageKey(for connection: CaveConnection) -> String {
        guard let key = AppModel.projectContextStorageKey(for: connection) else {
            XCTFail("expected a scoped project context storage key for \(connection.host)")
            return ""
        }
        return key
    }

    private func persistProjectContextSelection(_ value: String, for connection: CaveConnection) {
        defaults.set(value, forKey: projectContextStorageKey(for: connection))
    }

    private func makeApp(
        restoreLocalState: Bool = false,
        widgetSnapshotDefaults: UserDefaults? = nil,
        threadSnapshotLoader: (@Sendable () async -> [ThreadSnapshot])? = nil,
        coreResourceClientFactory: @escaping @Sendable (CaveConnection) -> any AppModelCoreResourceClient = {
            CaveClient(connection: $0)
        },
        baseURLDiscoverer: @escaping @Sendable ([URL]) async -> AppModel.DiscoveryOutcome = { candidates in
            await AppModel.discoverBaseURL(candidates)
        }
    ) -> AppModel {
        AppModel(
            defaults: defaults,
            restoreLocalState: restoreLocalState,
            widgetSnapshotDefaults: widgetSnapshotDefaults,
            threadSnapshotLoader: threadSnapshotLoader,
            coreResourceClientFactory: coreResourceClientFactory,
            baseURLDiscoverer: baseURLDiscoverer
        )
    }

    private func project(_ id: String, _ name: String, root: String? = nil) -> ProjectInfo {
        ProjectInfo(
            id: id,
            name: name,
            root: root ?? "/repos/\(id)",
            color: nil,
            updatedAt: nil,
            access: nil
        )
    }

    private func familiar(_ id: String, _ name: String) -> Familiar {
        Familiar(
            id: id,
            displayName: name,
            role: nil,
            description: nil,
            pronouns: nil,
            color: nil,
            status: nil,
            harness: nil,
            model: nil,
            icon: nil,
            avatarUrl: nil,
            activeSessions: nil,
            memoryFreshness: nil
        )
    }

    private func thread(
        _ id: String,
        familiarIds: [String],
        projectRoot: String?,
        updatedAt: Date = .distantPast
    ) -> ChatThread {
        let thread = ChatThread(id: id, title: id, familiarIds: familiarIds, projectRoot: projectRoot)
        thread.updatedAt = updatedAt
        return thread
    }

    private func session(
        _ id: String,
        familiarId: String?,
        projectRoot: String?,
        updatedAt: String? = nil
    ) -> SessionRow {
        SessionRow(
            id: id,
            title: id,
            harness: nil,
            model: nil,
            runtime: nil,
            status: nil,
            familiarId: familiarId,
            createdAt: nil,
            updatedAt: updatedAt,
            archivedAt: nil,
            projectRoot: projectRoot,
            origin: nil,
            generated: false
        )
    }

    private func card(
        _ id: String,
        familiarId: String?,
        projectId: String?,
        sessionId: String? = nil,
        createdAt: String? = nil,
        updatedAt: String? = nil
    ) -> BoardCard {
        BoardCard(
            id: id,
            title: id,
            notes: nil,
            statusRaw: "backlog",
            priorityRaw: "medium",
            familiarId: familiarId,
            projectId: projectId,
            sessionId: sessionId,
            labels: nil,
            startDate: nil,
            endDate: nil,
            createdAt: createdAt,
            updatedAt: updatedAt,
            needsHuman: nil,
            steps: nil,
            github: nil
        )
    }

    private func iso(_ seconds: TimeInterval) -> String {
        PermissionModels.isoFormatter.string(from: Date(timeIntervalSince1970: seconds))
    }

    private func grants(
        grants: [ProjectGrant] = [],
        groups: [FamiliarAccessGroup] = [],
        supremeFamiliarId: String? = nil
    ) -> ProjectGrantsResponse {
        ProjectGrantsResponse(
            ok: true,
            grants: grants,
            accessGroups: groups,
            supremeFamiliarId: supremeFamiliarId,
            mobileMutationsAllowed: nil,
            audit: nil,
            error: nil
        )
    }

    private func assertToast(
        _ app: AppModel,
        text: String,
        systemImage: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let toast = app.toast else {
            return XCTFail("Expected toast", file: file, line: line)
        }
        XCTAssertEqual(toast.text, text, file: file, line: line)
        XCTAssertEqual(toast.systemImage, systemImage, file: file, line: line)
    }

    /// Reconnecting posts a success notice — `connectionState`'s `didSet`
    /// announces "Reconnected to Cave" whenever the shell returns to
    /// `.connected` after a drop, and that is deliberate, user-facing
    /// behaviour.
    ///
    /// A test that reconnects mid-flight therefore cannot assert `toast == nil`
    /// and mean "the pending navigation reported nothing". Asserting the toast
    /// is EXACTLY this notice says the same thing without being wrong about the
    /// reconnect: `showToast` replaces `app.toast` outright, so any navigation
    /// failure raised afterwards would be sitting here instead.
    private func assertOnlyReconnectNoticeToast(
        _ app: AppModel,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        assertToast(
            app,
            text: "Reconnected to Cave",
            systemImage: "antenna.radiowaves.left.and.right",
            file: file,
            line: line
        )
        XCTAssertEqual(app.toast?.style, .success, file: file, line: line)
    }

    /// Relocating the connection posts a success notice: when discovery moves
    /// the shell to a different port, `AppModel` announces "Connected on port
    /// N". That is deliberate, user-facing behaviour, so a test that forces a
    /// relocation cannot assert `toast == nil` and mean "the pending navigation
    /// reported nothing".
    ///
    /// Asserting the toast is EXACTLY this notice says the same thing without
    /// being wrong about the relocation: `showToast` replaces `app.toast`
    /// outright, so any navigation toast would have displaced this one.
    private func assertOnlyPortRelocationNoticeToast(
        _ app: AppModel,
        port: Int,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        assertToast(
            app,
            text: "Connected on port \(port)",
            systemImage: "antenna.radiowaves.left.and.right",
            file: file,
            line: line
        )
        XCTAssertEqual(app.toast?.style, .success, file: file, line: line)
    }

    private func waitFor(
        _ condition: @escaping @MainActor () -> Bool,
        iterations: Int = 20,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        for _ in 0..<iterations {
            if condition() { return }
            await Task.yield()
        }
        XCTFail("Condition was not met in time", file: file, line: line)
    }

    private func client(
        projects: [ProjectInfo],
        grants: ProjectGrantsResponse,
        familiars: [Familiar],
        sessions: [SessionRow] = [],
        tasks: [BoardCard] = []
    ) -> StubProjectContextClient {
        StubProjectContextClient(
            projectsResult: .success(projects),
            grantsResult: .success(grants),
            familiarsResult: .success(familiars),
            sessionsResult: .success(sessions),
            tasksResult: .success(tasks)
        )
    }

    private func projectAccessDeniedError(_ message: String) -> CaveError {
        .serverResponse(status: 403, code: "project_access_denied", message: message)
    }

    private func failingClient(message: String) -> StubProjectContextClient {
        let error = NSError(
            domain: "AppModelProjectContextTests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
        return StubProjectContextClient(
            projectsResult: .success([project("alpha", "Alpha")]),
            grantsResult: .failure(error),
            familiarsResult: .success([familiar("nova", "Nova")])
        )
    }

    func testInjectedDefaultsIgnoreAmbientStandardConnectionHost() async {
        await withPreservedStandardConnectionMetadata(
            seededHost: "ambient.example.ts.net"
        ) {
            let app = makeApp()

            XCTAssertNil(app.connection)
            XCTAssertNil(defaults.string(forKey: CaveConnection.storageKey))
            XCTAssertEqual(
                UserDefaults.standard.string(forKey: CaveConnection.storageKey),
                "ambient.example.ts.net"
            )
        }
    }

    func testConfigureRefreshReloadAndDisconnectStayWithinInjectedDefaults() async throws {
        let ambientHost = "ambient.example.ts.net"
        let ambientLastGood = try XCTUnwrap(URL(string: "https://ambient.example.ts.net:8443"))
        let foundURL = try XCTUnwrap(URL(string: "http://isolated.example:4555"))
        let controlledClient = ControlledCoreClient(
            projects: [],
            grants: grants(),
            familiars: []
        )

        await withPreservedStandardConnectionMetadata(
            seededHost: ambientHost,
            seededLastGood: [ambientHost: ambientLastGood.absoluteString]
        ) {
            let app = makeApp(
                coreResourceClientFactory: { _ in controlledClient },
                baseURLDiscoverer: { _ in .found(foundURL) }
            )

            await app.configure(host: "isolated.example")

            XCTAssertEqual(app.connection?.host, "isolated.example:4555")
            XCTAssertEqual(defaults.string(forKey: CaveConnection.storageKey), "isolated.example:4555")
            XCTAssertEqual(
                CaveConnection.lastGoodBaseURL(forHost: "isolated.example", defaults: defaults),
                foundURL
            )
            XCTAssertEqual(UserDefaults.standard.string(forKey: CaveConnection.storageKey), ambientHost)
            XCTAssertEqual(
                CaveConnection.lastGoodBaseURL(forHost: ambientHost, defaults: .standard),
                ambientLastGood
            )

            let reloaded = makeApp()
            XCTAssertEqual(reloaded.connection?.host, "isolated.example:4555")

            reloaded.disconnect()

            XCTAssertNil(reloaded.connection)
            XCTAssertNil(defaults.string(forKey: CaveConnection.storageKey))
            XCTAssertNil(CaveConnection.lastGoodBaseURL(forHost: "isolated.example", defaults: defaults))
            XCTAssertEqual(UserDefaults.standard.string(forKey: CaveConnection.storageKey), ambientHost)
            XCTAssertEqual(
                CaveConnection.lastGoodBaseURL(forHost: ambientHost, defaults: .standard),
                ambientLastGood
            )
        }
    }

    func testLoadProjectContextRestoresPersistedSelectionByProjectContextID() async {
        let app = makeApp()
        let connection = connect(app)
        persistProjectContextSelection("project:docs", for: connection)
        let projects = [
            project("alpha", "Alpha"),
            project("docs", "Docs", root: "/repos/docs-current"),
        ]

        await app.loadProjectContext(using: client(
            projects: projects,
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "docs", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")]
        ))

        XCTAssertEqual(app.projectContext, .project(project("docs", "Docs", root: "/repos/docs-current")))
        XCTAssertEqual(app.activeProject?.id, "docs")
        XCTAssertEqual(defaults.string(forKey: projectContextStorageKey(for: connection)), "project:docs")
    }

    func testLoadProjectContextFallsBackWhenPersistedProjectWasDeleted() async {
        let app = makeApp()
        let connection = connect(app)
        persistProjectContextSelection("project:deleted", for: connection)
        app.threads = [
            thread(
                "alpha-thread",
                familiarIds: ["nova"],
                projectRoot: "/repos/alpha",
                updatedAt: Date(timeIntervalSince1970: 10)
            )
        ]

        await app.loadProjectContext(using: client(
            projects: [
                project("alpha", "Alpha"),
                project("beta", "Beta"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")]
        ))

        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertEqual(defaults.string(forKey: projectContextStorageKey(for: connection)), "project:alpha")
    }

    func testProjectContextSelectionIsScopedPerConnectionAndIgnoresLegacyGlobalKey() async {
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")

        let appA = makeApp()
        let connectionA = connect(appA, host: "https://cave-alpha.example.ts.net")
        appA.projects = [alpha, beta]
        appA.switchProject(to: .project(beta))
        XCTAssertEqual(defaults.string(forKey: projectContextStorageKey(for: connectionA)), "project:beta")

        defaults.set("beta", forKey: AppModel.legacyProjectContextStorageKey)

        let appB = makeApp()
        let connectionB = connect(appB, host: "https://cave-beta.example.ts.net")
        await appB.loadProjectContext(using: client(
            projects: [alpha, beta],
            grants: grants(),
            familiars: []
        ))

        XCTAssertEqual(appB.projectContext, .project(alpha))
        XCTAssertEqual(defaults.string(forKey: projectContextStorageKey(for: connectionB)), "project:alpha")
        XCTAssertNil(defaults.string(forKey: AppModel.legacyProjectContextStorageKey))

        let restoredA = makeApp()
        restoredA.connection = connectionA
        await restoredA.loadProjectContext(using: client(
            projects: [alpha, beta],
            grants: grants(),
            familiars: []
        ))

        XCTAssertEqual(restoredA.projectContext, .project(beta))
    }

    func testLoadProjectContextRestoresRealProjectIDNamedUnassigned() async {
        let app = makeApp()
        let connection = connect(app)
        let actualUnassigned = project("unassigned", "Zulu Project")
        app.projects = [
            project("alpha", "Alpha"),
            actualUnassigned,
        ]
        app.switchProject(to: .project(actualUnassigned))

        await app.loadProjectContext(using: client(
            projects: [
                project("alpha", "Alpha"),
                actualUnassigned,
            ],
            grants: grants(),
            familiars: []
        ))

        XCTAssertEqual(app.projectContext, .project(actualUnassigned))
        XCTAssertEqual(app.activeProject?.id, "unassigned")
        XCTAssertEqual(defaults.string(forKey: projectContextStorageKey(for: connection)), "project:unassigned")
    }

    func testDerivedProjectCollectionsUseMembershipAndUnassignedArtifacts() async {
        let app = makeApp()
        let connection = connect(app)
        persistProjectContextSelection("project:alpha", for: connection)
        app.threads = [
            thread("alpha-thread", familiarIds: ["nova"], projectRoot: "/repos/alpha"),
            thread("alpha-rogue-thread", familiarIds: ["sage"], projectRoot: "/repos/alpha/.worktrees/feat-alpha"),
            thread("ghost-thread", familiarIds: ["lyra"], projectRoot: "/repos/ghost"),
        ]
        app.serverSessions = [
            session("alpha-session", familiarId: "nova", projectRoot: "/repos/alpha"),
            session("ghost-session", familiarId: "moss", projectRoot: "/repos/ghost"),
        ]
        app.tasks = [
            card("alpha-task", familiarId: "nova", projectId: "alpha"),
            card("alpha-rogue-task", familiarId: "sage", projectId: "alpha"),
            card("unassigned-task", familiarId: "ember", projectId: nil),
        ]

        await app.loadProjectContext(using: client(
            projects: [
                project("alpha", "Alpha"),
                project("beta", "Beta"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
                ProjectGrant(familiarId: "sage", projectId: "beta", access: .read),
            ]),
            familiars: [
                familiar("nova", "Nova"),
                familiar("sage", "Sage"),
                familiar("lyra", "Lyra"),
                familiar("moss", "Moss"),
                familiar("ember", "Ember"),
            ]
        ))

        XCTAssertEqual(app.projectThreads.map(\.id), ["alpha-thread", "alpha-rogue-thread"])
        XCTAssertEqual(app.projectServerSessions.map(\.id), ["alpha-session"])
        XCTAssertEqual(app.projectTasks.map(\.id), ["alpha-task", "alpha-rogue-task"])
        XCTAssertEqual(app.projectFamiliars.map(\.id), ["nova"])

        app.switchProject(to: .unassigned)

        XCTAssertEqual(
            defaults.string(forKey: projectContextStorageKey(for: connection)),
            "unassigned"
        )
        XCTAssertEqual(app.projectThreads.map(\.id), ["ghost-thread"])
        XCTAssertEqual(app.projectServerSessions.map(\.id), ["ghost-session"])
        XCTAssertEqual(app.projectTasks.map(\.id), ["unassigned-task"])
        XCTAssertEqual(app.projectFamiliars.map(\.id), ["lyra", "moss", "ember"])
    }

    func testDerivedProjectCollectionsDoNotDuplicateNestedRegisteredProjectOwnership() {
        let parent = project("parent", "Parent", root: "/repos/cave")
        let nested = project("nested", "Nested", root: "/repos/cave/.worktrees/feature")
        let app = makeApp()
        app.projects = [parent, nested]
        app.threads = [
            thread("parent-thread", familiarIds: ["nova"], projectRoot: "/repos/cave"),
            thread("nested-thread", familiarIds: ["nova"], projectRoot: "/repos/cave/.worktrees/feature"),
            thread(
                "nested-worktree-thread",
                familiarIds: ["nova"],
                projectRoot: "/repos/cave/.worktrees/feature/.worktrees/fix"
            ),
        ]
        app.serverSessions = [
            session("parent-session", familiarId: "nova", projectRoot: "/repos/cave"),
            session(
                "nested-session",
                familiarId: "nova",
                projectRoot: "/repos/cave/.worktrees/feature"
            ),
            session(
                "nested-worktree-session",
                familiarId: "nova",
                projectRoot: "/repos/cave/.worktrees/feature/.worktrees/fix/inner"
            ),
        ]

        app.switchProject(to: .project(parent))

        XCTAssertEqual(app.projectThreads.map(\.id), ["parent-thread"])
        XCTAssertEqual(app.projectServerSessions.map(\.id), ["parent-session"])

        app.switchProject(to: .project(nested))

        XCTAssertEqual(app.projectThreads.map(\.id), ["nested-thread", "nested-worktree-thread"])
        XCTAssertEqual(app.projectServerSessions.map(\.id), ["nested-session", "nested-worktree-session"])
    }

    func testFirstLoadProjectContextFailureFailsClosed() async {
        let app = makeApp()
        let connection = connect(app)
        persistProjectContextSelection("project:alpha", for: connection)
        app.threads = [thread("alpha-thread", familiarIds: ["nova"], projectRoot: "/repos/alpha")]

        await app.loadProjectContext(using: failingClient(message: "Project grants unavailable"))

        XCTAssertNil(app.projectContext)
        XCTAssertEqual(app.projectContextError, "Project grants unavailable")
        XCTAssertFalse(app.projectMembershipLoaded)
        XCTAssertFalse(app.projectsLoaded)
        XCTAssertFalse(app.familiarsLoaded)
        XCTAssertTrue(app.projects.isEmpty)
        XCTAssertTrue(app.familiars.isEmpty)
        XCTAssertTrue(app.projectFamiliars.isEmpty)
    }

    func testTransientProjectContextFailureKeepsCachedScopeAndGlobalData() async {
        let app = makeApp()
        let connection = connect(app)
        persistProjectContextSelection("project:alpha", for: connection)

        await app.loadProjectContext(using: client(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")]
        ))

        await app.loadProjectContext(using: StubProjectContextClient(
            projectsResult: .success([
                project("alpha", "Alpha"),
                project("beta", "Beta"),
            ]),
            grantsResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Grant refresh failed"]
            )),
            familiarsResult: .success([
                familiar("nova", "Nova"),
                familiar("sage", "Sage"),
            ])
        ))

        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertEqual(app.projectContextError, "Grant refresh failed")
        XCTAssertTrue(app.projectMembershipLoaded)
        XCTAssertEqual(app.projects.map(\.id), ["alpha"])
        XCTAssertEqual(app.familiars.map(\.id), ["nova"])
        XCTAssertEqual(app.projectMembership.familiarIDs(forProjectID: "alpha"), Set(["nova"]))
    }

    func testLoadFamiliarsUsesInjectedCoreResourceClientAndRefreshesProjectContextWithoutNetwork() async {
        let connection = CaveConnection(host: "http://127.0.0.1:1")
        persistProjectContextSelection("project:alpha", for: connection)
        let controlledClient = ControlledCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        app.connection = connection
        app.projects = [project("stale", "Stale")]
        app.projectsLoaded = true
        app.familiars = [familiar("stale", "Stale")]
        app.familiarsLoaded = true
        app.projectMembershipLoaded = true
        app.projectContext = .project(project("stale", "Stale"))
        app.projectContextError = "stale error"
        app.projectsError = "stale projects error"
        app.familiarsError = "stale familiars error"

        await app.loadFamiliars()

        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertEqual(app.projects.map(\.id), ["alpha"])
        XCTAssertEqual(app.familiars.map(\.id), ["nova"])
        XCTAssertTrue(app.projectMembershipLoaded)
        XCTAssertTrue(app.familiarsLoaded)
        XCTAssertEqual(app.projectMembership.familiarIDs(forProjectID: "alpha"), Set(["nova"]))
        XCTAssertNil(app.projectContextError)
        XCTAssertNil(app.projectsError)
        XCTAssertNil(app.familiarsError)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.projects, 1)
        XCTAssertEqual(calls.grants, 1)
        XCTAssertEqual(calls.familiars, 1)
        XCTAssertEqual(calls.sessions, 0)
        XCTAssertEqual(calls.tasks, 0)
    }

    func testSwitchProjectPreservesSelectedTabAndClearsOneShotIntents() {
        let app = makeApp()
        let connection = connect(app)
        app.projects = [
            project("alpha", "Alpha"),
            project("beta", "Beta"),
        ]
        app.projectsLoaded = true
        app.selectedTab = .tasks
        app.threadToOpen = thread("pending-thread", familiarIds: ["nova"], projectRoot: "/repos/alpha")
        app.cardToOpen = card("pending-card", familiarId: "nova", projectId: "alpha")
        app.newChatRequested = true
        app.chatSearchRequested = true

        app.switchProject(to: .project(project("beta", "Beta")))

        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.projectContext, .project(project("beta", "Beta")))
        XCTAssertEqual(defaults.string(forKey: projectContextStorageKey(for: connection)), "project:beta")
        XCTAssertNil(app.threadToOpen)
        XCTAssertNil(app.cardToOpen)
        XCTAssertFalse(app.newChatRequested)
        XCTAssertFalse(app.chatSearchRequested)
    }

    func testSwitchProjectDoesNotClearPendingProjectNavigationIntent() {
        let app = makeApp()
        app.projects = [
            project("alpha", "Alpha"),
            project("beta", "Beta"),
        ]
        app.projectsLoaded = true
        let expectedIntent = ProjectNavigationIntent(
            entity: .task(id: "beta-task"),
            destination: .tasks,
            projectId: "beta"
        )
        app.pendingProjectNavigationIntent = expectedIntent

        app.switchProject(to: .project(project("beta", "Beta")))

        XCTAssertEqual(app.pendingProjectNavigationIntent, expectedIntent)
    }

    func testRequestOpenSwitchesToThreadProjectBeforeOpening() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let destination = thread("beta-thread", familiarIds: ["nova"], projectRoot: beta.root)
        // `requestOpen` records an id-based `ProjectNavigationIntent` and
        // re-resolves the thread from `threads` — deliberately, so an intent
        // that has to wait for hydration is re-read from current state rather
        // than pinned to a possibly-stale object. A thread the model has never
        // seen is therefore "not available on this device", which is what
        // every production caller avoids by inserting first (see
        // `openServerSession`, `openChat(for:)`). Seed it the same way.
        app.threads = [destination]
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)
        app.selectedTab = .settings

        XCTAssertTrue(app.requestOpen(destination))

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertTrue(app.threadToOpen === destination)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenSwitchesToUnassignedForProjectlessThread() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let destination = thread("legacy-thread", familiarIds: ["nova"], projectRoot: nil)
        app.threads = [destination]
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)

        XCTAssertTrue(app.requestOpen(destination))

        XCTAssertEqual(app.projectContext, .unassigned)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertTrue(app.threadToOpen === destination)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenCanonicalizesNestedWorktreeRootToRegisteredProject() {
        let app = makeApp()
        let parent = project("parent", "Parent", root: "/repos/cave")
        let nested = project("nested", "Nested", root: "/repos/cave/.worktrees/feature")
        let destination = thread(
            "nested-thread",
            familiarIds: ["nova"],
            projectRoot: "/repos/cave/.worktrees/feature/.worktrees/fix"
        )
        app.threads = [destination]
        app.projects = [parent, nested]
        app.projectsLoaded = true
        app.projectContext = .project(parent)

        XCTAssertTrue(app.requestOpen(destination))

        XCTAssertEqual(app.projectContext, .project(nested))
        XCTAssertTrue(app.threadToOpen === destination)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenTreatsUnknownAndDeletedRootsAsUnassigned() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)

        for root in ["/repos/ghost", "/repos/deleted"] {
            app.toast = nil
            app.threadToOpen = nil
            let destination = thread(root, familiarIds: ["nova"], projectRoot: root)
            app.threads = [destination]

            XCTAssertTrue(app.requestOpen(destination))
            XCTAssertEqual(app.projectContext, .unassigned)
            XCTAssertTrue(app.threadToOpen === destination)
            XCTAssertNil(app.toast)

            app.projectContext = .project(alpha)
        }
    }

    func testRequestOpenTaskSwitchesToTaskProjectBeforeOpening() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let destination = card("beta-task", familiarId: "nova", projectId: beta.id)
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.tasks = [destination]
        app.tasksLoaded = true
        app.projectContext = .project(alpha)
        app.selectedTab = .settings

        XCTAssertTrue(app.requestOpenTask(destination))

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.cardToOpen?.id, destination.id)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenTaskSwitchesToUnassignedForProjectlessTask() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let destination = card("legacy-task", familiarId: "nova", projectId: nil)
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [destination]
        app.tasksLoaded = true
        app.projectContext = .project(alpha)

        XCTAssertTrue(app.requestOpenTask(destination))

        XCTAssertEqual(app.projectContext, .unassigned)
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.cardToOpen?.id, destination.id)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenProjectSearchResultKeepsProjectScopedDestination() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)
        app.selectedTab = .tasks

        XCTAssertTrue(app.requestOpenProjectSearchResult(beta))

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenProjectSearchResultFallsBackToChatsFromSettings() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)
        app.selectedTab = .settings

        XCTAssertTrue(app.requestOpenProjectSearchResult(beta))

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenServerSessionSwitchesToSessionProjectBeforeOpening() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let destination = session("beta-session", familiarId: "nova", projectRoot: beta.root)
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)
        app.selectedTab = .tasks

        XCTAssertTrue(app.requestOpenServerSession(destination, fallbackFamiliarId: "nova"))

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertEqual(app.threadToOpen?.sessionIds, ["nova": destination.id])
        XCTAssertEqual(app.threadToOpen?.projectRoot, beta.root)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenTaskTreatsUnknownProjectAsUnassignedRecovery() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let destination = card("ghost-task", familiarId: "nova", projectId: "ghost")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [destination]
        app.tasksLoaded = true
        app.projectContext = .project(alpha)
        app.selectedTab = .settings

        XCTAssertTrue(app.requestOpenTask(destination))

        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.projectContext, .unassigned)
        XCTAssertEqual(app.cardToOpen?.id, destination.id)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenTaskFailsExplicitlyWhenProjectIDIsMalformed() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let destination = card("invalid-task", familiarId: "nova", projectId: " ghost ")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [destination]
        app.tasksLoaded = true
        app.projectContext = .project(alpha)
        app.selectedTab = .settings

        XCTAssertFalse(app.requestOpenTask(destination))

        XCTAssertEqual(app.selectedTab, .settings)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertNil(app.cardToOpen)
        XCTAssertEqual(app.pendingProjectNavigationIntent?.taskId, destination.id)
        assertToast(
            app,
            text: "This task is no longer linked to a registered project. Refresh Tasks or reassign it on your desktop, then try again.",
            systemImage: "folder.badge.questionmark"
        )
    }

    @MainActor
    func testMoveTaskToProjectSwitchesToDestinationTaskContextOnSuccess() async {
        let alpha = project("alpha", "Alpha")
        let task = card("recover-task", familiarId: "nova", projectId: nil)
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            tasks: [task]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true
        app.projectContext = .unassigned
        app.selectedTab = .tasks

        await app.moveTaskToProject(task, project: alpha)

        XCTAssertEqual(app.tasks.first?.projectId, alpha.id)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.cardToOpen?.id, task.id)
        XCTAssertEqual(app.projectTasks.map(\.id), [task.id])
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.tasksError)
        assertToast(app, text: "Moved to Alpha", systemImage: "folder.badge.plus")
        let updates = await controlledClient.callLog.taskProjectUpdateSnapshot()
        XCTAssertEqual(updates.count, 1)
        XCTAssertEqual(updates.first?.cardId, task.id)
        XCTAssertEqual(updates.first?.projectId, alpha.id)
    }

    @MainActor
    func testMoveTaskToProjectRevertsOnGenericFailure() async {
        let alpha = project("alpha", "Alpha")
        let task = card("recover-task", familiarId: "nova", projectId: nil)
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            tasks: [task],
            taskProjectUpdateError: NSError(
                domain: "AppModelProjectContextTests",
                code: 91,
                userInfo: [NSLocalizedDescriptionKey: "Network dropped"]
            )
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true
        app.projectContext = .unassigned
        app.selectedTab = .tasks

        await app.moveTaskToProject(task, project: alpha)

        XCTAssertNil(app.tasks.first?.projectId)
        XCTAssertEqual(app.projectTasks.map(\.id), [task.id])
        XCTAssertEqual(app.projectContext, .unassigned)
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertNil(app.cardToOpen)
        XCTAssertEqual(app.tasksError, "Network dropped")
        assertToast(
            app,
            text: "Couldn’t move the task — reverted. Network dropped",
            systemImage: "exclamationmark.triangle.fill"
        )
    }

    @MainActor
    func testMoveTaskToProjectSurfacesDeletedProjectServerErrorAndReverts() async {
        let alpha = project("alpha", "Alpha")
        let task = card("recover-task", familiarId: "nova", projectId: nil)
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            tasks: [task],
            taskProjectUpdateError: CaveError.serverResponse(
                status: 409,
                code: "assigned_project_not_found",
                message: "This project no longer exists."
            )
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true
        app.projectContext = .unassigned
        app.selectedTab = .tasks

        await app.moveTaskToProject(task, project: alpha)

        XCTAssertNil(app.tasks.first?.projectId)
        XCTAssertEqual(app.projectTasks.map(\.id), [task.id])
        XCTAssertEqual(app.projectContext, .unassigned)
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertNil(app.cardToOpen)
        XCTAssertEqual(app.tasksError, "This project no longer exists.")
        assertToast(
            app,
            text: "Couldn’t move the task — reverted. This project no longer exists.",
            systemImage: "exclamationmark.triangle.fill"
        )
    }

    @MainActor
    func testMoveTaskToProjectClearsProjectlessLocalChatLink() async throws {
        let alpha = project("alpha", "Alpha")
        let task = card("recover-task", familiarId: "nova", projectId: nil)
        let legacyThread = thread("legacy-thread", familiarIds: ["nova"], projectRoot: nil)
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            tasks: [task]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        await app.loadProjectContext(using: controlledClient)
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.tasks = [task]
        app.tasksLoaded = true
        app.threads = [legacyThread]
        app.cardThreadLinks[task.id] = legacyThread.id
        app.switchProject(to: .unassigned)
        app.selectedTab = .tasks

        await app.moveTaskToProject(task, project: alpha)

        let moved = try XCTUnwrap(app.tasks.first)
        XCTAssertEqual(moved.projectId, alpha.id)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.cardToOpen?.id, task.id)
        XCTAssertNil(app.cardThreadLinks[task.id])
        XCTAssertNil(app.linkedThread(for: moved))
        XCTAssertNil(legacyThread.projectRoot)
        XCTAssertNil(app.tasksError)

        let opened = await app.openChat(for: moved)
        let unwrapped = try XCTUnwrap(opened)
        XCTAssertFalse(unwrapped === legacyThread)
        XCTAssertEqual(unwrapped.projectRoot, alpha.root)
        XCTAssertEqual(app.cardThreadLinks[task.id], unwrapped.id)
        XCTAssertTrue(app.linkedThread(for: moved) === unwrapped)
    }

    @MainActor
    func testMoveTaskToProjectPreservesCompatibleLocalChatLink() async throws {
        let alpha = project("alpha", "Alpha")
        let task = card("recover-task", familiarId: "nova", projectId: nil)
        let linked = thread("alpha-thread", familiarIds: ["nova"], projectRoot: nil)
        linked.sessionIds["nova"] = "alpha-session"
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("alpha-session", familiarId: "nova", projectRoot: alpha.root)],
            tasks: [task]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        await app.loadProjectContext(using: controlledClient)
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.tasks = [task]
        app.tasksLoaded = true
        app.threads = [linked]
        app.cardThreadLinks[task.id] = linked.id
        app.switchProject(to: .unassigned)
        app.selectedTab = .tasks

        await app.moveTaskToProject(task, project: alpha)

        let moved = try XCTUnwrap(app.tasks.first)
        XCTAssertEqual(moved.projectId, alpha.id)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.cardToOpen?.id, task.id)
        XCTAssertEqual(app.cardThreadLinks[task.id], linked.id)
        XCTAssertTrue(app.linkedThread(for: moved) === linked)
        XCTAssertEqual(linked.projectRoot, alpha.root)
        XCTAssertEqual(linked.sessionIds["nova"], "alpha-session")
        XCTAssertNil(app.tasksError)

        let opened = await app.openChat(for: moved)
        XCTAssertTrue(try XCTUnwrap(opened) === linked)
    }

    @MainActor
    func testMoveTaskToProjectUnlinksMismatchedServerBackedChat() async throws {
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let task = card("recover-task", familiarId: "nova", projectId: nil, sessionId: "beta-session")
        let legacyThread = thread("beta-thread", familiarIds: ["nova"], projectRoot: beta.root)
        legacyThread.sessionIds["nova"] = "beta-session"
        let controlledClient = ControlledCoreClient(
            projects: [alpha, beta],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("beta-session", familiarId: "nova", projectRoot: beta.root)],
            tasks: [task]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        await app.loadProjectContext(using: controlledClient)
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: [
                "alpha": Set(["nova"]),
                "beta": Set(["nova"]),
            ]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.tasks = [task]
        app.tasksLoaded = true
        app.threads = [legacyThread]
        app.cardThreadLinks[task.id] = legacyThread.id
        app.switchProject(to: .unassigned)
        app.selectedTab = .tasks

        await app.moveTaskToProject(task, project: alpha)

        let moved = try XCTUnwrap(app.tasks.first)
        XCTAssertEqual(moved.projectId, alpha.id)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.cardToOpen?.id, task.id)
        XCTAssertNil(moved.sessionId)
        XCTAssertNil(app.cardThreadLinks[task.id])
        XCTAssertNil(app.linkedThread(for: moved))
        XCTAssertEqual(legacyThread.projectRoot, beta.root)
        XCTAssertEqual(legacyThread.sessionIds["nova"], "beta-session")
        XCTAssertNil(app.tasksError)
        let sessionUpdates = await controlledClient.callLog.taskSessionUpdateSnapshot()
        XCTAssertEqual(sessionUpdates.count, 1)
        XCTAssertEqual(sessionUpdates.first?.cardId, task.id)
        XCTAssertNil(sessionUpdates.first?.sessionId)

        let opened = await app.openChat(for: moved)
        let unwrapped = try XCTUnwrap(opened)
        XCTAssertFalse(unwrapped === legacyThread)
        XCTAssertEqual(unwrapped.projectRoot, alpha.root)
        XCTAssertEqual(app.cardThreadLinks[task.id], unwrapped.id)
        XCTAssertTrue(app.linkedThread(for: moved) === unwrapped)
    }

    @MainActor
    func testMoveTaskToProjectKeepsLinkStateWhenServerUnlinkFails() async throws {
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let task = card("recover-task", familiarId: "nova", projectId: nil, sessionId: "beta-session")
        let legacyThread = thread("beta-thread", familiarIds: ["nova"], projectRoot: beta.root)
        legacyThread.sessionIds["nova"] = "beta-session"
        let controlledClient = ControlledCoreClient(
            projects: [alpha, beta],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("beta-session", familiarId: "nova", projectRoot: beta.root)],
            tasks: [task],
            taskSessionUpdateError: NSError(
                domain: "AppModelProjectContextTests",
                code: 93,
                userInfo: [NSLocalizedDescriptionKey: "Session patch failed"]
            )
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        await app.loadProjectContext(using: controlledClient)
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: [
                "alpha": Set(["nova"]),
                "beta": Set(["nova"]),
            ]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.tasks = [task]
        app.tasksLoaded = true
        app.threads = [legacyThread]
        app.cardThreadLinks[task.id] = legacyThread.id
        app.switchProject(to: .unassigned)
        app.selectedTab = .tasks

        await app.moveTaskToProject(task, project: alpha)

        let moved = try XCTUnwrap(app.tasks.first)
        XCTAssertEqual(moved.projectId, alpha.id)
        XCTAssertEqual(moved.sessionId, "beta-session")
        XCTAssertEqual(app.projectContext, .unassigned)
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertTrue(app.projectTasks.isEmpty)
        XCTAssertNil(app.cardToOpen)
        XCTAssertEqual(app.cardThreadLinks[task.id], legacyThread.id)
        XCTAssertNil(app.linkedThread(for: moved))
        XCTAssertEqual(
            app.tasksError,
            "Couldn’t unlink the previous chat link, so it was kept."
        )
        assertToast(
            app,
            text: "Moved to Alpha. Couldn’t unlink the previous chat link, so it was kept.",
            systemImage: "exclamationmark.triangle.fill"
        )
        let sessionUpdates = await controlledClient.callLog.taskSessionUpdateSnapshot()
        XCTAssertEqual(sessionUpdates.count, 1)
        XCTAssertEqual(sessionUpdates.first?.cardId, task.id)
        XCTAssertNil(sessionUpdates.first?.sessionId)
    }

    @MainActor
    func testMoveTaskToProjectAllowsImmediateChatOpenAfterSwitchingContext() async throws {
        let alpha = project("alpha", "Alpha")
        let task = card("recover-task", familiarId: "nova", projectId: nil)
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            tasks: [task]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        await app.loadProjectContext(using: controlledClient)
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.tasks = [task]
        app.tasksLoaded = true
        app.switchProject(to: .unassigned)
        app.selectedTab = .tasks

        await app.moveTaskToProject(task, project: alpha)

        let moved = try XCTUnwrap(app.tasks.first)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.cardToOpen?.id, task.id)

        let opened = await app.openChat(for: moved)
        let unwrapped = try XCTUnwrap(opened)
        XCTAssertEqual(unwrapped.projectRoot, alpha.root)
        XCTAssertEqual(app.cardThreadLinks[task.id], unwrapped.id)
        XCTAssertTrue(app.threadToOpen === unwrapped)
        XCTAssertEqual(app.selectedTab, .chats)
    }

    @MainActor
    func testMoveTaskToProjectSuccessKeepsNewerStatusAndSteps() async throws {
        let alpha = project("alpha", "Alpha")
        var task = card("recover-task", familiarId: "nova", projectId: nil)
        task.steps = [CardStep(id: "step-1", text: "Check", done: false, doneAt: nil)]
        let projectUpdateStarted = Gate()
        let projectUpdateRelease = Gate()
        var movedResponse = task
        movedResponse.projectId = alpha.id
        let interleavingClient = InterleavingTaskMutationClient(
            baseCard: task,
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            projectUpdateResult: .success(movedResponse),
            projectUpdateStarted: projectUpdateStarted,
            projectUpdateRelease: projectUpdateRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in interleavingClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true
        app.projectContext = .unassigned

        let move = Task { await app.moveTaskToProject(task, project: alpha) }
        await projectUpdateStarted.wait()

        let afterOptimisticMove = try XCTUnwrap(app.tasks.first)
        await app.setTaskStatus(afterOptimisticMove, .running)
        let afterStatus = try XCTUnwrap(app.tasks.first)
        await app.toggleStep(afterStatus, stepId: "step-1")

        await projectUpdateRelease.open()
        await move.value

        let final = try XCTUnwrap(app.tasks.first)
        XCTAssertEqual(final.projectId, alpha.id)
        XCTAssertEqual(final.status, .running)
        XCTAssertEqual(final.steps?.first?.done, true)
        XCTAssertNil(app.tasksError)
        assertToast(app, text: "Moved to Alpha", systemImage: "folder.badge.plus")
    }

    @MainActor
    func testMoveTaskToProjectFailureRevertsOnlyProjectIdWhenNewerStatusAndStepsLand() async throws {
        let alpha = project("alpha", "Alpha")
        var task = card("recover-task", familiarId: "nova", projectId: nil)
        task.steps = [CardStep(id: "step-1", text: "Check", done: false, doneAt: nil)]
        let projectUpdateStarted = Gate()
        let projectUpdateRelease = Gate()
        let interleavingClient = InterleavingTaskMutationClient(
            baseCard: task,
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            projectUpdateResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 92,
                userInfo: [NSLocalizedDescriptionKey: "Network dropped"]
            )),
            projectUpdateStarted: projectUpdateStarted,
            projectUpdateRelease: projectUpdateRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in interleavingClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true
        app.projectContext = .unassigned

        let move = Task { await app.moveTaskToProject(task, project: alpha) }
        await projectUpdateStarted.wait()

        let afterOptimisticMove = try XCTUnwrap(app.tasks.first)
        await app.setTaskStatus(afterOptimisticMove, .running)
        let afterStatus = try XCTUnwrap(app.tasks.first)
        await app.toggleStep(afterStatus, stepId: "step-1")

        await projectUpdateRelease.open()
        await move.value

        let final = try XCTUnwrap(app.tasks.first)
        XCTAssertNil(final.projectId)
        XCTAssertEqual(final.status, .running)
        XCTAssertEqual(final.steps?.first?.done, true)
        XCTAssertEqual(app.projectTasks.map(\.id), [task.id])
        XCTAssertEqual(app.tasksError, "Network dropped")
        assertToast(
            app,
            text: "Couldn’t move the task — reverted. Network dropped",
            systemImage: "exclamationmark.triangle.fill"
        )
    }

    @MainActor
    func testStepDoubleToggleKeepsTheLatestOptimisticState() async throws {
        let alpha = project("alpha", "Alpha")
        var task = card("checklist-task", familiarId: "nova", projectId: alpha.id)
        task.steps = [CardStep(id: "step-1", text: "Check", done: false, doneAt: nil)]
        let firstStarted = Gate()
        let firstRelease = Gate()
        let secondStarted = Gate()
        let client = SequencedTaskMutationClient(
            baseCard: task,
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            controls: [
                .steps: [
                    .init(started: firstStarted, release: firstRelease),
                    .init(started: secondStarted),
                ],
            ]
        )
        let app = makeApp(coreResourceClientFactory: { _ in client })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true

        let first = app.requestToggleTaskStep(task, stepId: "step-1")
        XCTAssertEqual(app.tasks.first?.steps?.first?.done, true)
        await firstStarted.wait()

        let afterFirst = try XCTUnwrap(app.tasks.first)
        let second = app.requestToggleTaskStep(afterFirst, stepId: "step-1")
        XCTAssertEqual(app.tasks.first?.steps?.first?.done, false)
        let firstStepCalls = await client.callsSnapshot().map(\.detail)
        XCTAssertEqual(firstStepCalls, ["1"])

        await firstRelease.open()
        await secondStarted.wait()
        let secondStepCalls = await client.callsSnapshot().map(\.detail)
        XCTAssertEqual(secondStepCalls, ["1", "0"])
        XCTAssertEqual(app.tasks.first?.steps?.first?.done, false)

        if let first { await first.value }
        if let second { await second.value }

        XCTAssertEqual(app.tasks.first?.steps?.first?.done, false)
        XCTAssertNil(app.tasksError)
    }

    @MainActor
    func testPriorityDoubleChangeKeepsTheLatestOptimisticState() async throws {
        let alpha = project("alpha", "Alpha")
        let task = card("priority-task", familiarId: "nova", projectId: alpha.id)
        let firstStarted = Gate()
        let firstRelease = Gate()
        let secondStarted = Gate()
        let client = SequencedTaskMutationClient(
            baseCard: task,
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            controls: [
                .priority: [
                    .init(started: firstStarted, release: firstRelease),
                    .init(started: secondStarted),
                ],
            ]
        )
        let app = makeApp(coreResourceClientFactory: { _ in client })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true

        let first = app.requestTaskPriority(task, .high)
        XCTAssertEqual(app.tasks.first?.priority, .high)
        await firstStarted.wait()

        let afterFirst = try XCTUnwrap(app.tasks.first)
        let second = app.requestTaskPriority(afterFirst, .urgent)
        XCTAssertEqual(app.tasks.first?.priority, .urgent)
        let firstPriorityCalls = await client.callsSnapshot().map(\.detail)
        XCTAssertEqual(firstPriorityCalls, ["high"])

        await firstRelease.open()
        await secondStarted.wait()
        let secondPriorityCalls = await client.callsSnapshot().map(\.detail)
        XCTAssertEqual(secondPriorityCalls, ["high", "urgent"])
        XCTAssertEqual(app.tasks.first?.priority, .urgent)

        if let first { await first.value }
        if let second { await second.value }

        XCTAssertEqual(app.tasks.first?.priority, .urgent)
        XCTAssertNil(app.tasksError)
    }

    @MainActor
    func testProjectDoubleMoveKeepsTheLatestOptimisticState() async throws {
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let task = card("recover-task", familiarId: "nova", projectId: nil)
        let firstStarted = Gate()
        let firstRelease = Gate()
        let secondStarted = Gate()
        let client = SequencedTaskMutationClient(
            baseCard: task,
            projects: [alpha, beta],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            controls: [
                .project: [
                    .init(started: firstStarted, release: firstRelease),
                    .init(started: secondStarted),
                ],
            ]
        )
        let app = makeApp(coreResourceClientFactory: { _ in client })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true
        app.projectContext = .unassigned

        let first = app.requestTaskProjectMove(task, project: alpha)
        XCTAssertEqual(app.tasks.first?.projectId, alpha.id)
        await firstStarted.wait()

        let afterFirst = try XCTUnwrap(app.tasks.first)
        let second = app.requestTaskProjectMove(afterFirst, project: beta)
        XCTAssertEqual(app.tasks.first?.projectId, beta.id)
        let firstProjectCalls = await client.callsSnapshot().map(\.detail)
        XCTAssertEqual(firstProjectCalls, [alpha.id])

        await firstRelease.open()
        await secondStarted.wait()
        let secondProjectCalls = await client.callsSnapshot().map(\.detail)
        XCTAssertEqual(secondProjectCalls, [alpha.id, beta.id])
        XCTAssertEqual(app.tasks.first?.projectId, beta.id)

        if let first { await first.value }
        if let second { await second.value }

        XCTAssertEqual(app.tasks.first?.projectId, beta.id)
        XCTAssertNil(app.tasksError)
        assertToast(app, text: "Moved to Beta", systemImage: "folder.badge.plus")
    }

    @MainActor
    func testSessionUnlinkRelinkKeepsTheLatestOptimisticState() async throws {
        let alpha = project("alpha", "Alpha")
        let task = card("linked-task", familiarId: "nova", projectId: alpha.id, sessionId: "session-old")
        let oldThread = thread("old-thread", familiarIds: ["nova"], projectRoot: alpha.root)
        oldThread.sessionIds["nova"] = "session-old"
        let newThread = thread("new-thread", familiarIds: ["nova"], projectRoot: alpha.root)
        newThread.sessionIds["nova"] = "session-new"
        let firstStarted = Gate()
        let firstRelease = Gate()
        let secondStarted = Gate()
        let client = SequencedTaskMutationClient(
            baseCard: task,
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            controls: [
                .session: [
                    .init(started: firstStarted, release: firstRelease),
                    .init(started: secondStarted),
                ],
            ]
        )
        let app = makeApp(coreResourceClientFactory: { _ in client })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true
        app.projectContext = .project(alpha)
        app.threads = [oldThread, newThread]
        app.cardThreadLinks[task.id] = oldThread.id

        let unlink = app.unlinkTask(task)
        XCTAssertNil(app.tasks.first?.sessionId)
        XCTAssertNil(app.cardThreadLinks[task.id])
        await firstStarted.wait()

        let afterUnlink = try XCTUnwrap(app.tasks.first)
        let relink = app.linkTask(afterUnlink, to: newThread)
        XCTAssertEqual(app.tasks.first?.sessionId, "session-new")
        XCTAssertEqual(app.cardThreadLinks[task.id], newThread.id)
        let firstSessionCalls = await client.callsSnapshot().map(\.detail)
        XCTAssertEqual(firstSessionCalls, ["<nil>"])

        await firstRelease.open()
        await secondStarted.wait()
        let secondSessionCalls = await client.callsSnapshot().map(\.detail)
        XCTAssertEqual(secondSessionCalls, ["<nil>", "session-new"])
        XCTAssertEqual(app.tasks.first?.sessionId, "session-new")

        if let unlink { await unlink.value }
        if let relink { await relink.value }

        let final = try XCTUnwrap(app.tasks.first)
        XCTAssertEqual(final.sessionId, "session-new")
        XCTAssertTrue(app.linkedThread(for: final) === newThread)
    }

    @MainActor
    func testDifferentFieldEditsCanRunConcurrently() async throws {
        let alpha = project("alpha", "Alpha")
        let task = card("mixed-task", familiarId: "nova", projectId: alpha.id)
        let priorityStarted = Gate()
        let priorityRelease = Gate()
        let statusStarted = Gate()
        let client = SequencedTaskMutationClient(
            baseCard: task,
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            controls: [
                .priority: [.init(started: priorityStarted, release: priorityRelease)],
                .status: [.init(started: statusStarted)],
            ]
        )
        let app = makeApp(coreResourceClientFactory: { _ in client })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true

        let priority = app.requestTaskPriority(task, .high)
        await priorityStarted.wait()

        let afterPriority = try XCTUnwrap(app.tasks.first)
        let status = app.requestTaskStatus(afterPriority, .running)
        await statusStarted.wait()

        let during = try XCTUnwrap(app.tasks.first)
        XCTAssertEqual(during.priority, .high)
        XCTAssertEqual(during.status, .running)
        let mixedCalls = await client.callsSnapshot().map(\.operation)
        XCTAssertEqual(mixedCalls, [.priority, .status])

        await priorityRelease.open()
        if let priority { await priority.value }
        if let status { await status.value }

        let final = try XCTUnwrap(app.tasks.first)
        XCTAssertEqual(final.priority, .high)
        XCTAssertEqual(final.status, .running)
        XCTAssertNil(app.tasksError)
    }

    func testValidatedOpenContextTreatsUnknownRootsAsOpenableUnassignedThreads() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let destination = thread("ghost-thread", familiarIds: ["nova"], projectRoot: "/repos/ghost")
        app.projects = [alpha]
        app.projectsLoaded = true

        XCTAssertEqual(app.validatedOpenContext(for: destination), .unassigned)
        XCTAssertTrue(app.canOpen(destination))
        XCTAssertNil(app.threadOpenFailure(for: destination))
    }

    func testValidatedOpenContextRequiresProjectCatalogForRootedThreads() {
        let app = makeApp()
        let destination = thread("alpha-thread", familiarIds: ["nova"], projectRoot: "/repos/alpha")

        XCTAssertNil(app.validatedOpenContext(for: destination))
        XCTAssertFalse(app.canOpen(destination))
        XCTAssertEqual(
            app.threadOpenFailure(for: destination),
            AppModel.ThreadOpenFailure.projectCatalogUnavailable
        )
    }

    func testValidatedOpenContextRejectsMalformedDotSegmentRoots() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let destination = thread(
            "invalid-thread",
            familiarIds: ["nova"],
            projectRoot: "/repos/alpha/.worktrees/feat-alpha/../../escape"
        )
        app.projects = [alpha]
        app.projectsLoaded = true

        XCTAssertNil(app.validatedOpenContext(for: destination))
        XCTAssertFalse(app.canOpen(destination))
        XCTAssertEqual(
            app.threadOpenFailure(for: destination),
            AppModel.ThreadOpenFailure.invalidProjectMetadata
        )
    }

    func testRequestOpenFailsExplicitlyWhenProjectMetadataIsInvalid() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let destination = thread(
            "invalid-thread",
            familiarIds: ["nova"],
            projectRoot: "/repos/alpha/.worktrees/feat-alpha/../../escape"
        )
        // Registered, so the refusal under test is the one about unresolvable
        // project metadata and not the generic "this chat isn't on this
        // device" the lookup would otherwise produce first.
        app.threads = [destination]
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)

        XCTAssertFalse(app.requestOpen(destination))

        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertNil(app.threadToOpen)
        assertToast(
            app,
            text: "This chat’s project metadata could not be resolved. Refresh Chats or reopen it on your desktop, then try again.",
            systemImage: "folder.badge.questionmark"
        )
    }

    func testRequestOpenDoesNotSwitchProjectWhenContextAlreadyMatches() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let destination = thread("alpha-thread", familiarIds: ["nova"], projectRoot: alpha.root)
        let pendingCard = card("pending-card", familiarId: "nova", projectId: alpha.id)
        app.threads = [destination]
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)
        app.selectedTab = .tasks
        app.cardToOpen = pendingCard

        XCTAssertTrue(app.requestOpen(destination))

        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertEqual(app.cardToOpen?.id, pendingCard.id)
        XCTAssertTrue(app.threadToOpen === destination)
        XCTAssertNil(app.toast)
    }

    func testEntityMetadataWinsWhenAdvisoryProjectDisagrees() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let destination = card("beta-task", familiarId: "nova", projectId: beta.id)
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.tasks = [destination]
        app.tasksLoaded = true
        app.projectContext = .project(alpha)
        app.pendingProjectNavigationIntent = ProjectNavigationIntent(
            entity: .task(id: destination.id),
            destination: .tasks,
            projectId: alpha.id
        )

        XCTAssertTrue(app.resolvePendingProjectNavigationIntent())

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.cardToOpen?.id, destination.id)
        XCTAssertNil(app.pendingProjectNavigationIntent)
    }

    func testProjectDeepLinkFailsExplicitlyWhenProjectIsUnknown() throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.selectedTab = .settings
        let url = try XCTUnwrap(URL(string: "covencave://project/ghost/tasks"))

        app.handleDeepLink(url)

        XCTAssertEqual(app.selectedTab, .settings)
        XCTAssertEqual(app.deepLink, .tasks)
        XCTAssertEqual(
            app.pendingProjectNavigationIntent,
            ProjectNavigationIntent(destination: .tasks, projectId: "ghost")
        )
        XCTAssertNil(app.cardToOpen)
        assertToast(
            app,
            text: "This project is no longer registered on this device. Refresh Chats or choose another project, then try again.",
            systemImage: "folder.badge.questionmark"
        )
    }

    func testProjectChatsDeepLinkSwitchesProjectAndPreservesDestination() throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)
        app.selectedTab = .settings
        let url = try XCTUnwrap(URL(string: "covencave://project/beta/chats"))

        app.handleDeepLink(url)

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.toast)
    }

    func testPendingTaskNavigationSurvivesFailedHydration() {
        let app = makeApp()
        let expectedIntent = ProjectNavigationIntent(
            entity: .task(id: "missing-task"),
            destination: .tasks
        )
        app.pendingProjectNavigationIntent = expectedIntent
        app.tasksLoaded = true

        XCTAssertFalse(app.resolvePendingProjectNavigationIntent())

        XCTAssertEqual(app.pendingProjectNavigationIntent, expectedIntent)
        XCTAssertNil(app.cardToOpen)
        assertToast(
            app,
            text: "This task is not available on this device yet. Refresh Tasks and try again.",
            systemImage: "checklist"
        )
    }

    func testRequestOpenGlobalFamiliarLandingThreadPrefersMostRecentLocalLandingAcrossContexts() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let alphaPinned = thread(
            "alpha-pinned",
            familiarIds: ["nova"],
            projectRoot: alpha.root,
            updatedAt: Date(timeIntervalSince1970: 10)
        )
        alphaPinned.pinned = true
        let alphaRecent = thread(
            "alpha-recent",
            familiarIds: ["nova"],
            projectRoot: alpha.root,
            updatedAt: Date(timeIntervalSince1970: 30)
        )
        let betaLanding = thread(
            "beta-landing",
            familiarIds: ["nova"],
            projectRoot: beta.root,
            updatedAt: Date(timeIntervalSince1970: 20)
        )
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)
        app.threads = [alphaPinned, alphaRecent, betaLanding]

        XCTAssertTrue(app.requestOpenGlobalFamiliarLandingThread(for: "nova"))

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertTrue(app.threadToOpen === betaLanding)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenGlobalFamiliarLandingThreadMaterializesMostRecentServerOnlySessionAcrossContexts() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)
        app.serverSessions = [
            session(
                "alpha-server",
                familiarId: "nova",
                projectRoot: alpha.root,
                updatedAt: PermissionModels.isoFormatter.string(
                    from: Date(timeIntervalSince1970: 10)
                )
            ),
            session(
                "beta-server",
                familiarId: "nova",
                projectRoot: beta.root,
                updatedAt: PermissionModels.isoFormatter.string(
                    from: Date(timeIntervalSince1970: 20)
                )
            ),
        ]

        XCTAssertTrue(app.requestOpenGlobalFamiliarLandingThread(for: "nova"))

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.threadToOpen?.sessionIds, ["nova": "beta-server"])
        XCTAssertEqual(app.threadToOpen?.projectRoot, beta.root)
        XCTAssertNil(app.toast)
    }

    func testRequestOpenGlobalFamiliarLandingThreadCreatesFreshChatInActiveProjectWhenNoHistoryExists() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.projectContext = .project(alpha)

        XCTAssertTrue(app.requestOpenGlobalFamiliarLandingThread(for: "nova"))

        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.threadToOpen?.projectRoot, alpha.root)
        XCTAssertEqual(app.threadToOpen?.familiarIds, ["nova"])
        XCTAssertNil(app.toast)
    }

    func testRequestOpenGlobalFamiliarLandingThreadShowsGuidanceWhenFamiliarBelongsToDifferentProject() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["beta": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.projectContext = .project(alpha)

        XCTAssertFalse(app.requestOpenGlobalFamiliarLandingThread(for: "nova"))

        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertNil(app.threadToOpen)
        assertToast(
            app,
            text: "Nova has no chats in Alpha. Switch to Beta in Chats to start one.",
            systemImage: "folder.badge.questionmark"
        )
    }

    func testSwitchProjectRepublishesWidgetSnapshotWithNewContextIdentity() throws {
        let app = makeApp(widgetSnapshotDefaults: defaults)
        app.projects = [
            project("alpha", "Alpha"),
            project("beta", "Beta"),
        ]
        app.tasks = [BoardCard(
            id: "running-task",
            title: "Running",
            notes: nil,
            statusRaw: CardStatus.running.rawValue,
            priorityRaw: "medium",
            familiarId: nil,
            projectId: "alpha",
            sessionId: nil,
            labels: nil,
            startDate: nil,
            endDate: nil,
            createdAt: nil,
            updatedAt: nil,
            needsHuman: nil,
            steps: nil,
            github: nil
        )]

        app.switchProject(to: .project(project("alpha", "Alpha")))
        let first = try XCTUnwrap(WidgetSnapshotStore.read(defaults: defaults))

        app.switchProject(to: .project(project("beta", "Beta")))
        let second = try XCTUnwrap(WidgetSnapshotStore.read(defaults: defaults))

        XCTAssertEqual(first.projectContextID, "project:alpha")
        XCTAssertEqual(second.projectContextID, "project:beta")
        XCTAssertEqual(second.runningTaskCount, 1)
    }

    @MainActor
    func testProjectSwitcherStateIncludesRecoverableUnassignedContext() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.projectContext = .project(alpha)
        app.familiars = [
            familiar("nova", "Nova"),
            familiar("lyra", "Lyra"),
        ]
        app.threads = [
            thread("alpha-thread", familiarIds: ["nova"], projectRoot: "/repos/alpha"),
            thread("ghost-thread", familiarIds: ["lyra"], projectRoot: "/repos/ghost"),
        ]
        app.tasks = [
            card("alpha-task", familiarId: "nova", projectId: "alpha"),
            card("ghost-task", familiarId: "lyra", projectId: nil),
        ]

        guard case .loaded(let rows, let cachedError) = app.projectSwitcherState else {
            return XCTFail("Expected loaded project switcher state")
        }

        XCTAssertNil(cachedError)
        XCTAssertEqual(rows.map(\.context.id), ["project:alpha", "unassigned"])
        XCTAssertEqual(rows[0].counts, ProjectContextCounts(chatCount: 1, familiarCount: 1, taskCount: 1))
        XCTAssertEqual(rows[1].counts, ProjectContextCounts(chatCount: 1, familiarCount: 1, taskCount: 1))
        XCTAssertEqual(
            rows[1].recoveryText,
            "Projectless or unregistered work needs recovery. Add or repair a project folder on your desktop."
        )
    }

    @MainActor
    func testDeletedProjectTasksExposeUnassignedRecoveryContext() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembershipLoaded = true
        app.projectContext = .project(alpha)
        app.tasks = [card("deleted-task", familiarId: "nova", projectId: "deleted-project")]
        app.tasksLoaded = true

        guard case .loaded(let rows, _) = app.projectSwitcherState else {
            return XCTFail("Expected loaded project switcher state")
        }

        XCTAssertEqual(rows.map(\.context.id), ["project:alpha", "unassigned"])
        XCTAssertEqual(rows[1].counts.taskCount, 1)

        app.switchProject(to: .unassigned)

        XCTAssertEqual(app.projectTasks.map(\.id), ["deleted-task"])
    }

    @MainActor
    func testSwitchProjectChangesVisibleChatTaskAndRecentSources() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let nova = familiar("nova", "Nova")
        let shared = familiar("shared", "Shared")
        let lyra = familiar("lyra", "Lyra")

        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.familiars = [nova, shared, lyra]
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: [
                "alpha": Set(["nova", "shared"]),
                "beta": Set(["shared", "lyra"]),
            ]
        )
        app.projectMembershipLoaded = true

        let alphaPinned = thread(
            "alpha-pinned",
            familiarIds: ["shared"],
            projectRoot: alpha.root,
            updatedAt: Date(timeIntervalSince1970: 20)
        )
        alphaPinned.pinned = true
        let alphaRecent = thread(
            "alpha-recent",
            familiarIds: ["nova"],
            projectRoot: alpha.root,
            updatedAt: Date(timeIntervalSince1970: 40)
        )
        let betaShared = thread(
            "beta-shared",
            familiarIds: ["shared"],
            projectRoot: beta.root,
            updatedAt: Date(timeIntervalSince1970: 30)
        )
        let betaRecent = thread(
            "beta-recent",
            familiarIds: ["lyra"],
            projectRoot: beta.root,
            updatedAt: Date(timeIntervalSince1970: 50)
        )

        app.threads = [alphaPinned, alphaRecent, betaShared, betaRecent]
        app.serverSessions = [
            session(
                "alpha-server",
                familiarId: "shared",
                projectRoot: alpha.root,
                updatedAt: PermissionModels.isoFormatter.string(from: Date(timeIntervalSince1970: 60))
            ),
            session(
                "beta-server",
                familiarId: "shared",
                projectRoot: beta.root,
                updatedAt: PermissionModels.isoFormatter.string(from: Date(timeIntervalSince1970: 70))
            ),
        ]
        app.tasks = [
            card("alpha-task", familiarId: "nova", projectId: alpha.id),
            card("beta-task", familiarId: "lyra", projectId: beta.id),
        ]

        app.switchProject(to: .project(alpha))

        XCTAssertEqual(Set(app.projectFamiliars.map(\.id)), Set(["nova", "shared"]))
        XCTAssertEqual(app.projectTasks.map(\.id), ["alpha-task"])
        XCTAssertEqual(app.projectRecentThreads(limit: 2).map(\.id), ["alpha-pinned", "alpha-recent"])
        XCTAssertEqual(app.projectMostRecentThread?.id, "alpha-recent")
        XCTAssertEqual(app.projectDirectThreads(for: "shared").map(\.id), ["alpha-pinned"])
        XCTAssertEqual(app.projectLandingDirectThread(for: "shared")?.id, "alpha-pinned")
        XCTAssertEqual(app.projectServerOnlySessions(for: "shared").map(\.id), ["alpha-server"])
        XCTAssertEqual(app.projectThreadCount(for: "shared"), 2)

        app.switchProject(to: .project(beta))

        XCTAssertEqual(Set(app.projectFamiliars.map(\.id)), Set(["shared", "lyra"]))
        XCTAssertEqual(app.projectTasks.map(\.id), ["beta-task"])
        XCTAssertEqual(app.projectRecentThreads(limit: 2).map(\.id), ["beta-recent", "beta-shared"])
        XCTAssertEqual(app.projectMostRecentThread?.id, "beta-recent")
        XCTAssertEqual(app.projectDirectThreads(for: "shared").map(\.id), ["beta-shared"])
        XCTAssertEqual(app.projectLandingDirectThread(for: "shared")?.id, "beta-shared")
        XCTAssertEqual(app.projectServerOnlySessions(for: "shared").map(\.id), ["beta-server"])
        XCTAssertEqual(app.projectThreadCount(for: "shared"), 2)
    }

    @MainActor
    func testSharedFamiliarThreadsAndUnreadStayScopedPerProject() throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let shared = familiar("shared", "Shared")

        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.familiars = [shared]
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: [
                "alpha": Set(["shared"]),
                "beta": Set(["shared"]),
            ]
        )
        app.projectMembershipLoaded = true

        let alphaThread = thread(
            "alpha-thread",
            familiarIds: ["shared"],
            projectRoot: alpha.root,
            updatedAt: Date(timeIntervalSince1970: 40)
        )
        app.threads = [alphaThread]
        app.serverSessions = [
            session(
                "beta-server",
                familiarId: "shared",
                projectRoot: beta.root,
                updatedAt: PermissionModels.isoFormatter.string(
                    from: Date(timeIntervalSince1970: 70)
                )
            ),
        ]

        app.familiarViews["project:alpha|shared"] = Date(timeIntervalSince1970: 0)
        app.familiarViews["project:beta|shared"] = Date(timeIntervalSince1970: 0)

        app.switchProject(to: .project(alpha))

        let alphaDirect = try XCTUnwrap(app.directThread(for: "shared", in: app.projectContext))
        XCTAssertEqual(alphaDirect.id, "alpha-thread")
        XCTAssertEqual(app.projectLastActivity(for: "shared"), Date(timeIntervalSince1970: 40))

        app.markFamiliarViewed(["shared"])
        XCTAssertFalse(app.projectHasUnread("shared"))

        app.switchProject(to: .project(beta))

        XCTAssertTrue(app.projectHasUnread("shared"))
        XCTAssertEqual(
            app.projectLastActivity(for: "shared"),
            Date(timeIntervalSince1970: 70)
        )
        XCTAssertEqual(app.projectServerOnlySessions(for: "shared").map(\.id), ["beta-server"])

        let betaDirect = try XCTUnwrap(app.directThread(for: "shared", in: app.projectContext))
        XCTAssertEqual(betaDirect.projectRoot, beta.root)
        XCTAssertNotEqual(betaDirect.id, alphaDirect.id)
    }

    @MainActor
    func testFamiliarsListPresentationKeepsAccessScopedRosterDuringCachedRefreshFailure() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)
        app.familiars = [
            familiar("nova", "Nova"),
            familiar("sage", "Sage"),
        ]
        app.familiarsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiarsError = "Grant refresh failed"

        let presentation = FamiliarsListPresentation(app: app)

        XCTAssertEqual(presentation.visibleFamiliars.map(\.id), ["nova"])
        XCTAssertTrue(presentation.showsCachedAccessBanner)
        XCTAssertEqual(presentation.mode, .list)
    }

    @MainActor
    func testFamiliarsListPresentationUsesRecoveryCopyWhenCachedScopeIsEmpty() {
        let app = makeApp()
        app.projectContext = .unassigned
        app.projectMembershipLoaded = true
        app.familiarsError = "Grant refresh failed"

        let presentation = FamiliarsListPresentation(app: app)

        XCTAssertTrue(presentation.visibleFamiliars.isEmpty)
        XCTAssertTrue(presentation.showsCachedAccessBanner)
        XCTAssertEqual(
            presentation.mode,
            .empty(title: "No recovery familiars", message: ProjectContextCopy.unassignedRecovery)
        )
    }

    @MainActor
    func testFamiliarDetailStatsStayScopedAndUseNoActivityFallback() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let shared = familiar("shared", "Shared")
        let quiet = familiar("quiet", "Quiet")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.familiars = [shared, quiet]
        app.tasks = [
            card("alpha-task", familiarId: "shared", projectId: alpha.id),
            card("beta-task", familiarId: "shared", projectId: beta.id),
        ]
        app.tasksLoaded = true
        app.threads = [
            thread(
                "alpha-thread",
                familiarIds: ["shared"],
                projectRoot: alpha.root,
                updatedAt: Date(timeIntervalSince1970: 40)
            ),
            thread(
                "beta-thread",
                familiarIds: ["shared"],
                projectRoot: beta.root,
                updatedAt: Date(timeIntervalSince1970: 80)
            ),
        ]

        let alphaStats = FamiliarDetailStatsModel.make(app: app, familiar: shared, context: .project(alpha))
        let quietStats = FamiliarDetailStatsModel.make(app: app, familiar: quiet, context: .project(alpha))

        XCTAssertEqual(alphaStats.chats, "1")
        XCTAssertEqual(alphaStats.tasks, "1")
        XCTAssertNotEqual(alphaStats.activity, "No activity yet")
        XCTAssertEqual(quietStats.chats, "0")
        XCTAssertEqual(quietStats.tasks, "0")
        XCTAssertEqual(quietStats.activity, "No activity yet")
    }

    func testTasksViewDropsLegacyProjectGroupingAndScopesPendingOpenCards() {
        XCTAssertEqual(
            TasksView.GroupBy.allCases.map(\.rawValue),
            ["Status", "Familiar", "Priority"]
        )
        XCTAssertEqual(TasksView.normalizedGroupByRaw("Project"), TasksView.GroupBy.familiar.rawValue)

        let alpha = card("alpha-task", familiarId: "nova", projectId: "alpha")
        let beta = card("beta-task", familiarId: "nova", projectId: "beta")

        XCTAssertEqual(
            TasksView.requestedCardToOpen(beta, in: [alpha]),
            nil
        )
        XCTAssertEqual(
            TasksView.requestedCardToOpen(alpha, in: [alpha])?.id,
            alpha.id
        )
    }

    @MainActor
    func testProjectLinkedTasksAndAssignableTasksFilterByThreadProjectFirst() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.tasks = [
            card("alpha-linked", familiarId: "nova", projectId: alpha.id, sessionId: "alpha-session"),
            card("alpha-unassigned", familiarId: nil, projectId: alpha.id),
            card("alpha-other-familiar", familiarId: "sage", projectId: alpha.id),
            card("beta-mismatch", familiarId: "nova", projectId: beta.id, sessionId: "alpha-session"),
            card(
                "deleted-project-link",
                familiarId: "nova",
                projectId: "deleted-project",
                sessionId: "alpha-session"
            ),
            card("projectless", familiarId: "nova", projectId: nil),
        ]
        let thread = ChatThread(
            title: "Alpha",
            familiarIds: ["nova"],
            sessionIds: ["nova": "alpha-session"],
            projectRoot: alpha.root
        )

        XCTAssertEqual(app.projectLinkedTasks(for: thread).map(\.id), ["alpha-linked"])
        XCTAssertEqual(
            app.projectAssignableTasks(for: thread, matching: "").map(\.id),
            ["alpha-unassigned"]
        )
    }

    @MainActor
    func testOpenServerSessionBackfillsExistingThreadProjectRoot() {
        let app = makeApp()
        let existing = ChatThread(
            title: "Existing",
            familiarIds: ["nova"],
            sessionIds: ["nova": "session-1"]
        )
        app.threads = [existing]

        let opened = app.openServerSession(
            session("session-1", familiarId: "nova", projectRoot: "/repos/alpha"),
            familiarId: "nova"
        )

        XCTAssertTrue(opened === existing)
        XCTAssertEqual(existing.projectRoot, "/repos/alpha")
    }

    @MainActor
    func testOpenFamiliarLandingThreadPrefersExistingLocalThreadOverServerOnlySession() throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let existing = thread(
            "local-thread",
            familiarIds: ["nova"],
            projectRoot: alpha.root,
            updatedAt: Date(timeIntervalSince1970: 50)
        )
        app.projects = [alpha]
        app.threads = [existing]
        app.serverSessions = [
            session(
                "server-session",
                familiarId: "nova",
                projectRoot: alpha.root,
                updatedAt: PermissionModels.isoFormatter.string(
                    from: Date(timeIntervalSince1970: 100)
                )
            ),
        ]

        let opened = try XCTUnwrap(
            app.openFamiliarLandingThread(for: "nova", in: .project(alpha))
        )

        XCTAssertTrue(opened === existing)
        XCTAssertEqual(app.threads.map(\.id), ["local-thread"])
    }

    @MainActor
    func testOpenFamiliarLandingThreadMaterializesServerOnlyProjectSession() throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.serverSessions = [
            session(
                "server-session",
                familiarId: "nova",
                projectRoot: alpha.root,
                updatedAt: PermissionModels.isoFormatter.string(
                    from: Date(timeIntervalSince1970: 100)
                )
            ),
        ]

        let opened = try XCTUnwrap(
            app.openFamiliarLandingThread(for: "nova", in: .project(alpha))
        )

        XCTAssertEqual(opened.projectRoot, alpha.root)
        XCTAssertEqual(opened.sessionIds, ["nova": "server-session"])
        XCTAssertEqual(app.threads.map(\.id), [opened.id])
    }

    @MainActor
    func testOpenFamiliarLandingThreadMaterializesServerOnlyProjectSessionForImmediateSend() throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["sage"])]
        )
        app.projectMembershipLoaded = true
        app.serverSessions = [
            session(
                "server-session",
                familiarId: "nova",
                projectRoot: alpha.root,
                updatedAt: PermissionModels.isoFormatter.string(
                    from: Date(timeIntervalSince1970: 100)
                )
            ),
        ]

        let opened = try XCTUnwrap(
            app.openFamiliarLandingThread(
                for: "nova",
                in: .project(alpha),
                loadHistory: false
            )
        )

        XCTAssertEqual(opened.projectRoot, alpha.root)
        XCTAssertEqual(opened.sessionIds, ["nova": "server-session"])
        XCTAssertTrue(opened.messages.isEmpty)
        XCTAssertEqual(app.threads.map(\.id), [opened.id])
    }

    @MainActor
    func testOpenFamiliarLandingThreadCreatesFreshProjectThreadWhenNoHistoryExists() throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.familiars = [familiar("nova", "Nova")]
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true

        let opened = try XCTUnwrap(
            app.openFamiliarLandingThread(for: "nova", in: .project(alpha))
        )

        XCTAssertEqual(opened.projectRoot, alpha.root)
        XCTAssertEqual(opened.familiarIds, ["nova"])
        XCTAssertTrue(opened.sessionIds.isEmpty)
        XCTAssertTrue(opened.messages.isEmpty)
        XCTAssertEqual(app.threads.map(\.id), [opened.id])
    }

    @MainActor
    func testOpenFamiliarLandingThreadBlocksFreshProjectThreadWhenFamiliarCannotAccessProject() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["sage"])]
        )
        app.projectMembershipLoaded = true

        let opened = app.openFamiliarLandingThread(for: "nova", in: .project(alpha))

        XCTAssertNil(opened)
        XCTAssertTrue(app.threads.isEmpty)
    }

    @MainActor
    func testOpenFamiliarLandingThreadBlocksRecoveryOnlyUnassignedMaterialization() {
        let app = makeApp()
        app.serverSessions = [
            session("server-session", familiarId: "nova", projectRoot: nil),
        ]

        let opened = app.openFamiliarLandingThread(for: "nova", in: .unassigned)

        XCTAssertNil(opened)
        XCTAssertTrue(app.threads.isEmpty)
    }

    @MainActor
    func testLoadSessionsBackfillsLegacyRestoredThreadAndReclassifiesUnassigned() async {
        let alpha = project("alpha", "Alpha")
        let app = makeApp(
            restoreLocalState: true,
            threadSnapshotLoader: {
                [
                    ThreadSnapshot(
                        id: "legacy-thread",
                        title: "Legacy",
                        familiarIds: ["nova"],
                        sessionIds: ["nova": "session-1"],
                        projectRoot: nil,
                        messages: [],
                        pendingModelOverride: nil,
                        updatedAt: Date(timeIntervalSince1970: 10),
                        archived: false,
                        pinned: false,
                        muted: false
                    ),
                ]
            }
        )
        let connection = connect(app)
        persistProjectContextSelection("unassigned", for: connection)

        await app.loadProjectContext(using: client(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: []
        ))

        XCTAssertEqual(app.projectContext, .unassigned)
        XCTAssertNil(app.threads.first?.projectRoot)

        await app.loadSessions(using: client(
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("session-1", familiarId: "nova", projectRoot: alpha.root)]
        ))

        XCTAssertEqual(app.threads.first?.projectRoot, alpha.root)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.projectThreads.map(\.id), ["legacy-thread"])
    }

    func testLoadProjectContextBackfillsLegacyRestoredThreadBeforeFetchingTaskHistory() async {
        let alpha = project("alpha", "Alpha")
        let message = "Recent tasks unavailable"
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("session-1", familiarId: "nova", projectRoot: alpha.root)],
            tasksResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 7,
                userInfo: [NSLocalizedDescriptionKey: message]
            ))
        )
        let app = makeApp(
            restoreLocalState: true,
            threadSnapshotLoader: {
                [
                    ThreadSnapshot(
                        id: "legacy-thread",
                        title: "Legacy",
                        familiarIds: ["nova"],
                        sessionIds: ["nova": "session-1"],
                        projectRoot: nil,
                        messages: [],
                        pendingModelOverride: nil,
                        updatedAt: Date(timeIntervalSince1970: 10),
                        archived: false,
                        pinned: false,
                        muted: false
                    ),
                ]
            }
        )
        let connection = connect(app)
        persistProjectContextSelection("unassigned", for: connection)

        await app.loadProjectContext(using: controlledClient)

        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.threads.first?.projectRoot, alpha.root)
        XCTAssertEqual(
            defaults.string(forKey: projectContextStorageKey(for: connection)),
            "project:alpha"
        )
        XCTAssertTrue(app.sessionsLoaded)
        XCTAssertFalse(app.tasksLoaded)
        XCTAssertNil(app.tasksError)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
        XCTAssertEqual(calls.tasks, 0)
        let historyOrder = await controlledClient.callLog.historyOrderSnapshot()
        XCTAssertEqual(historyOrder, [.sessions])
    }

    @MainActor
    func testExplicitUserUnassignedSelectionIsNotOverriddenBySessionBackfill() async {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let connection = connect(app)
        app.projects = [alpha]
        app.projectsLoaded = true
        app.threads = [
            ChatThread(
                title: "Legacy",
                familiarIds: ["nova"],
                sessionIds: ["nova": "session-1"]
            ),
        ]
        app.switchProject(to: .unassigned)

        await app.loadSessions(using: client(
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("session-1", familiarId: "nova", projectRoot: alpha.root)]
        ))

        XCTAssertEqual(app.threads.first?.projectRoot, alpha.root)
        XCTAssertEqual(app.projectContext, .unassigned)
        XCTAssertEqual(
            defaults.string(forKey: projectContextStorageKey(for: connection)),
            "unassigned"
        )
    }

    @MainActor
    func testOpenChatCreatesDirectTaskThreadInTaskProject() async throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: [
                "alpha": Set(["nova"]),
                "beta": Set(["nova"]),
            ]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(beta)

        let task = card("alpha-task", familiarId: "nova", projectId: alpha.id)
        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertEqual(unwrapped.projectRoot, alpha.root)
        XCTAssertEqual(unwrapped.familiarIds, ["nova"])
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.cardThreadLinks[task.id], unwrapped.id)
        XCTAssertTrue(app.threadToOpen === unwrapped)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.toast)
    }

    @MainActor
    func testOpenChatUsesChosenFamiliarForProjectScopedTaskThread() async throws {
        let app = makeApp()
        let beta = project("beta", "Beta")
        app.projects = [beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["beta": Set(["sage"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("sage", "Sage")]
        app.projectContext = .project(beta)

        let task = card("beta-task", familiarId: nil, projectId: beta.id)
        let opened = await app.openChat(for: task, familiarId: "sage")
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertEqual(unwrapped.projectRoot, beta.root)
        XCTAssertEqual(unwrapped.familiarIds, ["sage"])
        XCTAssertEqual(app.cardThreadLinks[task.id], unwrapped.id)
        XCTAssertTrue(app.threadToOpen === unwrapped)
        XCTAssertNil(app.toast)
    }

    @MainActor
    func testOpenChatFromTaskBlocksInUnassignedRecoveryContext() async {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .unassigned

        let task = card("alpha-task", familiarId: "nova", projectId: alpha.id)

        let opened = await app.openChat(for: task)
        XCTAssertNil(opened)
        XCTAssertTrue(app.threads.isEmpty)
        XCTAssertNil(app.cardThreadLinks[task.id])
        XCTAssertNil(app.threadToOpen)
        assertToast(
            app,
            text: "Unassigned tasks are recovery-only. Switch to a registered project in Tasks to start a chat.",
            systemImage: "folder.badge.questionmark"
        )
    }

    @MainActor
    func testOpenChatFromTaskBlocksWhenTaskProjectIsMissingOrDeleted() async {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        for task in [
            card("missing-task", familiarId: "nova", projectId: nil),
            card("deleted-task", familiarId: "nova", projectId: "deleted"),
        ] {
            app.toast = nil

            let opened = await app.openChat(for: task)
            XCTAssertNil(opened)
            XCTAssertTrue(app.threads.isEmpty)
            XCTAssertNil(app.cardThreadLinks[task.id])
            XCTAssertNil(app.threadToOpen)
            assertToast(
                app,
                text: "This task is no longer linked to a registered project. Refresh Tasks or reassign it on your desktop, then try again.",
                systemImage: "folder.badge.questionmark"
            )
        }
    }

    @MainActor
    func testOpenChatFromTaskBlocksWhenFamiliarCannotAccessTaskProject() async {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["beta": Set(["sage"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("sage", "Sage")]
        app.projectContext = .project(beta)

        let task = card("alpha-task", familiarId: nil, projectId: alpha.id)

        let opened = await app.openChat(for: task, familiarId: "sage")
        XCTAssertNil(opened)
        XCTAssertTrue(app.threads.isEmpty)
        XCTAssertNil(app.cardThreadLinks[task.id])
        XCTAssertNil(app.threadToOpen)
        assertToast(
            app,
            text: "Sage can’t access Alpha. Pick a familiar from that project or refresh Tasks, then try again.",
            systemImage: "person.crop.circle.badge.exclamationmark"
        )
    }

    @MainActor
    func testOpenChatForTaskSessionFetchesAuthoritativeSessionWhenCacheIsEmpty() async throws {
        let beta = project("beta", "Beta")
        let controlledClient = ControlledCoreClient(
            projects: [beta],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: beta.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("session-1", familiarId: "nova", projectRoot: beta.root)]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["beta": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(beta)

        let task = card(
            "beta-task",
            familiarId: "nova",
            projectId: beta.id,
            sessionId: "session-1"
        )
        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertEqual(unwrapped.sessionIds["nova"], "session-1")
        XCTAssertEqual(unwrapped.projectRoot, beta.root)
        XCTAssertEqual(app.serverSessions.map(\.id), ["session-1"])
        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertNil(app.toast)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testOpenChatForTaskSessionOpensAuthoritativeSessionWhenProjectDisagrees() async throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: [
                "alpha": Set(["nova"]),
                "beta": Set(["nova"]),
            ]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)
        await app.loadSessions(using: client(
            projects: [alpha, beta],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("session-1", familiarId: "nova", projectRoot: beta.root)]
        ))

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "session-1"
        )
        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertEqual(unwrapped.sessionIds["nova"], "session-1")
        XCTAssertEqual(unwrapped.projectRoot, beta.root)
        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertNil(app.cardThreadLinks[task.id])
        XCTAssertNil(app.linkedThread(for: task))
        assertToast(
            app,
            text: "This task is filed in Alpha, but its linked chat belongs to Beta. Opening the linked chat so you can repair or unlink it.",
            systemImage: "exclamationmark.triangle.fill"
        )
    }

    @MainActor
    func testAuthoritativeTaskSessionPreviewRemainsVisibleWhenTaskProjectDisagrees() async throws {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let staleLocal = thread("alpha-local", familiarIds: ["nova"], projectRoot: alpha.root)
        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "session-1"
        )
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: [
                "alpha": Set(["nova"]),
                "beta": Set(["nova"]),
            ]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)
        app.tasks = [task]
        app.tasksLoaded = true
        app.threads = [staleLocal]
        app.cardThreadLinks[task.id] = staleLocal.id
        await app.loadSessions(using: client(
            projects: [alpha, beta],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("session-1", familiarId: "nova", projectRoot: beta.root)]
        ))

        let preview = try XCTUnwrap(app.authoritativeTaskSessionPreview(for: task))
        XCTAssertEqual(preview.row.id, "session-1")
        XCTAssertTrue(preview.mismatchedProject)
        XCTAssertEqual(preview.suggestedProject?.id, beta.id)
        XCTAssertEqual(preview.taskProject?.id, alpha.id)
        XCTAssertNil(app.linkedThread(for: task))

        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertFalse(unwrapped === staleLocal)
        XCTAssertEqual(unwrapped.sessionIds["nova"], "session-1")
        XCTAssertEqual(unwrapped.projectRoot, beta.root)
        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.cardThreadLinks[task.id], staleLocal.id)
        XCTAssertNil(app.linkedThread(for: task))
    }

    @MainActor
    func testOpenChatForMissingTaskSessionReturnsNilWithoutMaterializingLocalThread() async throws {
        let alpha = project("alpha", "Alpha")
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: []
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "missing-session"
        )
        let opened = await app.openChat(for: task)
        XCTAssertNil(opened)
        XCTAssertTrue(app.threads.isEmpty)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertTrue(app.cardThreadLinks.isEmpty)
        XCTAssertNil(app.threadToOpen)
        assertToast(
            app,
            text: "This task’s linked chat could not be verified. Refresh Chats or reopen it on your desktop, then try again.",
            systemImage: "arrow.clockwise"
        )
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testOpenChatForTaskSessionLoadFailureReturnsNilWithoutMaterializingLocalThread() async throws {
        let alpha = project("alpha", "Alpha")
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessionsResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 87,
                userInfo: [NSLocalizedDescriptionKey: "Session history is offline"]
            ))
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "offline-session"
        )
        let opened = await app.openChat(for: task)

        XCTAssertNil(opened)
        XCTAssertTrue(app.threads.isEmpty)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertTrue(app.cardThreadLinks.isEmpty)
        XCTAssertNil(app.threadToOpen)
        assertToast(
            app,
            text: "Couldn’t load this task’s linked chat. Refresh Chats or reconnect, then try again.",
            systemImage: "bubble.left.and.exclamationmark.bubble.right"
        )
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testOpenChatForTaskSessionLoadFailurePreservesExistingLocalThreadWithoutDowngrading() async throws {
        let alpha = project("alpha", "Alpha")
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessionsResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 88,
                userInfo: [NSLocalizedDescriptionKey: "Session history is offline"]
            ))
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        let existing = ChatThread(
            title: "Recovered local copy",
            familiarIds: ["nova"],
            sessionIds: ["nova": "offline-session"],
            projectRoot: alpha.root
        )
        app.threads = [existing]

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "offline-session"
        )
        app.cardThreadLinks[task.id] = existing.id

        let opened = await app.openChat(for: task)

        XCTAssertNil(opened)
        XCTAssertTrue(app.threads.first === existing)
        XCTAssertEqual(existing.projectRoot, alpha.root)
        XCTAssertFalse(app.isRecoveryOnlyThread(existing))
        XCTAssertEqual(app.cardThreadLinks[task.id], existing.id)
        XCTAssertNil(app.threadToOpen)
        XCTAssertEqual(app.threads.count, 1)
        assertToast(
            app,
            text: "Couldn’t load this task’s linked chat. Refresh Chats or reconnect, then try again.",
            systemImage: "bubble.left.and.exclamationmark.bubble.right"
        )
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testOpenChatForTaskSessionMissingProjectRootReturnsNilWithoutMaterializingLocalThread() async throws {
        let alpha = project("alpha", "Alpha")
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("projectless-session", familiarId: "nova", projectRoot: nil)]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "projectless-session"
        )
        let opened = await app.openChat(for: task)

        XCTAssertNil(opened)
        XCTAssertTrue(app.threads.isEmpty)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertTrue(app.cardThreadLinks.isEmpty)
        XCTAssertNil(app.threadToOpen)
        assertToast(
            app,
            text: "This task’s linked chat is missing project metadata. Refresh Chats or reopen it on your desktop, then try again.",
            systemImage: "folder.badge.questionmark"
        )
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testRepeatedTaskSessionRecoveryFailuresDoNotGrowThreadsOrLinks() async throws {
        let alpha = project("alpha", "Alpha")
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: []
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "missing-session"
        )

        let first = await app.openChat(for: task)
        let second = await app.openChat(for: task)

        XCTAssertNil(first)
        XCTAssertNil(second)
        XCTAssertTrue(app.threads.isEmpty)
        XCTAssertTrue(app.cardThreadLinks.isEmpty)
        XCTAssertNil(app.threadToOpen)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 2)
    }

    @MainActor
    func testOpenChatForUnresolvedTaskSessionOpensExistingLocalThreadAsRecoveryOnly() async throws {
        let alpha = project("alpha", "Alpha")
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: []
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        let existing = ChatThread(
            title: "Recovered local copy",
            familiarIds: ["nova"],
            sessionIds: ["nova": "missing-session"],
            projectRoot: alpha.root
        )
        app.threads = [existing]

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "missing-session"
        )
        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertTrue(unwrapped === existing)
        XCTAssertEqual(existing.title, "Recovered local copy")
        XCTAssertEqual(existing.familiarIds, ["nova"])
        XCTAssertEqual(existing.sessionIds, ["nova": "missing-session"])
        XCTAssertNil(existing.projectRoot)
        XCTAssertTrue(app.isRecoveryOnlyThread(existing))
        XCTAssertEqual(app.threads.count, 1)
        XCTAssertTrue(app.cardThreadLinks.isEmpty)
        XCTAssertTrue(app.threadToOpen === existing)
        XCTAssertEqual(app.selectedTab, .chats)
        assertToast(
            app,
            text: "This task’s linked chat could not be verified. Refresh Chats or reopen it on your desktop, then try again.",
            systemImage: "arrow.clockwise"
        )
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testOpenChatForTaskSessionMissingProjectRootOpensExistingLocalThreadAsRecoveryOnly() async throws {
        let alpha = project("alpha", "Alpha")
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("projectless-session", familiarId: "nova", projectRoot: nil)]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        let existing = ChatThread(
            title: "Recovered local copy",
            familiarIds: ["nova"],
            sessionIds: ["nova": "projectless-session"],
            projectRoot: alpha.root
        )
        app.threads = [existing]

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "projectless-session"
        )
        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertTrue(unwrapped === existing)
        XCTAssertEqual(existing.sessionIds, ["nova": "projectless-session"])
        XCTAssertNil(existing.projectRoot)
        XCTAssertTrue(app.isRecoveryOnlyThread(existing))
        XCTAssertEqual(app.threads.count, 1)
        XCTAssertTrue(app.cardThreadLinks.isEmpty)
        XCTAssertTrue(app.threadToOpen === existing)
        XCTAssertEqual(app.selectedTab, .chats)
        assertToast(
            app,
            text: "This task’s linked chat is missing project metadata. Refresh Chats or reopen it on your desktop, then try again.",
            systemImage: "folder.badge.questionmark"
        )
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testOpenChatForMissingTaskSessionOpensAuthoritativeSessionAfterRefresh() async throws {
        let alpha = project("alpha", "Alpha")
        let initialClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: []
        )
        let refreshedClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("missing-session", familiarId: "nova", projectRoot: alpha.root)]
        )
        let app = makeApp(coreResourceClientFactory: { _ in initialClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "missing-session"
        )

        let initialOpen = await app.openChat(for: task)
        XCTAssertNil(initialOpen)
        XCTAssertTrue(app.threads.isEmpty)
        XCTAssertTrue(app.cardThreadLinks.isEmpty)

        await app.loadSessions(using: refreshedClient)

        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertEqual(unwrapped.title, "missing-session")
        XCTAssertEqual(unwrapped.familiarIds, ["nova"])
        XCTAssertEqual(unwrapped.sessionIds, ["nova": "missing-session"])
        XCTAssertEqual(unwrapped.projectRoot, alpha.root)
        XCTAssertEqual(app.cardThreadLinks[task.id], unwrapped.id)
        XCTAssertTrue(app.threadToOpen === unwrapped)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertEqual(app.threads.count, 1)
        let initialCalls = await initialClient.callLog.snapshot()
        XCTAssertEqual(initialCalls.sessions, 1)
        let refreshedCalls = await refreshedClient.callLog.snapshot()
        XCTAssertEqual(refreshedCalls.sessions, 1)
    }

    @MainActor
    func testOpenChatForMissingTaskSessionRestoresExistingRecoveryThreadAfterRefresh() async throws {
        let alpha = project("alpha", "Alpha")
        let initialClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: []
        )
        let refreshedClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("missing-session", familiarId: "nova", projectRoot: alpha.root)]
        )
        let app = makeApp(coreResourceClientFactory: { _ in initialClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [familiar("nova", "Nova")]
        app.projectContext = .project(alpha)

        let existing = ChatThread(
            title: "Recovered local copy",
            familiarIds: ["nova"],
            sessionIds: ["nova": "missing-session"],
            projectRoot: alpha.root
        )
        app.threads = [existing]

        let task = card(
            "alpha-task",
            familiarId: "nova",
            projectId: alpha.id,
            sessionId: "missing-session"
        )

        let initialOpen = await app.openChat(for: task)
        let recovery = try XCTUnwrap(initialOpen)

        XCTAssertTrue(recovery === existing)
        XCTAssertNil(existing.projectRoot)
        XCTAssertTrue(app.isRecoveryOnlyThread(existing))
        XCTAssertTrue(app.cardThreadLinks.isEmpty)

        await app.loadSessions(using: refreshedClient)

        let opened = await app.openChat(for: task)
        let restored = try XCTUnwrap(opened)

        XCTAssertTrue(restored === existing)
        XCTAssertEqual(existing.title, "Recovered local copy")
        XCTAssertEqual(existing.familiarIds, ["nova"])
        XCTAssertEqual(existing.sessionIds, ["nova": "missing-session"])
        XCTAssertEqual(existing.projectRoot, alpha.root)
        XCTAssertFalse(app.isRecoveryOnlyThread(existing))
        XCTAssertEqual(app.cardThreadLinks[task.id], existing.id)
        XCTAssertTrue(app.threadToOpen === existing)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertEqual(app.threads.count, 1)
        let initialCalls = await initialClient.callLog.snapshot()
        XCTAssertEqual(initialCalls.sessions, 1)
        let refreshedCalls = await refreshedClient.callLog.snapshot()
        XCTAssertEqual(refreshedCalls.sessions, 1)
    }

    @MainActor
    func testOpenChatForTaskSessionUsesAuthoritativeSessionFamiliarOverTaskAndCaller() async throws {
        let beta = project("beta", "Beta")
        let controlledClient = ControlledCoreClient(
            projects: [beta],
            grants: grants(grants: [
                ProjectGrant(familiarId: "sage", projectId: beta.id, access: .write),
            ]),
            familiars: [
                familiar("ember", "Ember"),
                familiar("nova", "Nova"),
                familiar("sage", "Sage"),
            ],
            sessions: [session("session-1", familiarId: "sage", projectRoot: beta.root)]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["beta": Set(["sage"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [
            familiar("ember", "Ember"),
            familiar("nova", "Nova"),
            familiar("sage", "Sage"),
        ]
        app.projectContext = .project(beta)

        let task = card(
            "beta-task",
            familiarId: "nova",
            projectId: beta.id,
            sessionId: "session-1"
        )
        let opened = await app.openChat(for: task, familiarId: "ember")
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertEqual(unwrapped.familiarIds, ["sage"])
        XCTAssertEqual(unwrapped.sessionIds, ["sage": "session-1"])
        XCTAssertEqual(unwrapped.projectRoot, beta.root)
        XCTAssertEqual(app.cardThreadLinks[task.id], unwrapped.id)
        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertNil(app.toast)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testOpenChatForExistingTaskGroupThreadPreservesRosterWhenOnlyOneParticipantHasABoundSession() async throws {
        let beta = project("beta", "Beta")
        let controlledClient = ControlledCoreClient(
            projects: [beta],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: beta.id, access: .write),
                ProjectGrant(familiarId: "sage", projectId: beta.id, access: .write),
            ]),
            familiars: [
                familiar("nova", "Nova"),
                familiar("sage", "Sage"),
            ],
            sessions: [session("session-1", familiarId: "nova", projectRoot: beta.root)]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["beta": Set(["nova", "sage"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [
            familiar("nova", "Nova"),
            familiar("sage", "Sage"),
        ]
        app.projectContext = .project(beta)

        let existing = ChatThread(
            title: "Task: Beta Crew",
            familiarIds: ["nova", "sage"],
            sessionIds: ["nova": "session-1"]
        )
        app.threads = [existing]

        let task = card(
            "beta-task",
            familiarId: "nova",
            projectId: beta.id,
            sessionId: "session-1"
        )
        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertTrue(unwrapped === existing)
        XCTAssertEqual(existing.familiarIds, ["nova", "sage"])
        XCTAssertEqual(existing.sessionIds, ["nova": "session-1"])
        XCTAssertEqual(existing.projectRoot, beta.root)
        XCTAssertEqual(app.cardThreadLinks[task.id], existing.id)
        XCTAssertTrue(app.threadToOpen === existing)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.toast)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testOpenChatForExistingTaskGroupThreadPreservesRosterWhenSeveralParticipantsHaveBoundSessions() async throws {
        let beta = project("beta", "Beta")
        let controlledClient = ControlledCoreClient(
            projects: [beta],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: beta.id, access: .write),
                ProjectGrant(familiarId: "sage", projectId: beta.id, access: .write),
                ProjectGrant(familiarId: "ember", projectId: beta.id, access: .write),
            ]),
            familiars: [
                familiar("nova", "Nova"),
                familiar("sage", "Sage"),
                familiar("ember", "Ember"),
            ],
            sessions: [session("session-2", familiarId: "sage", projectRoot: beta.root)]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["beta": Set(["nova", "sage", "ember"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [
            familiar("nova", "Nova"),
            familiar("sage", "Sage"),
            familiar("ember", "Ember"),
        ]
        app.projectContext = .project(beta)

        let existing = ChatThread(
            title: "Task: Beta Crew",
            familiarIds: ["nova", "sage", "ember"],
            sessionIds: [
                "nova": "session-1",
                "lyra": "session-2",
            ]
        )
        app.threads = [existing]

        let task = card(
            "beta-task",
            familiarId: "nova",
            projectId: beta.id,
            sessionId: "session-2"
        )
        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertTrue(unwrapped === existing)
        XCTAssertEqual(existing.familiarIds, ["nova", "sage", "ember"])
        XCTAssertEqual(existing.sessionIds, [
            "nova": "session-1",
            "sage": "session-2",
        ])
        XCTAssertEqual(existing.projectRoot, beta.root)
        XCTAssertEqual(app.cardThreadLinks[task.id], existing.id)
        XCTAssertTrue(app.threadToOpen === existing)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.toast)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testOpenChatForExistingDirectTaskThreadRepairsStaleSessionFamiliarBinding() async throws {
        let beta = project("beta", "Beta")
        let controlledClient = ControlledCoreClient(
            projects: [beta],
            grants: grants(grants: [
                ProjectGrant(familiarId: "sage", projectId: beta.id, access: .write),
            ]),
            familiars: [
                familiar("nova", "Nova"),
                familiar("sage", "Sage"),
            ],
            sessions: [session("session-1", familiarId: "sage", projectRoot: beta.root)]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["beta": Set(["sage"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [
            familiar("nova", "Nova"),
            familiar("sage", "Sage"),
        ]
        app.projectContext = .project(beta)

        let existing = ChatThread(
            title: "Task: Beta",
            familiarIds: ["nova"],
            sessionIds: ["nova": "session-1"]
        )
        app.threads = [existing]

        let task = card(
            "beta-task",
            familiarId: "nova",
            projectId: beta.id,
            sessionId: "session-1"
        )
        let opened = await app.openChat(for: task)
        let unwrapped = try XCTUnwrap(opened)

        XCTAssertTrue(unwrapped === existing)
        XCTAssertEqual(existing.familiarIds, ["sage"])
        XCTAssertEqual(existing.sessionIds, ["sage": "session-1"])
        XCTAssertEqual(existing.projectRoot, beta.root)
        XCTAssertEqual(app.cardThreadLinks[task.id], existing.id)
        XCTAssertTrue(app.threadToOpen === existing)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.toast)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
    }

    @MainActor
    func testConcurrentTaskChatOpensReuseOneAuthoritativeThread() async throws {
        let beta = project("beta", "Beta")
        let historyStarted = Gate()
        let historyRelease = Gate()
        let controlledClient = ControlledCoreClient(
            projects: [beta],
            grants: grants(grants: [
                ProjectGrant(familiarId: "sage", projectId: beta.id, access: .write),
            ]),
            familiars: [
                familiar("nova", "Nova"),
                familiar("sage", "Sage"),
            ],
            sessions: [session("session-1", familiarId: "sage", projectRoot: beta.root)],
            historyStarted: historyStarted,
            historyRelease: historyRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [beta]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["beta": Set(["sage"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [
            familiar("nova", "Nova"),
            familiar("sage", "Sage"),
        ]
        app.projectContext = .project(beta)

        let task = card(
            "beta-task",
            familiarId: "nova",
            projectId: beta.id,
            sessionId: "session-1"
        )

        async let firstOpen = app.openChat(for: task)
        async let secondOpen = app.openChat(for: task)

        await historyStarted.wait()
        for _ in 0..<10 { await Task.yield() }
        await historyRelease.open()

        let firstResult = await firstOpen
        let secondResult = await secondOpen
        let first = try XCTUnwrap(firstResult)
        let second = try XCTUnwrap(secondResult)

        XCTAssertTrue(first === second)
        XCTAssertEqual(app.threads.count, 1)
        XCTAssertEqual(first.familiarIds, ["sage"])
        XCTAssertEqual(first.sessionIds, ["sage": "session-1"])
        XCTAssertEqual(first.projectRoot, beta.root)
        XCTAssertEqual(app.cardThreadLinks[task.id], first.id)
        XCTAssertTrue(app.threadToOpen === first)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.toast)
    }

    @MainActor
    func testBindThreadSessionReconcilesVoiceFirstTaskLinkExactlyOnce() async throws {
        let alpha = project("alpha", "Alpha")
        let task = card("alpha-task", familiarId: "nova", projectId: alpha.id)
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            tasks: [task]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.tasks = [task]
        app.tasksLoaded = true

        let thread = ChatThread(
            title: "Task: Alpha",
            familiarIds: ["nova"],
            projectRoot: alpha.root
        )
        app.threads = [thread]
        app.cardThreadLinks[task.id] = thread.id

        app.bindThreadSession("voice-session-1", to: thread, for: "nova")

        var updates: [(cardId: String, sessionId: String?)] = []
        for _ in 0..<40 {
            updates = await controlledClient.callLog.taskSessionUpdateSnapshot()
            if updates.count == 1 { break }
            await Task.yield()
        }

        XCTAssertEqual(thread.sessionIds, ["nova": "voice-session-1"])
        XCTAssertEqual(updates.count, 1)
        XCTAssertEqual(updates.first?.cardId, task.id)
        XCTAssertEqual(updates.first?.sessionId, "voice-session-1")
        XCTAssertEqual(app.tasks.first?.sessionId, "voice-session-1")

        app.bindThreadSession("voice-session-1", to: thread, for: "nova")
        for _ in 0..<5 { await Task.yield() }

        let finalUpdates = await controlledClient.callLog.taskSessionUpdateSnapshot()
        XCTAssertEqual(finalUpdates.count, 1)
        XCTAssertEqual(app.tasks.first?.sessionId, "voice-session-1")
        XCTAssertNil(app.toast)
    }

    @MainActor
    func testStartFreshThreadInActiveProjectCreatesThreadForValidRoster() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova", "sage"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [
            familiar("nova", "Nova"),
            familiar("sage", "Sage"),
        ]
        app.projectContext = .project(alpha)

        let thread = app.startFreshThreadInActiveProject(
            familiarIds: ["nova", "sage"],
            title: "Crew"
        )

        XCTAssertEqual(thread?.projectRoot, alpha.root)
        XCTAssertEqual(thread?.familiarIds, ["nova", "sage"])
        XCTAssertEqual(app.threads.map(\.id), [thread?.id].compactMap { $0 })
        XCTAssertNil(app.toast)
    }

    @MainActor
    func testStartFreshThreadInActiveProjectBlocksRosterOutsideActiveProject() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.familiars = [
            familiar("nova", "Nova"),
            familiar("sage", "Sage"),
        ]
        app.projectContext = .project(alpha)

        XCTAssertNil(app.startFreshThreadInActiveProject(
            familiarIds: ["nova", "sage"],
            title: "Crew"
        ))
        XCTAssertTrue(app.threads.isEmpty)
        assertToast(
            app,
            text: "Sage can’t access Alpha. Open New Chat to choose a valid roster or switch projects, then try again.",
            systemImage: "person.crop.circle.badge.exclamationmark"
        )
    }

    @MainActor
    func testRecoveryOnlyThreadRequiresEstablishedUnassignedSession() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true

        let startedProjectless = ChatThread(
            title: "Legacy",
            familiarIds: ["nova"],
            sessionIds: ["nova": "session-1"]
        )
        let startedUnregistered = ChatThread(
            title: "Moved",
            familiarIds: ["nova"],
            sessionIds: ["nova": "session-2"],
            projectRoot: "/repos/missing"
        )
        let preSessionProjectless = ChatThread(
            title: "Draft",
            familiarIds: ["nova"]
        )

        XCTAssertTrue(app.isRecoveryOnlyThread(startedProjectless))
        XCTAssertTrue(app.isRecoveryOnlyThread(startedUnregistered))
        XCTAssertFalse(app.isRecoveryOnlyThread(preSessionProjectless))
    }

    @MainActor
    func testProjectSwitcherStateOmitsUnassignedWhenNothingNeedsRecovery() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.projectContext = .project(alpha)
        app.familiars = [familiar("nova", "Nova")]
        app.threads = [
            thread("alpha-thread", familiarIds: ["nova"], projectRoot: "/repos/alpha")
        ]

        guard case .loaded(let rows, _) = app.projectSwitcherState else {
            return XCTFail("Expected loaded project switcher state")
        }

        XCTAssertEqual(rows.map(\.context.id), ["project:alpha"])
    }

    @MainActor
    func testProjectSwitcherStateKeepsCachedRowsWhenRefreshFails() {
        let app = makeApp()
        let alpha = project("alpha", "Alpha")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: ["alpha": Set(["nova"])]
        )
        app.projectMembershipLoaded = true
        app.projectContext = .project(alpha)
        app.projectContextError = "Grant refresh failed"

        guard case .loaded(let rows, let cachedError) = app.projectSwitcherState else {
            return XCTFail("Expected loaded project switcher state")
        }

        XCTAssertEqual(rows.map(\.context.id), ["project:alpha"])
        XCTAssertEqual(cachedError, "Grant refresh failed")
    }

    @MainActor
    func testProjectContextGateStateShowsRetryableErrorBeforeMembershipLoads() {
        let app = makeApp()
        app.projectContextError = "Project grants unavailable"

        XCTAssertEqual(
            app.projectContextGateState,
            .retryableError(message: "Project grants unavailable")
        )
        XCTAssertTrue(app.projectContextGateState.showsRetry)
    }

    @MainActor
    func testProjectContextGateAndSwitcherShowNoProjectsGuidanceWhenEmpty() {
        let app = makeApp()
        app.projectsLoaded = true
        app.projectMembershipLoaded = true

        XCTAssertEqual(app.projectContextGateState, .noProjects)
        XCTAssertEqual(app.projectContextGateState.title, "No projects yet")
        XCTAssertEqual(
            app.projectContextGateState.message,
            "Open Coven Cave on your desktop and add a project folder to group chats by codebase, then retry here."
        )
        XCTAssertEqual(app.projectSwitcherState, .emptyNoProjects)
    }

    func testRefreshConnectionFailedInitialProjectContextLoadUsesProjectContextRequiredState() async {
        let message = "Choose a project in Cave before opening it on this device."
        let foundURL = URL(string: "http://cave.test:3000")!
        let retryingClient = RetryingProjectContextCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            failuresRemaining: 1,
            failure: projectAccessDeniedError(message)
        )
        let app = makeApp(
            coreResourceClientFactory: { _ in retryingClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)

        await app.refreshConnection()

        XCTAssertEqual(app.connectionState, .projectContextRequired)
        XCTAssertNil(app.projectContext)
        XCTAssertFalse(app.projectMembershipLoaded)
        XCTAssertEqual(app.projectContextError, message)
    }

    func testConnectWithRetrySuccessfulRetryBecomesConnectedAfterInitialProjectContextFailure() async {
        let message = "Choose a project in Cave before opening it on this device."
        let foundURL = URL(string: "http://cave.test:3000")!
        let retryingClient = RetryingProjectContextCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            failuresRemaining: 1,
            failure: projectAccessDeniedError(message)
        )
        let app = makeApp(
            coreResourceClientFactory: { _ in retryingClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)

        await app.connectWithRetry()
        XCTAssertEqual(app.connectionState, .projectContextRequired)
        XCTAssertEqual(app.projectContextError, message)

        await app.connectWithRetry()

        XCTAssertEqual(app.connectionState, .connected)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertTrue(app.projectMembershipLoaded)
        XCTAssertNil(app.projectContextError)
    }

    func testRefreshConnectionWaitsForFirstProjectContextLoadBeforeConnected() async {
        let contextStarted = Gate()
        let contextRelease = Gate()
        let controlledClient = ControlledCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            contextStarted: contextStarted,
            contextRelease: contextRelease
        )
        let foundURL = URL(string: "http://cave.test:3000")!
        let app = makeApp(
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)

        let refresh = Task { await app.refreshConnection() }
        await contextStarted.wait()

        XCTAssertEqual(app.connectionState, .checking)
        XCTAssertNil(app.projectContext)
        XCTAssertFalse(app.projectMembershipLoaded)

        await contextRelease.open()
        await refresh.value

        XCTAssertEqual(app.connectionState, .connected)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.projects, 1)
        XCTAssertEqual(calls.grants, 1)
        XCTAssertEqual(calls.familiars, 1)
        XCTAssertEqual(calls.sessions, 1)
        // Task history IS consulted here, and one fetch is correct. The cold
        // selection is staged local threads -> server sessions -> task history
        // -> alphabetical, and `shouldFetchTaskHistoryForProjectContextSelection`
        // fetches whenever the decision would otherwise land on the alphabetical
        // or unassigned fallback. This client serves an EMPTY session list, so
        // sessions succeed without identifying a registered project and the
        // task-history stage runs — which is the point of that stage: it picks
        // the project the operator actually worked in instead of the one that
        // happens to sort first. Asserting 0 here asserted that the fallback
        // never runs, which was never true; it had simply never executed.
        XCTAssertEqual(calls.tasks, 1)
    }

    func testColdLaunchChoosesMostRecentHydratedLocalThreadProjectBeforeServerHistory() async {
        let hydrationStarted = Gate()
        let hydrationRelease = Gate()
        let foundURL = URL(string: "http://cave.test:3000")!
        let hydratedThread = thread(
            "alpha-thread",
            familiarIds: ["nova"],
            projectRoot: "/repos/alpha",
            updatedAt: Date(timeIntervalSince1970: 20)
        ).snapshot
        let controlledClient = ControlledCoreClient(
            projects: [
                project("alpha", "Alpha"),
                project("beta", "Beta"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [
                session(
                    "beta-session",
                    familiarId: "nova",
                    projectRoot: "/repos/beta",
                    updatedAt: PermissionModels.isoFormatter.string(from: Date(timeIntervalSince1970: 100))
                ),
            ]
        )
        let app = makeApp(
            restoreLocalState: true,
            threadSnapshotLoader: {
                await hydrationStarted.open()
                await hydrationRelease.wait()
                return [hydratedThread]
            },
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)

        let refresh = Task { await app.refreshConnection() }
        await hydrationStarted.wait()

        XCTAssertEqual(app.connectionState, .checking)
        XCTAssertNil(app.projectContext)

        await hydrationRelease.open()
        await refresh.value

        XCTAssertEqual(app.connectionState, .connected)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertEqual(app.projectThreads.map(\.id), ["alpha-thread"])
        XCTAssertFalse(app.sessionsLoaded)
        XCTAssertFalse(app.tasksLoaded)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.projects, 1)
        XCTAssertEqual(calls.grants, 1)
        XCTAssertEqual(calls.familiars, 1)
        XCTAssertEqual(calls.sessions, 0)
        XCTAssertEqual(calls.tasks, 0)
    }

    func testColdLaunchWithoutLocalThreadChoosesRecentEligibleServerSessionProject() async {
        let foundURL = URL(string: "http://cave.test:3000")!
        let controlledClient = ControlledCoreClient(
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "zulu", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [
                session(
                    "zulu-session",
                    familiarId: "nova",
                    projectRoot: "/repos/zulu",
                    updatedAt: PermissionModels.isoFormatter.string(from: Date(timeIntervalSince1970: 100))
                ),
            ]
        )
        let app = makeApp(
            restoreLocalState: true,
            threadSnapshotLoader: { [] },
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)

        await app.refreshConnection()

        XCTAssertEqual(app.connectionState, .connected)
        XCTAssertEqual(app.projectContext, .project(project("zulu", "Zulu")))
        XCTAssertTrue(app.sessionsLoaded)
        XCTAssertFalse(app.tasksLoaded)
        XCTAssertEqual(app.projectServerSessions.map(\.id), ["zulu-session"])
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.projects, 1)
        XCTAssertEqual(calls.grants, 1)
        XCTAssertEqual(calls.familiars, 1)
        XCTAssertEqual(calls.sessions, 1)
        XCTAssertEqual(calls.tasks, 0)
    }

    func testColdLaunchFallsBackToAlphabeticalProjectWhenSessionHistoryFails() async {
        let message = "Recent chats unavailable"
        let foundURL = URL(string: "http://cave.test:3000")!
        let controlledClient = ControlledCoreClient(
            projects: [
                project("zulu", "Zulu"),
                project("alpha", "Alpha"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessionsResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 6,
                userInfo: [NSLocalizedDescriptionKey: message]
            ))
        )
        let app = makeApp(
            restoreLocalState: true,
            threadSnapshotLoader: { [] },
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)

        await app.refreshConnection()

        XCTAssertEqual(app.connectionState, .connected)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertTrue(app.projectMembershipLoaded)
        XCTAssertTrue(app.projectsLoaded)
        XCTAssertTrue(app.familiarsLoaded)
        XCTAssertFalse(app.sessionsLoaded)
        XCTAssertFalse(app.tasksLoaded)
        XCTAssertEqual(app.sessionsError, message)
        XCTAssertNil(app.tasksError)
        XCTAssertNil(app.projectContextError)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
        XCTAssertEqual(calls.tasks, 0)
        let historyOrder = await controlledClient.callLog.historyOrderSnapshot()
        XCTAssertEqual(historyOrder, [.sessions])
    }

    func testColdLaunchUsesRecentTaskProjectBeforeAlphabeticalFallback() async {
        let foundURL = URL(string: "http://cave.test:3000")!
        let controlledClient = ControlledCoreClient(
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
                ProjectGrant(familiarId: "nova", projectId: "zulu", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [],
            tasks: [
                card("alpha-task", familiarId: "nova", projectId: "alpha", updatedAt: iso(10)),
                card("zulu-task", familiarId: "nova", projectId: "zulu", updatedAt: iso(20)),
            ]
        )
        let app = makeApp(
            restoreLocalState: true,
            threadSnapshotLoader: { [] },
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)

        await app.refreshConnection()

        XCTAssertEqual(app.connectionState, .connected)
        XCTAssertEqual(app.projectContext, .project(project("zulu", "Zulu")))
        XCTAssertTrue(app.sessionsLoaded)
        XCTAssertTrue(app.tasksLoaded)
        XCTAssertEqual(app.serverSessions, [])
        XCTAssertEqual(app.tasks.map(\.id), ["alpha-task", "zulu-task"])
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
        XCTAssertEqual(calls.tasks, 1)
        let historyOrder = await controlledClient.callLog.historyOrderSnapshot()
        XCTAssertEqual(historyOrder, [.sessions, .tasks])
    }

    func testLoadProjectContextWaitsForSuccessfulSessionHistoryBeforeFetchingTasks() async {
        let sessionStarted = Gate()
        let sessionRelease = Gate()
        let controlledClient = ControlledCoreClient(
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
                ProjectGrant(familiarId: "nova", projectId: "zulu", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [],
            tasks: [
                card("zulu-task", familiarId: "nova", projectId: "zulu", updatedAt: iso(20)),
            ],
            sessionStarted: sessionStarted,
            sessionRelease: sessionRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app)

        let loadTask = Task { await app.loadProjectContext(using: controlledClient) }
        await sessionStarted.wait()
        await Task.yield()
        await Task.yield()

        let callsBeforeSessionRelease = await controlledClient.callLog.snapshot()
        XCTAssertEqual(callsBeforeSessionRelease.sessions, 1)
        XCTAssertEqual(callsBeforeSessionRelease.tasks, 0)

        await sessionRelease.open()
        await loadTask.value

        XCTAssertEqual(app.projectContext, .project(project("zulu", "Zulu")))
        let historyOrder = await controlledClient.callLog.historyOrderSnapshot()
        XCTAssertEqual(historyOrder, [.sessions, .tasks])
    }

    func testLoadProjectContextSkipsTaskHistoryWhenLocalThreadAlreadyDeterminesContext() async {
        let controlledClient = ControlledCoreClient(
            projects: [
                project("alpha", "Alpha"),
                project("zulu", "Zulu"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
                ProjectGrant(familiarId: "nova", projectId: "zulu", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [],
            tasks: [
                card("zulu-task", familiarId: "nova", projectId: "zulu", updatedAt: iso(20)),
            ]
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        _ = connect(app)
        app.threads = [
            thread(
                "alpha-thread",
                familiarIds: ["nova"],
                projectRoot: "/repos/alpha",
                updatedAt: Date(timeIntervalSince1970: 10)
            ),
        ]

        await app.loadProjectContext(using: controlledClient)

        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 0)
        XCTAssertEqual(calls.tasks, 0)
    }

    func testColdLaunchFallsBackToAlphabeticalProjectWhenTaskHistoryFails() async {
        let message = "Recent tasks unavailable"
        let foundURL = URL(string: "http://cave.test:3000")!
        let controlledClient = ControlledCoreClient(
            projects: [
                project("zulu", "Zulu"),
                project("alpha", "Alpha"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [],
            tasksResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 7,
                userInfo: [NSLocalizedDescriptionKey: message]
            ))
        )
        let app = makeApp(
            restoreLocalState: true,
            threadSnapshotLoader: { [] },
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)

        await app.refreshConnection()

        XCTAssertEqual(app.connectionState, .connected)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertTrue(app.projectMembershipLoaded)
        XCTAssertTrue(app.projectsLoaded)
        XCTAssertTrue(app.familiarsLoaded)
        XCTAssertTrue(app.sessionsLoaded)
        XCTAssertTrue(app.serverSessions.isEmpty)
        XCTAssertFalse(app.tasksLoaded)
        XCTAssertEqual(app.tasksError, message)
        XCTAssertNil(app.projectContextError)
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
        XCTAssertEqual(calls.tasks, 1)
        let historyOrder = await controlledClient.callLog.historyOrderSnapshot()
        XCTAssertEqual(historyOrder, [.sessions, .tasks])
    }

    func testUserSwitchDuringHistoryBootstrapIsNotOverwritten() async {
        let historyStarted = Gate()
        let historyRelease = Gate()
        let controlledClient = ControlledCoreClient(
            projects: [
                project("alpha", "Alpha"),
                project("beta", "Beta"),
            ],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
                ProjectGrant(familiarId: "nova", projectId: "beta", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [
                session(
                    "alpha-session",
                    familiarId: "nova",
                    projectRoot: "/repos/alpha",
                    updatedAt: PermissionModels.isoFormatter.string(from: Date(timeIntervalSince1970: 100))
                ),
            ],
            historyStarted: historyStarted,
            historyRelease: historyRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in controlledClient })
        let connection = connect(app)

        let loadTask = Task { await app.loadProjectContext(using: controlledClient) }
        await historyStarted.wait()
        app.switchProject(to: .project(project("beta", "Beta")))

        await historyRelease.open()
        await loadTask.value

        XCTAssertEqual(app.projectContext, .project(project("beta", "Beta")))
        XCTAssertEqual(app.projects.map(\.id), ["alpha", "beta"])
        XCTAssertEqual(defaults.string(forKey: projectContextStorageKey(for: connection)), "project:beta")
        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
        XCTAssertEqual(calls.tasks, 0)
    }

    func testReconnectReloadsProjectContextWhenSurfaceReloadIsRequested() async {
        let controlledClient = ControlledCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")]
        )
        let foundURL = URL(string: "http://cave.test:3000")!
        let app = makeApp(
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        let connection = CaveConnection(host: foundURL.absoluteString)
        persistProjectContextSelection("project:alpha", for: connection)
        app.connection = connection
        app.connectionState = .connected
        app.projects = [project("stale", "Stale")]
        app.familiars = [familiar("stale", "Stale")]
        app.projectsLoaded = true
        app.familiarsLoaded = true
        app.projectMembershipLoaded = true
        app.projectContext = .project(project("stale", "Stale"))
        app.projectsError = "stale projects error"
        app.familiarsError = "stale familiars error"

        await app.refreshConnection(reloadLoadedSurfaces: true, quiet: true)

        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.projects, 1)
        XCTAssertEqual(calls.grants, 1)
        XCTAssertEqual(calls.familiars, 1)
        XCTAssertEqual(calls.sessions, 0)
        XCTAssertEqual(calls.tasks, 0)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertEqual(app.projects.map(\.id), ["alpha"])
        XCTAssertEqual(app.familiars.map(\.id), ["nova"])
        XCTAssertNil(app.projectsError)
        XCTAssertNil(app.familiarsError)
    }

    func testReconnectRefreshFailureMirrorsCachedProjectContextErrorToLoadedSurfaces() async {
        let message = "Grant refresh failed"
        let controlledClient = ControlledCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            grantsResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: message]
            ))
        )
        let foundURL = URL(string: "http://cave.test:3000")!
        let app = makeApp(
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        let connection = CaveConnection(host: foundURL.absoluteString)
        persistProjectContextSelection("project:alpha", for: connection)
        app.connection = connection
        app.connectionState = .connected
        app.projects = [project("alpha", "Alpha")]
        app.familiars = [familiar("nova", "Nova")]
        app.projectsLoaded = true
        app.familiarsLoaded = true
        app.projectMembershipLoaded = true
        app.projectContext = .project(project("alpha", "Alpha"))

        await app.refreshConnection(reloadLoadedSurfaces: true, quiet: true)

        let calls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(calls.projects, 1)
        XCTAssertEqual(calls.grants, 1)
        XCTAssertEqual(calls.familiars, 1)
        XCTAssertEqual(calls.sessions, 0)
        XCTAssertEqual(calls.tasks, 0)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertEqual(app.projectContextError, message)
        XCTAssertEqual(app.projectsError, message)
        XCTAssertEqual(app.familiarsError, message)
        XCTAssertEqual(app.projects.map(\.id), ["alpha"])
        XCTAssertEqual(app.familiars.map(\.id), ["nova"])
        XCTAssertTrue(app.projectMembershipLoaded)
    }

    func testReconnectRefreshFailureMirrorsCachedProjectContextErrorToEmptyProjectsAndRetryClearsIt() async {
        let message = "Grant refresh failed"
        let foundURL = URL(string: "http://cave.test:3000")!
        let retryingClient = RetryingProjectContextCoreClient(
            projects: [],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            failuresRemaining: 1,
            failure: NSError(
                domain: "AppModelProjectContextTests",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
        )
        let app = makeApp(
            coreResourceClientFactory: { _ in retryingClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)
        await app.loadProjectContext(using: client(
            projects: [],
            grants: grants(),
            familiars: [familiar("nova", "Nova")]
        ))
        app.serverSessions = []
        app.sessionsLoaded = false

        XCTAssertTrue(app.projectsLoaded)
        XCTAssertTrue(app.familiarsLoaded)
        XCTAssertTrue(app.projects.isEmpty)
        XCTAssertNil(app.projectsError)

        await app.loadProjectContext(using: retryingClient, mirrorFailuresTo: [.projects, .familiars])

        XCTAssertEqual(app.projectContextError, message)
        XCTAssertEqual(app.projectsError, message)
        XCTAssertEqual(app.familiarsError, message)
        XCTAssertTrue(app.projectsLoaded)
        XCTAssertTrue(app.familiarsLoaded)
        XCTAssertTrue(app.projects.isEmpty)

        await app.loadProjectContext(using: retryingClient, mirrorFailuresTo: [.projects, .familiars])

        XCTAssertNil(app.projectContextError)
        XCTAssertNil(app.projectsError)
        XCTAssertNil(app.familiarsError)
        XCTAssertTrue(app.projectsLoaded)
        XCTAssertTrue(app.projects.isEmpty)
        XCTAssertEqual(app.familiars.map(\.id), ["nova"])
    }

    func testReconnectRefreshFailureMirrorsCachedProjectContextErrorToEmptyFamiliarsAndRetryClearsIt() async {
        let message = "Grant refresh failed"
        let foundURL = URL(string: "http://cave.test:3000")!
        let retryingClient = RetryingProjectContextCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(),
            familiars: [],
            failuresRemaining: 1,
            failure: NSError(
                domain: "AppModelProjectContextTests",
                code: 5,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
        )
        let app = makeApp(
            coreResourceClientFactory: { _ in retryingClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)
        await app.loadProjectContext(using: client(
            projects: [project("alpha", "Alpha")],
            grants: grants(),
            familiars: []
        ))
        app.serverSessions = []
        app.sessionsLoaded = false

        XCTAssertTrue(app.projectsLoaded)
        XCTAssertTrue(app.familiarsLoaded)
        XCTAssertTrue(app.familiars.isEmpty)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
        XCTAssertNil(app.familiarsError)

        await app.loadProjectContext(using: retryingClient, mirrorFailuresTo: [.projects, .familiars])

        XCTAssertEqual(app.projectContextError, message)
        XCTAssertEqual(app.projectsError, message)
        XCTAssertEqual(app.familiarsError, message)
        XCTAssertTrue(app.projectsLoaded)
        XCTAssertTrue(app.familiarsLoaded)
        XCTAssertTrue(app.familiars.isEmpty)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))

        await app.loadProjectContext(using: retryingClient, mirrorFailuresTo: [.projects, .familiars])

        XCTAssertNil(app.projectContextError)
        XCTAssertNil(app.projectsError)
        XCTAssertNil(app.familiarsError)
        XCTAssertTrue(app.familiarsLoaded)
        XCTAssertTrue(app.familiars.isEmpty)
        XCTAssertEqual(app.projectContext, .project(project("alpha", "Alpha")))
    }

    func testPendingTaskIntentWaitsForRelocatedBootstrapBeforeHydrating() async throws {
        let alpha = project("alpha", "Alpha")
        let target = card("relocated-task", familiarId: "nova", projectId: alpha.id)
        let historyStarted = Gate()
        let historyRelease = Gate()
        let foundURL = try XCTUnwrap(URL(string: "http://cave.test:4000"))
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            tasks: [target],
            historyStarted: historyStarted,
            historyRelease: historyRelease
        )
        let app = makeApp(
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: "http://cave.test:3000")

        app.handleDeepLink(try XCTUnwrap(URL(string: "covencave://task/\(target.id)")))
        await Task.yield()

        let preBootstrapCalls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(preBootstrapCalls.tasks, 0)
        XCTAssertEqual(app.pendingProjectNavigationIntent?.taskId, target.id)
        XCTAssertNil(app.cardToOpen)
        XCTAssertNil(app.toast)

        let refreshTask = Task { await app.refreshConnection() }
        let started = expectation(description: "post-bootstrap task hydration started")
        Task { await historyStarted.wait(); started.fulfill() }
        await fulfillment(of: [started], timeout: 1)

        // `historyStarted` is opened by BOTH `sessions()` and `tasks()`, and the
        // cold selection stages sessions FIRST — so the gate we just waited on
        // was opened by the sessions call, while `tasks()` has not run and
        // cannot yet: sessions is still parked on the shared `historyRelease`.
        // Asserting `tasks == 1` here asserted an ordering the staging makes
        // impossible. What this moment actually proves is that the bootstrap
        // fan-out has begun and the intent has NOT hydrated off the back of it.
        let postBootstrapCalls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(postBootstrapCalls.sessions, 1)
        XCTAssertEqual(postBootstrapCalls.tasks, 0)
        XCTAssertEqual(app.pendingProjectNavigationIntent?.taskId, target.id)
        XCTAssertNil(app.cardToOpen)
        assertOnlyPortRelocationNoticeToast(app, port: 4000)

        await historyRelease.open()
        await refreshTask.value
        await waitFor { app.cardToOpen?.id == target.id }

        XCTAssertEqual(app.connection?.baseURL, foundURL)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        assertOnlyPortRelocationNoticeToast(app, port: 4000)
        // The hydration the mid-flight snapshot was too early to see: once the
        // release gate opens, the staged task fetch does run, and it is what
        // resolves `cardToOpen` above.
        let hydratedCalls = await controlledClient.callLog.snapshot()
        XCTAssertEqual(hydratedCalls.tasks, 1)
    }

    func testPendingTaskIntentFailsOnlyAfterSuccessfulCurrentGenerationTaskLoad() async throws {
        let alpha = project("alpha", "Alpha")
        let historyStarted = Gate()
        let historyRelease = Gate()
        let foundURL = try XCTUnwrap(URL(string: "http://cave.test:3000"))
        let controlledClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            tasks: [],
            historyStarted: historyStarted,
            historyRelease: historyRelease
        )
        let app = makeApp(
            coreResourceClientFactory: { _ in controlledClient },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        app.connection = CaveConnection(host: foundURL.absoluteString)

        app.handleDeepLink(try XCTUnwrap(URL(string: "covencave://task/missing-task")))
        await Task.yield()
        XCTAssertNil(app.toast)

        let refreshTask = Task { await app.refreshConnection() }
        let started = expectation(description: "missing-task hydration started")
        Task { await historyStarted.wait(); started.fulfill() }
        await fulfillment(of: [started], timeout: 1)

        XCTAssertEqual(app.pendingProjectNavigationIntent?.taskId, "missing-task")
        XCTAssertNil(app.cardToOpen)
        XCTAssertNil(app.toast)

        await historyRelease.open()
        await refreshTask.value
        await waitFor { app.toast != nil }

        XCTAssertEqual(app.pendingProjectNavigationIntent?.taskId, "missing-task")
        XCTAssertNil(app.cardToOpen)
        assertToast(
            app,
            text: "This task is not available on this device yet. Refresh Tasks and try again.",
            systemImage: "checklist"
        )
    }

    @MainActor
    func testPendingTaskHydrationFailureRetainsIntentUntilExplicitRetrySucceeds() async throws {
        let failingClient = ControlledCoreClient(
            projects: [],
            grants: grants(),
            familiars: [],
            tasksResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 71,
                userInfo: [NSLocalizedDescriptionKey: "Task history is offline"]
            ))
        )
        let recoveredTask = card("retry-task", familiarId: "nova", projectId: nil)
        let retryClient = ControlledCoreClient(
            projects: [],
            grants: grants(),
            familiars: [],
            tasks: [recoveredTask]
        )
        let app = makeApp()
        _ = connect(app, host: "http://127.0.0.1:1")
        app.pendingProjectNavigationIntent = ProjectNavigationIntent(
            entity: .task(id: recoveredTask.id),
            destination: .tasks
        )

        await app.loadTasks(using: failingClient)

        XCTAssertEqual(app.pendingProjectNavigationIntent?.taskId, recoveredTask.id)
        XCTAssertEqual(app.tasksError, "Task history is offline")
        XCTAssertNil(app.cardToOpen)
        assertToast(
            app,
            text: "Couldn’t load Tasks while opening task retry-task. Refresh Tasks or reconnect, then try again.",
            systemImage: "checklist"
        )
        let firstToastID = try XCTUnwrap(app.toast?.id)

        XCTAssertFalse(app.resolvePendingProjectNavigationIntent())
        XCTAssertFalse(app.resolvePendingProjectNavigationIntent())

        let failedCalls = await failingClient.callLog.snapshot()
        XCTAssertEqual(failedCalls.tasks, 1)
        XCTAssertEqual(app.toast?.id, firstToastID)

        await app.loadTasks(using: retryClient)

        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertEqual(app.cardToOpen?.id, recoveredTask.id)
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertNil(app.tasksError)
        XCTAssertNil(app.toast)
        let retryCalls = await retryClient.callLog.snapshot()
        XCTAssertEqual(retryCalls.tasks, 1)
    }

    @MainActor
    func testPendingSessionHydrationFailureRetainsIntentUntilExplicitRetrySucceeds() async throws {
        let failingClient = ControlledCoreClient(
            projects: [],
            grants: grants(),
            familiars: [],
            sessionsResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 72,
                userInfo: [NSLocalizedDescriptionKey: "Session history is offline"]
            ))
        )
        let recoveredSession = session("retry-session", familiarId: "nova", projectRoot: nil)
        let retryClient = ControlledCoreClient(
            projects: [],
            grants: grants(),
            familiars: [],
            sessions: [recoveredSession]
        )
        let app = makeApp()
        _ = connect(app, host: "http://127.0.0.1:1")
        app.pendingProjectNavigationIntent = ProjectNavigationIntent(
            entity: .thread(id: recoveredSession.id),
            destination: .chats
        )

        await app.loadSessions(using: failingClient)

        XCTAssertEqual(app.pendingProjectNavigationIntent?.threadId, recoveredSession.id)
        XCTAssertEqual(app.sessionsError, "Session history is offline")
        XCTAssertNil(app.threadToOpen)
        assertToast(
            app,
            text: "Couldn’t load Chats while opening chat retry-session. Refresh Chats or reconnect, then try again.",
            systemImage: "bubble.left.and.exclamationmark.bubble.right"
        )
        let firstToastID = try XCTUnwrap(app.toast?.id)

        XCTAssertFalse(app.resolvePendingProjectNavigationIntent())
        XCTAssertFalse(app.resolvePendingProjectNavigationIntent())

        let failedCalls = await failingClient.callLog.snapshot()
        XCTAssertEqual(failedCalls.sessions, 1)
        XCTAssertEqual(app.toast?.id, firstToastID)

        await app.loadSessions(using: retryClient)

        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertEqual(app.threadToOpen?.sessionIds, ["nova": recoveredSession.id])
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.sessionsError)
        XCTAssertNil(app.toast)
        let retryCalls = await retryClient.callLog.snapshot()
        XCTAssertEqual(retryCalls.sessions, 1)
    }

    @MainActor
    func testReconnectPendingSessionHydrationSupersedesStaleGenerationWithoutRetryLoop() async throws {
        let alpha = project("alpha", "Alpha")
        let staleStarted = Gate()
        let staleRelease = Gate()
        let currentStarted = Gate()
        let currentRelease = Gate()
        let reopened = session("reopened-session", familiarId: "nova", projectRoot: alpha.root)
        let stale = session("stale-session", familiarId: "nova", projectRoot: alpha.root)
        let foundURL = try XCTUnwrap(URL(string: "http://cave.test:3000"))
        let client = SequencedHistoryCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessionSteps: [
                .init(
                    result: .success([stale]),
                    started: staleStarted,
                    release: staleRelease
                ),
                .init(
                    result: .success([reopened]),
                    started: currentStarted,
                    release: currentRelease
                ),
            ]
        )
        let app = makeApp(
            coreResourceClientFactory: { _ in client },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        let connection = connect(app, host: foundURL.absoluteString)
        persistProjectContextSelection("project:\(alpha.id)", for: connection)

        await app.refreshConnection()
        XCTAssertEqual(app.projectContext, .project(alpha))
        let bootstrapCalls = await client.callLog.snapshot()
        XCTAssertEqual(bootstrapCalls.sessions, 0)

        app.pendingProjectNavigationIntent = ProjectNavigationIntent(
            entity: .thread(id: reopened.id),
            destination: .chats
        )
        XCTAssertFalse(app.resolvePendingProjectNavigationIntent(attemptHydrationIfNeeded: true))
        await staleStarted.wait()

        let reconnect = Task { await app.configure(host: foundURL.absoluteString) }
        await currentStarted.wait()
        await reconnect.value

        await staleRelease.open()
        await Task.yield()
        await Task.yield()

        let midCalls = await client.callLog.snapshot()
        XCTAssertEqual(midCalls.sessions, 2)
        XCTAssertEqual(app.pendingProjectNavigationIntent?.threadId, reopened.id)
        XCTAssertTrue(app.serverSessions.isEmpty)
        XCTAssertNil(app.threadToOpen)
        assertOnlyReconnectNoticeToast(app)

        await currentRelease.open()
        await waitFor { app.threadToOpen?.sessionIds == ["nova": reopened.id] }

        let finalCalls = await client.callLog.snapshot()
        XCTAssertEqual(finalCalls.sessions, 2)
        XCTAssertEqual(app.serverSessions.map(\.id), [reopened.id])
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.sessionsError)
        assertOnlyReconnectNoticeToast(app)
    }

    @MainActor
    func testReconnectPendingTaskHydrationSupersedesStaleGenerationWithoutRetryLoop() async throws {
        let alpha = project("alpha", "Alpha")
        let staleStarted = Gate()
        let staleRelease = Gate()
        let currentStarted = Gate()
        let currentRelease = Gate()
        let reopened = card("reopened-task", familiarId: "nova", projectId: alpha.id)
        let stale = card("stale-task", familiarId: "nova", projectId: alpha.id)
        let foundURL = try XCTUnwrap(URL(string: "http://cave.test:3000"))
        let client = SequencedHistoryCoreClient(
            projects: [alpha],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            taskSteps: [
                .init(
                    result: .success([stale]),
                    started: staleStarted,
                    release: staleRelease
                ),
                .init(
                    result: .success([reopened]),
                    started: currentStarted,
                    release: currentRelease
                ),
            ]
        )
        let app = makeApp(
            coreResourceClientFactory: { _ in client },
            baseURLDiscoverer: { _ in .found(foundURL) }
        )
        let connection = connect(app, host: foundURL.absoluteString)
        persistProjectContextSelection("project:\(alpha.id)", for: connection)

        await app.refreshConnection()
        XCTAssertEqual(app.projectContext, .project(alpha))
        let bootstrapCalls = await client.callLog.snapshot()
        XCTAssertEqual(bootstrapCalls.tasks, 0)

        app.pendingProjectNavigationIntent = ProjectNavigationIntent(
            entity: .task(id: reopened.id),
            destination: .tasks
        )
        XCTAssertFalse(app.resolvePendingProjectNavigationIntent(attemptHydrationIfNeeded: true))
        await staleStarted.wait()

        let reconnect = Task { await app.configure(host: foundURL.absoluteString) }
        await currentStarted.wait()
        await reconnect.value

        await staleRelease.open()
        await Task.yield()
        await Task.yield()

        let midCalls = await client.callLog.snapshot()
        XCTAssertEqual(midCalls.tasks, 2)
        XCTAssertEqual(app.pendingProjectNavigationIntent?.taskId, reopened.id)
        XCTAssertTrue(app.tasks.isEmpty)
        XCTAssertNil(app.cardToOpen)
        assertOnlyReconnectNoticeToast(app)

        await currentRelease.open()
        await waitFor { app.cardToOpen?.id == reopened.id }

        let finalCalls = await client.callLog.snapshot()
        XCTAssertEqual(finalCalls.tasks, 2)
        XCTAssertEqual(app.tasks.map(\.id), [reopened.id])
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.tasksError)
        assertOnlyReconnectNoticeToast(app)
    }

    @MainActor
    func testPendingProjectHydrationFailureRetainsIntentUntilExplicitRetrySucceeds() async throws {
        let alpha = project("alpha", "Alpha")
        let failingClient = ControlledCoreClient(
            projects: [],
            grants: grants(),
            familiars: [],
            projectsResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 73,
                userInfo: [NSLocalizedDescriptionKey: "Project context is offline"]
            ))
        )
        let retryClient = ControlledCoreClient(
            projects: [alpha],
            grants: grants(),
            familiars: []
        )
        let app = makeApp()
        _ = connect(app, host: "http://127.0.0.1:1")
        app.pendingProjectNavigationIntent = ProjectNavigationIntent(
            destination: .tasks,
            projectId: alpha.id
        )

        await app.loadProjectContext(using: failingClient)

        XCTAssertEqual(app.pendingProjectNavigationIntent?.projectId, alpha.id)
        XCTAssertEqual(app.projectContextError, "Project context is offline")
        XCTAssertNil(app.projectContext)
        assertToast(
            app,
            text: "Couldn’t load project context while opening project alpha. Refresh Chats or reconnect, then try again.",
            systemImage: "folder.badge.questionmark"
        )
        let firstToastID = try XCTUnwrap(app.toast?.id)

        XCTAssertFalse(app.resolvePendingProjectNavigationIntent())
        XCTAssertFalse(app.resolvePendingProjectNavigationIntent())

        let failedCalls = await failingClient.callLog.snapshot()
        XCTAssertEqual(failedCalls.projects, 1)
        XCTAssertEqual(failedCalls.grants, 1)
        XCTAssertEqual(failedCalls.familiars, 1)
        XCTAssertEqual(app.toast?.id, firstToastID)

        await app.loadProjectContext(using: retryClient)

        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertNil(app.projectContextError)
        XCTAssertNil(app.projectsError)
        XCTAssertNil(app.toast)
        let retryCalls = await retryClient.callLog.snapshot()
        XCTAssertEqual(retryCalls.projects, 1)
        XCTAssertEqual(retryCalls.grants, 1)
        XCTAssertEqual(retryCalls.familiars, 1)
    }

    func testStaleHistoryBootstrapCannotOverwriteDisconnectState() async {
        let historyStarted = Gate()
        let historyRelease = Gate()
        let app = makeApp()
        app.connection = CaveConnection(host: "http://cave.test:3000")

        let staleLoad = ControlledCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [
                session(
                    "alpha-session",
                    familiarId: "nova",
                    projectRoot: "/repos/alpha",
                    updatedAt: PermissionModels.isoFormatter.string(from: Date(timeIntervalSince1970: 100))
                ),
            ],
            historyStarted: historyStarted,
            historyRelease: historyRelease
        )

        let loadTask = Task { await app.loadProjectContext(using: staleLoad) }
        await historyStarted.wait()
        app.disconnect()

        await historyRelease.open()
        await loadTask.value

        XCTAssertNil(app.connection)
        XCTAssertNil(app.projectContext)
        XCTAssertTrue(app.serverSessions.isEmpty)
        XCTAssertFalse(app.sessionsLoaded)
        XCTAssertFalse(app.projectMembershipLoaded)
    }

    func testStaleProjectContextLoadCannotOverwriteDisconnectState() async {
        let contextStarted = Gate()
        let contextRelease = Gate()
        let app = makeApp()
        app.connection = CaveConnection(host: "http://cave.test:3000")

        let staleLoad = ControlledCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            contextStarted: contextStarted,
            contextRelease: contextRelease
        )

        let loadTask = Task { await app.loadProjectContext(using: staleLoad) }
        await contextStarted.wait()
        app.disconnect()

        await contextRelease.open()
        await loadTask.value

        XCTAssertNil(app.connection)
        XCTAssertNil(app.projectContext)
        XCTAssertTrue(app.projects.isEmpty)
        XCTAssertTrue(app.familiars.isEmpty)
        XCTAssertFalse(app.familiarsLoaded)
        XCTAssertFalse(app.projectMembershipLoaded)
    }

    func testNewerProjectContextLoadWinsOverStaleCompletion() async {
        let contextStarted = Gate()
        let contextRelease = Gate()
        let app = makeApp()
        let connection = connect(app)
        persistProjectContextSelection("project:beta", for: connection)

        let staleLoad = ControlledCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            contextStarted: contextStarted,
            contextRelease: contextRelease
        )

        let staleTask = Task { await app.loadProjectContext(using: staleLoad) }
        await contextStarted.wait()

        await app.loadProjectContext(using: client(
            projects: [project("beta", "Beta")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "sage", projectId: "beta", access: .write),
            ]),
            familiars: [familiar("sage", "Sage")]
        ))

        await contextRelease.open()
        await staleTask.value

        XCTAssertEqual(app.projectContext, .project(project("beta", "Beta")))
        XCTAssertEqual(app.projects.map(\.id), ["beta"])
        XCTAssertEqual(app.familiars.map(\.id), ["sage"])
        XCTAssertEqual(app.projectMembership.familiarIDs(forProjectID: "beta"), Set(["sage"]))
    }

    @MainActor
    func testLoadSessionsSingleFlightsOverlappingSameGenerationRequests() async {
        let sessionStarted = Gate()
        let sessionRelease = Gate()
        let client = ControlledCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("alpha-session", familiarId: "nova", projectRoot: "/repos/alpha")],
            sessionStarted: sessionStarted,
            sessionRelease: sessionRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in client })
        _ = connect(app, host: "http://127.0.0.1:1")

        let first = Task { await app.loadSessions() }
        let second = Task { await app.loadSessions() }
        await sessionStarted.wait()
        await sessionRelease.open()
        await first.value
        await second.value

        let calls = await client.callLog.snapshot()
        XCTAssertEqual(calls.sessions, 1)
        XCTAssertEqual(app.serverSessions.map(\.id), ["alpha-session"])
        XCTAssertTrue(app.sessionsLoaded)
        XCTAssertNil(app.sessionsError)
    }

    @MainActor
    func testLoadTasksSingleFlightsOverlappingSameGenerationRequests() async {
        let taskStarted = Gate()
        let taskRelease = Gate()
        let client = ControlledCoreClient(
            projects: [project("alpha", "Alpha")],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            tasks: [card("alpha-task", familiarId: "nova", projectId: "alpha")],
            taskStarted: taskStarted,
            taskRelease: taskRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in client })
        _ = connect(app, host: "http://127.0.0.1:1")

        let first = Task { await app.loadTasks() }
        let second = Task { await app.loadTasks() }
        await taskStarted.wait()
        await taskRelease.open()
        await first.value
        await second.value

        let calls = await client.callLog.snapshot()
        XCTAssertEqual(calls.tasks, 1)
        XCTAssertEqual(app.tasks.map(\.id), ["alpha-task"])
        XCTAssertTrue(app.tasksLoaded)
        XCTAssertNil(app.tasksError)
    }

    @MainActor
    func testNewerStandaloneSessionsLoadWinsOverOlderSuccessfulSessionSnapshotFallback() async {
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let taskStarted = Gate()
        let taskRelease = Gate()
        let staleLoad = ControlledCoreClient(
            projects: [alpha, beta],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
                ProjectGrant(familiarId: "nova", projectId: beta.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [],
            tasksResult: .failure(NSError(
                domain: "AppModelProjectContextTests",
                code: 81,
                userInfo: [NSLocalizedDescriptionKey: "Task history is offline"]
            )),
            taskStarted: taskStarted,
            taskRelease: taskRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in staleLoad })
        _ = connect(app, host: "http://127.0.0.1:1")

        let staleTask = Task { await app.loadProjectContext(using: staleLoad) }
        await taskStarted.wait()

        await app.loadSessions(using: client(
            projects: [alpha, beta],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("beta-session", familiarId: "nova", projectRoot: beta.root)]
        ))

        XCTAssertEqual(app.serverSessions.map(\.id), ["beta-session"])
        XCTAssertNil(app.projectContext)

        await taskRelease.open()
        await staleTask.value

        XCTAssertEqual(app.serverSessions.map(\.id), ["beta-session"])
        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.tasksError, "Task history is offline")
    }

    @MainActor
    func testNewerStandaloneSessionsLoadWinsOverOlderProjectContextSnapshot() async {
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let taskStarted = Gate()
        let taskRelease = Gate()
        let staleLoad = ControlledCoreClient(
            projects: [alpha, beta],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: "alpha", access: .write),
                ProjectGrant(familiarId: "nova", projectId: "beta", access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [],
            tasks: [card("alpha-task", familiarId: "nova", projectId: alpha.id)],
            taskStarted: taskStarted,
            taskRelease: taskRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in staleLoad })
        _ = connect(app, host: "http://127.0.0.1:1")

        let staleTask = Task { await app.loadProjectContext(using: staleLoad) }
        await taskStarted.wait()

        await app.loadSessions(using: client(
            projects: [alpha, beta],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            sessions: [session("beta-session", familiarId: "nova", projectRoot: beta.root)]
        ))

        XCTAssertEqual(app.serverSessions.map(\.id), ["beta-session"])

        await taskRelease.open()
        await staleTask.value

        XCTAssertEqual(app.serverSessions.map(\.id), ["beta-session"])
        XCTAssertEqual(app.projectContext, .project(beta))
    }

    @MainActor
    func testNewerStandaloneTasksLoadWinsOverOlderSuccessfulTaskSnapshot() async {
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let taskStarted = Gate()
        let taskRelease = Gate()
        let staleLoad = ControlledCoreClient(
            projects: [alpha, beta],
            grants: grants(grants: [
                ProjectGrant(familiarId: "nova", projectId: alpha.id, access: .write),
                ProjectGrant(familiarId: "nova", projectId: beta.id, access: .write),
            ]),
            familiars: [familiar("nova", "Nova")],
            sessions: [],
            tasks: [card("alpha-task", familiarId: "nova", projectId: alpha.id)],
            taskStarted: taskStarted,
            taskRelease: taskRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in staleLoad })
        _ = connect(app, host: "http://127.0.0.1:1")

        let staleTask = Task { await app.loadProjectContext(using: staleLoad) }
        await taskStarted.wait()

        await app.loadTasks(using: client(
            projects: [alpha, beta],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            tasks: [card("beta-task", familiarId: "nova", projectId: beta.id)]
        ))

        XCTAssertEqual(app.tasks.map(\.id), ["beta-task"])
        XCTAssertNil(app.projectContext)

        await taskRelease.open()
        await staleTask.value

        XCTAssertEqual(app.tasks.map(\.id), ["beta-task"])
        XCTAssertEqual(app.projectContext, .project(beta))
    }

    @MainActor
    func testLoadTasksPreservesInFlightMutationStateAcrossRefresh() async throws {
        let alpha = project("alpha", "Alpha")
        let task = card("recover-task", familiarId: "nova", projectId: nil)
        let projectUpdateStarted = Gate()
        let projectUpdateRelease = Gate()
        var movedResponse = task
        movedResponse.projectId = alpha.id
        let client = InterleavingTaskMutationClient(
            baseCard: task,
            projects: [alpha],
            grants: grants(),
            familiars: [familiar("nova", "Nova")],
            projectUpdateResult: .success(movedResponse),
            projectUpdateStarted: projectUpdateStarted,
            projectUpdateRelease: projectUpdateRelease
        )
        let app = makeApp(coreResourceClientFactory: { _ in client })
        _ = connect(app, host: "http://127.0.0.1:1")
        app.projects = [alpha]
        app.projectsLoaded = true
        app.tasks = [task]
        app.tasksLoaded = true
        app.projectContext = .unassigned

        let move = Task { await app.moveTaskToProject(task, project: alpha) }
        await projectUpdateStarted.wait()
        XCTAssertEqual(app.tasks.first?.projectId, alpha.id)

        await app.loadTasks(using: client)

        XCTAssertEqual(app.tasks.first?.projectId, alpha.id)

        await projectUpdateRelease.open()
        await move.value

        XCTAssertEqual(app.tasks.first?.projectId, alpha.id)
        XCTAssertNil(app.tasksError)
    }
}
