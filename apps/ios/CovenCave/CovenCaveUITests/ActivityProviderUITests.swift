import XCTest

/// Explicit real-provider gate. Only connection/project state is seeded; both
/// the composer response and the relaunched transcript are ordinary app state.
final class ActivityProviderUITests: XCTestCase {
    @MainActor
    func testRealProviderSendIdentityOutputAndRelaunch() async throws {
        continueAfterFailure = false
        guard let raw = ProcessInfo.processInfo.environment["CAVE_NATIVE_ACTIVITY_UI_FIXTURE"] else {
            throw XCTSkip("Run the explicit runtime-activity-canary native mode")
        }
        let config = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: String])
        guard config["mode"] == "provider-canary" else {
            throw XCTSkip("This test requires the real-provider configuration")
        }
        let marker = try XCTUnwrap(config["marker"])
        let harness = try XCTUnwrap(config["harness"])
        let version = try XCTUnwrap(config["expectedVersion"])
        let model = try XCTUnwrap(config["expectedModel"])
        let app = XCUIApplication()
        app.launchArguments = ["--ui-native-activity-recovery", "--ui-native-activity-new-thread"]
        app.launchEnvironment["CAVE_NATIVE_ACTIVITY_UI_FIXTURE"] = raw
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "native-activity-recovery"
        app.launch()
        defer { app.terminate() }
        guard app.navigationBars["Native recovery"].waitForExistence(timeout: 20) else {
            XCTFail("The isolated native provider chat did not open")
            return
        }
        let composer = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 20))
        composer.tap()
        composer.typeText(try XCTUnwrap(config["prompt"]))
        let send = app.buttons["Send"]
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: send)], timeout: 20)
        send.tap()
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let notificationPrompt = system.alerts.matching(NSPredicate(format: "label CONTAINS %@", "Notifications")).firstMatch
        if notificationPrompt.waitForExistence(timeout: 3) {
            notificationPrompt.buttons.matching(NSPredicate(format: "label IN %@", ["Don’t Allow", "Don't Allow"])).firstMatch.tap()
        }
        let identity = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@",
            "Runtime: \(harness) \(version)", "Runtime-reported model: \(model)")).firstMatch
        let tool = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Tool activity:", "Succeeded")).firstMatch
        guard identity.waitForExistence(timeout: 120), tool.waitForExistence(timeout: 20) else {
            XCTFail("The actual provider did not report the expected identity and a successful tool")
            return
        }
        XCTAssertTrue(identity.label.contains("Tool details: supported on this path"))
        XCTAssertFalse(system.alerts.firstMatch.exists)
        attachScreenshot("native-provider-live")
        try await checkOutput(app, tool: tool, marker: marker)

        XCUIDevice.shared.press(.home)
        try await control(config, action: "snapshot")
        app.terminate()
        app.launchArguments = ["--ui-native-activity-recovery"]
        app.launch()
        XCTAssertTrue(identity.waitForExistence(timeout: 20))
        XCTAssertTrue(tool.waitForExistence(timeout: 20))
        attachScreenshot("native-provider-hydrated")
        try await checkOutput(app, tool: tool, marker: marker)
        XCUIDevice.shared.press(.home)
        try await control(config, action: "complete")
    }

    @MainActor
    private func checkOutput(_ app: XCUIApplication, tool: XCUIElement, marker: String) async throws {
        tool.tap()
        let output = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Show output for ")).firstMatch
        XCTAssertTrue(output.waitForExistence(timeout: 5))
        output.tap()
        XCTAssertTrue(app.buttons["Close tool output"].waitForExistence(timeout: 5))
        let saved = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 20))
        XCTAssertTrue(saved.isHittable)
        attachScreenshot("native-provider-output")
        app.buttons["Close tool output"].tap()
    }

    private func control(_ config: [String: String], action: String) async throws {
        let origin = try XCTUnwrap(config["controlURL"])
        var request = URLRequest(url: try XCTUnwrap(URL(string: "\(origin)/\(action)")))
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 204)
    }

    @MainActor
    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
