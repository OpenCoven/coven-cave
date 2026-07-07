import Foundation
import Network
import Observation
import WidgetKit

/// The bottom tabs. Lifted out of the view so slash commands (`/board`,
/// `/chats`) can drive tab selection from anywhere.
enum AppTab: String { case chats, tasks, calendar, dev, settings }

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
        case unreachable(String)
        /// The desktop answered but rejected our credential (401/403) — the
        /// device needs pairing, not a different address. Distinct from
        /// `unreachable` so onboarding can say what to actually do.
        case needsAuth(String)
    }

    var connection: CaveConnection?
    var connectionState: ConnectionState = .unconfigured
    private let connectionMonitor = NWPathMonitor()
    private let connectionMonitorQueue = DispatchQueue(label: "ai.opencoven.cave.connection-monitor")
    private var connectionMonitorStarted = false

    var familiars: [Familiar] = []
    var familiarsError: String?
    /// User's preferred familiar order (ids), applied over the server's order
    /// and persisted locally. Unknown/new familiars fall to the end.
    var familiarOrder: [String] = []

    var threads: [ChatThread] = []

    // MARK: - Cross-view command routing

    /// The selected bottom tab. Bound by `MainTabView`; set by `/board` / `/chats`.
    var selectedTab: AppTab = .chats

    /// A thread a command asked to open. `ChatsHomeView` observes this, pushes
    /// the thread, and clears it back to nil (one-shot navigation intent).
    var threadToOpen: ChatThread?

    /// A task the user asked to open from a chat. `TasksView` observes this,
    /// pushes the card, and clears it (mirrors `threadToOpen`).
    var cardToOpen: BoardCard?

    /// The Diary (Pencil-handwriting experiment) is presented from `RootView`,
    /// ABOVE the connectionState switch — a transient flap to `.checking`
    /// swaps `MainTabView` out and would destroy any cover presented from
    /// within it, dismissing the diary mid-reply and aborting its stream.
    var diaryPresented = false

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

    /// Ask the chat list to open a thread (switches to Chats first).
    func requestOpen(_ thread: ChatThread) {
        selectedTab = .chats
        threadToOpen = thread
    }

    /// Ask the Tasks tab to open a card's detail (switches to Tasks first).
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

    var journalDays: [JournalDay] = []
    var journalError: String?
    var journalLoaded = false

    // MARK: - Developer tab

    /// Configured project roots, shared across the Code and Terminal surfaces.
    var projects: [ProjectInfo] = []
    var projectsError: String?
    var projectsLoaded = false

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

    /// familiarId → when its chats were last viewed. A familiar reads as
    /// "unread" when its latest activity is newer than this. Persisted.
    var familiarViews: [String: Date] = [:]

    init() {
        connection = CaveConnection.load()
        loadThreads()
        loadCardLinks()
        loadFamiliarOrder()
        loadFamiliarViews()
        if connection != nil { connectionState = .checking }
    }

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
    func setTaskStatus(_ card: BoardCard, _ status: CardStatus) async {
        guard let client, status != card.status else { return }
        let previous = tasks
        applyTask(id: card.id) { $0.statusRaw = status.rawValue }
        do {
            let updated = try await client.updateTask(cardId: card.id, status: status)
            applyTask(id: card.id) { $0 = updated }
            Haptics.tap()
            await LiveActivityManager.shared.reconcile(tasks)
            publishWidgetSnapshot()
        } catch {
            tasks = previous
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
            tasks = previous
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
            tasks = previous
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
            tasks = previous
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
            tasks = previous
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
            tasks = previous
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
            tasks = previous
            tasksError = error.localizedDescription
            reportRevert("reschedule the task")
        }
    }

    /// Optimistically remove a task, then DELETE it. Reinserts on failure.
    func deleteTask(_ card: BoardCard) async {
        guard let client else { return }
        let previous = tasks
        tasks.removeAll { $0.id == card.id }
        do {
            try await client.deleteTask(cardId: card.id)
            Haptics.success()
        } catch {
            tasks = previous
            tasksError = error.localizedDescription
            reportRevert("delete the task")
        }
    }

    private func applyTask(id: String, _ mutate: (inout BoardCard) -> Void) {
        guard let idx = tasks.firstIndex(where: { $0.id == id }) else { return }
        var card = tasks[idx]
        mutate(&card)
        tasks[idx] = card
    }

    // MARK: - Developer tab actions

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

    /// Publish a compact snapshot to the shared App Group so the home-screen
    /// "Up Next" widget renders the next reminder + task counts without its own
    /// network access. Cheap; called whenever reminders/tasks load or change.
    func publishWidgetSnapshot() {
        let now = Date()
        let next = reminders
            .filter { $0.status == "pending" || $0.status == "fired" }
            .compactMap { r -> (Reminder, Date)? in caveParseISO(r.whenISO).map { (r, $0) } }
            .filter { $0.1 >= now }
            .min { $0.1 < $1.1 }
        let cal = Calendar.current
        let endOfToday = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now)) ?? now
        let due = tasks.filter { $0.status != .done }.filter { card in
            guard let d = caveParseISO(card.endDate) else { return false }
            return d < endOfToday
        }.count
        let running = tasks.filter { $0.status == .running }.count
        WidgetSnapshotStore.write(WidgetSnapshot(
            nextReminderId: next?.0.id,
            nextReminderTitle: next?.0.title,
            nextReminderDate: next?.1,
            dueTaskCount: due,
            runningTaskCount: running,
            apiBaseURL: connection?.baseURL?.absoluteString,
            updatedAt: now
        ))
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Deep links (home-screen widget)

    /// Surface a widget tap targets. The widget body deep-links to `.reminders`
    /// (tap the reminder) / `.tasks` (tap the counts) via the `covencave://` URL
    /// scheme; `TasksView` opens the reminders sheet when it sees `.reminders`.
    enum DeepLink: String { case tasks, reminders, calendar }

    var deepLink: DeepLink?

    func handleDeepLink(_ url: URL) {
        guard url.scheme == "covencave" else { return }
        // covencave://connect?host=…&token=… — the desktop's pairing invite.
        // Tapping it (or scanning its QR) configures host + credential in one
        // step, replacing any previous pairing.
        if url.host == "connect" {
            guard let invite = CaveInvite.parse(url.absoluteString) else { return }
            Task { await configure(host: invite.host, token: invite.token) }
            return
        }
        guard let target = DeepLink(rawValue: url.host ?? "") else { return }
        switch target {
        case .tasks, .reminders: selectedTab = .tasks
        case .calendar: selectedTab = .calendar
        }
        deepLink = target
    }

    func loadJournal() async {
        guard let client else { return }
        do {
            journalDays = try await client.journalDays()
            journalError = nil
        } catch {
            journalError = handleSurfaceError(error)
        }
        journalLoaded = true
    }

    /// Optimistically remove reminders, then DELETE each; reverts on failure.
    func deleteReminders(_ ids: Set<String>) async {
        guard let client, !ids.isEmpty else { return }
        let previous = reminders
        reminders.removeAll { ids.contains($0.id) }
        do {
            for id in ids { try await client.deleteReminder(id: id) }
            Haptics.success()
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
        await bulkReminderAction(ids, optimistic: "done") { try await $0.markReminderDone(id: $1) }
    }
    func dismissReminders(_ ids: Set<String>) async {
        await bulkReminderAction(ids, optimistic: "dismissed") { try await $0.dismissReminder(id: $1) }
    }
    func snoozeReminders(_ ids: Set<String>, minutes: Int) async {
        await bulkReminderAction(ids, optimistic: "snoozed") { try await $0.snoozeReminder(id: $1, minutes: minutes) }
    }

    /// Apply an action to every selected reminder: optimistic status for all,
    /// then run each server call reconciling its echoed item; revert all on any
    /// failure.
    private func bulkReminderAction(_ ids: Set<String>, optimistic: String,
                                    _ call: @escaping (CaveClient, String) async throws -> Reminder?) async {
        guard let client, !ids.isEmpty else { return }
        let previous = reminders
        for id in ids { applyReminder(id: id) { $0.status = optimistic } }
        do {
            for id in ids {
                if let updated = try await call(client, id) { applyReminder(id: id) { $0 = updated } }
            }
            Haptics.success()
        } catch {
            reminders = previous
            remindersError = error.localizedDescription
            reportRevert("update the reminders")
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
            // credential to a newly configured host from a tokenless invite.
            CaveConnection.saveAccessToken(nil)
        }
        if !isSameEndpoint {
            resetHostScopedStateForNewConnection()
        }

        connection = conn
        conn.save()
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
        journalDays = []
        journalError = nil
        journalLoaded = false
        chrome = .fallback
        publishedThemeId = nil
        publishedMode = nil
    }

    func disconnect() {
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

    func recoverConnectionInBackground() async {
        guard connection != nil else { connectionState = .unconfigured; return }
        await refreshConnection(reloadLoadedSurfaces: true)
    }

    private var shouldReloadLoadedSurfaces: Bool {
        !familiars.isEmpty || sessionsLoaded || tasksLoaded || remindersLoaded || projectsLoaded || journalLoaded
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
        guard connection != nil, connectionState == .connected else { return }
        if let client, await client.ping() {
            // Profile first (the just-succeeded ping proves the current token is
            // valid), then the rolling token renewal + queue flush stay adjacent
            // — the offline-compose flush invariant pins that pair.
            await loadOperatorProfile()
            await refreshAccessTokenIfNeeded()
            flushQueuedMessages()
            return
        }
        guard connectionState == .connected else { return }
        await connectWithRetry()
    }

    private func refreshLoadedSurfaces() async {
        await loadFamiliars()
        if sessionsLoaded { await loadSessions() }
        if tasksLoaded { await loadTasks() }
        if remindersLoaded { await loadReminders() }
        if projectsLoaded { await loadProjects() }
        if journalLoaded { await loadJournal() }
        await loadTheme()
        await loadOperatorProfile()
    }

    /// `quiet` probes without first flipping the state to `.checking`, so a
    /// background retry (e.g. the unreachable screen's auto-retry ticker)
    /// doesn't bounce the UI through intermediate states — the state only
    /// changes when the probe has an outcome.
    func refreshConnection(reloadLoadedSurfaces: Bool = false, quiet: Bool = false) async {
        guard let connection else { connectionState = .unconfigured; return }
        if !quiet { connectionState = .checking }

        // Try the configured endpoint first, then auto-relocate to a working
        // port (e.g. the user typed a `.ts.net` host without `:8443`).
        let configured = connection.baseURL
        switch await Self.discoverBaseURL(connection.candidateBaseURLs) {
        case .found(let working):
            if working != configured {
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
            if reloadLoadedSurfaces {
                await refreshLoadedSurfaces()
            } else {
                await loadFamiliars()
                await loadTheme()
                await loadOperatorProfile()
            }
        case .unauthorized:
            connectionState = .needsAuth(pairingMessage())
        case .none:
            connectionState = .unreachable("Couldn’t reach the desktop. Is it on the tailnet and running?")
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
        case none
    }

    /// Probe every candidate base URL concurrently, then adjudicate strictly
    /// in candidate order so the semantics match a sequential walk: the first
    /// `.ok` in order wins, and a 401/403 earlier in the order is TERMINAL —
    /// it's a live Cave token gate talking, and the fix is pairing. Adopting
    /// a later candidate past it could silently connect to a different
    /// instance on a sibling port (e.g. a dev server on :3000) — the user
    /// thinks they're talking to the desktop they paired with, but they
    /// aren't. Concurrency only changes the wall clock: one probe's timeout
    /// (~6s) instead of the sum across candidates (30s+ on a cold launch).
    static func discoverBaseURL(_ candidates: [URL]) async -> DiscoveryOutcome {
        guard !candidates.isEmpty else { return .none }
        let results = await withTaskGroup(of: (Int, ProbeResult).self) { group in
            for (index, base) in candidates.enumerated() {
                group.addTask { (index, await Self.probe(base)) }
            }
            var collected = [ProbeResult?](repeating: nil, count: candidates.count)
            for await (index, result) in group { collected[index] = result }
            return collected
        }
        for (index, result) in results.enumerated() {
            switch result {
            case .ok: return .found(candidates[index])
            case .unauthorized: return .unauthorized
            default: continue
            }
        }
        return .none
    }

    /// Persist a relocated endpoint as `host:port` when the default scheme
    /// derivation reproduces it (see the relocation comment in
    /// `refreshConnection`); otherwise fall back to the explicit URL.
    static func canonicalHost(for url: URL) -> String {
        guard let host = url.host else { return url.absoluteString }
        let compact = url.port.map { "\(host):\($0)" } ?? host
        return CaveConnection(host: compact).baseURL == url ? compact : url.absoluteString
    }

    private enum ProbeResult { case ok, unauthorized, failed }

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
    private static func probe(_ base: URL) async -> ProbeResult {
        var req = URLRequest(url: base.appendingPathComponent("api/familiars"))
        req.timeoutInterval = 6
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = CaveConnection.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        guard let (data, resp) = try? await probeSession.data(for: req),
              let http = resp as? HTTPURLResponse
        else { return .failed }
        if http.statusCode == 401 || http.statusCode == 403 { return .unauthorized }
        guard (200..<300).contains(http.statusCode),
              (try? JSONDecoder().decode(FamiliarsResponse.self, from: data)) != nil
        else { return .failed }
        return .ok
    }

    func loadFamiliars() async {
        guard let client else { return }
        do {
            familiars = applyFamiliarOrder(try await client.familiars())
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

    /// Mark a familiar's chats as read (call when opening them).
    func markFamiliarViewed(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        let now = Date()
        for id in ids { familiarViews[id] = now }
        persistFamiliarViews()
    }

    /// Baseline any not-yet-tracked familiar as seen "now" so existing history
    /// isn't all flagged unread; only later activity counts.
    private func seedFamiliarViews(_ ids: [String]) {
        let now = Date()
        var changed = false
        for id in ids where familiarViews[id] == nil { familiarViews[id] = now; changed = true }
        if changed { persistFamiliarViews() }
    }

    /// Drag-reorder familiars in the Chats tab; persists the new order.
    func moveFamiliar(fromOffsets source: IndexSet, toOffset destination: Int) {
        familiars.move(fromOffsets: source, toOffset: destination)
        familiarOrder = familiars.map(\.id)
        persistFamiliarOrder()
    }

    /// Sort a freshly-loaded familiar list by the saved order; ids not in the
    /// saved order (new familiars) keep their server order at the end.
    private func applyFamiliarOrder(_ loaded: [Familiar]) -> [Familiar] {
        guard !familiarOrder.isEmpty else { return loaded }
        let rank = Dictionary(uniqueKeysWithValues: familiarOrder.enumerated().map { ($1, $0) })
        return loaded.enumerated().sorted { a, b in
            let ra = rank[a.element.id], rb = rank[b.element.id]
            switch (ra, rb) {
            case let (.some(x), .some(y)): return x < y
            case (.some, .none): return true
            case (.none, .some): return false
            case (.none, .none): return a.offset < b.offset   // stable
            }
        }.map(\.element)
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
            .filter { $0.familiarId == familiarId && $0.archivedAt == nil && !bound.contains($0.id) }
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
                                sessionIds: [familiarId: row.id])
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
                                sessionIds: [familiarId: sid])
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
        let assignee = thread.familiarIds.first
        thread.messages = convo.turns.map { turn in
            let role = DisplayMessage.Role(rawValue: turn.role) ?? .assistant
            return DisplayMessage(role: role,
                                  familiarId: role == .assistant ? assignee : nil,
                                  text: turn.text,
                                  isError: turn.isError ?? false)
        }
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

    func createGroup(familiarIds: [String], title: String?) -> ChatThread {
        let names = familiarIds.compactMap { familiar($0)?.displayName ?? $0 }
        let derived = title?.isEmpty == false ? title! : names.joined(separator: ", ")
        let thread = ChatThread(title: derived, familiarIds: familiarIds)
        threads.insert(thread, at: 0)
        persistThreads()
        return thread
    }

    /// Always create a brand-new thread (no reuse) — backs `/new`. Works for a
    /// single familiar (direct) or several (group).
    func startFreshThread(familiarIds: [String], title: String? = nil) -> ChatThread {
        let names = familiarIds.compactMap { familiar($0)?.displayName ?? $0 }
        let derived = (title?.isEmpty == false) ? title! : names.joined(separator: ", ")
        let thread = ChatThread(title: derived, familiarIds: familiarIds)
        threads.insert(thread, at: 0)
        persistThreads()
        return thread
    }

    func deleteThread(_ thread: ChatThread) {
        threads.removeAll { $0.id == thread.id }
        persistThreads()
        Haptics.success()
        showToast("Chat deleted", systemImage: "trash.fill")
    }

    /// Delete several threads at once (bulk select); persists once.
    func deleteThreads(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        let n = ids.count
        threads.removeAll { ids.contains($0.id) }
        persistThreads()
        Haptics.success()
        showToast("\(n) chat\(n == 1 ? "" : "s") deleted", systemImage: "trash.fill")
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
    }

    /// Pin or unpin a thread; pinned threads sort to the top of their list.
    func setThreadPinned(_ thread: ChatThread, _ pinned: Bool) {
        guard let target = threads.first(where: { $0.id == thread.id }),
              target.pinned != pinned else { return }
        target.pinned = pinned
        persistThreads()
    }

    /// Mute or unmute a thread's notifications (persisted; honoured by the
    /// notification path when it lands).
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
    func importMarkdown(_ text: String, fallbackTitle: String = "Imported chat") -> ChatThread {
        let parsed = parseThreadMarkdown(text)
        func resolve(_ name: String) -> String? {
            familiars.first { $0.displayName.caseInsensitiveCompare(name) == .orderedSame }?.id
        }
        var familiarIds: [String] = []
        var messages: [DisplayMessage] = []
        for turn in parsed.turns {
            switch turn.who.lowercased() {
            case "you":
                messages.append(DisplayMessage(role: .user, familiarId: nil, text: turn.text))
            case "system":
                messages.append(DisplayMessage(role: .system, familiarId: nil, text: turn.text))
            default:
                let fid = resolve(turn.who)
                if let fid, !familiarIds.contains(fid) { familiarIds.append(fid) }
                messages.append(DisplayMessage(role: .assistant, familiarId: fid, text: turn.text))
            }
        }
        for name in parsed.participants {
            if let fid = resolve(name), !familiarIds.contains(fid) { familiarIds.append(fid) }
        }
        let title = parsed.title.isEmpty ? fallbackTitle : parsed.title
        let thread = ChatThread(title: title, familiarIds: familiarIds, messages: messages)
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
            DisplayMessage(role: message.role, familiarId: message.familiarId,
                           text: message.text, isError: message.isError,
                           attachmentDataUrls: message.attachmentDataUrls)
        }
        let copy = ChatThread(title: "\(thread.title) (copy)",
                              familiarIds: thread.familiarIds,
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

    private var threadsFileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("cave-threads.json")
    }

    func persistThreads() {
        let snapshots = threads.map(\.snapshot)
        do {
            let data = try JSONEncoder().encode(snapshots)
            try data.write(to: threadsFileURL, options: .atomic)
        } catch {
            // Non-fatal: persistence is best-effort.
        }
    }

    private func loadThreads() {
        guard let data = try? Data(contentsOf: threadsFileURL),
              let snapshots = try? JSONDecoder().decode([ThreadSnapshot].self, from: data) else {
            return
        }
        threads = snapshots
            .sorted { $0.updatedAt > $1.updatedAt }
            .map { ChatThread(snapshot: $0) }
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

    private var familiarOrderFileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("cave-familiar-order.json")
    }

    private func persistFamiliarOrder() {
        do {
            let data = try JSONEncoder().encode(familiarOrder)
            try data.write(to: familiarOrderFileURL, options: .atomic)
        } catch {
            // Non-fatal: best-effort persistence.
        }
    }

    private func loadFamiliarOrder() {
        guard let data = try? Data(contentsOf: familiarOrderFileURL),
              let order = try? JSONDecoder().decode([String].self, from: data) else {
            return
        }
        familiarOrder = order
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
