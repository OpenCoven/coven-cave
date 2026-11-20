import XCTest

/// The moment after send (#5933): the reader's own message is on screen once
/// the send settles, in an empty chat and in a long one, and a programmatic
/// scroll never raises the floating day chip. `--ui-preview-chat-send` gives
/// the preview chat an in-process transport that accepts the send and holds
/// the reply open, so the turn stays pending and nothing leaves the process.
final class ChatSendVisibilityUITests: XCTestCase {
    private let topMarker = "Top scroll marker p7h8u"
    private let latestLink = "Scroll fixture link"

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

    @MainActor
    func testFirstSendInAnEmptyChatShowsTheSentMessage() {
        let app = launch("--ui-preview-empty-chat", thread: "ui-preview-empty-chat")
        XCTAssertTrue(app.staticTexts["Start a chat"].waitForExistence(timeout: 15))

        let text = "Empty chat send marker k3v9"
        send(text, in: app)
        assertNoDayChip(in: app, during: 3, "the send-time scroll must not raise the day chip")
        assertSentMessageVisible(text, in: app, screenshot: "empty-chat-after-send")
    }

    @MainActor
    func testSendFromOlderContentRevealsTheSentMessage() {
        let app = launch("--ui-preview-long-chat-scroll", thread: "ui-preview-long-chat-scroll")
        XCTAssertTrue(app.navigationBars["Long Scroll Chat"].waitForExistence(timeout: 15))
        waitForLatestReply(in: app)
        scrollToTop(in: app)

        let text = "Older content send marker r8w2"
        send(text, in: app)
        assertNoDayChip(in: app, during: 3, "the send-time scroll must not raise the day chip")
        assertSentMessageVisible(text, in: app, screenshot: "long-chat-send-from-history")
    }

    @MainActor
    func testSendWhileFollowingLatestKeepsTheMessageVisible() {
        let app = launch("--ui-preview-long-chat-scroll", thread: "ui-preview-long-chat-scroll")
        XCTAssertTrue(app.navigationBars["Long Scroll Chat"].waitForExistence(timeout: 15))
        waitForLatestReply(in: app)
        scrollToTop(in: app)

        let jump = app.buttons["Scroll to latest"].firstMatch
        XCTAssertTrue(jump.waitForExistence(timeout: 5))
        jump.tap()
        assertNoDayChip(in: app, during: 3, "jumping to latest is not reading by day")
        waitForLatestReply(in: app)

        let text = "Following send marker m5t1"
        send(text, in: app)
        assertNoDayChip(in: app, during: 3, "the send-time scroll must not raise the day chip")
        assertSentMessageVisible(text, in: app, screenshot: "long-chat-send-following")
    }

    // MARK: - Helpers

    private func launch(_ fixture: String, thread: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        _ = app.wait(for: .notRunning, timeout: 5)
        app.launchArguments = [fixture, "--ui-preview-chat-send"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = thread
        app.launch()
        return app
    }

    private func send(_ text: String, in app: XCUIApplication) {
        let composer = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "the composer is available")
        composer.tap()
        composer.typeText(text)
        let send = app.buttons["Send"].firstMatch
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: send)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 10), .completed, "the send button enables")
        send.tap()
        // The first turn on a fresh simulator asks for notifications; that
        // system alert would cover the transcript.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let prompt = springboard.alerts.matching(NSPredicate(format: "label CONTAINS %@", "Notifications")).firstMatch
        if prompt.waitForExistence(timeout: 3) {
            prompt.buttons.matching(NSPredicate(format: "label IN %@", ["Don’t Allow", "Don't Allow"]))
                .firstMatch.tap()
        }
    }

    private func dayChip(in app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Viewing ")).firstMatch
    }

    /// Fails if the floating day chip shows at any point in the window.
    private func assertNoDayChip(in app: XCUIApplication, during seconds: TimeInterval, _ message: String) {
        let appeared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"),
                                                 object: dayChip(in: app))
        let result = XCTWaiter.wait(for: [appeared], timeout: seconds)
        if result != .timedOut { attach(app, name: "Unexpected day chip") }
        XCTAssertEqual(result, .timedOut, message)
    }

    private func assertSentMessageVisible(_ text: String, in app: XCUIApplication, screenshot name: String) {
        let transcript = app.scrollViews["Chat transcript"].firstMatch
        let sent = transcript.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"),
                                                object: sent)
        let result = XCTWaiter.wait(for: [visible], timeout: 8)
        attach(app, name: name)
        if result != .completed {
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "\(name) hierarchy"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
        }
        XCTAssertEqual(result, .completed, "the message just sent is on screen once the send settles")
        // Settled, not a transient pass: it is still there after layout and
        // the pending reply have had time to move things.
        let movedAway = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == false"), object: sent)
        XCTAssertEqual(XCTWaiter.wait(for: [movedAway], timeout: 2), .timedOut,
                       "the sent message stays on screen")
        XCTAssertFalse(dayChip(in: app).exists, "no day chip once scrolling is idle")
    }

    private func waitForLatestReply(in app: XCUIApplication) {
        let link = app.links[latestLink].firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 15), "the latest reply rendered")
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: link)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 15), .completed, "the latest reply is on screen")
    }

    private func scrollToTop(in app: XCUIApplication) {
        let scrollView = app.scrollViews["Chat transcript"].firstMatch
        XCTAssertTrue(scrollView.waitForExistence(timeout: 5))
        let top = app.staticTexts[topMarker].firstMatch
        for _ in 0..<30 {
            scrollView.swipeDown()
            if top.exists && top.isHittable { break }
        }
        XCTAssertTrue(top.isHittable, "the reader reached the oldest message")
        // Let the reader's own scroll settle and its day chip fade first.
        let chipGone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
                                                 object: dayChip(in: app))
        _ = XCTWaiter.wait(for: [chipGone], timeout: 4)
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
