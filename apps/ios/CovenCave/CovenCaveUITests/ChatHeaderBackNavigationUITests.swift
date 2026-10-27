import XCTest

/// The chat header's Back control (#5695). On iOS 26 the header draws its own
/// Back button so it shares one glass capsule with Open navigation; tapping it
/// and the edge-swipe gesture must both still return to the previous screen.
final class ChatHeaderBackNavigationUITests: XCTestCase {
    private let threadTitle = "Chat with Nyx on Jul 26"

    @MainActor
    private func launchIntoConversation() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()
        XCTAssertTrue(app.navigationBars[threadTitle].waitForExistence(timeout: 10),
                      "the fixture conversation opens")
        return app
    }

    /// Whether the chat list sits beside the conversation rather than under
    /// it in a stack. That follows the window's width, not the device: iPad
    /// and an open iPhone Duo show both; a closed Duo or any other iPhone in
    /// portrait shows one. An idiom check gets the open Duo wrong.
    @MainActor
    private func listIsBesideConversation(_ app: XCUIApplication) -> Bool {
        app.descendants(matching: .any)["Chat row local:ui-preview-empty-chat"].waitForExistence(timeout: 2)
    }

    @MainActor
    func testBackButtonReturnsToChatList() throws {
        let app = launchIntoConversation()
        try XCTSkipIf(listIsBesideConversation(app),
                      "a wide window shows the list beside the conversation; there is no Back")

        // App-wide, like Open navigation: on iPhone Duo (iOS 27.1 SDK) the bar's
        // buttons lay out in a column under the status bar, outside the bar.
        let back = app.buttons["Back"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5), "the header keeps a labelled Back control")
        XCTAssertTrue(app.buttons["Open navigation"].exists, "Open navigation stays beside Back")
        back.tap()

        XCTAssertTrue(app.descendants(matching: .any)["Chat row local:ui-preview-empty-chat"].waitForExistence(timeout: 10),
                      "Back returns to the chat list")
    }

    @MainActor
    func testSplitDetailRootHasNoBack() throws {
        let app = launchIntoConversation()
        try XCTSkipUnless(listIsBesideConversation(app),
                          "only a wide window's split view shows the conversation as a detail root")

        // Queried app-wide: on iPhone Duo (iOS 27.1 SDK) the bar's buttons lay
        // out in a column under the status bar, outside the bar's own element.
        XCTAssertTrue(app.buttons["Open navigation"].waitForExistence(timeout: 5),
                      "the detail root keeps Open navigation")
        XCTAssertFalse(app.buttons["Back"].exists,
                       "a detail root beside the list has nothing to go back to")
    }

    @MainActor
    func testEdgeSwipeReturnsToChatList() throws {
        let app = launchIntoConversation()
        try XCTSkipIf(listIsBesideConversation(app),
                      "a wide window shows the list beside the conversation; there is no Back")

        let window = app.windows.firstMatch
        let edge = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        let middle = window.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
        edge.press(forDuration: 0.05, thenDragTo: middle)

        XCTAssertTrue(app.descendants(matching: .any)["Chat row local:ui-preview-empty-chat"].waitForExistence(timeout: 10),
                      "the edge-swipe back gesture still works with the grouped Back control")
    }
}
