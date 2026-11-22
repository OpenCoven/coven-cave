import XCTest

/// The Chats home offers a project filter menu. It organizes the list only:
/// every conversation keeps its own project binding, and "All projects"
/// restores the global list.
final class ChatProjectFilterUITests: XCTestCase {
    @MainActor
    private func chooseProject(_ name: String, in app: XCUIApplication) {
        let menu = app.buttons["Project filter menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        let filters = app.scrollViews["Chat filters"].firstMatch
        for _ in 0..<4 where menu.frame.minX < filters.frame.minX { filters.swipeRight() }
        menu.tap()
        let option = app.buttons[name].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 5))
        option.tap()
    }

    @MainActor
    func testProjectMenuNarrowsChatsAndAllRestoresThem() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout", "--ui-preview-chats-home"]
        app.launch()

        let lyra = row(app, "local:ui-preview-lyra-chat")
        let desktop = row(app, "server:ui-preview-server-only")
        let orphan = row(app, "local:ui-preview-orphaned-chat")
        let ghost = row(app, "server:ui-preview-unassigned-session")
        XCTAssertTrue(lyra.waitForExistence(timeout: 10))
        XCTAssertTrue(desktop.exists)
        XCTAssertTrue(orphan.exists)

        let menu = app.buttons["Project filter menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        XCTAssertEqual(menu.value as? String, "All projects")

        chooseProject("Design Library", in: app)
        XCTAssertEqual(menu.value as? String, "Design Library")
        XCTAssertTrue(desktop.waitForNonExistence(timeout: 5))
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
        XCTAssertFalse(orphan.exists)

        chooseProject("Coven Cave", in: app)
        XCTAssertTrue(desktop.waitForExistence(timeout: 5))
        XCTAssertTrue(lyra.waitForNonExistence(timeout: 5))

        chooseProject("Unassigned", in: app)
        XCTAssertTrue(orphan.waitForExistence(timeout: 5))
        XCTAssertTrue(ghost.exists)
        XCTAssertFalse(desktop.exists)

        chooseProject("All projects", in: app)
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
        XCTAssertTrue(desktop.exists)
        XCTAssertTrue(orphan.exists)
    }

    @MainActor
    func testArchivingLastChatRemovesProjectChoice() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout", "--ui-preview-chats-home"]
        app.launch()

        chooseProject("Design Library", in: app)
        let lyra = row(app, "local:ui-preview-lyra-chat")
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
        lyra.press(forDuration: 1)
        app.buttons["Archive"].firstMatch.tap()
        XCTAssertTrue(lyra.waitForNonExistence(timeout: 5))
        chooseProject("All projects", in: app)
        let menu = app.buttons["Project filter menu"].firstMatch
        menu.tap()
        XCTAssertFalse(app.buttons["Design Library"].exists,
                       "a project with no visible chats leaves the choices")
        app.buttons["All projects"].firstMatch.tap()
        XCTAssertTrue(row(app, "server:ui-preview-server-only").waitForExistence(timeout: 5))
        let archive = app.buttons["Archive filter menu"].firstMatch
        let filters = app.scrollViews["Chat filters"].firstMatch
        for _ in 0..<4 where archive.frame.maxX > filters.frame.maxX { filters.swipeLeft() }
        archive.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Show archived")).firstMatch.tap()
        chooseProject("Design Library", in: app)
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
    }

    @MainActor
    func testProjectFilterOpensAChatInItsOwnProject() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout", "--ui-preview-chats-home"]
        app.launch()

        chooseProject("Design Library", in: app)
        let lyra = row(app, "local:ui-preview-lyra-chat")
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
        lyra.tap()
        XCTAssertTrue(app.navigationBars["Lyra design review"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testAccessibilityTextSizesUseOneProjectMenu() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout", "--ui-preview-chats-home",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()

        let menu = app.buttons["Project filter menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Project filter All"].exists, "choices remain in a compact menu")
        XCTAssertEqual(menu.value as? String, "All projects")

        let lyra = row(app, "local:ui-preview-lyra-chat")
        let desktop = row(app, "server:ui-preview-server-only")
        XCTAssertTrue(desktop.waitForExistence(timeout: 5))

        menu.tap()
        let design = app.buttons["Design Library"].firstMatch
        XCTAssertTrue(design.waitForExistence(timeout: 5), "the menu lists every project at once")
        XCTAssertTrue(app.buttons["Unassigned"].firstMatch.exists)
        design.tap()
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
        XCTAssertTrue(desktop.waitForNonExistence(timeout: 5))
        XCTAssertEqual(menu.value as? String, "Design Library", "the control names the current choice")

        menu.tap()
        let all = app.buttons["All projects"].firstMatch
        XCTAssertTrue(all.waitForExistence(timeout: 5))
        all.tap()
        XCTAssertTrue(desktop.waitForExistence(timeout: 5))
        XCTAssertEqual(menu.value as? String, "All projects")
    }

    @MainActor
    private func row(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)["Chat row \(id)"].firstMatch
    }

}
