import XCTest

/// Drives the agent-activity trail on the `--ui-preview-tool-activity` fixture.
///
/// The fold rules are covered by unit tests; what only a running app can show
/// is that the expanded rows actually render what the fold produced — the
/// argument summary, and the reason under a failed call. Also writes the
/// expanded state out as a PNG so the surface can be eyeballed.
final class AgentActivityUITests: XCTestCase {

    @MainActor
    func testExpandedTrailShowsArgumentsAndTheFailureReason() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-tool-activity"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
        app.launch()

        XCTAssertTrue(app.navigationBars["Chat with Nyx on Aug 3"].waitForExistence(timeout: 15),
                      "the fixture thread opens on launch")

        let chip = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Agent activity")
        ).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "the settled turn carries an activity chip")
        XCTAssertTrue(chip.label.contains("Ran 3 tools"), "chip summarises the turn: \(chip.label)")
        XCTAssertTrue(chip.label.contains("1 failed"), "chip reports the failure: \(chip.label)")

        // The argument summary — the whole point of the fix. Before it, every
        // one of these rows read "{".
        let firstArgument = app.staticTexts["src/lib/tool-arg-summary.ts"]
        chip.tap()
        XCTAssertTrue(firstArgument.waitForExistence(timeout: 5),
                      "a tool row shows its argument, not a brace")

        // One tap, and it stays open. The expansion used to be view-local
        // @State, so a transcript rebuild landing just after the tap re-created
        // the row and collapsed the trail under the reader (cave-m5tao).
        Thread.sleep(forTimeInterval: 2)
        XCTAssertTrue(firstArgument.exists,
                      "the trail stays open — a re-created row re-reads the choice")
        XCTAssertTrue(app.staticTexts["pnpm test --filter tool-arg"].exists,
                      "a shell row leads with its command")

        // The reason under the failed call.
        let reason = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "cannot find module")
        ).firstMatch
        XCTAssertTrue(reason.waitForExistence(timeout: 5), "a failed row explains itself")

        try attachScreenshot(named: "tool-rows-expanded")
    }

    /// Saves a full-screen PNG next to the test run and attaches it, so the
    /// surface can be reviewed without re-running Xcode.
    private func attachScreenshot(named name: String) throws {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)

        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("\(name).png")
        try shot.pngRepresentation.write(to: url)
        print("SCREENSHOT_PATH \(url.path)")
    }
}
