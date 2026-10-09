import Foundation

/// Disposable list organization, never a source of send authority. It reads no
/// transcript text, so streamed tokens do not re-sort the entire home.
@MainActor
struct ChatListSnapshot {
    /// The home's optional project filter. It narrows the list to chats bound
    /// to one registered project (or to none); it is list organisation only
    /// and never changes a chat's binding or the app's scope.
    enum ProjectFilter: Hashable {
        case project(id: String)
        /// No root, or a root that no registered project resolves.
        case unassigned
    }

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
        /// The registered project this conversation is bound to, resolved from
        /// its own root (a project's `.worktrees/` checkouts count as that
        /// project). Nil is Unassigned.
        let projectId: String?
        let searchText: String
    }

    private struct SessionIdentity: Hashable {
        let familiarId: String
        let sessionId: String
    }

    let entries: [Entry]
    /// "Thread you just completed…" review runs (`SessionRow.isThreadReflection`),
    /// newest first. They stay out of `entries`, `archivedCount` and the
    /// familiar roster like every other generated run; the home renders them
    /// in their own collapsed Reflections section so they are reachable without
    /// ever sitting between live chats. Active only, and narrowed by the
    /// familiar filter and search like `entries`.
    let reflections: [Entry]
    let archivedCount: Int
    /// Every familiar that participates in at least one conversation (active
    /// or archived), so the familiar filter offers only names that select
    /// something. Unaffected by filtering, like `archivedCount`.
    let familiarIds: Set<String>
    /// Projects with chats matching the current search, familiar and archive
    /// settings. Ignore the project selection so other nonempty choices remain
    /// available when switching projects.
    let projectIds: Set<String>
    /// Whether any chat matching those same settings is Unassigned.
    let hasUnassigned: Bool

    private init(
        entries: [Entry], reflections: [Entry], archivedCount: Int,
        familiarIds: Set<String>, projectIds: Set<String>, hasUnassigned: Bool
    ) {
        self.entries = entries
        self.reflections = reflections
        self.archivedCount = archivedCount
        self.familiarIds = familiarIds
        self.projectIds = projectIds
        self.hasUnassigned = hasUnassigned
    }

    /// Filtering preserves the already sorted order; a search edit need not
    /// parse dates, reconcile sessions, rebuild search text, or sort again.
    /// `familiarId` keeps only conversations that familiar takes part in;
    /// `projectFilter` keeps only conversations bound to that project.
    func filtered(
        query: String, includeArchived: Bool, familiarId: String? = nil,
        projectFilter: ProjectFilter? = nil
    ) -> ChatListSnapshot {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let matching = entries.filter {
            Self.matches($0, search: search, includeArchived: includeArchived,
                         familiarId: familiarId, projectFilter: nil)
        }
        return ChatListSnapshot(entries: matching.filter {
            Self.matches($0, projectFilter: projectFilter)
        }, reflections: reflections.filter {
            Self.matches($0, search: search, includeArchived: false,
                         familiarId: familiarId, projectFilter: projectFilter)
        }, archivedCount: archivedCount, familiarIds: familiarIds,
           projectIds: Set(matching.compactMap(\.projectId)),
           hasUnassigned: matching.contains { $0.projectId == nil })
    }

    private static func matches(
        _ entry: Entry, search: String, includeArchived: Bool, familiarId: String?,
        projectFilter: ProjectFilter?
    ) -> Bool {
        (includeArchived || !entry.archived)
            && (familiarId == nil || entry.familiarIds.contains(familiarId!))
            && matches(entry, projectFilter: projectFilter)
            && (search.isEmpty || entry.searchText.contains(search))
    }

    private static func matches(_ entry: Entry, projectFilter: ProjectFilter?) -> Bool {
        switch projectFilter {
        case nil: return true
        case .project(let id)?: return entry.projectId == id
        case .unassigned?: return entry.projectId == nil
        }
    }

    init(
        threads: [ChatThread],
        sessions: [SessionRow],
        familiars: [Familiar],
        projects: [ProjectInfo] = [],
        reflectionSessions: [SessionRow] = [],
        query: String = "",
        includeArchived: Bool = false,
        familiarId: String? = nil,
        projectFilter: ProjectFilter? = nil
    ) {
        var names: [String: String] = [:]
        for familiar in familiars {
            names[familiar.id] = familiar.displayName
        }
        // Chats share a handful of roots, so resolve each distinct root once
        // rather than once per row.
        var projectIdByRoot: [String: String?] = [:]
        func projectId(for root: String?) -> String? {
            guard let root else { return nil }
            if let resolved = projectIdByRoot[root] { return resolved }
            let resolved = ProjectContext.registeredProject(for: root, in: projects)?.id
            projectIdByRoot[root] = resolved
            return resolved
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
        // Reflection runs may arrive in either list (the home passes them
        // apart, since `chatServerSessions` drops every generated run). Keep
        // archived ones too, but only to recognize their local threads below.
        var reflectionRows: [SessionRow] = []
        var reflectionIds = Set<String>()
        for session in sessions + reflectionSessions
        where session.isThreadReflection && reflectionIds.insert(session.id).inserted {
            reflectionRows.append(session)
        }
        var represented = Set<SessionIdentity>()
        var all: [Entry] = []
        all.reserveCapacity(threads.count + sessions.count)
        for thread in threads where !thread.isFlowRun {
            // Opening a reflection hydrates a local thread bound only to that
            // run; it belongs with its reflection, not among live chats.
            if !reflectionIds.isEmpty, !thread.sessionIds.isEmpty,
               thread.sessionIds.values.allSatisfy(reflectionIds.contains) {
                continue
            }
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
                projectId: projectId(for: thread.projectRoot),
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
                projectId: projectId(for: session.projectRoot),
                searchText: [session.title, session.familiarId.flatMap { names[$0] } ?? ""]
                    .joined(separator: " ").lowercased()
            ))
        }
        archivedCount = all.lazy.filter(\.archived).count
        familiarIds = Set(all.flatMap(\.familiarIds))
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let matching = all.filter {
            Self.matches($0, search: search, includeArchived: includeArchived,
                         familiarId: familiarId, projectFilter: nil)
        }
        projectIds = Set(matching.compactMap(\.projectId))
        hasUnassigned = matching.contains { $0.projectId == nil }
        reflections = reflectionRows.compactMap { session -> Entry? in
            guard session.archivedAt == nil, session.status != "archived" else { return nil }
            let entry = Entry(
                id: "reflection:\(session.id)",
                conversation: .server(session),
                updatedAt: caveParseISO(session.updatedAt) ?? caveParseISO(session.createdAt) ?? .distantPast,
                pinned: false,
                archived: false,
                familiarIds: session.familiarId.map { [$0] } ?? [],
                projectId: projectId(for: session.projectRoot),
                searchText: [session.title, session.familiarId.flatMap { names[$0] } ?? ""]
                    .joined(separator: " ").lowercased()
            )
            return Self.matches(entry, search: search, includeArchived: false,
                                familiarId: familiarId, projectFilter: projectFilter)
                ? entry : nil
        }.sorted {
            if $0.updatedAt != $1.updatedAt { return $0.updatedAt > $1.updatedAt }
            return $0.id < $1.id
        }
        entries = matching.filter {
            Self.matches($0, projectFilter: projectFilter)
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
        let projectRoot: String?
        let updatedAt: Date
        let pinned: Bool
        let archived: Bool
        let isFlowRun: Bool
    }

    private struct FamiliarKey: Equatable {
        let id: String
        let name: String
    }

    /// Only what root resolution reads: a rename or access change alone does
    /// not rebuild the list.
    private struct ProjectKey: Equatable {
        let id: String
        let root: String
    }

    private struct FilterKey: Hashable {
        let query: String
        let includeArchived: Bool
        let familiarId: String?
        let projectFilter: ChatListSnapshot.ProjectFilter?
    }

    private var threadKeys: [ThreadKey] = []
    private var sessionKeys: [SessionRow] = []
    private var reflectionKeys: [SessionRow] = []
    private var familiarKeys: [FamiliarKey] = []
    private var projectKeys: [ProjectKey] = []
    private var snapshot: ChatListSnapshot?
    /// Filtered projections of the current `snapshot` (#5651). Switching the familiar
    /// filter back and forth, or any body pass that did not change the
    /// filter, reuses the projection instead of re-filtering every row.
    /// Dropped whenever the snapshot rebuilds; bounded because each search
    /// keystroke is its own key.
    private var filtered: [FilterKey: ChatListSnapshot] = [:]

    func resolve(threads: [ChatThread], sessions: [SessionRow], familiars: [Familiar],
                 projects: [ProjectInfo] = [],
                 reflections: [SessionRow] = [],
                 query: String, includeArchived: Bool, familiarId: String? = nil,
                 projectFilter: ChatListSnapshot.ProjectFilter? = nil) -> ChatListSnapshot {
        let nextThreads = threads.map {
            ThreadKey(identity: ObjectIdentifier($0), title: $0.title,
                      familiarIds: $0.familiarIds, sessionIds: $0.sessionIds,
                      projectRoot: $0.projectRoot,
                      updatedAt: $0.updatedAt, pinned: $0.pinned,
                      archived: $0.archived, isFlowRun: $0.isFlowRun)
        }
        let nextFamiliars = familiars.map { FamiliarKey(id: $0.id, name: $0.displayName) }
        let nextProjects = projects.map { ProjectKey(id: $0.id, root: $0.root) }
        if snapshot == nil || threadKeys != nextThreads || sessionKeys != sessions
            || reflectionKeys != reflections || familiarKeys != nextFamiliars
            || projectKeys != nextProjects {
            snapshot = ChatListSnapshot(threads: threads, sessions: sessions,
                                        familiars: familiars, projects: projects,
                                        reflectionSessions: reflections,
                                        includeArchived: true)
            threadKeys = nextThreads
            sessionKeys = sessions
            reflectionKeys = reflections
            familiarKeys = nextFamiliars
            projectKeys = nextProjects
            filtered.removeAll(keepingCapacity: true)
        }
        let key = FilterKey(query: query, includeArchived: includeArchived,
                            familiarId: familiarId, projectFilter: projectFilter)
        if let cached = filtered[key] { return cached }
        if filtered.count >= 16 { filtered.removeAll(keepingCapacity: true) }
        let projection = snapshot!.filtered(query: query, includeArchived: includeArchived,
                                            familiarId: familiarId, projectFilter: projectFilter)
        filtered[key] = projection
        return projection
    }
}
