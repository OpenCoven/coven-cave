import XCTest

final class ContinuityChaptersUITests: XCTestCase {
    @MainActor
    func testOptInChapterJumpKeepsExactConversationAndDraft() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-empty-chat", "--ui-preview-continuity",
            "-cave.continuity.chapters.enabled", "NO",
        ]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()
        XCTAssertTrue(app.navigationBars["Continuity source fixture"].waitForExistence(timeout: 15))
        let composer = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields["Ask something…"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.tap()
        composer.typeText("Unsent continuity draft")
        app.buttons["Session controls"].tap()
        XCTAssertFalse(app.buttons["Browse chapters"].exists, "navigation starts disabled")
        app.switches["Chapter navigation"].tap()
        app.buttons["Browse chapters"].tap()
        XCTAssertTrue(app.navigationBars["Chapters"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["fixture-continuity-exact-conversation"].exists)
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "Chapter source-")).count, 3)

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "continuity-ios-chapters"
        attachment.lifetime = .keepAlways
        add(attachment)

        app.buttons["Chapter source-0"].tap()
        XCTAssertTrue(app.navigationBars["Continuity source fixture"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Original source anchor: keep this exact conversation."].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Inactive sibling must not appear."].exists)
        XCTAssertTrue(app.buttons["Scroll to latest"].exists)
        XCTAssertEqual(composer.value as? String, "Unsent continuity draft")
        app.buttons["Scroll to latest"].tap()
        XCTAssertTrue(app.navigationBars["Continuity source fixture"].exists)
    }
}
