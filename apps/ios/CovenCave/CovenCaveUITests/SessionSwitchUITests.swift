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

    private func launchInFirstThread(clearDraft: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-preview-second-thread"]
        if clearDraft {
            app.launchArguments += ["-cave.chat.draft.ui-preview-empty-chat", ""]
        }
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()
        XCTAssertTrue(app.navigationBars[firstThread].waitForExistence(timeout: 15),
                      "the launch thread opens")
        return app
    }

    private func openSessionControls(_ app: XCUIApplication) {
        let controls = app.buttons["Session controls"]
        XCTAssertTrue(controls.waitForExistence(timeout: 10), "session controls are reachable")
        controls.tap()
    }

    /// Opens the switcher from the chat's session controls.
    private func openSessionPicker(_ app: XCUIApplication) {
        openSessionControls(app)
        let sessionRow = app.buttons["Switch session"].firstMatch
        XCTAssertTrue(sessionRow.waitForExistence(timeout: 10), "the details card offers Conversation")
        sessionRow.tap()
    }

    @MainActor
    private func openComposerActions(_ app: XCUIApplication) {
        let attach = app.buttons["Attach or run a tool"]
        XCTAssertTrue(attach.waitForExistence(timeout: 10), "the explicit launch opens the chat composer")
        attach.tap()
    }

    @MainActor
    func testComposerOffersChatActionsWithoutTaskOrMarketplaceManagement() {
        let app = launchInFirstThread()
        openComposerActions(app)

        for action in ["Camera", "Photos", "Files", "Dictate", "Commands"] {
            XCTAssertTrue(app.buttons[action].waitForExistence(timeout: 5),
                          "the composer retains \(action)")
        }
        for retired in ["Link a task", "Create task", "Tasks", "Plugins"] {
            XCTAssertFalse(app.buttons[retired].exists, "the composer must not offer \(retired)")
        }
        XCTAssertFalse(app.staticTexts["What tasks need attention?"].exists)
        XCTAssertFalse(app.staticTexts["Work on the next priority"].exists)
    }

    @MainActor
    func testCommandReferenceDoesNotOfferRetiredTaskNavigation() {
        let app = launchInFirstThread()
        openComposerActions(app)
        app.buttons["Commands"].tap()

        XCTAssertTrue(app.navigationBars["Commands"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["/help"].waitForExistence(timeout: 5),
                      "native chat commands remain available")

        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("/board")

        XCTAssertFalse(app.staticTexts["/board"].exists, "task navigation is not an offered command")
        XCTAssertFalse(app.staticTexts["/help"].exists, "the search has filtered the catalog")
        XCTAssertTrue(app.navigationBars["Commands"].exists, "search cannot navigate to Tasks")
        app.navigationBars["Commands"].buttons["Close"].tap()
        let done = app.navigationBars["Commands"].buttons["Done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()
        XCTAssertTrue(app.navigationBars[firstThread].waitForExistence(timeout: 5))
    }

    @MainActor
    func testTypedLegacyTaskCommandExplainsDesktopOnlyAndKeepsTheChat() {
        let app = launchInFirstThread(clearDraft: true)
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("/board")

        let run = app.buttons["Run command"]
        XCTAssertTrue(run.waitForExistence(timeout: 5))
        XCTAssertTrue(run.isEnabled)
        run.tap()

        let explanation = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Tasks", "desktop")
        ).firstMatch
        XCTAssertTrue(explanation.waitForExistence(timeout: 5),
                      "the legacy command explains where Tasks is available")
        XCTAssertTrue(app.navigationBars[firstThread].exists, "legacy commands do not leave the chat")
        XCTAssertFalse(app.navigationBars["Tasks"].exists)
        XCTAssertTrue(app.buttons["Session controls"].exists)
    }

    @MainActor
    func testSessionControlsOfferOneArchiveActionWithoutModelCapabilities() {
        let app = launchInFirstThread()
        openSessionControls(app)

        let archiveActions = app.buttons.matching(identifier: "Archive chat")
        XCTAssertTrue(
            archiveActions.firstMatch.waitForExistence(timeout: 10),
            "active chats expose archive even when model controls are unavailable"
        )
        XCTAssertEqual(archiveActions.count, 1, "session controls expose exactly one archive action")
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
