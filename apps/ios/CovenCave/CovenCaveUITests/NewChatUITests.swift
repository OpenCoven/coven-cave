import XCTest

final class NewChatUITests: XCTestCase {
    private func launchContextualNewChat(projectArgument: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-empty-chat",
            projectArgument,
            "--ui-open-contextual-new-chat",
        ]
        app.launch()
        XCTAssertTrue(app.navigationBars["New chat"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["Choose familiars"].exists)
        XCTAssertFalse(app.staticTexts["1 selected"].exists)
        return app
    }

    @MainActor
    func testContextualNewChatRetriesProjectFailureWithoutFamiliarReselection() {
        let app = launchContextualNewChat(
            projectArgument: "--ui-preview-new-chat-project-retry"
        )

        let retry = app.buttons["Retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 10), "project failure offers Retry")
        retry.tap()

        XCTAssertTrue(app.buttons["New chat project"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Start"].isEnabled)
    }

    @MainActor
    func testEmptyProjectStateRetriesWithoutFamiliarReselection() {
        let app = launchContextualNewChat(
            projectArgument: "--ui-preview-new-chat-project-empty-retry"
        )

        XCTAssertTrue(
            app.staticTexts["This familiar has no accessible projects."]
                .waitForExistence(timeout: 10)
        )
        let retry = app.buttons["Retry"]
        XCTAssertTrue(retry.exists, "empty project state offers Retry")
        XCTAssertTrue(app.buttons["Project access"].exists)
        retry.tap()

        XCTAssertTrue(app.buttons["New chat project"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Start"].isEnabled)
    }
}
