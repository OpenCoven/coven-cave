import Foundation
import Observation

/// The two bottom tabs. Lifted out of the view so slash commands (`/board`,
/// `/chats`) can drive tab selection from anywhere.
enum AppTab: String { case chats, tasks }

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

    var client: CaveClient? {
        guard let connection else { return nil }
        return CaveClient(connection: connection)
    }

    init() {
        connection = CaveConnection.load()
        loadThreads()
        if connection != nil { connectionState = .checking }
    }

    func familiar(_ id: String) -> Familiar? {
        familiars.first { $0.id == id }
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
        guard let client else { connectionState = .unconfigured; return }
        connectionState = .checking
        let reachable = await client.ping()
        guard reachable else {
            connectionState = .unreachable("Couldn’t reach the desktop. Is it on the tailnet and running?")
            return
        }
        connectionState = .connected
        await loadFamiliars()
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
}
