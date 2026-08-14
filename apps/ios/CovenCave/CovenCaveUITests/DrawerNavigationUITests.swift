import XCTest

final class DrawerNavigationUITests: XCTestCase {

    @MainActor
    func testLaunchThreadIntentDoesNotReopenAfterChatsRemounts() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-preview-second-thread"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()

        let launchThreadTitle = "Chat with Nyx on Jul 26"
        let newestThreadTitle = "Chat with Nyx on Jul 27"
        XCTAssertTrue(app.navigationBars[launchThreadTitle].waitForExistence(timeout: 10),
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
        app.buttons["Settings"].tap()

        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "Settings exposes the navigation drawer")
        openNavigation.tap()
        app.buttons["Chats"].tap()

        XCTAssertTrue(app.navigationBars[newestThreadTitle].waitForExistence(timeout: 10),
                      "remounted Chats selects the current default conversation")
        XCTAssertFalse(app.navigationBars[launchThreadTitle].exists,
                       "the consumed launch thread does not override the newer default")
    }

    @MainActor
    func testDrawerRecentThreadOpensAfterChatsIsMounted() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-tab", "tasks"]
        app.launch()

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "Tasks exposes the navigation drawer")
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
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-tab", "settings"]
        app.launch()

        XCTAssertFalse(app.tabBars.firstMatch.exists, "the app has no native tab bar")

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "a primary destination exposes the navigation drawer")
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
