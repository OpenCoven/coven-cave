import XCTest
@testable import CovenCave

/// The same wire corpus is consumed by TypeScript. These checks qualify
/// decoding/folding/history only, not provider admission or rendered UI.
final class ActivityCorpusTests: XCTestCase {
    private func scenarios(_ key: String) throws -> [[String: Any]] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "runtime-activity-v1", withExtension: "json"))
        let corpus = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        XCTAssertEqual(corpus["schemaVersion"] as? Int, 1)
        return try XCTUnwrap(corpus[key] as? [[String: Any]])
    }

    private func json(_ value: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed]), as: UTF8.self)
    }

    private func assertJSON(_ actual: Any, _ expected: Any, _ id: String) throws {
        XCTAssertEqual(try json(actual), try json(expected), id)
    }

    private func identityValue(_ identity: ChatRuntimeIdentity?) throws -> Any {
        guard let identity else { return NSNull() }
        var value: [String: Any] = ["schemaVersion": identity.schemaVersion, "harness": identity.harness,
            "version": identity.version as Any? ?? NSNull(), "model": identity.model as Any? ?? NSNull()]
        if let activity = identity.activity {
            value["activity"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(activity))
        }
        return value
    }

    func testSharedIdentityAcrossLiveAndHistory() throws {
        for scenario in try scenarios("identityScenarios") {
            let id = try XCTUnwrap(scenario["id"] as? String)
            let metadata = try XCTUnwrap(scenario["metadata"])
            let expected = try XCTUnwrap(scenario["expected"])
            let frame = try json(["kind": "response_metadata", "responseMetadata": metadata])
            var live: ChatRuntimeIdentity?
            if case .runtimeIdentity(let value)? = StreamEvent.decode(frame) { live = value }
            try assertJSON(identityValue(live), expected, "\(id): live")

            let data = try JSONSerialization.data(withJSONObject: ["id": "response", "role": "assistant", "text": "Answer", "responseMetadata": metadata])
            let turn = try JSONDecoder().decode(ChatTurn.self, from: data)
            let restored = DisplayMessage.restored(from: turn, familiarId: "fixture")
            try assertJSON(identityValue(restored.runtimeIdentity), expected, "\(id): history")
            let snapshot = try JSONDecoder().decode(DisplayMessage.self, from: JSONEncoder().encode(restored))
            try assertJSON(identityValue(snapshot.runtimeIdentity), expected, "\(id): snapshot")
        }
    }

    private func toolValues(_ steps: [ActivityStep]) -> [[String: Any]] {
        steps.map { step in
            var value: [String: Any] = ["id": step.id, "name": step.title, "status": step.status.rawValue]
            if let duration = step.durationMs { value["durationMs"] = duration }
            return value
        }
    }

    func testSharedToolOrderOutcomesReplayAndHistory() throws {
        for scenario in try scenarios("toolScenarios") {
            let id = try XCTUnwrap(scenario["id"] as? String)
            let events = try XCTUnwrap(scenario["events"] as? [[String: Any]])
            let expected = try XCTUnwrap(scenario["expected"])
            var steps: [ActivityStep] = []
            // Replay the same frames after settlement: requests cannot revive
            // an unknown result or replace an earlier terminal observation.
            for pass in 0..<2 {
                for raw in events {
                    let event = try XCTUnwrap(StreamEvent.decode(json(raw)))
                    steps = ActivityFold.fold(steps, event: event) ?? steps
                }
                steps = ActivityFold.settle(steps, success: true) ?? steps
                try assertJSON(toolValues(steps), expected, "\(id): pass \(pass)")
            }
            let saved = try JSONDecoder().decode([ToolCall].self, from: JSONSerialization.data(withJSONObject: expected))
            try assertJSON(toolValues(ActivityFold.steps(fromTools: saved) ?? []), expected, "\(id): history")
        }
    }

    func testSharedReasoningOrderReplayAndHistory() throws {
        for scenario in try scenarios("reasoningScenarios") {
            let id = try XCTUnwrap(scenario["id"] as? String)
            let rawBlocks = try XCTUnwrap(scenario["blocks"] as? [[String: Any]])
            let expected = try XCTUnwrap(scenario["expected"])
            var blocks: [ChatReasoningBlock] = []
            for _ in 0..<2 {
                for raw in rawBlocks {
                    if case .reasoning(let block)? = StreamEvent.decode(try json(["kind": "reasoning", "block": raw])) {
                        blocks = ChatReasoningBlock.merging(blocks, block)
                    }
                }
            }
            // Codable omits nil completion times; normalize the fixture in
            // the same way before comparing its stable typed representation.
            let saved = try JSONDecoder().decode([ChatReasoningBlock].self, from: JSONSerialization.data(withJSONObject: expected))
            XCTAssertEqual(blocks, saved, id)
            XCTAssertEqual(try JSONDecoder().decode([ChatReasoningBlock].self, from: JSONEncoder().encode(blocks)), saved, id)
        }
    }

    func testDisplayPositionsRejectMalformedValuesWithoutBreakingLegacy() throws {
        let scenario = try XCTUnwrap(scenarios("reasoningScenarios").first)
        let template = try XCTUnwrap((scenario["expected"] as? [[String: Any]])?.first)
        XCTAssertNotNil(ChatReasoningBlock.decode(template), "legacy records have no invented positions")
        let invalidValues: [Any] = [-1, 1.5, 9_007_199_254_740_992, NSNull(), "1"]
        for invalid in invalidValues {
            var block = template
            block["textOffset"] = invalid
            XCTAssertNil(ChatReasoningBlock.decode(block))
            block = template
            var observation = try XCTUnwrap(block["observation"] as? [String: Any])
            observation["sequence"] = invalid
            block["observation"] = observation
            XCTAssertNil(ChatReasoningBlock.decode(block))
        }
    }

    func testTextCorrectionsPreserveUnicodeAnchorsAndLegacyAbsence() throws {
        let offset = "Inspecting 🧙 café.".utf16.count
        let frame = try json(["kind": "assistant_replace", "text": "Updated answer", "toolOffsetCorrection": ["after": offset, "delta": 4]])
        guard case .assistantReplace(_, let decoded)? = StreamEvent.decode(frame) else {
            return XCTFail("Expected replacement")
        }
        let correction = try XCTUnwrap(decoded)
        XCTAssertEqual(correction.rebase(0), 0)
        XCTAssertEqual(correction.rebase(offset), offset + 4)
        XCTAssertNil(correction.rebase(nil))
        XCTAssertEqual(TextOffsetCorrection(after: 0, delta: -100).rebase(offset), 0)
        XCTAssertNil(TextOffsetCorrection.decode(["after": -1, "delta": 2]))
        XCTAssertNil(TextOffsetCorrection.decode(["after": 1.5, "delta": 2]))
    }
}
