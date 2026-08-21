import Foundation
import Network
import Observation
#if canImport(UIKit)
import UIKit
#endif
import WidgetKit

/// The primary destinations. Lifted out of the drawer shell so slash commands
/// (`/board`, `/chats`) can drive selection from anywhere.
enum AppTab: String, CaseIterable, Sendable { case chats, tasks, settings }

extension AppTab {
    static let drawerDestinations: [AppTab] = [.chats, .tasks, .settings]
    static let shortcutOrder: [AppTab] = drawerDestinations

    /// Project search returns to the active project-scoped destination when it
    /// has one; settings falls back to Chats because it does not render
    /// project-scoped content of its own.
    var projectSearchReturnDestination: AppTab {
        switch self {
        case .settings:
            return .chats
        case .chats, .tasks:
            return self
        }
    }
}

/// One pending project-aware navigation request. Entity metadata always wins
/// over the advisory `projectId`, which mainly carries project-scoped deep
/// links until the catalog hydrates.
struct ProjectNavigationIntent: Equatable, Hashable, Sendable {
    enum Entity: Equatable, Hashable, Sendable {
        case thread(id: String)
        case task(id: String)
    }

    let entity: Entity?
    let destination: AppTab
    let projectId: String?

    init(entity: Entity? = nil, destination: AppTab, projectId: String? = nil) {
        self.entity = entity
        self.destination = destination
        self.projectId = Self.normalized(projectId)
    }

    var resolvedDestination: AppTab {
        switch entity {
        case .thread?: return .chats
        case .task?: return .tasks
        case nil: return destination
        }
    }

    var threadId: String? {
        guard case .thread(let id)? = entity else { return nil }
        return id
    }

    var taskId: String? {
        guard case .task(let id)? = entity else { return nil }
        return id
    }

    var targetDescription: String {
        if let threadId {
            return "chat \(threadId)"
        }
        if let taskId {
            return "task \(taskId)"
        }
        if let projectId {
            return "project \(projectId)"
        }
        return resolvedDestination.rawValue
    }

    var url: URL? {
        var components = URLComponents()
        components.scheme = "covencave"
        switch entity {
        case .thread(let id)?:
            components.host = "thread"
            components.path = "/" + id
        case .task(let id)?:
            components.host = "task"
            components.path = "/" + id
        case nil:
            if let projectId {
                guard resolvedDestination == .chats || resolvedDestination == .tasks else {
                    return nil
                }
                components.host = "project"
                components.path = "/\(projectId)/\(resolvedDestination.rawValue)"
            } else {
                guard resolvedDestination == .chats || resolvedDestination == .tasks else {
                    return nil
                }
                components.host = resolvedDestination.rawValue
            }
        }
        return components.url
    }

    init?(url: URL) {
        guard url.scheme == "covencave" else { return nil }
        let path = url.path
            .split(separator: "/", omittingEmptySubsequences: true)
            .map(String.init)

        switch url.host {
        case "thread":
            guard path.count == 1, let threadId = Self.normalized(path[0]) else { return nil }
            self = ProjectNavigationIntent(entity: .thread(id: threadId), destination: .chats)
        case "task":
            guard path.count == 1, let taskId = Self.normalized(path[0]) else { return nil }
            self = ProjectNavigationIntent(entity: .task(id: taskId), destination: .tasks)
        case "tasks":
            guard path.isEmpty else { return nil }
            self = ProjectNavigationIntent(destination: .tasks)
        case "chats":
            guard path.isEmpty else { return nil }
            self = ProjectNavigationIntent(destination: .chats)
        case "reminders":
            guard path.isEmpty else { return nil }
            self = ProjectNavigationIntent(destination: .tasks)
        case "project":
            guard path.count == 2,
                  let projectId = Self.normalized(path[0]),
                  let destination = AppTab(rawValue: path[1]),
                  destination == .chats || destination == .tasks else {
                return nil
            }
            self = ProjectNavigationIntent(destination: destination, projectId: projectId)
        default:
            return nil
        }
    }

    private static func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}

struct PairingIntent: Equatable {
    let id = UUID()
    let host: String
    let token: String?
}

enum PairingApprovalPolicy {
    static func requiresApproval(hasExistingPairing: Bool) -> Bool {
        hasExistingPairing
    }
}

enum PendingPairingProcessorPolicy {
    static func mayBegin(
        isLocked: Bool,
        isAuthenticating: Bool,
        isProcessing: Bool,
        isActive: Bool
    ) -> Bool {
        !isLocked && !isAuthenticating && !isProcessing && isActive
    }
}

/// The load-bearing project-context inputs AppModel needs from the desktop.
/// `CaveClient` already supplies these APIs; the protocol only gives tests a
/// small seam so they can pin fail-closed and cached-refresh behaviour without
/// a live desktop or a process-global URLProtocol shim.
protocol ProjectContextLoadingClient: Sendable {
    func projects() async throws -> [ProjectInfo]
    func projectGrants() async throws -> ProjectGrantsResponse
    func familiars() async throws -> [Familiar]
    func sessions() async throws -> [SessionRow]
    func tasks() async throws -> [BoardCard]
}

extension ProjectContextLoadingClient {
    func sessions() async throws -> [SessionRow] { [] }
    func tasks() async throws -> [BoardCard] { [] }
}

protocol AccessTokenRefreshingClient: Sendable {
    func refreshAccessToken() async -> String?
}

/// Lets task↔chat reconciliation patch a card's canonical `sessionId`
/// without forcing tests through a live desktop HTTP client.
protocol TaskSessionUpdatingClient: Sendable {
    func updateTaskSession(cardId: String, sessionId: String?) async throws -> BoardCard
}

/// Lets task detail/status mutations exercise their optimistic concurrency
/// paths in tests without a process-global URLProtocol shim.
protocol TaskFieldsUpdatingClient: Sendable {
    func updateTask(
        cardId: String,
        status: CardStatus?,
        priority: CardPriority?,
        steps: [CardStep]?,
        notes: String?
    ) async throws -> BoardCard
    func updateTaskTitle(cardId: String, title: String) async throws -> BoardCard
    func updateTaskDates(cardId: String, startDate: String?, endDate: String?) async throws -> BoardCard
}

/// Lets recovery flows reassign a task onto a registered project without
/// reaching for a process-global URLProtocol shim in tests.
protocol TaskProjectUpdatingClient: Sendable {
    func updateTaskProject(cardId: String, projectId: String) async throws -> BoardCard
}

protocol ReminderManagingClient: Sendable {
    func reminders() async throws -> [Reminder]
    func bulkInboxAction(_ action: String, ids: [String]) async throws -> CaveClient.BulkInboxOutcome
    func markReminderDone(id: String) async throws -> Reminder?
    func dismissReminder(id: String) async throws -> Reminder?
    func snoozeReminder(id: String, minutes: Int) async throws -> Reminder?
}

protocol ReminderNotificationScheduling: Sendable {
    func requestAuthorizationIfNeeded() async
    func sync(_ reminders: [Reminder]) async
}

private struct SystemReminderNotificationScheduler: ReminderNotificationScheduling {
    func requestAuthorizationIfNeeded() async {
        await ReminderNotifications.requestAuthorizationIfNeeded()
    }

    func sync(_ reminders: [Reminder]) async {
        await ReminderNotifications.sync(reminders)
    }
}

typealias AppModelCoreResourceClient =
    ProjectContextLoadingClient & CaveBootstrapClient & AccessTokenRefreshingClient

extension CaveClient: ProjectContextLoadingClient, AccessTokenRefreshingClient, @unchecked Sendable {}
extension CaveClient: TaskSessionUpdatingClient {}
extension CaveClient: TaskFieldsUpdatingClient {}
extension CaveClient: TaskProjectUpdatingClient {}
extension CaveClient: ReminderManagingClient {}

/// A transient confirmation banner shown over the chat after a command runs.
struct ToastMessage: Identifiable, Equatable {
    enum Style { case success, info, warning, error }
    let id = UUID()
    var text: String
    var systemImage: String
    var style: Style = .info
}

@Observable
@MainActor
final class AppModel {
    private struct ProjectNavigationHydrationToken: Equatable {
        let generation: UInt64?
        let requestId: UInt64
    }

    private struct ProjectNavigationHydrationState {
        var nextRequestId: UInt64 = 0
        var inFlight: ProjectNavigationHydrationToken?
    }

    private struct CoordinatedLoadToken: Equatable {
        let generation: UInt64?
        let requestId: UInt64
    }

    private struct CoordinatedLoadOutput<Value>: @unchecked Sendable {
        let result: Result<Value, any Error>
    }

    private struct CoordinatedLoadState<Value> {
        var nextRequestId: UInt64 = 0
        var freshest: CoordinatedLoadToken?
        var lastApplied: CoordinatedLoadToken?
        var inFlight: (
            token: CoordinatedLoadToken,
            task: Task<CoordinatedLoadOutput<Value>, Never>
        )?
    }

    nonisolated static let projectContextStorageKeyPrefix = "cave.project-context.v2"
    nonisolated static let legacyProjectContextStorageKey = "cave.project-context.v1"
    nonisolated static let unassignedProjectContextStorageValue = "unassigned"

    private enum ProjectContextSelectionSource: Sendable {
        case restored
        case automatic
        case user
    }

    nonisolated static func projectContextStorageKey(for connection: CaveConnection?) -> String? {
        guard let identity = projectContextStorageIdentity(for: connection) else { return nil }
        return "\(projectContextStorageKeyPrefix).\(identity)"
    }

    nonisolated private static func projectContextStorageIdentity(
        for connection: CaveConnection?
    ) -> String? {
        guard let connection else { return nil }
        if let baseURL = connection.baseURL,
           let origin = CaveConnection.credentialOrigin(for: baseURL),
           !origin.isEmpty {
            return origin
        }
        let normalizedHost = connection.host
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return normalizedHost.isEmpty ? nil : normalizedHost
    }

    enum ConnectionState: Equatable {
        case unconfigured
        case checking
        case connected
        /// The desktop answered, but the initial project-context bootstrap
        /// failed, so the shell stays gated behind an actionable retry state
        /// rather than reading as auth or transport failure.
        case projectContextRequired
        /// Discovery failed everywhere. Carries the classified diagnosis so
        /// the connect screen can say WHICH way it failed (DNS vs refused vs
        /// timeout…) instead of one generic shrug.
        case unreachable(ConnectionDiagnosis)
        /// The desktop answered but rejected our credential (401/403) — the
        /// device needs pairing, not a different address. Distinct from
        /// `unreachable` so onboarding can say what to actually do.
        case needsAuth(String)
    }

    var connection: CaveConnection?
    /// Stamped the moment the state LEAVES `.connected` — the last instant the
    /// desktop was known reachable — so the reconnect pill can say
    /// "last seen 2 min ago" honestly during a drop.
    private(set) var lastConnectedAt: Date?
    var connectionState: ConnectionState = .unconfigured {
        didSet {
            if oldValue == .connected, connectionState != .connected {
                lastConnectedAt = Date()
            }
            if oldValue != .connected, connectionState == .connected {
                connectedAt = Date()
            }
        }
    }
    /// Stamped each time the state ENTERS `.connected`. RootView uses it to
    /// show a brief "Connected" confirmation over the freshly mounted shell
    /// when pairing just succeeded, so the connect screen's success isn't an
    /// abrupt teleport.
    private(set) var connectedAt: Date?
    private let connectionMonitor = NWPathMonitor()
    private let connectionMonitorQueue = DispatchQueue(label: "ai.opencoven.cave.connection-monitor")
    private var connectionMonitorStarted = false
    /// Single-flight for `refreshConnection`: overlapping reconnect signals
    /// (foreground probe, path monitor, pill tap, retry tickers) collapse
    /// into one discovery sweep instead of stacking probes.
    @ObservationIgnored private let refreshCoordinator = ConnectionRefreshCoordinator()

    var familiars: [Familiar] = []
    var familiarsError: String?
    var familiarsLoaded = false
    /// User's preferred familiar order (ids), applied over the server's order
    /// and persisted locally. Unknown/new familiars fall to the end.

    var threads: [ChatThread] = []
    /// Default Chats destination: the newest active conversation. Pinning only
    /// affects list order and never makes an older thread the launch default.
    var mostRecentThread: ChatThread? {
        threads
            .filter { !$0.archived }
            .max { $0.updatedAt < $1.updatedAt }
    }
    /// One pending project-aware open. Cold deep links keep this alive until
    /// their threads/tasks and any required project catalog data hydrate; it
    /// clears only after the resolver has published the final open request.
    var pendingProjectNavigationIntent: ProjectNavigationIntent?
    @ObservationIgnored private var lastProjectNavigationFailure: ProjectNavigationFailureState?
    @ObservationIgnored private var projectNavigationProjectsHydration = ProjectNavigationHydrationState()
    @ObservationIgnored private var projectNavigationSessionsHydration = ProjectNavigationHydrationState()
    @ObservationIgnored private var projectNavigationTasksHydration = ProjectNavigationHydrationState()

    /// Messages whose agent-activity trail the reader has opened.
    ///
    /// Deliberately not view-local `@State`: a transcript rebuild re-creates
    /// the row, and state that lives on the row goes with it — silently
    /// collapsing a trail the reader had just opened (cave-m5tao). Holding the
    /// choice here means a re-created row re-reads it and stays open. In-memory
    /// only; expansion is a reading position, not something to persist.
    var expandedActivityMessages: Set<String> = []

    #if DEBUG
    /// Process-lifetime marker for the deterministic cold-connection preview.
    /// The app lifecycle uses it to skip only live connection work.
    var isConnectingPreview = false
    #endif

    // MARK: - Cross-view command routing

    /// The selected primary destination. Mounted by `MainShellView`; set by
    /// drawer actions, deep links, and `/board` / `/chats`.
    var selectedTab: AppTab = {
        #if DEBUG
        // Snapshot hook: `simctl launch … --ui-tab settings` boots straight
        // into a destination for screenshot automation.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--ui-tab"), i + 1 < args.count,
           let tab = AppTab(rawValue: args[i + 1]) {
            return tab
        }
        #endif
        return .chats
    }()

    /// A thread the central resolver asked Chats to open. `ChatsHomeView`
    /// observes this, pushes the thread, and clears it back to nil.
    var threadToOpen: ChatThread?

    /// A task the central resolver asked Tasks to open. `TasksView` observes
    /// this, pushes the card, and clears it (mirrors `threadToOpen`).
    var cardToOpen: BoardCard?

    /// Global Claude Design navigation. Any top-level surface can open the
    /// shared drawer; one-shot requests let its Search/Chat actions hand off to
    /// the Chats split view without coupling the drawer to local view state.
    var navigationDrawerOpen: Bool = {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("--ui-open-drawer")
        #else
        return false
        #endif
    }()
    var newChatRequested = false
    var chatSearchRequested = false

    /// The active confirmation toast, auto-dismissed by the overlay.
    var toast: ToastMessage?

    /// Show a confirmation toast (replaces any in-flight one).
    func showToast(_ text: String, systemImage: String = "checkmark.circle.fill",
                   style: ToastMessage.Style = .success) {
        toast = ToastMessage(text: text, systemImage: systemImage, style: style)
    }

    /// An optimistic edit failed and was reverted: surface a single error toast
    /// + error haptic so the change doesn't silently snap back. Callers still set
    /// their `*Error` string for any inline display.
    private func reportRevert(_ what: String) {
        showToast("Couldn’t \(what) — reverted", systemImage: "exclamationmark.triangle.fill", style: .error)
        Haptics.error()
    }

    /// A batch that partly landed (cave-ioswipe.2). Says how many of how many
    /// failed, because the old wholesale "reverted" message was actively
    /// misleading here: most of the batch DID take effect server-side, and only
    /// the named few came back.
    private func reportPartial(_ failed: Int, of total: Int, verb: String) {
        showToast(
            "Couldn’t \(verb) \(failed) of \(total) — those were restored",
            systemImage: "exclamationmark.triangle.fill",
            style: .error,
        )
        Haptics.error()
    }

    private func reportDeletePartial(restoredThreads: Int, failedSessions: Int, totalSessions: Int) {
        let chats = "\(restoredThreads) chat\(restoredThreads == 1 ? "" : "s")"
        let sessions = "\(failedSessions) of \(totalSessions) server session\(totalSessions == 1 ? "" : "s")"
        showToast(
            "Restored \(chats) — couldn’t delete \(sessions)",
            systemImage: "exclamationmark.triangle.fill",
            style: .error,
        )
        Haptics.error()
    }

    enum ThreadOpenFailure: Error, Equatable {
        case projectCatalogUnavailable
        case invalidProjectMetadata

        var toastText: String {
            switch self {
            case .projectCatalogUnavailable:
                return "Refresh Chats to load project context, then try again."
            case .invalidProjectMetadata:
                return "This chat’s project metadata could not be resolved. Refresh Chats or reopen it on your desktop, then try again."
            }
        }

        var systemImage: String {
            switch self {
            case .projectCatalogUnavailable:
                return "arrow.clockwise"
            case .invalidProjectMetadata:
                return "folder.badge.questionmark"
            }
        }
    }

    enum TaskOpenFailure: Error, Equatable {
        case projectCatalogUnavailable
        case invalidProjectMetadata

        var toastText: String {
            switch self {
            case .projectCatalogUnavailable:
                return "Refresh Chats to load project context, then try again."
            case .invalidProjectMetadata:
                return "This task is no longer linked to a registered project. Refresh Tasks or reassign it on your desktop, then try again."
            }
        }

        var systemImage: String {
            switch self {
            case .projectCatalogUnavailable:
                return "arrow.clockwise"
            case .invalidProjectMetadata:
                return "folder.badge.questionmark"
            }
        }
    }

    private enum ProjectDestinationFailure: Error, Equatable {
        case projectCatalogUnavailable
        case unknownProject

        var toastText: String {
            switch self {
            case .projectCatalogUnavailable:
                return "Refresh Chats to load project context, then try again."
            case .unknownProject:
                return "This project is no longer registered on this device. Refresh Chats or choose another project, then try again."
            }
        }

        var systemImage: String {
            switch self {
            case .projectCatalogUnavailable:
                return "arrow.clockwise"
            case .unknownProject:
                return "folder.badge.questionmark"
            }
        }
    }

    private struct ProjectNavigationFailure: Equatable {
        let toastText: String
        let systemImage: String

        static let threadUnavailable = ProjectNavigationFailure(
            toastText: "This chat is not available on this device yet. Refresh Chats and try again.",
            systemImage: "bubble.left.and.exclamationmark.bubble.right"
        )
        static let taskUnavailable = ProjectNavigationFailure(
            toastText: "This task is not available on this device yet. Refresh Tasks and try again.",
            systemImage: "checklist"
        )
    }

    private struct ProjectNavigationFailureState: Equatable {
        let intent: ProjectNavigationIntent
        let failure: ProjectNavigationFailure
    }

    private enum ProjectNavigationResolution {
        case resolved
        case pending
        case failed(ProjectNavigationFailure)
    }

    private enum ProjectNavigationSurface: Sendable {
        case projects
        case sessions
        case tasks

        var retryInstruction: String {
            switch self {
            case .projects, .sessions:
                return "Refresh Chats or reconnect, then try again."
            case .tasks:
                return "Refresh Tasks or reconnect, then try again."
            }
        }

        var loadDescription: String {
            switch self {
            case .projects:
                return "project context"
            case .sessions:
                return "Chats"
            case .tasks:
                return "Tasks"
            }
        }

        var failureSystemImage: String {
            switch self {
            case .projects:
                return "folder.badge.questionmark"
            case .sessions:
                return "bubble.left.and.exclamationmark.bubble.right"
            case .tasks:
                return "checklist"
            }
        }
    }

    private func currentProjectNavigationConnectionGeneration() -> UInt64? {
        guard connection != nil else { return nil }
        if projectNavigationConnectionGeneration == 0 {
            projectNavigationConnectionGeneration = 1
        }
        return projectNavigationConnectionGeneration
    }

    private func advanceProjectNavigationConnectionGeneration() {
        projectNavigationConnectionGeneration = projectNavigationConnectionGeneration == 0
            ? 1
            : projectNavigationConnectionGeneration &+ 1
        projectNavigationKnownGoodConnectionGeneration = nil
        invalidateProjectNavigationHydrations()
    }

    /// Configured project roots used by chat creation and project browsing.
    var projects: [ProjectInfo] = []
    var projectsError: String?
    var projectsLoaded = false

    private func markProjectNavigationConnectionKnownGood(generation: UInt64?) {
        guard let generation else { return }
        projectNavigationKnownGoodConnectionGeneration = generation
    }

    private func noteProjectNavigationSurfaceAttempt(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?
    ) {
        guard let generation else { return }
        clearProjectNavigationFailureToast(matching: lastProjectNavigationFailure)
        lastProjectNavigationFailure = nil
        clearProjectNavigationSurfaceFailure(surface, generation: generation)
        switch surface {
        case .projects:
            projectNavigationProjectsAttemptGeneration = generation
        case .sessions:
            projectNavigationSessionsAttemptGeneration = generation
        case .tasks:
            projectNavigationTasksAttemptGeneration = generation
        }
    }

    private func noteProjectNavigationSurfaceSuccess(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?
    ) {
        guard let generation else { return }
        markProjectNavigationConnectionKnownGood(generation: generation)
        clearProjectNavigationSurfaceFailure(surface, generation: generation)
        switch surface {
        case .projects:
            projectNavigationProjectsSuccessGeneration = generation
        case .sessions:
            projectNavigationSessionsSuccessGeneration = generation
        case .tasks:
            projectNavigationTasksSuccessGeneration = generation
        }
    }

    private func noteProjectNavigationSurfaceFailure(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?
    ) {
        guard let generation else { return }
        switch surface {
        case .projects:
            if projectNavigationProjectsAttemptGeneration == generation {
                projectNavigationProjectsAttemptGeneration = nil
            }
            if projectNavigationProjectsSuccessGeneration == generation {
                projectNavigationProjectsSuccessGeneration = nil
            }
            projectNavigationProjectsFailureGeneration = generation
        case .sessions:
            if projectNavigationSessionsAttemptGeneration == generation {
                projectNavigationSessionsAttemptGeneration = nil
            }
            if projectNavigationSessionsSuccessGeneration == generation {
                projectNavigationSessionsSuccessGeneration = nil
            }
            projectNavigationSessionsFailureGeneration = generation
        case .tasks:
            if projectNavigationTasksAttemptGeneration == generation {
                projectNavigationTasksAttemptGeneration = nil
            }
            if projectNavigationTasksSuccessGeneration == generation {
                projectNavigationTasksSuccessGeneration = nil
            }
            projectNavigationTasksFailureGeneration = generation
        }
    }

    private func clearProjectNavigationSurfaceFailure(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?
    ) {
        guard let generation else { return }
        switch surface {
        case .projects:
            if projectNavigationProjectsFailureGeneration == generation {
                projectNavigationProjectsFailureGeneration = nil
            }
        case .sessions:
            if projectNavigationSessionsFailureGeneration == generation {
                projectNavigationSessionsFailureGeneration = nil
            }
        case .tasks:
            if projectNavigationTasksFailureGeneration == generation {
                projectNavigationTasksFailureGeneration = nil
            }
        }
    }

    private func invalidateProjectNavigationHydrations() {
        projectNavigationProjectsHydration.inFlight = nil
        projectNavigationSessionsHydration.inFlight = nil
        projectNavigationTasksHydration.inFlight = nil
    }

    private func beginProjectNavigationHydration(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?
    ) -> ProjectNavigationHydrationToken {
        switch surface {
        case .projects:
            return beginProjectNavigationHydration(
                &projectNavigationProjectsHydration,
                generation: generation
            )
        case .sessions:
            return beginProjectNavigationHydration(
                &projectNavigationSessionsHydration,
                generation: generation
            )
        case .tasks:
            return beginProjectNavigationHydration(
                &projectNavigationTasksHydration,
                generation: generation
            )
        }
    }

    private func beginProjectNavigationHydration(
        _ state: inout ProjectNavigationHydrationState,
        generation: UInt64?
    ) -> ProjectNavigationHydrationToken {
        state.nextRequestId &+= 1
        let token = ProjectNavigationHydrationToken(
            generation: generation,
            requestId: state.nextRequestId
        )
        state.inFlight = token
        return token
    }

    @discardableResult
    private func finishProjectNavigationHydration(
        _ surface: ProjectNavigationSurface,
        token: ProjectNavigationHydrationToken
    ) -> Bool {
        switch surface {
        case .projects:
            return finishProjectNavigationHydration(
                token,
                state: &projectNavigationProjectsHydration
            )
        case .sessions:
            return finishProjectNavigationHydration(
                token,
                state: &projectNavigationSessionsHydration
            )
        case .tasks:
            return finishProjectNavigationHydration(
                token,
                state: &projectNavigationTasksHydration
            )
        }
    }

    @discardableResult
    private func finishProjectNavigationHydration(
        _ token: ProjectNavigationHydrationToken,
        state: inout ProjectNavigationHydrationState
    ) -> Bool {
        guard state.inFlight == token else { return true }
        state.inFlight = nil
        return false
    }

    private func projectNavigationSurfaceAttemptedCurrentGeneration(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?
    ) -> Bool {
        guard let generation else { return false }
        switch surface {
        case .projects:
            return projectNavigationProjectsAttemptGeneration == generation
        case .sessions:
            return projectNavigationSessionsAttemptGeneration == generation
        case .tasks:
            return projectNavigationTasksAttemptGeneration == generation
        }
    }

    private func projectNavigationSurfaceSucceededCurrentGeneration(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?
    ) -> Bool {
        guard let generation else { return false }
        switch surface {
        case .projects:
            return projectNavigationProjectsSuccessGeneration == generation
        case .sessions:
            return projectNavigationSessionsSuccessGeneration == generation
        case .tasks:
            return projectNavigationTasksSuccessGeneration == generation
        }
    }

    private func projectNavigationSurfaceFailedCurrentGeneration(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?
    ) -> Bool {
        guard let generation else { return false }
        switch surface {
        case .projects:
            return projectNavigationProjectsFailureGeneration == generation
        case .sessions:
            return projectNavigationSessionsFailureGeneration == generation
        case .tasks:
            return projectNavigationTasksFailureGeneration == generation
        }
    }

    private func projectNavigationSurfaceHydratingCurrentGeneration(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?
    ) -> Bool {
        guard let generation else { return false }
        switch surface {
        case .projects:
            return projectNavigationProjectsHydration.inFlight?.generation == generation
        case .sessions:
            return projectNavigationSessionsHydration.inFlight?.generation == generation
        case .tasks:
            return projectNavigationTasksHydration.inFlight?.generation == generation
        }
    }

    private func isProjectNavigationConnectionKnownGood(generation: UInt64?) -> Bool {
        guard let generation else { return false }
        return projectNavigationKnownGoodConnectionGeneration == generation
    }

    private func projectNavigationLoadStillCurrent(generation: UInt64?) -> Bool {
        guard let generation else { return true }
        return currentProjectNavigationConnectionGeneration() == generation
    }

    private func beginCoordinatedLoad<Value>(
        _ state: inout CoordinatedLoadState<Value>,
        generation: UInt64?,
        operation: @escaping @Sendable () async throws -> Value
    ) -> (
        token: CoordinatedLoadToken,
        task: Task<CoordinatedLoadOutput<Value>, Never>
    ) {
        if let inFlight = state.inFlight,
           inFlight.token.generation == generation {
            return inFlight
        }

        state.nextRequestId &+= 1
        let token = CoordinatedLoadToken(
            generation: generation,
            requestId: state.nextRequestId
        )
        state.freshest = token
        let task = Task {
            CoordinatedLoadOutput(
                result: await Result.capturing { try await operation() }
            )
        }
        let handle = (token: token, task: task)
        state.inFlight = handle
        return handle
    }

    private func finishCoordinatedLoad<Value>(
        _ handle: (
            token: CoordinatedLoadToken,
            task: Task<CoordinatedLoadOutput<Value>, Never>
        ),
        state: inout CoordinatedLoadState<Value>
    ) {
        guard state.inFlight?.token == handle.token else { return }
        state.inFlight = nil
    }

    private func coordinatedLoadShouldApply<Value>(
        _ token: CoordinatedLoadToken,
        state: CoordinatedLoadState<Value>
    ) -> Bool {
        coordinatedLoadIsCurrentFreshest(token, state: state)
            && state.lastApplied != token
    }

