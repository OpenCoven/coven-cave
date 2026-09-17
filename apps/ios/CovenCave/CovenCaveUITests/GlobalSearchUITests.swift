import XCTest

final class GlobalSearchUITests: XCTestCase {

    @MainActor
    func testProjectResultSwitchesContextWithoutLeavingCurrentDestination() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-tab", "tasks",
            "--ui-open-search",
            "--ui-search-query", "Design Library",
        ]
        app.launch()

        toggleEverywhere(in: app)

        let projectResult = app.buttons["Global search project design-library"]
        XCTAssertTrue(projectResult.waitForExistence(timeout: 10),
                      "global search finds the loaded project")
        projectResult.tap()

        XCTAssertTrue(app.navigationBars["Tasks"].waitForExistence(timeout: 10),
                      "choosing a project keeps the current destination mounted")

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10))
        openNavigation.tap()

        let projectContext = app.buttons["Project context button"]
        XCTAssertTrue(projectContext.waitForExistence(timeout: 5),
                      "the switched context is reflected in shared app chrome")
        XCTAssertEqual(projectContext.value as? String, "Design Library")
    }

    @MainActor
    func testDrawerSearchRoutesATaskResultToItsDetail() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-tab", "tasks"]
        app.launch()

        openSearchFromDrawer(in: app)
        enterSearchQuery("cold-launch", in: app)

        let taskResult = app.buttons["Global search task cold-launch"]
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

        let result = app.buttons["Global search session ui-preview-server-only"]
        XCTAssertTrue(result.waitForExistence(timeout: 10),
                      "global search includes an eligible server-only conversation")
        result.tap()

        XCTAssertTrue(app.navigationBars["Desktop handoff"].waitForExistence(timeout: 10),
                      "choosing the result materializes and opens the server conversation")
    }

    @MainActor
    func testSearchFindsALocallyRenamedBoundChatByAuthoritativeServerTitle() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-open-search",
            "--ui-search-query", "authoritative desktop handoff",
        ]
        app.launch()

        let localResult = app.buttons["Global search chat ui-preview-renamed-local-chat"]
        XCTAssertTrue(localResult.waitForExistence(timeout: 10),
                      "bound local chats should match authoritative server titles")
        XCTAssertFalse(
            app.buttons["Global search session ui-preview-bound-rename"].waitForExistence(timeout: 1),
            "a bound server session should not appear as a duplicate result"
        )

        localResult.tap()

        XCTAssertTrue(app.navigationBars["Renamed local chat"].waitForExistence(timeout: 10),
                      "the local thread remains the open target for the combined result")
    }

    @MainActor
    func testProjectScopeHidesCrossProjectResultsUntilEverywhereSelected() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-open-search",
            "--ui-search-query", "scope anchor",
        ]
        app.launch()

        XCTAssertTrue(
            app.buttons["Global search task scope-anchor-current"].waitForExistence(timeout: 10),
            "project scope keeps current-project results visible"
        )
        XCTAssertFalse(
            app.buttons["Global search task scope-anchor-design"].waitForExistence(timeout: 1),
            "project scope hides other project tasks by default"
        )
        XCTAssertFalse(
            app.buttons["Global search task scope-anchor-unassigned"].waitForExistence(timeout: 1),
            "project scope hides unassigned artifacts while a registered project is active"
        )

        toggleEverywhere(in: app)

        XCTAssertTrue(
            app.buttons["Global search task scope-anchor-design"].waitForExistence(timeout: 10),
            "Everywhere reveals other project tasks"
        )
        XCTAssertTrue(
            app.buttons["Global search task scope-anchor-unassigned"].waitForExistence(timeout: 10),
            "Everywhere also reveals unassigned artifacts"
        )
    }

    @MainActor
    func testCrossProjectFamiliarResultAutoSwitchesContext() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-open-search",
            "--ui-search-query", "Lyra",
        ]
        app.launch()

        toggleEverywhere(in: app)

        let familiarResult = app.buttons["Global search familiar lyra"]
        XCTAssertTrue(familiarResult.waitForExistence(timeout: 10),
                      "Everywhere search reveals the cross-project familiar")
        familiarResult.tap()

        XCTAssertTrue(app.navigationBars["Lyra design review"].waitForExistence(timeout: 10),
                      "opening the familiar resolves to its existing cross-project chat")

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10))
        openNavigation.tap()

        let projectContext = app.buttons["Project context button"]
        XCTAssertTrue(projectContext.waitForExistence(timeout: 5))
        XCTAssertEqual(projectContext.value as? String, "Design Library")
    }

    @MainActor
    func testUnassignedProjectScopeShowsOnlyUnassignedArtifacts() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-preview-search-unassigned",
            "--ui-open-search",
            "--ui-search-query", "scope anchor",
        ]
        app.launch()

        XCTAssertTrue(
            app.buttons["Global search task scope-anchor-unassigned"].waitForExistence(timeout: 10),
            "Unassigned project scope keeps unassigned artifacts searchable"
        )
        XCTAssertFalse(
            app.buttons["Global search task scope-anchor-current"].waitForExistence(timeout: 1),
            "Unassigned scope excludes registered project tasks"
        )
        XCTAssertFalse(
            app.buttons["Global search task scope-anchor-design"].waitForExistence(timeout: 1),
            "Unassigned scope excludes other registered project tasks"
        )
    }

    @MainActor
    func testUnknownProjectTaskResultOpensInUnassignedTaskDetail() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-tab", "tasks",
            "--ui-open-search",
            "--ui-search-query", "scope anchor unassigned",
        ]
        app.launch()

        toggleEverywhere(in: app)

        let taskResult = app.buttons["Global search task scope-anchor-unassigned"]
        XCTAssertTrue(taskResult.waitForExistence(timeout: 10),
                      "Everywhere search should reveal deleted or unknown-project recovery tasks")
        taskResult.tap()

        let taskDetail = app.navigationBars["Task"]
        XCTAssertTrue(taskDetail.waitForExistence(timeout: 10),
                      "tapping the result opens Task detail instead of rejecting the task")
        XCTAssertTrue(app.staticTexts["scope anchor unassigned"].waitForExistence(timeout: 5),
                      "the opened detail matches the recovery task result")
        taskDetail.swipeDown()

        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10))
        openNavigation.tap()

        let projectContext = app.buttons["Project context button"]
        XCTAssertTrue(projectContext.waitForExistence(timeout: 5))
        XCTAssertEqual(projectContext.value as? String, "Unassigned")
    }

    @MainActor
    func testClosingAndReopeningSearchResetsScopeToProject() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-preview-design-closeout",
            "--ui-open-search",
            "--ui-search-query", "scope anchor",
        ]
        app.launch()

        toggleEverywhere(in: app)
        XCTAssertTrue(
            app.buttons["Global search task scope-anchor-design"].waitForExistence(timeout: 10),
            "Everywhere exposes cross-project results before close"
        )

        app.buttons["Close"].tap()
        openSearchFromDrawer(in: app)

        XCTAssertTrue(
            app.buttons["Global search task scope-anchor-current"].waitForExistence(timeout: 10),
            "reopened search returns to current-project results"
        )
        XCTAssertFalse(
            app.buttons["Global search task scope-anchor-design"].waitForExistence(timeout: 1),
            "closing and reopening resets search scope back to Project"
        )
    }

    @MainActor
    private func openSearchFromDrawer(in app: XCUIApplication) {
        let openNavigation = app.buttons["Open navigation"]
        XCTAssertTrue(openNavigation.waitForExistence(timeout: 10),
                      "a primary destination exposes the navigation drawer")
        openNavigation.tap()

        let openSearch = app.buttons["Search everything"]
        XCTAssertTrue(openSearch.waitForExistence(timeout: 5),
                      "the drawer exposes app-wide search")
        openSearch.tap()

        XCTAssertTrue(app.searchFields["Search everything…"].waitForExistence(timeout: 10),
                      "global search presents its canonical field")
    }

    @MainActor
    private func enterSearchQuery(_ query: String, in app: XCUIApplication) {
        let search = app.searchFields["Search everything…"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText(query)
    }

    @MainActor
    private func toggleEverywhere(in app: XCUIApplication) {
        let scope = app.segmentedControls["Global search scope"]
        XCTAssertTrue(scope.waitForExistence(timeout: 10),
                      "global search exposes the scope picker")
        scope.buttons["Everywhere"].tap()
    }
}
