import XCTest

final class ChatScrollingUITests: XCTestCase {
    private let latestRichReply = "Latest rich reply bottom marker p7h8u"
    private let topMarker = "Top scroll marker p7h8u"
    private let latestBubble = "Message bubble scroll-latest-rich"

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    override func tearDown() {
        let app = XCUIApplication()
        app.terminate()
        _ = app.wait(for: .notRunning, timeout: 5)
        super.tearDown()
    }

    private func launch(_ arguments: [String], openThread: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        _ = app.wait(for: .notRunning, timeout: 5)
        app.launchArguments = arguments
        app.launchEnvironment["CAVE_OPEN_THREAD"] = openThread
        app.launch()
        return app
    }

    private func waitForLatest(_ app: XCUIApplication, timeout: TimeInterval = 15) -> XCUIElement {
        let bubble = app.descendants(matching: .any)[latestBubble].firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: timeout), "latest rich reply bubble exists")
        XCTAssertTrue(bubble.isHittable, "latest rich reply bubble is on screen")
        let link = app.links["Scroll fixture link"].firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: timeout), "the real WebView exposes its rendered link")
        let visible = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "hittable == true"), object: link
        )
        let result = XCTWaiter.wait(for: [visible], timeout: timeout)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Latest reply landing"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        if result != .completed {
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "Latest reply hierarchy"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
        }
        XCTAssertEqual(result, .completed, "the bottom of the rendered reply is visible and accessible")
        let latest = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", latestRichReply)
        ).firstMatch
        XCTAssertTrue(latest.waitForExistence(timeout: timeout), "actual latest reply text exists")
        XCTAssertTrue(latest.isHittable, "latest reply text is visible, not just an empty bubble")
        let jumpDismissed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: app.buttons["Scroll to latest"].firstMatch
        )
        XCTAssertEqual(XCTWaiter.wait(for: [jumpDismissed], timeout: 5), .completed,
                       "the latest control disappears once the actual last row is visible")
        return bubble
    }

    @MainActor
    func testLongUnreadThreadOpensAtLatestReply() {
        let app = launch(
            ["--ui-preview-long-chat-scroll"],
            openThread: "ui-preview-long-chat-scroll"
        )

        XCTAssertTrue(app.navigationBars["Long Scroll Chat"].waitForExistence(timeout: 15))
        _ = waitForLatest(app)

        let top = app.descendants(matching: .any)[topMarker].firstMatch
        XCTAssertFalse(top.isHittable, "opening a long unread thread must not land at the top or unread divider")
    }

    @MainActor
    func testDelayedHistoryLoadsAtLatestReply() {
        let app = launch(
            ["--ui-preview-delayed-long-chat-scroll"],
            openThread: "ui-preview-delayed-long-chat-scroll"
        )

        XCTAssertTrue(app.navigationBars["Delayed Scroll Chat"].waitForExistence(timeout: 30))
        _ = waitForLatest(app, timeout: 12)
        XCTAssertFalse(app.staticTexts["Start a chat"].exists, "loaded history replaces the empty-state overlay")
    }

    @MainActor
    func testScrollToLatestFromOlderContentShowsNewestReply() {
        let app = launch(
            ["--ui-preview-long-chat-scroll-jump"],
            openThread: "ui-preview-long-chat-scroll-jump"
        )

        XCTAssertTrue(app.navigationBars["Long Scroll Jump Chat"].waitForExistence(timeout: 15))
        _ = waitForLatest(app)

        let scrollView = app.scrollViews["Chat transcript"].firstMatch
        XCTAssertTrue(scrollView.waitForExistence(timeout: 5))
        for _ in 0..<2 {
            let top = app.staticTexts[topMarker].firstMatch
            for _ in 0..<12 {
                scrollView.swipeDown()
                if top.exists && top.isHittable { break }
            }
            XCTAssertTrue(top.isHittable, "the reader can reach older messages without being pulled back")

            let jump = app.buttons["Scroll to latest"].firstMatch
            XCTAssertTrue(jump.waitForExistence(timeout: 5), "jump control appears after an intentional scroll up")
            jump.tap()

            _ = waitForLatest(app, timeout: 8)
        }
    }
}
