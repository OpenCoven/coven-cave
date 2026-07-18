import XCTest
@testable import CovenCave

@MainActor
final class CaveSearchTests: XCTestCase {
    func testIndexCoversFamiliarsChatsTasksAndReminders() {
        let familiar = Familiar(id: "nova", displayName: "Nova", role: "Researcher",
                                description: "Finds evidence", pronouns: nil, color: nil,
                                status: "online", harness: "codex", model: nil,
                                icon: nil, avatarUrl: nil)
        let thread = ChatThread(id: "local-1", title: "Launch notes", familiarIds: ["nova"])
        let session = SessionRow(id: "server-1", title: "Runtime audit", harness: "codex", model: nil,
                                 status: "running", familiarId: "nova", createdAt: nil, updatedAt: nil,
                                 archivedAt: nil, origin: nil, generated: false)
        let task = BoardCard(id: "task-1", title: "Ship search", notes: "Cross-platform",
                             statusRaw: "running", priorityRaw: "high", familiarId: "nova",
                             projectId: nil, sessionId: nil, labels: ["ux"], startDate: nil,
                             endDate: nil, createdAt: nil, updatedAt: nil, needsHuman: nil, steps: nil)
        let reminder = Reminder(id: "rem-1", kind: "reminder", title: "Review PR", body: "Search work",
                                status: "pending", fireAt: nil, firedAt: nil, createdAt: nil, updatedAt: nil)

        let items = CaveSearchIndex.build(familiars: [familiar], threads: [thread],
                                          sessions: [session], tasks: [task], reminders: [reminder])
        XCTAssertEqual(Set(items.map(\.scope)), Set([.chats, .tasks, .reminders]))
        XCTAssertTrue(items.contains { $0.destination == .familiar("nova") })
        XCTAssertTrue(items.contains { $0.destination == .localThread("local-1") })
        XCTAssertTrue(items.contains { $0.destination == .serverSession("server-1", familiarId: "nova") })
        XCTAssertTrue(items.contains { $0.destination == .task("task-1") })
        XCTAssertTrue(items.contains { $0.destination == .reminders })
    }

    func testSearchMatchesEveryTermAndHonorsScope() {
        let items = [
            CaveSearchItem(id: "task:1", scope: .tasks, title: "Ship global search",
                           subtitle: "High priority", keywords: "ux nova", destination: .task("1")),
            CaveSearchItem(id: "chat:1", scope: .chats, title: "Search notes",
                           subtitle: "Nova", keywords: "research", destination: .localThread("1")),
        ]

        XCTAssertEqual(CaveSearchIndex.search(items, query: "global nova", scope: .all).map(\.id), ["task:1"])
        XCTAssertEqual(CaveSearchIndex.search(items, query: "search", scope: .chats).map(\.id), ["chat:1"])
        XCTAssertEqual(CaveSearchIndex.search(items, query: "missing", scope: .all), [])
    }
}
