import XCTest

/// Verifies the conversation screen hides the bottom tab bar (ChatView's
/// `.toolbar(.hidden, for: .tabBar)`) and that it returns on the way back.
/// Runs as an XCUITest because host-side synthetic taps need macOS
/// Accessibility grants; the runner inside the simulator needs none.
final class ChatTabBarUITests: XCTestCase {

    @MainActor
    func testOpeningAChatHidesTheTabBar() throws {
        let app = XCUIApplication()
        app.launch()

        // The sim is already paired in dev runs; if this launch landed on the
        // Connect screen instead, there is nothing meaningful to assert here.
        let tabBar = app.tabBars.firstMatch
        guard tabBar.waitForExistence(timeout: 60) else {
            throw XCTSkip("App is not paired with a Cave server — no tab bar to test against.")
        }

        // Roster → the familiar's thread list (the tab bar stays here).
        let nova = app.staticTexts["Nova"].firstMatch
        XCTAssertTrue(nova.waitForExistence(timeout: 30), "Chats roster should list the Nova familiar")
        nova.tap()
        XCTAssertTrue(app.navigationBars["Nova"].waitForExistence(timeout: 10),
                      "Nova's thread list should be on screen")
        XCTAssertTrue(tabBar.isHittable, "Tab bar should stay on the thread list")

        // Thread list → the conversation itself.
        let thread = app.cells.firstMatch
        XCTAssertTrue(thread.waitForExistence(timeout: 15), "Nova should have at least one thread")
        thread.tap()
        let composer = app.textFields["Message"].firstMatch
        let composerView = app.textViews["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10) || composerView.waitForExistence(timeout: 5),
                      "Conversation composer should be on screen")

        // The tab bar must be gone — hidden bars can linger in the hierarchy
        // with an offscreen frame, so accept not-exists or not-hittable.
        var hidden = false
        for _ in 0..<20 {
            if !tabBar.exists || !tabBar.isHittable { hidden = true; break }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertTrue(hidden, "Tab bar should hide while a conversation is open")

        // …and it returns on the way back to the thread list.
        let back = app.navigationBars.buttons["BackButton"].firstMatch
        if back.waitForExistence(timeout: 5) {
            back.tap()
        } else {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)))
        }
        var returned = false
        for _ in 0..<20 {
            if tabBar.exists && tabBar.isHittable { returned = true; break }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertTrue(returned, "Tab bar should return after leaving the conversation")
    }
}
