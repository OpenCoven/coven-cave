import XCTest

final class DrawerNavigationUITests: XCTestCase {

    @MainActor
    func testSettingsRoundTripPreservesSelectedConversation() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-preview-second-thread"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()

        let launchThreadTitle = "Chat with Nyx on Jul 26"
        XCTAssertTrue(app.navigationBars[launchThreadTitle].waitForExistence(timeout: 10),
                      "the launch thread opens on the first Chats mount")

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "the conversation exposes navigation")
        openNavigation.tap()
        app.buttons["Profile and settings"].tap()

        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "Settings exposes the navigation drawer")
        openNavigation.tap()
        app.buttons["Chats"].tap()

        XCTAssertTrue(app.navigationBars[launchThreadTitle].waitForExistence(timeout: 10),
                      "Settings does not remount Chats or select a different conversation")
    }

    @MainActor
    func testDrawerRecentThreadOpensAfterChatsIsMounted() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-tab", "settings"]
        app.launch()

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "Settings exposes the navigation drawer")
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
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-preview-chats-home"]
        app.launch()

        XCTAssertFalse(app.tabBars.firstMatch.exists, "the app has no native tab bar")

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "a primary destination exposes the navigation drawer")
        openNavigation.tap()

        for destination in ["Chats", "Search chats"] {
            XCTAssertTrue(app.buttons[destination].waitForExistence(timeout: 5),
                          "drawer includes primary destination \(destination)")
        }
        for retired in ["Tasks", "Projects", "Familiars", "Automations", "Terminal", "Project context button"] {
            XCTAssertFalse(app.buttons[retired].exists,
                           "chat-only navigation must not expose \(retired)")
        }
        XCTAssertFalse(app.staticTexts["Workspace"].exists)
        XCTAssertTrue(app.buttons["Profile and settings"].waitForExistence(timeout: 5),
                      "the profile avatar is the Settings entry point")
        XCTAssertFalse(app.buttons["Settings"].exists,
                       "Settings is not duplicated as a primary drawer row")
        XCTAssertFalse(app.buttons["Terminal"].exists, "the retired iOS terminal stays out of the drawer")

        app.buttons["Profile and settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10),
                      "the profile avatar opens Settings")

        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "Settings exposes the navigation drawer")
        openNavigation.tap()
        app.buttons["Chats"].tap()
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "Chats is mounted after drawer routing")

        XCTAssertFalse(app.tabBars.firstMatch.exists, "routing does not introduce a native tab bar")
    }

    @MainActor
    func testChatsIncludesBothProjectsWithoutAGlobalFilter() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout", "--ui-preview-chats-home"]
        app.launch()

        let nyx = app.descendants(matching: .any)["Chat row local:ui-preview-empty-chat"].firstMatch
        let lyra = app.descendants(matching: .any)["Chat row local:ui-preview-lyra-chat"].firstMatch
        XCTAssertTrue(nyx.waitForExistence(timeout: 10))
        XCTAssertTrue(lyra.waitForExistence(timeout: 10),
                      "a different project's chat is visible without switching global context")
        lyra.tap()
        XCTAssertTrue(app.navigationBars["Lyra design review"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testDrawerSearchSearchesChatsOnly() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-preview-chats-home",
            "--ui-open-drawer",
        ]
        app.launch()

        let search = app.buttons["Search chats"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        let field = app.textFields["Search chats…"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("Lyra")
        XCTAssertTrue(app.descendants(matching: .any)["Chat row local:ui-preview-lyra-chat"].firstMatch
            .waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["Chat row local:ui-preview-empty-chat"].firstMatch.exists)
        XCTAssertFalse(app.buttons["Tasks"].exists)
        XCTAssertFalse(app.buttons["Projects"].exists)
    }

    @MainActor
    func testDrawerSearchRevealsTheListFromAnOpenConversation() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()

        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 10))
        app.buttons["Open navigation"].tap()
        app.buttons["Search chats"].tap()

        let field = app.textFields["Search chats…"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let visible = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "hittable == true"), object: field
        )
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 5), .completed,
                       "search must leave the collapsed conversation detail")
        field.tap()
        field.typeText("Lyra")
        XCTAssertTrue(app.descendants(matching: .any)["Chat row local:ui-preview-lyra-chat"]
            .firstMatch.waitForExistence(timeout: 5))
    }

    @MainActor
    func testRecentChatReopensTheSameConversationAfterDrawerSearch() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()

        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 10))
        app.buttons["Open navigation"].tap()
        app.buttons["Search chats"].tap()
        XCTAssertTrue(app.textFields["Search chats…"].waitForExistence(timeout: 10))

        app.buttons["Open navigation"].tap()
        app.buttons["Chat with Nyx on Jul 26"].tap()
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        let visible = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "hittable == true"), object: composer
        )
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 5), .completed,
                       "an explicit same-chat open must reveal detail without resetting its state")
    }

    @MainActor
    func testSwitchingProjectsKeepsEachConversationsDraftSeparate() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()

        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 10))
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("Draft only for Nyx")

        app.buttons["Open navigation"].tap()
        app.buttons["Lyra design review"].tap()
        XCTAssertTrue(app.navigationBars["Lyra design review"].waitForExistence(timeout: 10))
        XCTAssertFalse((composer.value as? String ?? "").contains("Draft only for Nyx"))
        composer.tap()
        composer.typeText("Draft only for Lyra")

        app.buttons["Open navigation"].tap()
        app.buttons["Chat with Nyx on Jul 26"].tap()
        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 10))
        XCTAssertTrue((composer.value as? String ?? "").contains("Draft only for Nyx"))
        XCTAssertFalse((composer.value as? String ?? "").contains("Draft only for Lyra"),
                       "a different project's composer must never overwrite or inherit this draft")
    }

    @MainActor
    func testMissingProjectCatalogDoesNotHideChatOrSettings() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-project-context-gate"]
        app.launch()

        let navigation = app.buttons["Open navigation"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 10),
                      "access failure must not replace the chat shell with a global project gate")
        navigation.tap()
        app.buttons["Profile and settings"].tap()

        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10),
                      "Settings remains reachable for permission and connection recovery")
        XCTAssertFalse(app.staticTexts["Community"].exists)
    }
}
