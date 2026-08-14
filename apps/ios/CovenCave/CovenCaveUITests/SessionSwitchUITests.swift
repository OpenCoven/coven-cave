import XCTest

/// Drives the session switcher the way a thumb does.
///
/// The bug this covers was invisible to every host-side test: ChatView
/// presented the picker inside a `NavigationStack` with no `path:` binding, so
/// the picker's `path.append` wrote into state nothing rendered and tapping a
/// session did nothing whatsoever. Unit tests over `AppModel` prove the routing
/// contract, but only a real tap proves the sheet dismissal and the navigation
/// mutation survive happening in the same state update.
final class SessionSwitchUITests: XCTestCase {

    private let firstThread = "Chat with Nyx on Jul 26"
    private let secondThread = "Chat with Nyx on Jul 27"

    private func launchInFirstThread() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-preview-second-thread"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()
        XCTAssertTrue(app.navigationBars[firstThread].waitForExistence(timeout: 15),
                      "the launch thread opens")
        return app
    }

    /// Opens the switcher from the chat's session controls.
    private func openSessionPicker(_ app: XCUIApplication) {
        let controls = app.buttons["Session controls"]
        XCTAssertTrue(controls.waitForExistence(timeout: 10), "session controls are reachable")
        controls.tap()

        let sessionRow = app.buttons["Switch session"].firstMatch
        XCTAssertTrue(sessionRow.waitForExistence(timeout: 10), "the details card offers Session")
        sessionRow.tap()
    }

    /// The whole point: tapping a session switches to it, closes the switcher,
    /// and stays there. Before the fix every one of these three assertions
    /// failed — the tap was a complete no-op.
    @MainActor
    func testTappingASessionSwitchesToItAndClosesThePicker() {
        let app = launchInFirstThread()
        openSessionPicker(app)

        let target = app.buttons["Thread row local-ui-preview-second-chat"].firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 10), "the other session is listed")
        target.tap()

        // Switches.
        XCTAssertTrue(app.navigationBars[secondThread].waitForExistence(timeout: 10),
                      "tapping a session opens it")
        // Closes the switcher. Asserted via the picker's own rows rather than
        // its Done button: Done arrived with the fix, so a pre-fix build would
        // pass a Done-based check for the wrong reason.
        XCTAssertFalse(app.buttons["Thread row local-ui-preview-empty-chat"].exists,
                       "the picker sheet is dismissed")
        // Stays put.
        XCTAssertFalse(app.navigationBars[firstThread].exists,
                       "the previous conversation is gone")

        sleep(1)
        XCTAssertTrue(app.navigationBars[secondThread].exists,
                      "the chosen session stays put rather than snapping back")
    }

    /// Leaving the switcher without choosing must be possible. Presented as a
    /// sheet there is no back button, so before the fix the only exits were a
    /// swipe or picking something.
    @MainActor
    func testDoneLeavesThePickerOnTheCurrentSession() {
        let app = launchInFirstThread()
        openSessionPicker(app)

        let done = app.buttons["Done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10), "picker mode offers a way out")
        done.tap()

        XCTAssertTrue(app.navigationBars[firstThread].waitForExistence(timeout: 10),
                      "dismissing without choosing keeps the current conversation")
    }
}
