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

        for destination in ["Chats", "Familiars", "Tasks", "Settings"] {
            XCTAssertTrue(app.buttons[destination].waitForExistence(timeout: 5),
                          "drawer includes \(destination)")
        }
        XCTAssertFalse(app.buttons["Terminal"].exists, "the retired iOS terminal stays out of the drawer")
        XCTAssertFalse(app.buttons["Projects"].exists,
                       "Projects is no longer a peer work destination")

        let projectContext = app.buttons["Project context button"]
        XCTAssertTrue(projectContext.waitForExistence(timeout: 5),
                      "drawer exposes the active project switcher")
        projectContext.tap()

        XCTAssertTrue(app.navigationBars["Switch project"].waitForExistence(timeout: 10),
                      "the drawer project control opens the switcher")
        app.buttons["Done"].tap()

        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "closing the switcher returns to the current destination")
        openNavigation.tap()

        app.buttons["Tasks"].tap()
        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: 10),
                      "Tasks is mounted after drawer routing")
        XCTAssertFalse(app.tabBars.firstMatch.exists, "routing does not introduce a native tab bar")
    }

    @MainActor
    func testSwitchingProjectsClearsStaleChatDetail() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout"]
        app.launch()

        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 10),
                      "the current project's default chat opens first")

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10))
        openNavigation.tap()

        let projectContext = app.buttons["Project context button"]
        XCTAssertTrue(projectContext.waitForExistence(timeout: 5),
                      "drawer exposes the shared project switcher")
        projectContext.tap()

        let designLibrary = app.descendants(matching: .any)["Project row project:design-library"].firstMatch
        XCTAssertTrue(designLibrary.waitForExistence(timeout: 10),
                      "the alternate project is listed in the switcher")
        designLibrary.tap()

        XCTAssertTrue(app.navigationBars["Lyra design review"].waitForExistence(timeout: 10),
                      "changing projects reseeds Chats with the new project's detail")
        XCTAssertFalse(app.navigationBars["Chat with Nyx on Jul 26"].exists,
                       "the previous project's detail cannot survive the context switch")
    }

    @MainActor
    func testProjectContextGateOffersSettingsEscapeBeforeShellMounts() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-project-context-gate"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Couldn’t load project access"].waitForExistence(timeout: 10),
                      "the cold project-context gate is visible")
        XCTAssertFalse(app.buttons["Open navigation"].exists,
                       "the cold gate does not mount the primary shell")

        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5),
                      "the gate exposes a settings escape hatch")
        settings.tap()

        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10),
                      "the escape hatch opens settings recovery")

        let close = app.buttons["Close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5),
                      "modal settings expose a close control")
        close.tap()

        XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 10),
                      "dismissing settings returns to the gate retry state")
    }
}
