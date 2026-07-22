import XCTest
@testable import CovenCave

/// ActivityFold turns raw `tool_use`/`progress` stream events into the
/// message's activity trail. The rules under test: keyed tool updates (start
/// appends, settle updates in place — replay-safe), progress dedupe against
/// the latest step, detail capping, the steps bound, terminal settling, and
/// the persisted-history mapping.
final class AgentActivityTests: XCTestCase {

    private func toolEvent(id: String? = "t1", name: String = "Bash",
                           input: String? = nil, output: String? = nil,
                           status: String? = "running",
                           durationMs: Int? = nil) -> StreamEvent {
        .toolUse(id: id, name: name, input: input, output: output,
                 status: status, durationMs: durationMs)
    }

    private func progressEvent(id: String? = nil, label: String,
                               detail: String? = nil, status: String? = "running",
                               durationMs: Int? = nil) -> StreamEvent {
        .progress(id: id, label: label, detail: detail, status: status,
                  durationMs: durationMs)
    }

    // MARK: - Tool folding

    func testToolStartAppendsARunningStep() {
        let steps = ActivityFold.fold([], event: toolEvent(input: "ls -la"))
        XCTAssertEqual(steps?.count, 1)
        XCTAssertEqual(steps?[0].id, "t1")
        XCTAssertEqual(steps?[0].kind, .tool)
        XCTAssertEqual(steps?[0].title, "Bash")
        XCTAssertEqual(steps?[0].detail, "ls -la")
        XCTAssertEqual(steps?[0].status, .running)
    }

    func testToolSettleUpdatesItsStepInPlace() {
        let started = ActivityFold.fold([], event: toolEvent(input: "ls"))!
        let settled = ActivityFold.fold(started, event: toolEvent(status: "ok", durationMs: 420))
        XCTAssertEqual(settled?.count, 1, "settle must not append a second step")
        XCTAssertEqual(settled?[0].status, .ok)
        XCTAssertEqual(settled?[0].durationMs, 420)
        XCTAssertEqual(settled?[0].detail, "ls", "settle keeps the start's input")
    }

    func testToolErrorStatusIsPreserved() {
        let started = ActivityFold.fold([], event: toolEvent())!
        let settled = ActivityFold.fold(started, event: toolEvent(status: "error"))
        XCTAssertEqual(settled?[0].status, .error)
    }

    func testReplayingAnAlreadyAppliedSettleIsANoOp() {
        // Mid-turn resume replays frames past the cursor — re-applying an
        // identical settle must report "no change" so the UI isn't re-notified.
        let started = ActivityFold.fold([], event: toolEvent())!
        let settled = ActivityFold.fold(started, event: toolEvent(status: "ok", durationMs: 100))!
        XCTAssertNil(ActivityFold.fold(settled, event: toolEvent(status: "ok", durationMs: 100)))
    }

    func testToolWithoutIdAppendsEachTime() {
        let first = ActivityFold.fold([], event: toolEvent(id: nil))!
        let second = ActivityFold.fold(first, event: toolEvent(id: nil))!
        XCTAssertEqual(second.count, 2, "id-less events can never be re-keyed")
        XCTAssertNotEqual(second[0].id, second[1].id, "each gets a distinct identity")
    }

    func testDistinctToolIdsTrackIndependently() {
        var steps = ActivityFold.fold([], event: toolEvent(id: "a", name: "Read"))!
        steps = ActivityFold.fold(steps, event: toolEvent(id: "b", name: "Edit"))!
        steps = ActivityFold.fold(steps, event: toolEvent(id: "a", name: "Read", status: "ok"))!
        XCTAssertEqual(steps.map(\.status), [.ok, .running])
    }

    // MARK: - Progress folding

    func testProgressAppendsAStep() {
        let steps = ActivityFold.fold([], event: progressEvent(label: "Thinking…"))
        XCTAssertEqual(steps?.count, 1)
        XCTAssertEqual(steps?[0].kind, .progress)
        XCTAssertEqual(steps?[0].title, "Thinking…")
    }

    func testRepeatedProgressLabelUpdatesTheLatestStep() {
        let first = ActivityFold.fold([], event: progressEvent(label: "Compacting"))!
        let second = ActivityFold.fold(first, event: progressEvent(label: "Compacting",
                                                                   detail: "40%"))!
        XCTAssertEqual(second.count, 1, "a re-emitted label advances in place")
        XCTAssertEqual(second[0].detail, "40%")
    }

