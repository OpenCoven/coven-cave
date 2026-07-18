import Foundation

enum CaveSearchScope: String, CaseIterable, Identifiable, Hashable {
    case all, chats, tasks, reminders

    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: return "All"
        case .chats: return "Chats"
        case .tasks: return "Tasks"
        case .reminders: return "Reminders"
        }
    }
    var systemImage: String {
        switch self {
        case .all: return "magnifyingglass"
        case .chats: return "bubble.left.and.bubble.right"
        case .tasks: return "checklist"
        case .reminders: return "bell"
        }
    }
}

enum CaveSearchDestination: Hashable {
    case familiar(String)
    case localThread(String)
    case serverSession(String, familiarId: String)
    case task(String)
    case reminders
}

struct CaveSearchItem: Identifiable, Hashable {
    let id: String
    let scope: CaveSearchScope
    let title: String
    let subtitle: String
    let keywords: String
    let destination: CaveSearchDestination
    var systemImage: String {
        switch destination {
        case .familiar: return "person.crop.circle"
        case .localThread, .serverSession: return "bubble.left"
        case .task: return "checkmark.circle"
        case .reminders: return "bell"
        }
    }
}

enum CaveSearchIndex {
    @MainActor
    static func build(
        familiars: [Familiar],
        threads: [ChatThread],
        sessions: [SessionRow],
        tasks: [BoardCard],
        reminders: [Reminder]
    ) -> [CaveSearchItem] {
        let familiarNames = Dictionary(uniqueKeysWithValues: familiars.map { ($0.id, $0.displayName) })
        let familiarItems = familiars.map { familiar in
            CaveSearchItem(
                id: "familiar:\(familiar.id)",
                scope: .chats,
                title: familiar.displayName,
                subtitle: familiar.role ?? "Familiar",
                keywords: [familiar.id, familiar.role, familiar.description, familiar.harness]
                    .compactMap { $0 }.joined(separator: " "),
                destination: .familiar(familiar.id)
            )
        }

        let visibleThreads = threads.filter { !$0.archived }.sorted { $0.updatedAt > $1.updatedAt }
        let threadItems = visibleThreads.map { thread in
            let names = thread.familiarIds.compactMap { familiarNames[$0] }.joined(separator: ", ")
            let messageTerms = thread.messages.suffix(20).map(\.text).joined(separator: " ")
            return CaveSearchItem(
                id: "thread:\(thread.id)",
                scope: .chats,
                title: thread.title,
                subtitle: names.isEmpty ? "Chat" : names,
                keywords: "\(names) \(messageTerms)",
                destination: .localThread(thread.id)
            )
        }

        let boundSessionIds = Set(threads.flatMap { $0.sessionIds.values })
        let sessionItems = sessions
            .filter { $0.archivedAt == nil && !$0.isGeneratedRun && !boundSessionIds.contains($0.id) }
            .compactMap { session -> CaveSearchItem? in
                guard let familiarId = session.familiarId else { return nil }
                let familiar = familiarNames[familiarId] ?? familiarId
                return CaveSearchItem(
                    id: "session:\(session.id)",
                    scope: .chats,
                    title: session.title.isEmpty ? "Untitled chat" : session.title,
                    subtitle: "\(familiar) · \(session.status ?? "chat")",
                    keywords: [familiarId, familiar, session.harness, session.model, session.status]
                        .compactMap { $0 }.joined(separator: " "),
                    destination: .serverSession(session.id, familiarId: familiarId)
                )
            }

        let taskItems = tasks.filter { $0.status != .done }.map { task in
            CaveSearchItem(
                id: "task:\(task.id)",
                scope: .tasks,
                title: task.title,
                subtitle: "\(task.status.label) · \(task.priority.label)",
                keywords: [task.notes, task.familiarId, task.projectId, task.labelList.joined(separator: " ")]
                    .compactMap { $0 }.joined(separator: " "),
                destination: .task(task.id)
            )
        }

        let reminderItems = reminders
            .filter { $0.status == "pending" || $0.status == "fired" || $0.status == "snoozed" }
            .map { reminder in
                CaveSearchItem(
                    id: "reminder:\(reminder.id)",
                    scope: .reminders,
                    title: reminder.title,
                    subtitle: reminder.status.capitalized,
                    keywords: reminder.body ?? "",
                    destination: .reminders
                )
            }

        return familiarItems + threadItems + sessionItems + taskItems + reminderItems
    }

    static func search(
        _ items: [CaveSearchItem],
        query: String,
        scope: CaveSearchScope
    ) -> [CaveSearchItem] {
        let scoped = scope == .all ? items : items.filter { $0.scope == scope }
        let terms = query
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
        guard !terms.isEmpty else { return Array(scoped.prefix(24)) }

        return scoped
            .filter { item in
                let haystack = "\(item.title) \(item.subtitle) \(item.keywords)".lowercased()
                return terms.allSatisfy(haystack.contains)
            }
            .sorted { lhs, rhs in
                let q = terms.joined(separator: " ")
                let leftTitle = lhs.title.lowercased()
                let rightTitle = rhs.title.lowercased()
                let leftRank = leftTitle.hasPrefix(q) ? 0 : leftTitle.contains(q) ? 1 : 2
                let rightRank = rightTitle.hasPrefix(q) ? 0 : rightTitle.contains(q) ? 1 : 2
                if leftRank != rightRank { return leftRank < rightRank }
                return leftTitle.localizedStandardCompare(rightTitle) == .orderedAscending
            }
    }
}
