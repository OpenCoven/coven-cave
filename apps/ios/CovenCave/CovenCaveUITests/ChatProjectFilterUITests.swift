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
    private func row(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)["Chat row \(id)"].firstMatch
    }

    @MainActor
    private func chip(_ app: XCUIApplication, _ name: String) -> XCUIElement {
        app.buttons["Project filter \(name)"].firstMatch
    }
}
