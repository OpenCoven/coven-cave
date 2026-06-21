import Foundation
import Observation

/// The two bottom tabs. Lifted out of the view so slash commands (`/board`,
/// `/chats`) can drive tab selection from anywhere.
enum AppTab: String { case chats, canvas, read, tasks }

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

    // MARK: - Reading list

    var reading: [ReadingItem] = []
    var readingError: String?
    var readingLoaded = false

    // MARK: - Canvas (generated UI artifacts)

    var canvasArtifacts: [CanvasArtifact] = []
    var canvasError: String?
    var canvasLoaded = false
    /// True while a generate/refine stream is in flight.
    var isGeneratingCanvas = false
    /// The familiar's reply text as it streams in (for the "sketching…" preview).
    var canvasStreamText = ""

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

    private func apply(id: String, _ mutate: (inout ReadingItem) -> Void) {
        guard let idx = reading.firstIndex(where: { $0.id == id }) else { return }
        var item = reading[idx]
        mutate(&item)
        reading[idx] = item
    }

    // MARK: - Canvas actions

    func loadCanvas() async {
        guard let client else { return }
        do {
            canvasArtifacts = sortedArtifacts(try await client.canvasArtifacts())
            canvasError = nil
        } catch {
            canvasError = error.localizedDescription
        }
        canvasLoaded = true
    }

    /// Generate a new artifact from `prompt` via `familiarId`'s chat bridge,
    /// extract the renderable document, persist it, and return it. Cancellation
    /// (the caller cancelling its Task) aborts the stream and returns nil.
    func generateArtifact(prompt: String, familiarId: String) async -> CanvasArtifact? {
        guard let client else { return nil }
        let userPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !userPrompt.isEmpty else { return nil }

        isGeneratingCanvas = true
        canvasStreamText = ""
        canvasError = nil
        defer { isGeneratingCanvas = false }

        do {
            let text = try await streamText(
                CanvasArtifact.buildSketchPrompt(userPrompt),
                familiarId: familiarId, client: client
            )
            guard !Task.isCancelled else { return nil }
            guard let extracted = CanvasArtifact.extractArtifact(text) else {
                canvasError = "The familiar didn’t return a renderable UI. Try rephrasing."
                return nil
            }
            let now = CanvasArtifact.nowISO()
            let artifact = CanvasArtifact(
                id: UUID().uuidString,
                title: CanvasArtifact.titleFromPrompt(userPrompt),
                prompt: userPrompt,
                code: CanvasArtifact.clampCode(extracted.code),
                kind: extracted.kind,
                createdAt: now, updatedAt: now
            )
            canvasArtifacts = sortedArtifacts(try await client.saveCanvasArtifact(artifact))
            return artifact
        } catch is CancellationError {
            return nil
        } catch {
            canvasError = error.localizedDescription
            return nil
        }
    }

    /// Re-generate an existing artifact with a change request, keeping its id.
    func refineArtifact(_ artifact: CanvasArtifact, changeRequest: String,
                        familiarId: String) async -> CanvasArtifact? {
        guard let client else { return nil }
        let ask = changeRequest.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ask.isEmpty else { return nil }

        isGeneratingCanvas = true
        canvasStreamText = ""
        canvasError = nil
        defer { isGeneratingCanvas = false }

        do {
            let text = try await streamText(
                CanvasArtifact.buildRefinePrompt(
                    currentCode: artifact.code, changeRequest: ask, kind: artifact.kind
                ),
                familiarId: familiarId, client: client
            )
            guard !Task.isCancelled else { return nil }
            guard let extracted = CanvasArtifact.extractArtifact(text) else {
                canvasError = "The familiar didn’t return an updated UI. Try rephrasing."
                return nil
            }
            var updated = artifact
            updated.code = CanvasArtifact.clampCode(extracted.code)
            updated.kind = extracted.kind
            updated.updatedAt = CanvasArtifact.nowISO()
            canvasArtifacts = sortedArtifacts(try await client.saveCanvasArtifact(updated))
            return updated
        } catch is CancellationError {
            return nil
        } catch {
            canvasError = error.localizedDescription
            return nil
        }
    }

    /// Remove an artifact, optimistically; restore on failure.
    func deleteArtifact(_ artifact: CanvasArtifact) async {
        guard let client else { return }
        let previous = canvasArtifacts
        canvasArtifacts.removeAll { $0.id == artifact.id }
        do {
            try await client.deleteCanvasArtifact(id: artifact.id)
        } catch {
            canvasArtifacts = previous
            canvasError = error.localizedDescription
        }
    }

    /// Consume the chat SSE stream for `prompt`, accumulating assistant text into
    /// `canvasStreamText`. Throws on a stream `error` event with no text yet.
    private func streamText(_ prompt: String, familiarId: String,
                            client: CaveClient) async throws -> String {
        var text = ""
        let body = CaveClient.SendBody(familiarId: familiarId, prompt: prompt, sessionId: nil)
        for try await event in client.sendStream(body) {
            try Task.checkCancellation()
            switch event {
            case .assistantChunk(let chunk):
                text += chunk
                canvasStreamText = text
            case .error(let message):
                if text.isEmpty { throw CaveError.transport(message) }
            default:
                break
            }
        }
        return text
    }

    /// Newest-updated first; the canvas gallery's stable order.
    private func sortedArtifacts(_ artifacts: [CanvasArtifact]) -> [CanvasArtifact] {
        artifacts.sorted {
            ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast)
        }
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