    func testNewProgressLabelAppends() {
        let first = ActivityFold.fold([], event: progressEvent(label: "Thinking"))!
        let second = ActivityFold.fold(first, event: progressEvent(label: "Writing"))!
        XCTAssertEqual(second.map(\.title), ["Thinking", "Writing"])
    }

    func testProgressDoneStatusMapsToOk() {
        let first = ActivityFold.fold([], event: progressEvent(label: "Indexing"))!
        let done = ActivityFold.fold(first, event: progressEvent(label: "Indexing",
                                                                 status: "done"))
        XCTAssertEqual(done?[0].status, .ok)
    }

    func testEmptyProgressLabelIsIgnored() {
        XCTAssertNil(ActivityFold.fold([], event: progressEvent(label: "")))
    }

    func testProgressBetweenToolsDoesNotSwallowAToolSettle() {
        // tool start → progress → tool settle: the settle must find its step
        // even though it is no longer last.
        var steps = ActivityFold.fold([], event: toolEvent(id: "t9", name: "Bash"))!
        steps = ActivityFold.fold(steps, event: progressEvent(label: "Streaming"))!
        steps = ActivityFold.fold(steps, event: toolEvent(id: "t9", name: "Bash", status: "ok"))!
        XCTAssertEqual(steps.count, 2)
        XCTAssertEqual(steps[0].status, .ok)
    }

    // MARK: - Non-activity events

    func testNonActivityEventsReportNoChange() {
        XCTAssertNil(ActivityFold.fold([], event: .assistantChunk(text: "hi")))
        XCTAssertNil(ActivityFold.fold([], event: .session(sessionId: "s")))
        XCTAssertNil(ActivityFold.fold([], event: .done(isError: false, sessionId: nil)))
    }

    // MARK: - Caps

    func testDetailIsCappedToOneShortLine() {
        let long = String(repeating: "x", count: 500) + "\nsecond line"
        let steps = ActivityFold.fold([], event: toolEvent(input: long))!
        XCTAssertEqual(steps[0].detail?.count, ActivityFold.detailCap)
        XCTAssertFalse(steps[0].detail?.contains("\n") ?? true)
    }

    func testStepListIsBoundedDroppingOldestFirst() {
        var steps: [ActivityStep] = []
        for n in 0..<(ActivityFold.maxSteps + 10) {
            steps = ActivityFold.fold(steps, event: toolEvent(id: "t\(n)", name: "T\(n)"))!
        }
        XCTAssertEqual(steps.count, ActivityFold.maxSteps)
        XCTAssertEqual(steps.first?.title, "T10", "oldest steps drop first")
    }

    // MARK: - Settling

    func testSettleCoercesRunningStepsToTheTurnOutcome() {
        var steps = ActivityFold.fold([], event: toolEvent(id: "a", status: "ok"))!
        steps = ActivityFold.fold(steps, event: toolEvent(id: "b", name: "Edit"))!
        let ok = ActivityFold.settle(steps, success: true)
        XCTAssertEqual(ok?.map(\.status), [.ok, .ok])
        let failed = ActivityFold.settle(steps, success: false)
        XCTAssertEqual(failed?.map(\.status), [.ok, .error],
                       "already-settled steps keep their own outcome")
    }

    func testSettleWithNothingRunningReportsNoChange() {
        let steps = ActivityFold.fold([], event: toolEvent(status: "ok"))!
        XCTAssertNil(ActivityFold.settle(steps, success: true))
    }

    // MARK: - Persisted history mapping

    func testStepsFromPersistedToolsAreSettled() {
        let tools = [
            ToolCall(id: "1", name: "Bash", input: "pwd", output: nil, status: "ok"),
            ToolCall(id: "2", name: "Edit", input: nil, output: nil, status: "error"),
            ToolCall(id: "3", name: "Read", input: nil, output: nil, status: nil),
        ]
        let steps = ActivityFold.steps(fromTools: tools)
        XCTAssertEqual(steps?.map(\.status), [.ok, .error, .ok],
                       "persisted calls are settled — unknown reads as ok, never running")
        XCTAssertEqual(steps?[0].detail, "pwd")
    }

