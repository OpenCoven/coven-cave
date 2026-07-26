import XCTest

final class DrawerNavigationUITests: XCTestCase {

    @MainActor
    func testLaunchThreadIntentDoesNotReopenAfterChatsRemounts() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()

        let threadTitle = "Chat with Nyx on Jul 26"
        XCTAssertTrue(app.navigationBars[threadTitle].waitForExistence(timeout: 10),
                      "the launch thread opens on the first Chats mount")

        let back = app.navigationBars.buttons["BackButton"].firstMatch
        if back.waitForExistence(timeout: 3) {
            back.tap()
        } else {
            app.swipeRight()
        }

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "leaving the launch thread returns to Chats home")
        openNavigation.tap()
        app.buttons["Terminal"].tap()

        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "Terminal exposes the navigation drawer")
        openNavigation.tap()
        app.buttons["Chats"].tap()

        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "remounted Chats stays at its home destination")
        XCTAssertFalse(app.navigationBars[threadTitle].exists,
                       "the consumed launch thread is not reopened after remounting Chats")
    }

    @MainActor
    func testDrawerRecentThreadOpensAfterChatsIsMounted() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-tab", "terminal"]
        app.launch()

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "Terminal exposes the navigation drawer")
        openNavigation.tap()

        let recentThread = app.buttons["Chat with Nyx on Jul 26"]
        XCTAssertTrue(recentThread.waitForExistence(timeout: 5),
                      "the fixture thread is available from drawer recents")
        recentThread.tap()

        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 10),
                      "a pending thread handoff opens after Chats mounts")
    }

    @MainActor
    func testDrawerRoutesBetweenPrimaryDestinationsWithoutATabBar() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat"]
        app.launch()

        XCTAssertFalse(app.tabBars.firstMatch.exists, "the app has no native tab bar")

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "Chats home exposes the navigation drawer")
        openNavigation.tap()

        for destination in ["Chats", "Projects", "Familiars", "Tasks", "Terminal", "Settings"] {
            XCTAssertTrue(app.buttons[destination].waitForExistence(timeout: 5),
                          "drawer includes \(destination)")
        }

        app.buttons["Tasks"].tap()
        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: 10),
                      "Tasks is mounted after drawer routing")
        XCTAssertFalse(app.tabBars.firstMatch.exists, "routing does not introduce a native tab bar")
    }
}
