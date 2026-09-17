import XCTest

/// Global search is now conversation search: no scope selector or other
/// surface's results, while local and desktop conversations remain discoverable.
final class GlobalSearchUITests: XCTestCase {
    @MainActor
    func testSearchOpensCrossProjectConversationWithoutAProjectSwitcher() {
        let app = launchSearch("Lyra")
        let result = app.descendants(matching: .any)["Chat row local:ui-preview-lyra-chat"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Everywhere"].exists)
        XCTAssertFalse(app.buttons["Project context button"].exists)
        result.tap()
        XCTAssertTrue(app.navigationBars["Lyra design review"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testSearchMaterializesAndOpensAServerOnlyConversation() {
        let app = launchSearch("Desktop handoff")
        let result = app.descendants(matching: .any)["Chat row server:ui-preview-server-only"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        result.tap()
        XCTAssertTrue(app.navigationBars["Desktop handoff"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testSearchFindsRenamedLocalChatByAuthoritativeTitleWithoutDuplicates() {
        let app = launchSearch("authoritative desktop handoff")
        let local = app.descendants(matching: .any)["Chat row local:ui-preview-renamed-local-chat"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["Chat row server:ui-preview-bound-rename"].firstMatch.exists)
        local.tap()
        XCTAssertTrue(app.navigationBars["Renamed local chat"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testTaskAndWorkspaceNamesDoNotProduceNonChatResults() {
        let app = launchSearch("scope anchor")
        XCTAssertFalse(app.buttons["Global search task scope-anchor-current"].exists)
        XCTAssertFalse(app.buttons["Global search project design-library"].exists)
        XCTAssertTrue(app.textFields["Search chats…"].exists,
                      "an empty search retains its editable field")
        app.buttons["Clear search"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["Chat row local:ui-preview-lyra-chat"].firstMatch
            .waitForExistence(timeout: 5))
    }

    @MainActor
    private func launchSearch(_ query: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-preview-chats-home",
            "--ui-open-search",
        ]
        app.launch()
        let field = app.textFields["Search chats…"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(query)
        return app
    }
}
