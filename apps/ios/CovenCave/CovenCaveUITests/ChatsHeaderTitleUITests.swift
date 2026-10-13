import XCTest

/// The Chats header title at accessibility text sizes. On a narrow column
/// (an iPad sidebar) the two scaled controls leave too little room for the
/// serif title, which used to break mid-word into "Ch / ats". The header now
/// moves the title to its own line instead, so on every device the title is a
/// single line: wider than it is tall.
final class ChatsHeaderTitleUITests: XCTestCase {
    @MainActor
    func testAccessibilityTextSizesKeepTheChatsTitleOnOneLine() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout", "--ui-preview-chats-home",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()

        let title = app.staticTexts["Chats"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Open navigation"].firstMatch.exists)
        XCTAssertTrue(app.buttons["Chat list options"].firstMatch.exists)

        let frame = title.frame
        XCTAssertGreaterThan(frame.width, frame.height,
                             "a one-line \"Chats\" is wider than tall; a mid-word wrap (\"Ch / ats\") is taller than wide: \(frame)")
        XCTAssertTrue(app.windows.firstMatch.frame.contains(frame), "the title stays inside the window")
    }
}