    private func coordinatedLoadIsCurrentFreshest<Value>(
        _ token: CoordinatedLoadToken,
        state: CoordinatedLoadState<Value>
    ) -> Bool {
        projectNavigationLoadStillCurrent(generation: token.generation)
            && state.freshest == token
    }

    private func coordinatedSelectionSnapshotIsCurrentFreshest<Value>(
        _ token: CoordinatedLoadToken?,
        state: CoordinatedLoadState<Value>
    ) -> Bool {
        guard let token else { return true }
        return coordinatedLoadIsCurrentFreshest(token, state: state)
    }

    private func markCoordinatedLoadApplied<Value>(
        _ token: CoordinatedLoadToken,
        state: inout CoordinatedLoadState<Value>
    ) {
        state.lastApplied = token
    }

    private func coordinatedSessionsLoad(
        using client: any ProjectContextLoadingClient,
        generation: UInt64?
    ) async -> (
        token: CoordinatedLoadToken,
        result: Result<[SessionRow], any Error>
    ) {
        let handle = beginCoordinatedLoad(&sessionsLoadState, generation: generation) {
            try await client.sessions()
        }
        let output = await handle.task.value
        finishCoordinatedLoad(handle, state: &sessionsLoadState)
        return (handle.token, output.result)
    }

    private func coordinatedTasksLoad(
        using client: any ProjectContextLoadingClient,
        generation: UInt64?
    ) async -> (
        token: CoordinatedLoadToken,
        result: Result<[BoardCard], any Error>
    ) {
        let handle = beginCoordinatedLoad(&tasksLoadState, generation: generation) {
            try await client.tasks()
        }
        let output = await handle.task.value
        finishCoordinatedLoad(handle, state: &tasksLoadState)
        return (handle.token, output.result)
    }

    private func projectNavigationThread(
        for navigationID: String,
        generation: UInt64?
    ) -> ChatThread? {
        let trimmedNavigationID = navigationID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedNavigationID.isEmpty else { return nil }
        if let thread = threads.first(where: { $0.id == trimmedNavigationID }) {
            return thread
        }

        if connection != nil {
            guard projectNavigationSurfaceSucceededCurrentGeneration(.sessions, generation: generation)
            else { return nil }
        } else if !sessionsLoaded {
            return nil
        }

        guard let row = serverSessions.first(where: {
            normalizedSessionID($0.id) == trimmedNavigationID
        }),
        let familiarId = authoritativeFamiliarID(from: row, fallback: nil) else {
            return nil
        }
        return openServerSession(row, familiarId: familiarId)
    }

    private func projectNavigationIntentNeedsHydration(
        _ surface: ProjectNavigationSurface,
        for intent: ProjectNavigationIntent
    ) -> Bool {
        switch surface {
        case .projects:
            return intent.projectId != nil || intent.entity != nil
        case .sessions:
            return intent.threadId != nil
        case .tasks:
            return intent.taskId != nil
        }
    }

    private func revisitPendingProjectNavigation(
        afterStaleHydration surface: ProjectNavigationSurface
    ) {
        guard let intent = pendingProjectNavigationIntent,
              projectNavigationIntentNeedsHydration(surface, for: intent),
              let generation = currentProjectNavigationConnectionGeneration() else { return }
        let shouldHydrate = isProjectNavigationConnectionKnownGood(generation: generation)
            && !projectNavigationSurfaceAttemptedCurrentGeneration(
                surface,
                generation: generation
            )
            && !projectNavigationSurfaceSucceededCurrentGeneration(
                surface,
                generation: generation
            )
            && !projectNavigationSurfaceFailedCurrentGeneration(
                surface,
                generation: generation
            )
            && !projectNavigationSurfaceHydratingCurrentGeneration(
                surface,
                generation: generation
            )
        _ = resolvePendingProjectNavigationIntent(
            attemptHydrationIfNeeded: shouldHydrate
        )
    }

    private func launchProjectNavigationHydration(
        _ surface: ProjectNavigationSurface,
        generation: UInt64?,
        operation: @escaping @MainActor (AppModel) async -> Void
    ) {
        let token = beginProjectNavigationHydration(surface, generation: generation)
        Task { @MainActor [weak self] in
            guard let self else { return }
            await operation(self)
            let stoodDownStale = finishProjectNavigationHydration(
                surface,
                token: token
            )
            if stoodDownStale {
                revisitPendingProjectNavigation(afterStaleHydration: surface)
            }
        }
    }

    private func requestOpenContext(for thread: ChatThread) -> Result<ProjectContext, ThreadOpenFailure> {
        guard let projectRoot = thread.projectRoot?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !projectRoot.isEmpty else {
            return .success(.unassigned)
        }
        guard projectsLoaded || !projects.isEmpty else {
            return .failure(.projectCatalogUnavailable)
        }
        guard let context = ProjectContext.openContext(for: projectRoot, in: projects) else {
            return .failure(.invalidProjectMetadata)
        }
        return .success(context)
    }

    private func requestOpenContext(for card: BoardCard) -> Result<ProjectContext, TaskOpenFailure> {
        guard let rawProjectId = card.projectId else {
            return .success(.unassigned)
        }
        let projectId = rawProjectId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !projectId.isEmpty else { return .success(.unassigned) }
        guard projectId == rawProjectId else {
            return .failure(.invalidProjectMetadata)
        }
        guard projectsLoaded || !projects.isEmpty else {
            return .failure(.projectCatalogUnavailable)
        }
        guard let project = project(projectId) else {
            return .success(.unassigned)
        }
        return .success(.project(project))
    }

    private func requestOpenContext(
        forProjectID projectId: String?
    ) -> Result<ProjectContext?, ProjectDestinationFailure> {
        guard let projectId = projectId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !projectId.isEmpty else {
            return .success(nil)
        }
        guard projectsLoaded || !projects.isEmpty else {
            return .failure(.projectCatalogUnavailable)
        }
        guard let project = project(projectId) else {
            return .failure(.unknownProject)
        }
        return .success(.project(project))
    }

    func validatedOpenContext(for thread: ChatThread) -> ProjectContext? {
        switch requestOpenContext(for: thread) {
        case .success(let context):
            return context
        case .failure:
            return nil
        }
    }

    func canOpen(_ thread: ChatThread) -> Bool {
        validatedOpenContext(for: thread) != nil
    }

    func threadOpenFailure(for thread: ChatThread) -> ThreadOpenFailure? {
        switch requestOpenContext(for: thread) {
        case .success:
            return nil
        case .failure(let failure):
            return failure
        }
    }

    private func reportProjectNavigationFailure(
        _ failure: ProjectNavigationFailure,
        for intent: ProjectNavigationIntent
    ) {
        let state = ProjectNavigationFailureState(intent: intent, failure: failure)
        guard lastProjectNavigationFailure != state else { return }
        lastProjectNavigationFailure = state
        showToast(
            failure.toastText,
            systemImage: failure.systemImage,
            style: .warning
        )
    }

    private func clearProjectNavigationFailureToast(
        matching state: ProjectNavigationFailureState?
    ) {
        guard let state, state.intent == pendingProjectNavigationIntent, let toast else { return }
        guard toast.style == .warning,
              toast.text == state.failure.toastText,
              toast.systemImage == state.failure.systemImage else { return }
        self.toast = nil
    }

    private func hydrateProjectNavigationIfNeeded(for intent: ProjectNavigationIntent) {
        let generation = currentProjectNavigationConnectionGeneration()
        let canHydrateRemotely = isProjectNavigationConnectionKnownGood(generation: generation)

        if canHydrateRemotely,
           projectNavigationIntentNeedsHydration(.projects, for: intent),
           !projectNavigationSurfaceAttemptedCurrentGeneration(.projects, generation: generation),
           !projectNavigationSurfaceHydratingCurrentGeneration(.projects, generation: generation),
           coreResourceClient != nil {
            launchProjectNavigationHydration(.projects, generation: generation) { app in
                await app.loadProjects()
            }
        }

        if canHydrateRemotely,
           projectNavigationIntentNeedsHydration(.sessions, for: intent),
           !projectNavigationSurfaceAttemptedCurrentGeneration(.sessions, generation: generation),
           !projectNavigationSurfaceHydratingCurrentGeneration(.sessions, generation: generation),
           sessionLoadingClient != nil {
            launchProjectNavigationHydration(.sessions, generation: generation) { app in
                await app.loadSessions()
            }
        }

        if canHydrateRemotely,
           projectNavigationIntentNeedsHydration(.tasks, for: intent),
           !projectNavigationSurfaceAttemptedCurrentGeneration(.tasks, generation: generation),
           !projectNavigationSurfaceHydratingCurrentGeneration(.tasks, generation: generation),
           taskLoadingClient != nil {
            launchProjectNavigationHydration(.tasks, generation: generation) { app in
                await app.loadTasks()
            }
        }
    }

    @discardableResult
    private func beginProjectNavigation(_ intent: ProjectNavigationIntent) -> Bool {
        pendingProjectNavigationIntent = intent
        lastProjectNavigationFailure = nil
        return resolvePendingProjectNavigationIntent(attemptHydrationIfNeeded: true)
    }

    @discardableResult
    func resolvePendingProjectNavigationIntent(
        attemptHydrationIfNeeded: Bool = false
    ) -> Bool {
        guard let intent = pendingProjectNavigationIntent else { return false }
        if attemptHydrationIfNeeded {
            hydrateProjectNavigationIfNeeded(for: intent)
        }
        switch resolveProjectNavigation(intent) {
        case .resolved:
            clearProjectNavigationFailureToast(matching: lastProjectNavigationFailure)
            pendingProjectNavigationIntent = nil
            lastProjectNavigationFailure = nil
            return true
        case .pending:
            return false
        case .failed(let failure):
            reportProjectNavigationFailure(failure, for: intent)
            return false
        }
    }

    private func projectNavigationHydrationFailure(
        _ surface: ProjectNavigationSurface,
        for intent: ProjectNavigationIntent
    ) -> ProjectNavigationFailure {
        ProjectNavigationFailure(
            toastText: "Couldn’t load \(surface.loadDescription) while opening \(intent.targetDescription). \(surface.retryInstruction)",
            systemImage: surface.failureSystemImage
        )
    }

    private func resolveProjectNavigation(_ intent: ProjectNavigationIntent) -> ProjectNavigationResolution {
        let navigationGeneration = currentProjectNavigationConnectionGeneration()

        switch intent.entity {
        case .thread(let threadId)?:
            guard let thread = projectNavigationThread(
                for: threadId,
                generation: navigationGeneration
            ) else {
                if navigationGeneration != nil {
                    if projectNavigationSurfaceFailedCurrentGeneration(
                        .sessions,
                        generation: navigationGeneration
                    ) {
                        return .failed(projectNavigationHydrationFailure(.sessions, for: intent))
                    }
                    return (threadsHydrated
                        && projectNavigationSurfaceSucceededCurrentGeneration(
                            .sessions,
                            generation: navigationGeneration
                        ))
                        ? .failed(.threadUnavailable)
                        : .pending
                }
                return threadsHydrated ? .failed(.threadUnavailable) : .pending
            }
            if navigationGeneration != nil,
               thread.projectRoot?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
               projectNavigationSurfaceFailedCurrentGeneration(
                .projects,
                generation: navigationGeneration
               ) {
                return .failed(projectNavigationHydrationFailure(.projects, for: intent))
            }
            if navigationGeneration != nil,
               thread.projectRoot?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
               !projectNavigationSurfaceSucceededCurrentGeneration(
                .projects,
                generation: navigationGeneration
               ) {
                return .pending
            }
            switch requestOpenContext(for: thread) {
            case .success(let context):
                completeProjectNavigation(intent, context: context, thread: thread)
                return .resolved
            case .failure(.projectCatalogUnavailable):
                return .pending
            case .failure(let failure):
                return .failed(ProjectNavigationFailure(
                    toastText: failure.toastText,
                    systemImage: failure.systemImage
                ))
            }

        case .task(let taskId)?:
            if navigationGeneration != nil,
               projectNavigationSurfaceFailedCurrentGeneration(
                .tasks,
                generation: navigationGeneration
               ) {
                return .failed(projectNavigationHydrationFailure(.tasks, for: intent))
            }
            if navigationGeneration != nil,
               !projectNavigationSurfaceSucceededCurrentGeneration(
                .tasks,
                generation: navigationGeneration
               ) {
                return .pending
            }
            guard let card = tasks.first(where: { $0.id == taskId }) else {
                if navigationGeneration != nil {
                    return projectNavigationSurfaceSucceededCurrentGeneration(
                        .tasks,
                        generation: navigationGeneration
                    ) ? .failed(.taskUnavailable) : .pending
                }
                return tasksLoaded ? .failed(.taskUnavailable) : .pending
            }
            if navigationGeneration != nil,
               card.projectId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
               projectNavigationSurfaceFailedCurrentGeneration(
                .projects,
                generation: navigationGeneration
               ) {
                return .failed(projectNavigationHydrationFailure(.projects, for: intent))
            }
            if navigationGeneration != nil,
               card.projectId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
               !projectNavigationSurfaceSucceededCurrentGeneration(
                .projects,
                generation: navigationGeneration
               ) {
                return .pending
            }
            switch requestOpenContext(for: card) {
            case .success(let context):
                completeProjectNavigation(intent, context: context, card: card)
                return .resolved
            case .failure(.projectCatalogUnavailable):
                return .pending
            case .failure(let failure):
                return .failed(ProjectNavigationFailure(
                    toastText: failure.toastText,
                    systemImage: failure.systemImage
                ))
            }

        case nil:
            if navigationGeneration != nil,
               projectNavigationSurfaceFailedCurrentGeneration(
                .projects,
                generation: navigationGeneration
               ) {
                return .failed(projectNavigationHydrationFailure(.projects, for: intent))
            }
            if navigationGeneration != nil,
               !projectNavigationSurfaceSucceededCurrentGeneration(
                .projects,
                generation: navigationGeneration
               ) {
                return .pending
            }
            switch requestOpenContext(forProjectID: intent.projectId) {
            case .success(let context):
                completeProjectNavigation(intent, context: context)
                return .resolved
            case .failure(.projectCatalogUnavailable):
                return .pending
            case .failure(let failure):
                return .failed(ProjectNavigationFailure(
                    toastText: failure.toastText,
                    systemImage: failure.systemImage
                ))
            }
        }
    }

    private func completeProjectNavigation(
        _ intent: ProjectNavigationIntent,
        context: ProjectContext?,
        thread: ChatThread? = nil,
        card: BoardCard? = nil
    ) {
        let didSwitchProject = context.map { $0.id != projectContext?.id } ?? false
        if let context, didSwitchProject {
            switchProject(to: context)
        }
        selectedTab = intent.resolvedDestination
        if let thread {
            threadToOpen = thread
        }
        if let card {
            cardToOpen = card
        }
        if didSwitchProject, let context {
            announceProjectNavigationSwitch(to: context, for: intent)
        }
    }

    private func announceProjectNavigationSwitch(
        to context: ProjectContext,
        for intent: ProjectNavigationIntent
    ) {
        let announcement: String
        switch intent.entity {
        case .thread?:
            announcement = "Opened chat in \(context.displayName)"
        case .task?:
            announcement = "Opened task in \(context.displayName)"
        case nil:
            announcement = "Switched to \(context.displayName)"
        }
#if canImport(UIKit)
        UIAccessibility.post(notification: .announcement, argument: announcement)
#endif
    }

    /// Ask the chat list to open a thread, first aligning the canonical app
    /// project context that owns it.
    @discardableResult
    func requestOpen(_ thread: ChatThread) -> Bool {
        beginProjectNavigation(ProjectNavigationIntent(
            entity: .thread(id: thread.id),
            destination: .chats,
            projectId: projectContext(for: thread).projectId
        ))
    }
    /// Switch the visible conversation to one chosen in the session picker.
    ///
    /// Re-choosing the conversation already open is a no-op: routing it through
    /// `requestOpen` would tear down and rebuild the very chat being looked at,
    /// losing scroll position for no gain. Returns whether a switch was
    /// actually requested, so the caller can skip its haptic when nothing moved.
    @discardableResult
    func switchConversation(to chosen: ChatThread, currentThreadId: String?) -> Bool {
        guard chosen.id != currentThreadId else { return false }
        return requestOpen(chosen)
    }

    /// Ask the Tasks destination to open a card's detail (selects Tasks first).
    @discardableResult
    func requestOpenTask(_ card: BoardCard) -> Bool {
        beginProjectNavigation(ProjectNavigationIntent(
            entity: .task(id: card.id),
            destination: .tasks,
            projectId: card.projectId
        ))
    }

    @discardableResult
    func requestOpenDestination(_ destination: AppTab, projectId: String? = nil) -> Bool {
        beginProjectNavigation(ProjectNavigationIntent(
            destination: destination,
            projectId: projectId
        ))
    }

    @discardableResult
    func requestOpenProjectSearchResult(_ project: ProjectInfo) -> Bool {
        requestOpenDestination(selectedTab.projectSearchReturnDestination, projectId: project.id)
    }

    @discardableResult
    func requestOpenServerSession(
        _ row: SessionRow,
        fallbackFamiliarId: String? = nil,
        loadHistory shouldLoadHistory: Bool = true
    ) -> Bool {
        guard let familiarId = authoritativeFamiliarID(from: row, fallback: fallbackFamiliarId)
            ?? fallbackFamiliarId
            ?? row.familiarId
        else {
            showToast(
                "Refresh Chats to load this chat, then try again.",
                systemImage: "arrow.clockwise",
                style: .warning
            )
            return false
        }

        let thread = openServerSession(row, familiarId: familiarId, loadHistory: shouldLoadHistory)
        return requestOpen(thread)
    }

