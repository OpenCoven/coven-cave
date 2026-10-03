import Foundation

/// Recent `GET api/chat/model-state` answers, so reopening a chat does not
/// refetch what it read seconds ago (#5748). `ChatView` is rebuilt per thread
/// (`.id(thread.id)`), so its own `@State` cannot carry this across a close
/// and reopen; before this, every reopen of a direct chat repeated the request.
///
/// Only the reopen path reuses from here: a stored answer under `maxAge`, or
/// a request for the same key that is still in flight, which a reopen joins
/// rather than repeats. A finished reply, `/model`, and the reconciliation
/// after a model change always fetch fresh and overwrite the entry. Every
/// model change, in a chat or on a familiar's profile, drops the familiar's
/// entries before its request and again once it settles
/// (`AppModel.invalidateChatModelStates`). So the cache can save a reopen a
/// request but never hide a change made on this device. A change made
/// elsewhere shows up within `maxAge`, the same window
/// `AppModel.loadSessionsIfStale` gives the session list.
///
/// Keyed by host, so one Cave never reads another's state and nothing needs
/// tearing down on disconnect. In-memory only and bounded by `capacity`.
@MainActor
final class ChatModelStateCache {
    struct Key: Hashable {
        let host: String
        let familiarId: String
        let sessionId: String?
    }

    nonisolated static let defaultMaxAge: TimeInterval = 30
    nonisolated static let defaultCapacity = 64

    private struct Entry {
        let response: ChatModelStateResponse
        let storedAt: Date
    }

    private let maxAge: TimeInterval
    private let capacity: Int
    private let now: () -> Date
    private var entries: [Key: Entry] = [:]
    /// Least recently stored first, for eviction past `capacity`.
    private var order: [Key] = []
    /// One request per key at most. The cache owns the task, so a chat that
    /// closes while waiting does not cancel it and a reopen can still join it.
    private var inFlight: [Key: Task<ChatModelStateResponse, Error>] = [:]

    init(
        maxAge: TimeInterval = ChatModelStateCache.defaultMaxAge,
        capacity: Int = ChatModelStateCache.defaultCapacity,
        now: @escaping () -> Date = Date.init
    ) {
        self.maxAge = maxAge
        self.capacity = max(1, capacity)
        self.now = now
    }

    var count: Int { entries.count }

    /// The stored answer if it is younger than `maxAge`. A clock that moved
    /// backwards also counts as expired rather than as forever fresh.
    func recent(for key: Key) -> ChatModelStateResponse? {
        guard let entry = entries[key] else { return nil }
        let age = now().timeIntervalSince(entry.storedAt)
        guard age >= 0, age < maxAge else {
            remove(key)
            return nil
        }
        return entry.response
    }

    /// The model state for `key`. With `reusingRecent`, a stored answer under
    /// `maxAge` comes back as-is and a request already in flight for the key is
    /// joined. Without it, this always fetches, and the newest fetch is the one
    /// whose answer is kept.
    func response(
        for key: Key,
        reusingRecent: Bool,
        fetch: @escaping @MainActor () async throws -> ChatModelStateResponse
    ) async throws -> ChatModelStateResponse {
        if reusingRecent {
            if let recent = recent(for: key) { return recent }
            if let pending = inFlight[key] { return try await pending.value }
        }
        let task = Task { @MainActor in try await fetch() }
        inFlight[key] = task
        do {
            let response = try await task.value
            // An invalidation or a newer fetch replaced this one while it was
            // in flight. Its answer may predate that change, so it is returned
            // to the caller that asked but not kept for the next reopen.
            if inFlight[key] == task {
                inFlight[key] = nil
                store(response, for: key)
            }
            return response
        } catch {
            if inFlight[key] == task { inFlight[key] = nil }
            throw error
        }
    }

    func store(_ response: ChatModelStateResponse, for key: Key) {
        entries[key] = Entry(response: response, storedAt: now())
        order.removeAll { $0 == key }
        order.append(key)
        while order.count > capacity {
            entries[order.removeFirst()] = nil
        }
    }

    /// Drop every session's entry for one familiar on one host. A model change
    /// can set the familiar default, which every session without its own model
    /// inherits, so dropping only the changed chat's entry is not enough.
    /// A request still in flight for those keys is detached rather than
    /// cancelled: whoever is waiting still gets an answer, but nothing joins it
    /// and its answer is not kept.
    func invalidate(host: String, familiarId: String) {
        let matches: (Key) -> Bool = { $0.host == host && $0.familiarId == familiarId }
        for key in entries.keys.filter(matches) { remove(key) }
        for key in inFlight.keys.filter(matches) { inFlight[key] = nil }
    }

    private func remove(_ key: Key) {
        entries[key] = nil
        order.removeAll { $0 == key }
    }
}
