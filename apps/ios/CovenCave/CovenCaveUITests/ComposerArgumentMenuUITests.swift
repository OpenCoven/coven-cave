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

    // MARK: Skills and prompts (#5876)

    @MainActor
    func testSkillPickerListsAndFiltersSkills() {
        let app = launchEmptyChat()
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("/skill ")
        let review = app.buttons["code-review, Review a change for bugs"].firstMatch
        XCTAssertTrue(review.waitForExistence(timeout: 5), "the skill picker lists skills")
        XCTAssertTrue(app.buttons["release-notes, Draft release notes"].exists)
        composer.typeText("rele")
        XCTAssertTrue(review.waitForNonExistence(timeout: 3), "typing filters the skills")
        XCTAssertTrue(app.buttons["release-notes, Draft release notes"].exists)
    }

    @MainActor
    func testPickingAPromptInsertsItsTextWithoutSending() {
        let app = launchEmptyChat()
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("/prompt ")
        let standup = app.buttons["Standup update, Yesterday, today, blockers"].firstMatch
        XCTAssertTrue(standup.waitForExistence(timeout: 5), "the prompt picker lists templates")
        XCTAssertTrue(app.staticTexts["Tap to insert · type to filter"].exists, "the footer says it inserts")
        standup.tap()
        let inserted = NSPredicate(format: "value BEGINSWITH %@", "Yesterday:")
        expectation(for: inserted, evaluatedWith: composer)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].exists, "inserting never leaves the chat")
    }

    // MARK: Hardware keyboard (#5879)

    @MainActor
    func testArrowKeysMoveTheHighlightAndTabPicksIt() {
        let app = launchEmptyChat()
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("/skill ")
        let review = app.buttons["code-review, Review a change for bugs"].firstMatch
        let notes = app.buttons["release-notes, Draft release notes"].firstMatch
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        XCTAssertTrue(review.isSelected, "the first row starts highlighted")

        composer.typeKey(.downArrow, modifierFlags: [])
        XCTAssertTrue(notes.waitForSelected(timeout: 3), "↓ moves the highlight")
        XCTAssertFalse(review.isSelected)

        // release-notes declares an argument hint, so picking it fills the
        // composer for editing rather than sending. Tab, not Return: the
        // simulator's test driver doesn't deliver Return or Escape to the
        // field's key handler, so those two share this path untested here.
        composer.typeKey(.tab, modifierFlags: [])
        let filled = NSPredicate(format: "value == %@", "/skill release-notes ")
        expectation(for: filled, evaluatedWith: composer)
        waitForExpectations(timeout: 5)
    }
}

private extension XCUIElement {
    func waitForSelected(timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if isSelected { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return isSelected
    }
}
