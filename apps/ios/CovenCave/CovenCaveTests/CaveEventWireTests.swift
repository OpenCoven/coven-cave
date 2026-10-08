import XCTest
@testable import CovenCave

/// The Swift side of the shared protocol v1 fixture (#5864). The same JSON is
/// decoded by the TypeScript protocol tests, so the two clients cannot drift.
final class CaveEventWireTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/cave-event-plane-v1.json")
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        return try XCTUnwrap(object as? [String: Any])
    }

    private func frame(_ object: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
    }

    func testCapabilityAndCloseCodesDecode() throws {
        let golden = try fixture()
        let capability = try JSONDecoder().decode(
            CaveEventCapability.self,
            from: JSONSerialization.data(withJSONObject: XCTUnwrap(golden["capability"]))
        )
        XCTAssertTrue(capability.enabled)
        XCTAssertEqual(capability.path, CaveEventWire.path)
        XCTAssertEqual(capability.topics, CaveEventTopic.allCases)
        XCTAssertEqual(capability.rolloutMode.web, .shadow)
        XCTAssertEqual(capability.rolloutMode.ios, .off)
        XCTAssertEqual(capability.iosMode, .off, "iOS never borrows the web rollout mode")

        let codes = try JSONDecoder().decode(
            CaveEventCloseCodes.self,
            from: JSONSerialization.data(withJSONObject: XCTUnwrap(golden["closeCodes"]))
        )
        XCTAssertEqual(codes.protocol, CaveEventCloseCode.unsupportedProtocol)
        XCTAssertEqual(codes.invalidFrame, CaveEventCloseCode.invalidFrame)
        XCTAssertEqual(codes.slowConsumer, CaveEventCloseCode.slowConsumer)
    }

    func testGoldenServerMessagesDecode() throws {
        let golden = try fixture()
        XCTAssertEqual(
            try CaveEventServerMessage.parse(frame(XCTUnwrap(golden["ready"]))),
            .ready(CaveEventReady(epoch: "boot-a", seq: 42, topics: [.sessions, .board], versions: [.sessions: 3, .board: 8]))
        )
        XCTAssertEqual(
            try CaveEventServerMessage.parse(frame(XCTUnwrap(golden["invalidate"]))),
            .invalidate(CaveEventInvalidation(epoch: "boot-a", seq: 43, topic: .board, version: 9, entityIds: ["card-1"]))
        )
        XCTAssertEqual(
            try CaveEventServerMessage.parse(frame(XCTUnwrap(golden["resyncRequired"]))),
            .resyncRequired(CaveEventResync(epoch: "boot-b", seq: 0, topics: [.sessions, .board], reason: .serverRestarted))
        )
    }

    func testGoldenClientMessagesEncodeTheSameShape() throws {
        let golden = try fixture()
        let hello = try CaveEventClientMessage.hello(
            clientId: "browser-main",
            topics: [.board, .sessions],
            resume: CaveEventResumeCursor(epoch: "boot-a", seq: 41)
        ).encoded()
        XCTAssertEqual(
            try JSONSerialization.jsonObject(with: Data(hello.utf8)) as? NSDictionary,
            golden["hello"] as? NSDictionary,
            "topics encode in canonical order whatever the set's order"
        )
        let subscribe = try CaveEventClientMessage.subscribe(topics: [.runs]).encoded()
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(subscribe.utf8)) as? NSDictionary, golden["subscribe"] as? NSDictionary)
        let ack = try CaveEventClientMessage.ack(epoch: "boot-a", seq: 42).encoded()
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(ack.utf8)) as? NSDictionary, golden["ack"] as? NSDictionary)
    }

    func testMalformedFixturesAreRefused() throws {
        let malformed = try XCTUnwrap(try fixture()["malformed"] as? [String: Any])
        XCTAssertThrowsError(try CaveEventServerMessage.parse(frame(XCTUnwrap(malformed["unknownTopic"])))) { error in
            XCTAssertEqual(error as? CaveEventWireError, .invalid("unknown event topic"))
        }
        XCTAssertThrowsError(try CaveEventServerMessage.parse(frame(XCTUnwrap(malformed["unsupportedProtocol"])))) { error in
            XCTAssertEqual(error as? CaveEventWireError, .unsupportedProtocol)
        }
    }

    func testStrictFieldsFailClosed() {
        let cases = [
            #"{"type":"pong","protocol":1,"epoch":"e","seq":1}"#,
            #"{"type":"invalidate","protocol":1,"epoch":"e","seq":-1,"topic":"board","version":1}"#,
            #"{"type":"invalidate","protocol":1,"epoch":"e","seq":1.5,"topic":"board","version":1}"#,
            #"{"type":"invalidate","protocol":1,"epoch":"e","seq":true,"topic":"board","version":1}"#,
            #"{"type":"invalidate","protocol":1,"epoch":"","seq":1,"topic":"board","version":1}"#,
            #"{"type":"ready","protocol":1,"epoch":"e","seq":1,"topics":["board","board"],"versions":{}}"#,
            #"{"type":"ready","protocol":1,"epoch":"e","seq":1,"topics":["board"],"versions":{"runs":1}}"#,
            #"{"type":"resync-required","protocol":1,"epoch":"e","seq":1,"topics":["board"],"reason":"bored"}"#,
            #"[1,2,3]"#,
            "not json",
        ]
        for text in cases {
            XCTAssertThrowsError(try CaveEventServerMessage.parse(text), text)
        }
        XCTAssertThrowsError(try CaveEventServerMessage.parse(#"{"type":"ready","protocol":true,"epoch":"e","seq":1,"topics":[],"versions":{}}"#)) { error in
            XCTAssertEqual(error as? CaveEventWireError, .unsupportedProtocol)
        }
        let oversized = #"{"type":"invalidate","protocol":1,"epoch":"e","seq":1,"topic":"board","version":1,"pad":""# + String(repeating: "x", count: 17_000) + #""}"#
        XCTAssertThrowsError(try CaveEventServerMessage.parse(oversized))
    }

    func testEntityIdsAreBoundedAndDeduplicated() throws {
        let ids = (0..<33).map { "\"card-\($0)\"" }.joined(separator: ",")
        XCTAssertThrowsError(try CaveEventServerMessage.parse(
            #"{"type":"invalidate","protocol":1,"epoch":"e","seq":1,"topic":"board","version":1,"entityIds":["# + ids + "]}"
        ))
        let message = try CaveEventServerMessage.parse(
            #"{"type":"invalidate","protocol":1,"epoch":"e","seq":1,"topic":"board","version":1,"entityIds":["a","a","b"]}"#
        )
        XCTAssertEqual(message, .invalidate(CaveEventInvalidation(epoch: "e", seq: 1, topic: .board, version: 1, entityIds: ["a", "b"])))
    }

    func testUnknownRolloutModeAndUnusableCapabilityAreOff() throws {
        let json = #"{"enabled":true,"protocolVersion":1,"path":"/api/events-ws","topics":["board"],"rolloutMode":{"web":"turbo","ios":"PRIMARY"}}"#
        let capability = try JSONDecoder().decode(CaveEventCapability.self, from: Data(json.utf8))
        XCTAssertEqual(capability.rolloutMode.web, .off)
        XCTAssertEqual(capability.iosMode, .primary)
        let disabled = CaveEventCapability(enabled: false, protocolVersion: 1, path: CaveEventWire.path, topics: [], rolloutMode: .init(web: .primary, ios: .primary))
        XCTAssertEqual(disabled.iosMode, .off)
        let future = CaveEventCapability(enabled: true, protocolVersion: 2, path: CaveEventWire.path, topics: [], rolloutMode: .init(web: .primary, ios: .primary))
        XCTAssertEqual(future.iosMode, .off)
    }
}
