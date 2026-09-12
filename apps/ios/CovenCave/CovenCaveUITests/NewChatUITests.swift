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
        XCTAssertTrue(app.buttons["Start chat"].isEnabled)
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
        XCTAssertFalse(app.buttons["Start chat"].isEnabled)
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
        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10))
        openNavigation.tap()
        let projectContext = app.descendants(matching: .any)["Project context button"].firstMatch
        XCTAssertTrue(
            projectContext.waitForExistence(timeout: 10) && projectContext.isHittable
        )
    }

    @MainActor
    func testEmptyChatUsesCanonicalCopyAndPersistentComposerLabel() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()

        XCTAssertTrue(app.staticTexts["Start a chat"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["Start a new session"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["Message"].firstMatch.exists)
        XCTAssertTrue(app.buttons["Session controls"].exists,
                      "execution controls retain their precise session terminology")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Native chat copy"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
