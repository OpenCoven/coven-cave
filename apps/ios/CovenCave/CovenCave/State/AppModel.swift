import Foundation
import Network
import Observation
import WidgetKit

/// The primary destinations. Lifted out of the drawer shell so slash commands
/// (`/board`, `/chats`) can drive selection from anywhere.
enum AppTab: String, CaseIterable { case chats, tasks, terminal, settings }

extension AppTab {
    static let drawerDestinations: [AppTab] = [.chats, .tasks, .terminal, .settings]
    static let shortcutOrder: [AppTab] = drawerDestinations
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
    enum ConnectionState: Equatable {
        case unconfigured
        case checking
        case connected
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
    /// Process-lifetime launch intent. It survives destination remounts until a
    /// matching hydrated thread can be opened, then is consumed exactly once.
    var launchThreadId: String?

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

    /// A thread a command asked to open. `ChatsHomeView` observes this, pushes
    /// the thread, and clears it back to nil (one-shot navigation intent).
    var threadToOpen: ChatThread?

    /// A task the user asked to open from a chat. `TasksView` observes this,
    /// pushes the card, and clears it (mirrors `threadToOpen`).
    var cardToOpen: BoardCard?

    /// Global Claude Design navigation. Any top-level surface can open the
    /// shared drawer; one-shot requests let its Search/Chat actions hand off to
    /// the Chats split view without coupling the drawer to local view state.
    var navigationDrawerOpen = false
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

    /// Ask the chat list to open a thread (switches to Chats first).
    func requestOpen(_ thread: ChatThread) {
        selectedTab = .chats
        threadToOpen = thread
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
        requestOpen(chosen)
        return true
    }

    /// Consume the launch-thread intent only after its thread is available.
    /// A delayed thread restore leaves the id pending for `ChatsHomeView` to
    /// retry when hydration publishes its matching thread.
    func consumeLaunchThreadIntent() -> ChatThread? {
        guard let launchThreadId,
              let thread = threads.first(where: { $0.id == launchThreadId })
        else { return nil }
        self.launchThreadId = nil
        return thread
    }

