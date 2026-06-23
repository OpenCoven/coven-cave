import Foundation
import Observation

/// The bottom tabs. Lifted out of the view so slash commands (`/board`,
/// `/chats`) can drive tab selection from anywhere.
enum AppTab: String { case chats, read, tasks, dev }

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

    // MARK: - Developer tab

    /// Configured project roots, shared across the Code and Terminal surfaces.
    var projects: [ProjectInfo] = []
    var projectsError: String?
    var projectsLoaded = false

    var client: CaveClient? {
        guard let connection else { return nil }
        return CaveClient(connection: connection)
    }

    init() {
        connection = CaveConnection.load()
        loadThreads()
        loadCardLinks()
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
            familiars = try await client.familiars()
            familiarsError = nil
        } catch {
            familiarsError = error.localizedDescription
        }
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
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    /// Every group thread, newest first — shown as its own rows on the Chats
    /// home (a group has no single familiar to file it under).
    var groupThreads: [ChatThread] {
        threads.filter(\.isGroup).sorted { $0.updatedAt > $1.updatedAt }
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
}
