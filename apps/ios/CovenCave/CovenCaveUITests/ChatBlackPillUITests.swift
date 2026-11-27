import XCTest

/// Geometry and state contracts for the native #6331 composer. These run on
/// the real SwiftUI hierarchy; a source pin cannot prove keyboard containment.
final class ChatBlackPillUITests: XCTestCase {
    private var tracePath = ""
    override func setUp() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDown() {
        if let trace = try? String(contentsOfFile: tracePath, encoding: .utf8) {
            print("COMPOSER TRACE \(name)\n\(trace)")
        }
        try? FileManager.default.removeItem(atPath: tracePath)
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }

    @MainActor
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func launchChat(extraArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        // Override only this fixture's initial persisted draft in the launch
        // argument domain. Each test starts empty without erasing app data or
        // changing the production draft-persistence owner.
        app.launchArguments = ["--ui-preview-empty-chat",
                               "-cave.chat.draft.ui-preview-empty-chat", ""] + extraArguments
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "ui-preview-empty-chat"
        tracePath = NSTemporaryDirectory() + "cave6331-composer-\(UUID().uuidString).log"
        app.launchEnvironment["CAVE_SCROLL_TRACE_PATH"] = tracePath
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 5), "the previous fixture process has stopped")
        app.launch()
        XCTAssertTrue(app.buttons["Attach or run a tool"].waitForExistence(timeout: 15))
        return app
    }

    @MainActor
    func testDraftRegionSitsAboveTheReachableActionRow() {
        let app = launchChat()
        let message = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        let attach = app.buttons["Attach or run a tool"]
        let send = app.buttons["Send"]
        XCTAssertTrue(message.exists)
        XCTAssertGreaterThanOrEqual(attach.frame.minY, message.frame.maxY,
                                   "the multiline draft owns a row above attach/model/send")
        for control in [attach, send] {
            XCTAssertGreaterThanOrEqual(control.frame.width, 44)
            XCTAssertGreaterThanOrEqual(control.frame.height, 44)
            XCTAssertTrue(app.windows.firstMatch.frame.contains(control.frame))
        }
        XCTAssertTrue(attach.isHittable)
        XCTAssertTrue(app.buttons["Composer session controls"].exists,
                      "the model/session choice is reachable from the real action row")
        XCTAssertFalse(send.isEnabled, "an empty draft does not gain send authority")
        capture("Black pill empty chat and unfocused composer")
    }

    @MainActor
    func testSuggestionFillsTheDraftWithoutSending() {
        let app = launchChat()
        let suggestion = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Help me explore an idea")).firstMatch
        if !suggestion.isHittable { app.swipeUp() }
        XCTAssertTrue(suggestion.waitForExistence(timeout: 5))
        suggestion.tap()
        let message = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        XCTAssertEqual(message.value as? String, "Help me explore an idea")
        XCTAssertEqual(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "Message bubble ")).count, 0,
                       "a starter fills the existing empty conversation instead of dispatching")
        capture("Suggestion fills the focused draft without sending")
    }

    @MainActor
    func testKeyboardKeepsTheActionRowReachable() throws {
        let app = launchChat()
        let message = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        message.tap()
        message.typeText("Draft stays with this conversation")
        let keyboard = app.keyboards.firstMatch
        try XCTSkipUnless(keyboard.waitForExistence(timeout: 5),
                          "software keyboard unavailable; native keyboard containment remains unverified")
        let clearOfKeyboard = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            ["Attach or run a tool", "Send"].allSatisfy {
                app.buttons[$0].frame.maxY <= keyboard.frame.minY + 1
            }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [clearOfKeyboard], timeout: 5), .completed,
                       "the action row clears the native keyboard after its layout settles")
        capture("Focused composer above the native keyboard")
    }

    @MainActor
    func testLightModeAtLargestTypeKeepsComposerControlsReachable() {
        let app = launchChat(extraArguments: ["-cave.appearance", "light",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        let window = app.windows.firstMatch
        for name in ["Attach or run a tool", "Composer session controls", "Dictate", "Send"] {
            let control = app.buttons[name]
            XCTAssertTrue(control.exists)
            XCTAssertGreaterThanOrEqual(control.frame.width, 44)
            XCTAssertGreaterThanOrEqual(control.frame.height, 44)
            XCTAssertTrue(window.frame.contains(control.frame), "\(name) stays inside the native window")
            if name != "Send" { XCTAssertTrue(control.isHittable) }
        }
        capture("Light appearance at largest accessibility text size")
    }

    @MainActor
    func testLightSelectedConversationPassesNativeContrastAudit() throws {
        let app = launchChat(extraArguments: ["-cave.appearance", "light"])
        let row = app.descendants(matching: .any)["Chat row local:ui-preview-empty-chat"].firstMatch
        try XCTSkipUnless(row.exists && row.isHittable,
                          "selected sidebar contrast requires a visible regular-width native list")
        XCTAssertTrue(row.isSelected, "the visible row carries its actual navigation selection")
        capture("Selected conversation in light appearance before contrast audit")
        let rowFrame = row.frame
        var selectedIssues: [String] = []
        var allIssues: [String] = []
        try app.performAccessibilityAudit(for: .contrast) { issue in
            let description = "\(issue.compactDescription): \(issue.detailedDescription) | \(issue.element?.debugDescription ?? "no element")"
            allIssues.append(description)
            if let element = issue.element, element.frame.intersects(rowFrame) {
                selectedIssues.append(description)
            }
            // This regression scopes the result to the selected conversation.
            // Keep every other finding in the receipt, without claiming a
            // complete screen or human VoiceOver audit.
            return true
        }
        let receipt = XCTAttachment(string: allIssues.joined(separator: "\n\n"))
        receipt.name = "Native contrast audit findings; selected-row scope"
        receipt.lifetime = .keepAlways
        add(receipt)
        XCTAssertTrue(selectedIssues.isEmpty,
                      "selected conversation contrast findings: \(selectedIssues.joined(separator: "; "))")
    }

    @MainActor
    func testLightChatScreenPassesNativeContrastAudit() throws {
        let app = launchChat(extraArguments: ["-cave.appearance", "light", "--ui-preview-second-thread"])
        capture("Full light chat screen before native contrast audit")
        try app.performAccessibilityAudit(for: .contrast)
        app.buttons["Session controls"].tap()
        XCTAssertTrue(app.buttons["Switch session"].waitForExistence(timeout: 5))
        capture("Light chat session controls before native contrast audit")
        try app.performAccessibilityAudit(for: .contrast)
    }

    @MainActor
    func testLongIdentityKeepsHeaderAndModelChoiceUsableAtLargestType() {
        let app = launchChat(extraArguments: ["--ui-preview-long-chat-identity",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        let header = app.buttons["Session controls"]
        XCTAssertTrue(header.isHittable)
        XCTAssertTrue(header.label.contains("Planning the observatory migration and reviewing the complete research archive"))
        XCTAssertTrue(app.windows.firstMatch.frame.contains(header.frame))
        let model = app.buttons["Composer session controls"]
        XCTAssertEqual(model.value as? String, "preview-lab/observatory-research-model-with-an-extended-context-window")
        XCTAssertTrue(model.isHittable)
        capture("Long conversation familiar and model identity at largest type")
        header.tap()
        XCTAssertTrue(app.buttons["Switch session"].waitForExistence(timeout: 5),
                      "the long identity pill still opens its real conversation controls")
        capture("Long identity with real session controls open")
        let detailsHierarchy = XCTAttachment(string: app.debugDescription)
        detailsHierarchy.name = "Largest text session menu hierarchy"
        detailsHierarchy.lifetime = .keepAlways
        add(detailsHierarchy)
        let modelValue = app.staticTexts["preview-lab/observatory-research-model-with-an-extended-context-window"].firstMatch
        let projectTitle = app.staticTexts["Project"].firstMatch
        XCTAssertTrue(modelValue.exists)
        XCTAssertTrue(projectTitle.exists)
        XCTAssertLessThanOrEqual(modelValue.frame.maxY, projectTitle.frame.minY,
                                 "the full model value must not paint over the following row")
        let conversation = app.buttons["Switch session"]
        let archive = app.buttons["Archive chat"]
        XCTAssertFalse(conversation.frame.intersects(archive.frame),
                       "large text must not overlap adjacent session actions")
        for _ in 0..<8 {
            if conversation.isHittable && app.windows.firstMatch.frame.contains(conversation.frame) { break }
            app.swipeUp()
        }
        XCTAssertTrue(app.windows.firstMatch.frame.contains(conversation.frame),
                      "the conversation action must fit or be reachable by scrolling")
        XCTAssertTrue(conversation.isHittable)
        capture("Long identity with reachable conversation action at largest type")
        conversation.tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5),
                      "the largest-text menu can open the real session picker")
        app.buttons["Done"].tap()
    }

    @MainActor
    func testStagedImageAndDraftSurviveSessionSettingsAndRotation() throws {
        let app = launchChat(extraArguments: ["--ui-preview-staged-image"])
        let remove = app.buttons["Remove image"]
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        let message = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        message.tap()
        message.typeText("Keep the staged image with this draft")
        capture("Staged synthetic attachment and focused draft")
        app.buttons["Session controls"].tap()
        app.buttons["Switch session"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        XCTAssertEqual(message.value as? String, "Keep the staged image with this draft")
        app.buttons["Open navigation"].firstMatch.tap()
        app.buttons["Profile and settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        app.buttons["Open navigation"].firstMatch.tap()
        app.buttons["Chats"].tap()
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        XCTAssertEqual(message.value as? String, "Keep the staged image with this draft")
        capture("Staged image after session and Settings round trips")
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.windows.firstMatch.frame.width > app.windows.firstMatch.frame.height
        }, object: nil)
        try XCTSkipUnless(XCTWaiter.wait(for: [landscape], timeout: 5) == .completed,
                          "the simulator ignored rotation; staged-image rotation remains unverified")
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        XCTAssertEqual(message.value as? String, "Keep the staged image with this draft")
        capture("Staged image after session Settings and rotation round trips")
        remove.tap()
        XCTAssertTrue(remove.waitForNonExistence(timeout: 5))
        XCTAssertEqual(message.value as? String, "Keep the staged image with this draft")
    }

    @MainActor
    func testSimulatedBookFoldKeepsTheStagedImageAndComposerPastTheHinge() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launchChat(extraArguments: ["--ui-preview-staged-image", "--ui-simulate-fold"])
        let window = app.windows.firstMatch
        try XCTSkipUnless(window.frame.width > window.frame.height,
                          "this simulator ignores rotation, so book pose remains unverified")
        let list = app.descendants(matching: .any)["Chat row local:ui-preview-empty-chat"].firstMatch
        try XCTSkipUnless(list.waitForExistence(timeout: 5),
                          "the window stacks detail, so a split book pose is unavailable")
        let message = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        let remove = app.buttons["Remove image"]
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(message.frame.minX, window.frame.midX)
        XCTAssertGreaterThanOrEqual(remove.frame.minX, window.frame.midX)
        message.tap()
        message.typeText("Keep the attachment past the hinge")
        XCTAssertTrue(remove.exists)
        XCTAssertEqual(message.value as? String, "Keep the attachment past the hinge")
        XCTAssertGreaterThanOrEqual(app.buttons["Attach or run a tool"].frame.minX, window.frame.midX)
        capture("Synthetic image and focused draft past the simulated book hinge")
    }

    @MainActor
    func testAttachMenuRoundTripPreservesTheDraft() {
        let app = launchChat()
        let message = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        message.tap()
        message.typeText("Keep this draft while choosing an attachment")
        let attach = app.buttons["Attach or run a tool"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard attach.isHittable else { return false }
            let keyboard = app.keyboards.firstMatch
            return !keyboard.exists || attach.frame.maxY <= keyboard.frame.minY + 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed,
                       "the attach target has reached its keyboard-aware position")
        attach.tap()
        XCTAssertTrue(app.buttons["Photos"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Files"].exists)
        capture("Real attachment actions above the floating composer")
        app.buttons["Close attach menu"].firstMatch.tap()
        XCTAssertEqual(message.value as? String, "Keep this draft while choosing an attachment")
        XCTAssertTrue(app.buttons["Attach or run a tool"].isHittable)
    }

    @MainActor
    func testDrawerRoundTripKeepsTheDraftAndControls() {
        let app = launchChat()
        let message = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        message.tap()
        message.typeText("Draft stays with this conversation")
        app.buttons["Open navigation"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Search chats"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Chat with Nyx on Jul 26"].isSelected,
                      "the drawer exposes the real current conversation as selected")
        capture("Readable active drawer with dimmed destination")
        let close = app.buttons["Close menu"]
        print("DRAWER TARGET close=\(close.frame) search=\(app.buttons["Search chats"].frame)")
        XCTAssertGreaterThanOrEqual(close.frame.minX, app.buttons["Search chats"].frame.maxX,
                                   "the accessible dismissal target belongs to the exposed destination")
        close.tap()
        XCTAssertTrue(app.buttons["Close menu"].waitForNonExistence(timeout: 5),
                      "dismissal returns interaction to the conversation")
        XCTAssertFalse(app.buttons["Search chats"].exists)
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertEqual(message.value as? String, "Draft stays with this conversation")
        let controlsReturned = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"),
                                                        object: app.buttons["Attach or run a tool"])
        XCTAssertEqual(XCTWaiter.wait(for: [controlsReturned], timeout: 5), .completed)
        capture("Drawer dismissed with the original draft")
        app.buttons["Open navigation"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Search chats"].waitForExistence(timeout: 5), "the same drawer owner can reopen")
    }
}
