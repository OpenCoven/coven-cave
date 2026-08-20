import XCTest
@testable import CovenCave

@MainActor
final class CaveVoiceTurnSenderTests: XCTestCase {
    func testFreshRegisteredProjectTurnSendsProjectRootAndBindsReturnedSession() async throws {
        var sentBody: CaveClient.SendBody?
        let sender = CaveVoiceTurnSender { body in
            sentBody = body
            return AsyncThrowingStream { continuation in
                continuation.yield(CaveClient.StreamFrame(
                    event: .session(sessionId: "session-1"),
                    id: 1
                ))
                continuation.yield(CaveClient.StreamFrame(
                    event: .assistantChunk(text: "Hello"),
                    id: 2
                ))
                continuation.yield(CaveClient.StreamFrame(
                    event: .done(
                        isError: false,
                        sessionId: "session-1",
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
                    ),
                    id: 3
                ))
                continuation.finish()
            }
        }

        let reply = try await sender.sendRecognizedTurn(
            "hello",
            familiarId: "nova",
            sessionId: nil,
            projectRoot: "/repos/alpha"
        )

        XCTAssertEqual(sentBody?.familiarId, "nova")
        XCTAssertEqual(sentBody?.prompt, "hello")
        XCTAssertNil(sentBody?.sessionId)
        XCTAssertEqual(sentBody?.projectRoot, "/repos/alpha")
        XCTAssertEqual(reply.text, "Hello")
        XCTAssertEqual(reply.sessionId, "session-1")
    }

    func testMissingLaunchContextFailsClosed() async {
        let sender = CaveVoiceTurnSender { _ in
            AsyncThrowingStream { continuation in
                continuation.finish()
            }
        }

        do {
            _ = try await sender.sendRecognizedTurn(
                "hello",
                familiarId: "nova",
                sessionId: nil,
                projectRoot: nil
            )
            XCTFail("expected missing launch context to fail")
        } catch let error as VoiceTurnSendError {
            XCTAssertEqual(error.errorDescription, "voice_turn_project_required")
        } catch {
            XCTFail("expected voice turn launch-context failure, got \(error)")
        }
    }

    func testSessionBindingPublishesImmediatelyAndOnlyOnceBeforeStreamCompletes() async throws {
        var continuation: AsyncThrowingStream<CaveClient.StreamFrame, Error>.Continuation?
        var publishedSessionIds: [String] = []
        let sender = CaveVoiceTurnSender { _ in
            AsyncThrowingStream { streamContinuation in
                continuation = streamContinuation
            }
        }

        let replyTask = Task { @MainActor in
            try await sender.sendRecognizedTurn(
                "hello",
                familiarId: "nova",
                sessionId: nil,
                projectRoot: "/repos/alpha",
                onSessionBound: { sessionId in
                    XCTAssertTrue(Thread.isMainThread)
                    publishedSessionIds.append(sessionId)
                }
            )
        }

        for _ in 0..<20 where continuation == nil { await Task.yield() }
        let stream = try XCTUnwrap(continuation)

        stream.yield(CaveClient.StreamFrame(
            event: .session(sessionId: "session-early"),
            id: 1
        ))

        for _ in 0..<20 where publishedSessionIds.isEmpty { await Task.yield() }
        XCTAssertEqual(publishedSessionIds, ["session-early"])

        stream.yield(CaveClient.StreamFrame(
            event: .assistantChunk(text: "Hello"),
            id: 2
        ))
        stream.yield(CaveClient.StreamFrame(
            event: .done(
                isError: false,
                sessionId: "session-early",
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
            ),
            id: 3
        ))
        stream.finish()

        let reply = try await replyTask.value

        XCTAssertEqual(reply.text, "Hello")
        XCTAssertEqual(reply.sessionId, "session-early")
        XCTAssertEqual(publishedSessionIds, ["session-early"])
    }

    func testPreBoundSessionDoesNotRepublishTheSameSession() async throws {
        var publishedSessionIds: [String] = []
        let sender = CaveVoiceTurnSender { _ in
            AsyncThrowingStream { continuation in
                continuation.yield(CaveClient.StreamFrame(
                    event: .assistantChunk(text: "Hello"),
                    id: 1
                ))
                continuation.yield(CaveClient.StreamFrame(
                    event: .done(
                        isError: false,
                        sessionId: "session-1",
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
                    ),
                    id: 2
                ))
                continuation.finish()
            }
        }

        let reply = try await sender.sendRecognizedTurn(
            "hello",
            familiarId: "nova",
            sessionId: "session-1",
            projectRoot: "/repos/alpha",
            onSessionBound: { sessionId in
                publishedSessionIds.append(sessionId)
            }
        )

        XCTAssertEqual(reply.text, "Hello")
        XCTAssertEqual(reply.sessionId, "session-1")
        XCTAssertTrue(publishedSessionIds.isEmpty)
    }

    func testCancellationAfterSessionBindingReturnsTheLatestBoundSessionWithoutReadingLateReplyFrames() async throws {
        var continuation: AsyncThrowingStream<CaveClient.StreamFrame, Error>.Continuation?
        var publishedSessionIds: [String] = []
        let sender = CaveVoiceTurnSender { _ in
            AsyncThrowingStream { streamContinuation in
                continuation = streamContinuation
            }
        }

        let replyTask = Task { @MainActor in
            try await sender.sendRecognizedTurn(
                "hello",
                familiarId: "nova",
                sessionId: nil,
                projectRoot: "/repos/alpha",
                onSessionBound: { sessionId in
                    publishedSessionIds.append(sessionId)
                }
            )
        }

        for _ in 0..<20 where continuation == nil { await Task.yield() }
        let stream = try XCTUnwrap(continuation)

        stream.yield(CaveClient.StreamFrame(
            event: .session(sessionId: "session-late"),
            id: 1
        ))

        for _ in 0..<20 where publishedSessionIds.isEmpty { await Task.yield() }
        XCTAssertEqual(publishedSessionIds, ["session-late"])

        replyTask.cancel()
        stream.yield(CaveClient.StreamFrame(
            event: .assistantChunk(text: "Ignore"),
            id: 2
        ))
        stream.finish()

        let reply = try await replyTask.value

        XCTAssertEqual(reply.sessionId, "session-late")
        XCTAssertEqual(reply.text, "")
        XCTAssertEqual(publishedSessionIds, ["session-late"])
    }
}
