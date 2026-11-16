import XCTest

/// Grouping transcript rows must retain every native row and its full text.
final class TranscriptAccessibilityUITests: XCTestCase {
    @MainActor
    func testLargeTranscriptKeepsEveryRowAndHistoricalTextAccessible() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-large-rich-chat-scroll", "--performance-instrumentation", "--timeline-performance-rich"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-large-rich-chat-scroll"
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.scrollViews["Chat transcript"].firstMatch.waitForExistence(timeout: 30))
        let hierarchy = app.debugDescription
        let attachment = XCTAttachment(string: hierarchy)
        attachment.name = "Native accessibility hierarchy for all 1,001 messages"
        attachment.lifetime = .keepAlways
        add(attachment)
        let expression = try NSRegularExpression(pattern: #"identifier: 'Message bubble (rich-(?:user|assistant)-[0-9]+|rich-latest)'"#)
        let identifiers = Set(expression.matches(in: hierarchy, range: NSRange(hierarchy.startIndex..., in: hierarchy)).compactMap {
            Range($0.range(at: 1), in: hierarchy).map { String(hierarchy[$0]) }
        })
        var expected = Set((0..<1_000).map { $0.isMultiple(of: 2) ? "rich-user-\($0)" : "rich-assistant-\($0)" })
        expected.insert("rich-latest")
        print("TRANSCRIPT ACCESSIBILITY rows=\(identifiers.count) expected=\(expected.count)")
        XCTAssertEqual(identifiers, expected, "accessibility grouping must not drop historical message rows")
        XCTAssertTrue(hierarchy.contains("row 11 | value 11"), "the first historical rich reply keeps its full native text beyond the loading placeholder")
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Latest reply with full native history accessibility"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
