import Foundation
import Observation

/// The bottom tabs. Lifted out of the view so slash commands (`/board`,
/// `/chats`) can drive tab selection from anywhere.
enum AppTab: String { case chats, read, tasks, dev, settings }

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
    }

    var connection: CaveConnection?
    var connectionState: ConnectionState = .unconfigured

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

    /// The active confirmation toast, auto-dismissed by the overlay.
    var toast: ToastMessage?

    /// Show a confirmation toast (replaces any in-flight one).
    func showToast(_ text: String, systemImage: String = "checkmark.circle.fill",
                   style: ToastMessage.Style = .success) {
        toast = ToastMessage(text: text, systemImage: systemImage, style: style)
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

    // MARK: - Reading list

    var reading: [ReadingItem] = []
    var readingError: String?
    var readingLoaded = false

    var reminders: [Reminder] = []
    var remindersError: String?
    var remindersLoaded = false

    // MARK: - Developer tab

    /// Configured project roots, shared across the Code and Terminal surfaces.
    var projects: [ProjectInfo] = []
    var projectsError: String?
    var projectsLoaded = false

    // MARK: - Appearance (desktop theme)

    /// App-chrome palette mirrored from the desktop's published theme
    /// (`GET /api/theme`). Starts at the built-in look and is replaced once the
    /// desktop theme loads. One-way (desktop → iOS), per the design.
    var chrome: ChromePalette = .fallback

    /// Fetch the desktop theme and adopt its palette. Best-effort: on any
    /// failure the current palette stands, so there's no flash back to the
    /// fallback when a poll briefly can't reach the desktop.
    func loadTheme() async {
        guard let client else { return }
        if let snapshot = try? await client.fetchTheme() {
            let next = ChromePalette(snapshot: snapshot)
            if next != chrome { chrome = next }
        }
    }

    var client: CaveClient? {
        guard let connection else { return nil }
        return CaveClient(connection: connection)
    }

    init() {
        connection = CaveConnection.load()
        loadThreads()
        loadCardLinks()
        loadFamiliarOrder()
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
            tasksError = error.localizedDescription
        }
        tasksLoaded = true
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
        } catch {
            tasks = previous
            tasksError = error.localizedDescription
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
        } catch {
            tasks = previous
            tasksError = error.localizedDescription
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
        } catch {
            tasks = previous
            tasksError = error.localizedDescription
        }
    }

    /// Optimistically remove a task, then DELETE it. Reinserts on failure.
    func deleteTask(_ card: BoardCard) async {
        guard let client else { return }
        let previous = tasks
        tasks.removeAll { $0.id == card.id }
        do {
            try await client.deleteTask(cardId: card.id)
        } catch {
            tasks = previous
            tasksError = error.localizedDescription
        }
    }

    private func applyTask(id: String, _ mutate: (inout BoardCard) -> Void) {
        guard let idx = tasks.firstIndex(where: { $0.id == id }) else { return }
        var card = tasks[idx]
        mutate(&card)
        tasks[idx] = card
    }

    // MARK: - Reading list actions

    func loadReading() async {
        guard let client else { return }
        do {
            reading = try await client.reading()
            readingError = nil
        } catch {
            readingError = error.localizedDescription
        }
        readingLoaded = true
    }

    // MARK: - Developer tab actions

    func loadProjects() async {
        guard let client else { return }
        do {
            projects = try await client.projects()
            projectsError = nil
        } catch {
            projectsError = error.localizedDescription
        }
        projectsLoaded = true
    }

    /// Optimistically set an item's status, then reconcile with the server's
    /// echoed item (it also stamps `finishedAt` on transition to done).
    func setReadingStatus(_ item: ReadingItem, _ status: ReadingStatus) async {
        guard let client else { return }
        let previous = reading
        apply(id: item.id) { $0.statusRaw = status.rawValue }
        do {
            if let updated = try await client.updateReading(id: item.id, status: status) {
                apply(id: item.id) { $0 = updated }
            }
        } catch {
            reading = previous
            readingError = error.localizedDescription
        }
    }

    /// Remove an item, optimistically; restore on failure.
    func deleteReading(_ item: ReadingItem) async {
        guard let client else { return }
        let previous = reading
        reading.removeAll { $0.id == item.id }
        do {
            try await client.deleteReading(id: item.id)
        } catch {
            reading = previous
            readingError = error.localizedDescription
        }
    }

    // MARK: - Reminders

    func loadReminders() async {
        guard let client else { return }
        do {
            reminders = try await client.reminders()
            remindersError = nil
        } catch {
            remindersError = error.localizedDescription
        }
        remindersLoaded = true
    }

    /// Optimistically remove reminders, then DELETE each; reverts on failure.
    func deleteReminders(_ ids: Set<String>) async {
        guard let client, !ids.isEmpty else { return }
        let previous = reminders
        reminders.removeAll { ids.contains($0.id) }
        do {
            for id in ids { try await client.deleteReminder(id: id) }
        } catch {
            reminders = previous
            remindersError = error.localizedDescription
        }
    }

    /// Set how far through an item the reader is (0–100), keeping its status.
    /// Optimistic, with rollback on failure.
    func setReadingProgress(_ item: ReadingItem, _ progress: Int) async {
        guard let client else { return }
        let clamped = max(0, min(100, progress))
        let previous = reading
        apply(id: item.id) { $0.progress = Double(clamped) }
        do {
            if let updated = try await client.updateReading(
                id: item.id, status: item.status, progress: Double(clamped)) {
                apply(id: item.id) { $0 = updated }
            }
        } catch {
            reading = previous
            readingError = error.localizedDescription
        }
    }

    private func apply(id: String, _ mutate: (inout ReadingItem) -> Void) {
        guard let idx = reading.firstIndex(where: { $0.id == id }) else { return }
        var item = reading[idx]
        mutate(&item)
        reading[idx] = item
    }

    // MARK: - Connection lifecycle

    func configure(host: String) async {
        let conn = CaveConnection(host: host)
        connection = conn
        conn.save()
        await refreshConnection()
    }

    func disconnect() {
        CaveConnection.clear()
        connection = nil
        familiars = []
        connectionState = .unconfigured
    }

    func refreshConnection() async {
        guard let connection else { connectionState = .unconfigured; return }
        connectionState = .checking

        // Try the configured endpoint first, then auto-relocate to a working
        // port (e.g. the user typed a `.ts.net` host without `:8443`).
        let configured = connection.baseURL
        guard let working = await Self.discoverBaseURL(connection.candidateBaseURLs) else {
            connectionState = .unreachable("Couldn’t reach the desktop. Is it on the tailnet and running?")
            return
        }

        if working != configured {
            // Relocate: persist the working URL so future launches connect directly.
            let relocated = CaveConnection(host: working.absoluteString)
            self.connection = relocated
            relocated.save()
            if let port = working.port {
                showToast("Connected on port \(port)", systemImage: "antenna.radiowaves.left.and.right")
            }
        }
        connectionState = .connected
        await loadFamiliars()
        await loadTheme()
    }

    /// Probe candidate base URLs in order; return the first that answers. Uses a
    /// short per-candidate timeout so trying a few ports stays snappy.
    static func discoverBaseURL(_ candidates: [URL]) async -> URL? {
        for base in candidates where await probe(base) { return base }
        return nil
    }

    /// Reachability check that requires a *real* Cave API response — a 2xx whose
    /// body decodes as the familiars payload. A bare status check would accept
    /// the wrong endpoint: another `tailscale serve` target (e.g. `:443`) can
    /// answer `/api/familiars` with a 404 or some other app's 200, and the old
    /// `200..<500` test latched onto it. Decoding the payload guarantees we only
    /// adopt an actual Cave server.
    private static func probe(_ base: URL) async -> Bool {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 6
        config.waitsForConnectivity = false
        var req = URLRequest(url: base.appendingPathComponent("api/familiars"))
        req.timeoutInterval = 6
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (data, resp) = try? await URLSession(configuration: config).data(for: req),
              let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              (try? JSONDecoder().decode(FamiliarsResponse.self, from: data)) != nil
        else { return false }
        return true
    }

    func loadFamiliars() async {
        guard let client else { return }
        do {
            familiars = applyFamiliarOrder(try await client.familiars())
            familiarsError = nil
        } catch {
            familiarsError = error.localizedDescription
        }
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
            sessionsError = error.localizedDescription
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
    }

    /// Delete several threads at once (bulk select); persists once.
    func deleteThreads(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        threads.removeAll { ids.contains($0.id) }
        persistThreads()
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
}
