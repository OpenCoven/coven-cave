import XCTest
@testable import CovenCave

@MainActor
final class LaunchThreadIntentTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        suiteName = "LaunchThreadIntentTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private func makeApp() -> AppModel {
        AppModel(defaults: defaults, restoreLocalState: false)
    }

    private func project(_ id: String, _ name: String) -> ProjectInfo {
        ProjectInfo(
            id: id,
            name: name,
            root: "/repos/\(id)",
            color: nil,
            updatedAt: nil,
            access: nil
        )
    }

    func testPendingThreadNavigationWaitsForHydrationAndConsumesOnlyOnce() {
        let app = makeApp()
        let expectedIntent = ProjectNavigationIntent(
            entity: .thread(id: "hydrated-thread"),
            destination: .chats
        )
        app.pendingProjectNavigationIntent = expectedIntent

        XCTAssertFalse(app.resolvePendingProjectNavigationIntent())
        XCTAssertEqual(app.pendingProjectNavigationIntent, expectedIntent)

        let expected = ChatThread(id: "hydrated-thread", title: "Hydrated", familiarIds: [])
        app.threads = [expected]

        XCTAssertTrue(app.resolvePendingProjectNavigationIntent())
        XCTAssertTrue(app.threadToOpen === expected)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertFalse(app.resolvePendingProjectNavigationIntent())
    }

    func testColdThreadDeepLinkWaitsForHydration() throws {
        let app = makeApp()
        app.selectedTab = .settings
        let url = try XCTUnwrap(URL(string: "covencave://thread/cold-thread"))

        app.handleDeepLink(url)

        XCTAssertEqual(app.selectedTab, .settings)
        XCTAssertEqual(
            app.pendingProjectNavigationIntent,
            ProjectNavigationIntent(entity: .thread(id: "cold-thread"), destination: .chats)
        )
        XCTAssertNil(app.threadToOpen)

        let expected = ChatThread(id: "cold-thread", title: "Cold link", familiarIds: ["nyx"])
        app.threads = [expected]

        XCTAssertTrue(app.resolvePendingProjectNavigationIntent())
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertTrue(app.threadToOpen === expected)
        XCTAssertNil(app.pendingProjectNavigationIntent)
    }

    func testWarmTaskDeepLinkOpensImmediatelyWhenTaskAndProjectAreHydrated() throws {
        let app = makeApp()
        app.selectedTab = .settings
        let alpha = project("alpha", "Alpha")
        let target = BoardCard(
            id: "warm-task",
            title: "Warm task",
            notes: nil,
            statusRaw: "backlog",
            priorityRaw: "medium",
            familiarId: "nyx",
            projectId: alpha.id,
            sessionId: nil,
            labels: nil,
            startDate: nil,
            endDate: nil,
            createdAt: nil,
            updatedAt: nil,
            needsHuman: nil,
            steps: nil,
            github: nil
        )
        let url = try XCTUnwrap(URL(string: "covencave://task/warm-task"))

        app.tasks = [target]
        app.tasksLoaded = true
        app.projects = [alpha]
        app.projectsLoaded = true

        app.handleDeepLink(url)

        XCTAssertEqual(app.deepLink, .tasks)
        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.projectContext, .project(alpha))
        XCTAssertEqual(app.cardToOpen?.id, target.id)
        XCTAssertNil(app.pendingProjectNavigationIntent)
    }

    func testMostRecentThreadUsesUpdateTimeAndSkipsArchivedThreads() {
        let app = makeApp()
        let olderPinned = ChatThread(id: "older-pinned", title: "Older pinned", familiarIds: [])
        olderPinned.updatedAt = Date(timeIntervalSince1970: 100)
        olderPinned.pinned = true

        let newest = ChatThread(id: "newest", title: "Newest", familiarIds: [])
        newest.updatedAt = Date(timeIntervalSince1970: 200)

        let archived = ChatThread(id: "archived", title: "Archived", familiarIds: [])
        archived.updatedAt = Date(timeIntervalSince1970: 300)
        archived.archived = true

        app.threads = [olderPinned, archived, newest]

        XCTAssertTrue(app.mostRecentThread === newest)
    }

    func testMostRecentThreadIsNilWithoutAnActiveConversation() {
        let app = makeApp()
        let archived = ChatThread(id: "archived", title: "Archived", familiarIds: [])
        archived.archived = true
        app.threads = [archived]

        XCTAssertNil(app.mostRecentThread)
    }
}
