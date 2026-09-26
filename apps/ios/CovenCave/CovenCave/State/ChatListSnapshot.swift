import Foundation

/// Disposable list organization, never a source of send authority. It reads no
/// transcript text, so streamed tokens do not re-sort the entire home.
@MainActor
struct ChatListSnapshot {
    struct Entry: Identifiable {
        enum Conversation {
            case local(ChatThread)
            case server(SessionRow)
        }

        let id: String
        let conversation: Conversation
        let updatedAt: Date
        let pinned: Bool
        let archived: Bool
        /// Participants, for the home's familiar filter: a direct or group
        /// thread's members, or a server row's owning familiar.
        let familiarIds: [String]
        let searchText: String
    }

    private struct SessionIdentity: Hashable {
        let familiarId: String
        let sessionId: String
    }

    let entries: [Entry]
    let archivedCount: Int
    /// Every familiar that participates in at least one conversation (active
    /// or archived), so the familiar filter offers only names that select
    /// something. Unaffected by filtering, like `archivedCount`.
    let familiarIds: Set<String>

    private init(entries: [Entry], archivedCount: Int, familiarIds: Set<String>) {
        self.entries = entries
        self.archivedCount = archivedCount
        self.familiarIds = familiarIds
    }

    /// Filtering preserves the already sorted order; a search edit need not
    /// parse dates, reconcile sessions, rebuild search text, or sort again.
    /// `familiarId` keeps only conversations that familiar takes part in.
    func filtered(query: String, includeArchived: Bool, familiarId: String? = nil) -> ChatListSnapshot {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ChatListSnapshot(entries: entries.filter {
            Self.matches($0, search: search, includeArchived: includeArchived, familiarId: familiarId)
        }, archivedCount: archivedCount, familiarIds: familiarIds)
    }

    private static func matches(
        _ entry: Entry, search: String, includeArchived: Bool, familiarId: String?
    ) -> Bool {
        (includeArchived || !entry.archived)
            && (familiarId == nil || entry.familiarIds.contains(familiarId!))
            && (search.isEmpty || entry.searchText.contains(search))
    }

    init(
        threads: [ChatThread],
        sessions: [SessionRow],
        familiars: [Familiar],
        query: String = "",
        includeArchived: Bool = false,
        familiarId: String? = nil
    ) {
        var names: [String: String] = [:]
        for familiar in familiars {
            names[familiar.id] = familiar.displayName
        }
        // Parse each session's activity once: both passes below need it, and a
        // timestamp parse dominated the cost of rebuilding a large list (#5600).
        let sessionActivity = sessions.map { session -> Date in
            session.isGeneratedRun
                ? .distantPast
                : caveParseISO(session.updatedAt) ?? caveParseISO(session.createdAt) ?? .distantPast
        }
        var serverMetadata: [SessionIdentity: (title: String, activity: Date)] = [:]
        for (index, session) in sessions.enumerated() where !session.isGeneratedRun {
            if let familiarId = session.familiarId {
                serverMetadata[SessionIdentity(familiarId: familiarId, sessionId: session.id)] = (
                    session.title,
                    sessionActivity[index]
                )
            }
        }
        var represented = Set<SessionIdentity>()
        var all: [Entry] = []
        all.reserveCapacity(threads.count + sessions.count)
        for thread in threads where !thread.isFlowRun {
            var titles = [thread.title]
            var activity = thread.updatedAt
            for (familiarId, sessionId) in thread.sessionIds
            where thread.familiarIds.contains(familiarId) {
                let identity = SessionIdentity(familiarId: familiarId, sessionId: sessionId)
                represented.insert(identity)
                if let metadata = serverMetadata[identity] {
                    titles.append(metadata.title)
                    activity = max(activity, metadata.activity)
                }
            }
            all.append(Entry(
                id: "local:\(thread.id)",
                conversation: .local(thread),
                updatedAt: activity,
                pinned: thread.pinned,
                archived: thread.archived,
                familiarIds: thread.familiarIds,
                searchText: (titles + thread.familiarIds.compactMap { names[$0] })
                    .joined(separator: " ").lowercased()
            ))
        }
        for (index, session) in sessions.enumerated() where !session.isGeneratedRun {
            if let familiarId = session.familiarId,
               represented.contains(SessionIdentity(familiarId: familiarId, sessionId: session.id)) {
                continue
            }
            all.append(Entry(
                id: "server:\(session.id)",
                conversation: .server(session),
                updatedAt: sessionActivity[index],
                pinned: session.pinned == true,
                archived: session.archivedAt != nil,
                familiarIds: session.familiarId.map { [$0] } ?? [],
                searchText: [session.title, session.familiarId.flatMap { names[$0] } ?? ""]
                    .joined(separator: " ").lowercased()
            ))
        }
        archivedCount = all.lazy.filter(\.archived).count
        familiarIds = Set(all.flatMap(\.familiarIds))
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        entries = all.filter {
            Self.matches($0, search: search, includeArchived: includeArchived, familiarId: familiarId)
        }.sorted {
            if $0.pinned != $1.pinned { return $0.pinned }
            if $0.updatedAt != $1.updatedAt { return $0.updatedAt > $1.updatedAt }
            return $0.id < $1.id
        }
    }
}

/// One disposable projection per Chats view. Read all organizing fields on
/// every call so SwiftUI observes metadata changes, but never read transcripts.
/// Object identity fences replacement threads with the same persisted ID.
@MainActor
final class ChatListSnapshotCache {
    private struct ThreadKey: Equatable {
        let identity: ObjectIdentifier
        let title: String
        let familiarIds: [String]
        let sessionIds: [String: String]
        let updatedAt: Date
        let pinned: Bool
        let archived: Bool
        let isFlowRun: Bool
    }

    private struct FamiliarKey: Equatable {
        let id: String
        let name: String
    }

    private var threadKeys: [ThreadKey] = []
    private var sessionKeys: [SessionRow] = []
    private var familiarKeys: [FamiliarKey] = []
    private var snapshot: ChatListSnapshot?

    func resolve(threads: [ChatThread], sessions: [SessionRow], familiars: [Familiar],
                 query: String, includeArchived: Bool, familiarId: String? = nil) -> ChatListSnapshot {
        let nextThreads = threads.map {
            ThreadKey(identity: ObjectIdentifier($0), title: $0.title,
                      familiarIds: $0.familiarIds, sessionIds: $0.sessionIds,
                      updatedAt: $0.updatedAt, pinned: $0.pinned,
                      archived: $0.archived, isFlowRun: $0.isFlowRun)
        }
        let nextFamiliars = familiars.map { FamiliarKey(id: $0.id, name: $0.displayName) }
        if snapshot == nil || threadKeys != nextThreads || sessionKeys != sessions || familiarKeys != nextFamiliars {
            snapshot = ChatListSnapshot(threads: threads, sessions: sessions,
                                        familiars: familiars, includeArchived: true)
            threadKeys = nextThreads
            sessionKeys = sessions
            familiarKeys = nextFamiliars
        }
        return snapshot!.filtered(query: query, includeArchived: includeArchived, familiarId: familiarId)
    }
}
