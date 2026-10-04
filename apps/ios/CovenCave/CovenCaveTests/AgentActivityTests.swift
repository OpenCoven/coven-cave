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


    private var provenanceJSON: String {
        #"{"schemaVersion":1,"runId":"22222222-3333-4444-8555-666666666666","attemptId":"33333333-3333-4444-8555-666666666666","callId":"t1","phase":"ok","source":"runtime-report","producer":{"harness":"hermes","version":null,"protocol":"hermes-responses-v1"},"firstObservedAt":100,"updatedAt":150,"executionObservedAt":110,"terminalObservedAt":150,"authority":{"binding":"unavailable","approval":"unavailable","effect":"unavailable"}}"#
    }

    func testToolProvenanceSurvivesLiveReplayAndHistory() throws {
        let eventJSON = #"{"kind":"tool_use","id":"t1","name":"Read","status":"ok","activity":\#(provenanceJSON)}"#
        let event = try XCTUnwrap(StreamEvent.decode(eventJSON))
        let live = try XCTUnwrap(ActivityFold.fold([], event: event))
        XCTAssertEqual(live[0].activity?.producer.harness, "hermes")
        XCTAssertNil(ActivityFold.fold(live, event: event), "cursor replay is idempotent")
        XCTAssertNil(ActivityFold.fold(live, event: toolEvent(status: "error")), "late outcomes cannot replace provenance")
        let historyJSON = #"{"id":"t1","name":"Read","status":"ok","activity":\#(provenanceJSON)}"#
        let saved = try JSONDecoder().decode(ToolCall.self, from: Data(historyJSON.utf8))
        XCTAssertEqual(ActivityFold.steps(fromTools: [saved])?[0].activity, live[0].activity)
        let snapshot = try JSONEncoder().encode(live)
        XCTAssertEqual(try JSONDecoder().decode([ActivityStep].self, from: snapshot), live)
    }

    func testRejectedRequestSurvivesReplayHistoryAndSnapshot() throws {
        let provenance = provenanceJSON
            .replacingOccurrences(of: #""phase":"ok""#, with: #""phase":"rejected""#)
            .replacingOccurrences(of: #""executionObservedAt":110"#, with: #""executionObservedAt":null"#)
        let eventJSON = #"{"kind":"tool_use","id":"t1","name":"Bash","status":"rejected","activity":\#(provenance)}"#
        let event = try XCTUnwrap(StreamEvent.decode(eventJSON))
        let live = try XCTUnwrap(ActivityFold.fold([], event: event))
        XCTAssertEqual(live[0].status, .rejected)
        XCTAssertEqual(live.summaryLabel, "1 tool call · 1 rejected")
        XCTAssertNotNil(live[0].activity)
        XCTAssertNil(live[0].activity?.executionObservedAt)
        XCTAssertEqual(live[0].activity?.terminalObservedAt, 150)
        for status in ["running", "ok", "error", "unknown"] {
            XCTAssertNil(ActivityFold.fold(live, event: toolEvent(status: status)))
        }
        XCTAssertNil(ActivityFold.settle(live, success: false))
        let historyJSON = #"{"id":"t1","name":"Bash","status":"rejected","activity":\#(provenance)}"#
        let saved = try JSONDecoder().decode(ToolCall.self, from: Data(historyJSON.utf8))
        XCTAssertEqual(ActivityFold.steps(fromTools: [saved]), live)
        XCTAssertEqual(try JSONDecoder().decode([ActivityStep].self, from: JSONEncoder().encode(live)), live)
    }

    func testInvalidProvenanceKeepsToolHistoryReadable() throws {
        for invalid in [
            provenanceJSON.replacingOccurrences(of: #""schemaVersion":1"#, with: #""schemaVersion":2"#),
            provenanceJSON.replacingOccurrences(of: #""callId":"t1""#, with: #""callId":"other""#),
            provenanceJSON.replacingOccurrences(of: #""approval":"unavailable""#, with: #""approval":"approved""#),
            provenanceJSON.replacingOccurrences(of: #""terminalObservedAt":150"#, with: #""terminalObservedAt":99"#),
            #"{"schemaVersion":{},"producer":"invalid"}"#,
        ] {
            let toolJSON = #"{"id":"t1","name":"Read","status":"ok","activity":\#(invalid)}"#
            let tool = try JSONDecoder().decode(ToolCall.self, from: Data(toolJSON.utf8))
            XCTAssertEqual(tool.status, "ok")
            XCTAssertNil(tool.activity)
            let stepJSON = #"{"id":"t1","kind":"tool","title":"Read","status":"ok","activity":\#(invalid)}"#
            XCTAssertNil(try JSONDecoder().decode(ActivityStep.self, from: Data(stepJSON.utf8)).activity)
        }
    }

    func testDisconnectDoesNotCreateProducerProvenance() throws {
        let running = provenanceJSON.replacingOccurrences(of: #""phase":"ok""#, with: #""phase":"running""#)
            .replacingOccurrences(of: #""terminalObservedAt":150"#, with: #""terminalObservedAt":null"#)
        let json = #"{"kind":"tool_use","id":"t1","name":"Read","status":"running","activity":\#(running)}"#
        let live = try XCTUnwrap(ActivityFold.fold([], event: try XCTUnwrap(StreamEvent.decode(json))))
        XCTAssertNotNil(live[0].activity)
        let settled = try XCTUnwrap(ActivityFold.settle(live, success: true))
        XCTAssertEqual(settled[0].status, .unknown)
        XCTAssertNil(settled[0].activity)
    }


    private var reasoningJSON: String {
        #"{"schemaVersion":1,"id":"33333333-3333-4444-8555-666666666666:r1","representation":"provider-summary","phase":"complete","text":"Compare the results.","disclosure":"display-safe","observation":{"runId":"22222222-3333-4444-8555-666666666666","attemptId":"33333333-3333-4444-8555-666666666666","source":"runtime-report","producer":{"harness":"codex","version":"0.145.0","protocol":"codex-jsonl-v1"},"firstObservedAt":100,"updatedAt":150,"completedAt":150,"binding":"unavailable"}}"#
    }

    func testProviderSummaryLiveReplayHistoryAndSnapshotAgree() throws {
        let json = #"{"kind":"reasoning","block":\#(reasoningJSON)}"#
        guard case .reasoning(let block)? = StreamEvent.decode(json) else { return XCTFail("missing typed summary") }
        XCTAssertEqual(block.text, "Compare the results.")
        XCTAssertEqual(ChatReasoningBlock.merging([block], block), [block])
        let turnJSON = #"{"id":"a","role":"assistant","text":"Answer","reasoningBlocks":[\#(reasoningJSON)]}"#
        let turn = try JSONDecoder().decode(ChatTurn.self, from: Data(turnJSON.utf8))
        let message = DisplayMessage.restored(from: turn, familiarId: "sage")
        XCTAssertEqual(message.reasoningBlocks, [block])
        XCTAssertEqual(try JSONDecoder().decode(DisplayMessage.self, from: JSONEncoder().encode(message)).reasoningBlocks, [block])
        var late = block; late.phase = "running"; late.text = nil; late.disclosure = "withheld"; late.observation?.completedAt = nil
        XCTAssertEqual(ChatReasoningBlock.merging([block], late), [block])
    }

    func testProviderWithholdingIsDistinctFromLocalInterruption() throws {
        var block = try JSONDecoder().decode(ChatReasoningBlock.self, from: Data(reasoningJSON.utf8))
        block.phase = "unavailable"
        block.text = nil
        block.disclosure = "withheld"
        block.observation?.completedAt = nil
        block.unavailableReason = "provider-withheld"
        XCTAssertNotNil(block.validated)
        let stored = try JSONDecoder().decode(ChatReasoningBlock.self, from: JSONEncoder().encode(block))
        XCTAssertEqual(stored.validated?.unavailableReason, "provider-withheld")
        block.observation?.source = "application"
        XCTAssertNil(block.validated, "A disconnect cannot claim provider withholding")
        block.unavailableReason = nil
        XCTAssertNotNil(block.validated)
    }

    func testUnknownReasoningMetadataLeavesAnswerReadable() throws {
        for invalid in [reasoningJSON.replacingOccurrences(of: #""schemaVersion":1"#, with: #""schemaVersion":2"#), #"{"schemaVersion":{},"phase":42}"#] {
            let turnJSON = #"{"id":"a","role":"assistant","text":"Answer","reasoningBlocks":[\#(invalid)]}"#
            let turn = try JSONDecoder().decode(ChatTurn.self, from: Data(turnJSON.utf8))
            let message = DisplayMessage.restored(from: turn, familiarId: "sage")
            XCTAssertEqual(message.text, "Answer")
            XCTAssertTrue(message.reasoningBlocks?.isEmpty == true)
        }
    }

    // MARK: - Tool folding

    func testRequestDoesNotClaimExecutionAndSettlesUnknown() {
        let requested = ActivityFold.fold([], event: toolEvent(status: "requested"))!
        XCTAssertEqual(requested[0].status, .requested)
        XCTAssertEqual(requested.summaryLabel, "1 tool call · 1 requested")
        XCTAssertEqual(ActivityFold.settle(requested, success: true)?[0].status, .unknown)
        let running = ActivityFold.fold(requested, event: toolEvent(status: "running"))!
        XCTAssertEqual(running.count, 1)
        XCTAssertEqual(running[0].status, .running)
        XCTAssertNil(ActivityFold.fold(running, event: toolEvent(status: "requested")))
    }

    func testLateStartDoesNotReviveUnknownOutcome() {
        let unknown = ActivityFold.fold([], event: toolEvent(status: "unknown"))!
        XCTAssertNil(ActivityFold.fold(unknown, event: toolEvent(status: "running")))
        XCTAssertNil(ActivityFold.fold(unknown, event: toolEvent(status: "requested")))
    }

    func testFirstTerminalOutputAndDurationSurviveReplay() {
        let failed = ActivityFold.fold([], event: toolEvent(output: "original", status: "error", durationMs: 10))!
        XCTAssertNil(ActivityFold.fold(failed, event: toolEvent(output: "replacement", status: "error", durationMs: 20)))
    }

    func testFuturePersistedStatusBecomesUnknown() throws {
        let json = Data(#"{"id":"future","kind":"tool","title":"read","status":"future-status"}"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(ActivityStep.self, from: json).status, .unknown)
    }

    func testToolStartAppendsARunningStep() {
        let steps = ActivityFold.fold([], event: toolEvent(input: "ls -la"))
        XCTAssertEqual(steps?.count, 1)
        XCTAssertEqual(steps?[0].id, "t1")
        XCTAssertEqual(steps?[0].kind, .tool)
        XCTAssertEqual(steps?[0].title, "Bash")
        XCTAssertEqual(steps?[0].detail, "ls -la")
        XCTAssertEqual(steps?[0].status, .running)
    }

    func testToolDetailSummarisesThePrettyPrintedJsonTheServerSends() {
        // The wire payload is JSON.stringify(input, null, 2) — reading its
        // first line labelled every tool call in the app "{".
        let input = "{\n  \"command\": \"pnpm test\",\n  \"description\": \"Run tests\"\n}"
        let steps = ActivityFold.fold([], event: toolEvent(input: input))
        XCTAssertEqual(steps?[0].detail, "pnpm test")
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

    // MARK: - Failure reasons

    func testAFailedToolCarriesItsReason() {
        let started = ActivityFold.fold([], event: toolEvent(input: "cat missing.txt"))!
        let failed = ActivityFold.fold(started, event: toolEvent(
            output: "cat: missing.txt: No such file or directory", status: "error"))
        XCTAssertEqual(failed?[0].errorOutput, "cat: missing.txt: No such file or directory")
    }

    func testASuccessfulToolDoesNotStoreItsOutput() {
        // Only a failure has to explain itself; a successful call's payload
        // belongs on the desktop, not in every persisted snapshot.
        let steps = ActivityFold.fold([], event: toolEvent(output: "a\nb\nc", status: "ok"))
        XCTAssertNil(steps?[0].errorOutput)
    }

    func testAnIntermediateRunningFrameDoesNotStoreOutput() {
        let steps = ActivityFold.fold([], event: toolEvent(output: "partial…", status: "running"))
        XCTAssertNil(steps?[0].errorOutput)
    }

    func testTheReasonKeepsTheTailWhereTheErrorIs() throws {
        let log = (1...40).map { "build step \($0)" }.joined(separator: "\n")
            + "\nerror: cannot find module 'foo'"
        let steps = ActivityFold.fold([], event: toolEvent(output: log, status: "error"))!
        let reason = try XCTUnwrap(steps[0].errorOutput)
        XCTAssertTrue(reason.hasSuffix("error: cannot find module 'foo'"))
        XCTAssertFalse(reason.contains("build step 1\n"), "the head of the log is not the reason")
        XCTAssertLessThanOrEqual(reason.split(separator: "\n").count, ActivityFold.errorOutputLines)
    }

    func testTheLiveTruncationMarkerIsNotReportedAsTheReason() {
        // capLiveToolPayload head-caps and glues a marker on the end, so the
        // literal tail of a long live payload is the marker, not the failure.
        let output = "error: the build failed\n[tool payload truncated]"
        let steps = ActivityFold.fold([], event: toolEvent(output: output, status: "error"))!
        XCTAssertEqual(steps[0].errorOutput, "error: the build failed")
    }

    func testALongReasonIsCappedFromTheEnd() throws {
        let steps = ActivityFold.fold([], event: toolEvent(
            output: String(repeating: "x", count: 900), status: "error"))!
        let reason = try XCTUnwrap(steps[0].errorOutput)
        XCTAssertEqual(reason.count, ActivityFold.errorOutputCap)
        XCTAssertTrue(reason.hasPrefix("…"), "the cut end is marked")
    }

    func testPersistedFailuresKeepTheirReason() {
        let tools = [
            ToolCall(id: "1", name: "Bash", input: "pwd", output: "boom", status: "error"),
            ToolCall(id: "2", name: "Read", input: nil, output: "file contents", status: "ok"),
        ]
        let steps = ActivityFold.steps(fromTools: tools)
        XCTAssertEqual(steps?[0].errorOutput, "boom")
        XCTAssertNil(steps?[1].errorOutput, "a successful call keeps its output off the trail")
    }

    func testStepsPersistedBeforeErrorOutputStillDecode() throws {
        let legacy = #"{"id":"s1","kind":"tool","title":"Bash","status":"error"}"#
        let step = try JSONDecoder().decode(ActivityStep.self, from: Data(legacy.utf8))
        XCTAssertNil(step.errorOutput)
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

    func testProgressNoticeIsTerminalNotRunning() {
        // /api/chat/send emits "notice" for harness diagnostics (runtime
        // compatibility, rate-limit warnings). Decoding those as .running left
        // an informational line spinning for the rest of the turn.
        let steps = ActivityFold.fold([], event: progressEvent(label: "Runtime mismatch",
                                                               status: "notice"))
        XCTAssertEqual(steps?[0].status, .notice)
        XCTAssertNil(ActivityFold.settle(steps!, success: true),
                     "a notice is already settled — nothing left to coerce")
    }

    func testANoticeDoesNotHijackTheRunningStep() {
        var steps = ActivityFold.fold([], event: toolEvent(id: "t1", name: "Bash"))!
        steps = ActivityFold.fold(steps, event: progressEvent(label: "Rate limited",
                                                              status: "notice"))!
        XCTAssertEqual(steps.currentStep?.title, "Bash",
                       "the chip narrates the running tool, not the notice beside it")
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
        XCTAssertNil(ActivityFold.fold([], event: .done(
            isError: false,
            sessionId: nil,
            requestedModel: nil,
            desiredModel: nil,
            forwardedModel: nil,
            confirmedModel: nil,
            modelSource: nil,
            modelApplicationState: nil,
            modelApplicationReason: nil,
            retryModel: nil,
            requestedControls: nil,
            forwardedControls: nil,
            promptGuidanceControls: nil,
            appliedControls: nil,
            rejectedControlFamilies: nil
        )))
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

    func testTurnCompletionDoesNotInventToolOutcomes() {
        var steps = ActivityFold.fold([], event: toolEvent(id: "a", status: "ok"))!
        steps = ActivityFold.fold(steps, event: toolEvent(id: "b", name: "Edit"))!
        let ok = ActivityFold.settle(steps, success: true)
        XCTAssertEqual(ok?.map { $0.status.rawValue }, ["ok", "unknown"])
        let failed = ActivityFold.settle(steps, success: false)
        XCTAssertEqual(failed?.map { $0.status.rawValue }, ["ok", "unknown"],
                       "a failed turn also leaves an unresolved tool's outcome unknown")
    }

    func testLateStartCannotReopenACompletedTool() {
        let completed = ActivityFold.fold([], event: toolEvent(id: "late", status: "ok"))!
        let replayed = ActivityFold.fold(completed, event: toolEvent(id: "late", input: "pwd")) ?? completed
        XCTAssertEqual(replayed[0].status, .ok)
        XCTAssertEqual(replayed[0].detail, "pwd", "late arguments can fill missing details without regressing the outcome")
    }

    func testLateResultCanResolveAnUnknownOutcome() {
        let running = ActivityFold.fold([], event: toolEvent(id: "late-result"))!
        let unknown = ActivityFold.settle(running, success: true)!
        let resolved = ActivityFold.fold(unknown, event: toolEvent(id: "late-result", status: "ok"))!
        XCTAssertEqual(resolved[0].status, .ok)
    }

    func testUnknownOutcomeSurvivesSnapshotWithoutBecomingSuccess() throws {
        let running = ActivityFold.fold([], event: toolEvent())!
        let unknown = ActivityFold.settle(running, success: true)!
        let restored = try JSONDecoder().decode([ActivityStep].self, from: JSONEncoder().encode(unknown))
        XCTAssertEqual(restored[0].status, .unknown)
        XCTAssertEqual(restored.summaryLabel, "1 tool call · 1 outcome unknown")
    }

    func testUnrecognizedToolStatusDoesNotCreateAnEndlessSpinner() {
        let steps = ActivityFold.fold([], event: toolEvent(status: "future-protocol-state"))!
        XCTAssertEqual(steps[0].status, .unknown)
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
        XCTAssertEqual(steps?.map { $0.status.rawValue }, ["ok", "error", "unknown"],
                       "historical calls without an outcome never acquire a success marker")
        XCTAssertEqual(steps?[0].detail, "pwd")
    }

    func testPersistedToolsKeepTheirSummaryAndDuration() {
        // History replays the same payload shape the stream sent, so a reloaded
        // transcript must read identically to the live turn — argument summary
        // included, and the duration the server recorded alongside it.
        let tools = [ToolCall(id: "1", name: "Read",
                              input: "{\n  \"file_path\": \"src/lib/foo.ts\"\n}",
                              output: nil, status: "ok", durationMs: 42)]
        let steps = ActivityFold.steps(fromTools: tools)
        XCTAssertEqual(steps?[0].detail, "src/lib/foo.ts")
        XCTAssertEqual(steps?[0].durationMs, 42)
    }

    func testPersistedToolsDecodeDurationFromTheServerPayload() throws {
        let json = #"{"id":"t1","name":"Bash","input":"pwd","status":"ok","durationMs":900}"#
        let tool = try JSONDecoder().decode(ToolCall.self, from: Data(json.utf8))
        XCTAssertEqual(tool.durationMs, 900)
        // Turns persisted before the field still decode.
        let legacy = #"{"id":"t2","name":"Bash","status":"ok"}"#
        XCTAssertNil(try JSONDecoder().decode(ToolCall.self, from: Data(legacy.utf8)).durationMs)
    }

    func testStepsFromNilOrEmptyToolsIsNil() {
        XCTAssertNil(ActivityFold.steps(fromTools: nil))
        XCTAssertNil(ActivityFold.steps(fromTools: []))
    }

    // MARK: - Summaries

    func testSummaryLabelCountsToolsAndFailures() {
        var steps = ActivityFold.fold([], event: toolEvent(id: "a", status: "ok"))!
        XCTAssertEqual(steps.summaryLabel, "1 tool call")
        steps = ActivityFold.fold(steps, event: toolEvent(id: "b", name: "Edit", status: "error"))!
        XCTAssertEqual(steps.summaryLabel, "2 tool calls · 1 failed")
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
        guard case .toolUse(let id, let name, let input, _, let status, let durationMs, _)? =
                StreamEvent.decode(json) else {
            return XCTFail("expected a toolUse event")
        }
        XCTAssertEqual(id, "t1")
        XCTAssertEqual(name, "Bash")
        XCTAssertEqual(input, "ls")
        XCTAssertEqual(status, "ok")
        XCTAssertEqual(durationMs, 123)
    }

    func testAToolFrameOffTheWireReadsAsItsArgument() throws {
        // End to end over the real frame shape: the server JSON-encodes an
        // already-pretty-printed input, so the escaped newlines survive decode
        // and land in the fold. This is the label the chip shows.
        let frame = #"{"kind":"tool_use","id":"t1","name":"Read","input":"{\n  \"file_path\": \"src/lib/foo.ts\"\n}","status":"running"}"#
        guard let event = StreamEvent.decode(frame) else {
            return XCTFail("expected a toolUse event")
        }
        let steps = ActivityFold.fold([], event: event)
        XCTAssertEqual(steps?.currentStep?.title, "Read")
        XCTAssertEqual(steps?.currentStep?.detail, "src/lib/foo.ts")
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