    func testStepsFromNilOrEmptyToolsIsNil() {
        XCTAssertNil(ActivityFold.steps(fromTools: nil))
        XCTAssertNil(ActivityFold.steps(fromTools: []))
    }

    // MARK: - Summaries

    func testSummaryLabelCountsToolsAndFailures() {
        var steps = ActivityFold.fold([], event: toolEvent(id: "a", status: "ok"))!
        XCTAssertEqual(steps.summaryLabel, "Ran 1 tool")
        steps = ActivityFold.fold(steps, event: toolEvent(id: "b", name: "Edit", status: "error"))!
        XCTAssertEqual(steps.summaryLabel, "Ran 2 tools · 1 failed")
    }

    func testSummaryLabelForProgressOnlyTurns() {
        let steps = ActivityFold.fold([], event: progressEvent(label: "Thinking"))!
        XCTAssertEqual(steps.summaryLabel, "1 step")
    }

    func testCurrentStepPrefersTheNewestRunningStep() {
        var steps = ActivityFold.fold([], event: toolEvent(id: "a", name: "Read"))!
        steps = ActivityFold.fold(steps, event: toolEvent(id: "a", name: "Read", status: "ok"))!
        steps = ActivityFold.fold(steps, event: toolEvent(id: "b", name: "Edit"))!
        XCTAssertEqual(steps.currentStep?.title, "Edit")
        let allSettled = ActivityFold.settle(steps, success: true)!
        XCTAssertEqual(allSettled.currentStep?.title, "Edit",
                       "falls back to the newest step once everything settled")
    }

    // MARK: - Stream decoding

    func testDecodeToolUseCarriesIdStatusAndDuration() throws {
        let json = #"{"kind":"tool_use","id":"t1","name":"Bash","input":"ls","status":"ok","durationMs":123}"#
        guard case .toolUse(let id, let name, let input, _, let status, let durationMs)? =
                StreamEvent.decode(json) else {
            return XCTFail("expected a toolUse event")
        }
        XCTAssertEqual(id, "t1")
        XCTAssertEqual(name, "Bash")
        XCTAssertEqual(input, "ls")
        XCTAssertEqual(status, "ok")
        XCTAssertEqual(durationMs, 123)
    }

    func testDecodeProgressCarriesIdAndStatus() throws {
        let json = #"{"kind":"progress","id":"p1","label":"Thinking","status":"running"}"#
        guard case .progress(let id, let label, _, let status, _)? = StreamEvent.decode(json) else {
            return XCTFail("expected a progress event")
        }
        XCTAssertEqual(id, "p1")
        XCTAssertEqual(label, "Thinking")
        XCTAssertEqual(status, "running")
    }

    // MARK: - Snapshot compatibility

    func testMessagesPersistedBeforeActivityStillDecode() throws {
        let legacy = #"{"id":"m1","role":"assistant","text":"hi","streaming":false,"isError":false,"createdAt":0,"attachmentDataUrls":[]}"#
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        let message = try decoder.decode(DisplayMessage.self, from: Data(legacy.utf8))
        XCTAssertNil(message.activity)
        XCTAssertEqual(message.activitySteps, [])
    }

    func testActivityRoundTripsThroughTheSnapshotEncoding() throws {
        var message = DisplayMessage(role: .assistant, familiarId: "nova", text: "done")
        message.activity = ActivityFold.fold([], event: toolEvent(input: "ls", status: "ok",
                                                                  durationMs: 5))
        let data = try JSONEncoder().encode(message)
        let decoded = try JSONDecoder().decode(DisplayMessage.self, from: data)
        XCTAssertEqual(decoded.activitySteps, message.activitySteps)
    }

    // MARK: - Duration formatting

    func testDurationLabelFormats() {
        XCTAssertEqual(AgentActivityView.durationLabel(480), "480ms")
        XCTAssertEqual(AgentActivityView.durationLabel(1_200), "1.2s")
        XCTAssertEqual(AgentActivityView.durationLabel(125_000), "2m 05s")
        XCTAssertNil(AgentActivityView.durationLabel(nil))
        XCTAssertNil(AgentActivityView.durationLabel(-1))
    }
}
