import XCTest
@testable import CovenCave

/// ToolArgSummary turns a tool call's input payload into the one-line argument
/// shown beside the tool name. The payloads here are the real wire shapes: the
/// server pretty-prints tool inputs as JSON (`formatToolInputValue` in
/// src/lib/chat-tool-events.ts), which is exactly the case the old first-line
/// reader got wrong — every call summarised to a bare "{".
final class ToolArgSummaryTests: XCTestCase {

    /// The shape the server actually sends: `JSON.stringify(input, null, 2)`.
    private func wire(_ object: [String: Any]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: object,
                                               options: [.prettyPrinted, .sortedKeys])
        return String(data: data, encoding: .utf8)!
    }

    // MARK: - The regression

    func testPrettyPrintedJsonNeverSummarisesToABrace() {
        let input = wire(["command": "ls -la src", "description": "List sources"])
        XCTAssertTrue(input.hasPrefix("{\n"), "precondition: the wire payload is multi-line JSON")
        let summary = ToolArgSummary.summary(name: "Bash", input: input)
        XCTAssertEqual(summary, "ls -la src")
        XCTAssertNotEqual(summary, "{")
    }

    func testShellToolsLeadWithTheirCommand() {
        // `description` sorts ahead of `command` in the payload; the shell rule
        // must still pick the command.
        let input = wire(["description": "Run the tests", "command": "pnpm test"])
        XCTAssertEqual(ToolArgSummary.summary(name: "Bash", input: input), "pnpm test")
    }

    func testFileToolsLeadWithTheirPath() {
        let input = wire(["file_path": "src/lib/foo.ts", "limit": 100])
        XCTAssertEqual(ToolArgSummary.summary(name: "Read", input: input), "src/lib/foo.ts")
    }

    func testNonShellToolDoesNotHoistCommand() {
        // Only shell-ish tools promote `command`; for others the preferred-key
        // order (path before command) decides.
        let input = wire(["command": "ignored", "path": "docs/readme.md"])
        XCTAssertEqual(ToolArgSummary.summary(name: "Write", input: input), "docs/readme.md")
    }

    // MARK: - Payload variants

    func testUnknownKeysFallBackToTheFirstValue() {
        let input = wire(["alpha": "first", "beta": "second"])
        XCTAssertEqual(ToolArgSummary.summary(name: "Custom", input: input), "first",
                       "keys sort for a stable answer — Swift dictionaries are unordered")
    }

    func testNumericAndBooleanValuesRenderWithoutJsonNoise() {
        XCTAssertEqual(ToolArgSummary.summary(name: "Sleep", input: wire(["duration": 5])), "5")
        XCTAssertEqual(ToolArgSummary.summary(name: "Toggle", input: wire(["enabled": true])),
                       "true", "a JSON bool must not read as NSNumber's \"1\"")
    }

    func testPayloadsWithNothingToSaySayNothing() {
        // Rather than falling back to the JSON itself: a chip full of braces is
        // the thing this type exists to remove, so the tool name stands alone.
        XCTAssertNil(ToolArgSummary.summary(name: "TodoWrite", input: "{}"))
        XCTAssertNil(ToolArgSummary.summary(name: "TodoWrite",
                                            input: wire(["todos": [["id": 1]]])),
                     "a container-only payload has no one-line argument")
    }

    func testBarePayloadPassesThrough() {
        // Not every runtime sends JSON — a raw command line stays as it is.
        XCTAssertEqual(ToolArgSummary.summary(name: "Bash", input: "ls -la"), "ls -la")
        XCTAssertNil(ToolArgSummary.summary(name: "Bash", input: "   "))
        XCTAssertNil(ToolArgSummary.summary(name: "Bash", input: nil))
    }

    func testJsonStringPayloadUnwraps() {
        XCTAssertEqual(ToolArgSummary.summary(name: "Bash", input: "\"pwd\""), "pwd")
    }

    func testTruncatedObjectYieldsItsFirstIdentifyingToken() {
        // A payload capped mid-flight (LIVE_TOOL_INPUT_CAP) no longer parses;
        // pull the path out rather than showing the broken blob.
        let truncated = "{\n  \"file_path\": \"src/components/chat-view.tsx\",\n  \"old_str"
        XCTAssertEqual(ToolArgSummary.summary(name: "Edit", input: truncated),
                       "src/components/chat-view.tsx",
                       "the value, not the key — \"file_path\" tells the reader nothing")
    }

    func testArrayPayloadJoinsItsEntries() {
        XCTAssertEqual(ToolArgSummary.summary(name: "Glob", input: "[\"src\", \"docs\"]"),
                       "src docs")
    }

    // MARK: - Shape

    func testSummaryIsAlwaysOneLineAndCapped() {
        let sprawling = wire(["prompt": "line one\nline two\n" + String(repeating: "x", count: 400)])
        let summary = ToolArgSummary.summary(name: "Agent", input: sprawling, max: 40)
        XCTAssertEqual(summary?.count, 40)
        XCTAssertFalse(summary?.contains("\n") ?? true)
        XCTAssertTrue(summary?.hasSuffix("…") ?? false, "truncation is visible")
    }

    func testShortSummaryIsNotPadded() {
        XCTAssertEqual(ToolArgSummary.summary(name: "Bash", input: wire(["command": "pwd"])), "pwd")
    }
}
