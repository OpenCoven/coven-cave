import XCTest
import UIKit

/// Drives the agent-activity trail on the `--ui-preview-tool-activity` fixture.
///
/// The fold rules are covered by unit tests; what only a running app can show
/// is that the expanded rows actually render what the fold produced — the
/// argument summary, and the reason under a failed call. Also writes the
/// expanded state out as a PNG so the surface can be eyeballed.
final class AgentActivityUITests: XCTestCase {

    @MainActor
    func testTimelinePreservesSummaryProseToolOrder() throws {
        let app = launchTimeline()
        let before = summary("before", in: app)
        let after = summary("after", in: app)
        let tool = timelineTool(in: app)
        XCTAssertTrue(before.waitForExistence(timeout: 10))
        XCTAssertTrue(after.exists)
        XCTAssertTrue(app.staticTexts["Checking the relevant source."].exists)
        XCTAssertTrue(app.staticTexts["The source check is complete."].exists)
        XCTAssertTrue(tool.label.contains("Succeeded"))
        let first = app.staticTexts["Inspecting 🧙 café."]
        let last = app.staticTexts["Ready to review."]
        XCTAssertTrue(first.exists)
        XCTAssertTrue(last.exists)
        XCTAssertEqual(app.webViews.count, 0, "completed plain paragraphs do not create WebViews")
        XCTAssertEqual(app.buttons.matching(identifier: "Open response in reader").count, 2)
        XCTAssertGreaterThanOrEqual(before.frame.height, 44)
        XCTAssertGreaterThanOrEqual(after.frame.height, 44)
        XCTAssertLessThan(before.frame.minY, first.frame.minY)
        XCTAssertLessThan(first.frame.maxY, tool.frame.minY)
        XCTAssertLessThan(tool.frame.maxY, after.frame.minY)
        XCTAssertLessThan(after.frame.minY, last.frame.minY)
        try attachScreenshot(named: "timeline-native-default")

        app.buttons["Open response in reader"].firstMatch.tap()
        let fullAnswer = app.webViews.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@ AND label CONTAINS %@", "Inspecting 🧙 café.", "Ready to review.")).firstMatch
        XCTAssertTrue(fullAnswer.waitForExistence(timeout: 10), "a native prose action opens the full response")
        app.buttons["Done"].tap()
        XCTAssertTrue(first.waitForExistence(timeout: 10))

        // A local choice applies to one block and does not write the global
        // preference or collapse its sibling.
        before.tap()
        XCTAssertFalse(app.staticTexts["Checking the relevant source."].exists)
        XCTAssertTrue(app.staticTexts["The source check is complete."].exists)
        before.tap()
        XCTAssertTrue(app.staticTexts["Checking the relevant source."].exists)
    }

