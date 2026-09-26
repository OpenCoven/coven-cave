import XCTest

/// The same driver runs smoke checks and repeated physical captures.
/// Its wall-clock test duration is not a performance measurement; use app spans.
final class PerformanceBaselineUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testCurrentShellWarmJourneys() {
        let app = launchFixture()
        defer { if !attachesToRunningApp { app.terminate() } }
        runCycle(in: app, phase: "priming-exclude", index: 0)
        for index in 1...repetitions {
            runCycle(in: app, phase: "warm", index: index)
        }
    }

    @MainActor
    func testCurrentShellColdJourneys() {
        guard !attachesToRunningApp || repetitions == 1 else {
            XCTFail("Attached cold capture requires one cycle; launch a fresh process and trace for each repetition")
            return
        }
        for index in 1...repetitions {
            let app = launchFixture()
            runCycle(in: app, phase: "cold-app-launch", index: index)
            if !attachesToRunningApp { app.terminate() }
        }
    }

    private var attachesToRunningApp: Bool {
        ProcessInfo.processInfo.environment["CAVE_PERFORMANCE_ATTACH_RUNNING"] == "1"
    }

    @MainActor
    private func runCycle(in app: XCUIApplication, phase: String, index: Int) {
        XCTContext.runActivity(named: "\(phase) cycle \(index)") { activity in
            let start = Date().timeIntervalSince1970
            exerciseCurrentShell(in: app)
            let end = Date().timeIntervalSince1970
            // These UTC bounds select app spans in the trace; they are not
            // interaction durations. Keep the priming window out of warm data.
            let attachment = XCTAttachment(string:
                "{\"phase\":\"\(phase)\",\"cycle\":\(index),\"startUnixSeconds\":\(start),\"endUnixSeconds\":\(end)}")
            attachment.name = "performance-cycle-\(phase)-\(index).json"
            attachment.lifetime = .keepAlways
            activity.add(attachment)
        }
    }

    private var repetitions: Int {
        let raw = ProcessInfo.processInfo.environment["CAVE_PERFORMANCE_REPETITIONS"] ?? "1"
        return min(100, max(1, Int(raw) ?? 1))
    }

    @MainActor
    private func launchFixture() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--performance-instrumentation", "--performance-fixture"]
        if attachesToRunningApp {
            XCTAssertTrue(app.state == .runningForeground || app.state == .runningBackground,
                          "Instruments must launch the fixture before the capture driver attaches")
            app.activate()
        } else {
            app.launch()
        }
        XCTAssertTrue(app.buttons["Open navigation"].waitForExistence(timeout: 30))
        return app
    }

    @MainActor
    private func exerciseCurrentShell(in app: XCUIApplication) {
        openDrawer(in: app)
        let richThread = app.buttons["Rich streaming fixture"]
        XCTAssertTrue(richThread.waitForExistence(timeout: 10))
        richThread.tap()
        XCTAssertTrue(app.navigationBars["Rich streaming fixture"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.staticTexts["Performance Fixture"].firstMatch.waitForExistence(timeout: 30),
                      "The workload must reach actual WebKit content")

        openDrawer(in: app)
        app.buttons["Profile and settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        openDrawer(in: app)
        app.buttons["Chats"].tap()
        XCTAssertTrue(app.navigationBars["Rich streaming fixture"].waitForExistence(timeout: 10))

        openDrawer(in: app)
        app.buttons["Search chats"].tap()
        let search = app.textFields["Search chats…"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        waitForDestination(in: app)
        // The field keeps the previous cycle's query, and its Clear control
        // only appears once it is focused. Focus first, clear, and delete any
        // text still left, or the new query is appended to the old one and
        // matches nothing ("Fixture chat 999  Fixture ch…").
        search.tap()
        let clear = app.buttons["Clear search"]
        if clear.waitForExistence(timeout: 1) { clear.tap() }
        if let leftover = search.value as? String, !leftover.isEmpty, leftover != search.placeholderValue {
            search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: leftover.count))
        }
        search.typeText("Fixture chat 999")
        let result = app.descendants(matching: .any)[
            "Chat row local:performance-fixture-chat-0998"
        ].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10), "Search must publish the requested result")
        result.tap()
        XCTAssertTrue(app.navigationBars["Fixture chat 999"].waitForExistence(timeout: 10))
        // Leaving the rich thread makes the next cycle mount a new renderer;
        // Settings alone intentionally retains Chats and cannot test remounting.
    }

    @MainActor
    private func waitForDestination(in app: XCUIApplication) {
        let navigation = app.navigationBars.containing(.button, identifier: "Open navigation").firstMatch
        let listOptions = app.buttons["Chat list options"]
        let window = app.windows.firstMatch.frame
        XCTAssertFalse(window.isEmpty)
        let presented = NSPredicate { _, _ in
            if navigation.exists {
                let frame = navigation.frame
                if !frame.isEmpty && abs(frame.minX - window.minX) < 1
                    && abs(frame.maxX - window.maxX) < 1 { return true }
            }
            // ChatsHomeView hides its native bar and has a custom header
            // with a 14-point trailing inset around this 44-point control.
            if listOptions.exists {
                let frame = listOptions.frame
                return !frame.isEmpty && window.contains(frame)
                    && abs(frame.maxX - (window.maxX - 14)) < 1
            }
            return false
        }
        // A closing drawer moves the destination and its tap coordinates.
        // Capturing coordinates mid-transition can activate a different control.
        let ready = XCTNSPredicateExpectation(predicate: presented, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed,
                       "The portrait destination must return to its final position before tapping")
    }

    @MainActor
    private func openDrawer(in app: XCUIApplication) {
        waitForDestination(in: app)
        // Chats, a conversation, Tasks and Settings each carry an "Open
        // navigation" control, and more than one can be in the tree at once
        // (a mounted but covered view). Tap the one the user can reach; the
        // first match may be hidden, which leaves the drawer closed.
        let candidates = app.buttons.matching(NSPredicate(format: "label == %@", "Open navigation"))
        XCTAssertTrue(candidates.firstMatch.waitForExistence(timeout: 10))
        let open = candidates.allElementsBoundByIndex.first(where: \.isHittable) ?? candidates.firstMatch
        open.tap()
        let settings = app.buttons["Profile and settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        // Existence alone includes a sliding panel. Tapping its moving AX frame
        // can hit the scrim instead of the requested destination.
        // XCUIApplication is an accessibility container, not the screen bounds.
        let windowFrame = app.windows.firstMatch.frame
        XCTAssertFalse(windowFrame.isEmpty)
        // Match NavigationDrawer's panel width and trailing footer inset.
        // One snapshot can establish arrival; successive-snapshot predicates
        // trigger costly XCTest failure diagnostics between observations.
        let drawerWidth = min(max(windowFrame.width * 0.70, 260), 304)
        let expectedTrailingEdge = windowFrame.minX + drawerWidth - 12
        var lastFrame: CGRect?
        let settled = NSPredicate { _, _ in
            let frame = settings.frame
            lastFrame = frame
            return !frame.isEmpty && windowFrame.contains(frame)
                && abs(frame.maxX - expectedTrailingEdge) < 1
        }
        let ready = XCTNSPredicateExpectation(predicate: settled, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed,
                       "The drawer control must reach its visible position; last frame: \(String(describing: lastFrame))")
    }
}
