import XCTest
@testable import CovenCave

final class ChatActivityTimelineTests: XCTestCase {
    func testNativePlainParagraphsUseTheSharedRendererSubset() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-plain-paragraph-v1", withExtension: "json"))
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        for item in cases {
            let id = try XCTUnwrap(item["id"] as? String)
            XCTAssertEqual(MarkdownDetect.plainTimelineParagraph(try XCTUnwrap(item["source"] as? String)),
                           item["plainText"] as? String, id)
        }
    }

    /// Warm pure-projection samples, not frame time or a physical-device gate.
    /// Run in Release for comparisons; keep raw samples in the xcresult.
    func testLargeTimelinePreservesSourceAndOrderWithTimingEvidence() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "runtime-timeline-v1", withExtension: "json"))
        let corpus = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let scenario = try XCTUnwrap((corpus["scenarios"] as? [[String: Any]])?.first)
        let raw: [String: Any] = ["id": "benchmark", "role": "assistant", "text": "",
                                  "tools": try XCTUnwrap(scenario["tools"])]
        let turn = try JSONDecoder().decode(ChatTurn.self, from: JSONSerialization.data(withJSONObject: raw))
        let template = try XCTUnwrap(DisplayMessage.restored(from: turn, familiarId: "fixture").activitySteps.first)
        var records: [[String: Any]] = []
        for shape in ["prose", "fenced"] {
            for count in [30, 120, 1000] {
                var source = ""
                var tools: [ActivityStep] = []
                for index in 0..<count {
                    var tool = template
                    tool.id = "call-\(index)"
                    tool.activity?.callId = tool.id
                    tool.activity?.sequence = index
                    tool.textOffset = source.utf16.count
                    tools.append(tool)
                    source += "Observation \(index): 🧙 café.\n\n"
                    if shape == "fenced" { source += "```text\nfirst \(index)\n\nsecond \(index)\n```\n\n" }
                }
                var samples: [Double] = []
                for iteration in 0..<9 {
                    let start = DispatchTime.now().uptimeNanoseconds
                    let entries = try XCTUnwrap(ChatActivityTimeline.entries(text: source, steps: tools, reasoning: []))
                    let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
                    XCTAssertEqual(entries.count, 2 * count)
                    XCTAssertEqual(entries.compactMap { entry -> String? in
                        if case .text(_, let text) = entry { return text }; return nil
                    }.joined(), source)
                    XCTAssertEqual(entries.compactMap { entry -> String? in
                        if case .tool(let step) = entry { return step.id }; return nil
                    }, tools.map(\.id))
                    if iteration >= 2 { samples.append(elapsed) }
                }
                let ordered = samples.sorted()
                records.append(["shape": shape, "count": count, "utf16Length": source.utf16.count,
                                "samplesMs": samples, "medianMs": ordered[3], "maxMs": ordered.last!])
            }
        }
        let data = try JSONSerialization.data(withJSONObject: ["scope": "warm pure projection only", "records": records], options: [.sortedKeys])
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        print("TIMELINE_PROJECTION_BENCHMARK \(json)")
        let attachment = XCTAttachment(string: json)
        attachment.name = "timeline-projection-benchmark.json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testLocalReadingChoicesPreserveTheGlobalDefaultAndResetExplicitly() {
        var state = ChatReasoningDisclosureState()
        XCTAssertTrue(state.isExpanded("first", defaultValue: true))
        XCTAssertFalse(state.isExpanded("first", defaultValue: false))
        state.setExpanded(true, for: "first")
        XCTAssertTrue(state.isExpanded("first", defaultValue: false))
        XCTAssertFalse(state.isExpanded("second", defaultValue: false))
        state.setExpanded(false, for: "second")
        XCTAssertFalse(state.isExpanded("second", defaultValue: true))
        state.reset()
        XCTAssertFalse(state.isExpanded("first", defaultValue: false))
        XCTAssertTrue(state.isExpanded("second", defaultValue: true))
    }

    func testSharedWebNativeOrderAndAtomicContentThroughHistoryAndSnapshot() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "runtime-timeline-v1", withExtension: "json"))
        let corpus = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        XCTAssertEqual(corpus["schemaVersion"] as? Int, 1)
        let scenarios = try XCTUnwrap(corpus["scenarios"] as? [[String: Any]])
        for scenario in scenarios {
            let id = try XCTUnwrap(scenario["id"] as? String)
            let raw: [String: Any] = ["id": id, "role": "assistant", "text": try XCTUnwrap(scenario["text"]),
                                      "tools": try XCTUnwrap(scenario["tools"]), "reasoningBlocks": try XCTUnwrap(scenario["reasoningBlocks"])]
            let turn = try JSONDecoder().decode(ChatTurn.self, from: JSONSerialization.data(withJSONObject: raw))
            let restored = DisplayMessage.restored(from: turn, familiarId: "fixture")
            let snapshot = try JSONDecoder().decode(DisplayMessage.self, from: JSONEncoder().encode(restored))
            for message in [restored, snapshot] {
                let entries = ChatActivityTimeline.entries(text: message.text, steps: message.activitySteps, reasoning: message.reasoningBlocks ?? [])
                XCTAssertEqual(entries?.map(\.kind), scenario["expectedKinds"] as? [String], id)
                let text = entries?.compactMap { entry -> String? in
                    if case .text(_, let value) = entry { return value }; return nil
                } ?? []
                if let expected = scenario["expectedText"] as? [String] { XCTAssertEqual(text, expected, id) }
                if let atomic = scenario["atomic"] as? String { XCTAssertTrue(text.contains { $0.contains(atomic) }, id) }
                if let entries { XCTAssertEqual(Set(entries.map(\.id)).count, entries.count, id) }
            }
        }
    }
}
