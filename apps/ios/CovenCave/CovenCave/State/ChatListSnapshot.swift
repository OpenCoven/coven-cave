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
