import XCTest
@testable import CovenCave

@MainActor
final class LaunchThreadIntentTests: XCTestCase {

    func testLaunchThreadIntentWaitsForHydrationAndConsumesOnlyOnce() {
        let app = AppModel()
        app.launchThreadId = "hydrated-thread"

        XCTAssertNil(app.consumeLaunchThreadIntent())
        XCTAssertEqual(app.launchThreadId, "hydrated-thread")

        let expected = ChatThread(id: "hydrated-thread", title: "Hydrated", familiarIds: [])
        app.threads = [expected]

        XCTAssertTrue(app.consumeLaunchThreadIntent() === expected)
        XCTAssertNil(app.launchThreadId)
        XCTAssertNil(app.consumeLaunchThreadIntent())
    }

    func testColdThreadDeepLinkWaitsForHydration() throws {
        let app = AppModel()
        app.selectedTab = .settings
        let url = try XCTUnwrap(URL(string: "covencave://thread/cold-thread"))

        app.handleDeepLink(url)

        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertEqual(app.launchThreadId, "cold-thread")
        XCTAssertNil(app.consumeLaunchThreadIntent())

        let expected = ChatThread(id: "cold-thread", title: "Cold link", familiarIds: ["nyx"])
        app.threads = [expected]
        XCTAssertTrue(app.consumeLaunchThreadIntent() === expected)
    }

    func testMostRecentThreadUsesUpdateTimeAndSkipsArchivedThreads() {
        let app = AppModel()
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
        let app = AppModel()
        let archived = ChatThread(id: "archived", title: "Archived", familiarIds: [])
        archived.archived = true
        app.threads = [archived]

        XCTAssertNil(app.mostRecentThread)
    }
}
