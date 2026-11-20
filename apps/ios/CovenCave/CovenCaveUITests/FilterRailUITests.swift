import XCTest

/// Native geometry and state acceptance for the single filter row and the
/// shared navigation frame (#6482). These exercise the real SwiftUI controls.
final class FilterRailUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    override func tearDown() { XCUIDevice.shared.orientation = .portrait }

    @MainActor
    private func reveal(_ control: XCUIElement, in app: XCUIApplication) {
        let row = app.scrollViews["Chat filters"].firstMatch
        for _ in 0..<6 {
            if control.frame.minX < row.frame.minX { row.swipeRight() }
            else if control.frame.maxX > row.frame.maxX { row.swipeLeft() }
            else { return }
        }
    }

    @MainActor
    private func attach(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testFiltersShareOneRowAndCombineWithoutChangingConversationBinding() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout", "--ui-preview-chats-home"]
        app.launch()
        let status = app.buttons["Status filter menu"].firstMatch
        let project = app.buttons["Project filter menu"].firstMatch
        let familiar = app.buttons["Familiar filter menu"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        XCTAssertEqual(status.frame.midY, project.frame.midY, accuracy: 1)
        XCTAssertEqual(project.frame.midY, familiar.frame.midY, accuracy: 1)
        let archive = app.buttons["Archive filter menu"].firstMatch
        XCTAssertEqual(familiar.frame.midY, archive.frame.midY, accuracy: 1)
        for control in [status, project, familiar, archive] {
            XCTAssertGreaterThanOrEqual(control.frame.height, 44 - 4 * CGFloat(44).ulp)
        }
        reveal(project, in: app)
        project.tap()
        app.buttons["Design Library"].firstMatch.tap()
        reveal(familiar, in: app)
        familiar.tap()
        app.buttons["Lyra"].firstMatch.tap()
        XCTAssertEqual(project.value as? String, "Design Library")
        XCTAssertEqual(familiar.value as? String, "Lyra")
        let lyra = app.descendants(matching: .any)["Chat row local:ui-preview-lyra-chat"].firstMatch
        XCTAssertTrue(lyra.waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["Chat row server:ui-preview-server-only"].exists)
        reveal(archive, in: app)
        archive.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Show archived")).firstMatch.tap()
        XCTAssertEqual(archive.value as? String, "Including archived")
        attach("Combined filters in one row", app: app)
        let clear = app.buttons["Clear chat filters"].firstMatch
        reveal(clear, in: app)
        clear.tap()
        XCTAssertEqual(project.value as? String, "All projects")
        XCTAssertEqual(familiar.value as? String, "All familiars")
        XCTAssertEqual(archive.value as? String, "Archived hidden")
        XCTAssertTrue(app.descendants(matching: .any)["Chat row server:ui-preview-server-only"].waitForExistence(timeout: 5))
        lyra.tap()
        XCTAssertTrue(app.navigationBars["Lyra design review"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testAccessibilityFiltersStayOnOneScrollableRow() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout", "--ui-preview-chats-home", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let status = app.buttons["Status filter menu"].firstMatch
        let project = app.buttons["Project filter menu"].firstMatch
        let familiar = app.buttons["Familiar filter menu"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        XCTAssertEqual(status.frame.midY, project.frame.midY, accuracy: 1)
        XCTAssertEqual(project.frame.midY, familiar.frame.midY, accuracy: 1)
        let archive = app.buttons["Archive filter menu"].firstMatch
        XCTAssertEqual(familiar.frame.midY, archive.frame.midY, accuracy: 1)
        reveal(project, in: app)
        attach("Accessibility project menu before opening", app: app)
        project.tap()
        XCTAssertTrue(app.buttons["Unassigned"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["Design Library"].firstMatch.tap()
        XCTAssertEqual(project.value as? String, "Design Library")
        attach("Accessibility filter row", app: app)
    }

    @MainActor
    func testLandscapeRailKeepsDraftThroughSettingsAndRotation() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        try XCTSkipUnless(window.frame.width > window.frame.height,
                          "This simulator ignored landscape rotation; run this case on a rotating phone or wide window")
        let settings = app.buttons["Navigation rail settings"].firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["Close menu"].firstMatch.exists,
                       "closed drawer chrome must leave the accessibility tree")
        XCTAssertGreaterThanOrEqual(settings.frame.height, 44)
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        composer.typeText("Rail preserves this draft")
        settings.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        XCTAssertTrue(settings.isSelected)
        attach("Landscape Settings rail", app: app)
        app.buttons["Navigation rail chats"].tap()
        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 10))
        XCTAssertTrue((composer.value as? String ?? "").contains("Rail preserves this draft"))
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue((composer.value as? String ?? "").contains("Rail preserves this draft"))
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        XCTAssertTrue((composer.value as? String ?? "").contains("Rail preserves this draft"))
        attach("Landscape chat rail", app: app)
    }

    @MainActor
    func testReaderRailDismissesIntoSettingsAndReturnsToSameChat() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-tool-activity"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        try XCTSkipUnless(window.frame.width > window.frame.height,
                          "This simulator ignored landscape rotation; run this case on a rotating phone or wide window")
        let reader = app.buttons["Open response in reader"].firstMatch
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        reader.tap()
        XCTAssertTrue(app.buttons["Reading options"].waitForExistence(timeout: 10))
        let readerContent = app.descendants(matching: .any)["Response reader content"].firstMatch
        let response = readerContent.descendants(matching: .staticText).matching(NSPredicate(format: "label CONTAINS %@", "Fixed")).firstMatch
        let responseVisible = response.waitForExistence(timeout: 10)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "Reader live hierarchy before navigation"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        attach("Reader content before navigation", app: app)
        XCTAssertTrue(responseVisible, "the reader must render its actual response before navigation acceptance")
        let settings = app.buttons["Navigation rail settings"].firstMatch
        XCTAssertTrue(settings.exists)
        XCTAssertEqual(app.buttons.matching(identifier: "Navigation rail settings").count, 1,
                       "the reader alone exposes navigation; the background rail is hidden")
        attach("Landscape response reader rail", app: app)
        settings.tap()
        XCTAssertTrue(app.buttons["Reading options"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        app.buttons["Navigation rail chats"].tap()
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        reader.tap()
        app.buttons["Done"].tap()
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
    }
    @MainActor
    func testCompactPortraitReaderKeepsDrawerNavigation() {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-tool-activity"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
        app.launch()
        let reader = app.buttons["Open response in reader"].firstMatch
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        reader.tap()
        XCTAssertTrue(app.buttons["Reading options"].waitForExistence(timeout: 10))
        app.buttons["Open navigation"].firstMatch.tap()
        let settings = app.buttons["Profile and settings"].firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Reading options"].exists)
        attach("Compact Settings drawer fallback", app: app)
    }

    @MainActor
    func testStatusMenuRetainsCountsAndFiltersActualRows() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-design-closeout", "--ui-preview-chats-home", "--ui-preview-list-statuses"]
        app.launch()
        let status = app.buttons["Status filter menu"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        status.tap()
        XCTAssertTrue(app.buttons["Needs you, 1"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["Running, 1"].firstMatch.tap()
        XCTAssertEqual(status.value as? String, "Running, 1")
        XCTAssertTrue(app.descendants(matching: .any)["Chat row server:ui-preview-server-only"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["Chat row local:ui-preview-lyra-chat"].exists)
        status.tap()
        app.buttons["Needs you, 1"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["Chat row server:ui-preview-unassigned-session"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["Chat row server:ui-preview-server-only"].exists)
        status.tap()
        app.buttons["All chats"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["Chat row local:ui-preview-lyra-chat"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testReaderRailCanOpenNewChatAfterDismissal() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-tool-activity"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-tool-activity"
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        try XCTSkipUnless(window.frame.width > window.frame.height,
                          "This simulator ignored landscape rotation; run this case on a rotating phone or wide window")
        let reader = app.buttons["Open response in reader"].firstMatch
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        reader.tap()
        XCTAssertTrue(app.buttons["Reading options"].waitForExistence(timeout: 10))
        app.buttons["Navigation rail new chat"].tap()
        XCTAssertTrue(app.navigationBars["New chat"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Reading options"].exists)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
    }

    @MainActor
    func testNewChatRailDismissesFormAndPreservesOriginalDraft() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "-cave.chat.draft.ui-preview-empty-chat", ""]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        try XCTSkipUnless(window.frame.width > window.frame.height, "Landscape window required")
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        composer.typeText("Original chat draft")
        app.buttons["Navigation rail new chat"].tap()
        XCTAssertTrue(app.navigationBars["New chat"].waitForExistence(timeout: 10))
        let settings = app.buttons["Navigation rail settings"].firstMatch
        XCTAssertTrue(settings.exists)
        attach("New chat with shared rail", app: app)
        settings.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.navigationBars["New chat"].exists)
        app.buttons["Navigation rail chats"].tap()
        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 10))
        XCTAssertTrue((composer.value as? String ?? "").contains("Original chat draft"))
    }

    @MainActor
    func testSessionPickerRailRoutesAfterDismissal() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-preview-second-thread"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        try XCTSkipUnless(window.frame.width > window.frame.height, "Landscape window required")
        app.buttons["Session controls"].tap()
        app.buttons["Switch session"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Thread row local-ui-preview-second-chat"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Navigation rail settings"].firstMatch.exists)
        attach("Session picker with shared rail", app: app)
        app.buttons.matching(NSPredicate(format: "label == %@ AND identifier == %@", "New chat", "square.and.pencil")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["New chat"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons.matching(identifier: "Navigation rail settings").count, 1,
                       "only the top nested presentation exposes its rail")
        app.buttons["Navigation rail settings"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        app.buttons["Navigation rail chats"].tap()
        XCTAssertTrue(app.navigationBars["Chat with Nyx on Jul 26"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testPortraitKeyboardRetainsCompactDrawerAndDraft() {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "-cave.chat.draft.ui-preview-empty-chat", ""]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()
        let composer = app.descendants(matching: .any)["Message"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        composer.typeText("Portrait keyboard draft")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertFalse(app.buttons["Navigation rail settings"].exists,
                       "the keyboard must not turn a narrow portrait window into landscape navigation")
        XCTAssertTrue(app.buttons["Open navigation"].firstMatch.exists)
        XCTAssertTrue((composer.value as? String ?? "").contains("Portrait keyboard draft"))
        attach("Portrait keyboard keeps compact navigation", app: app)
    }
}
