import XCTest

/// The composer's argument picker (#5846), driven the way a thumb types.
///
/// Before, the `/` menu disappeared the moment a space followed the command,
/// so `/familiar ` had no second-level list. Unit tests cover the detection
/// and filtering rules; only a real keyboard proves the menu swaps in as the
/// draft changes and filters as the argument grows.
final class ComposerArgumentMenuUITests: XCTestCase {

    private func launchEmptyChat() -> XCUIApplication {
        let app = XCUIApplication()
        // Same launch as SessionSwitchUITests, with the saved draft cleared.
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-preview-second-thread",
                               "-cave.chat.draft.ui-preview-empty-chat", ""]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()
        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 15),
                      "the preview chat opens")
        return app
    }

    private func nyxRow(_ app: XCUIApplication) -> XCUIElement {
        app.buttons["Nyx, Code familiar"].firstMatch
    }

    @MainActor
    func testFamiliarArgumentPickerOpensAfterTheSpaceAndFilters() {
        let app = launchEmptyChat()
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()

        // A bare command is still a command lookup.
        composer.typeText("/familiar")
        XCTAssertFalse(nyxRow(app).waitForExistence(timeout: 2), "no argument picker before the space")

        // The space opens the familiar picker instead of hiding every suggestion.
        composer.typeText(" ")
        XCTAssertTrue(nyxRow(app).waitForExistence(timeout: 5), "the familiar picker lists the roster")
        XCTAssertTrue(app.staticTexts["/familiar"].exists, "the picker names its command")

        // Typing filters by name.
        composer.typeText("ny")
        XCTAssertTrue(nyxRow(app).waitForExistence(timeout: 3), "a matching name stays")
        composer.typeText("zz")
        XCTAssertTrue(nyxRow(app).waitForNonExistence(timeout: 3), "a non-matching argument empties the picker")
    }
}
