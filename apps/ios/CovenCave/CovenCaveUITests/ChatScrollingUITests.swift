import Vision
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
            // SwiftUI's LazyVStack can re-estimate unmeasured history heights
            // mid-deceleration and move the offset by itself (reproduced on
            // main's ChatView too); slow CI simulators hit that more often.
            // The budget absorbs those transients; the settled check below is
            // what proves the app never re-anchors a reader of older content.
            for _ in 0..<30 {
                scrollView.swipeDown()
                if top.exists && top.isHittable { break }
            }
            XCTAssertTrue(top.isHittable, "the reader can reach older messages")
            let pulledBack = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "hittable == false"), object: top
            )
            XCTAssertEqual(XCTWaiter.wait(for: [pulledBack], timeout: 3), .timedOut,
                           "a settled reader of older messages is not pulled back to latest")

            let jump = app.buttons["Scroll to latest"].firstMatch
            XCTAssertTrue(jump.waitForExistence(timeout: 5), "jump control appears after an intentional scroll up")
            jump.tap()

            _ = waitForLatest(app, timeout: 8)
        }
    }

    /// Whether the end of the newest reply is drawn on screen, read from a
    /// screenshot. Accessibility frames follow SwiftUI's layout, and that
    /// layout reported the end in view while the transcript drew the middle
    /// of the reply, or nothing at all (#6090).
    private func latestEndDrawn(_ app: XCUIApplication) -> Bool {
        guard let image = app.screenshot().image.cgImage else { return false }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try? VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).contains {
            $0.topCandidates(1).first?.string.localizedCaseInsensitiveContains("bottom marker") == true
        }
    }

    private func waitForLatestEndDrawn(_ app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let drawn = XCTNSPredicateExpectation(
            predicate: NSPredicate { [unowned self] _, _ in latestEndDrawn(app) }, object: nil
        )
        return XCTWaiter.wait(for: [drawn], timeout: timeout) == .completed
    }

    private func assertLatestEndStaysDrawn(_ app: XCUIApplication, _ message: String) {
        let lost = XCTNSPredicateExpectation(
            predicate: NSPredicate { [unowned self] _, _ in !latestEndDrawn(app) }, object: nil
        )
        XCTAssertEqual(XCTWaiter.wait(for: [lost], timeout: 6), .timedOut, message)
    }

    private func launchRichHistory() -> XCUIApplication {
        let app = launch(
            ["--ui-preview-long-rich-chat-scroll"],
            openThread: "ui-preview-long-rich-chat-scroll"
        )
        XCTAssertTrue(app.navigationBars["Long Rich Scroll Chat"].waitForExistence(timeout: 15))
        return app
    }

    /// Opening a long chat of real replies rests on the end of the newest
    /// reply, not partway up it (#6090).
    @MainActor
    func testRichHistoryOpensOnTheEndOfTheLatestReply() {
        let app = launchRichHistory()
        XCTAssertTrue(waitForLatestEndDrawn(app, timeout: 15), "the end of the latest reply is drawn")
        assertLatestEndStaysDrawn(app, "the transcript rests on the end of the latest reply")
    }

    /// A reader who scrolls back down to the newest reply by hand lands on it
    /// and stays there (#6090). History of real replies re-measures as it
    /// scrolls past, which must never push the reader back up.
    @MainActor
    func testScrollingBackDownStaysOnLatestReply() {
        let app = launchRichHistory()
        XCTAssertTrue(waitForLatestEndDrawn(app, timeout: 15), "the end of the latest reply is drawn")

        let scrollView = app.scrollViews["Chat transcript"].firstMatch
        for _ in 0..<12 { scrollView.swipeDown() }
        XCTAssertFalse(latestEndDrawn(app), "the reader scrolled up into the history")

        // History rows below the reader can finish rendering after they pass,
        // so the way back may be longer than the way up.
        var swipes = 0
        while !latestEndDrawn(app), swipes < 40 {
            scrollView.swipeUp()
            swipes += 1
        }
        XCTAssertTrue(latestEndDrawn(app), "scrolling back down reaches the end of the latest reply")
        assertLatestEndStaysDrawn(app, "the latest reply stays readable once the reader reaches it")

        // The keyboard resizes the transcript. A history row the reader passed
        // on the way down must not become the place it returns to.
        let composer = app.textFields["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        assertLatestEndStaysDrawn(app, "focusing the composer keeps the latest reply in view")
    }

    /// The jump control lands on the end of the newest reply from deep in
    /// re-measured history, and the reply stays there (#6090).
    @MainActor
    func testJumpToLatestFromRichHistoryStaysOnLatestReply() {
        let app = launchRichHistory()
        XCTAssertTrue(waitForLatestEndDrawn(app, timeout: 15), "the end of the latest reply is drawn")

        let scrollView = app.scrollViews["Chat transcript"].firstMatch
        for _ in 0..<12 { scrollView.swipeDown() }
        XCTAssertFalse(latestEndDrawn(app), "the reader scrolled up into the history")

        let jump = app.buttons["Scroll to latest"].firstMatch
        XCTAssertTrue(jump.waitForExistence(timeout: 5), "jump control appears in the history")
        jump.tap()
        XCTAssertTrue(waitForLatestEndDrawn(app, timeout: 8), "the jump lands on the end of the latest reply")
        assertLatestEndStaysDrawn(app, "the latest reply stays readable after the jump")
    }
}
