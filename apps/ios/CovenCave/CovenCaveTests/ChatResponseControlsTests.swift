import XCTest
@testable import CovenCave

final class ChatResponseControlsTests: XCTestCase {
    func testSupportedWireValuesStayStable() {
        XCTAssertEqual(ChatThinkingEffort.allCases.map(\.rawValue), ["low", "medium", "high"])
        XCTAssertEqual(ChatResponseSpeed.allCases.map(\.rawValue), ["fast", "balanced", "careful"])
    }

    func testSendBodyEncodesResponseControls() throws {
        let body = CaveClient.SendBody(
            familiarId: "nyx",
            prompt: "Review the branch",
            sessionId: nil,
            attachments: nil,
            runId: "run-1",
            reasoningEffort: .medium,
            responseSpeed: .careful
        )

        let data = try JSONEncoder().encode(body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json["reasoningEffort"] as? String, "medium")
        XCTAssertEqual(json["responseSpeed"] as? String, "careful")
    }
}
