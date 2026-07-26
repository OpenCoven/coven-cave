import XCTest

final class DrawerNavigationUITests: XCTestCase {

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
