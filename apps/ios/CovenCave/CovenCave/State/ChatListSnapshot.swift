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
        let searchText: String
    }

    private struct SessionIdentity: Hashable {
        let familiarId: String
        let sessionId: String
    }

    let entries: [Entry]
    let archivedCount: Int

    private init(entries: [Entry], archivedCount: Int) {
        self.entries = entries
        self.archivedCount = archivedCount
    }

    /// Filtering preserves the already sorted order; a search edit need not
    /// parse dates, reconcile sessions, rebuild search text, or sort again.
    func filtered(query: String, includeArchived: Bool) -> ChatListSnapshot {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ChatListSnapshot(entries: entries.filter {
            (includeArchived || !$0.archived) && (search.isEmpty || $0.searchText.contains(search))
        }, archivedCount: archivedCount)
    }

    init(
        threads: [ChatThread],
        sessions: [SessionRow],
        familiars: [Familiar],
        query: String = "",
        includeArchived: Bool = false
    ) {
        var names: [String: String] = [:]
        for familiar in familiars {
            names[familiar.id] = familiar.displayName
        }
        var serverMetadata: [SessionIdentity: (title: String, activity: Date)] = [:]
        for session in sessions where !session.isGeneratedRun {
            if let familiarId = session.familiarId {
                serverMetadata[SessionIdentity(familiarId: familiarId, sessionId: session.id)] = (
                    session.title,
                    caveParseISO(session.updatedAt) ?? caveParseISO(session.createdAt) ?? .distantPast
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
                searchText: (titles + thread.familiarIds.compactMap { names[$0] })
                    .joined(separator: " ").lowercased()
            ))
        }
        for session in sessions where !session.isGeneratedRun {
            if let familiarId = session.familiarId,
               represented.contains(SessionIdentity(familiarId: familiarId, sessionId: session.id)) {
                continue
            }
            all.append(Entry(
                id: "server:\(session.id)",
                conversation: .server(session),
                updatedAt: caveParseISO(session.updatedAt) ?? caveParseISO(session.createdAt) ?? .distantPast,
                pinned: session.pinned == true,
                archived: session.archivedAt != nil,
                searchText: [session.title, session.familiarId.flatMap { names[$0] } ?? ""]
                    .joined(separator: " ").lowercased()
            ))
        }
        archivedCount = all.lazy.filter(\.archived).count
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        entries = all.filter {
            (includeArchived || !$0.archived) && (search.isEmpty || $0.searchText.contains(search))
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
                 query: String, includeArchived: Bool) -> ChatListSnapshot {
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
        return snapshot!.filtered(query: query, includeArchived: includeArchived)
    }
}
