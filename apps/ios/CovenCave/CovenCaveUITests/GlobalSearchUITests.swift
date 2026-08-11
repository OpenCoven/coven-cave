import XCTest

final class GlobalSearchUITests: XCTestCase {

    @MainActor
    func testProjectResultTransitionsFromSearchToProjectDetail() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-tab", "tasks",
            "--ui-open-search",
            "--ui-search-query", "Coven Cave",
        ]
        app.launch()

        let projectResult = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Coven Cave,")
        ).firstMatch
        XCTAssertTrue(projectResult.waitForExistence(timeout: 10),
                      "global search finds the loaded project")
        projectResult.tap()

        XCTAssertTrue(app.navigationBars["Coven Cave"].waitForExistence(timeout: 10),
                      "choosing a project replaces search with project detail")
        XCTAssertTrue(app.staticTexts["cold-launch bug"].exists,
                      "the project detail contains its loaded task")
    }

    @MainActor
    func testDrawerSearchRoutesATaskResultToItsDetail() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-tab", "tasks"]
        app.launch()

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "a primary destination exposes the navigation drawer")
        openNavigation.tap()

        let openSearch = app.buttons["Search everything"]
        XCTAssertTrue(openSearch.waitForExistence(timeout: 5),
                      "the drawer exposes app-wide search")
        openSearch.tap()

        let search = app.searchFields["Search everything…"]
        XCTAssertTrue(search.waitForExistence(timeout: 10),
                      "global search presents its canonical field")
        search.tap()
        search.typeText("cold-launch")

        let taskResult = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", "cold-launch bug")
        ).firstMatch
        XCTAssertTrue(taskResult.waitForExistence(timeout: 5),
                      "search finds a loaded task by title")
        taskResult.tap()

        XCTAssertTrue(app.navigationBars["Task"].waitForExistence(timeout: 10),
                      "choosing a task routes to task detail")
        XCTAssertTrue(app.staticTexts["cold-launch bug"].exists,
                      "the selected task is the result that opened")
    }

    @MainActor
    func testSearchMaterializesAndOpensAServerOnlyConversation() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-open-search",
            "--ui-search-query", "desktop handoff",
        ]
        app.launch()

        let result = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", "Desktop handoff")
        ).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10),
                      "global search includes an eligible server-only conversation")
        result.tap()

        XCTAssertTrue(app.navigationBars["Desktop handoff"].waitForExistence(timeout: 10),
                      "choosing the result materializes and opens the server conversation")
    }
}
