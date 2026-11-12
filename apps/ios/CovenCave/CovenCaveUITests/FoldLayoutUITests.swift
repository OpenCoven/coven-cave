import XCTest

/// iPhone Duo fold layouts (#6193). Neither `simctl` nor XCTest can fold the
/// iPhone Duo simulator, so `--ui-simulate-fold` (DEBUG builds) reports an
/// active hinge across the middle of the window's long side — the shape the
/// device reports. A wide window folds like a book; a tall one into tabletop.
/// These assert which side of that line content lands on, on any simulator.
final class FoldLayoutUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
    }

    @MainActor
    func testBookFoldKeepsConversationPastTheHinge() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-empty-chat", "--ui-simulate-fold"]
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        app.launch()

        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        try XCTSkipUnless(window.frame.width > window.frame.height,
                          "this simulator ignores rotation, so there is no book pose to check")
        let row = app.descendants(matching: .any)["Chat row local:ui-preview-empty-chat"]
        try XCTSkipUnless(row.waitForExistence(timeout: 10),
                          "a window this narrow stacks the conversation over the list")
        let composer = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "the conversation is open beside the list")

        let hinge = window.frame.midX
        XCTAssertLessThanOrEqual(row.frame.maxX, hinge, "the chat list stays before the hinge")
        XCTAssertGreaterThanOrEqual(composer.frame.minX, hinge, "the whole conversation sits past the hinge")
    }

    @MainActor
    func testTabletopFoldLiftsConnectingStatusIntoUpperPane() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-connecting", "--ui-simulate-fold"]
        app.launch()

        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        try XCTSkipUnless(window.frame.height > window.frame.width,
                          "tabletop needs a tall window")
        let status = app.otherElements["Connecting to your desktop"]
        XCTAssertTrue(status.waitForExistence(timeout: 10), "the connecting screen is up")
        XCTAssertLessThanOrEqual(status.frame.maxY, window.frame.midY,
                                 "nothing to tap here, so it reads from the upper pane")
    }

    @MainActor
    func testUnfoldedConnectingStatusFillsTheScreen() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--ui-preview-connecting"]
        app.launch()

        let window = app.windows.firstMatch
        let status = app.otherElements["Connecting to your desktop"]
        XCTAssertTrue(status.waitForExistence(timeout: 10), "the connecting screen is up")
        XCTAssertGreaterThan(status.frame.maxY, window.frame.midY,
                             "without a fold the status keeps its centred, full-height composition")
    }
}
