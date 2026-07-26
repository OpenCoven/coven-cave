import XCTest

final class DrawerNavigationUITests: XCTestCase {

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
