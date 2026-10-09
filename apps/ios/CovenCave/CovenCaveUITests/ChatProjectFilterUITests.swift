import XCTest

/// The Chats home offers a one-tap project filter. It organizes the list only:
/// every conversation keeps its own project binding, and "All projects"
/// restores the global list.
final class ChatProjectFilterUITests: XCTestCase {
    @MainActor
    func testProjectChipsNarrowChatsAndAllRestoresThem() {
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

        let all = chip(app, "All")
        XCTAssertTrue(all.waitForExistence(timeout: 5))
        XCTAssertTrue(all.isSelected, "the list starts unfiltered")

        let design = chip(app, "Design Library")
        design.tap()
        XCTAssertTrue(design.isSelected)
        XCTAssertTrue(desktop.waitForNonExistence(timeout: 5))
        XCTAssertTrue(lyra.exists)
        XCTAssertFalse(orphan.exists)

        let coven = chip(app, "Coven Cave")
        coven.tap()
        XCTAssertTrue(desktop.waitForExistence(timeout: 5),
                      "a desktop-only conversation is filed under its own project")
        XCTAssertTrue(lyra.waitForNonExistence(timeout: 5))

        let unassigned = chip(app, "Unassigned")
        if !unassigned.isHittable { app.scrollViews["Project filter"].firstMatch.swipeLeft() }
        unassigned.tap()
        XCTAssertTrue(orphan.waitForExistence(timeout: 5))
        XCTAssertTrue(ghost.exists, "a root no registered project resolves is Unassigned")
        XCTAssertFalse(desktop.exists)

        if !all.isHittable { app.scrollViews["Project filter"].firstMatch.swipeRight() }
        all.tap()
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
        XCTAssertTrue(desktop.exists)
        XCTAssertTrue(orphan.exists)
    }

    @MainActor
    func testArchivingLastChatRemovesSelectedProjectChip() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout", "--ui-preview-chats-home"]
        app.launch()

        let design = chip(app, "Design Library")
        XCTAssertTrue(design.waitForExistence(timeout: 10))
        design.tap()
        let lyra = row(app, "local:ui-preview-lyra-chat")
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
        lyra.press(forDuration: 1)
        app.buttons["Archive"].firstMatch.tap()
        XCTAssertTrue(lyra.waitForNonExistence(timeout: 5))
        XCTAssertTrue(design.waitForNonExistence(timeout: 5),
                      "a selected project must not remain a filter choice after its last visible chat is archived")

        let all = chip(app, "All")
        all.tap()
        XCTAssertTrue(row(app, "server:ui-preview-server-only").waitForExistence(timeout: 5))
        XCTAssertFalse(design.exists)
        app.buttons["Chat list options"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Show archived")).firstMatch.tap()
        XCTAssertTrue(design.waitForExistence(timeout: 5))
        design.tap()
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
    }

    @MainActor
    func testProjectFilterOpensAChatInItsOwnProject() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout", "--ui-preview-chats-home"]
        app.launch()

        let design = chip(app, "Design Library")
        XCTAssertTrue(design.waitForExistence(timeout: 10))
        design.tap()
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
        XCTAssertFalse(chip(app, "All").exists, "screen-wide chips give way to one menu")
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

    @MainActor
    private func chip(_ app: XCUIApplication, _ name: String) -> XCUIElement {
        app.buttons["Project filter \(name)"].firstMatch
    }
}