    /// Resolve a free-text familiar reference (id or display name, fuzzy) to a
    /// familiar — used by `/familiar <name>`.
    func resolveFamiliar(_ query: String) -> Familiar? {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return nil }
        if let exact = familiars.first(where: { $0.id.lowercased() == q
            || $0.displayName.lowercased() == q }) { return exact }
        return familiars.first { $0.displayName.lowercased().contains(q)
            || $0.id.lowercased().contains(q) }
    }

    var tasks: [BoardCard] = []
    var tasksError: String?
    var tasksLoaded = false

    // MARK: - Task ↔ chat links

    /// cardId → local thread id. The iOS-immediate source of truth for the
    /// task↔chat relationship: it works before a server `sessionId` exists
    /// (a brand-new chat), and for group threads. When a thread does have a
    /// server session, `card.sessionId` is PATCHed too so the link is visible
    /// on the desktop/web board. Persisted to `cave-card-links.json`.
    var cardThreadLinks: [String: String] = [:]

    // MARK: - Reminders

    var reminders: [Reminder] = []
    var remindersError: String?
    var remindersLoaded = false

    // MARK: - Projects

    var projectContext: ProjectContext?
    var projectContextError: String?
    var projectMembership = ProjectMembershipIndex()
    var projectMembershipLoaded = false
    @ObservationIgnored private var projectContextSelectionSource: ProjectContextSelectionSource?

    var activeProject: ProjectInfo? {
        guard case .project(let selected)? = projectContext else { return nil }
        return projects.first { $0.id == selected.id } ?? selected
    }

    var activeProjectRoot: String? {
        activeProject?.root
    }

    var canStartProjectChats: Bool {
        activeProjectRoot != nil
    }

    func projectContext(for thread: ChatThread) -> ProjectContext {
        ProjectContext.openContext(for: thread.projectRoot, in: projects) ?? .unassigned
    }

    func projectContext(for session: SessionRow) -> ProjectContext {
        ProjectContext.context(for: session.projectRoot, in: projects)
    }

    func isRecoveryOnlyThread(_ thread: ChatThread) -> Bool {
        projectContext(for: thread) == .unassigned && !thread.canChangeProject
    }

    enum ForwardingRouteDisposition: Equatable {
        case allowed
        case recoveryOnly
        case needsProjectSelection
    }

    func forwardingRouteDisposition(
        from source: ChatThread,
        to destination: ChatThread
    ) -> ForwardingRouteDisposition {
        if isRecoveryOnlyThread(source) || isRecoveryOnlyThread(destination) {
            return .recoveryOnly
        }
        if !destination.canSendMessages {
            return .needsProjectSelection
        }
        return .allowed
    }

    var projectThreads: [ChatThread] {
        guard let projectContext else { return [] }
        return threads.filter { projectContext.matches(thread: $0, registeredProjects: projects) }
    }

    var projectServerSessions: [SessionRow] {
        guard let projectContext else { return [] }
        return serverSessions.filter { projectContext.matches(session: $0, registeredProjects: projects) }
    }

    var projectTasks: [BoardCard] {
        guard let projectContext else { return [] }
        return tasks.filter { projectContext.matches(task: $0, registeredProjects: projects) }
    }

    var projectFamiliars: [Familiar] {
        guard let projectContext else { return [] }
        switch projectContext {
        case .project(let selected):
            let projectId = activeProject?.id ?? selected.id
            let allowed = projectMembership.familiarIDs(forProjectID: projectId)
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

    var projectMostRecentThread: ChatThread? {
        projectThreads
            .filter { !$0.archived }
            .max { $0.updatedAt < $1.updatedAt }
    }

    func projectRecentThreads(limit: Int = 5) -> [ChatThread] {
        Array(
            projectThreads
                .filter { !$0.archived }
                .sorted {
                    if $0.pinned != $1.pinned { return $0.pinned }
                    return $0.updatedAt > $1.updatedAt
                }
                .prefix(limit)
        )
    }

    func directThreads(for familiarId: String, in context: ProjectContext) -> [ChatThread] {
        threads
            .filter { context.matches(thread: $0, registeredProjects: projects) }
            .filter { !$0.isGroup && $0.familiarIds == [familiarId] }
            .sorted { a, b in
                if a.pinned != b.pinned { return a.pinned }
                return a.updatedAt > b.updatedAt
            }
    }

    func landingDirectThread(for familiarId: String, in context: ProjectContext) -> ChatThread? {
        directThreads(for: familiarId, in: context).first { !$0.archived }
    }

    func serverOnlySessions(for familiarId: String, in context: ProjectContext) -> [SessionRow] {
        let bound = Set(
            threads
                .filter { context.matches(thread: $0, registeredProjects: projects) }
                .flatMap { $0.sessionIds.values }
                .filter { !$0.isEmpty }
        )
        return serverSessions
            .filter {
                context.matches(session: $0, registeredProjects: projects)
                    && $0.familiarId == familiarId
                    && $0.archivedAt == nil
                    && !bound.contains($0.id)
                    && !$0.isGeneratedRun
            }
            .sorted {
                (caveParseISO($0.updatedAt) ?? .distantPast)
                    > (caveParseISO($1.updatedAt) ?? .distantPast)
            }
    }

    func threadCount(for familiarId: String, in context: ProjectContext) -> Int {
        directThreads(for: familiarId, in: context).count
            + serverOnlySessions(for: familiarId, in: context).count
    }

    func lastActivity(for familiarId: String, in context: ProjectContext) -> Date? {
        let local = directThreads(for: familiarId, in: context).map(\.updatedAt)
        let server = serverOnlySessions(for: familiarId, in: context).compactMap {
            caveParseISO($0.updatedAt)
        }
        return (local + server).max()
    }

    func globalDirectThreads(for familiarId: String) -> [ChatThread] {
        threads
            .filter { !$0.isGroup && $0.familiarIds == [familiarId] }
            .sorted { a, b in
                if a.pinned != b.pinned { return a.pinned }
                return a.updatedAt > b.updatedAt
            }
    }

    private func globalDirectThreadContexts(for familiarId: String) -> [ProjectContext] {
        Array(
            Set(
                globalDirectThreads(for: familiarId)
                    .filter { !$0.archived }
                    .map(projectContext(for:))
            )
        )
        .sorted { lhs, rhs in
            switch (lhs, rhs) {
            case (.project(let left), .project(let right)):
                let order = left.name.localizedCaseInsensitiveCompare(right.name)
                if order == .orderedSame { return left.id < right.id }
                return order == .orderedAscending
            case (.project, .unassigned):
                return true
            case (.unassigned, .project):
                return false
            case (.unassigned, .unassigned):
                return false
            }
        }
    }

    func globalLandingDirectThread(for familiarId: String) -> ChatThread? {
        globalDirectThreadContexts(for: familiarId)
            .compactMap { landingDirectThread(for: familiarId, in: $0) }
            .max { lhs, rhs in
                if lhs.updatedAt == rhs.updatedAt { return lhs.id < rhs.id }
                return lhs.updatedAt < rhs.updatedAt
            }
    }

    func globalServerOnlySessions(for familiarId: String) -> [SessionRow] {
        let bound = Set(threads.flatMap { $0.sessionIds.values }.filter { !$0.isEmpty })
        return serverSessions
            .filter {
                $0.familiarId == familiarId
                    && $0.archivedAt == nil
                    && !bound.contains($0.id)
                    && !$0.isGeneratedRun
            }
            .sorted {
                (caveParseISO($0.updatedAt) ?? .distantPast)
                    > (caveParseISO($1.updatedAt) ?? .distantPast)
            }
    }

    func globalThreadCount(for familiarId: String) -> Int {
        globalDirectThreads(for: familiarId).count
            + globalServerOnlySessions(for: familiarId).count
    }

    func globalLastActivity(for familiarId: String) -> Date? {
        let local = globalDirectThreads(for familiarId).map(\.updatedAt)
        let server = globalServerOnlySessions(for: familiarId).compactMap {
            caveParseISO($0.updatedAt)
        }
        return (local + server).max()
    }

    func projectDirectThreads(for familiarId: String) -> [ChatThread] {
        guard let projectContext else { return [] }
        return directThreads(for: familiarId, in: projectContext)
    }

    func projectLandingDirectThread(for familiarId: String) -> ChatThread? {
        guard let projectContext else { return nil }
        return landingDirectThread(for: familiarId, in: projectContext)
    }

    func projectServerOnlySessions(for familiarId: String) -> [SessionRow] {
        guard let projectContext else { return [] }
        return serverOnlySessions(for: familiarId, in: projectContext)
    }

    func projectThreadCount(for familiarId: String) -> Int {
        guard let projectContext else { return 0 }
        return threadCount(for: familiarId, in: projectContext)
    }

    func projectLastActivity(for familiarId: String) -> Date? {
        guard let projectContext else { return nil }
        return lastActivity(for: familiarId, in: projectContext)
    }

    func projectHasUnread(_ familiarId: String) -> Bool {
        guard let projectContext,
              let seen = familiarViewDate(for: familiarId, in: projectContext),
              let activity = projectLastActivity(for: familiarId) else { return false }
        return activity > seen
    }

    /// Recently used chat roots, newest first and de-duplicated. Project
    /// pickers filter this list against the current familiar-scoped response.
    var recentProjectRoots: [String] {
        var seen = Set<String>()
        return threads
            .sorted { $0.updatedAt > $1.updatedAt }
            .compactMap(\.projectRoot)
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    // MARK: - Appearance (desktop theme)

    /// App-chrome palette mirrored from the desktop's published theme
    /// (`GET /api/theme`). Starts at the built-in look and is replaced once the
    /// desktop theme loads.
    var chrome: ChromePalette = .fallback

    /// The desktop's currently-published theme id + light/dark mode, mirrored
    /// from the last `GET /api/theme`. Drives the Settings theme picker's
    /// selected state so the active card is highlighted. `nil` until a theme
    /// loads (disconnected / pre-poll).
    var publishedThemeId: String?
    var publishedMode: String?

    /// True while a phone-initiated theme override is in flight, so the picker
    /// can show progress and ignore double-taps.
    var publishingTheme = false

    /// Fetch the desktop theme and adopt its palette. Best-effort: on any
    /// failure the current palette stands, so there's no flash back to the
    /// fallback when a poll briefly can't reach the desktop.
    func loadTheme() async {
        guard let client else { return }
        if let snapshot = try? await client.fetchTheme() {
            adopt(snapshot)
        }
    }

    // MARK: - Operator profile

    /// The human operator's profile (`GET /api/profile`), mirrored from the
    /// desktop so the operator's own chat turns show their name/avatar instead
    /// of a generic "You". `nil` until it loads (disconnected / pre-fetch).
    var operatorProfile: OperatorProfile?

    /// Name to show for the operator's messages — the profile name, or "You".
    var operatorDisplayName: String { operatorProfile?.displayName ?? "You" }

    /// Server avatar image URL for the operator, or `nil` when none is set (the
    /// UI falls back to name initials). Cache-busted by the profile's mtime.
    var operatorAvatarURL: URL? {
        guard let client, operatorProfile?.avatarPresent == true else { return nil }
        return client.operatorAvatarURL(updatedAt: operatorProfile?.avatarUpdatedAt)
    }

    /// Fetch the operator profile. Best-effort: on failure the last snapshot
    /// stands (chat keeps showing the current name rather than flashing to
    /// "You" on a transient poll miss), mirroring `loadTheme`.
    func loadOperatorProfile() async {
        guard let client else { return }
        if let profile = try? await client.operatorProfile() {
            if operatorProfile != profile { operatorProfile = profile }
        }
    }

    /// Apply a fetched/published snapshot: refresh the chrome palette and record
    /// the active theme id + mode for the picker. Only assigns on change so an
    /// unchanged poll stays a cheap no-op (no needless view invalidation).
    private func adopt(_ snapshot: ThemeSnapshot) {
        let next = ChromePalette(snapshot: snapshot)
        if next != chrome { chrome = next }
        if publishedThemeId != snapshot.themeId { publishedThemeId = snapshot.themeId }
        if publishedMode != snapshot.mode { publishedMode = snapshot.mode }
    }

    /// Override the desktop's active theme from the phone (`PUT /api/theme`).
    /// The desktop adopts the preset and re-publishes resolved tokens; we adopt
    /// the returned snapshot immediately so the phone re-themes without waiting
    /// for the next 20s poll. Best-effort — a failed write leaves the current
    /// theme untouched and surfaces `false` so the caller can flag it.
    @discardableResult
    func setDesktopTheme(themeId: String, mode: String) async -> Bool {
        guard let client else { return false }
        publishingTheme = true
        defer { publishingTheme = false }
        guard let snapshot = try? await client.publishTheme(themeId: themeId, mode: mode) else {
            return false
        }
        adopt(snapshot)
        // The desktop resolves the real hex tokens asynchronously after it
        // adopts; re-poll shortly so the phone upgrades from the preset's
        // bundled swatch to the desktop's exact palette.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            await self?.loadTheme()
        }
        return true
    }

    var client: CaveClient? {
        guard let connection else { return nil }
        return CaveClient(connection: connection)
    }

    private var coreResourceClient: (any AppModelCoreResourceClient)? {
        guard let connection else { return nil }
        return coreResourceClientFactory(connection)
    }

    private var sessionLoadingClient: (any ProjectContextLoadingClient)? {
        if let coreResourceClient {
            return coreResourceClient
        }
        if let client {
            return client
        }
        return nil
    }

    private var taskLoadingClient: (any ProjectContextLoadingClient)? {
        if let coreResourceClient {
            return coreResourceClient
        }
        if let client {
            return client
        }
        return nil
    }

    private var taskSessionUpdatingClient: (any TaskSessionUpdatingClient)? {
        if let coreResourceClient = coreResourceClient as? any TaskSessionUpdatingClient {
            return coreResourceClient
        }
        if let client {
            return client
        }
        return nil
    }

    private var taskFieldsUpdatingClient: (any TaskFieldsUpdatingClient)? {
        if let coreResourceClient = coreResourceClient as? any TaskFieldsUpdatingClient {
            return coreResourceClient
        }
        if let client {
            return client
        }
        return nil
    }

    private var taskProjectUpdatingClient: (any TaskProjectUpdatingClient)? {
        if let coreResourceClient = coreResourceClient as? any TaskProjectUpdatingClient {
            return coreResourceClient
        }
        if let client {
            return client
        }
        return nil
    }

    private var reminderClient: (any ReminderManagingClient)? {
        if let coreResourceClient = coreResourceClient as? any ReminderManagingClient {
            return coreResourceClient
        }
        if let client {
            return client
        }
        return nil
    }

    #if DEBUG
    @ObservationIgnored private var previewChatProjects: [ProjectInfo]?
    #endif
    @ObservationIgnored private let projectContextDefaults: UserDefaults
    @ObservationIgnored private let widgetSnapshotDefaults: UserDefaults?
    @ObservationIgnored private let coreResourceClientFactory: @Sendable (CaveConnection) -> any AppModelCoreResourceClient
    @ObservationIgnored private let reminderNotificationScheduler: any ReminderNotificationScheduling
    @ObservationIgnored private let baseURLDiscoverer: @Sendable ([URL]) async -> DiscoveryOutcome
    @ObservationIgnored private let threadStore: ThreadSnapshotStore
    @ObservationIgnored private let threadSnapshotLoader: @Sendable () async -> [ThreadSnapshot]
    /// Incremented for every context load (and on host reset/disconnect) so a
    /// stale completion can never overwrite newer project membership/selection.
    @ObservationIgnored private var projectContextLoadNonce: UInt64 = 0
    @ObservationIgnored private var sessionsLoadState = CoordinatedLoadState<[SessionRow]>()
    @ObservationIgnored private var tasksLoadState = CoordinatedLoadState<[BoardCard]>()
    @ObservationIgnored private var projectNavigationConnectionGeneration: UInt64 = 0
    @ObservationIgnored private var projectNavigationKnownGoodConnectionGeneration: UInt64?
    @ObservationIgnored private var projectNavigationProjectsAttemptGeneration: UInt64?
    @ObservationIgnored private var projectNavigationProjectsSuccessGeneration: UInt64?
    @ObservationIgnored private var projectNavigationProjectsFailureGeneration: UInt64?
    @ObservationIgnored private var projectNavigationSessionsAttemptGeneration: UInt64?
    @ObservationIgnored private var projectNavigationSessionsSuccessGeneration: UInt64?
    @ObservationIgnored private var projectNavigationSessionsFailureGeneration: UInt64?
    @ObservationIgnored private var projectNavigationTasksAttemptGeneration: UInt64?
    @ObservationIgnored private var projectNavigationTasksSuccessGeneration: UInt64?
    @ObservationIgnored private var projectNavigationTasksFailureGeneration: UInt64?

    var canLoadChatProjects: Bool {
        #if DEBUG
        if previewChatProjects != nil { return true }
        #endif
        return client != nil
    }

    var canRecoverChatProjectConnection: Bool {
        #if DEBUG
        if previewChatProjects != nil { return false }
        #endif
        return connection != nil
    }

    func loadChatProjects(familiarIds: [String]) async throws -> [ProjectInfo] {
        #if DEBUG
        if let previewChatProjects {
            return previewChatProjects
        }
        #endif

        guard let client else { throw CaveError.notConfigured }
        return try await client.projects(familiarIds: familiarIds)
    }

    /// familiarId → when its chats were last viewed. A familiar reads as
    /// "unread" when its latest activity is newer than this. Persisted.
    var familiarViews: [String: Date] = [:]

    private func familiarViewKey(for familiarId: String, in context: ProjectContext?) -> String {
        guard let context else { return familiarId }
        return "\(context.id)|\(familiarId)"
    }

    private func familiarViewDate(for familiarId: String, in context: ProjectContext?) -> Date? {
        familiarViews[familiarViewKey(for: familiarId, in: context)]
    }

    /// threadId → the operator's unsent composer draft, mirrored from the
    /// per-thread UserDefaults keys so list rows can badge drafted threads
    /// without hitting UserDefaults on every row render. Seeded on hydrate,
    /// kept current by the composer's debounced persistence.
    var threadDrafts: [String: String] = [:]

    init(
        defaults: UserDefaults = .standard,
        restoreLocalState: Bool = true,
        widgetSnapshotDefaults: UserDefaults? = nil,
        threadSnapshotLoader: (@Sendable () async -> [ThreadSnapshot])? = nil,
        coreResourceClientFactory: @escaping @Sendable (CaveConnection) -> any AppModelCoreResourceClient = {
            CaveClient(connection: $0)
        },
        reminderNotificationScheduler: any ReminderNotificationScheduling = SystemReminderNotificationScheduler(),
        baseURLDiscoverer: @escaping @Sendable ([URL]) async -> DiscoveryOutcome = { candidates in
            await AppModel.discoverBaseURL(candidates)
        }
    ) {
        let threadStore = ThreadSnapshotStore(url: AppModel.threadsFileURL)
        self.projectContextDefaults = defaults
        self.widgetSnapshotDefaults = widgetSnapshotDefaults
        self.threadStore = threadStore
        self.threadSnapshotLoader = threadSnapshotLoader ?? {
            (try? await threadStore.load()) ?? []
        }
        self.coreResourceClientFactory = coreResourceClientFactory
        self.reminderNotificationScheduler = reminderNotificationScheduler
        self.baseURLDiscoverer = baseURLDiscoverer
        connection = CaveConnection.load(defaults: defaults)
        if connection != nil {
            projectNavigationConnectionGeneration = 1
        }
        pendingProjectNavigationIntent = ProcessInfo.processInfo.environment["CAVE_OPEN_THREAD"]
            .map { ProjectNavigationIntent(entity: .thread(id: $0), destination: .chats) }
        if !restoreLocalState {
            threadsHydrated = true
        }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-preview-connecting") {
            connection = CaveConnection(host: "cave-desktop.example")
            connectionState = .checking
            isConnectingPreview = true
            ChatTurnNotifier.shared.app = self
            return
        }

        if ProcessInfo.processInfo.arguments.contains("--ui-preview-project-context-gate") {
            connection = CaveConnection(host: "cave-desktop.example")
            connectionState = .projectContextRequired
            projectContextError = "Choose a project in Cave before opening it on this device."
            isConnectingPreview = true
            ChatTurnNotifier.shared.app = self
            return
        }

        if ProcessInfo.processInfo.arguments.contains("--ui-preview-design-closeout") {
            configureDesignCloseoutPreview()
            _ = resolvePendingProjectNavigationIntent()
            ChatTurnNotifier.shared.app = self
            return
        }

        // Deterministic native screenshot fixture for the canonical empty-chat
        // surface. Launch with `--ui-preview-empty-chat` and
        // `CAVE_OPEN_THREAD=ui-preview-empty-chat`; release builds never carry
        // fixture state and the preview never touches the saved thread store.
        if ProcessInfo.processInfo.arguments.contains("--ui-preview-empty-chat") {
            configureEmptyChatPreview()
            if ProcessInfo.processInfo.arguments.contains("--ui-preview-second-thread") {
                // A second conversation with the same familiar, so the session
                // switcher has somewhere to switch *to*. Without it the picker
                // lists one row and a UI test cannot tell a working switch
                // apart from the dead-end it replaced.
                threads.append(
                    ChatThread(
                        id: "ui-preview-second-chat",
                        title: "Chat with Nyx on Jul 27",
                        familiarIds: ["nyx"],
                        projectRoot: threads.first?.projectRoot
                    )
                )
            }
            _ = resolvePendingProjectNavigationIntent()
            ChatTurnNotifier.shared.app = self
            return
        }

        // Sibling fixture for the agent-activity trail — a settled turn whose
        // steps cover every status a tool row can carry. Launch with
        // `--ui-preview-tool-activity` and
        // `CAVE_OPEN_THREAD=ui-preview-tool-activity`.
        if ProcessInfo.processInfo.arguments.contains("--ui-preview-tool-activity") {
            configureToolActivityPreview()
            _ = resolvePendingProjectNavigationIntent()
            ChatTurnNotifier.shared.app = self
            return
        }
        #endif
        if restoreLocalState {
            // Threads hydrate off-main via the store — no file I/O in init.
            hydrateThreadsTask = Task { await self.hydrateThreads() }
            loadCardLinks()
            loadFamiliarViews()
        }
        if connection != nil { connectionState = .checking }
        ChatTurnNotifier.shared.app = self
    }

    #if DEBUG
    private func configureEmptyChatPreview() {
        connection = nil
        familiars = [
            Familiar(
                id: "nyx",
                displayName: "Nyx",
                role: "Code familiar",
                description: "Keeps implementation work moving.",
                pronouns: nil,
                color: nil,
                status: "active",
                harness: "codex",
                model: "gpt-5.6",
                icon: "moon.stars.fill",
                avatarUrl: nil,
                activeSessions: 1,
                memoryFreshness: "Fresh"
            ),
        ]
        familiarsLoaded = true

        func card(
            id: String,
            title: String,
            status: CardStatus,
            priority: CardPriority,
            number: Int
        ) -> BoardCard {
            BoardCard(
                id: id,
                title: title,
                notes: nil,
                statusRaw: status.rawValue,
                priorityRaw: priority.rawValue,
                familiarId: "nyx",
                projectId: "coven-app",
                sessionId: nil,
                labels: nil,
                startDate: nil,
                endDate: nil,
                createdAt: nil,
                updatedAt: nil,
                needsHuman: nil,
                steps: nil,
                github: [
                    CardGitHubLink(
                        id: "pr-\(number)",
                        kind: "pr",
                        repo: "OpenCoven/coven-cave",
                        number: number,
                        title: title,
                        url: "https://github.com/OpenCoven/coven-cave/pull/\(number)",
                        state: "open"
                    ),
                ]
            )
        }

        tasks = [
            card(
                id: "cold-launch",
                title: "cold-launch bug",
                status: .running,
                priority: .urgent,
                number: 128
            ),
            card(
                id: "drawer-fidelity",
                title: "navigation fidelity",
                status: .running,
                priority: .high,
                number: 129
            ),
            card(
                id: "plugin-setup",
                title: "plugin setup",
                status: .blocked,
                priority: .medium,
                number: 130
            ),
        ]
        tasksLoaded = true
        sessionsLoaded = true
        let previewProject = ProjectInfo(
            id: "coven-app",
            name: "Coven Cave",
            root: "/repos/coven-cave",
            color: nil,
            updatedAt: nil,
            access: .write
        )
        threads = [
            ChatThread(
                id: "ui-preview-empty-chat",
                title: "Chat with Nyx on Jul 26",
                familiarIds: ["nyx"],
                projectRoot: previewProject.root
            ),
        ]
        previewChatProjects = [previewProject]
        projects = [previewProject]
        projectsLoaded = true
        seedPreviewProjectContext()

        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--ui-preview-new-chat-access-revoked") {
            projectMembership = ProjectMembershipIndex()
            projectMembershipLoaded = true
        }
        if arguments.contains("--ui-preview-new-chat-unassigned") {
            threads.first?.projectRoot = nil
            projectContext = .unassigned
            projectContextSelectionSource = .user
        }

        connectionState = .connected
    }

    /// Screenshot fixture for the remaining compatible Claude Design affordances:
    /// app-wide search, real project activity metadata, and paired GitHub/task
    /// context. It builds on the canonical preview so all values stay consistent.
    private func configureDesignCloseoutPreview() {
        configureEmptyChatPreview()
        let projectRoot = "/Users/buns/Code/coven-cave"
        let docsRoot = "/Users/buns/Code/design-library"
        let covenProject = ProjectInfo(
            id: "coven-app",
            name: "Coven Cave",
            root: projectRoot,
            color: nil,
            updatedAt: "2026-08-06T09:00:00Z"
        )
        let designProject = ProjectInfo(
            id: "design-library",
            name: "Design Library",
            root: docsRoot,
            color: nil,
            updatedAt: "2026-08-05T11:30:00Z"
        )

        func previewTask(
            id: String,
            title: String,
            status: CardStatus,
            priority: CardPriority,
            familiarId: String?,
            projectId: String?
        ) -> BoardCard {
            BoardCard(
                id: id,
                title: title,
                notes: nil,
                statusRaw: status.rawValue,
                priorityRaw: priority.rawValue,
                familiarId: familiarId,
                projectId: projectId,
                sessionId: nil,
                labels: nil,
                startDate: nil,
                endDate: nil,
                createdAt: nil,
                updatedAt: nil,
                needsHuman: nil,
                steps: nil,
                github: nil
            )
        }

        projects = [covenProject, designProject]
        previewChatProjects = projects
        projectsLoaded = true
        familiars = [
            Familiar(
                id: "nyx",
                displayName: "Nyx",
                role: "Code familiar",
                description: "Keeps implementation work moving.",
                pronouns: nil,
                color: nil,
                status: "active",
                harness: "codex",
                model: "gpt-5.6",
                icon: "moon.stars.fill",
                avatarUrl: nil,
                activeSessions: 1,
                memoryFreshness: "Fresh"
            ),
            Familiar(
                id: "lyra",
                displayName: "Lyra",
                role: "Design familiar",
                description: "Helps reconcile component and token polish.",
                pronouns: nil,
                color: nil,
                status: "active",
                harness: "codex",
                model: "gpt-5.6",
                icon: "paintpalette.fill",
                avatarUrl: nil,
                activeSessions: 1,
                memoryFreshness: "Fresh"
            ),
            Familiar(
                id: "ember",
                displayName: "Ember",
                role: "Recovery familiar",
                description: "Finds projectless work that still needs attention.",
                pronouns: nil,
                color: nil,
                status: "active",
                harness: "codex",
                model: "gpt-5.6",
                icon: "sparkles",
                avatarUrl: nil,
                activeSessions: 1,
                memoryFreshness: "Fresh"
            ),
        ]
        familiarsLoaded = true

        if let currentThread = threads.first {
            currentThread.projectRoot = projectRoot
            currentThread.updatedAt = Date(timeIntervalSince1970: 1_000)
            currentThread.messages = [
                DisplayMessage(
                    role: .assistant,
                    familiarId: "nyx",
                    text: "The iOS design closeout is ready for review."
                ),
            ]
        }
        let designThread = ChatThread(
            id: "ui-preview-lyra-chat",
            title: "Lyra design review",
            familiarIds: ["lyra"],
            projectRoot: docsRoot,
            messages: [
                DisplayMessage(
                    role: .assistant,
                    familiarId: "lyra",
                    text: "The typography tokens are aligned with the design library."
                ),
            ]
        )
        designThread.updatedAt = Date(timeIntervalSince1970: 900)
        let renamedBoundThread = ChatThread(
            id: "ui-preview-renamed-local-chat",
            title: "Renamed local chat",
            familiarIds: ["nyx"],
            sessionIds: ["nyx": "ui-preview-bound-rename"],
            projectRoot: projectRoot,
            messages: [
                DisplayMessage(
                    role: .assistant,
                    familiarId: "nyx",
                    text: "The local title differs, but search should still honor the server metadata."
                ),
            ]
        )
        renamedBoundThread.updatedAt = Date(timeIntervalSince1970: 850)
        let unassignedThread = ChatThread(
            id: "ui-preview-orphaned-chat",
            title: "Recovered draft notes",
            familiarIds: ["ember"],
            projectRoot: nil,
            messages: [
                DisplayMessage(
                    role: .assistant,
                    familiarId: "ember",
                    text: "Recovered this chat from an unassigned project root."
                ),
            ]
        )
        unassignedThread.updatedAt = Date(timeIntervalSince1970: 800)
        threads = Array(threads.prefix(1)) + [designThread, renamedBoundThread, unassignedThread]

        tasks += [
            previewTask(
                id: "scope-anchor-current",
                title: "scope anchor current",
                status: .running,
                priority: .medium,
                familiarId: "nyx",
                projectId: covenProject.id
            ),
            previewTask(
                id: "scope-anchor-design",
                title: "scope anchor design",
                status: .review,
                priority: .medium,
                familiarId: "lyra",
                projectId: designProject.id
            ),
            previewTask(
                id: "scope-anchor-unassigned",
                title: "scope anchor unassigned",
                status: .blocked,
                priority: .medium,
                familiarId: "ember",
                projectId: "ghost-project"
            ),
        ]
        tasksLoaded = true

        serverSessions = [
            SessionRow(
                id: "ui-preview-server-only",
                title: "Desktop handoff",
                harness: nil,
                model: nil,
                runtime: nil,
                status: "idle",
                familiarId: "nyx",
                createdAt: "2026-08-06T03:30:00Z",
                updatedAt: "2026-08-06T04:45:00Z",
                archivedAt: nil,
                projectRoot: projectRoot,
                origin: nil,
                generated: false
            ),
            SessionRow(
                id: "ui-preview-unassigned-session",
                title: "Ghost recovery",
                harness: nil,
                model: nil,
                runtime: nil,
                status: "idle",
                familiarId: "ember",
                createdAt: "2026-08-06T01:30:00Z",
                updatedAt: "2026-08-06T02:00:00Z",
                archivedAt: nil,
                projectRoot: "/Users/buns/Code/deleted-project",
                origin: nil,
                generated: false
            ),
            SessionRow(
                id: "ui-preview-bound-rename",
                title: "Authoritative desktop handoff",
                harness: nil,
                model: nil,
                runtime: nil,
                status: "idle",
                familiarId: "nyx",
                createdAt: "2026-08-06T02:30:00Z",
                updatedAt: "2026-08-06T03:00:00Z",
                archivedAt: nil,
                projectRoot: projectRoot,
                origin: nil,
                generated: false
            ),
        ]
        sessionsLoaded = true

        cardThreadLinks["cold-launch"] = "ui-preview-empty-chat"
        projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: [
                covenProject.id: Set(["nyx"]),
                designProject.id: Set(["lyra"]),
            ]
        )
        projectMembershipLoaded = true
        projectContext = .project(covenProject)
        projectContextSelectionSource = .automatic
        if ProcessInfo.processInfo.arguments.contains("--ui-preview-search-unassigned") {
            projectContext = .unassigned
            projectContextSelectionSource = .user
        }
        if let projectContext {
            seedFamiliarViews(projectFamiliars.map(\.id), in: projectContext)
        }
        projectContextError = nil
        if ProcessInfo.processInfo.arguments.contains("--ui-preview-light") {
            chrome.colorScheme = .light
        }
    }

    /// Deterministic native screenshot fixture for the agent-activity trail.
    /// One settled assistant turn whose steps cover every status a tool row can
    /// carry: a succeeded call, a failed one with its reason, and an
    /// informational notice. Release builds never carry fixture state.
    private func configureToolActivityPreview() {
        connection = nil
        familiars = [
            Familiar(
                id: "nyx",
                displayName: "Nyx",
                role: "Code familiar",
                description: "Keeps implementation work moving.",
                pronouns: nil,
                color: nil,
                status: "active",
                harness: "codex",
                model: "gpt-5.6",
                icon: "moon.stars.fill",
                avatarUrl: nil,
                activeSessions: 1,
                memoryFreshness: "Fresh"
            ),
        ]
        familiarsLoaded = true
        tasksLoaded = true
        sessionsLoaded = true
        let previewProject = ProjectInfo(
            id: "coven-app",
            name: "Coven Cave",
            root: "/repos/coven-cave",
            color: nil,
            updatedAt: nil,
            access: .write
        )

        var reply = DisplayMessage(
            role: .assistant,
            familiarId: "nyx",
            text: "Fixed — the summary was reading the first line of a pretty-printed payload."
        )
        reply.activity = [
            ActivityStep(id: "a", kind: .tool, title: "Read",
                         detail: "src/lib/tool-arg-summary.ts", status: .ok, durationMs: 42),
            ActivityStep(id: "b", kind: .tool, title: "Bash",
                         detail: "pnpm test --filter tool-arg", status: .error,
                         durationMs: 8_400,
                         errorOutput: "error: cannot find module 'foo'\n  at Object.<anonymous> (tool-arg.test.ts:12:9)"),
            ActivityStep(id: "c", kind: .progress, title: "Rate limited — retrying in 30s",
                         status: .notice),
            ActivityStep(id: "d", kind: .tool, title: "Edit",
                         detail: "apps/ios/CovenCave/CovenCave/Models/AgentActivity.swift",
                         status: .ok, durationMs: 1_200),
        ]

        threads = [
            ChatThread(
                id: "ui-preview-tool-activity",
                title: "Chat with Nyx on Aug 3",
                familiarIds: ["nyx"],
                projectRoot: previewProject.root,
                messages: [
                    DisplayMessage(role: .user, text: "fix the ios tool calls"),
                    reply,
                ]
            ),
        ]
        previewChatProjects = [previewProject]
        projects = [previewProject]
        projectsLoaded = true
        seedPreviewProjectContext()
        connectionState = .connected
    }

    private func seedPreviewProjectContext() {
        guard !projects.isEmpty else { return }
        let familiarIDs = Set(familiars.map(\.id))
        projectMembership = ProjectMembershipIndex(
            familiarIDsByProjectID: Dictionary(
                uniqueKeysWithValues: projects.map { ($0.id, familiarIDs) }
            )
        )
        projectMembershipLoaded = true
        projectContext = ProjectContext.defaultSelection(
            restored: nil,
            projects: projects,
            threads: threads,
            sessions: serverSessions,
            tasks: tasks
        )
        projectContextSelectionSource = projectContext == nil ? nil : .automatic
        if let projectContext {
            seedFamiliarViews(projectFamiliars.map(\.id), in: projectContext)
        }
        projectContextError = nil
    }
    #endif

    func familiar(_ id: String) -> Familiar? {
        familiars.first { $0.id == id }
    }

    func project(_ id: String) -> ProjectInfo? {
        projects.first { $0.id == id }
    }

    /// Switch the canonical application context without disturbing the current
    /// destination. Later tasks will route surfaces through this state; for now
    /// it persists the chosen context and clears any pending cross-surface handoff.
    func switchProject(to context: ProjectContext) {
        let preservedTab = selectedTab
        switch context {
        case .project(let selected):
            if let current = projects.first(where: { $0.id == selected.id }) {
                applyProjectContextSelection(.project(current), source: .user)
            } else {
                applyProjectContextSelection(.project(selected), source: .user)
            }
        case .unassigned:
            applyProjectContextSelection(.unassigned, source: .user)
        }
        persistProjectContextSelection(projectContext)
        threadToOpen = nil
        cardToOpen = nil
        newChatRequested = false
        chatSearchRequested = false
        selectedTab = preservedTab
        if let projectContext {
            seedFamiliarViews(projectFamiliars.map(\.id), in: projectContext)
        }
        publishWidgetSnapshot()
    }

    func loadTasks() async {
        guard let client = taskLoadingClient else { return }
        await loadTasks(using: client)
    }

    func loadTasks(using client: any ProjectContextLoadingClient) async {
        let navigationGeneration = currentProjectNavigationConnectionGeneration()
        noteProjectNavigationSurfaceAttempt(.tasks, generation: navigationGeneration)
        let load = await coordinatedTasksLoad(
            using: client,
            generation: navigationGeneration
        )
        guard coordinatedLoadShouldApply(load.token, state: tasksLoadState) else { return }
        markCoordinatedLoadApplied(load.token, state: &tasksLoadState)

        switch load.result {
        case .success(let loadedTasks):
            tasks = activeTaskMutationsOverlaying(loadedTasks)
            tasksError = nil
            noteProjectNavigationSurfaceSuccess(.tasks, generation: navigationGeneration)
        case .failure(let error):
            tasksError = handleSurfaceError(error)
            noteProjectNavigationSurfaceFailure(.tasks, generation: navigationGeneration)
        }
        tasksLoaded = true
        // A task that finished on the desktop should drop its Lock Screen activity.
        await LiveActivityManager.shared.reconcile(tasks)
        _ = resolvePendingProjectNavigationIntent(
            attemptHydrationIfNeeded: tasksError == nil
        )
        publishWidgetSnapshot()
    }

    // MARK: - Task actions

    /// Per-card+field single-flight coordination for task mutations. Same-field
    /// requests cancel/supersede older ones, but unrelated fields stay
    /// concurrent because the server's PATCH contract is partial.
    @ObservationIgnored private let taskMutationCoordinator = TaskMutationCoordinator()
    @ObservationIgnored private var taskFieldGenerations: [String: [TaskMutationField: Int]] = [:]
    @ObservationIgnored private var nextTaskMutationGeneration = 0

    private enum TaskMutationField: Hashable, Sendable {
        case status
        case priority
        case steps
        case notes
        case title
        case dates
        case projectId
        case sessionId
    }

    @MainActor
    private final class TaskMutationCoordinator {
        private struct LaneKey: Hashable {
            let cardId: String
            let field: TaskMutationField
        }

        private struct LaneState {
            var sequence = 0
            var task: Task<Void, Never>?
        }

        private var lanes: [LaneKey: LaneState] = [:]

        @discardableResult
        func schedule(
            cardId: String,
            field: TaskMutationField,
            operation: @escaping @Sendable @MainActor () async -> Void
        ) -> Task<Void, Never> {
            let key = LaneKey(cardId: cardId, field: field)
            var lane = lanes[key] ?? LaneState()
            let previousTask = lane.task
            previousTask?.cancel()
            lane.sequence &+= 1
            let sequence = lane.sequence
            let task = Task { [weak self] in
                _ = await previousTask?.result
                guard !Task.isCancelled else {
                    await MainActor.run { self?.finish(key: key, sequence: sequence) }
                    return
                }
                await operation()
                await MainActor.run { self?.finish(key: key, sequence: sequence) }
            }
            lane.task = task
            lanes[key] = lane
            return task
        }

        private func finish(key: LaneKey, sequence: Int) {
            guard let lane = lanes[key], lane.sequence == sequence else { return }
            lanes.removeValue(forKey: key)
        }
    }

    private struct TaskMutationToken {
        let cardId: String
        let generation: Int
        let previous: BoardCard
        let field: TaskMutationField
    }

    @discardableResult
    private func scheduleTaskMutationRequest(
        _ token: TaskMutationToken,
        operation: @escaping @Sendable @MainActor () async -> Void
    ) -> Task<Void, Never> {
        taskMutationCoordinator.schedule(
            cardId: token.cardId,
            field: token.field,
            operation: operation
        )
    }

    /// Entry point for every status mutation. Views must call this rather than
    /// wrapping `setTaskStatus` in their own `Task { }`: a detached task cannot
    /// be cancelled, so a rapid done/reopen swipe sequence would leave two
    /// writes racing and let the *older* server response land last, snapping the
    /// row back to a status the user already moved off of.
    @discardableResult
    func requestTaskStatus(_ card: BoardCard, _ status: CardStatus) -> Task<Void, Never>? {
        guard let client = taskFieldsUpdatingClient,
              status != card.status,
              let mutation = beginTaskMutation(id: card.id, field: .status) else { return nil }
        applyTask(id: card.id) { $0.statusRaw = status.rawValue }
        return scheduleTaskMutationRequest(mutation) { [weak self] in
            await self?.performTaskStatusMutation(
                using: client,
                cardId: card.id,
                status: status,
                mutation: mutation
            )
        }
    }

    @discardableResult
    func requestTaskPriority(_ card: BoardCard, _ priority: CardPriority) -> Task<Void, Never>? {
        guard let client = taskFieldsUpdatingClient,
              priority != card.priority,
              let mutation = beginTaskMutation(id: card.id, field: .priority) else { return nil }
        applyTask(id: card.id) { $0.priorityRaw = priority.rawValue }
        return scheduleTaskMutationRequest(mutation) { [weak self] in
            await self?.performTaskPriorityMutation(
                using: client,
                cardId: card.id,
                priority: priority,
                mutation: mutation
            )
        }
    }

    @discardableResult
    func requestToggleTaskStep(_ card: BoardCard, stepId: String) -> Task<Void, Never>? {
        guard var steps = card.steps,
              let idx = steps.firstIndex(where: { $0.id == stepId }) else { return nil }
        steps[idx].done.toggle()
        return requestTaskSteps(card, steps)
    }

    @discardableResult
    func requestAddTaskStep(_ card: BoardCard, text: String) -> Task<Void, Never>? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        var steps = card.steps ?? []
        steps.append(CardStep(id: UUID().uuidString, text: trimmed, done: false, doneAt: nil))
        return requestTaskSteps(card, steps)
    }

    @discardableResult
    func requestDeleteTaskStep(_ card: BoardCard, stepId: String) -> Task<Void, Never>? {
        guard var steps = card.steps else { return nil }
        steps.removeAll { $0.id == stepId }
        return requestTaskSteps(card, steps)
    }

    @discardableResult
    func requestMoveTaskStep(_ card: BoardCard, stepId: String, by delta: Int) -> Task<Void, Never>? {
        guard var steps = card.steps,
              let index = steps.firstIndex(where: { $0.id == stepId }) else { return nil }
        let destination = index + delta
        guard destination >= 0, destination < steps.count else { return nil }
        steps.swapAt(index, destination)
        return requestTaskSteps(card, steps)
    }

    @discardableResult
    private func requestTaskSteps(_ card: BoardCard, _ steps: [CardStep]) -> Task<Void, Never>? {
        guard let client = taskFieldsUpdatingClient,
              let mutation = beginTaskMutation(id: card.id, field: .steps) else { return nil }
        applyTask(id: card.id) { $0.steps = steps }
        return scheduleTaskMutationRequest(mutation) { [weak self] in
            await self?.performTaskStepsMutation(
                using: client,
                cardId: card.id,
                steps: steps,
                mutation: mutation
            )
        }
    }

    @discardableResult
    func requestTaskNotes(_ card: BoardCard, _ notes: String) -> Task<Void, Never>? {
        guard let client = taskFieldsUpdatingClient else { return nil }
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != (card.notes ?? ""),
              let mutation = beginTaskMutation(id: card.id, field: .notes) else { return nil }
        applyTask(id: card.id) { $0.notes = trimmed }
        return scheduleTaskMutationRequest(mutation) { [weak self] in
            await self?.performTaskNotesMutation(
                using: client,
                cardId: card.id,
                notes: trimmed,
                mutation: mutation
            )
        }
    }

    @discardableResult
    func requestTaskTitle(_ card: BoardCard, _ title: String) -> Task<Void, Never>? {
        guard let client = taskFieldsUpdatingClient else { return nil }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              trimmed != card.title,
              let mutation = beginTaskMutation(id: card.id, field: .title) else { return nil }
        applyTask(id: card.id) { $0.title = trimmed }
        return scheduleTaskMutationRequest(mutation) { [weak self] in
            await self?.performTaskTitleMutation(
                using: client,
                cardId: card.id,
                title: trimmed,
                mutation: mutation
            )
        }
    }

    @discardableResult
    func requestTaskDates(
        _ card: BoardCard,
        start: String?,
        end: String?
    ) -> Task<Void, Never>? {
        guard let client = taskFieldsUpdatingClient,
              start != card.startDate || end != card.endDate,
              let mutation = beginTaskMutation(id: card.id, field: .dates) else { return nil }
        applyTask(id: card.id) {
            $0.startDate = start
            $0.endDate = end
        }
        return scheduleTaskMutationRequest(mutation) { [weak self] in
            await self?.performTaskDatesMutation(
                using: client,
                cardId: card.id,
                start: start,
                end: end,
                mutation: mutation
            )
        }
    }

    @discardableResult
    func requestTaskProjectMove(
        _ card: BoardCard,
        project: ProjectInfo
    ) -> Task<Void, Never>? {
        guard let client = taskProjectUpdatingClient else { return nil }
        let projectId = project.id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !projectId.isEmpty else { return nil }
        let currentProjectId = card.projectId?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard currentProjectId != projectId,
              let mutation = beginTaskMutation(id: card.id, field: .projectId) else { return nil }
        applyTask(id: card.id) { $0.projectId = projectId }
        return scheduleTaskMutationRequest(mutation) { [weak self] in
            await self?.performTaskProjectMutation(
                using: client,
                cardId: card.id,
                projectId: projectId,
                projectName: project.name,
                mutation: mutation
            )
        }
    }

    @discardableResult
    func requestTaskSession(cardId: String, sessionId: String?) -> Task<Void, Never>? {
        guard let client = taskSessionUpdatingClient,
              let card = tasks.first(where: { $0.id == cardId }) else { return nil }
        let normalizedSessionId = normalizedSessionID(sessionId)
        guard normalizedSessionID(card.sessionId) != normalizedSessionId,
              let mutation = beginTaskMutation(id: cardId, field: .sessionId) else { return nil }
        applyTask(id: cardId) { $0.sessionId = normalizedSessionId }
        return scheduleTaskMutationRequest(mutation) { [weak self] in
            await self?.performTaskSessionMutation(
                using: client,
                cardId: cardId,
                sessionId: normalizedSessionId,
                mutation: mutation
            )
        }
    }

    private func beginTaskMutation(
        id: String,
        field: TaskMutationField
    ) -> TaskMutationToken? {
        guard let previous = tasks.first(where: { $0.id == id }) else { return nil }
        nextTaskMutationGeneration &+= 1
        let generation = nextTaskMutationGeneration
        var generations = taskFieldGenerations[id] ?? [:]
        generations[field] = generation
        taskFieldGenerations[id] = generations
        return TaskMutationToken(
            cardId: id,
            generation: generation,
            previous: previous,
            field: field
        )
    }

    private func taskMutationIsCurrent(_ token: TaskMutationToken) -> Bool {
        taskFieldGenerations[token.cardId]?[token.field] == token.generation
    }

    private func finishTaskMutation(_ token: TaskMutationToken) {
        guard taskMutationIsCurrent(token) else { return }
        taskFieldGenerations[token.cardId]?[token.field] = nil
        if taskFieldGenerations[token.cardId]?.isEmpty == true {
            taskFieldGenerations[token.cardId] = nil
        }
    }

    private func applyTaskServerUpdate(
        _ updated: BoardCard,
        for token: TaskMutationToken
    ) -> Bool {
        var applied = false
        applyTask(id: token.cardId) { card in
            guard taskMutationIsCurrent(token) else { return }
            switch token.field {
            case .status:
                card.statusRaw = updated.statusRaw
                applied = true
            case .priority:
                card.priorityRaw = updated.priorityRaw
                applied = true
            case .steps:
                card.steps = updated.steps
                applied = true
            case .notes:
                card.notes = updated.notes
                applied = true
            case .title:
                card.title = updated.title
                applied = true
            case .dates:
                card.startDate = updated.startDate
                card.endDate = updated.endDate
                applied = true
            case .projectId:
                card.projectId = updated.projectId
                applied = true
            case .sessionId:
                card.sessionId = updated.sessionId
                applied = true
            }
            if applied {
                card.updatedAt = mergedTaskUpdatedAt(
                    current: card.updatedAt,
                    incoming: updated.updatedAt
                )
            }
        }
        return applied
    }

    private func revertTaskMutation(_ token: TaskMutationToken) -> Bool {
        var reverted = false
        applyTask(id: token.cardId) { card in
            guard taskMutationIsCurrent(token) else { return }
            switch token.field {
            case .status:
                card.statusRaw = token.previous.statusRaw
                reverted = true
            case .priority:
                card.priorityRaw = token.previous.priorityRaw
                reverted = true
            case .steps:
                card.steps = token.previous.steps
                reverted = true
            case .notes:
                card.notes = token.previous.notes
                reverted = true
            case .title:
                card.title = token.previous.title
                reverted = true
            case .dates:
                card.startDate = token.previous.startDate
                card.endDate = token.previous.endDate
                reverted = true
            case .projectId:
                card.projectId = token.previous.projectId
                reverted = true
            case .sessionId:
                card.sessionId = token.previous.sessionId
                reverted = true
            }
        }
        return reverted
    }

    private func mergedTaskUpdatedAt(current: String?, incoming: String?) -> String? {
        guard let incoming = incoming?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !incoming.isEmpty else {
            return current
        }
        guard let current = current?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !current.isEmpty else {
            return incoming
        }
        let currentDate = caveParseISO(current)
        let incomingDate = caveParseISO(incoming)
        switch (currentDate, incomingDate) {
        case let (.some(currentDate), .some(incomingDate)):
            return incomingDate >= currentDate ? incoming : current
        case (nil, .some):
            return incoming
        case (.some, nil):
            return current
        case (nil, nil):
            return incoming
        }
    }

    private func activeTaskMutationsOverlaying(_ loadedTasks: [BoardCard]) -> [BoardCard] {
        guard !taskFieldGenerations.isEmpty else { return loadedTasks }

        let currentTasksByID = Dictionary(
            uniqueKeysWithValues: tasks.map { ($0.id, $0) }
        )
        var overlaidTasks = loadedTasks
        var loadedTaskIDs = Set<String>()

        for index in overlaidTasks.indices {
            let cardID = overlaidTasks[index].id
            loadedTaskIDs.insert(cardID)
            guard let activeFields = taskFieldGenerations[cardID]?.keys,
                  !activeFields.isEmpty,
                  let current = currentTasksByID[cardID] else { continue }

            for field in activeFields {
                switch field {
                case .status:
                    overlaidTasks[index].statusRaw = current.statusRaw
                case .priority:
                    overlaidTasks[index].priorityRaw = current.priorityRaw
                case .steps:
                    overlaidTasks[index].steps = current.steps
                case .notes:
                    overlaidTasks[index].notes = current.notes
                case .title:
                    overlaidTasks[index].title = current.title
                case .dates:
                    overlaidTasks[index].startDate = current.startDate
                    overlaidTasks[index].endDate = current.endDate
                case .projectId:
                    overlaidTasks[index].projectId = current.projectId
                case .sessionId:
                    overlaidTasks[index].sessionId = current.sessionId
                }
            }

            overlaidTasks[index].updatedAt = mergedTaskUpdatedAt(
                current: overlaidTasks[index].updatedAt,
                incoming: current.updatedAt
            )
        }

        let preservedMutatingCards = tasks.filter { card in
            !loadedTaskIDs.contains(card.id)
                && !(taskFieldGenerations[card.id]?.isEmpty ?? true)
        }
        return overlaidTasks + preservedMutatingCards
    }

    func setTaskStatus(_ card: BoardCard, _ status: CardStatus) async {
        if let task = requestTaskStatus(card, status) {
            await task.value
        }
    }

    private func performTaskStatusMutation(
        using client: any TaskFieldsUpdatingClient,
        cardId: String,
        status: CardStatus,
        mutation: TaskMutationToken
    ) async {
        defer { finishTaskMutation(mutation) }
        do {
            let updated = try await client.updateTask(
                cardId: cardId,
                status: status,
                priority: nil,
                steps: nil,
                notes: nil
            )
            // A newer write for this card already applied its own optimistic
            // state; landing this stale response would undo it.
            guard !Task.isCancelled else { return }
            guard applyTaskServerUpdate(updated, for: mutation) else { return }
            Haptics.tap()
            await LiveActivityManager.shared.reconcile(tasks)
            publishWidgetSnapshot()
        } catch {
            // Cancellation surfaces here as a thrown CancellationError. Reverting
            // on it would clobber the newer intent that did the cancelling.
            guard !Task.isCancelled else { return }
            guard revertTaskMutation(mutation) else { return }
            tasksError = error.localizedDescription
            reportRevert("update the task")
        }
    }

    /// Optimistically set a task's priority; reconcile/revert like status.
    func setTaskPriority(_ card: BoardCard, _ priority: CardPriority) async {
        if let task = requestTaskPriority(card, priority) {
            await task.value
        }
    }

    private func performTaskPriorityMutation(
        using client: any TaskFieldsUpdatingClient,
        cardId: String,
        priority: CardPriority,
        mutation: TaskMutationToken
    ) async {
        defer { finishTaskMutation(mutation) }
        do {
            let updated = try await client.updateTask(
                cardId: cardId,
                status: nil,
                priority: priority,
                steps: nil,
                notes: nil
            )
            guard !Task.isCancelled else { return }
            guard applyTaskServerUpdate(updated, for: mutation) else { return }
            Haptics.tap()
        } catch {
            guard !Task.isCancelled else { return }
            guard revertTaskMutation(mutation) else { return }
            tasksError = error.localizedDescription
            reportRevert("update the task")
        }
    }

    /// Toggle a checklist step's done flag, persisting the whole step list.
    func toggleStep(_ card: BoardCard, stepId: String) async {
        if let task = requestToggleTaskStep(card, stepId: stepId) {
            await task.value
        }
    }

    /// Append a new checklist step.
    func addStep(_ card: BoardCard, text: String) async {
        if let task = requestAddTaskStep(card, text: text) {
            await task.value
        }
    }

    /// Remove a checklist step.
    func deleteStep(_ card: BoardCard, stepId: String) async {
        if let task = requestDeleteTaskStep(card, stepId: stepId) {
            await task.value
        }
    }

    /// Move a step up (delta -1) or down (delta +1) in the list.
    func moveStep(_ card: BoardCard, stepId: String, by delta: Int) async {
        if let task = requestMoveTaskStep(card, stepId: stepId, by: delta) {
            await task.value
        }
    }

    /// Optimistically persist a new step list, reconciling with the server's
    /// echoed card (reverts on failure) — shared by add/delete/move.
    private func commitSteps(_ card: BoardCard, _ steps: [CardStep]) async {
        if let task = requestTaskSteps(card, steps) {
            await task.value
        }
    }

    private func performTaskStepsMutation(
        using client: any TaskFieldsUpdatingClient,
        cardId: String,
        steps: [CardStep],
        mutation: TaskMutationToken
    ) async {
        defer { finishTaskMutation(mutation) }
        do {
            let updated = try await client.updateTask(
                cardId: cardId,
                status: nil,
                priority: nil,
                steps: steps,
                notes: nil
            )
            guard !Task.isCancelled else { return }
            _ = applyTaskServerUpdate(updated, for: mutation)
        } catch {
            guard !Task.isCancelled else { return }
            guard revertTaskMutation(mutation) else { return }
            tasksError = error.localizedDescription
        }
    }

    /// Optimistically set a task's notes (pass "" to clear); reconcile/revert.
    func setTaskNotes(_ card: BoardCard, _ notes: String) async {
        if let task = requestTaskNotes(card, notes) {
            await task.value
        }
    }

    private func performTaskNotesMutation(
        using client: any TaskFieldsUpdatingClient,
        cardId: String,
        notes: String,
        mutation: TaskMutationToken
    ) async {
        defer { finishTaskMutation(mutation) }
        do {
            let updated = try await client.updateTask(
                cardId: cardId,
                status: nil,
                priority: nil,
                steps: nil,
                notes: notes
            )
            guard !Task.isCancelled else { return }
            _ = applyTaskServerUpdate(updated, for: mutation)
        } catch {
            guard !Task.isCancelled else { return }
            guard revertTaskMutation(mutation) else { return }
            tasksError = error.localizedDescription
        }
    }

    /// Optimistically rename a task; reconcile/revert like notes.
    func setTaskTitle(_ card: BoardCard, _ title: String) async {
        if let task = requestTaskTitle(card, title) {
            await task.value
        }
    }

    private func performTaskTitleMutation(
        using client: any TaskFieldsUpdatingClient,
        cardId: String,
        title: String,
        mutation: TaskMutationToken
    ) async {
        defer { finishTaskMutation(mutation) }
        do {
            let updated = try await client.updateTaskTitle(cardId: cardId, title: title)
            guard !Task.isCancelled else { return }
            _ = applyTaskServerUpdate(updated, for: mutation)
        } catch {
            guard !Task.isCancelled else { return }
            guard revertTaskMutation(mutation) else { return }
            tasksError = error.localizedDescription
        }
    }

    /// Optimistically set a task's start/due dates (date-only strings, nil to
    /// clear); reconcile/revert.
    func setTaskDates(_ card: BoardCard, start: String?, end: String?) async {
        if let task = requestTaskDates(card, start: start, end: end) {
            await task.value
        }
    }

    private func performTaskDatesMutation(
        using client: any TaskFieldsUpdatingClient,
        cardId: String,
        start: String?,
        end: String?,
        mutation: TaskMutationToken
    ) async {
        defer { finishTaskMutation(mutation) }
        do {
            let updated = try await client.updateTaskDates(cardId: cardId, startDate: start, endDate: end)
            guard !Task.isCancelled else { return }
            guard applyTaskServerUpdate(updated, for: mutation) else { return }
            Haptics.tap()
        } catch {
            guard !Task.isCancelled else { return }
            guard revertTaskMutation(mutation) else { return }
            tasksError = error.localizedDescription
            reportRevert("reschedule the task")
        }
    }

    /// Optimistically attach a projectless/unregistered task to a registered
    /// project, then reconcile with the server's echoed card. Reverts on
    /// failure and keeps the explicit server error visible in `tasksError`.
    func moveTaskToProject(_ card: BoardCard, project: ProjectInfo) async {
        if let task = requestTaskProjectMove(card, project: project) {
            await task.value
        }
    }

    private func performTaskProjectMutation(
        using client: any TaskProjectUpdatingClient,
        cardId: String,
        projectId: String,
        projectName: String,
        mutation: TaskMutationToken
    ) async {
        defer { finishTaskMutation(mutation) }
        let originalProjectContext = projectContext
        let originalProjectContextSelectionSource = projectContextSelectionSource
        do {
            let updated = try await client.updateTaskProject(cardId: cardId, projectId: projectId)
            guard !Task.isCancelled else { return }
            guard applyTaskServerUpdate(updated, for: mutation) else { return }
            if let repairIssue = await repairTaskChatScopeAfterProjectMove(cardId: cardId) {
                restoreProjectContextAfterTaskMoveFailure(
                    originalProjectContext,
                    source: originalProjectContextSelectionSource
                )
                tasksError = repairIssue
                reportTaskMoveRepairIssue(projectName: projectName, detail: repairIssue)
            } else {
                tasksError = nil
                reopenMovedTaskAfterProjectMoveIfNeeded(
                    cardId: cardId,
                    destinationProjectId: projectId,
                    previousCard: mutation.previous
                )
                showToast("Moved to \(projectName)", systemImage: "folder.badge.plus")
                Haptics.success()
            }
            publishWidgetSnapshot()
        } catch {
            guard !Task.isCancelled else { return }
            guard revertTaskMutation(mutation) else { return }
            restoreProjectContextAfterTaskMoveFailure(
                originalProjectContext,
                source: originalProjectContextSelectionSource
            )
            let message = error.localizedDescription
            tasksError = message
            reportTaskMoveRevert(message)
            publishWidgetSnapshot()
        }
    }

    private func reopenMovedTaskAfterProjectMoveIfNeeded(
        cardId: String,
        destinationProjectId: String,
        previousCard: BoardCard
    ) {
        let sourceWasRecovery = taskMoveRequiresExplicitTaskReopen(previousCard)
        let destinationContextDiffers = projectContext?.projectId != destinationProjectId
        guard sourceWasRecovery || destinationContextDiffers,
              let moved = tasks.first(where: { $0.id == cardId }),
              let destination = project(destinationProjectId) else {
            return
        }
        completeProjectNavigation(
            ProjectNavigationIntent(
                entity: .task(id: cardId),
                destination: .tasks,
                projectId: destinationProjectId
            ),
            context: .project(destination),
            card: moved
        )
    }

    private func taskMoveRequiresExplicitTaskReopen(_ previousCard: BoardCard) -> Bool {
        switch requestOpenContext(for: previousCard) {
        case .success(.unassigned):
            return true
        case .success(.project), .failure:
            return false
        }
    }

    private func restoreProjectContextAfterTaskMoveFailure(
        _ context: ProjectContext?,
        source: ProjectContextSelectionSource?
    ) {
        guard projectContext != context || projectContextSelectionSource != source else {
            return
        }
        applyProjectContextSelection(context, source: source)
        persistProjectContextSelection(context)
    }

    private func performTaskSessionMutation(
        using client: any TaskSessionUpdatingClient,
        cardId: String,
        sessionId: String?,
        mutation: TaskMutationToken
    ) async {
        defer { finishTaskMutation(mutation) }
        do {
            let updated = try await client.updateTaskSession(cardId: cardId, sessionId: sessionId)
            guard !Task.isCancelled else { return }
            _ = applyTaskServerUpdate(updated, for: mutation)
        } catch {
            guard !Task.isCancelled else { return }
            // Non-fatal: the local link still drives in-app navigation.
            _ = revertTaskMutation(mutation)
        }
    }

    private func reportTaskMoveRevert(_ message: String) {
        let detail = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = detail.isEmpty
            ? "Couldn’t move the task — reverted"
            : "Couldn’t move the task — reverted. \(detail)"
        showToast(text, systemImage: "exclamationmark.triangle.fill", style: .error)
        Haptics.error()
    }

    private func reportTaskMoveRepairIssue(projectName: String, detail: String) {
        let trimmedDetail = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = trimmedDetail.isEmpty
            ? "Moved to \(projectName). Couldn’t repair the previous chat link."
            : "Moved to \(projectName). \(trimmedDetail)"
        showToast(text, systemImage: "exclamationmark.triangle.fill", style: .warning)
        Haptics.error()
    }

    /// Optimistically remove a task, then DELETE it. Reinserts on failure.
    func deleteTask(_ card: BoardCard) async {
        guard let client, let index = tasks.firstIndex(where: { $0.id == card.id }) else { return }
        let removed = tasks[index]
        tasks.remove(at: index)
        do {
            try await client.deleteTask(cardId: card.id)
            Haptics.success()
        } catch {
            // `revertTask` edits a card that is still in the array, so it cannot
            // restore one that was removed: `applyTask` finds no index and
            // no-ops, silently dropping the task the delete failed to remove.
            reinsertTask(removed, at: index)
            tasksError = error.localizedDescription
            reportRevert("delete the task")
        }
    }

    /// Put an optimistically-removed card back at the position it held rather
    /// than at the end of the list. No-ops if it is already back.
    private func reinsertTask(_ card: BoardCard, at index: Int) {
        guard !tasks.contains(where: { $0.id == card.id }) else { return }
        tasks.insert(card, at: min(index, tasks.count))
    }

    private func applyTask(id: String, _ mutate: (inout BoardCard) -> Void) {
        guard let idx = tasks.firstIndex(where: { $0.id == id }) else { return }
        var card = tasks[idx]
        mutate(&card)
        tasks[idx] = card
    }

    // MARK: - Project context actions

    struct ProjectContextFailureSurfaces: OptionSet, Sendable {
        let rawValue: Int

        static let projects = Self(rawValue: 1 << 0)
        static let familiars = Self(rawValue: 1 << 1)
    }

    private struct ProjectContextSelectionResolution {
        var context: ProjectContext?
        var source: ProjectContextSelectionSource?
        var persistSelection: Bool
        var fetchedSessions: [SessionRow]? = nil
        var fetchedTasks: [BoardCard]? = nil
        var sessionsError: String? = nil
        var tasksError: String? = nil
        var sessionsLoadToken: CoordinatedLoadToken? = nil
        var tasksLoadToken: CoordinatedLoadToken? = nil

        var usedHistoryFallback: Bool {
            sessionsError != nil || tasksError != nil
        }
    }

    private func awaitThreadHydration() async {
        guard !threadsHydrated else { return }
        _ = await hydrateThreadsTask?.value
    }

    private func currentUserProjectContext(in projects: [ProjectInfo]) -> ProjectContext? {
        guard projectContextSelectionSource == .user,
              let projectContext else { return nil }
        switch projectContext {
        case .project(let project):
            guard let current = projects.first(where: { $0.id == project.id }) else { return nil }
            return .project(current)
        case .unassigned:
            return .unassigned
        }
    }

    private func explicitProjectContextSelectionCandidate(
        in projects: [ProjectInfo]
    ) -> (context: ProjectContext?, source: ProjectContextSelectionSource?) {
        if let currentUserProjectContext = currentUserProjectContext(in: projects) {
            return (currentUserProjectContext, .user)
        }
        if let restoredProjectContext = restoredProjectContext(in: projects) {
            return (restoredProjectContext, .restored)
        }
        return (nil, nil)
    }

    private func selectionThreadsForProjectContextSelection(
        from threads: [ChatThread],
        sessions: [SessionRow]
    ) -> [ChatThread] {
        guard !threads.isEmpty, !sessions.isEmpty else { return threads }
        let sessionsByID = Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) })
        return threads.map { thread in
            guard let projectRoot = authoritativeProjectRoot(
                for: thread,
                using: sessionsByID
            ),
            projectRoot != thread.projectRoot else {
                return thread
            }
            let projected = ChatThread(
                id: thread.id,
                title: thread.title,
                familiarIds: thread.familiarIds,
                sessionIds: thread.sessionIds,
                projectRoot: projectRoot
            )
            projected.updatedAt = thread.updatedAt
            return projected
        }
    }

    private func resolvedProjectContextSelection(
        explicitSelection: (context: ProjectContext?, source: ProjectContextSelectionSource?),
        projects: [ProjectInfo],
        threads: [ChatThread],
        sessions: [SessionRow],
        tasks: [BoardCard],
        allowAlphabeticalFallback: Bool = true
    ) -> ProjectContext? {
        resolvedProjectContextSelectionDecision(
            explicitSelection: explicitSelection,
            projects: projects,
            threads: threads,
            sessions: sessions,
            tasks: tasks,
            allowAlphabeticalFallback: allowAlphabeticalFallback
        ).context
    }

    private func resolvedProjectContextSelectionDecision(
        explicitSelection: (context: ProjectContext?, source: ProjectContextSelectionSource?),
        projects: [ProjectInfo],
        threads: [ChatThread],
        sessions: [SessionRow],
        tasks: [BoardCard],
        allowAlphabeticalFallback: Bool = true
    ) -> ProjectContext.SelectionDecision {
        if explicitSelection.source == .user, explicitSelection.context == .unassigned {
            return .init(context: .unassigned, reason: .suppliedSelection)
        }
        return ProjectContext.selectionDecision(
            restored: explicitSelection.context,
            projects: projects,
            threads: threads,
            sessions: sessions,
            tasks: tasks,
            allowAlphabeticalFallback: allowAlphabeticalFallback
        )
    }

    private func projectContextSelectionResolution(
        explicitSelection: (context: ProjectContext?, source: ProjectContextSelectionSource?),
        projects: [ProjectInfo],
        threads: [ChatThread],
        sessions: [SessionRow],
        tasks: [BoardCard],
        allowAlphabeticalFallback: Bool = true,
        fetchedSessions: [SessionRow]? = nil,
        fetchedTasks: [BoardCard]? = nil,
        sessionsError: String? = nil,
        tasksError: String? = nil,
        sessionsLoadToken: CoordinatedLoadToken? = nil,
        tasksLoadToken: CoordinatedLoadToken? = nil
    ) -> ProjectContextSelectionResolution {
        let context = resolvedProjectContextSelection(
            explicitSelection: explicitSelection,
            projects: projects,
            threads: threads,
            sessions: sessions,
            tasks: tasks,
            allowAlphabeticalFallback: allowAlphabeticalFallback
        )
        let source = derivedProjectContextSelectionSource(
            explicitSelection: explicitSelection,
            resolvedContext: context
        )
        return ProjectContextSelectionResolution(
            context: context,
            source: source,
            persistSelection: source != .user && source != .restored,
            fetchedSessions: fetchedSessions,
            fetchedTasks: fetchedTasks,
            sessionsError: sessionsError,
            tasksError: tasksError,
            sessionsLoadToken: sessionsLoadToken,
            tasksLoadToken: tasksLoadToken
        )
    }

    private func immediateProjectContextSelectionIsFinal(
        _ decision: ProjectContext.SelectionDecision,
        hasUsableSessions: Bool,
        needsAuthoritativeSessionHistory: Bool
    ) -> Bool {
        guard !needsAuthoritativeSessionHistory else { return false }
        switch decision.reason {
        case .suppliedSelection, .localThread, .serverSession:
            return decision.context != nil
        case .taskHistory:
            return hasUsableSessions
        case .alphabeticalFallback, .unassignedFallback, .none:
            return false
        }
    }

    private func shouldFetchTaskHistoryForProjectContextSelection(
        _ decision: ProjectContext.SelectionDecision,
        hasUsableTasks: Bool
    ) -> Bool {
        guard !hasUsableTasks else { return false }
        switch decision.reason {
        case .suppliedSelection, .localThread, .serverSession, .taskHistory:
            return false
        case .alphabeticalFallback, .unassignedFallback, .none:
            return true
        }
    }

    private func needsAuthoritativeSessionHistoryForProjectContextSelection(
        explicitSelection: (context: ProjectContext?, source: ProjectContextSelectionSource?),
        projects: [ProjectInfo]
    ) -> Bool {
        guard explicitSelection.source != .user,
              explicitSelection.context == .unassigned else { return false }
        return threads.contains { thread in
            !thread.sessionIds.values.compactMap(normalizedSessionID).isEmpty
                && ProjectContext.registeredProject(
                    for: thread.projectRoot,
                    in: projects
                ) == nil
        }
    }

    private func resolveProjectContextSelection(
        using client: any ProjectContextLoadingClient,
        projects nextProjects: [ProjectInfo],
        loadNonce: UInt64,
        navigationGeneration: UInt64?
    ) async throws -> ProjectContextSelectionResolution {
        await awaitThreadHydration()
        guard loadNonce == projectContextLoadNonce else { throw CancellationError() }

        let haveUsableSessions = sessionsLoaded && sessionsError == nil
        let haveUsableTasks = tasksLoaded && tasksError == nil
        var resolvedSessions = haveUsableSessions ? serverSessions : []
        var resolvedTasks = haveUsableTasks ? tasks : []
        var explicitSelection = explicitProjectContextSelectionCandidate(in: nextProjects)
        let needsAuthoritativeSessionHistory = !haveUsableSessions
            && needsAuthoritativeSessionHistoryForProjectContextSelection(
                explicitSelection: explicitSelection,
                projects: nextProjects
            )
        let immediateThreads = selectionThreadsForProjectContextSelection(
            from: threads,
            sessions: resolvedSessions
        )

        let immediateDecision = resolvedProjectContextSelectionDecision(
            explicitSelection: explicitSelection,
            projects: nextProjects,
            threads: immediateThreads,
            sessions: resolvedSessions,
            tasks: resolvedTasks,
            allowAlphabeticalFallback: false
        )
        if immediateProjectContextSelectionIsFinal(
            immediateDecision,
            hasUsableSessions: haveUsableSessions,
            needsAuthoritativeSessionHistory: needsAuthoritativeSessionHistory
        ) {
            return projectContextSelectionResolution(
                explicitSelection: explicitSelection,
                projects: nextProjects,
                threads: immediateThreads,
                sessions: resolvedSessions,
                tasks: resolvedTasks,
                allowAlphabeticalFallback: false
            )
        }

        // Cold/default selection is intentionally staged: local threads first,
        // then eligible server sessions, then task history only if sessions
        // succeeded without identifying a registered project.
        var fetchedSessions: [SessionRow]?
        var sessionsError: String?
        var sessionsLoadToken: CoordinatedLoadToken?
        if !haveUsableSessions {
            let loadedSessions = await coordinatedSessionsLoad(
                using: client,
                generation: navigationGeneration
            )
            sessionsLoadToken = loadedSessions.token
            switch loadedSessions.result {
            case .success(let nextSessions):
                resolvedSessions = nextSessions
                fetchedSessions = nextSessions
            case .failure(let error):
                sessionsError = handleSurfaceError(error)
            }
        }
        guard loadNonce == projectContextLoadNonce else { throw CancellationError() }

        explicitSelection = explicitProjectContextSelectionCandidate(in: nextProjects)
        let postSessionThreads = selectionThreadsForProjectContextSelection(
            from: threads,
            sessions: resolvedSessions
        )
        if let sessionsError {
            return projectContextSelectionResolution(
                explicitSelection: explicitSelection,
                projects: nextProjects,
                threads: postSessionThreads,
                sessions: resolvedSessions,
                tasks: [],
                fetchedSessions: fetchedSessions,
                sessionsError: sessionsError,
                sessionsLoadToken: sessionsLoadToken
            )
        }

        let postSessionDecision = resolvedProjectContextSelectionDecision(
            explicitSelection: explicitSelection,
            projects: nextProjects,
            threads: postSessionThreads,
            sessions: resolvedSessions,
            tasks: [],
            allowAlphabeticalFallback: false
        )

        var fetchedTasks: [BoardCard]?
        var tasksError: String?
        var tasksLoadToken: CoordinatedLoadToken?
        if shouldFetchTaskHistoryForProjectContextSelection(
            postSessionDecision,
            hasUsableTasks: haveUsableTasks
        ) {
            let loadedTasks = await coordinatedTasksLoad(
                using: client,
                generation: navigationGeneration
            )
            tasksLoadToken = loadedTasks.token
            switch loadedTasks.result {
            case .success(let nextTasks):
                resolvedTasks = nextTasks
                fetchedTasks = nextTasks
            case .failure(let error):
                tasksError = handleSurfaceError(error)
            }
        }
        guard loadNonce == projectContextLoadNonce else { throw CancellationError() }

        explicitSelection = explicitProjectContextSelectionCandidate(in: nextProjects)
        let finalThreads = selectionThreadsForProjectContextSelection(
            from: threads,
            sessions: resolvedSessions
        )
        return projectContextSelectionResolution(
            explicitSelection: explicitSelection,
            projects: nextProjects,
            threads: finalThreads,
            sessions: resolvedSessions,
            tasks: resolvedTasks,
            fetchedSessions: fetchedSessions,
            fetchedTasks: fetchedTasks,
            tasksError: tasksError,
            sessionsLoadToken: sessionsLoadToken,
            tasksLoadToken: tasksLoadToken
        )
    }

    private func applyProjectContextSelection(
        _ context: ProjectContext?,
        source: ProjectContextSelectionSource?
    ) {
        projectContext = context
        projectContextSelectionSource = source
        if let context {
            seedFamiliarViews(projectFamiliars.map(\.id), in: context)
        }
    }

    private func derivedProjectContextSelectionSource(
        explicitSelection: (context: ProjectContext?, source: ProjectContextSelectionSource?),
        resolvedContext: ProjectContext?
    ) -> ProjectContextSelectionSource? {
        if resolvedContext == explicitSelection.context {
            return explicitSelection.source
        }
        if resolvedContext == nil {
            return nil
        }
        return .automatic
    }

    private func refreshProjectContextSelectionFromCurrentData() {
        guard projectsLoaded else { return }
        let explicitSelection = explicitProjectContextSelectionCandidate(in: projects)
        let resolvedContext = resolvedProjectContextSelection(
            explicitSelection: explicitSelection,
            projects: projects,
            threads: selectionThreadsForProjectContextSelection(
                from: threads,
                sessions: serverSessions
            ),
            sessions: serverSessions,
            tasks: tasks
        )
        let resolvedSource = derivedProjectContextSelectionSource(
            explicitSelection: explicitSelection,
            resolvedContext: resolvedContext
        )
        guard resolvedContext != projectContext || resolvedSource != projectContextSelectionSource
        else { return }
        applyProjectContextSelection(resolvedContext, source: resolvedSource)
        if resolvedSource != .user && resolvedSource != .restored {
            persistProjectContextSelection(resolvedContext)
        }
        _ = resolvePendingProjectNavigationIntent()
    }

    func loadProjectContext() async {
        guard let client = coreResourceClient else { return }
        await loadProjectContext(using: client)
    }

    func loadProjects() async {
        guard let client = coreResourceClient else { return }
        await loadProjectContext(using: client, mirrorFailuresTo: [.projects])
    }

    func loadProjectContext(
        using client: any ProjectContextLoadingClient,
        mirrorFailuresTo mirroredSurfaces: ProjectContextFailureSurfaces = []
    ) async {
        let navigationGeneration = currentProjectNavigationConnectionGeneration()
        noteProjectNavigationSurfaceAttempt(.projects, generation: navigationGeneration)
        projectContextLoadNonce &+= 1
        let loadNonce = projectContextLoadNonce
        let hadMembership = projectMembershipLoaded

        do {
            async let loadedProjects = client.projects()
            async let loadedGrants = client.projectGrants()
            async let loadedFamiliars = client.familiars()

            let nextProjects = try await loadedProjects
            let grants = try await loadedGrants
            let nextFamiliars = try await loadedFamiliars

            guard loadNonce == projectContextLoadNonce else { return }

            let membership = ProjectMembershipIndex.build(
                projects: nextProjects,
                familiars: nextFamiliars,
                directGrants: grants.grants ?? [],
                groups: grants.accessGroups ?? [],
                supremeFamiliarId: grants.supremeFamiliarId
            )
            let selectionResolution = try await resolveProjectContextSelection(
                using: client,
                projects: nextProjects,
                loadNonce: loadNonce,
                navigationGeneration: navigationGeneration
            )

            guard loadNonce == projectContextLoadNonce else { return }

            projects = nextProjects
            projectsError = nil
            projectsLoaded = true
            noteProjectNavigationSurfaceSuccess(.projects, generation: navigationGeneration)
            familiars = nextFamiliars
            seedFamiliarViews(nextFamiliars.map(\.id), in: nil)
            familiarsError = nil
            familiarsLoaded = true
            projectMembership = membership
            projectMembershipLoaded = true
            if let fetchedSessions = selectionResolution.fetchedSessions,
               let token = selectionResolution.sessionsLoadToken,
               coordinatedLoadShouldApply(token, state: sessionsLoadState) {
                markCoordinatedLoadApplied(token, state: &sessionsLoadState)
                applyLoadedSessions(
                    fetchedSessions,
                    refreshProjectContextSelection: false
                )
                noteProjectNavigationSurfaceAttempt(.sessions, generation: navigationGeneration)
                noteProjectNavigationSurfaceSuccess(.sessions, generation: navigationGeneration)
            }
            if let sessionsError = selectionResolution.sessionsError,
               let token = selectionResolution.sessionsLoadToken,
               coordinatedLoadShouldApply(token, state: sessionsLoadState) {
                markCoordinatedLoadApplied(token, state: &sessionsLoadState)
                noteProjectNavigationSurfaceAttempt(.sessions, generation: navigationGeneration)
                noteProjectNavigationSurfaceFailure(.sessions, generation: navigationGeneration)
                self.sessionsError = sessionsError
            }
            if let fetchedTasks = selectionResolution.fetchedTasks,
               let token = selectionResolution.tasksLoadToken,
               coordinatedLoadShouldApply(token, state: tasksLoadState) {
                markCoordinatedLoadApplied(token, state: &tasksLoadState)
                tasks = activeTaskMutationsOverlaying(fetchedTasks)
                tasksError = nil
                tasksLoaded = true
                noteProjectNavigationSurfaceAttempt(.tasks, generation: navigationGeneration)
                noteProjectNavigationSurfaceSuccess(.tasks, generation: navigationGeneration)
                await LiveActivityManager.shared.reconcile(tasks)
            }
            if let tasksError = selectionResolution.tasksError,
               let token = selectionResolution.tasksLoadToken,
               coordinatedLoadShouldApply(token, state: tasksLoadState) {
                markCoordinatedLoadApplied(token, state: &tasksLoadState)
                noteProjectNavigationSurfaceAttempt(.tasks, generation: navigationGeneration)
                noteProjectNavigationSurfaceFailure(.tasks, generation: navigationGeneration)
                self.tasksError = tasksError
            }
            // Any fallback selection derived from fetched history must come
            // from the freshest coordinated snapshot for this connection
            // generation; a superseded snapshot leaves the current selection in
            // place and lets newer state drive the recompute below.
            let canUseSessionsFallbackSelection = coordinatedSelectionSnapshotIsCurrentFreshest(
                selectionResolution.sessionsLoadToken,
                state: sessionsLoadState
            )
            let canUseTasksFallbackSelection = coordinatedSelectionSnapshotIsCurrentFreshest(
                selectionResolution.tasksLoadToken,
                state: tasksLoadState
            )

            if selectionResolution.usedHistoryFallback
                && canUseSessionsFallbackSelection
                && canUseTasksFallbackSelection {
                applyProjectContextSelection(
                    selectionResolution.context,
                    source: selectionResolution.source
                )
                if selectionResolution.persistSelection {
                    persistProjectContextSelection(selectionResolution.context)
                }
            } else {
                refreshProjectContextSelectionFromCurrentData()
            }
            projectContextError = nil
            _ = resolvePendingProjectNavigationIntent(attemptHydrationIfNeeded: true)
            publishWidgetSnapshot()
        } catch {
            guard loadNonce == projectContextLoadNonce else { return }
            let message = handleSurfaceError(error)
            noteProjectNavigationSurfaceFailure(.projects, generation: navigationGeneration)
            projectContextError = message
            if mirroredSurfaces.contains(.projects) {
                projectsError = message
            }
            if mirroredSurfaces.contains(.familiars) {
                familiarsError = message
            }
            if !hadMembership {
                applyProjectContextSelection(nil, source: nil)
                if projects.isEmpty { projectsError = message }
                if familiars.isEmpty { familiarsError = message }
            }
            _ = resolvePendingProjectNavigationIntent()
        }
    }

    private var scopedProjectContextStorageKey: String? {
        Self.projectContextStorageKey(for: connection)
    }

    private func clearLegacyProjectContextSelection() {
        projectContextDefaults.removeObject(forKey: Self.legacyProjectContextStorageKey)
    }

    private func restoredProjectContext(in projects: [ProjectInfo]) -> ProjectContext? {
        clearLegacyProjectContextSelection()
        guard let storageKey = scopedProjectContextStorageKey,
              let rawValue = projectContextDefaults.string(forKey: storageKey)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
              !rawValue.isEmpty else { return nil }
        if rawValue == Self.unassignedProjectContextStorageValue {
            return .unassigned
        }
        let projectPrefix = "project:"
        guard rawValue.hasPrefix(projectPrefix) else { return nil }
        let projectID = String(rawValue.dropFirst(projectPrefix.count))
        guard !projectID.isEmpty,
              let project = projects.first(where: { $0.id == projectID }) else { return nil }
        return .project(project)
    }

    private func persistProjectContextSelection(_ context: ProjectContext?) {
        clearLegacyProjectContextSelection()
        guard let storageKey = scopedProjectContextStorageKey else { return }
        switch context {
        case .project(let project):
            projectContextDefaults.set(ProjectContext.project(project).id, forKey: storageKey)
        case .unassigned:
            projectContextDefaults.set(
                Self.unassignedProjectContextStorageValue,
                forKey: storageKey
            )
        case nil:
            projectContextDefaults.removeObject(forKey: storageKey)
        }
    }

    // MARK: - Reminders

    private func reconcileReminderNotifications(
        requestAuthorizationIfNeeded: Bool = false
    ) async {
        if requestAuthorizationIfNeeded {
            await reminderNotificationScheduler.requestAuthorizationIfNeeded()
        }
        await reminderNotificationScheduler.sync(reminders)
    }

    private func withReminderNotificationReconciliation(
        requestAuthorizationIfNeeded: Bool = false,
        _ operation: () async -> Void
    ) async {
        await operation()
        await reconcileReminderNotifications(requestAuthorizationIfNeeded: requestAuthorizationIfNeeded)
    }

    func loadReminders() async {
        guard let client = reminderClient else { return }
        do {
            reminders = try await client.reminders()
            remindersError = nil
        } catch {
            remindersError = handleSurfaceError(error)
        }
        remindersLoaded = true
        publishWidgetSnapshot()
        // Mirror upcoming reminders as on-device notifications so the phone buzzes
        // when one is due. Asks for permission the first time reminders load.
        await reconcileReminderNotifications(requestAuthorizationIfNeeded: true)
    }

    /// Publish a compact snapshot to the shared App Group so widgets/controls can
    /// render task counts without their own network access. Cheap; called whenever
    /// reminders/tasks load or change.
    func publishWidgetSnapshot() {
        let now = Date()
        let cal = Calendar.current
        let endOfToday = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now)) ?? now
        let due = tasks.filter { $0.status != .done }.filter { card in
            guard let d = caveParseISO(card.endDate) else { return false }
            return d < endOfToday
        }.count
        let running = tasks.filter { $0.status == .running }.count
        WidgetSnapshotStore.write(WidgetSnapshot(
            dueTaskCount: due,
            runningTaskCount: running,
            projectContextID: projectContext?.id,
            updatedAt: now
        ), defaults: widgetSnapshotDefaults)
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Deep links (home-screen widget)

    /// Surface a widget/control tap targets via the `covencave://` URL scheme.
    /// Task-related entry points deep-link to `.tasks`.
    enum DeepLink: String { case tasks, reminders }

    var deepLink: DeepLink?
    private(set) var pendingPairingIntent: PairingIntent?

    func handleDeepLink(_ url: URL) {
        guard url.scheme == "covencave" else { return }
        // covencave://connect?host=…&token=… — the desktop's pairing invite.
        // Queue it for the app-level lock/approval processor rather than
        // mutating credentials beneath a lock or authentication prompt.
        if url.host == "connect" {
            guard let invite = CaveInvite.parse(url.absoluteString) else { return }
            pendingPairingIntent = PairingIntent(host: invite.host, token: invite.token)
            return
        }
        guard let intent = ProjectNavigationIntent(url: url) else { return }
        if url.host == DeepLink.reminders.rawValue {
            deepLink = .reminders
        } else if intent.resolvedDestination == .tasks {
            deepLink = .tasks
        } else {
            deepLink = nil
        }
        pendingProjectNavigationIntent = intent
        lastProjectNavigationFailure = nil
        if resolvePendingProjectNavigationIntent(attemptHydrationIfNeeded: true) {
            return
        }
    }

    @discardableResult
    func consumePendingPairingIntent(matching id: UUID) -> Bool {
        takePendingPairingIntent(matching: id) != nil
    }

    func takePendingPairingIntent(matching id: UUID) -> PairingIntent? {
        guard let intent = pendingPairingIntent, intent.id == id else { return nil }
        pendingPairingIntent = nil
        return intent
    }


    /// Optimistically remove reminders, then delete them in ONE round trip
    /// (cave-ioswipe.2). Previously this was N sequential DELETEs that reverted
    /// the whole batch on any failure — so item 20 failing silently undid the
    /// optimistic removal of items 1-19 whose server-side deletes had already
    /// succeeded, leaving the UI disagreeing with the server. Now only the ids
    /// the server did NOT confirm come back.
    func deleteReminders(_ ids: Set<String>) async {
        guard let client = reminderClient, !ids.isEmpty else { return }
        await withReminderNotificationReconciliation {
            let previous = reminders
            reminders.removeAll { ids.contains($0.id) }
            do {
                let outcome = try await client.bulkInboxAction("delete", ids: Array(ids))
                let deleted = Set(outcome.deletedIds)
                let missed = ids.subtracting(deleted)
                guard !missed.isEmpty else { Haptics.success(); return }
                // Restore only what did not take effect, preserving list order.
                reminders = previous.filter { !deleted.contains($0.id) }
                reportPartial(missed.count, of: ids.count, verb: "delete")
            } catch {
                reminders = previous
                remindersError = error.localizedDescription
                reportRevert(ids.count == 1 ? "delete the reminder" : "delete the reminders")
            }
        }
    }

    func markReminderDone(_ reminder: Reminder) async {
        await reminderAction(reminder, optimistic: "done") { try await $0.markReminderDone(id: reminder.id) }
    }
    func dismissReminder(_ reminder: Reminder) async {
        await reminderAction(reminder, optimistic: "dismissed") { try await $0.dismissReminder(id: reminder.id) }
    }
    func snoozeReminder(_ reminder: Reminder, minutes: Int) async {
        await reminderAction(reminder, optimistic: "snoozed") { try await $0.snoozeReminder(id: reminder.id, minutes: minutes) }
    }

    /// Optimistically set a reminder's status, run the server action, reconcile
    /// with the echoed item, and revert on failure.
    private func reminderAction(_ reminder: Reminder, optimistic: String,
                                _ call: (any ReminderManagingClient) async throws -> Reminder?) async {
        guard let client = reminderClient else { return }
        await withReminderNotificationReconciliation {
            let previous = reminders
            applyReminder(id: reminder.id) { $0.status = optimistic }
            do {
                if let updated = try await call(client) {
                    applyReminder(id: reminder.id) { $0 = updated }
                }
                Haptics.success()
            } catch {
                reminders = previous
                remindersError = error.localizedDescription
                reportRevert("update the reminder")
            }
        }
    }

    // MARK: - Bulk reminder actions

    func markRemindersDone(_ ids: Set<String>) async {
        await bulkServerAction(ids, optimistic: "done", action: "done", verb: "mark done")
    }
    func dismissReminders(_ ids: Set<String>) async {
        await bulkServerAction(ids, optimistic: "dismissed", action: "dismiss", verb: "dismiss")
    }

    /// Snooze is the one bulk action WITHOUT a server counterpart: the bulk
    /// endpoint has no `snooze` action and no slot for its `minutes` argument.
    /// The bead's acceptance criteria allow "one round trip OR bounded
    /// concurrency", so this fans out with a small in-flight cap rather than
    /// extending a request-guarded API surface as a side effect of a client fix.
    func snoozeReminders(_ ids: Set<String>, minutes: Int) async {
        await boundedReminderFanOut(ids, optimistic: "snoozed", verb: "snooze") {
            try await $0.snoozeReminder(id: $1, minutes: minutes)
        }
    }

    /// One round trip for the actions the bulk endpoint supports. Items echoed
    /// in `updated` succeeded; ids absent from it did not take effect and are
    /// the only ones reverted — the old all-or-nothing revert made the UI
    /// disagree with a server that had already applied most of the batch.
    /// `verb` is what the user is told, and it is passed rather than derived
    /// from `action` because the two are not the same vocabulary: the wire
    /// action is "done", the sentence needs "mark done".
    private func bulkServerAction(_ ids: Set<String>, optimistic: String, action: String, verb: String) async {
        guard let client = reminderClient, !ids.isEmpty else { return }
        await withReminderNotificationReconciliation {
            let previous = reminders
            for id in ids { applyReminder(id: id) { $0.status = optimistic } }
            do {
                let outcome = try await client.bulkInboxAction(action, ids: Array(ids))
                var confirmed = Set<String>()
                for item in outcome.updated {
                    applyReminder(id: item.id) { $0 = item }
                    confirmed.insert(item.id)
                }
                for id in outcome.deletedIds { confirmed.insert(id) }
                let missed = ids.subtracting(confirmed)
                guard !missed.isEmpty else { Haptics.success(); return }
                revert(missed, to: previous)
                reportPartial(missed.count, of: ids.count, verb: verb)
            } catch {
                reminders = previous
                remindersError = error.localizedDescription
                reportRevert("update the reminders")
            }
        }
    }

    /// Bounded concurrent fan-out for actions with no bulk endpoint. Caps
    /// in-flight requests so a large selection cannot open one socket per item,
    /// and reverts only the items that actually failed.
    private static let reminderFanOutWidth = 4

    private func boundedReminderFanOut(
        _ ids: Set<String>,
        optimistic: String,
        verb: String,
        _ call: @escaping @Sendable (any ReminderManagingClient, String) async throws -> Reminder?,
    ) async {
        guard let client = reminderClient, !ids.isEmpty else { return }
        await withReminderNotificationReconciliation {
            let previous = reminders
            for id in ids { applyReminder(id: id) { $0.status = optimistic } }

            let ordered = Array(ids)
            let width = min(Self.reminderFanOutWidth, ordered.count)
            let results = await withTaskGroup(of: (String, Reminder?, Bool).self) { group -> [(String, Reminder?, Bool)] in
                var next = 0
                func addTask() {
                    guard next < ordered.count else { return }
                    let id = ordered[next]
                    next += 1
                    group.addTask {
                        do { return (id, try await call(client, id), true) }
                        catch { return (id, nil, false) }
                    }
                }
                for _ in 0..<width { addTask() }
                var out: [(String, Reminder?, Bool)] = []
                while let finished = await group.next() {
                    out.append(finished)
                    addTask()   // keep exactly `width` in flight
                }
                return out
            }

            var failed = Set<String>()
            for (id, updated, ok) in results {
                if ok {
                    if let updated { applyReminder(id: id) { $0 = updated } }
                } else {
                    failed.insert(id)
                }
            }
            guard !failed.isEmpty else { Haptics.success(); return }
            revert(failed, to: previous)
            reportPartial(failed.count, of: ids.count, verb: verb)
        }
    }

    /// Put back only the named ids, leaving successful siblings applied.
    private func revert(_ ids: Set<String>, to previous: [Reminder]) {
        for id in ids {
            guard let old = previous.first(where: { $0.id == id }) else { continue }
            if let idx = reminders.firstIndex(where: { $0.id == id }) {
                reminders[idx] = old
            } else {
                reminders.append(old)
            }
        }
    }

    private func applyReminder(id: String, _ mutate: (inout Reminder) -> Void) {
        guard let idx = reminders.firstIndex(where: { $0.id == id }) else { return }
        var r = reminders[idx]; mutate(&r); reminders[idx] = r
    }


    // MARK: - Connection lifecycle

    func configure(host: String, token: String? = nil) async {
        let conn = CaveConnection(host: host)
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let hostIsExplicitURL = trimmedHost.lowercased().hasPrefix("http://") || trimmedHost.lowercased().hasPrefix("https://")
        let hostHasExplicitPort = !hostIsExplicitURL && trimmedHost.contains(":")
        let isSameEndpoint = (hostIsExplicitURL || hostHasExplicitPort)
            ? (connection?.baseURL == conn.baseURL)
            : (connection?.baseURL?.host?.lowercased() == conn.baseURL?.host?.lowercased())
        if let token {
            CaveConnection.saveAccessToken(token, for: conn.baseURL)
        } else if CaveConnection.shouldClearStoredCredential(
            suppliedToken: token,
            isSameEndpoint: isSameEndpoint,
            nextURL: conn.baseURL
        ) {
            // Never retain a credential when an uncredentialed configuration
            // changes authority or downgrades the same authority to remote HTTP.
            CaveConnection.saveAccessToken(nil)
        }
        advanceProjectNavigationConnectionGeneration()
        if !isSameEndpoint {
            resetHostScopedStateForNewConnection()
        }

        connection = conn
        conn.save(defaults: projectContextDefaults)
        // A probe of the previous endpoint must not be joined as this
        // configuration's outcome.
        await refreshCoordinator.cancelActiveRefresh()
        await refreshConnection()
    }

    private func resetHostScopedStateForNewConnection() {
        invalidateProjectNavigationHydrations()
        invalidateProjectContextLoads()
        familiars = []
        familiarsError = nil
        familiarsLoaded = false
        sessionsLoaded = false
        tasks = []
        tasksError = nil
        tasksLoaded = false
        reminders = []
        remindersError = nil
        remindersLoaded = false
        projects = []
        projectsError = nil
        projectsLoaded = false
        applyProjectContextSelection(nil, source: nil)
        projectContextError = nil
        projectMembership = ProjectMembershipIndex()
        projectMembershipLoaded = false
        chrome = .fallback
        publishedThemeId = nil
        publishedMode = nil
    }

    func disconnect() {
        // An in-flight probe's outcome is moot once the endpoint is gone; the
        // post-probe `connection != nil` guard in refreshConnection catches
        // any that already resolved.
        let coordinator = refreshCoordinator
        Task { await coordinator.cancelActiveRefresh() }
        advanceProjectNavigationConnectionGeneration()
        invalidateProjectNavigationHydrations()
        invalidateProjectContextLoads()
        CaveConnection.clear(defaults: projectContextDefaults)
        connection = nil
        familiars = []
        familiarsLoaded = false
        applyProjectContextSelection(nil, source: nil)
        projectContextError = nil
        projectMembership = ProjectMembershipIndex()
        projectMembershipLoaded = false
        connectionState = .unconfigured
    }

    private func invalidateProjectContextLoads() {
        projectContextLoadNonce &+= 1
    }

    func startConnectionSupervisor() {
        guard !connectionMonitorStarted else { return }
        connectionMonitorStarted = true
        connectionMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor [weak self] in
                guard let self, self.connection != nil else { return }
                await self.recoverConnectionInBackground()
            }
        }
        connectionMonitor.start(queue: connectionMonitorQueue)
    }

    /// Quiet: the state only changes on an outcome, so a healthy path change
    /// (Wi-Fi ↔ LTE) doesn't blink the UI through `.checking` — which would
    /// flash the reconnect pill over a perfectly good primary destination.
    func recoverConnectionInBackground() async {
        guard connection != nil else { connectionState = .unconfigured; return }
        await refreshConnection(reloadLoadedSurfaces: true, quiet: true)
    }

    /// Any surface has completed a load — real data or an intentional empty
    /// state — so the primary shell is worth keeping mounted through a
    /// connection drop (RootView shows the reconnect pill over it instead of
    /// tearing down to the Connect screen).
    var hasLoadedSurfaces: Bool {
        familiarsLoaded || sessionsLoaded || tasksLoaded || remindersLoaded || projectsLoaded
    }

    private var shouldReloadLoadedSurfaces: Bool { hasLoadedSurfaces }
    private var loadedProjectContextFailureSurfaces: ProjectContextFailureSurfaces {
        var surfaces: ProjectContextFailureSurfaces = []
        if projectsLoaded {
            surfaces.insert(.projects)
        }
        if familiarsLoaded {
            surfaces.insert(.familiars)
        }
        return surfaces
    }
    /// A first shell mount waits for a successfully loaded membership snapshot
    /// plus either a concrete selection or the intentional "no projects yet"
    /// empty state (`projectsLoaded && projects.isEmpty`).
    private var isProjectContextReadyForShellGate: Bool {
        guard projectMembershipLoaded else { return false }
        return projectContext != nil || (projectsLoaded && projects.isEmpty)
    }

    private func pairingMessage() -> String {
        CaveConnection.accessToken == nil
            ? "This desktop requires pairing. Open Cave on the desktop → “Open on phone”, then scan the QR code or paste the invite link here."
            : "Your pairing has expired. Open Cave on the desktop → “Open on phone” and scan the QR code (or paste the invite link) to pair again."
    }

    private func handleSurfaceError(_ error: Error) -> String {
        if CaveError.isAuthFailure(error) {
            connectionState = .needsAuth(pairingMessage())
        } else if connectionState == .connected {
            scheduleAutoRecover()
        }
        return error.localizedDescription
    }

    /// Last time a failed surface load triggered an automatic reconnect —
    /// bounds the recovery loop so cascading failures fold into one probe.
    private var lastAutoRecoverAt: Date = .distantPast

    /// A surface load failed while the state says connected — the desktop may
    /// have restarted or moved ports without a network-path change, which
    /// NWPathMonitor can't see. Re-run discovery in the background, at most
    /// once per cooldown, so the app heals itself instead of sitting on a
    /// stale "connected" with every surface erroring.
    private func scheduleAutoRecover() {
        let cooldown: TimeInterval = 10
        guard Date().timeIntervalSince(lastAutoRecoverAt) > cooldown else { return }
        lastAutoRecoverAt = Date()
        Task { [weak self] in await self?.recoverConnectionInBackground() }
    }

    /// The connected state can be stale after a long suspension: the desktop
    /// may have restarted or relocated while iOS had the app frozen, with no
    /// path change for the supervisor to see. Revalidate with one cheap probe
    /// on foreground — the common case (still reachable) costs a single
    /// request and repaints nothing; a dead endpoint falls into the usual
    /// retry/discovery path. A successful probe also gives the rolling token
    /// renewal a chance to run for long-foregrounded devices.
    func validateConnectionOnForeground() async {
        await validateCurrentConnection(refreshProfile: true)
    }

    /// Keep a long-lived foreground session honest even when the network path
    /// itself never changes. This prevents the next chat send from being the
    /// first operation to discover that the desktop restarted or moved.
    func maintainConnectionWhileActive() async {
        await validateCurrentConnection(refreshProfile: false)
    }

    private func validateCurrentConnection(refreshProfile: Bool) async {
        guard connection != nil, connectionState == .connected else { return }
        if let client, await client.ping() {
            if refreshProfile {
                await loadOperatorProfile()
            }
            await refreshAccessTokenIfNeeded()
            flushQueuedMessages()
            return
        }
        guard connectionState == .connected else { return }
        await connectWithRetry()
    }

    /// Project context (projects + grants + familiars) loads alongside the
    /// theme/profile reads so initial connection and reconnect recover one
    /// coherent scope before the shell relies on it.
    private func loadCoreResources(
        mirroringProjectContextFailuresTo mirroredSurfaces: ProjectContextFailureSurfaces = []
    ) async {
        guard let client = coreResourceClient else { return }
        async let theme = Result.capturing { try await client.fetchTheme() }
        async let profile = Result.capturing { try await client.operatorProfile() }
        await loadProjectContext(using: client, mirrorFailuresTo: mirroredSurfaces)
        // Theme and profile stay best-effort: on failure the last snapshot
        // stands (no flash back to the fallback chrome / "You").
        if case .success(let snapshot) = await theme { adopt(snapshot) }
        if case .success(let loadedProfile) = await profile, operatorProfile != loadedProfile {
            operatorProfile = loadedProfile
        }
    }

    /// Each loader owns disjoint state and applies on the main actor, so they
    /// can overlap their network waits — wall time tracks the slowest surface
    /// rather than the sum of all of them.
    private func refreshLoadedSurfaces() async {
        let mirroredProjectContextFailures = loadedProjectContextFailureSurfaces
        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await self.loadCoreResources(
                    mirroringProjectContextFailuresTo: mirroredProjectContextFailures
                )
            }
            if sessionsLoaded { group.addTask { await self.loadSessions() } }
            if tasksLoaded { group.addTask { await self.loadTasks() } }
            if remindersLoaded { group.addTask { await self.loadReminders() } }
        }
    }

    /// `quiet` probes without first flipping the state to `.checking`, so a
    /// background retry (e.g. the unreachable screen's auto-retry ticker)
    /// doesn't bounce the UI through intermediate states — the state only
    /// changes when the probe has an outcome.
    func refreshConnection(reloadLoadedSurfaces: Bool = false, quiet: Bool = false) async {
        guard let connection else { connectionState = .unconfigured; return }
        if !quiet { connectionState = .checking }

        // Single-flight the transport decision: concurrent callers join the
        // in-flight probe, and only the launching caller applies the outcome
        // (state + loads must run once, not per caller). A joiner's
        // surface-reload intent is OR-merged onto the probe so the launcher
        // applies it — the joiner returning early must not drop it.
        // Last-good first (cave-ioswipe.3): the ordinary reconnect then costs a
        // single probe instead of walking the candidate list.
        let candidates = connection.prioritizedCandidateBaseURLs(defaults: projectContextDefaults)
        // Identity of the endpoint this probe describes. `configure()` cancels
        // the in-flight probe, but a launcher that already passed its
        // `Task.isCancelled` check races that cancel — without this capture it
        // would compare its stale outcome against the user's just-entered
        // endpoint, "relocate", and persist the old one back.
        let probedBaseURL = connection.baseURL
        let refresh = await refreshCoordinator.refresh(requestSurfaceReload: reloadLoadedSurfaces) {
            // Try the configured endpoint first, then auto-relocate to a
            // working port (e.g. a `.ts.net` host typed without `:8443`).
            let outcome = await self.baseURLDiscoverer(candidates)
            guard !Task.isCancelled else { return .cancelled }
            switch outcome {
            case .found(let url): return .found(url)
            case .unauthorized: return .unauthorized
            case .credentialFailure(let message): return .credentialFailure(message)
            case .unreachable(let failure): return .unreachable(failure)
            }
        }
        guard refresh.launched else { return }
        // The user may have disconnected while the probe ran; its outcome no
        // longer describes anything configured.
        guard self.connection != nil else { connectionState = .unconfigured; return }
        // Superseded mid-flight: the endpoint was reconfigured after this
        // probe slipped past its cancellation check. Its outcome describes the
        // old endpoint — applying it would silently revert the user's new one.
        // The replacing configuration's own refresh owns the state.
        guard self.connection?.baseURL == probedBaseURL else { return }

        switch refresh.result {
        case .cancelled:
            // Superseded (endpoint reconfigured mid-probe): the replacing
            // refresh owns the state.
            return
        case .found(let working):
            _ = currentProjectNavigationConnectionGeneration()
            // Remember what answered, keyed by the host we probed, so the next
            // reconnect starts here (cave-ioswipe.3). Recorded even when the URL
            // is unchanged: a first success is exactly what makes the fast path
            // available on the following launch.
            if let host = self.connection?.host {
                CaveConnection.saveLastGoodBaseURL(
                    working,
                    forHost: host,
                    defaults: projectContextDefaults
                )
            }
            if working != self.connection?.baseURL {
                // Relocate: persist the working endpoint so future launches
                // connect directly. Stored as bare `host:port` when the
                // default scheme derivation reproduces the URL — a bare host
                // keeps future discovery able to probe alternate ports if the
                // desktop moves again, while a full URL is treated as
                // user-explicit and would pin the connection forever.
                invalidateProjectContextLoads()
                advanceProjectNavigationConnectionGeneration()
                let relocated = CaveConnection(host: Self.canonicalHost(for: working))
                self.connection = relocated
                relocated.save(defaults: projectContextDefaults)
                if let port = working.port {
                    showToast("Connected on port \(port)", systemImage: "antenna.radiowaves.left.and.right")
                }
            }
            markProjectNavigationConnectionKnownGood(
                generation: currentProjectNavigationConnectionGeneration()
            )
            let shouldGateShell = !hasLoadedSurfaces
            if shouldGateShell {
                if refresh.surfaceReloadRequested {
                    await refreshLoadedSurfaces()
                } else {
                    await loadCoreResources()
                }
                if case .needsAuth = connectionState {
                    return
                }
                guard isProjectContextReadyForShellGate else {
                    if projectContextError != nil {
                        connectionState = .projectContextRequired
                    }
                    return
                }
            }
            connectionState = .connected
            await refreshAccessTokenIfNeeded()
            flushQueuedMessages()
            if !shouldGateShell {
                // OR of this launcher's own flag and any joiner's merged intent.
                if refresh.surfaceReloadRequested {
                    await refreshLoadedSurfaces()
                } else {
                    await loadCoreResources()
                }
            }
        case .unauthorized:
            connectionState = .needsAuth(pairingMessage())
        case .credentialFailure(let message):
            connectionState = .unreachable(.credentialFailure(message))
        case .unreachable(let failure):
            connectionState = .unreachable(.diagnosis(for: failure))
        }
    }

    /// Send every message composed while offline, oldest first per thread,
    /// now that the desktop is reachable again. Fire-and-forget: replies
    /// stream in like any send, and a re-drop mid-flush re-queues cleanly
    /// (the next reconnect picks it back up). Guarded so overlapping
    /// reconnect signals (foreground probe + path monitor) flush once.
    private var flushingQueued = false
    func flushQueuedMessages() {
        guard let client, !flushingQueued else { return }
        let pending = threads.filter { thread in thread.messages.contains { $0.isQueued } }
        guard !pending.isEmpty else { return }
        flushingQueued = true
        Task {
            defer { flushingQueued = false }
            for thread in pending {
                await thread.replayQueued(client: client) { [weak self] in
                    guard let self else { return }
                    self.touch(thread)
                }
            }
        }
    }

    /// Rolling renewal: when the stored signed token is within a week of
    /// expiry, exchange it for a fresh 30-day one. Failures are non-fatal —
    /// the current token keeps working until it actually expires, at which
    /// point refreshConnection lands in `.needsAuth` with re-pair guidance.
    private func refreshAccessTokenIfNeeded() async {
        guard let client = coreResourceClient, let token = CaveConnection.accessToken else { return }
        guard let expiry = CaveInvite.tokenExpiry(token) else {
            // Legacy raw-secret pairing: no expiry, so the rolling renewal
            // below can never fire and the device stays on a never-expiring
            // credential forever. The refresh route accepts the raw secret as
            // a valid credential precisely to offer this migration path —
            // exchange it once for a signed 30-day token. After the swap the
            // stored token has an expiry, so this branch never runs again; on
            // failure (offline, tokenless server) the raw secret keeps
            // working and the next connect retries.
            if let fresh = await client.refreshAccessToken() {
                CaveConnection.saveAccessToken(fresh)
            }
            return
        }
        let renewalWindow: TimeInterval = 7 * 24 * 3600
        let secondsUntilExpiry = expiry.timeIntervalSinceNow
        guard secondsUntilExpiry > 0 && secondsUntilExpiry < renewalWindow else { return }
        if let fresh = await client.refreshAccessToken() {
            CaveConnection.saveAccessToken(fresh)
        }
    }

    /// Connect with a few backoff retries before surfacing the "unreachable" setup
    /// screen — a slow tailnet, or a desktop still spinning up on a cold launch,
    /// shouldn't read as a configuration failure. Between attempts the state is held
    /// at `.checking` so a transient miss shows the "Connecting…" screen (cold
    /// launch) or recovers invisibly in the background (once familiars are loaded),
    /// never a flash of the unreachable screen. Actionable bootstrap blockers
    /// (pairing or project context) stop the retry loop and leave their own
    /// recovery UI mounted. Drives launch + foreground reconnect.
    func connectWithRetry() async {
        guard connection != nil else { connectionState = .unconfigured; return }
        // Delays BETWEEN attempts (4 attempts total, ~7s before giving up).
        let backoffSeconds: [UInt64] = [1, 2, 4]
        await refreshConnection(reloadLoadedSurfaces: shouldReloadLoadedSurfaces)
        var attempt = 0
        while connectionState != .connected, attempt < backoffSeconds.count {
            if case .needsAuth = connectionState { return }
            if connectionState == .projectContextRequired { return }
            connectionState = .checking
            try? await Task.sleep(nanoseconds: backoffSeconds[attempt] * 1_000_000_000)
            if Task.isCancelled { return }
            // The user may have disconnected/reconfigured during the wait.
            guard connection != nil else { connectionState = .unconfigured; return }
            await refreshConnection(reloadLoadedSurfaces: shouldReloadLoadedSurfaces)
            attempt += 1
        }
    }

    enum DiscoveryOutcome: Equatable {
        case found(URL)
        /// At least one candidate was a live Cave server that rejected our
        /// credential — pairing is the fix, not another address.
        case unauthorized
        /// The stored credential cannot safely be sent to this endpoint.
        /// This is terminal: never adopt a tokenless sibling origin.
        case credentialFailure(String)
        /// No candidate answered as Cave. Carries the strongest failure class
        /// seen across candidates ("an HTTP server answered but wasn't Cave"
        /// beats "connection refused" beats "DNS failure" beats "timeout") so
        /// the user hears the most actionable story, or nil when nothing was
        /// classified.
        case unreachable(ProbeFailure?)
    }

    /// Probe candidate base URLs and adjudicate strictly in candidate order: the
    /// first `.ok` in order wins, and a 401/403 earlier in the order is
    /// TERMINAL — it's a live Cave token gate talking, and the fix is pairing.
    /// Adopting a later candidate past it could silently connect to a different
    /// instance on a sibling port (e.g. a dev server on :3000) — the user thinks
    /// they're talking to the desktop they paired with, but they aren't.
    ///
    /// When a paired credential exists, probe sequentially so we never spray a
    /// Bearer token at speculative sibling ports after an earlier candidate has
    /// already succeeded or rejected it. Unpaired probes carry no secret, so they
    /// may still run concurrently for the cold-launch wall-clock win.
    static func discoverBaseURL(_ candidates: [URL]) async -> DiscoveryOutcome {
        guard let preferred = candidates.first else { return .unreachable(nil) }

        // Fast path (cave-ioswipe.3): probe the preferred endpoint ALONE first.
        // Callers put the last-good URL at the head, so the ordinary reconnect —
        // same desktop, same port — costs exactly one probe instead of walking
        // up to 16 candidates. This is also what keeps the preferred endpoint
        // authoritative: racing the whole list could relocate to a different
        // working port purely on timing, persisting an endpoint the user never
        // chose.
        var strongest: ProbeFailure?
        switch await Self.probe(preferred) {
        case .ok: return .found(preferred)
        case .unauthorized: return .unauthorized
        case .credentialFailure(let message): return .credentialFailure(message)
        case .failed(let failure): strongest = failure
        }

        let rest = Array(candidates.dropFirst())
        guard !rest.isEmpty else { return .unreachable(strongest) }

        // The paired path stays SEQUENTIAL by design: every candidate carries
        // the Bearer token, and fanning it across ports concurrently would widen
        // credential exposure. Only the unpaired sweep races.
        if CaveConnection.accessToken != nil {
            return await discoverBaseURLSequentially(rest, seededWith: strongest)
        }

        let results = await withTaskGroup(of: (Int, ProbeResult).self) { group in
            for (index, base) in rest.enumerated() {
                group.addTask { (index, await Self.probe(base)) }
            }
            var collected = [ProbeResult?](repeating: nil, count: rest.count)
            // Short-circuit WITHOUT breaking ordered adjudication. Candidate
            // order is a preference ranking, so cancelling on the first .ok to
            // *arrive* would let a later port win purely on timing and get
            // persisted over an earlier one that also worked. Instead, stop only
            // once some candidate has succeeded AND every candidate ranked above
            // it has already reported — at which point no earlier winner is
            // still possible and the remaining probes cannot change the answer.
            var earliestSuccess: Int?
            for await (index, result) in group {
                collected[index] = result
                if case .ok = result, index < earliestSuccess ?? Int.max {
                    earliestSuccess = index
                }
                if let winner = earliestSuccess,
                   (0..<winner).allSatisfy({ collected[$0] != nil }) {
                    group.cancelAll()
                    break
                }
            }
            return collected
        }
        return adjudicateDiscoveryResults(results, candidates: rest, seededWith: strongest)
    }

    private static func discoverBaseURLSequentially(
        _ candidates: [URL],
        seededWith seed: ProbeFailure? = nil,
    ) async -> DiscoveryOutcome {
        var strongest: ProbeFailure? = seed
        for base in candidates {
            switch await Self.probe(base) {
            case .ok: return .found(base)
            case .unauthorized: return .unauthorized
            case .credentialFailure(let message): return .credentialFailure(message)
            case .failed(let failure): strongest = max(strongest ?? failure, failure)
            }
        }
        return .unreachable(strongest)
    }

    private static func adjudicateDiscoveryResults(
        _ results: [ProbeResult?],
        candidates: [URL],
        seededWith seed: ProbeFailure? = nil,
    ) -> DiscoveryOutcome {
        // Seeded with the preferred endpoint's failure so the diagnosis the user
        // sees still reflects the endpoint they configured, not only the
        // alternates.
        var strongest: ProbeFailure? = seed
        for (index, result) in results.enumerated() {
            switch result {
            case .ok: return .found(candidates[index])
            case .unauthorized: return .unauthorized
            case .credentialFailure(let message): return .credentialFailure(message)
            case .failed(let failure): strongest = max(strongest ?? failure, failure)
            default: continue
            }
        }
        return .unreachable(strongest)
    }

    /// Credential-free concurrent sweep for the connect screen's live
    /// as-you-type reachability preview. Never sends the paired token — the
    /// field may point anywhere — so a token-gated desktop reads as
    /// `.unauthorized`, which the preview renders as "desktop found, pairing
    /// required". Kept separate from `discoverBaseURL` so the paired
    /// sequential path keeps its credential-safety semantics untouched.
    static func previewDiscoverBaseURL(_ candidates: [URL]) async -> DiscoveryOutcome {
        guard !candidates.isEmpty else { return .unreachable(nil) }
        let results = await withTaskGroup(of: (Int, ProbeResult).self) { group in
            for (index, base) in candidates.enumerated() {
                group.addTask { (index, await Self.probe(base, sendCredential: false)) }
            }
            var collected = [ProbeResult?](repeating: nil, count: candidates.count)
            for await (index, result) in group { collected[index] = result }
            return collected
        }
        return adjudicateDiscoveryResults(results, candidates: candidates)
    }

    /// Persist a relocated endpoint as `host:port` when the default scheme
    /// derivation reproduces it (see the relocation comment in
    /// `refreshConnection`); otherwise fall back to the explicit URL.
    static func canonicalHost(for url: URL) -> String {
        guard let host = url.host else { return url.absoluteString }
        let compact = url.port.map { "\(host):\($0)" } ?? host
        return CaveConnection(host: compact).baseURL == url ? compact : url.absoluteString
    }

    private enum ProbeResult {
        case ok
        case unauthorized
        case credentialFailure(String)
        case failed(ProbeFailure)
    }

    /// Shared session for discovery probes — ephemeral (no cache/cookie
    /// carry-over) and never recreated, so repeated discovery rounds don't
    /// leak URLSessions the way per-probe construction did.
    private static let probeSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6
        config.timeoutIntervalForResource = 10
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    /// Reachability check that requires a *real* Cave API response — a 2xx whose
    /// body decodes as the familiars payload. A bare status check would accept
    /// the wrong endpoint: another `tailscale serve` target (e.g. `:443`) can
    /// answer `/api/familiars` with a 404 or some other app's 200, and the old
    /// `200..<500` test latched onto it. Decoding the payload guarantees we only
    /// adopt an actual Cave server. Sends the paired credential when one exists
    /// and reports a 401/403 distinctly — that's a Cave token gate talking.
    private static func probe(_ base: URL, sendCredential: Bool = true) async -> ProbeResult {
        var req = URLRequest(url: base.appendingPathComponent("api/familiars"))
        req.timeoutInterval = 6
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if sendCredential {
            do {
                if let token = try CaveConnection.credentialForRequest(to: req.url!) {
                    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }
            } catch {
                return .credentialFailure(error.localizedDescription)
            }
        }
        let data: Data
        let resp: URLResponse
        do {
            (data, resp) = try await probeSession.data(for: req)
        } catch {
            // Classify the transport failure so adjudication can tell the
            // user WHICH way discovery failed (DNS vs refused vs timeout…).
            return .failed(ProbeFailure(classifying: error))
        }
        guard let http = resp as? HTTPURLResponse else { return .failed(.transport) }
        if http.statusCode == 401 || http.statusCode == 403 { return .unauthorized }
        guard (200..<300).contains(http.statusCode),
              (try? JSONDecoder().decode(FamiliarsResponse.self, from: data)) != nil
        else { return .failed(.wrongServer) }
        return .ok
    }

    func loadFamiliars() async {
        guard let client = coreResourceClient else { return }
        await loadProjectContext(using: client, mirrorFailuresTo: [.familiars])
    }

    func applyFamiliarAvatarMutation(id: String, avatarUrl: String?) {
        guard let index = familiars.firstIndex(where: { $0.id == id }) else { return }
        familiars[index].avatarUrl = avatarUrl
    }

    // MARK: - Unread tracking

    /// True when a familiar has activity newer than the last time its chats were
    /// viewed. New familiars are seeded as "seen now" (see `seedFamiliarViews`),
    /// so only genuinely new activity — e.g. a reply that arrived on the desktop
    /// — flags as unread, not the entire backlog on first launch.
    func hasUnread(_ familiarId: String) -> Bool {
        guard let seen = familiarViewDate(for: familiarId, in: nil),
              let activity = globalLastActivity(for: familiarId) else { return false }
        return activity > seen
    }

    /// Earliest "last viewed" date across a thread's familiars — the boundary
    /// the "New Messages" divider is placed against. nil when untracked.
    func seenBoundary(for thread: ChatThread) -> Date? {
        let context = projectContext(for: thread)
        return thread.familiarIds.compactMap {
            familiarViewDate(for: $0, in: context)
        }.min()
    }

    /// Mark a familiar's chats as read (call when opening them).
    func markFamiliarViewed(_ ids: [String]) {
        markFamiliarViewed(ids, in: projectContext)
    }

    func markFamiliarViewed(_ ids: [String], in context: ProjectContext?) {
        guard !ids.isEmpty else { return }
        let now = Date()
        for id in ids {
            familiarViews[familiarViewKey(for: id, in: context)] = now
        }
        persistFamiliarViews()
    }

    /// Per-thread UserDefaults key for the composer's unsent draft.
    static func draftKey(_ threadId: String) -> String { "cave.chat.draft.\(threadId)" }

    /// Keep the observable draft mirror in step with the composer's debounced
    /// UserDefaults persistence; list rows read this to badge drafted threads.
    func setThreadDraft(_ threadId: String, text: String?) {
        if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if threadDrafts[threadId] != text { threadDrafts[threadId] = text }
        } else if threadDrafts[threadId] != nil {
            threadDrafts.removeValue(forKey: threadId)
        }
    }

    /// Load persisted drafts for restored threads into the observable mirror.
    private func seedThreadDrafts() {
        for thread in threads where threadDrafts[thread.id] == nil {
            if let saved = UserDefaults.standard.string(forKey: Self.draftKey(thread.id)),
               !saved.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                threadDrafts[thread.id] = saved
            }
        }
    }

    /// Baseline any not-yet-tracked familiar as seen "now" so existing history
    /// isn't all flagged unread; only later activity counts.
    private func seedFamiliarViews(_ ids: [String], in context: ProjectContext?) {
        let now = Date()
        var changed = false
        for id in ids {
            let key = familiarViewKey(for: id, in: context)
            if familiarViews[key] == nil {
                familiarViews[key] = now
                changed = true
            }
        }
        if changed { persistFamiliarViews() }
    }


    // MARK: - Sessions (server-side, for per-familiar thread lists)

    /// Chat sessions known to the server (`GET /api/sessions/list`) — including
    /// conversations started on the desktop/web that have no local thread yet.
    /// Merged with on-device threads to build each familiar's thread list.
    var serverSessions: [SessionRow] = []
    var sessionsError: String?
    var sessionsLoaded = false

    func loadSessions() async {
        guard let client = sessionLoadingClient else { return }
        await loadSessions(using: client)
    }

    func loadSessions(using client: any ProjectContextLoadingClient) async {
        let navigationGeneration = currentProjectNavigationConnectionGeneration()
        noteProjectNavigationSurfaceAttempt(.sessions, generation: navigationGeneration)
        let load = await coordinatedSessionsLoad(
            using: client,
            generation: navigationGeneration
        )
        guard coordinatedLoadShouldApply(load.token, state: sessionsLoadState) else { return }
        markCoordinatedLoadApplied(load.token, state: &sessionsLoadState)

        switch load.result {
        case .success(let sessions):
            applyLoadedSessions(sessions)
            noteProjectNavigationSurfaceSuccess(.sessions, generation: navigationGeneration)
            _ = resolvePendingProjectNavigationIntent(attemptHydrationIfNeeded: true)
        case .failure(let error):
            sessionsError = handleSurfaceError(error)
            noteProjectNavigationSurfaceFailure(.sessions, generation: navigationGeneration)
            sessionsLoaded = true
            lastSessionsLoadedAt = Date()
            _ = resolvePendingProjectNavigationIntent()
        }
    }

    /// When the session list was last fetched. Not observable — it gates a
    /// refetch, it does not drive any view. In an @Observable type stored
    /// properties are observable by default, so the attribute is what makes
    /// that true; the comment alone did not.
    @ObservationIgnored private var lastSessionsLoadedAt: Date?

    /// How long a freshly-loaded session list is considered good enough to
    /// reuse when a view re-appears (cave-ioswipe.5).
    nonisolated private static let sessionsStaleAfter: TimeInterval = 30

    /// Load sessions unless they were fetched moments ago.
    ///
    /// A view that re-appears often (opening a familiar's threads, backing out,
    /// opening another) was refetching the WHOLE session list every time, while
    /// the equivalent call in ChatsHomeView has always been guarded. A bare
    /// `if !sessionsLoaded` guard would fix the churn but leave the list stale
    /// until a reconnect or a manual pull, so this expires instead: frequent
    /// re-appearances reuse, a genuinely old list refetches.
    ///
    /// Pull-to-refresh deliberately does NOT come through here — an explicit
    /// user refresh must always hit the server.
    func loadSessionsIfStale(maxAge: TimeInterval = AppModel.sessionsStaleAfter) async {
        if sessionsLoaded, let at = lastSessionsLoadedAt, Date().timeIntervalSince(at) < maxAge {
            return
        }
        await loadSessions()
    }

    private func normalizedSessionID(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    private func normalizedFamiliarID(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    private func authoritativeFamiliarID(
        from row: SessionRow,
        fallback fallbackFamiliarID: String?
    ) -> String? {
        normalizedFamiliarID(row.familiarId) ?? normalizedFamiliarID(fallbackFamiliarID)
    }

    private func repairedFamiliarIDs(
        from current: [String],
        replacing staleFamiliarIDs: Set<String>,
        with authoritativeFamiliarID: String,
        isDirectThread: Bool
    ) -> [String] {
        if isDirectThread {
            return [authoritativeFamiliarID]
        }

        var next: [String] = []
        var inserted = false
        for familiarID in current {
            guard let normalized = normalizedFamiliarID(familiarID) else { continue }
            if staleFamiliarIDs.contains(normalized) || normalized == authoritativeFamiliarID {
                if !inserted {
                    next.append(authoritativeFamiliarID)
                    inserted = true
                }
            } else {
                next.append(normalized)
            }
        }
        if !inserted {
            next.insert(authoritativeFamiliarID, at: 0)
        }

        var seen = Set<String>()
        return next.compactMap { familiarID in
            guard seen.insert(familiarID).inserted else { return nil }
            return familiarID
        }
    }

    @discardableResult
    private func repairThreadSessionBinding(
        _ thread: ChatThread,
        with row: SessionRow,
        fallbackFamiliarID: String?
    ) -> (familiarId: String?, changed: Bool) {
        let resolvedFamiliarID = authoritativeFamiliarID(
            from: row,
            fallback: fallbackFamiliarID
        )
        var changed = false

        if let projectRoot = authoritativeProjectRoot(from: row),
           thread.projectRoot != projectRoot {
            thread.projectRoot = projectRoot
            changed = true
        }

        guard let sessionID = normalizedSessionID(row.id),
              let resolvedFamiliarID else {
            if changed {
                persistThreads()
            }
            return (resolvedFamiliarID, changed)
        }

        let staleFamiliarIDs: Set<String> = Set(
            thread.sessionIds.compactMap { entry in
                guard normalizedSessionID(entry.value) == sessionID else { return nil }
                return normalizedFamiliarID(entry.key) ?? entry.key
            }
        )
        var nextSessionIDs = thread.sessionIds.filter {
            normalizedSessionID($0.value) != sessionID
        }
        nextSessionIDs[resolvedFamiliarID] = sessionID
        if nextSessionIDs != thread.sessionIds {
            thread.sessionIds = nextSessionIDs
            changed = true
        }

        // A thread's direct-vs-group shape comes from its participant roster,
        // not from how many server sessions are currently bound.
        let isDirectThread = !thread.isGroup
        let nextFamiliarIDs = repairedFamiliarIDs(
            from: thread.familiarIds,
            replacing: staleFamiliarIDs,
            with: resolvedFamiliarID,
            isDirectThread: isDirectThread
        )
        if nextFamiliarIDs != thread.familiarIds {
            thread.familiarIds = nextFamiliarIDs
            changed = true
        }

        if changed {
            persistThreads()
        }
        return (resolvedFamiliarID, changed)
    }

    private func authoritativeProjectRoot(from row: SessionRow) -> String? {
        guard let trimmed = row.projectRoot?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    private func authoritativeProjectRoot(
        for thread: ChatThread,
        using sessionsByID: [String: SessionRow]
    ) -> String? {
        for familiarId in thread.familiarIds {
            guard let sessionID = normalizedSessionID(thread.sessionIds[familiarId]),
                  let row = sessionsByID[sessionID],
                  let projectRoot = authoritativeProjectRoot(from: row)
            else { continue }
            return projectRoot
        }
        for rawSessionID in thread.sessionIds.values {
            guard let sessionID = normalizedSessionID(rawSessionID),
                  let row = sessionsByID[sessionID],
                  let projectRoot = authoritativeProjectRoot(from: row)
            else { continue }
            return projectRoot
        }
        return nil
    }

    @discardableResult
    private func backfillThreadProjectRoots(from sessions: [SessionRow]) -> Bool {
        let sessionsByID = Dictionary(
            uniqueKeysWithValues: sessions.map { ($0.id, $0) }
        )
        var changed = false
        for thread in threads {
            guard let projectRoot = authoritativeProjectRoot(
                for: thread,
                using: sessionsByID
            ),
            thread.projectRoot != projectRoot else { continue }
            thread.projectRoot = projectRoot
            changed = true
        }
        if changed {
            persistThreads()
        }
        return changed
    }

    private func applyLoadedSessions(
        _ sessions: [SessionRow],
        refreshProjectContextSelection: Bool = true
    ) {
        serverSessions = sessions
        sessionsError = nil
        sessionsLoaded = true
        lastSessionsLoadedAt = Date()
        let changed = backfillThreadProjectRoots(from: sessions)
        if refreshProjectContextSelection
            && (changed || projectContext == nil || projectContext == .unassigned) {
            refreshProjectContextSelectionFromCurrentData()
        }
        _ = resolvePendingProjectNavigationIntent()
    }

    private func shouldRefreshAuthoritativeSessionRow(_ sessionID: String) -> Bool {
        guard sessionsLoaded,
              sessionsError == nil,
              let lastSessionsLoadedAt,
              Date().timeIntervalSince(lastSessionsLoadedAt) < Self.sessionsStaleAfter,
              let cached = serverSessions.first(where: { $0.id == sessionID }),
              authoritativeProjectRoot(from: cached) != nil
        else { return true }
        return false
    }

    private enum AuthoritativeSessionRowLookup {
        case row(SessionRow)
        case missing
        case loadFailed
    }

    private enum TaskLinkedSessionResolution {
        enum ConfirmedMissingReason {
            case rowMissing
            case missingProjectRoot

            var toastText: String {
                switch self {
                case .rowMissing:
                    return "This task’s linked chat could not be verified. Refresh Chats or reopen it on your desktop, then try again."
                case .missingProjectRoot:
                    return "This task’s linked chat is missing project metadata. Refresh Chats or reopen it on your desktop, then try again."
                }
            }

            var systemImage: String {
                switch self {
                case .rowMissing:
                    return "arrow.clockwise"
                case .missingProjectRoot:
                    return "folder.badge.questionmark"
                }
            }
        }

        case resolved(SessionRow)
        case confirmedMissing(ConfirmedMissingReason)
        case transientLoadFailure

        var toastText: String? {
            switch self {
            case .resolved:
                return nil
            case .confirmedMissing(let reason):
                return reason.toastText
            case .transientLoadFailure:
                return "Couldn’t load this task’s linked chat. Refresh Chats or reconnect, then try again."
            }
        }

        var systemImage: String? {
            switch self {
            case .resolved:
                return nil
            case .confirmedMissing(let reason):
                return reason.systemImage
            case .transientLoadFailure:
                return "bubble.left.and.exclamationmark.bubble.right"
            }
        }
    }

    private func authoritativeSessionRowLookup(
        for sessionID: String
    ) async -> AuthoritativeSessionRowLookup {
        guard let sessionID = normalizedSessionID(sessionID) else { return .missing }
        let shouldRefresh = shouldRefreshAuthoritativeSessionRow(sessionID)
        let cached = cachedSessionRow(for: sessionID)

        guard shouldRefresh else {
            return cached.map(AuthoritativeSessionRowLookup.row) ?? .missing
        }
        guard let client = sessionLoadingClient else {
            return cached.map(AuthoritativeSessionRowLookup.row) ?? .loadFailed
        }

        await loadSessions(using: client)
        if let row = cachedSessionRow(for: sessionID) {
            return .row(row)
        }
        if sessionsError != nil {
            return .loadFailed
        }
        return .missing
    }

    private func authoritativeSessionRow(for sessionID: String) async -> SessionRow? {
        switch await authoritativeSessionRowLookup(for: sessionID) {
        case .row(let row):
            return row
        case .missing, .loadFailed:
            return nil
        }
    }

    private func resolveTaskLinkedSession(
        sessionID: String
    ) async -> TaskLinkedSessionResolution {
        switch await authoritativeSessionRowLookup(for: sessionID) {
        case .loadFailed:
            return .transientLoadFailure
        case .missing:
            return .confirmedMissing(.rowMissing)
        case .row(let row):
            guard authoritativeProjectRoot(from: row) != nil else {
                return .confirmedMissing(.missingProjectRoot)
            }
            return .resolved(row)
        }
    }

    private func taskRecoveryThread(
        for card: BoardCard,
        sessionID: String
    ) -> ChatThread? {
        guard let sessionID = normalizedSessionID(sessionID) else { return nil }

        var candidates: [ChatThread] = []
        if let explicit = localLinkedThread(for: card.id) {
            candidates.append(explicit)
        }
        if let matching = thread(matchingSessionID: sessionID),
           !candidates.contains(where: { $0.id == matching.id }) {
            candidates.append(matching)
        }

        for thread in candidates where thread.sessionIds.values.contains(where: {
            normalizedSessionID($0) == sessionID
        }) {
            if thread.projectRoot != nil {
                thread.projectRoot = nil
                persistThreads()
            }
            return thread
        }
        return nil
    }

    /// Every group thread, newest first — shown as its own rows on the Chats
    /// home (a group has no single familiar to file it under).
    var groupThreads: [ChatThread] {
        threads.filter(\.isGroup).sorted { a, b in
            if a.pinned != b.pinned { return a.pinned }
            return a.updatedAt > b.updatedAt
        }
    }

    /// Materialise a server session as a local thread (binding its `sessionId`
    /// and optionally pulling history) and return it, so it opens like any
    /// other thread. Reuses an existing local thread that already carries the
    /// session id.
    func openServerSession(
        _ row: SessionRow,
        familiarId: String,
        loadHistory shouldLoadHistory: Bool = true
    ) -> ChatThread {
        let changed = backfillThreadProjectRoots(from: [row])
        if let existing = threads.first(where: { $0.sessionIds.values.contains(row.id) }) {
            let repair = repairThreadSessionBinding(
                existing,
                with: row,
                fallbackFamiliarID: familiarId
            )
            if changed || repair.changed {
                refreshProjectContextSelectionFromCurrentData()
            }
            return existing
        }
        if changed {
            refreshProjectContextSelectionFromCurrentData()
        }
        let resolvedFamiliarID = authoritativeFamiliarID(from: row, fallback: familiarId) ?? familiarId
        let title = row.title.isEmpty
            ? (familiar(resolvedFamiliarID)?.displayName ?? resolvedFamiliarID)
            : row.title
        let thread = ChatThread(title: title, familiarIds: [resolvedFamiliarID],
                                sessionIds: [resolvedFamiliarID: row.id],
                                projectRoot: row.projectRoot)
        threads.insert(thread, at: 0)
        persistThreads()
        if shouldLoadHistory {
            Task { await loadHistory(into: thread, sessionId: row.id) }
        }
        return thread
    }

    // MARK: - Task ↔ chat linking

    /// The thread linked to a card, if any: prefer the explicit local link,
    /// then fall back to matching the card's server `sessionId` to a thread's
    /// per-familiar session (covers links made on another device / the desktop).
    func linkedThread(for card: BoardCard) -> ChatThread? {
        let authoritativeSessionID = normalizedSessionID(card.sessionId)
        let taskAuthoritativeRow = cachedSessionRow(for: authoritativeSessionID)
        if authoritativeSessionID == nil || taskAuthoritativeRow != nil {
            if let thread = localLinkedThread(for: card.id),
               taskLinkMatchesProject(
                   card,
                   thread: thread,
                   authoritativeRow: taskAuthoritativeRow
                       ?? cachedSessionRow(for: primarySessionId(of: thread))
               ) {
                return thread
            }
        }
        if let sessionID = authoritativeSessionID,
           let thread = thread(matchingSessionID: sessionID),
           let taskAuthoritativeRow,
           taskLinkMatchesProject(
               card,
               thread: thread,
               authoritativeRow: taskAuthoritativeRow
           ) {
            return thread
        }
        return nil
    }

    /// Cards linked to a thread (local link map ∪ session-id match).
    func linkedTasks(for thread: ChatThread) -> [BoardCard] {
        let sessionIds = Set(thread.sessionIds.values.filter { !$0.isEmpty })
        return tasks.filter { card in
            if cardThreadLinks[card.id] == thread.id { return true }
            if let sid = card.sessionId, !sid.isEmpty { return sessionIds.contains(sid) }
            return false
        }
    }

    /// Linked tasks that still belong to the thread's current project context.
    func projectLinkedTasks(for thread: ChatThread) -> [BoardCard] {
        let context = projectContext(for: thread)
        return linkedTasks(for: thread).filter {
            context.matches(task: $0, registeredProjects: projects)
        }
    }

    /// Tasks the sheet may newly link to this chat: first constrain to the
    /// thread's project context, then apply the familiar/search filters.
    func projectAssignableTasks(for thread: ChatThread, matching query: String) -> [BoardCard] {
        let context = projectContext(for: thread)
        let linkedIds = Set(linkedTasks(for: thread).map(\.id))
        let chatFamiliars = Set(thread.familiarIds)
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        return tasks.filter { card in
            guard context.matches(task: card, registeredProjects: projects) else { return false }
            guard !linkedIds.contains(card.id) else { return false }
            let owner = normalizedFamiliarID(card.familiarId)
            let belongsHere = owner == nil || chatFamiliars.contains(owner!)
            guard belongsHere else { return false }
            return trimmedQuery.isEmpty || card.title.lowercased().contains(trimmedQuery)
        }
    }

    /// True when a card has any linked chat (cheap, for list indicators).
    func hasLinkedChat(_ card: BoardCard) -> Bool {
        linkedThread(for: card) != nil || authoritativeTaskSessionPreview(for: card) != nil
    }

    /// A thread's primary server session (first familiar's), if assigned.
    private func primarySessionId(of thread: ChatThread) -> String? {
        for familiarId in thread.familiarIds {
            if let sid = thread.sessionIds[familiarId], !sid.isEmpty { return sid }
        }
        return thread.sessionIds.values.first { !$0.isEmpty }
    }

    /// Bind a just-established server session onto a local thread. When a
    /// voice-first task chat receives its FIRST bound session, reconcile any
    /// linked card so the board gets the same `sessionId` text-first chat
    /// would patch after streaming finishes.
    func bindThreadSession(_ sessionId: String, to thread: ChatThread, for familiarId: String) {
        let trimmed = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, thread.sessionIds[familiarId] != trimmed else { return }
        let hadAnySession = primarySessionId(of: thread) != nil
        thread.sessionIds[familiarId] = trimmed
        touch(thread)
        if !hadAnySession, cardThreadLinks.values.contains(thread.id) {
            Task { await reconcileCardLinks(for: thread) }
        }
    }

    private func taskLinkedThread(
        titled title: String,
        for card: BoardCard,
        authoritativeRow row: SessionRow,
        fallbackFamiliarID: String?
    ) -> ChatThread? {
        let changed = backfillThreadProjectRoots(from: [row])
        guard let sessionID = normalizedSessionID(row.id) else { return nil }
        if let existing = linkedThread(for: card) {
            let repair = repairThreadSessionBinding(
                existing,
                with: row,
                fallbackFamiliarID: fallbackFamiliarID
            )
            if changed || repair.changed {
                refreshProjectContextSelectionFromCurrentData()
            }
            return existing
        }
        if let existing = thread(matchingSessionID: sessionID) {
            let repair = repairThreadSessionBinding(
                existing,
                with: row,
                fallbackFamiliarID: fallbackFamiliarID
            )
            if changed || repair.changed {
                refreshProjectContextSelectionFromCurrentData()
            }
            return existing
        }
        guard let resolvedFamiliarID = authoritativeFamiliarID(
            from: row,
            fallback: fallbackFamiliarID
        ) else { return nil }
        if changed {
            refreshProjectContextSelectionFromCurrentData()
        }
        let thread = ChatThread(
            title: row.title.isEmpty ? title : row.title,
            familiarIds: [resolvedFamiliarID],
            sessionIds: [resolvedFamiliarID: sessionID],
            projectRoot: authoritativeProjectRoot(from: row)
        )
        threads.insert(thread, at: 0)
        persistThreads()
        Task { await loadHistory(into: thread, sessionId: sessionID) }
        return thread
    }

    private func localLinkedThread(for cardId: String) -> ChatThread? {
        guard let threadID = cardThreadLinks[cardId] else { return nil }
        return threads.first { $0.id == threadID }
    }

    private func thread(matchingSessionID sessionID: String) -> ChatThread? {
        threads.first { thread in
            thread.sessionIds.values.contains { normalizedSessionID($0) == sessionID }
        }
    }

    private func cachedSessionRow(for sessionID: String?) -> SessionRow? {
        guard let sessionID = normalizedSessionID(sessionID) else { return nil }
        return serverSessions.first { $0.id == sessionID }
    }

    struct TaskChatSessionPreview: Equatable {
        let row: SessionRow
        let context: ProjectContext
        let taskProject: ProjectInfo?
        let mismatchedProject: Bool

        var suggestedProject: ProjectInfo? {
            guard case .project(let project) = context else { return nil }
            return project
        }

        var title: String {
            row.title.isEmpty ? "Linked chat" : row.title
        }

        var taskProjectName: String {
            taskProject?.name ?? "Unassigned"
        }

        var subtitle: String {
            if let suggestedProject {
                return suggestedProject.name
            }
            return "Recovery-only linked chat"
        }

        var warningText: String {
            if let suggestedProject {
                return "This task is filed in \(taskProjectName), but its linked chat belongs to \(suggestedProject.name). Opening chat follows the linked session."
            }
            return "This task is filed in \(taskProjectName), but its linked chat is recovery-only. Opening chat follows the linked session until you repair or unlink it."
        }

        var toastText: String {
            if let suggestedProject {
                return "This task is filed in \(taskProjectName), but its linked chat belongs to \(suggestedProject.name). Opening the linked chat so you can repair or unlink it."
            }
            return "This task’s linked chat is recovery-only. Opening the linked chat so you can repair or unlink it."
        }

        var repairLabel: String {
            suggestedProject.map { "Move task to \($0.name)" } ?? "Move to project…"
        }
    }

    private func taskProjectInfo(for card: BoardCard) -> ProjectInfo? {
        guard let projectID = card.projectId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !projectID.isEmpty else { return nil }
        return project(projectID)
    }

    private func taskChatSessionPreview(
        for card: BoardCard,
        authoritativeRow row: SessionRow
    ) -> TaskChatSessionPreview? {
        guard authoritativeProjectRoot(from: row) != nil else { return nil }
        let context = projectContext(for: row)
        return TaskChatSessionPreview(
            row: row,
            context: context,
            taskProject: taskProjectInfo(for: card),
            mismatchedProject: !context.matches(task: card, registeredProjects: projects)
        )
    }

    func authoritativeTaskSessionPreview(for card: BoardCard) -> TaskChatSessionPreview? {
        guard let sessionID = normalizedSessionID(card.sessionId),
              let row = cachedSessionRow(for: sessionID) else {
            return nil
        }
        return taskChatSessionPreview(for: card, authoritativeRow: row)
    }

    private func authoritativeSessionRowIfPresent(_ sessionID: String?) async -> SessionRow? {
        guard let sessionID else { return nil }
        return await authoritativeSessionRow(for: sessionID)
    }

    private func taskLinkMatchesProject(
        _ card: BoardCard,
        thread: ChatThread?,
        authoritativeRow: SessionRow?
    ) -> Bool {
        if let authoritativeRow {
            guard authoritativeProjectRoot(from: authoritativeRow) != nil else { return false }
            return projectContext(for: authoritativeRow).matches(
                task: card,
                registeredProjects: projects
            )
        }
        guard let thread else { return false }
        return projectContext(for: thread).matches(task: card, registeredProjects: projects)
    }

    private func setLocalTaskThreadLink(_ threadID: String?, for cardId: String) {
        guard cardThreadLinks[cardId] != threadID else { return }
        cardThreadLinks[cardId] = threadID
        persistCardLinks()
    }

    private func clearLocalTaskThreadLink(for cardId: String) {
        setLocalTaskThreadLink(nil, for: cardId)
    }

    private func validatedLocalTaskLinkedThread(
        for card: BoardCard,
        fallbackFamiliarID: String?
    ) async -> ChatThread? {
        guard let thread = localLinkedThread(for: card.id) else { return nil }
        let authoritativeRow: SessionRow?
        if let taskSessionID = normalizedSessionID(card.sessionId) {
            authoritativeRow = await authoritativeSessionRowIfPresent(taskSessionID)
            guard authoritativeRow != nil else { return nil }
        } else {
            authoritativeRow = await authoritativeSessionRowIfPresent(
                primarySessionId(of: thread)
            )
        }
        guard taskLinkMatchesProject(
            card,
            thread: thread,
            authoritativeRow: authoritativeRow
        ) else {
            return nil
        }
        if let authoritativeRow {
            let repair = repairThreadSessionBinding(
                thread,
                with: authoritativeRow,
                fallbackFamiliarID: fallbackFamiliarID
            )
            if repair.changed {
                refreshProjectContextSelectionFromCurrentData()
            }
        }
        return thread
    }

    private func repairTaskChatScopeAfterProjectMove(cardId: String) async -> String? {
        guard let card = tasks.first(where: { $0.id == cardId }) else { return nil }

        let fallbackFamiliarID = normalizedFamiliarID(card.familiarId)
        let localThread = localLinkedThread(for: card.id)
        let localThreadSession = await authoritativeSessionRowIfPresent(
            localThread.flatMap { primarySessionId(of: $0) }
        )
        let localThreadCompatible = taskLinkMatchesProject(
            card,
            thread: localThread,
            authoritativeRow: localThreadSession
        )

        if let localThread,
           let localThreadSession,
           localThreadCompatible {
            let repair = repairThreadSessionBinding(
                localThread,
                with: localThreadSession,
                fallbackFamiliarID: fallbackFamiliarID
            )
            if repair.changed {
                refreshProjectContextSelectionFromCurrentData()
            }
        }

        if let sessionID = normalizedSessionID(card.sessionId) {
            guard let authoritativeSession = await authoritativeSessionRow(for: sessionID),
                  authoritativeProjectRoot(from: authoritativeSession) != nil else {
                return "Couldn’t verify the previous chat link, so it was kept."
            }

            if taskLinkMatchesProject(
                card,
                thread: nil,
                authoritativeRow: authoritativeSession
            ) {
                if localThread != nil, !localThreadCompatible {
                    clearLocalTaskThreadLink(for: card.id)
                }
                return nil
            }

            let preservedThreadID = localThreadCompatible ? localThread?.id : nil
            guard let unlink = requestTaskSession(cardId: card.id, sessionId: nil) else {
                return "Couldn’t unlink the previous chat link, so it was kept."
            }

            await unlink.value
            guard normalizedSessionID(tasks.first(where: { $0.id == card.id })?.sessionId) == nil
            else {
                return "Couldn’t unlink the previous chat link, so it was kept."
            }

            if let preservedThreadID {
                setLocalTaskThreadLink(preservedThreadID, for: card.id)
            } else {
                clearLocalTaskThreadLink(for: card.id)
            }
            return nil
        }

        if localThread != nil, !localThreadCompatible {
            clearLocalTaskThreadLink(for: card.id)
        }
        return nil
    }

    private func taskChatLaunchProject(
        for card: BoardCard,
        familiarId: String
    ) -> ProjectInfo? {
        if projectContext == .unassigned {
            showToast(
                "Unassigned tasks are recovery-only. Switch to a registered project in Tasks to start a chat.",
                systemImage: "folder.badge.questionmark",
                style: .warning
            )
            return nil
        }

        guard projectMembershipLoaded else {
            showToast(
                "Refresh Chats to load project access, then try again.",
                systemImage: "arrow.clockwise",
                style: .warning
            )
            return nil
        }

        guard let projectId = card.projectId?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !projectId.isEmpty,
              let project = project(projectId) else {
            showToast(
                "This task is no longer linked to a registered project. Refresh Tasks or reassign it on your desktop, then try again.",
                systemImage: "folder.badge.questionmark",
                style: .warning
            )
            return nil
        }

        guard projectMembership.contains(familiarId, in: project) else {
            let name = familiar(familiarId)?.displayName ?? "This familiar"
            showToast(
                "\(name) can’t access \(project.name). Pick a familiar from that project or refresh Tasks, then try again.",
                systemImage: "person.crop.circle.badge.exclamationmark",
                style: .warning
            )
            return nil
        }

        return project
    }

    /// Open (or create) the chat linked to a card and navigate to it. For an
    /// unlinked card it starts a fresh thread with `familiarId` (the card's
    /// assignee, or a caller-supplied pick) and links it. Returns nil only if no
    /// familiar could be resolved.
    @discardableResult
    func openChat(for card: BoardCard, familiarId: String? = nil) async -> ChatThread? {
        let requestedFamiliarID = normalizedFamiliarID(familiarId ?? card.familiarId)
        let title = "Task: \(card.title)"
        let thread: ChatThread
        if let sessionID = normalizedSessionID(card.sessionId) {
            // The card already points at a server session (e.g. started on the
            // desktop). Re-check local state AFTER the authoritative await so
            // concurrent taps reuse/repair the same thread instead of racing a
            // duplicate insertion.
            let resolution = await resolveTaskLinkedSession(sessionID: sessionID)
            switch resolution {
            case .resolved(let authoritativeRow):
                guard let materialized = taskLinkedThread(
                    titled: title,
                    for: card,
                    authoritativeRow: authoritativeRow,
                    fallbackFamiliarID: requestedFamiliarID
                ) else { return nil }
                if let preview = taskChatSessionPreview(
                    for: card,
                    authoritativeRow: authoritativeRow
                ),
                   preview.mismatchedProject {
                    showToast(
                        preview.toastText,
                        systemImage: "exclamationmark.triangle.fill",
                        style: .warning
                    )
                } else {
                    setLocalTaskThreadLink(materialized.id, for: card.id)
                }
                guard requestOpen(materialized) else { return nil }
                return materialized
            case .confirmedMissing:
                if let toastText = resolution.toastText,
                   let systemImage = resolution.systemImage {
                    showToast(toastText, systemImage: systemImage, style: .warning)
                }
                if let recovery = taskRecoveryThread(for: card, sessionID: sessionID) {
                    guard requestOpen(recovery) else { return nil }
                    return recovery
                }
                return nil
            case .transientLoadFailure:
                if let toastText = resolution.toastText,
                   let systemImage = resolution.systemImage {
                    showToast(toastText, systemImage: systemImage, style: .warning)
                }
                return nil
            }
        }
        if let explicit = await validatedLocalTaskLinkedThread(
            for: card,
            fallbackFamiliarID: requestedFamiliarID
        ) {
            setLocalTaskThreadLink(explicit.id, for: card.id)
            guard requestOpen(explicit) else { return nil }
            return explicit
        }

        if let existing = linkedThread(for: card) {
            var canOpenExisting = true
            if let sessionID = normalizedSessionID(card.sessionId),
               let session = await authoritativeSessionRow(for: sessionID) {
                canOpenExisting = taskLinkMatchesProject(
                    card,
                    thread: existing,
                    authoritativeRow: session
                )
                if canOpenExisting {
                    let repair = repairThreadSessionBinding(
                        existing,
                        with: session,
                        fallbackFamiliarID: requestedFamiliarID
                    )
                    if repair.changed {
                        refreshProjectContextSelectionFromCurrentData()
                    }
                }
            }
            if canOpenExisting {
                setLocalTaskThreadLink(existing.id, for: card.id)   // backfill from a sessionId match
                guard requestOpen(existing) else { return nil }
                return existing
            }
        }
        guard let requestedFamiliarID else { return nil }
        guard let taskProject = taskChatLaunchProject(
            for: card,
            familiarId: requestedFamiliarID
        )
        else { return nil }
        thread = ChatThread(
            title: title,
            familiarIds: [requestedFamiliarID],
            projectRoot: taskProject.root
        )
        threads.insert(thread, at: 0)
        setLocalTaskThreadLink(thread.id, for: card.id)
        persistThreads()
        guard requestOpen(thread) else { return nil }
        return thread
    }

    /// Link an existing task to a thread (from the chat side). Best-effort PATCH
    /// of the card's `sessionId` so the desktop board sees the link too.
    @discardableResult
    func linkTask(_ card: BoardCard, to thread: ChatThread) -> Task<Void, Never>? {
        guard projectContext(for: thread).matches(task: card, registeredProjects: projects) else {
            showToast(
                "This task belongs to another project. Switch projects or move the task first.",
                systemImage: "folder.badge.questionmark",
                style: .warning
            )
            return nil
        }
        cardThreadLinks[card.id] = thread.id
        persistCardLinks()
        if let sid = primarySessionId(of: thread),
           normalizedSessionID(card.sessionId) != normalizedSessionID(sid) {
            return requestTaskSession(cardId: card.id, sessionId: sid)
        }
        return nil
    }

    /// Remove a card's chat link (local map + server sessionId).
    @discardableResult
    func unlinkTask(_ card: BoardCard) -> Task<Void, Never>? {
        cardThreadLinks[card.id] = nil
        persistCardLinks()
        if normalizedSessionID(card.sessionId) != nil {
            return requestTaskSession(cardId: card.id, sessionId: nil)
        }
        return nil
    }

    /// After a thread finishes streaming it may have just acquired its server
    /// session; PATCH any locally-linked card that doesn't yet carry it.
    func reconcileCardLinks(for thread: ChatThread) async {
        guard cardThreadLinks.values.contains(thread.id),
              let sid = primarySessionId(of: thread) else { return }
        if !tasksLoaded { await loadTasks() }
        let cardIds = cardThreadLinks.filter { $0.value == thread.id }.map(\.key)
        for cardId in cardIds where (tasks.first { $0.id == cardId })?.sessionId != sid {
            await patchCardSession(cardId: cardId, sessionId: sid)
        }
    }

    private func patchCardSession(cardId: String, sessionId: String?) async {
        if let task = requestTaskSession(cardId: cardId, sessionId: sessionId) {
            await task.value
        }
    }

    /// Pull a session's history into a freshly-bound thread so opening a chat
    /// linked elsewhere isn't blank.
    private func loadHistory(into thread: ChatThread, sessionId: String) async {
        guard let client, thread.messages.isEmpty,
              let convo = try? await client.conversation(sessionId: sessionId) else { return }
        let assignee = thread.familiarIds.first ?? convo.familiarId
        thread.messages = DisplayMessage.restoredTranscript(from: convo.turns, familiarId: assignee)
        persistThreads()
    }

    // MARK: - Threads

    /// Find an existing direct thread for a familiar in the requested context,
    /// or create a new project-scoped thread when launch is allowed there.
    /// Recovery-only scopes (for example Unassigned) never create new threads.
    func directThread(for familiarId: String, in context: ProjectContext?) -> ChatThread? {
        guard let context else { return nil }
        if let existing = landingDirectThread(for: familiarId, in: context) {
            return existing
        }

        switch context {
        case .project(let project):
            let allowed = projectMembership.familiarIDs(forProjectID: project.id)
            guard allowed.contains(familiarId) else { return nil }
            let name = familiar(familiarId)?.displayName ?? familiarId
            let thread = ChatThread(
                title: name,
                familiarIds: [familiarId],
                projectRoot: project.root
            )
            threads.insert(thread, at: 0)
            persistThreads()
            return thread
        case .unassigned:
            return nil
        }
    }

    /// Open a familiar's landing direct chat inside one project context:
    /// reuse the local landing thread first, otherwise materialize the newest
    /// project-scoped server session, otherwise create a fresh local direct
    /// thread. Recovery-only scopes never materialize or create. Immediate-send
    /// paths may skip the background history import so the returned thread is
    /// safe to mutate synchronously.
    func openFamiliarLandingThread(
        for familiarId: String,
        in context: ProjectContext?,
        loadHistory shouldLoadHistory: Bool = true
    ) -> ChatThread? {
        guard let context else { return nil }
        if let existing = landingDirectThread(for: familiarId, in: context) {
            return existing
        }
        if case .project = context,
           let serverOnly = serverOnlySessions(for: familiarId, in: context).first {
            return openServerSession(
                serverOnly,
                familiarId: familiarId,
                loadHistory: shouldLoadHistory
            )
        }
        return directThread(for: familiarId, in: context)
    }

    private func globalOpenProjects(for familiarId: String) -> [ProjectInfo] {
        projectMembership.projectIDs(forFamiliarID: familiarId)
            .compactMap(project)
            .sorted {
                let order = $0.name.localizedCaseInsensitiveCompare($1.name)
                if order == .orderedSame { return $0.id < $1.id }
                return order == .orderedAscending
            }
    }

    private func reportGlobalFamiliarOpenFailure(for familiarId: String) {
        let name = familiar(familiarId)?.displayName ?? "This familiar"

        guard projectMembershipLoaded else {
            showToast(
                "Refresh Chats to load project access, then try again.",
                systemImage: "arrow.clockwise",
                style: .warning
            )
            return
        }

        let candidateProjects = globalOpenProjects(for: familiarId)
        if let activeProject {
            if let targetProject = candidateProjects.first(where: { $0.id != activeProject.id }) {
                showToast(
                    "\(name) has no chats in \(activeProject.name). Switch to \(targetProject.name) in Chats to start one.",
                    systemImage: "folder.badge.questionmark",
                    style: .warning
                )
                return
            }

            showToast(
                "\(name) isn't available in \(activeProject.name). Refresh Chats or switch projects, then try again.",
                systemImage: "person.crop.circle.badge.exclamationmark",
                style: .warning
            )
            return
        }

        if let targetProject = candidateProjects.first {
            showToast(
                "Switch to \(targetProject.name) in Chats to start a new chat with \(name).",
                systemImage: "folder.badge.questionmark",
                style: .warning
            )
            return
        }

        showToast(
            "Switch to a registered project to start a new chat with \(name).",
            systemImage: "folder.badge.questionmark",
            style: .warning
        )
    }

    /// Global familiar opens prefer the latest local landing chat across all
    /// contexts, then any unmaterialized server session, and only then a fresh
    /// active-project chat when that familiar is available there.
    @discardableResult
    func requestOpenGlobalFamiliarLandingThread(for familiarId: String) -> Bool {
        if let existing = globalLandingDirectThread(for: familiarId) {
            return requestOpen(existing)
        }

        if let serverOnly = globalServerOnlySessions(for: familiarId).first {
            let thread = openServerSession(serverOnly, familiarId: familiarId)
            return requestOpen(thread)
        }

        guard let activeProject,
              projectMembershipLoaded,
              projectMembership.contains(familiarId, in: activeProject),
              let fresh = directThread(for: familiarId, in: .project(activeProject))
        else {
            reportGlobalFamiliarOpenFailure(for: familiarId)
            return false
        }

        return requestOpen(fresh)
    }

    func startFreshThreadInActiveProject(
        familiarIds: [String],
        title: String? = nil
    ) -> ChatThread? {
        guard let activeProject, let activeProjectRoot else { return nil }
        guard projectMembershipLoaded else {
            showToast(
                "Refresh Chats to load project access, then try again.",
                systemImage: "arrow.clockwise",
                style: .warning
            )
            return nil
        }
        let invalidFamiliarIDs = familiarIds.filter {
            !projectMembership.contains($0, in: activeProject)
        }
        guard invalidFamiliarIDs.isEmpty else {
            let invalidNames = invalidFamiliarIDs.map {
                familiar($0)?.displayName ?? $0
            }
            let subject = invalidNames.count == 1
                ? invalidNames[0]
                : "Some participants"
            showToast(
                "\(subject) can’t access \(activeProject.name). Open New Chat to choose a valid roster or switch projects, then try again.",
                systemImage: "person.crop.circle.badge.exclamationmark",
                style: .warning
            )
            return nil
        }
        return startFreshThread(
            familiarIds: familiarIds,
            title: title,
            projectRoot: activeProjectRoot
        )
    }

    func createGroup(
        familiarIds: [String],
        title: String?,
        projectRoot: String
    ) -> ChatThread {
        let names = familiarIds.compactMap { familiar($0)?.displayName ?? $0 }
        let derived = title?.isEmpty == false ? title! : names.joined(separator: ", ")
        let thread = ChatThread(
            title: derived,
            familiarIds: familiarIds,
            projectRoot: projectRoot
        )
        threads.insert(thread, at: 0)
        persistThreads()
        return thread
    }

    /// Always create a brand-new thread (no reuse) — backs `/new`. Works for a
    /// single familiar (direct) or several (group).
    func startFreshThread(
        familiarIds: [String],
        title: String? = nil,
        projectRoot: String
    ) -> ChatThread {
        let names = familiarIds.compactMap { familiar($0)?.displayName ?? $0 }
        let date = Date.now.formatted(.dateTime.month(.abbreviated).day())
        let derived = (title?.isEmpty == false)
            ? title!
            : "Chat with \(names.joined(separator: ", ")) on \(date)"
        let thread = ChatThread(
            title: derived,
            familiarIds: familiarIds,
            projectRoot: projectRoot
        )
        threads.insert(thread, at: 0)
        persistThreads()
        return thread
    }

    func deleteThread(_ thread: ChatThread) {
        guard let index = threads.firstIndex(where: { $0.id == thread.id }) else { return }
        let removed = threads[index]
        threads.remove(at: index)
        persistThreads()
        Haptics.success()
        showToast("Chat deleted", systemImage: "trash.fill")
        fanOutThreadDelete([(index, removed)])
    }

    /// Delete several threads at once (bulk select); persists once.
    func deleteThreads(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        // Capture positions before removing so a rejected delete can put each
        // chat back where it was rather than at the end of the list.
        let removed = threads.enumerated()
            .filter { ids.contains($0.element.id) }
            .map { ($0.offset, $0.element) }
        // Count what was actually matched, not what was selected: a stale
        // selection can name ids no longer in the list, and reporting those
        // would claim deletions that never happened.
        guard !removed.isEmpty else { return }
        let n = removed.count
        threads.removeAll { ids.contains($0.id) }
        persistThreads()
        Haptics.success()
        showToast("\(n) chat\(n == 1 ? "" : "s") deleted", systemImage: "trash.fill")
        fanOutThreadDelete(removed)
    }

    /// Sacrifice every session behind the removed threads.
    ///
    /// Deletion is already applied locally, so this restores any thread whose
    /// sessions the server refused — a delete that did not happen must not keep
    /// looking like it did. Threads that own no session (never sent) are dropped
    /// locally and need no server call. Successful earlier deletions shift the
    /// failed rows' insertion points left, preserving the surviving original
    /// order instead of blindly reusing stale absolute indexes.
    private func fanOutThreadDelete(_ removed: [(Int, ChatThread)]) {
        guard let client, !removed.isEmpty else { return }
        let targets = removed.filter { !serverSessionIds($0.1).isEmpty }
        guard !targets.isEmpty else { return }
        let targetSessionIDs = Set(targets.flatMap { serverSessionIds($0.1) })
        let suppressedSessions = Self.suppressServerSessions(
            serverSessions,
            withIDs: targetSessionIDs
        )
        self.serverSessions = suppressedSessions.remaining
        Task { [weak self] in
            var restoreIDs: Set<String> = []
            var failedSessionIDs: Set<String> = []
            var successfulSessionIDs: Set<String> = []
            var failedSessions = 0
            var totalSessions = 0
            for (_, thread) in targets {
                guard let sessionIds = self?.serverSessionIds(thread) else { continue }
                totalSessions += sessionIds.count
                var threadFailed = 0
                await withTaskGroup(of: (String, Bool).self) { group in
                    for sessionId in sessionIds {
                        group.addTask {
                            do {
                                try await client.deleteSession(sessionId: sessionId)
                                return (sessionId, true)
                            } catch {
                                return (sessionId, false)
                            }
                        }
                    }
                    for await (sessionId, ok) in group {
                        if ok {
                            successfulSessionIDs.insert(sessionId)
                        } else {
                            threadFailed += 1
                            failedSessionIDs.insert(sessionId)
                        }
                    }
                }
                if threadFailed > 0 {
                    failedSessions += threadFailed
                    restoreIDs.insert(thread.id)
                }
            }
            guard let self else { return }
            self.serverSessions.removeAll { successfulSessionIDs.contains($0.id) }
            for row in suppressedSessions.suppressed.filter({ failedSessionIDs.contains($0.id) })
            where !self.serverSessions.contains(where: { $0.id == row.id }) {
                self.serverSessions.append(row)
            }
            guard !restoreIDs.isEmpty else { return }
            self.threads = Self.restoringDeletedThreads(
                current: self.threads,
                removed: removed,
                restoring: restoreIDs
            )
            self.persistThreads()
            self.reportDeletePartial(
                restoredThreads: restoreIDs.count,
                failedSessions: failedSessions,
                totalSessions: totalSessions
            )
        }
    }

    static func suppressServerSessions(
        _ sessions: [SessionRow],
        withIDs ids: Set<String>
    ) -> (remaining: [SessionRow], suppressed: [SessionRow]) {
        (
            sessions.filter { !ids.contains($0.id) },
            sessions.filter { ids.contains($0.id) }
        )
    }

    static func restoringDeletedThreads(
        current: [ChatThread],
        removed: [(index: Int, thread: ChatThread)],
        restoring restoreIDs: Set<String>
    ) -> [ChatThread] {
        var restored = current
        let successfulIndexes = removed
            .filter { !restoreIDs.contains($0.thread.id) }
            .map(\.index)

        for item in removed.filter({ restoreIDs.contains($0.thread.id) }).sorted(by: { $0.index < $1.index }) {
            guard !restored.contains(where: { $0.id == item.thread.id }) else { continue }
            let successfulBefore = successfulIndexes.count { $0 < item.index }
            let shiftedIndex = item.index - successfulBefore
            restored.insert(item.thread, at: min(max(shiftedIndex, 0), restored.count))
        }
        return restored
    }

    /// Rename a thread (local title only); no-ops on a blank or unchanged name.
    func renameThread(_ thread: ChatThread, to title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != thread.title,
              let target = threads.first(where: { $0.id == thread.id }) else { return }
        target.title = trimmed
        persistThreads()
    }

    /// Archive or restore a thread; archived threads are hidden from the default
    /// lists but kept on disk.
    func setThreadArchived(_ thread: ChatThread, _ archived: Bool) {
        guard let target = threads.first(where: { $0.id == thread.id }),
              target.archived != archived else { return }
        target.archived = archived
        persistThreads()
        fanOutThreadFlag(target, verb: archived ? "archive" : "unarchive") { client, sessionId in
            try await client.setSessionFlags(sessionId: sessionId, archived: archived)
        } rollback: { $0.archived = !archived }
    }

    /// Pin or unpin a thread; pinned threads sort to the top of their list.
    func setThreadPinned(_ thread: ChatThread, _ pinned: Bool) {
        guard let target = threads.first(where: { $0.id == thread.id }),
              target.pinned != pinned else { return }
        target.pinned = pinned
        persistThreads()
        fanOutThreadFlag(target, verb: pinned ? "pin" : "unpin") { client, sessionId in
            try await client.setSessionFlags(sessionId: sessionId, pinned: pinned)
        } rollback: { $0.pinned = !pinned }
    }

    /// Session ids a thread owns on the server. A thread that has never been
    /// sent owns none — there is nothing to persist remotely and its flags stay
    /// device-local until the first send creates a session.
    private func serverSessionIds(_ thread: ChatThread) -> [String] {
        thread.sessionIds.values.filter { !$0.isEmpty }
    }

    /// In-flight flag writes per thread, so a rapid pin/unpin cannot let the
    /// older result land last (same hazard as `statusWrites` for tasks).
    @ObservationIgnored private var threadFlagWrites: [String: Task<Void, Never>] = [:]

    /// Push a thread-level flag to every session the thread owns.
    ///
    /// The caller has already applied the change locally, so this is the
    /// optimistic tail: on failure it rolls the flag back and says so, rather
    /// than leaving the list showing a state the server never accepted. A
    /// thread owns at most one session per familiar, so the fan-out is small
    /// and runs unbounded — unlike the reminder fan-out, which is over an
    /// arbitrary selection and is width-limited.
    private func fanOutThreadFlag(
        _ thread: ChatThread,
        verb: String,
        _ call: @escaping @Sendable (CaveClient, String) async throws -> Void,
        rollback: @escaping (ChatThread) -> Void,
    ) {
        guard let client else { return }
        let ids = serverSessionIds(thread)
        guard !ids.isEmpty else { return }
        let threadId = thread.id
        threadFlagWrites[threadId]?.cancel()
        threadFlagWrites[threadId] = Task { [weak self] in
            var failed = 0
            await withTaskGroup(of: Bool.self) { group in
                for sessionId in ids {
                    group.addTask {
                        do { try await call(client, sessionId); return true } catch { return false }
                    }
                }
                for await ok in group where !ok { failed += 1 }
            }
            guard let self, !Task.isCancelled else { return }
            if failed > 0 {
                rollback(thread)
                self.persistThreads()
                self.reportPartial(failed, of: ids.count, verb: verb)
            }
            self.threadFlagWrites[threadId] = nil
        }
    }

    /// Mute or unmute a thread's notifications (persisted; honoured by the
    /// turn-completion notification path).
    func setThreadMuted(_ thread: ChatThread, _ muted: Bool) {
        guard let target = threads.first(where: { $0.id == thread.id }),
              target.muted != muted else { return }
        target.muted = muted
        persistThreads()
    }

    /// Render a thread's conversation to Markdown for the share/export action.
    /// Skips empty/streaming-placeholder turns; attributes each to "You", the
    /// familiar's display name, or "System".
    func exportMarkdown(_ thread: ChatThread) -> String {
        var lines: [String] = ["# \(thread.title)", ""]
        let names = thread.familiarIds.map { familiar($0)?.displayName ?? $0 }
        if !names.isEmpty {
            lines.append("_Chat with \(names.joined(separator: ", "))_")
            lines.append("")
        }
        for message in thread.messages {
            let text = message.text.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            let who: String
            switch message.role {
            case .user: who = "You"
            case .assistant: who = message.familiarId.flatMap { familiar($0)?.displayName } ?? "Assistant"
            case .system: who = "System"
            }
            lines.append("**\(who)**")
            lines.append("")
            lines.append(text)
            lines.append("")
        }
        return lines.joined(separator: "\n")
    }

    /// Build a new thread from a Markdown transcript (inverse of
    /// `exportMarkdown`). "You"/"System" map to user/system turns; other authors
    /// become assistant turns, resolved to a familiar by display name when
    /// possible. Inserts at the top and persists.
    @discardableResult
    func importMarkdown(
        _ text: String,
        fallbackTitle: String = "Imported chat",
        familiarIds preferredFamiliarIds: [String] = [],
        projectRoot: String
    ) -> ChatThread {
        let parsed = parseThreadMarkdown(text)
        func resolve(_ name: String) -> String? {
            familiars.first { $0.displayName.caseInsensitiveCompare(name) == .orderedSame }?.id
        }
        var discoveredFamiliarIds: [String] = []
        var messages: [DisplayMessage] = []
        for turn in parsed.turns {
            switch turn.who.lowercased() {
            case "you":
                messages.append(DisplayMessage(role: .user, familiarId: nil, text: turn.text))
            case "system":
                messages.append(DisplayMessage(role: .system, familiarId: nil, text: turn.text))
            default:
                let fid = resolve(turn.who)
                if let fid { discoveredFamiliarIds.append(fid) }
                messages.append(DisplayMessage(role: .assistant, familiarId: fid, text: turn.text))
            }
        }
        for name in parsed.participants {
            if let fid = resolve(name) { discoveredFamiliarIds.append(fid) }
        }
        let familiarIds = ChatProjectSelection.importedFamiliarIDs(
            preferred: preferredFamiliarIds,
            discovered: discoveredFamiliarIds
        )
        let title = parsed.title.isEmpty ? fallbackTitle : parsed.title
        let thread = ChatThread(
            title: title,
            familiarIds: familiarIds,
            projectRoot: projectRoot,
            messages: messages
        )
        threads.insert(thread, at: 0)
        persistThreads()
        return thread
    }

    /// Copy a thread into a new, independent local thread — fresh message ids,
    /// no server session (so sending in the copy starts clean), and reset
    /// pin/archive/mute. Inserts at the top and persists.
    @discardableResult
    func duplicateThread(_ thread: ChatThread) -> ChatThread {
        let copiedMessages = thread.messages.map { message in
            DisplayMessage.duplicate(of: message)
        }
        let copy = ChatThread(title: "\(thread.title) (copy)",
                              familiarIds: thread.familiarIds,
                              projectRoot: thread.projectRoot,
                              messages: copiedMessages)
        threads.insert(copy, at: 0)
        persistThreads()
        return copy
    }

    /// Bundle every thread's Markdown into a single `.zip` and return its URL.
    /// Filenames come from titles (de-duplicated); zipping uses NSFileCoordinator's
    /// `.forUploading`, so there's no third-party dependency.
    func exportAllThreadsZip() throws -> URL { try exportThreadsZip(threads) }

    /// Bundle the given threads' Markdown into a single `.zip` and return its URL.
    func exportThreadsZip(_ threads: [ChatThread]) throws -> URL {
        let fm = FileManager.default
        let staging = fm.temporaryDirectory
            .appendingPathComponent("CovenCave Chats-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: staging) }

        let invalid = CharacterSet(charactersIn: "/\\:?%*|\"<>")
        var used = Set<String>()
        for thread in threads {
            let trimmed = thread.title.trimmingCharacters(in: .whitespacesAndNewlines)
            var base = ""
            for scalar in (trimmed.isEmpty ? "chat" : trimmed).unicodeScalars {
                base.append(invalid.contains(scalar) ? "-" : Character(scalar))
            }
            var name = base
            var n = 2
            while used.contains(name.lowercased()) { name = "\(base) \(n)"; n += 1 }
            used.insert(name.lowercased())
            try exportMarkdown(thread)
                .write(to: staging.appendingPathComponent("\(name).md"), atomically: true, encoding: .utf8)
        }

        var zipURL: URL?
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: staging, options: .forUploading, error: &coordError) { tmp in
            let dest = fm.temporaryDirectory.appendingPathComponent("CovenCave Chats.zip")
            try? fm.removeItem(at: dest)
            if (try? fm.copyItem(at: tmp, to: dest)) != nil { zipURL = dest }
        }
        if let coordError { throw coordError }
        guard let zipURL else { throw CocoaError(.fileWriteUnknown) }
        return zipURL
    }

    func touch(_ thread: ChatThread) {
        // Move the most recently active thread to the top, then persist.
        if let idx = threads.firstIndex(where: { $0.id == thread.id }), idx != 0 {
            threads.remove(at: idx)
            threads.insert(thread, at: 0)
        }
        persistThreads()
    }

    // MARK: - Persistence

    private static var threadsFileURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("cave-threads.json")
    }

    /// Pending debounced thread-persist flush. Not observable state.
    @ObservationIgnored private var persistThreadsTask: Task<Void, Never>?

    /// The in-flight snapshot write, kept separate from the debounce timer
    /// above (cave-2cpo). Two things need it: a newer flush must be able to
    /// supersede a stale write rather than race it, and a lifecycle caller must
    /// be able to await durability. `ThreadSnapshotStore` is an actor, so two
    /// saves can never interleave — but actors make no FIFO promise, so without
    /// this the OLDER snapshot could still resume last and overwrite newer
    /// state on disk.
    @ObservationIgnored private var threadWriteTask: Task<Void, Never>?

    /// Guards against saving before the async `hydrateThreads()` restore has
    /// settled. Without it, a background/flush that fires before hydration
    /// publishes would snapshot the not-yet-hydrated (possibly empty) `threads`
    /// array and overwrite the user's snapshot file with nothing. Set true once
    /// the load settles — including the load-failure/empty path, where later
    /// saves are legitimate.
    @ObservationIgnored private var threadsHydrated = false
    @ObservationIgnored private var hydrateThreadsTask: Task<Void, Never>?

    func persistThreads() {
        // Debounce: many call sites (message send/receive, edits, archive,
        // reorder) fire in quick bursts. Encoding every thread + message to
        // JSON and writing to disk on each call — on the main thread — was a
        // needless hitch. Coalesce bursts into one write shortly after the last
        // change, and do the encode + write off the main thread.
        persistThreadsTask?.cancel()
        persistThreadsTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.flushThreads()
        }
    }

    /// Snapshot on the main actor (cheap value-type map), then hand the encode
    /// + atomic write to the store actor. Call directly when an immediate flush
    /// is required (e.g. app moving to the background).
    func flushThreads() {
        // Never persist before hydration settles — see `threadsHydrated`.
        guard threadsHydrated else { return }
        persistThreadsTask?.cancel()
        persistThreadsTask = nil
        let snapshots = threads.map(\.snapshot)
        // Supersede, then chain (cave-2cpo). Cancelling lets `save`'s entry
        // `checkCancellation` drop a write that has not started, and awaiting
        // the superseded task before saving means writes land in CALL order —
        // the actor alone only guarantees they do not overlap, not which one
        // wins. Without both, a burst could leave the older snapshot on disk.
        let previous = threadWriteTask
        previous?.cancel()
        threadWriteTask = Task.detached(priority: .utility) { [threadStore] in
            _ = await previous?.value
            // Non-fatal: persistence is best-effort.
            try? await threadStore.save(snapshots)
        }
    }

    /// Flush and await the write. The scene-phase handler uses this when the
    /// app leaves the foreground: `flushThreads()` alone returns the instant
    /// the task is spawned, so the process could be suspended before the bytes
    /// reach disk — which is exactly the durability the caller believed it had.
    func flushThreadsAndWait() async {
        flushThreads()
        _ = await threadWriteTask?.value
    }

    /// One-shot restore at launch: load off-main via the store and publish the
    /// decoded threads in a single assignment. Threads created before the load
    /// lands (unlikely, launch-fast) are kept — restored ones merge in by id.
    private func hydrateThreads() async {
        let snapshots = await threadSnapshotLoader()
        // The load has settled: from here on saves can no longer clobber an
        // unread snapshot file, so flushes are safe even if we restored nothing.
        defer {
            threadsHydrated = true
            _ = resolvePendingProjectNavigationIntent()
        }
        guard !snapshots.isEmpty else { return }
        let existing = Set(threads.map(\.id))
        let restored = snapshots
            .filter { !existing.contains($0.id) }
            .map { ChatThread(snapshot: $0) }
        guard !restored.isEmpty else { return }
        threads = (threads + restored).sorted { $0.updatedAt > $1.updatedAt }
        seedThreadDrafts()
    }

    private var cardLinksFileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("cave-card-links.json")
    }

    func persistCardLinks() {
        do {
            let data = try JSONEncoder().encode(cardThreadLinks)
            try data.write(to: cardLinksFileURL, options: .atomic)
        } catch {
            // Non-fatal: best-effort persistence.
        }
    }

    private func loadCardLinks() {
        guard let data = try? Data(contentsOf: cardLinksFileURL),
              let map = try? JSONDecoder().decode([String: String].self, from: data) else {
            return
        }
        cardThreadLinks = map
    }

    private var familiarViewsFileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("cave-familiar-views.json")
    }

    private func persistFamiliarViews() {
        do {
            let data = try JSONEncoder().encode(familiarViews)
            try data.write(to: familiarViewsFileURL, options: .atomic)
        } catch {
            // Non-fatal: best-effort persistence.
        }
    }

    private func loadFamiliarViews() {
        guard let data = try? Data(contentsOf: familiarViewsFileURL),
              let views = try? JSONDecoder().decode([String: Date].self, from: data) else {
            return
        }
        familiarViews = views
    }
}
