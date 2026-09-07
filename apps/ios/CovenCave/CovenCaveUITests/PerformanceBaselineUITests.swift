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
            XCTAssertTrue(app.buttons["Open navigation"].waitForExistence(timeout: 10))
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
    private func launchFixture() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--performance-instrumentation",
            "--performance-fixture",
            "--performance-fixture-start-tasks",
        ]
        app.launch()
        return app
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
