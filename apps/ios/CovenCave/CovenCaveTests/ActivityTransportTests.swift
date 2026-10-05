import Foundation
import XCTest
@testable import CovenCave

/// Opt-in real TCP gate driven by scripts/runtime-activity-native-transport.mjs.
/// URLSession responses are never intercepted. The only synthetic producer is
/// the external Hermes API; Cave owns auth, projection, replay and persistence.
@MainActor
final class ActivityTransportTests: XCTestCase {
    private struct Configuration: Decodable {
        let origin: String
        let token: String
        let projectRoot: String
        let marker: String
        let releaseURL: String
        let restartURL: String
    }

    private struct Scenario: Decodable {
        struct Expected: Decodable {
            let harness: String
            let model: String
            let toolId: String
            let toolName: String
            let answer: String
            let summaries: [String]
            let privateSentinels: [String]
        }
        let schemaVersion: Int
        let expected: Expected
    }

    private func scenario() throws -> Scenario {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "runtime-activity-http-v1", withExtension: "json"))
        let value = try JSONDecoder().decode(Scenario.self, from: Data(contentsOf: url))
        XCTAssertEqual(value.schemaVersion, 1)
        return value
    }

    func testSharedHTTPScenarioIsBundled() throws {
        let value = try scenario()
        XCTAssertEqual(value.expected.summaries.count, 2)
        XCTAssertEqual(value.expected.harness, "hermes")
    }

    private final class Observation {
        var text = ""
        var sessionId: String?
        var cursor = 0
        var identity: ChatRuntimeIdentity?
        var tools: [ActivityStep] = []
        var summaries: [ChatReasoningBlock] = []
        var done = false
        var toolStatuses: [String] = []

        func apply(_ frame: CaveClient.StreamFrame) {
            if let id = frame.id { cursor = max(cursor, id) }
            switch frame.event {
            case .session(let id): sessionId = id
            case .runtimeIdentity(let report): identity = report
            case .assistantChunk(let chunk): text += chunk
            case .assistantReplace(let replacement, let correction):
                text = replacement
                if let correction {
                    summaries = summaries.map { block in var block = block; block.textOffset = correction.rebase(block.textOffset); return block }
                    tools = tools.map { tool in var tool = tool; tool.textOffset = correction.rebase(tool.textOffset); return tool }
                }
            case .reasoning(let block): summaries = ChatReasoningBlock.merging(summaries, block)
            case .toolUse(_, _, _, _, let status, _, _):
                toolStatuses.append(status ?? "unknown")
                tools = ActivityFold.fold(tools, event: frame.event, textOffset: text.utf16.count) ?? tools
            case .done: done = true
            case .error(let message): XCTFail("Unexpected stream error: \(message)")
            default: break
            }
        }
    }

    func testRealHTTPStreamReconnectHistoryAndAuthorizedOutput() async throws {
        guard let raw = ProcessInfo.processInfo.environment["CAVE_NATIVE_ACTIVITY_FIXTURE"] else {
            throw XCTSkip("Run scripts/runtime-activity-native-transport.mjs for the built-server TCP gate")
        }
        let config = try JSONDecoder().decode(Configuration.self, from: Data(raw.utf8))
        let expected = try scenario().expected
        let base = try XCTUnwrap(URL(string: config.origin))
        guard base.scheme == "http", base.host == "127.0.0.1" else {
            XCTFail("This fixture is confined to the owned loopback server")
            return
        }
        guard try DeviceAccessStore.loadActive() == nil else {
            throw XCTSkip("Preserving the simulator's managed grant")
        }
        let previousToken = KeychainStore.string(forKey: CaveConnection.tokenKey)
        let previousOrigin = KeychainStore.string(forKey: CaveConnection.tokenOriginKey)
        defer {
            for (key, value) in [(CaveConnection.tokenKey, previousToken), (CaveConnection.tokenOriginKey, previousOrigin)] {
                if let value { KeychainStore.set(value, forKey: key) } else { KeychainStore.remove(key) }
                XCTAssertTrue(KeychainStore.string(forKey: key) == value, "Restore the simulator's prior credential state")
            }
        }
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.urlCache = nil
        sessionConfig.httpCookieStorage = nil
        sessionConfig.httpShouldSetCookies = false
        // Simulate forwarded ingress at the real listener so loopback trust
        // cannot hide missing credentials. No headers replace Bearer auth.
        sessionConfig.httpAdditionalHeaders = ["x-forwarded-for": "203.0.113.9", "Origin": config.origin]
        let session = URLSession(configuration: sessionConfig)
        defer { session.invalidateAndCancel() }
        let connection = CaveConnection(host: config.origin)
        let client = CaveClient(connection: connection, session: session)
        CaveConnection.saveAccessToken(config.token, for: base)
        XCTAssertEqual(try CaveConnection.credentialForRequest(to: base), config.token)

        let live = Observation()
        let started = expectation(description: "native client observes tool execution before disconnect")
        let runId = UUID().uuidString
        let body = CaveClient.SendBody(familiarId: "nativeactivity", prompt: "Read the controlled marker.",
            projectRoot: config.projectRoot, runId: runId)
        let sendTask = Task {
            do {
                var signalled = false
                for try await frame in client.sendStream(body) {
                    live.apply(frame)
                    if !signalled && live.toolStatuses.contains("running") {
                        signalled = true
                        started.fulfill()
                    }
                }
            } catch {
                if !Task.isCancelled { XCTFail("Initial stream failed: \(error)") }
            }
        }
        await fulfillment(of: [started], timeout: 30)
        sendTask.cancel()
        await sendTask.value
        XCTAssertFalse(live.done, "the transport is interrupted before the final frame")
        XCTAssertGreaterThan(live.cursor, 0)
        let cursor = live.cursor
        let interrupted = DisplayMessage(role: .assistant, familiarId: "nativeactivity",
            text: live.text, streaming: true, activity: live.tools,
            runtimeIdentity: live.identity, reasoningBlocks: live.summaries)

        let resumeTask = Task {
            for try await frame in client.resumeStream(runId: runId, cursor: cursor) { live.apply(frame) }
        }
        defer { resumeTask.cancel() }
        var release = URLRequest(url: try XCTUnwrap(URL(string: config.releaseURL)))
        release.httpMethod = "POST"
        let (_, released) = try await URLSession.shared.data(for: release)
        XCTAssertEqual((released as? HTTPURLResponse)?.statusCode, 204)
        try await resumeTask.value
        XCTAssertTrue(live.done)
        let answer = expected.answer.replacingOccurrences(of: "{{MARKER}}", with: config.marker)
        XCTAssertEqual(live.text, answer)
        XCTAssertEqual(live.identity?.harness, expected.harness)
        XCTAssertEqual(live.identity?.model, expected.model)
        XCTAssertNil(live.identity?.version, "the API fixture provides no runtime version")
        XCTAssertEqual(live.identity?.activity?.tools, "supported")
        XCTAssertEqual(live.tools.map(\.id), [expected.toolId])
        XCTAssertEqual(live.tools.map(\.status), [.ok])
        XCTAssertEqual(live.summaries.compactMap(\.text), expected.summaries)
        XCTAssertEqual(live.summaries.compactMap { $0.observation?.sequence }, [0, 2])
        XCTAssertEqual(live.tools.compactMap { $0.activity?.sequence }, [1])
        // The provider's first text delta includes its trailing newline.
        XCTAssertEqual(live.summaries.compactMap(\.textOffset), [0, "Inspecting 🧙 café.\n".utf16.count])
        XCTAssertEqual(live.tools.compactMap(\.textOffset), ["Inspecting 🧙 café.\n".utf16.count])

        let sessionId = try XCTUnwrap(live.sessionId)
        let loadedConversation = try await client.conversation(sessionId: sessionId)
        let conversation = try XCTUnwrap(loadedConversation)
        let turn = try XCTUnwrap(conversation.turns.last(where: { $0.role == "assistant" }))
        let restored = DisplayMessage.restored(from: turn, familiarId: "nativeactivity")
        XCTAssertEqual(restored.text, answer)
        XCTAssertEqual(restored.runtimeIdentity, live.identity)
        XCTAssertEqual(restored.activitySteps, live.tools)
        XCTAssertEqual(restored.reasoningBlocks, live.summaries)
        let snapshot = try JSONDecoder().decode(DisplayMessage.self, from: JSONEncoder().encode(restored))
        XCTAssertEqual(snapshot.runtimeIdentity, live.identity)
        XCTAssertEqual(snapshot.activitySteps, live.tools)

        for _ in 0..<2 {
            let replay = Observation()
            for try await frame in client.resumeStream(runId: runId, cursor: 0) { replay.apply(frame) }
            XCTAssertTrue(replay.done)
            XCTAssertEqual(replay.text, live.text)
            XCTAssertEqual(replay.identity, live.identity)
            XCTAssertEqual(replay.tools, live.tools)
            XCTAssertEqual(replay.summaries, live.summaries)
        }
        let output = try await client.toolOutput(sessionId: sessionId, toolId: expected.toolId)
        XCTAssertTrue(output.contains(config.marker))
        let serialized = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)
        for sentinel in expected.privateSentinels {
            XCTAssertFalse(serialized.contains(sentinel))
            XCTAssertFalse(output.contains(sentinel))
        }

        // The ring is process-local. A real server restart must expose that
        // loss rather than replay an invented success or dispatch another turn.
        var restart = URLRequest(url: try XCTUnwrap(URL(string: config.restartURL)))
        restart.httpMethod = "POST"
        restart.timeoutInterval = 150
        let (_, restarted) = try await URLSession.shared.data(for: restart)
        XCTAssertEqual((restarted as? HTTPURLResponse)?.statusCode, 204)
        for key in [runId, sessionId] {
            do {
                for try await _ in client.resumeStream(runId: key, cursor: 0) {
                    XCTFail("A restarted server cannot retain this process-local replay")
                }
                XCTFail("The lost replay must report NoResumableRun")
            } catch is CaveClient.NoResumableRun {
                // Canonical saved history, not another send, owns recovery.
            }
        }
        for _ in 0..<2 {
            let reloaded = try await client.conversation(sessionId: sessionId)
            let saved = try XCTUnwrap(reloaded?.turns.last(where: { $0.role == "assistant" }))
            let recovered = DisplayMessage.restored(from: saved, familiarId: "nativeactivity")
            XCTAssertEqual(recovered.text, live.text)
            XCTAssertEqual(recovered.runtimeIdentity, live.identity)
            XCTAssertEqual(recovered.activitySteps, live.tools)
            XCTAssertEqual(recovered.reasoningBlocks, live.summaries)
            let savedOutput = try await client.toolOutput(sessionId: sessionId, toolId: expected.toolId)
            XCTAssertEqual(savedOutput, output)
        }
        // Exercise the production thread's exact-delivery reconciliation, not
        // only the independent history decoder. A phone may retain a partial
        // bubble or no assistant bubble when the process-local replay is lost.
        for partial in [false, true] {
            let thread = ChatThread(title: "Native recovery", familiarIds: ["nativeactivity"],
                sessionIds: ["nativeactivity": sessionId], projectRoot: config.projectRoot)
            let user = DisplayMessage(role: .user, text: body.prompt, queued: true,
                queuedRunIdsByFamiliarId: ["nativeactivity": runId],
                queuedAttemptedFamiliarIds: ["nativeactivity"],
                queuedTargetFamiliarIds: ["nativeactivity"],
                queuedContext: .init(projectRoot: config.projectRoot, sessionIds: ["nativeactivity": sessionId]))
            thread.messages = partial ? [user, interrupted] : [user]
            await thread.replayQueued(client: client,
                onConnectionFailure: { XCTFail("Saved recovery failed: \($0)") },
                dispatchLeaseIsCurrent: { true },
                targetAccessIsCurrent: { $0 == config.projectRoot && $1 == "nativeactivity" },
                onAccessRefused: { XCTFail("Unexpected fixture access refusal: \(String(describing: $0))") },
                persistBeforeDispatch: { XCTFail("Accepted delivery must not dispatch again"); return false },
                persistAfterRollback: { true }, onChange: {})
            XCTAssertEqual(thread.messages.count, 2)
            XCTAssertFalse(thread.messages[0].isQueued)
            let adopted = try XCTUnwrap(thread.messages.last)
            if partial { XCTAssertEqual(adopted.id, interrupted.id, "recovery keeps the mounted message identity") }
            XCTAssertEqual(adopted.serverTurnId, turn.id)
            XCTAssertFalse(adopted.streaming)
            XCTAssertFalse(adopted.isError)
            XCTAssertEqual(adopted.text, live.text)
            XCTAssertEqual(adopted.runtimeIdentity, live.identity)
            XCTAssertEqual(adopted.activitySteps, live.tools, "late saved tools survive thread recovery")
            XCTAssertEqual(adopted.reasoningBlocks, live.summaries, "late saved summaries survive thread recovery")
            XCTAssertEqual(adopted.toolOutputReference,
                ToolOutputReference(sessionId: sessionId, connection: client.connection))
        }
        CaveConnection.saveAccessToken("fixture-denied", for: base)
        do {
            _ = try await client.toolOutput(sessionId: sessionId, toolId: expected.toolId)
            XCTFail("A prior authorized read cannot satisfy a new denied read")
        } catch {
            XCTAssertEqual(error as? ToolOutputError, .unauthorized)
        }
    }
}
