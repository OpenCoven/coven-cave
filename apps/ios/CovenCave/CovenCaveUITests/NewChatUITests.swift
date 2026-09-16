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
    func testContextualNewChatRequiresLocalProjectSelection() {
        let app = launchContextualNewChat()

        let picker = app.buttons["New chat project"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Start chat"].isEnabled)
        picker.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Coven Cave")).firstMatch.tap()
        XCTAssertTrue(app.buttons["Start chat"].isEnabled)
    }

    @MainActor
    func testContextualNewChatBlocksCommitWhenAccessIsRevoked() {
        let app = launchContextualNewChat(
            extraArguments: ["--ui-preview-new-chat-access-revoked"]
        )

        let picker = app.buttons["New chat project"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        picker.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Coven Cave")).firstMatch.tap()
        app.buttons["Start chat"].tap()
        XCTAssertTrue(app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "Project access was revoked")
        ).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.navigationBars["New chat"].exists)
    }

    @MainActor
    func testNewChatCanConfigureAccessWithoutAmbientProject() {
        let app = launchContextualNewChat(extraArguments: ["--ui-preview-new-chat-unassigned"])
        XCTAssertTrue(app.buttons["New chat project"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Start chat"].isEnabled)
        XCTAssertTrue(app.buttons["Refresh access"].exists)
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