    @MainActor
    func testTimelineKeepsLocalChoicesThroughCompletionAndBackground() throws {
        let app = launchTimeline(extraArguments: ["--ui-preview-timeline-live", "--ui-preview-reasoning-off", "--ui-preview-tool-output"])
        let before = summary("before", in: app)
        let tool = timelineTool(in: app)
        XCTAssertTrue(before.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Checking the relevant source."].exists)
        XCTAssertTrue(tool.label.contains("Running"))
        XCTAssertFalse(app.buttons["Open response in reader"].exists)
        before.tap()
        tool.tap()
        XCTAssertTrue(app.staticTexts["Checking the relevant source."].exists)
        XCTAssertTrue(app.buttons["Show output for Read"].exists)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.staticTexts["Checking the relevant source."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Show output for Read"].exists)

        let settled = expectation(for: NSPredicate(format: "label CONTAINS %@", "Succeeded"), evaluatedWith: tool)
        wait(for: [settled], timeout: 40)
        XCTAssertTrue(app.staticTexts["Checking the relevant source."].exists)
        XCTAssertTrue(app.buttons["Show output for Read"].exists)
        XCTAssertTrue(summary("after", in: app).exists)
        XCTAssertFalse(app.staticTexts["The source check is complete."].exists,
                       "new summaries respect the saved opt-out despite an earlier local expansion")
        try attachScreenshot(named: "timeline-native-live-completed")
        app.buttons["Show output for Read"].tap()
        XCTAssertTrue(app.staticTexts["NATIVE_TOOL_OUTPUT_PREVIEW\nSecond result line."].waitForExistence(timeout: 5))
        app.buttons["Close tool output"].tap()
        XCTAssertTrue(app.buttons["Show output for Read"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testTimelineFailureRemainsVisibleWithSummariesHidden() throws {
        let app = launchTimeline(extraArguments: ["--ui-preview-reasoning-off", "--ui-preview-timeline-failed"])
        XCTAssertTrue(timelineTool(in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(timelineTool(in: app).label.contains("Failed"))
        XCTAssertTrue(app.staticTexts["The requested file was not found."].exists)
        XCTAssertFalse(app.staticTexts["Checking the relevant source."].exists)
        XCTAssertFalse(app.staticTexts["The source check is complete."].exists)
        try attachScreenshot(named: "timeline-native-hidden-failure")
    }

    @MainActor
    func testTimelineGlobalPreferenceResetsLocalChoices() throws {
        let app = launchTimeline()
        summary("before", in: app).tap()
        XCTAssertFalse(app.staticTexts["Checking the relevant source."].exists)
        XCTAssertTrue(app.staticTexts["The source check is complete."].exists)
        let controls = app.buttons["Session controls"]
        controls.tap()
        let preference = app.switches["Show reasoning summaries"]
        XCTAssertTrue(preference.waitForExistence(timeout: 5))
        XCTAssertEqual(preference.value as? String, "1", "local collapse does not change the global setting")
        // SwiftUI includes the label in the switch's accessibility frame;
        // tap the trailing thumb rather than the non-interactive label.
        preference.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        controls.tap()
        XCTAssertFalse(app.staticTexts["Checking the relevant source."].exists)
        XCTAssertFalse(app.staticTexts["The source check is complete."].exists)
        controls.tap()
        XCTAssertEqual(preference.value as? String, "0")
        preference.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        controls.tap()
        XCTAssertTrue(app.staticTexts["Checking the relevant source."].exists)
        XCTAssertTrue(app.staticTexts["The source check is complete."].exists)
    }

    @MainActor
    func testTimelineSupportsAccessibilityTextSize() throws {
        let app = launchTimeline(extraArguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        let transcript = app.scrollViews["Chat transcript"].firstMatch
        transcript.swipeDown()
        transcript.swipeDown()
        let before = summary("before", in: app)
        XCTAssertTrue(before.isHittable)
        let captionLine = UIFont.preferredFont(forTextStyle: .caption1,
            compatibleWith: UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge)).lineHeight
        XCTAssertGreaterThan(before.staticTexts["Reasoning summary"].frame.height, captionLine * 1.25,
                             "the summary title occupies multiple lines at the largest text size")
        XCTAssertGreaterThanOrEqual(before.staticTexts["Reasoning summary"].frame.minY, before.frame.minY)
        XCTAssertLessThanOrEqual(before.staticTexts["Reasoning summary"].frame.maxY, before.frame.maxY)
        XCTAssertGreaterThanOrEqual(before.frame.minX, 0)
        XCTAssertLessThanOrEqual(before.frame.maxX, app.frame.width)
        try attachScreenshot(named: "timeline-native-accessibility-start")
        let tool = timelineTool(in: app)
        for _ in 0..<5 where !tool.isHittable { transcript.swipeUp() }
        // A tappable row may still sit under the translucent sticky date.
        // Place the entire chip below that header for visual qualification.
        for _ in 0..<4 where abs(tool.frame.minY - app.frame.height * 0.35) > 20 {
            let delta = min(150, max(-150, app.frame.height * 0.35 - tool.frame.minY))
            let start = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: delta)),
                        withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTAssertTrue(tool.isHittable)
        XCTAssertGreaterThan(tool.frame.minY, app.navigationBars.firstMatch.frame.maxY + 60)
        XCTAssertLessThan(tool.frame.maxY, app.textFields["Message"].frame.minY)
        let after = summary("after", in: app)
        XCTAssertGreaterThanOrEqual(after.frame.minY, tool.frame.maxY)
        XCTAssertGreaterThanOrEqual(after.staticTexts["Reasoning summary"].frame.minY, tool.frame.maxY,
                                    "the wrapping title must not draw over the preceding tool")
        XCTAssertTrue(tool.label.contains("Read · src/example.ts · Succeeded"))
        XCTAssertGreaterThanOrEqual(tool.frame.minX, 0)
        XCTAssertLessThanOrEqual(tool.frame.maxX, app.frame.width)
        try attachScreenshot(named: "timeline-native-accessibility-tool")
    }

    @MainActor
    private func launchTimeline(extraArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-tool-activity", "--ui-preview-timeline"] + extraArguments
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
        app.launch()
        XCTAssertTrue(app.navigationBars["Chat with Nyx on Aug 3"].waitForExistence(timeout: 15))
        return app
    }

    @MainActor
    private func summary(_ suffix: String, in app: XCUIApplication) -> XCUIElement {
        // The enclosing message supplies its identifier to every native child.
        app.buttons.matching(NSPredicate(format: "label == %@", "Reasoning summary"))
            .element(boundBy: suffix == "before" ? 0 : 1)
    }

    @MainActor
    private func timelineTool(in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Tool activity:")).firstMatch
    }

    @MainActor
    func testToolOutputCanBeOpenedAndDismissed() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-tool-activity", "--ui-preview-tool-output"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
        app.launch()
        let chip = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Agent activity")).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 15))
        chip.tap()
        let open = app.buttons["Show output for Read"]
        XCTAssertTrue(open.waitForExistence(timeout: 5), "successful native tools expose their saved output")
        guard open.exists else { return }
        open.tap()
        XCTAssertTrue(app.staticTexts["Tool output"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["NATIVE_TOOL_OUTPUT_PREVIEW\nSecond result line."].waitForExistence(timeout: 5))
        try attachScreenshot(named: "tool-output-detail")
        app.buttons["Close tool output"].tap()
        XCTAssertTrue(open.waitForExistence(timeout: 5), "dismissal returns to the owning tool row")
        XCTAssertTrue(open.isHittable)
    }

    @MainActor
    func testDeniedToolOutputNeverShowsServerErrorBody() throws {
        let app = launchToolOutput()
        app.buttons["Show output for Bash"].tap()
        let refusal = app.staticTexts["Access to this output was denied. Check your desktop connection and access."]
        XCTAssertTrue(refusal.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "PRIVATE_ERROR_BODY")).firstMatch.exists)
        XCTAssertFalse(app.buttons["Load output again"].exists)
        try attachScreenshot(named: "tool-output-denied")
        app.buttons["Close tool output"].tap()
        XCTAssertTrue(app.buttons["Show output for Bash"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testToolOutputClearsWhenBackgroundedAndCanBeLoadedAgain() throws {
        let app = launchToolOutput()
        app.buttons["Show output for Read"].tap()
        let result = app.staticTexts["NATIVE_TOOL_OUTPUT_PREVIEW\nSecond result line."]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["Show output for Read"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Tool output"].exists)
        XCTAssertFalse(result.exists)
        app.buttons["Show output for Read"].tap()
        XCTAssertTrue(result.waitForExistence(timeout: 5))
    }

    @MainActor
    func testOldToolNeverUsesTheThreadsReplacementConversation() throws {
        let app = launchToolOutput(extraArguments: ["--ui-preview-tool-output-rotated-session"])
        app.buttons["Show output for Read"].tap()
        XCTAssertTrue(app.staticTexts["NATIVE_TOOL_OUTPUT_PREVIEW\nSecond result line."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["WRONG_CONVERSATION_OUTPUT"].exists)
    }

    @MainActor
    private func launchToolOutput(extraArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-tool-activity", "--ui-preview-tool-output"] + extraArguments
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
        app.launch()
        let chip = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Agent activity")).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 15))
        chip.tap()
        XCTAssertTrue(app.buttons["Show output for Read"].waitForExistence(timeout: 5))
        return app
    }

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
        XCTAssertTrue(chip.label.contains("3 tool calls"), "chip summarises the turn: \(chip.label)")
        XCTAssertTrue(chip.label.contains("1 failed"), "chip reports the failure: \(chip.label)")

        // The enclosing message supplies its identifier to child elements.
        // Select the combined status for this message, not an individual line.
        let identity = app.staticTexts.matching(NSPredicate(
            format: "identifier == %@ AND (label == %@ OR label BEGINSWITH %@)",
            chip.identifier, "Model application status", "Runtime:"
        )).firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 5), "the response exposes its identity status")
        XCTAssertTrue(identity.label.contains("Runtime: not recorded"),
                      "legacy history does not invent a runtime: \(identity.label)")
        XCTAssertTrue(identity.label.contains("Runtime-reported model: unavailable"),
                      "unavailable model evidence is accessible: \(identity.label)")
        XCTAssertTrue(identity.label.contains("Activity support: not recorded"),
                      "unavailable activity support is accessible: \(identity.label)")

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

    @MainActor
    func testReportedIdentityStaysDistinctFromTheRequestedModel() throws {
        let app = launchReportedIdentity()
        let identity = reportedIdentity(in: app)
        assertReportedIdentity(identity)
        XCTAssertTrue(identity.isHittable, "the reported identity is visible in the transcript")
        try attachScreenshot(named: "runtime-identity-reported")

        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(identity.waitForExistence(timeout: 5), "the response report survives background/foreground")
        assertReportedIdentity(identity)
    }

    @MainActor
    func testReportedIdentityAtAccessibilityTextSize() throws {
        let app = launchReportedIdentity(accessibilityText: true)
        let identity = reportedIdentity(in: app)
        assertReportedIdentity(identity)
        XCTAssertTrue(identity.isHittable, "the report remains reachable at accessibility text size")
        XCTAssertLessThanOrEqual(identity.frame.maxX, app.frame.maxX,
                                 "the identity stays within the viewport")
        XCTAssertGreaterThanOrEqual(identity.frame.minX, app.frame.minX,
                                    "the identity does not overflow the leading edge")
        try attachScreenshot(named: "runtime-identity-accessibility-text")

        // At the largest size the combined footer spans multiple screens.
        // Its full accessibility label alone does not prove that the leading
        // runtime/model lines can be brought back into the visible viewport.
        let transcript = app.scrollViews["Chat transcript"].firstMatch
        XCTAssertTrue(transcript.exists)
        let visibleTop = max(transcript.frame.minY, app.navigationBars.firstMatch.frame.maxY)
        for _ in 0..<5 {
            if identity.frame.minY >= visibleTop { break }
            transcript.swipeDown()
        }
        // Position the start high enough to capture both the runtime and the
        // wrapped full model ID, not merely the first line at the bottom edge.
        let upperThird = visibleTop + (transcript.frame.maxY - visibleTop) / 3
        for _ in 0..<5 {
            if identity.frame.minY <= upperThird { break }
            transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
                .press(forDuration: 0.05, thenDragTo: transcript.coordinate(
                    withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7)
                ))
        }
        XCTAssertGreaterThanOrEqual(identity.frame.minY, visibleTop,
                                    "scrolling exposes the start of the identity report")
        XCTAssertLessThanOrEqual(identity.frame.minY, upperThird,
                                 "the full runtime/model lines have room in the visible viewport")
        assertReportedIdentity(identity)
        try attachScreenshot(named: "runtime-identity-accessibility-start")
    }

    @MainActor
    private func launchReportedIdentity(accessibilityText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-tool-activity", "--ui-preview-reported-runtime"]
        if accessibilityText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
        app.launch()
        XCTAssertTrue(app.navigationBars["Chat with Nyx on Aug 3"].waitForExistence(timeout: 15))
        return app
    }

    @MainActor
    private func reportedIdentity(in app: XCUIApplication) -> XCUIElement {
        let identity = app.staticTexts.matching(NSPredicate(
            format: "label BEGINSWITH %@", "Runtime: claude 2.1.288"
        )).firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 5), "the response exposes the reported identity")
        return identity
    }

    @MainActor
    private func assertReportedIdentity(_ identity: XCUIElement) {
        XCTAssertTrue(identity.label.contains("Runtime-reported model: claude-opus-5-5"))
        XCTAssertTrue(identity.label.contains("Requested model: claude-sonnet-5"))
        XCTAssertTrue(identity.label.contains("Runtime path: Coven relay"))
        XCTAssertTrue(identity.label.contains("Tool details: supported on this path"))
        XCTAssertTrue(identity.label.contains("Reasoning summaries: support unverified on this path"))
        XCTAssertFalse(identity.label.contains("gpt-5.6"), "the familiar's current model cannot overwrite a response report")
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
