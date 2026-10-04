import XCTest

/// No URLProtocol stubs or injected display data: the app recovers an accepted
/// delivery through its scene lifecycle after the owned server is restored.
final class ActivityRecoveryUITests: XCTestCase {
    @MainActor
    func testRenderedRecoveryRetainsSavedActivityAndOutput() async throws {
        continueAfterFailure = false
        guard let raw = ProcessInfo.processInfo.environment["CAVE_NATIVE_ACTIVITY_UI_FIXTURE"] else {
            throw XCTSkip("Run scripts/runtime-activity-native-transport.mjs for the owned HTTP UI gate")
        }
        let config = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: String])
        let marker = try XCTUnwrap(config["marker"])
        let liveSend = config["mode"] == "live-send"
        let app = XCUIApplication()
        app.launchArguments = ["--ui-native-activity-recovery"]
        if liveSend { app.launchArguments.append("--ui-native-activity-new-thread") }
        app.launchEnvironment["CAVE_NATIVE_ACTIVITY_UI_FIXTURE"] = raw
        app.launchEnvironment["CAVE_OPEN_THREAD"] = "native-activity-recovery"
        app.launch()
        defer { app.terminate() }
        guard app.navigationBars["Native recovery"].waitForExistence(timeout: 20) else {
            XCTFail("The owned fixture chat did not open")
            return
        }
        let tool = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Tool activity:")).firstMatch
        let reconnect = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Reconnecting")).firstMatch
        let queued = app.staticTexts["Queued. Sends when the desktop is reachable again."]
        if liveSend {
            XCTAssertFalse(tool.exists)
            let composer = app.descendants(matching: .any).matching(identifier: "Message").firstMatch
            XCTAssertTrue(composer.waitForExistence(timeout: 20))
            composer.tap()
            composer.typeText("Read the controlled marker.")
            let send = app.buttons["Send"]
            let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: send)
            await fulfillment(of: [enabled], timeout: 20)
            send.tap()
            let running = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND label CONTAINS %@", "Running"), object: tool)
            await fulfillment(of: [running], timeout: 30)
            // A first real send requests notifications. Dismiss the actual
            // system prompt before claiming the running timeline is visible.
            let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let notificationPrompt = system.alerts.matching(NSPredicate(format: "label CONTAINS %@", "Notifications")).firstMatch
            if notificationPrompt.waitForExistence(timeout: 3) {
                let deny = notificationPrompt.buttons.matching(NSPredicate(format: "label IN %@", ["Don’t Allow", "Don't Allow"])).firstMatch
                XCTAssertTrue(deny.exists)
                deny.tap()
            }
            XCTAssertFalse(system.alerts.firstMatch.exists)
            XCTAssertTrue(tool.isHittable)
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label == %@", "Reasoning summary")).count, 1)
            XCTAssertTrue(app.staticTexts["Inspect the marker file."].exists)
            XCTAssertFalse(app.staticTexts["The marker was read."].exists)
            attachScreenshot("native-live-send-running")
            XCUIDevice.shared.press(.home)
            var persisted = URLRequest(url: try XCTUnwrap(URL(string: try XCTUnwrap(config["snapshotURL"]))))
            persisted.httpMethod = "POST"
            let (_, snapshotResponse) = try await URLSession.shared.data(for: persisted)
            XCTAssertEqual((snapshotResponse as? HTTPURLResponse)?.statusCode, 204)
            app.terminate()
        } else {
            XCTAssertTrue(reconnect.waitForExistence(timeout: 20), "the normal supervisor detects the stopped server")
            XCTAssertTrue(queued.exists, "the accepted delivery stays queued during the outage")
            XCTAssertFalse(tool.exists, "saved activity is not injected into the phone fixture")
            attachScreenshot("native-recovery-offline")
            XCUIDevice.shared.press(.home)
        }
        var restart = URLRequest(url: try XCTUnwrap(URL(string: try XCTUnwrap(config["restartURL"]))))
        restart.httpMethod = "POST"
        let (_, restartResponse) = try await URLSession.shared.data(for: restart)
        XCTAssertEqual((restartResponse as? HTTPURLResponse)?.statusCode, 204)
        if liveSend {
            app.launchArguments = ["--ui-native-activity-recovery"]
            app.launch()
        } else {
            app.activate()
        }
        XCTAssertTrue(tool.waitForExistence(timeout: 20))
        XCTAssertFalse(queued.exists, "normal queued-message recovery settles the accepted delivery")
        XCTAssertFalse(reconnect.exists)
        XCTAssertTrue(tool.label.contains("read_file"))
        XCTAssertTrue(tool.label.contains("Succeeded"))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label == %@", "Reasoning summary")).count, 2)
        XCTAssertTrue(app.staticTexts["Inspect the marker file."].exists)
        XCTAssertTrue(app.staticTexts["The marker was read."].exists)
        XCTAssertTrue(app.staticTexts["Inspecting 🧙 café."].exists)
        XCTAssertTrue(app.staticTexts["Done: \(marker)"].exists)
        let identity = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Runtime: hermes")).firstMatch
        XCTAssertTrue(identity.exists)
        XCTAssertTrue(identity.label.contains("Runtime-reported model: served-fixture-v3"))
        XCTAssertTrue(identity.label.contains("Tool details: supported on this path"))
        attachScreenshot("native-recovered-activity")

        tool.tap()
        let output = app.buttons["Show output for read_file"]
        XCTAssertTrue(output.waitForExistence(timeout: 5))
        output.tap()
        XCTAssertTrue(app.staticTexts[marker].waitForExistence(timeout: 10), "output is loaded from the saved tool's real endpoint")
        attachScreenshot("native-recovered-output")
        app.buttons["Close tool output"].tap()
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(output.waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label == %@", "Reasoning summary")).count, 2)
        XCTAssertTrue(identity.exists)
        output.tap()
        XCTAssertTrue(app.staticTexts[marker].waitForExistence(timeout: 10))
        app.buttons["Close tool output"].tap()
        let summaries = app.buttons.matching(NSPredicate(format: "label == %@", "Reasoning summary"))
        XCTAssertTrue(tool.isHittable)
        XCTAssertTrue(summaries.element(boundBy: 0).isHittable)
        XCTAssertTrue(summaries.element(boundBy: 1).isHittable)
        XCTAssertLessThan(summaries.element(boundBy: 0).frame.maxY, tool.frame.minY)
        XCTAssertLessThan(tool.frame.maxY, summaries.element(boundBy: 1).frame.minY)
        XCTAssertLessThan(summaries.element(boundBy: 1).frame.maxY, identity.frame.minY)
        attachScreenshot("native-recovered-after-background")
        for sentinel in ["PRIVATE_OPAQUE_STATE", "PRIVATE_PARTIAL_SUMMARY", "PRIVATE_RAW_THOUGHT"] {
            XCTAssertFalse(app.debugDescription.contains(sentinel))
        }
        var receipt = URLRequest(url: try XCTUnwrap(URL(string: try XCTUnwrap(config["completionURL"]))))
        receipt.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: receipt)
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
