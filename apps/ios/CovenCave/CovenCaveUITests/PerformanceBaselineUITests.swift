import XCTest

final class PerformanceBaselineUITests: XCTestCase {
    @MainActor
    func testRepeatedDrawerOpen() {
        let app = launchFixture()
        XCTAssertTrue(app.buttons["Open navigation"].waitForExistence(timeout: 20))

        for _ in 0..<5 {
            let projectContext = openDrawer(in: app)
            app.buttons["Chats"].tap()
            XCTAssertTrue(projectContext.waitForNonExistence(timeout: 5))
        }
    }

    @MainActor
    func testRepeatedProjectSwitch() {
        let app = launchFixture()
        XCTAssertTrue(app.buttons["Open navigation"].waitForExistence(timeout: 20))
        for index in 0..<5 {
            let projectContext = openDrawer(in: app)
            projectContext.tap()

            let targetIndex = index.isMultiple(of: 2) ? 1 : 0
            let project = app.descendants(matching: .any)[
                String(format: "Project row project:performance-fixture-project-%04d", targetIndex)
            ].firstMatch
            XCTAssertTrue(project.waitForExistence(timeout: 10))
            project.tap()
            XCTAssertTrue(app.navigationBars["Switch project"].waitForNonExistence(timeout: 10))
            let selectedContext = openDrawer(in: app)
            let selectedProject = NSPredicate(
                format: "value == %@", "Fixture Project \(targetIndex + 1)"
            )
            XCTAssertEqual(
                XCTWaiter.wait(for: [XCTNSPredicateExpectation(
                    predicate: selectedProject, object: selectedContext
                )], timeout: 10),
                .completed,
                "Every measured selection must activate the requested project"
            )
        }
    }

    @MainActor
    func testRepeatedSearchQuery() {
        let app = launchFixture()
        XCTAssertTrue(app.buttons["Open navigation"].waitForExistence(timeout: 20))
        _ = openDrawer(in: app)
        let openSearch = app.buttons["Search everything"]
        XCTAssertTrue(openSearch.waitForExistence(timeout: 5))
        openSearch.tap()

        let search = app.searchFields["Search everything…"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        let scope = app.segmentedControls["Global search scope"]
        XCTAssertTrue(scope.waitForExistence(timeout: 10))
        scope.buttons["Everywhere"].tap()

        for index in 1...5 {
            search.tap()
            if index > 1 {
                let clearText = app.buttons["Clear text"]
                XCTAssertTrue(clearText.waitForExistence(timeout: 5))
                clearText.tap()
            }
            let query = "Fixture chat \(index + 1)"
            search.typeText(query)

            let expectedResult = app.buttons[
                String(format: "Global search chat performance-fixture-chat-%04d", index)
            ]
            XCTAssertTrue(expectedResult.waitForExistence(timeout: 10))
            let settledMarker = app.descendants(matching: .any)[
                "Performance search settled \(query.lowercased())"
            ].firstMatch
            XCTAssertTrue(settledMarker.waitForExistence(timeout: 10))
        }
    }

    @MainActor
    func testRepeatedFirstRichRender() {
        waitForCaptureAttachment()
        let app = XCUIApplication()
        app.launchArguments = ["--performance-instrumentation", "--performance-fixture"]
        app.launch()
        for index in 0..<5 {
            XCTAssertTrue(app.navigationBars["Rich streaming fixture"].waitForExistence(timeout: 20))
            let heading = app.webViews.staticTexts["Performance Fixture"].firstMatch
            XCTAssertTrue(heading.waitForExistence(timeout: 20),
                          "the fixture must produce real rich-rendered content")
            if index < 4 {
                _ = openDrawer(in: app)
                app.buttons["Profile and settings"].tap()
                XCTAssertTrue(app.buttons["Open navigation"].waitForExistence(timeout: 10))
                _ = openDrawer(in: app)
                app.buttons["Chats"].tap()
            }
        }
    }

    @MainActor
    private func launchFixture() -> XCUIApplication {
        waitForCaptureAttachment()
        let app = XCUIApplication()
        app.launchArguments = [
            "--performance-instrumentation",
            "--performance-fixture",
            "--performance-fixture-start-tasks",
        ]
        app.launch()
        return app
    }

    /// Test-only attachment window: start Instruments after the UI runner is
    /// installed, but before the fixture app emits its first-use signposts.
    private func waitForCaptureAttachment() {
        guard let raw = ProcessInfo.processInfo.environment["CAVE_PERFORMANCE_CAPTURE_DELAY_SECONDS"],
              let delay = TimeInterval(raw), delay.isFinite, delay > 0, delay <= 60 else { return }
        NSLog("PERFORMANCE_CAPTURE_READY: waiting %.0f seconds before fixture launch", delay)
        Thread.sleep(forTimeInterval: delay)
    }

    @MainActor
    private func openDrawer(in app: XCUIApplication) -> XCUIElement {
        let projectContext = app.buttons["Project context button"]
        if projectContext.isHittable {
            return projectContext
        }

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(waitForHittable(openNavigation, timeout: 5))
        openNavigation.tap()
        XCTAssertTrue(waitForHittable(projectContext, timeout: 5))
        return projectContext
    }

    @MainActor
    private func waitForHittable(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND hittable == true"),
            object: element
        )
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }
}