    /// Ask the Tasks destination to open a card's detail (selects Tasks first).
    func requestOpenTask(_ card: BoardCard) {
        selectedTab = .tasks
        cardToOpen = card
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

    // MARK: - Developer surface

    /// Configured project roots, shared across the Code and Terminal surfaces.
    var projects: [ProjectInfo] = []
    var projectsError: String?
    var projectsLoaded = false

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

    #if DEBUG
    @ObservationIgnored private var previewChatProjects: [ProjectInfo]?
    #endif

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

    /// threadId → the operator's unsent composer draft, mirrored from the
    /// per-thread UserDefaults keys so list rows can badge drafted threads
    /// without hitting UserDefaults on every row render. Seeded on hydrate,
    /// kept current by the composer's debounced persistence.
    var threadDrafts: [String: String] = [:]

    init() {
        connection = CaveConnection.load()
        launchThreadId = ProcessInfo.processInfo.environment["CAVE_OPEN_THREAD"]
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-preview-connecting") {
            connection = CaveConnection(host: "cave-desktop.example")
            connectionState = .checking
            isConnectingPreview = true
            ChatTurnNotifier.shared.app = self
            return
        }

        if ProcessInfo.processInfo.arguments.contains("--ui-preview-design-closeout") {
            configureDesignCloseoutPreview()
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
                        familiarIds: ["nyx"]
                    )
                )
            }
            ChatTurnNotifier.shared.app = self
            return
        }

        // Sibling fixture for the agent-activity trail — a settled turn whose
        // steps cover every status a tool row can carry. Launch with
        // `--ui-preview-tool-activity` and
        // `CAVE_OPEN_THREAD=ui-preview-tool-activity`.
        if ProcessInfo.processInfo.arguments.contains("--ui-preview-tool-activity") {
            configureToolActivityPreview()
            ChatTurnNotifier.shared.app = self
            return
        }
        #endif
        // Threads hydrate off-main via the store — no file I/O in init.
        Task { await self.hydrateThreads() }
        loadCardLinks()
        loadFamiliarViews()
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
        threads = [
            ChatThread(
                id: "ui-preview-empty-chat",
                title: "Chat with Nyx on Jul 26",
                familiarIds: ["nyx"]
            ),
        ]
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--ui-preview-new-chat-projects")
            || arguments.contains("--ui-preview-new-chat-project-retry")
            || arguments.contains("--ui-preview-new-chat-project-empty-retry") {
            threads.first?.projectRoot = "/repos/coven-cave"
            previewChatProjects = [
                ProjectInfo(
                    id: "coven-cave",
                    name: "Coven Cave",
                    root: "/repos/coven-cave",
                    color: nil,
                    updatedAt: nil,
                    access: .write
                ),
            ]
        }
        connectionState = .connected
    }

    /// Screenshot fixture for the remaining compatible Claude Design affordances:
    /// app-wide search, real project activity metadata, and paired GitHub/task
    /// context. It builds on the canonical preview so all values stay consistent.
    private func configureDesignCloseoutPreview() {
        configureEmptyChatPreview()
        let projectRoot = "/Users/buns/Code/coven-cave"
        projects = [
            ProjectInfo(
                id: "coven-app",
                name: "Coven Cave",
                root: projectRoot,
                color: nil,
                updatedAt: "2026-08-06T09:00:00Z"
            ),
        ]
        projectsLoaded = true
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
        ]
        sessionsLoaded = true

        if let thread = threads.first {
            thread.projectRoot = projectRoot
            thread.messages = [
                DisplayMessage(
                    role: .assistant,
                    familiarId: "nyx",
                    text: "The iOS design closeout is ready for review."
                ),
            ]
        }
        cardThreadLinks["cold-launch"] = "ui-preview-empty-chat"
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
        tasksLoaded = true
        sessionsLoaded = true

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
                messages: [
                    DisplayMessage(role: .user, text: "fix the ios tool calls"),
                    reply,
                ]
            ),
        ]
        connectionState = .connected
    }
    #endif

    func familiar(_ id: String) -> Familiar? {
        familiars.first { $0.id == id }
    }

    func project(_ id: String) -> ProjectInfo? {
        projects.first { $0.id == id }
    }

    func loadTasks() async {
        guard let client else { return }
        do {
            tasks = try await client.tasks()
            tasksError = nil
        } catch {
            tasksError = handleSurfaceError(error)
        }
        tasksLoaded = true
        // A task that finished on the desktop should drop its Lock Screen activity.
        await LiveActivityManager.shared.reconcile(tasks)
        publishWidgetSnapshot()
    }

    // MARK: - Task actions

    /// Optimistically set a task's status, then reconcile with the server's
    /// echoed card (it stamps lifecycle/updatedAt). Reverts on failure.
    /// In-flight status writes, keyed by card id, so a newer intent can cancel
    /// the one it supersedes (cave-ioswipe.4).
    @ObservationIgnored private var statusWrites: [String: Task<Void, Never>] = [:]

    /// Entry point for every status mutation. Views must call this rather than
    /// wrapping `setTaskStatus` in their own `Task { }`: a detached task cannot
    /// be cancelled, so a rapid done/reopen swipe sequence would leave two
    /// writes racing and let the *older* server response land last, snapping the
    /// row back to a status the user already moved off of.
    func requestTaskStatus(_ card: BoardCard, _ status: CardStatus) {
        statusWrites[card.id]?.cancel()
        let cardId = card.id
        statusWrites[cardId] = Task { [weak self] in
            await self?.setTaskStatus(card, status)
            // Drop the finished task so the map tracks only in-flight writes
            // rather than accumulating one retained Task per card ever touched.
            // Skip when cancelled: being cancelled means a newer write already
            // replaced this entry, and clearing would lose the handle needed to
            // cancel *that* one.
            guard !Task.isCancelled else { return }
            self?.statusWrites[cardId] = nil
        }
    }

    /// Restore a single card, mirroring `revert(_:to:)` for reminders. Assigning
    /// the whole `tasks` array back would also roll back concurrent edits to
    /// *other* cards that succeeded while this one was in flight.
    private func revertTask(id: String, to previous: [BoardCard]) {
        guard let old = previous.first(where: { $0.id == id }) else { return }
        applyTask(id: id) { $0 = old }
    }

    func setTaskStatus(_ card: BoardCard, _ status: CardStatus) async {
        guard let client, status != card.status else { return }
        let previous = tasks
        applyTask(id: card.id) { $0.statusRaw = status.rawValue }
        do {
            let updated = try await client.updateTask(cardId: card.id, status: status)
            // A newer write for this card already applied its own optimistic
            // state; landing this stale response would undo it.
            guard !Task.isCancelled else { return }
            applyTask(id: card.id) { $0 = updated }
            Haptics.tap()
            await LiveActivityManager.shared.reconcile(tasks)
            publishWidgetSnapshot()
        } catch {
            // Cancellation surfaces here as a thrown CancellationError. Reverting
            // on it would clobber the newer intent that did the cancelling.
            guard !Task.isCancelled else { return }
            revertTask(id: card.id, to: previous)
            tasksError = error.localizedDescription
            reportRevert("update the task")
        }
    }

    /// Optimistically set a task's priority; reconcile/revert like status.
    func setTaskPriority(_ card: BoardCard, _ priority: CardPriority) async {
        guard let client, priority != card.priority else { return }
        let previous = tasks
        applyTask(id: card.id) { $0.priorityRaw = priority.rawValue }
        do {
            let updated = try await client.updateTask(cardId: card.id, priority: priority)
            applyTask(id: card.id) { $0 = updated }
            Haptics.tap()
        } catch {
            revertTask(id: card.id, to: previous)
            tasksError = error.localizedDescription
            reportRevert("update the task")
        }
    }

    /// Toggle a checklist step's done flag, persisting the whole step list.
    func toggleStep(_ card: BoardCard, stepId: String) async {
        guard let client, var steps = card.steps,
              let idx = steps.firstIndex(where: { $0.id == stepId }) else { return }
        steps[idx].done.toggle()
        let newSteps = steps
        let previous = tasks
        applyTask(id: card.id) { $0.steps = newSteps }
        do {
            let updated = try await client.updateTask(cardId: card.id, steps: newSteps)
            applyTask(id: card.id) { $0 = updated }
        } catch {
            revertTask(id: card.id, to: previous)
            tasksError = error.localizedDescription
        }
    }

    /// Append a new checklist step.
    func addStep(_ card: BoardCard, text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var steps = card.steps ?? []
        steps.append(CardStep(id: UUID().uuidString, text: trimmed, done: false, doneAt: nil))
        await commitSteps(card, steps)
    }

    /// Remove a checklist step.
    func deleteStep(_ card: BoardCard, stepId: String) async {
        guard var steps = card.steps else { return }
        steps.removeAll { $0.id == stepId }
        await commitSteps(card, steps)
    }

    /// Move a step up (delta -1) or down (delta +1) in the list.
    func moveStep(_ card: BoardCard, stepId: String, by delta: Int) async {
        guard var steps = card.steps, let i = steps.firstIndex(where: { $0.id == stepId }) else { return }
        let j = i + delta
        guard j >= 0, j < steps.count else { return }
        steps.swapAt(i, j)
        await commitSteps(card, steps)
    }

    /// Optimistically persist a new step list, reconciling with the server's
    /// echoed card (reverts on failure) — shared by add/delete/move.
    private func commitSteps(_ card: BoardCard, _ steps: [CardStep]) async {
        guard let client else { return }
        let previous = tasks
        applyTask(id: card.id) { $0.steps = steps }
        do {
            let updated = try await client.updateTask(cardId: card.id, steps: steps)
            applyTask(id: card.id) { $0 = updated }
        } catch {
            revertTask(id: card.id, to: previous)
            tasksError = error.localizedDescription
        }
    }

    /// Optimistically set a task's notes (pass "" to clear); reconcile/revert.
    func setTaskNotes(_ card: BoardCard, _ notes: String) async {
        guard let client else { return }
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != (card.notes ?? "") else { return }
        let previous = tasks
        applyTask(id: card.id) { $0.notes = trimmed }
        do {
            let updated = try await client.updateTask(cardId: card.id, notes: trimmed)
            applyTask(id: card.id) { $0 = updated }
        } catch {
            revertTask(id: card.id, to: previous)
            tasksError = error.localizedDescription
        }
    }

    /// Optimistically rename a task; reconcile/revert like notes.
    func setTaskTitle(_ card: BoardCard, _ title: String) async {
        guard let client else { return }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != card.title else { return }
        let previous = tasks
        applyTask(id: card.id) { $0.title = trimmed }
        do {
            let updated = try await client.updateTaskTitle(cardId: card.id, title: trimmed)
            applyTask(id: card.id) { $0 = updated }
        } catch {
            revertTask(id: card.id, to: previous)
            tasksError = error.localizedDescription
        }
    }

    /// Optimistically set a task's start/due dates (date-only strings, nil to
    /// clear); reconcile/revert.
    func setTaskDates(_ card: BoardCard, start: String?, end: String?) async {
        guard let client, start != card.startDate || end != card.endDate else { return }
        let previous = tasks
        applyTask(id: card.id) { $0.startDate = start; $0.endDate = end }
        do {
            let updated = try await client.updateTaskDates(cardId: card.id, startDate: start, endDate: end)
            applyTask(id: card.id) { $0 = updated }
            Haptics.tap()
        } catch {
            revertTask(id: card.id, to: previous)
            tasksError = error.localizedDescription
            reportRevert("reschedule the task")
        }
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

    // MARK: - Developer surface actions

    func loadProjects() async {
        guard let client else { return }
        do {
            projects = try await client.projects()
            projectsError = nil
        } catch {
            projectsError = handleSurfaceError(error)
        }
        projectsLoaded = true
    }

    // MARK: - Reminders

    func loadReminders() async {
        guard let client else { return }
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
        await ReminderNotifications.requestAuthorizationIfNeeded()
        await ReminderNotifications.sync(reminders)
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
            updatedAt: now
        ))
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
        // covencave://thread/<id> — a chat notification / Live Activity tap
        // jumps straight into its thread via the existing one-shot intent.
        if let threadId = ChatNotifications.threadId(fromDeepLink: url) {
            launchThreadId = threadId
            selectedTab = .chats
            if let thread = consumeLaunchThreadIntent() { requestOpen(thread) }
            return
        }
        guard let target = DeepLink(rawValue: url.host ?? "") else { return }
        selectedTab = .tasks
        deepLink = target
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
        guard let client, !ids.isEmpty else { return }
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
                                _ call: (CaveClient) async throws -> Reminder?) async {
        guard let client else { return }
        let previous = reminders
        applyReminder(id: reminder.id) { $0.status = optimistic }
        do {
            if let updated = try await call(client) { applyReminder(id: reminder.id) { $0 = updated } }
            Haptics.success()
        } catch {
            reminders = previous
            remindersError = error.localizedDescription
            reportRevert("update the reminder")
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
        guard let client, !ids.isEmpty else { return }
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

    /// Bounded concurrent fan-out for actions with no bulk endpoint. Caps
    /// in-flight requests so a large selection cannot open one socket per item,
    /// and reverts only the items that actually failed.
    private static let reminderFanOutWidth = 4

    private func boundedReminderFanOut(
        _ ids: Set<String>,
        optimistic: String,
        verb: String,
        _ call: @escaping @Sendable (CaveClient, String) async throws -> Reminder?,
    ) async {
        guard let client, !ids.isEmpty else { return }
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
            if ok { if let updated { applyReminder(id: id) { $0 = updated } } } else { failed.insert(id) }
        }
        guard !failed.isEmpty else { Haptics.success(); return }
        revert(failed, to: previous)
        reportPartial(failed.count, of: ids.count, verb: verb)
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
            CaveConnection.saveAccessToken(token)
        } else if !isSameEndpoint {
            // Tokens are stored globally, so never carry an old desktop's
            // credential to a newly configured host from an uncredentialed input.
            CaveConnection.saveAccessToken(nil)
        }
        if !isSameEndpoint {
            resetHostScopedStateForNewConnection()
        }

        connection = conn
        conn.save()
        // A probe of the previous endpoint must not be joined as this
        // configuration's outcome.
        await refreshCoordinator.cancelActiveRefresh()
        await refreshConnection()
    }

    private func resetHostScopedStateForNewConnection() {
        familiars = []
        familiarsError = nil
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
        CaveConnection.clear()
        connection = nil
        familiars = []
        connectionState = .unconfigured
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

    /// Any surface holds real data — the primary shell is worth keeping mounted
    /// through a connection drop (RootView shows the reconnect pill over it
    /// instead of tearing down to the Connect screen).
    var hasLoadedSurfaces: Bool {
        !familiars.isEmpty || sessionsLoaded || tasksLoaded || remindersLoaded || projectsLoaded
    }

    private var shouldReloadLoadedSurfaces: Bool { hasLoadedSurfaces }

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

    /// Familiars + theme + profile fetched concurrently, each applied
    /// independently — one failing resource must not discard the others.
    /// Mirrors the semantics of `loadFamiliars`/`loadTheme`/`loadOperatorProfile`.
    private func loadCoreResources() async {
        guard let client else { return }
        let payload = await ConnectionBootstrap.load(using: client)
        switch payload.familiars {
        case .success(let loaded):
            familiars = loaded
            seedFamiliarViews(familiars.map(\.id))
            familiarsError = nil
        case .failure(let error):
            familiarsError = handleSurfaceError(error)
        }
        // Theme and profile stay best-effort: on failure the last snapshot
        // stands (no flash back to the fallback chrome / "You").
        if case .success(let snapshot) = payload.theme { adopt(snapshot) }
        if case .success(let profile) = payload.profile, operatorProfile != profile {
            operatorProfile = profile
        }
    }

    /// Each loader owns disjoint state and applies on the main actor, so they
    /// can overlap their network waits — wall time tracks the slowest surface
    /// rather than the sum of all of them.
    private func refreshLoadedSurfaces() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadCoreResources() }
            if sessionsLoaded { group.addTask { await self.loadSessions() } }
            if tasksLoaded { group.addTask { await self.loadTasks() } }
            if remindersLoaded { group.addTask { await self.loadReminders() } }
            if projectsLoaded { group.addTask { await self.loadProjects() } }
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
        let candidates = connection.prioritizedCandidateBaseURLs
        // Identity of the endpoint this probe describes. `configure()` cancels
        // the in-flight probe, but a launcher that already passed its
        // `Task.isCancelled` check races that cancel — without this capture it
        // would compare its stale outcome against the user's just-entered
        // endpoint, "relocate", and persist the old one back.
        let probedBaseURL = connection.baseURL
        let refresh = await refreshCoordinator.refresh(requestSurfaceReload: reloadLoadedSurfaces) {
            // Try the configured endpoint first, then auto-relocate to a
            // working port (e.g. a `.ts.net` host typed without `:8443`).
            let outcome = await Self.discoverBaseURL(candidates)
            guard !Task.isCancelled else { return .cancelled }
            switch outcome {
            case .found(let url): return .found(url)
            case .unauthorized: return .unauthorized
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
            // Remember what answered, keyed by the host we probed, so the next
            // reconnect starts here (cave-ioswipe.3). Recorded even when the URL
            // is unchanged: a first success is exactly what makes the fast path
            // available on the following launch.
            if let host = self.connection?.host {
                CaveConnection.saveLastGoodBaseURL(working, forHost: host)
            }
            if working != self.connection?.baseURL {
                // Relocate: persist the working endpoint so future launches
                // connect directly. Stored as bare `host:port` when the
                // default scheme derivation reproduces the URL — a bare host
                // keeps future discovery able to probe alternate ports if the
                // desktop moves again, while a full URL is treated as
                // user-explicit and would pin the connection forever.
                let relocated = CaveConnection(host: Self.canonicalHost(for: working))
                self.connection = relocated
                relocated.save()
                if let port = working.port {
                    showToast("Connected on port \(port)", systemImage: "antenna.radiowaves.left.and.right")
                }
            }
            connectionState = .connected
            await refreshAccessTokenIfNeeded()
            flushQueuedMessages()
            // OR of this launcher's own flag and any joiner's merged intent.
            if refresh.surfaceReloadRequested {
                await refreshLoadedSurfaces()
            } else {
                await loadCoreResources()
            }
        case .unauthorized:
            connectionState = .needsAuth(pairingMessage())
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
        guard let client, let token = CaveConnection.accessToken else { return }
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
    /// never a flash of the unreachable screen. Drives launch + foreground reconnect.
    func connectWithRetry() async {
        guard connection != nil else { connectionState = .unconfigured; return }
        // Delays BETWEEN attempts (4 attempts total, ~7s before giving up).
        let backoffSeconds: [UInt64] = [1, 2, 4]
        await refreshConnection(reloadLoadedSurfaces: shouldReloadLoadedSurfaces)
        var attempt = 0
        while connectionState != .connected, attempt < backoffSeconds.count {
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

    private enum ProbeResult { case ok, unauthorized, failed(ProbeFailure) }

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
        if sendCredential, let token = CaveConnection.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
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
        guard let client else { return }
        do {
            familiars = try await client.familiars()
            seedFamiliarViews(familiars.map(\.id))
            familiarsError = nil
        } catch {
            familiarsError = handleSurfaceError(error)
        }
    }

    // MARK: - Unread tracking

    /// True when a familiar has activity newer than the last time its chats were
    /// viewed. New familiars are seeded as "seen now" (see `seedFamiliarViews`),
    /// so only genuinely new activity — e.g. a reply that arrived on the desktop
    /// — flags as unread, not the entire backlog on first launch.
    func hasUnread(_ familiarId: String) -> Bool {
        guard let seen = familiarViews[familiarId],
              let activity = lastActivity(for: familiarId) else { return false }
        return activity > seen
    }

    /// Earliest "last viewed" date across a thread's familiars — the boundary
    /// the "New Messages" divider is placed against. nil when untracked.
    func seenBoundary(for thread: ChatThread) -> Date? {
        thread.familiarIds.compactMap { familiarViews[$0] }.min()
    }

    /// Mark a familiar's chats as read (call when opening them).
    func markFamiliarViewed(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        let now = Date()
        for id in ids { familiarViews[id] = now }
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
    private func seedFamiliarViews(_ ids: [String]) {
        let now = Date()
        var changed = false
        for id in ids where familiarViews[id] == nil { familiarViews[id] = now; changed = true }
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
        guard let client else { return }
        do {
            serverSessions = try await client.sessions()
            sessionsError = nil
        } catch {
            sessionsError = handleSurfaceError(error)
        }
        sessionsLoaded = true
        lastSessionsLoadedAt = Date()
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

    /// Direct (1:1) on-device threads for a familiar, newest-updated first.
    func directThreads(for familiarId: String) -> [ChatThread] {
        threads
            .filter { !$0.isGroup && $0.familiarIds == [familiarId] }
            .sorted { a, b in
                if a.pinned != b.pinned { return a.pinned }
                return a.updatedAt > b.updatedAt
            }
    }

    /// The thread a familiar's chat lands on: its pinned thread if it has an
    /// unarchived one, otherwise its newest-updated unarchived direct thread.
    /// Archived threads are never eligible, pinned or not — `directThreads`
    /// sorts pinned-first, then by recency, and this takes the first eligible
    /// entry. Callers that render a timestamp are showing the landing thread's
    /// activity, which is deliberately NOT always the familiar's latest.
    /// Nil when the familiar has no eligible thread — callers start a new chat.
    func landingDirectThread(for familiarId: String) -> ChatThread? {
        directThreads(for: familiarId).first { !$0.archived }
    }

    /// Every group thread, newest first — shown as its own rows on the Chats
    /// home (a group has no single familiar to file it under).
    var groupThreads: [ChatThread] {
        threads.filter(\.isGroup).sorted { a, b in
            if a.pinned != b.pinned { return a.pinned }
            return a.updatedAt > b.updatedAt
        }
    }

    /// Server sessions for a familiar that no local thread already carries —
    /// i.e. conversations to surface but not yet materialised on this device.
    func serverOnlySessions(for familiarId: String) -> [SessionRow] {
        let bound = Set(threads.flatMap { $0.sessionIds.values }.filter { !$0.isEmpty })
        return serverSessions
            // Generated runs (journal narratives, canvas, crons) are not
            // conversations — parity with the web chat lists (cave-48aa).
            .filter { $0.familiarId == familiarId && $0.archivedAt == nil && !bound.contains($0.id) && !$0.isGeneratedRun }
            .sorted { (caveParseISO($0.updatedAt) ?? .distantPast) > (caveParseISO($1.updatedAt) ?? .distantPast) }
    }

    /// How many conversations a familiar has (local direct + server-only).
    func threadCount(for familiarId: String) -> Int {
        directThreads(for: familiarId).count + serverOnlySessions(for: familiarId).count
    }

    /// Most recent activity across a familiar's local + server conversations.
    func lastActivity(for familiarId: String) -> Date? {
        let local = directThreads(for: familiarId).map(\.updatedAt)
        let server = serverOnlySessions(for: familiarId).compactMap { caveParseISO($0.updatedAt) }
        return (local + server).max()
    }

    /// Materialise a server session as a local thread (binding its `sessionId`
    /// and pulling history) and return it, so it opens like any other thread.
    /// Reuses an existing local thread that already carries the session id.
    func openServerSession(_ row: SessionRow, familiarId: String) -> ChatThread {
        if let existing = threads.first(where: { $0.sessionIds.values.contains(row.id) }) {
            return existing
        }
        let title = row.title.isEmpty ? (familiar(familiarId)?.displayName ?? familiarId) : row.title
        let thread = ChatThread(title: title, familiarIds: [familiarId],
                                sessionIds: [familiarId: row.id],
                                projectRoot: row.projectRoot)
        threads.insert(thread, at: 0)
        persistThreads()
        Task { await loadHistory(into: thread, sessionId: row.id) }
        return thread
    }

    // MARK: - Task ↔ chat linking

    /// The thread linked to a card, if any: prefer the explicit local link,
    /// then fall back to matching the card's server `sessionId` to a thread's
    /// per-familiar session (covers links made on another device / the desktop).
    func linkedThread(for card: BoardCard) -> ChatThread? {
        if let tid = cardThreadLinks[card.id],
           let thread = threads.first(where: { $0.id == tid }) {
            return thread
        }
        if let sid = card.sessionId, !sid.isEmpty {
            return threads.first { $0.sessionIds.values.contains(sid) }
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

    /// True when a card has any linked chat (cheap, for list indicators).
    func hasLinkedChat(_ card: BoardCard) -> Bool {
        if cardThreadLinks[card.id] != nil { return true }
        if let sid = card.sessionId, !sid.isEmpty {
            return threads.contains { $0.sessionIds.values.contains(sid) }
        }
        return false
    }

    /// A thread's primary server session (first familiar's), if assigned.
    private func primarySessionId(of thread: ChatThread) -> String? {
        for familiarId in thread.familiarIds {
            if let sid = thread.sessionIds[familiarId], !sid.isEmpty { return sid }
        }
        return thread.sessionIds.values.first { !$0.isEmpty }
    }

    /// Open (or create) the chat linked to a card and navigate to it. For an
    /// unlinked card it starts a fresh thread with `familiarId` (the card's
    /// assignee, or a caller-supplied pick) and links it. Returns nil only if no
    /// familiar could be resolved.
    @discardableResult
    func openChat(for card: BoardCard, familiarId: String? = nil) -> ChatThread? {
        if let existing = linkedThread(for: card) {
            cardThreadLinks[card.id] = existing.id   // backfill from a sessionId match
            persistCardLinks()
            requestOpen(existing)
            return existing
        }
        guard let familiarId = familiarId ?? card.familiarId else { return nil }
        let title = "Task: \(card.title)"
        let thread: ChatThread
        if let sid = card.sessionId, !sid.isEmpty {
            // The card already points at a server session (e.g. started on the
            // desktop) but no local thread carries it — bind one and pull history.
            thread = ChatThread(title: title, familiarIds: [familiarId],
                                sessionIds: [familiarId: sid],
                                projectRoot: serverSessions.first {
                                    $0.id == sid
                                }?.projectRoot)
            threads.insert(thread, at: 0)
            Task { await loadHistory(into: thread, sessionId: sid) }
        } else {
            thread = ChatThread(title: title, familiarIds: [familiarId])
            threads.insert(thread, at: 0)
        }
        cardThreadLinks[card.id] = thread.id
        persistThreads()
        persistCardLinks()
        requestOpen(thread)
        return thread
    }

    /// Link an existing task to a thread (from the chat side). Best-effort PATCH
    /// of the card's `sessionId` so the desktop board sees the link too.
    func linkTask(_ card: BoardCard, to thread: ChatThread) {
        cardThreadLinks[card.id] = thread.id
        persistCardLinks()
        if let sid = primarySessionId(of: thread), card.sessionId != sid {
            Task { await patchCardSession(cardId: card.id, sessionId: sid) }
        }
    }

    /// Remove a card's chat link (local map + server sessionId).
    func unlinkTask(_ card: BoardCard) {
        cardThreadLinks[card.id] = nil
        persistCardLinks()
        if card.sessionId != nil {
            Task { await patchCardSession(cardId: card.id, sessionId: nil) }
        }
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
        guard let client else { return }
        do {
            let updated = try await client.updateTaskSession(cardId: cardId, sessionId: sessionId)
            if let idx = tasks.firstIndex(where: { $0.id == cardId }) { tasks[idx] = updated }
        } catch {
            // Non-fatal: the local link still drives in-app navigation.
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

    /// Find an existing direct thread for a familiar, or create one.
    func directThread(for familiarId: String) -> ChatThread {
        if let existing = threads.first(where: { !$0.isGroup && $0.familiarIds == [familiarId] }) {
            return existing
        }
        let name = familiar(familiarId)?.displayName ?? familiarId
        let thread = ChatThread(title: name, familiarIds: [familiarId])
        threads.insert(thread, at: 0)
        persistThreads()
        return thread
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
        projectRoot: String?
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
        projectRoot: String? = nil
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

    /// Owns all thread-file I/O (reads, JSON coding, atomic writes) off the
    /// main actor.
    @ObservationIgnored private let threadStore = ThreadSnapshotStore(url: AppModel.threadsFileURL)

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
        let snapshots = (try? await threadStore.load()) ?? []
        // The load has settled: from here on saves can no longer clobber an
        // unread snapshot file, so flushes are safe even if we restored nothing.
        defer { threadsHydrated = true }
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
