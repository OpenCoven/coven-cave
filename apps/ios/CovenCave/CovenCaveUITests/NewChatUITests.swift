import XCTest

final class NewChatUITests: XCTestCase {
    private func launchContextualNewChat(extraArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-empty-chat",
            "--ui-open-contextual-new-chat",
        ] + extraArguments
        app.launch()
        XCTAssertTrue(app.navigationBars["New chat"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["Choose familiars"].exists)
        XCTAssertFalse(app.staticTexts["1 selected"].exists)
        return app
    }

    @MainActor
    func testContextualNewChatUsesActiveProjectWithoutIndependentPicker() {
        let app = launchContextualNewChat()

        XCTAssertTrue(app.staticTexts["Coven Cave"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["New chat project"].exists)
        XCTAssertTrue(app.buttons["Start"].isEnabled)
    }

    @MainActor
    func testContextualNewChatBlocksStartWhenFixedFamiliarLeavesActiveProject() {
        let app = launchContextualNewChat(
            extraArguments: ["--ui-preview-new-chat-access-revoked"]
        )

        XCTAssertTrue(
            app.staticTexts["This familiar is no longer in Coven Cave."]
                .waitForExistence(timeout: 10)
        )
        XCTAssertFalse(app.buttons["Start"].isEnabled)
        XCTAssertFalse(app.buttons["New chat project"].exists)
    }

    @MainActor
    func testContextualNewChatShowsRecoveryOnlyGuidanceForUnassigned() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-empty-chat",
            "--ui-preview-new-chat-unassigned",
            "--ui-open-contextual-new-chat",
        ]
        app.launch()

        XCTAssertFalse(
            app.navigationBars["New chat"].waitForExistence(timeout: 3),
            "Unassigned recovery mode must not open the New Chat sheet"
        )
        XCTAssertTrue(
            app.buttons["Project context button"].waitForExistence(timeout: 10)
        )
    }
}
