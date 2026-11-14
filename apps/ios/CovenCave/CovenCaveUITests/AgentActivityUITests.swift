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
    func testRealServerHistoryCarriesWithholdingIntoExpandedNativeRows() throws {
        continueAfterFailure = false
        guard let raw = ProcessInfo.processInfo.environment["CAVE_TOOL_HISTORY_FIXTURE"] else {
            throw XCTSkip("Requires the owned, freshly built production server history fixture")
        }
        let fixture = try JSONDecoder().decode([String: String].self, from: Data(raw.utf8))
        let withheldName = try XCTUnwrap(fixture["withheldTool"])
        let inputOnlyName = try XCTUnwrap(fixture["inputOnlyTool"])
        let legacyName = try XCTUnwrap(fixture["legacyTool"])
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-tool-activity", "--ui-preview-tool-history"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
        app.launchEnvironment["CAVE_TOOL_HISTORY_FIXTURE"] = raw
        app.launch()
        defer { app.terminate() }
        let chip = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Agent activity")).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 20), "Real CaveClient history must load before a native row exists")
        chip.tap()
        XCTAssertTrue(app.staticTexts[withheldName].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[inputOnlyName].exists)
        XCTAssertTrue(app.staticTexts[legacyName].exists)
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Input withheld from saved history.")).count, 2)
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Output withheld from saved history.")).count, 1)
        XCTAssertFalse(app.buttons["Show output for \(withheldName)"].exists)
        XCTAssertTrue(app.buttons["Show output for \(inputOnlyName)"].exists)
        XCTAssertTrue(app.buttons["Show output for \(legacyName)"].exists)
        XCTAssertFalse(app.staticTexts["Couldn't load fixture history."].exists)
        try attachScreenshot(named: "real-server-native-historical-withholding")
        if let marker = fixture["outputMarker"] {
            let open = app.buttons["Show output for \(inputOnlyName)"]
            revealBelowHeader(open, in: app)
            open.tap()
            XCTAssertTrue(app.staticTexts[marker].waitForExistence(timeout: 10), "The safe input-only result loads through the actual production route")
            try attachScreenshot(named: "real-server-native-safe-output")
            app.buttons["Close tool output"].tap()
        }
    }

    @MainActor
    func testHistoricalWithholdingExplainsInputAndOutputWithoutOfferingUnavailableLoads() throws {
        continueAfterFailure = false
        for flag in ["input", "output", "both", "legacy"] {
            let app = XCUIApplication()
            app.launchArguments = ["--ui-preview-tool-activity", "--ui-preview-tool-output", "--ui-preview-tool-disclosure", flag]
            app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
            app.launch()
            defer { app.terminate() }
            let chip = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Agent activity")).firstMatch
            XCTAssertTrue(chip.waitForExistence(timeout: 15))
            chip.tap()
            let inputNotice = app.staticTexts["Input withheld from saved history."]
            let outputNotice = app.staticTexts["Output withheld from saved history."]
            let open = app.buttons["Show output for Read"]
            let inputWithheld = flag == "input" || flag == "both"
            let outputWithheld = flag == "output" || flag == "both"
            if inputWithheld {
                XCTAssertTrue(inputNotice.waitForExistence(timeout: 5))
                XCTAssertFalse(app.staticTexts["src/lib/tool-arg-summary.ts"].exists, "Withholding cannot leave an argument preview")
                revealBelowHeader(inputNotice, in: app)
                XCTAssertTrue(inputNotice.isHittable)
            } else {
                XCTAssertFalse(inputNotice.exists)
                XCTAssertTrue(app.staticTexts["src/lib/tool-arg-summary.ts"].exists)
            }
            if outputWithheld {
                XCTAssertTrue(outputNotice.waitForExistence(timeout: 5))
                XCTAssertFalse(open.exists, "Known withheld output has no lazy-load action")
                revealBelowHeader(outputNotice, in: app)
                XCTAssertTrue(outputNotice.isHittable)
            } else {
                XCTAssertFalse(outputNotice.exists)
                XCTAssertTrue(open.waitForExistence(timeout: 5), "Input withholding and legacy absence preserve output loading")
                revealBelowHeader(open, in: app)
                open.tap()
                XCTAssertTrue(app.staticTexts["NATIVE_TOOL_OUTPUT_PREVIEW\nSecond result line."].waitForExistence(timeout: 5))
                XCTAssertFalse(app.staticTexts["Output withheld from saved history."].exists)
                app.buttons["Close tool output"].tap()
            }
            XCTAssertTrue(app.buttons["Show output for Bash"].exists, "An unrelated tool keeps its existing action")
            XCTAssertTrue(app.staticTexts["42ms"].exists, "Disclosure cannot fabricate or replace timing/status")
            try attachScreenshot(named: "historical-tool-disclosure-\(flag)")
        }
    }

    @MainActor
    func testLifecycleStatesKeepExactLabelsAndProvenanceInDetail() throws {
        let cases = [
            ("approval-requested", "Approval requested"),
            ("cancel-requested", "Cancellation requested"),
            ("policy-rejected", "Rejected by policy"),
            ("user-rejected", "Rejected by user"),
            ("cancelled", "Cancelled"),
        ]
        for (status, label) in cases {
            let app = launchTimeline(extraArguments: ["--ui-preview-tool-status", status, "--ui-preview-tool-output", "--ui-preview-reasoning-off"])
            defer { app.terminate() }
            let tool = timelineTool(in: app)
            XCTAssertTrue(tool.waitForExistence(timeout: 10))
            XCTAssertTrue(tool.label.contains(label), "\(status): \(tool.label)")
            XCTAssertFalse(tool.label.contains("Succeeded"))
            tool.tap()
            XCTAssertTrue(app.staticTexts[label].firstMatch.waitForExistence(timeout: 5))
            XCTAssertTrue(app.staticTexts["Runtime report · hermes · version unavailable"].firstMatch.exists)
            XCTAssertTrue(app.staticTexts["Approval and change confirmation unavailable."].firstMatch.exists)
            app.buttons["Show output for Read"].tap()
            XCTAssertTrue(app.buttons["Close tool output"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.staticTexts[label].firstMatch.exists)
            XCTAssertTrue(app.staticTexts["Runtime report · hermes · version unavailable"].firstMatch.exists)
            try attachScreenshot(named: "timeline-native-\(status)")
            app.buttons["Close tool output"].tap()
            XCTAssertTrue(tool.waitForExistence(timeout: 5))
        }
    }

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
        app.sendToBackground()
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

    /// golden-02 (#6057): a provider-withheld block is a labelled no-text state,
    /// never a fabricated summary, and keeps its place in the timeline.
    @MainActor
    func testTimelineShowsProviderWithheldSummaryHonestly() throws {
        let app = launchTimeline(extraArguments: ["--ui-preview-timeline-withheld"])
        let withheld = summary("after", in: app)
        XCTAssertTrue(withheld.waitForExistence(timeout: 10))
        XCTAssertEqual(withheld.label, "Reasoning summary")
        XCTAssertTrue(app.staticTexts["Provider withheld this summary."].exists)
        XCTAssertFalse(app.staticTexts["The source check is complete."].exists)
        XCTAssertLessThan(timelineTool(in: app).frame.maxY, withheld.frame.minY)
        XCTAssertLessThan(withheld.frame.minY, app.staticTexts["Ready to review."].frame.minY)
        try attachScreenshot(named: "timeline-native-provider-withheld")
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
        XCTAssertLessThanOrEqual(before.frame.maxX, viewport(app).width)
        try attachScreenshot(named: "timeline-native-accessibility-start")
        let tool = timelineTool(in: app)
        for _ in 0..<5 where !tool.isHittable { transcript.swipeUp() }
        // A tappable row may still sit under the translucent sticky date.
        // Place the entire chip below that header for visual qualification.
        for _ in 0..<4 where abs(tool.frame.minY - viewport(app).height * 0.35) > 20 {
            let delta = min(150, max(-150, viewport(app).height * 0.35 - tool.frame.minY))
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
        XCTAssertLessThanOrEqual(tool.frame.maxX, viewport(app).width)
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
        revealBelowHeader(open, in: app)
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
    func testOversizedToolOutputIsExplicitlyWithheldAndSheetRemainsResponsive() throws {
        for shape in ["oversized-output", "oversized-envelope"] {
            let app = launchToolOutput(extraArguments: ["--ui-preview-tool-output-case", shape])
            defer { app.terminate() }
            app.buttons["Show output for Read"].tap()
            let refusal = app.staticTexts["This output exceeds the display limit. Close this sheet to return to the tool summary."]
            XCTAssertTrue(refusal.waitForExistence(timeout: 5), shape)
            XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "MUST_NOT_DISPLAY")).firstMatch.exists)
            XCTAssertFalse(app.buttons["Load output again"].exists)
            try attachScreenshot(named: "tool-output-\(shape)")
            assertToolOutputDismisses(in: app)
        }
    }

    @MainActor
    func testDeepToolOutputEnvelopeIsWithheldAndSheetRemainsResponsive() throws {
        let app = launchToolOutput(extraArguments: ["--ui-preview-tool-output-case", "deep-envelope"])
        defer { app.terminate() }
        app.buttons["Show output for Read"].tap()
        XCTAssertTrue(app.staticTexts["The desktop returned an unreadable output response. Try loading it again."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "DEEP_ENVELOPE_MUST_NOT_DISPLAY")).firstMatch.exists)
        XCTAssertTrue(app.buttons["Load output again"].exists)
        try attachScreenshot(named: "tool-output-deep-envelope")
        assertToolOutputDismisses(in: app)
    }

    @MainActor
    func testAtLimitDeepToolOutputRendersVerbatimAndSheetRemainsResponsive() throws {
        let app = launchToolOutput(extraArguments: ["--ui-preview-tool-output-case", "large-deep-output"])
        defer { app.terminate() }
        app.buttons["Show output for Read"].tap()
        let result = app.textViews["tool-output-text"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        guard result.exists else { return }
        let text = try XCTUnwrap(result.value as? String)
        XCTAssertEqual(text.utf8.count, 256 * 1024)
        XCTAssertTrue(text.hasPrefix("LARGE_DEEP_OUTPUT_START"))
        XCTAssertTrue(text.contains("<script>not executable</script>"))
        XCTAssertTrue(text.contains(String(repeating: "[", count: 256) + "0" + String(repeating: "]", count: 256)))
        XCTAssertTrue(text.hasSuffix("LARGE_DEEP_OUTPUT_END"))
        let geometry = XCTAttachment(string: """
        outputFrame=\(result.frame)
        outputHittable=\(result.isHittable)
        savedOutputHeadingFrame=\(app.staticTexts["Saved output"].frame)
        appFrame=\(app.frame)
        outputUTF8Bytes=\(text.utf8.count)
        """)
        geometry.name = "at-limit-output-geometry"
        geometry.lifetime = .keepAlways
        add(geometry)
        try attachScreenshot(named: "tool-output-large-deep-verbatim")
        XCTAssertTrue(result.isHittable, "Saved output must expose a visible selectable text surface")
        XCTAssertLessThanOrEqual(result.frame.maxY, app.frame.maxY,
                                 "The selectable saved-output viewport must remain within the screen")
        let header = app.staticTexts["Tool output"]
        let headerFrame = header.frame
        result.swipeUp(velocity: .slow)
        XCTAssertTrue(header.isHittable)
        XCTAssertEqual(header.frame, headerFrame, "Scrolling saved text must keep the sheet header fixed")
        XCTAssertTrue(app.staticTexts["Saved output"].isHittable)
        XCTAssertTrue(app.buttons["Close tool output"].isHittable)
        XCTAssertEqual(result.value as? String, text, "Inner scrolling does not change the complete result")
        assertOutputGlyphsPaint(in: result, app: app)
        try attachScreenshot(named: "tool-output-large-deep-after-inner-scroll")
        app.sendToBackground()
        app.activate()
        XCTAssertTrue(app.buttons["Show output for Read"].waitForExistence(timeout: 5))
        XCTAssertFalse(result.exists, "The native text viewport clears and closes on backgrounding")
        revealBelowHeader(app.buttons["Show output for Read"], in: app)
        app.buttons["Show output for Read"].tap()
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertEqual(result.value as? String, text)
        try attachScreenshot(named: "tool-output-large-deep-reloaded")
        assertToolOutputDismisses(in: app)
        try attachScreenshot(named: "tool-output-large-deep-dismissed")
    }

    /// Accessibility content can exist while a tall native layout fragment is
    /// blank. Observe actual pixels inside the text viewport after scrolling,
    /// excluding the sheet header, padding and native scroll indicator.
    @MainActor
    private func assertOutputGlyphsPaint(in result: XCUIElement, app: XCUIApplication) {
        let region = result.frame.insetBy(dx: 12, dy: 8)
        let screen = app.frame
        var fractions: [Double] = []
        let paints = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let fraction = (try? Self.outputGlyphFraction(region: region, screen: screen)) ?? 0
            fractions.append(fraction)
            return fraction > 0.005
        }, object: nil)
        let observed = XCTWaiter.wait(for: [paints], timeout: 5)
        let attachment = XCTAttachment(string: "region=\(region) contrastFractions=\(fractions)")
        attachment.name = "post-scroll-output-glyph-observations"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(observed, .completed, "Visible saved-output glyphs must paint after inner scrolling")
    }

    private static func outputGlyphFraction(region: CGRect, screen: CGRect) throws -> Double {
        let image = try XCTUnwrap(XCUIScreen.main.screenshot().image.cgImage)
        let scale = CGFloat(image.width) / screen.width
        let pixels = CGRect(x: region.minX * scale, y: region.minY * scale,
                            width: region.width * scale, height: region.height * scale).integral
        let crop = try XCTUnwrap(image.cropping(to: pixels))
        let context = try XCTUnwrap(CGContext(data: nil, width: crop.width, height: crop.height,
            bitsPerComponent: 8, bytesPerRow: crop.width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(crop, in: CGRect(x: 0, y: 0, width: crop.width, height: crop.height))
        let bytes = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
        var histogram = [Int](repeating: 0, count: 256)
        let count = crop.width * crop.height
        for index in 0..<count {
            let offset = index * 4
            let luminance = (Int(bytes[offset]) + Int(bytes[offset + 1]) + Int(bytes[offset + 2])) / 3
            histogram[luminance] += 1
        }
        let background = try XCTUnwrap(histogram.indices.max(by: { histogram[$0] < histogram[$1] }))
        let ink = histogram.indices.filter { abs($0 - background) > 48 }.reduce(0) { $0 + histogram[$1] }
        return Double(ink) / Double(count)
    }

    @MainActor
    private func assertToolOutputDismisses(in app: XCUIApplication) {
        let close = app.buttons["Close tool output"]
        XCTAssertTrue(close.isHittable)
        close.tap()
        let open = app.buttons["Show output for Read"]
        XCTAssertTrue(open.waitForExistence(timeout: 5))
        revealBelowHeader(open, in: app)
        XCTAssertTrue(open.isHittable, "The owning tool remains interactive after bounded output handling")
        XCTAssertFalse(app.staticTexts["Tool output"].exists)
    }

    @MainActor
    func testToolOutputClearsWhenBackgroundedAndCanBeLoadedAgain() throws {
        let app = launchToolOutput()
        app.buttons["Show output for Read"].tap()
        let result = app.staticTexts["NATIVE_TOOL_OUTPUT_PREVIEW\nSecond result line."]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        app.sendToBackground()
        app.activate()
        XCTAssertTrue(app.buttons["Show output for Read"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Tool output"].exists)
        XCTAssertFalse(result.exists)
        revealBelowHeader(app.buttons["Show output for Read"], in: app)
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
        revealBelowHeader(app.buttons["Show output for Read"], in: app)
        return app
    }

    /// Scroll the transcript until `element` sits below the header. Expanding
    /// the trail grows the bottom-anchored transcript upward, so on a short
    /// screen (iPhone Duo's closed outer display is 678pt) its first rows land
    /// under the navigation bar, where a tap hits the bar instead. Small, slow
    /// drags so the row isn't flung past the other edge.
    @MainActor
    private func revealBelowHeader(_ element: XCUIElement, in app: XCUIApplication) {
        let transcript = app.scrollViews["Chat transcript"].firstMatch
        for _ in 0..<6 where element.frame.minY < app.navigationBars.firstMatch.frame.maxY + 8 {
            transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
                .press(forDuration: 0.05, thenDragTo: transcript.coordinate(
                    withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)
                ), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
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
        // The trail is folded into a Run details disclosure (#6045): the
        // closed summary counts the gaps, and opening it shows the rows.
        let runDetails = app.buttons.matching(NSPredicate(
            format: "identifier == %@ AND label BEGINSWITH %@", chip.identifier, "Run details"
        )).firstMatch
        XCTAssertTrue(runDetails.waitForExistence(timeout: 5), "the response folds its trail into Run details")
        XCTAssertEqual(runDetails.label, "Run details · runtime not recorded · 3 unverified",
                       "the closed summary names the missing runtime and counts the gaps")
        XCTAssertEqual(runDetails.value as? String, "Collapsed")
        runDetails.tap()
        // Select the combined status for this message, not an individual line.
        let identity = app.staticTexts.matching(NSPredicate(
            format: "identifier == %@ AND (label == %@ OR label BEGINSWITH %@)",
            chip.identifier, "Model application status", "Runtime:"
        )).firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 5), "the response exposes its identity status")
        XCTAssertEqual(runDetails.value as? String, "Expanded")
        XCTAssertTrue(identity.label.contains("Runtime: Identity not recorded in this response"),
                      "legacy history does not invent a runtime: \(identity.label)")
        XCTAssertTrue(identity.label.contains("Model: not reported"),
                      "unavailable model evidence is accessible: \(identity.label)")
        XCTAssertTrue(identity.label.contains("Activity: not recorded for this turn"),
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

        app.sendToBackground()
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
        XCTAssertLessThanOrEqual(identity.frame.maxX, viewport(app).maxX,
                                 "the identity stays within the viewport")
        XCTAssertGreaterThanOrEqual(identity.frame.minX, viewport(app).minX,
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
        // A slow drag held at its end, so the scroll stops where the finger
        // did: a released flick carries momentum past the start of the rows
        // now that the wrapped Run details summary sits above them (#6045).
        // Ten tenth-height drags, not five: a short landscape viewport (iPhone
        // Duo's open inner display is 669pt tall) needs more of them.
        let upperThird = visibleTop + (transcript.frame.maxY - visibleTop) / 3
        for _ in 0..<10 {
            if identity.frame.minY <= upperThird { break }
            transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
                .press(forDuration: 0.05, thenDragTo: transcript.coordinate(
                    withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7)
                ), withVelocity: .slow, thenHoldForDuration: 0.2)
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

    /// Opens the Run details disclosure (#6045) and returns its combined rows.
    @MainActor
    private func reportedIdentity(in app: XCUIApplication) -> XCUIElement {
        let runDetails = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH %@", "Run details · claude 2.1.288"
        )).firstMatch
        XCTAssertTrue(runDetails.waitForExistence(timeout: 5), "the response folds its report into Run details")
        XCTAssertEqual(runDetails.label, "Run details · claude 2.1.288 · 1 unverified",
                       "the closed summary carries the runtime and the one unverified fact")
        if runDetails.value as? String != "Expanded" { runDetails.tap() }
        let identity = app.staticTexts.matching(NSPredicate(
            format: "label BEGINSWITH %@", "Runtime: claude 2.1.288"
        )).firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 5), "the response exposes the reported identity")
        return identity
    }

    @MainActor
    private func assertReportedIdentity(_ identity: XCUIElement) {
        XCTAssertTrue(identity.label.contains("Model: claude-opus-5-5 · reported by the runtime"))
        XCTAssertTrue(identity.label.contains("Requested model: claude-sonnet-5"))
        XCTAssertTrue(identity.label.contains("Runtime path: Coven relay"))
        XCTAssertTrue(identity.label.contains("Tool details: available"))
        XCTAssertTrue(identity.label.contains("Reasoning summaries: not verified on this path"))
        XCTAssertFalse(identity.label.contains("gpt-5.6"), "the familiar's current model cannot overwrite a response report")
    }

    /// The app's viewport, in the same space as element frames. On iPhone
    /// Duo's open inner display `app.frame` reports the portrait-native panel
    /// (669pt wide) while elements lay out in the landscape window, so
    /// measure the window instead.
    @MainActor
    private func viewport(_ app: XCUIApplication) -> CGRect {
        app.windows.firstMatch.frame
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
