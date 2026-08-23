import Foundation
import XCTest
@testable import CovenCave

private final class LiveVoiceCallModelURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let handler = try XCTUnwrap(Self.handler)
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

@MainActor
final class LiveVoiceCallModelTests: XCTestCase {
    override func tearDown() {
        LiveVoiceCallModelURLProtocol.handler = nil
        super.tearDown()
    }

    private func familiar(voiceProvider: String? = "openai") -> Familiar {
        var json: [String: Any] = ["id": "nova", "display_name": "Nova"]
        if let voiceProvider { json["voiceProvider"] = voiceProvider }
        let data = try! JSONSerialization.data(withJSONObject: json)
        return try! JSONDecoder().decode(Familiar.self, from: data)
    }

    private func client(
        handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> CaveClient {
        LiveVoiceCallModelURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LiveVoiceCallModelURLProtocol.self]
        return CaveClient(
            connection: CaveConnection(host: "http://cave.test:3000"),
            session: URLSession(configuration: configuration)
        )
    }

    private func response(for request: URLRequest, status: Int, body: String) throws -> (HTTPURLResponse, Data) {
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: status,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )
        )
        return (response, Data(body.utf8))
    }

    private var grantResponseBody: String {
        """
        {
          "ok": true,
          "callId": "01JVOICECALL00000000000000",
          "grant": {
            "provider": "openai",
            "clientSecret": "ek_short_lived",
            "expiresAt": "2026-07-29T18:00:00Z",
            "connection": {
              "kind": "openai-realtime",
              "url": "https://api.openai.com/v1/realtime/calls",
              "model": "gpt-realtime",
              "voice": "alloy"
            }
          }
        }
        """
    }

    func testEndingAnAutoCreatedCallWithoutTranscriptDiscardsTheEmptySession() async throws {
        let transport = RecordingVoiceTransport()
        let media = RecordingVoiceMediaSession()
        var deletedSessionIds: [String] = []
        var discardedSessionIds: [String] = []
        let client = client { [self] request in
            switch (request.httpMethod, request.url?.path, request.url?.query) {
            case ("POST", "/api/chat/conversation", _):
                return try response(for: request, status: 200, body: #"{"ok":true,"sessionId":"voice-empty"}"#)
            case ("POST", "/api/voice/session", _):
                return try response(for: request, status: 200, body: grantResponseBody)
            case ("DELETE", "/api/chat/conversation/voice-empty", "ifEmpty=1"):
                deletedSessionIds.append("voice-empty")
                return try response(for: request, status: 200, body: #"{"ok":true,"deleted":true}"#)
            default:
                XCTFail("Unexpected request: \(request.httpMethod ?? "?") \(request.url?.absoluteString ?? "?")")
                return try response(for: request, status: 500, body: #"{"ok":false}"#)
            }
        }

        let model = LiveVoiceCallModel(
            familiar: familiar(),
            sessionId: nil,
            projectRoot: "/repos/cave",
            client: client,
            onSessionDiscarded: { discardedSessionIds.append($0) },
            makeRealtimeTransport: { transport },
            makeMediaSession: { media }
        )

        await model.start()
        XCTAssertEqual(model.state.sessionId, "voice-empty")

        model.end()
        await model.waitForPendingCleanup()

        XCTAssertEqual(model.state.phase, .ended)
        XCTAssertNil(model.state.sessionId)
        XCTAssertEqual(deletedSessionIds, ["voice-empty"])
        XCTAssertEqual(discardedSessionIds, ["voice-empty"])
    }

    func testTranscriptContentPreservesAnAutoCreatedSessionOnEnd() async throws {
        let transport = RecordingVoiceTransport()
        let media = RecordingVoiceMediaSession()
        var deletedSessionIds: [String] = []
        var establishedSessionIds: [String] = []
        let client = client { [self] request in
            switch (request.httpMethod, request.url?.path, request.url?.query) {
            case ("POST", "/api/chat/conversation", _):
                return try response(for: request, status: 200, body: #"{"ok":true,"sessionId":"voice-keep"}"#)
            case ("POST", "/api/voice/session", _):
                return try response(for: request, status: 200, body: grantResponseBody)
            case ("DELETE", "/api/chat/conversation/voice-keep", "ifEmpty=1"):
                deletedSessionIds.append("voice-keep")
                return try response(for: request, status: 200, body: #"{"ok":true,"deleted":true}"#)
            default:
                XCTFail("Unexpected request: \(request.httpMethod ?? "?") \(request.url?.absoluteString ?? "?")")
                return try response(for: request, status: 500, body: #"{"ok":false}"#)
            }
        }

        let model = LiveVoiceCallModel(
            familiar: familiar(),
            sessionId: nil,
            projectRoot: "/repos/cave",
            client: client,
            onSessionEstablished: { establishedSessionIds.append($0) },
            makeRealtimeTransport: { transport },
            makeMediaSession: { media }
        )

        await model.start()
        transport.emit(.connected)
        transport.emit(.final(role: .user, text: "Hello", segmentID: "user-1"))

        model.end()
        await model.waitForPendingCleanup()

        XCTAssertEqual(establishedSessionIds, ["voice-keep"])
        XCTAssertTrue(deletedSessionIds.isEmpty)
        XCTAssertEqual(model.state.transcript.map(\.text), ["Hello"])
    }

    func testMicrophoneDenialDiscardsAnAutoCreatedSession() async throws {
        let transport = RecordingVoiceTransport()
        let media = RecordingVoiceMediaSession()
        media.prepareError = VoiceCallMediaError.microphoneDenied
        var discardedSessionIds: [String] = []
        let client = client { [self] request in
            switch (request.httpMethod, request.url?.path, request.url?.query) {
            case ("POST", "/api/chat/conversation", _):
                return try response(for: request, status: 200, body: #"{"ok":true,"sessionId":"voice-mic-denied"}"#)
            case ("POST", "/api/voice/session", _):
                return try response(for: request, status: 200, body: grantResponseBody)
            case ("DELETE", "/api/chat/conversation/voice-mic-denied", "ifEmpty=1"):
                return try response(for: request, status: 200, body: #"{"ok":true,"deleted":true}"#)
            default:
                XCTFail("Unexpected request: \(request.httpMethod ?? "?") \(request.url?.absoluteString ?? "?")")
                return try response(for: request, status: 500, body: #"{"ok":false}"#)
            }
        }

        let model = LiveVoiceCallModel(
            familiar: familiar(),
            sessionId: nil,
            projectRoot: "/repos/cave",
            client: client,
            onSessionDiscarded: { discardedSessionIds.append($0) },
            makeRealtimeTransport: { transport },
            makeMediaSession: { media }
        )

        await model.start()
        await model.waitForPendingCleanup()

        XCTAssertEqual(model.state.phase, .error("microphone_denied"))
        XCTAssertNil(model.state.sessionId)
        XCTAssertEqual(discardedSessionIds, ["voice-mic-denied"])
    }

    func testSetupFailureNeverDeletesAPreBoundSession() async throws {
        let transport = RecordingVoiceTransport()
        let media = RecordingVoiceMediaSession()
        media.prepareError = VoiceCallMediaError.microphoneDenied
        var deletedSessionIds: [String] = []
        let client = client { [self] request in
            switch (request.httpMethod, request.url?.path, request.url?.query) {
            case ("POST", "/api/voice/session", _):
                return try response(for: request, status: 200, body: grantResponseBody)
            case ("DELETE", _, _):
                deletedSessionIds.append(request.url?.absoluteString ?? "")
                return try response(for: request, status: 200, body: #"{"ok":true,"deleted":true}"#)
            default:
                XCTFail("Unexpected request: \(request.httpMethod ?? "?") \(request.url?.absoluteString ?? "?")")
                return try response(for: request, status: 500, body: #"{"ok":false}"#)
            }
        }

        let model = LiveVoiceCallModel(
            familiar: familiar(),
            sessionId: "existing-session",
            projectRoot: "/repos/cave",
            client: client,
            makeRealtimeTransport: { transport },
            makeMediaSession: { media }
        )

        await model.start()
        await model.waitForPendingCleanup()

        XCTAssertEqual(model.state.phase, .error("microphone_denied"))
        XCTAssertEqual(model.state.sessionId, "existing-session")
        XCTAssertTrue(deletedSessionIds.isEmpty)
    }

    func testCleanupFailureReportsANonfatalWarningWithoutHidingMintFailure() async throws {
        var warnings: [String] = []
        let client = client { [self] request in
            switch (request.httpMethod, request.url?.path, request.url?.query) {
            case ("POST", "/api/chat/conversation", _):
                return try response(for: request, status: 200, body: #"{"ok":true,"sessionId":"voice-orphan"}"#)
            case ("POST", "/api/voice/session", _):
                return try response(
                    for: request,
                    status: 400,
                    body: #"{"ok":false,"error":"voice_not_configured","hint":"Choose a voice provider."}"#
                )
            case ("DELETE", "/api/chat/conversation/voice-orphan", "ifEmpty=1"):
                return try response(for: request, status: 500, body: #"{"error":"cleanup_failed"}"#)
            default:
                XCTFail("Unexpected request: \(request.httpMethod ?? "?") \(request.url?.absoluteString ?? "?")")
                return try response(for: request, status: 500, body: #"{"ok":false}"#)
            }
        }

        let model = LiveVoiceCallModel(
            familiar: familiar(),
            sessionId: nil,
            projectRoot: "/repos/cave",
            client: client,
            onCleanupWarning: { warnings.append($0) }
        )

        await model.start()
        await model.waitForPendingCleanup()

        guard case .fallbackOffer(let copy) = model.launch else {
            return XCTFail("Expected a fallback offer after mint failure")
        }
        XCTAssertTrue(copy.message.contains("voice_not_configured"))
        XCTAssertEqual(model.state.sessionId, "voice-orphan")
        XCTAssertEqual(warnings.count, 1)
        XCTAssertTrue(warnings[0].contains("Couldn't discard the empty voice chat"))
    }

    func testCleanupFailureRetryingAnEmptyCallRetriesDiscardAndEventuallySucceeds() async throws {
        let firstTransport = RecordingVoiceTransport()
        let secondTransport = RecordingVoiceTransport()
        let firstMedia = RecordingVoiceMediaSession()
        let secondMedia = RecordingVoiceMediaSession()
        var deletedSessionIds: [String] = []
        var discardedSessionIds: [String] = []
        var warnings: [String] = []
        let client = client { [self] request in
            switch (request.httpMethod, request.url?.path, request.url?.query) {
            case ("POST", "/api/chat/conversation", _):
                return try response(for: request, status: 200, body: #"{"ok":true,"sessionId":"voice-retry-empty"}"#)
            case ("POST", "/api/voice/session", _):
                return try response(for: request, status: 200, body: grantResponseBody)
            case ("DELETE", "/api/chat/conversation/voice-retry-empty", "ifEmpty=1"):
                deletedSessionIds.append("voice-retry-empty")
                if deletedSessionIds.count == 1 {
                    return try response(for: request, status: 500, body: #"{"error":"cleanup_failed"}"#)
                }
                return try response(for: request, status: 200, body: #"{"ok":true,"deleted":true}"#)
            default:
                XCTFail("Unexpected request: \(request.httpMethod ?? "?") \(request.url?.absoluteString ?? "?")")
                return try response(for: request, status: 500, body: #"{"ok":false}"#)
            }
        }

        var realtimeTransports: [RecordingVoiceTransport] = [firstTransport, secondTransport]
        var mediaSessions: [RecordingVoiceMediaSession] = [firstMedia, secondMedia]
        let model = LiveVoiceCallModel(
            familiar: familiar(),
            sessionId: nil,
            projectRoot: "/repos/cave",
            client: client,
            onSessionDiscarded: { discardedSessionIds.append($0) },
            onCleanupWarning: { warnings.append($0) },
            makeRealtimeTransport: { realtimeTransports.removeFirst() },
            makeMediaSession: { mediaSessions.removeFirst() }
        )

        await model.start()
        XCTAssertEqual(model.state.sessionId, "voice-retry-empty")

        model.end()
        await model.waitForPendingCleanup()

        XCTAssertEqual(deletedSessionIds, ["voice-retry-empty"])
        XCTAssertEqual(warnings.count, 1)
        XCTAssertEqual(model.state.sessionId, "voice-retry-empty")

        await model.retry()

        XCTAssertEqual(secondTransport.startedContexts.map(\.sessionId), ["voice-retry-empty"])

        model.end()
        await model.waitForPendingCleanup()

        XCTAssertEqual(deletedSessionIds, ["voice-retry-empty", "voice-retry-empty"])
        XCTAssertEqual(discardedSessionIds, ["voice-retry-empty"])
        XCTAssertNil(model.state.sessionId)
    }

    func testCommittedFallbackSessionNeverRetriesDiscardAfterCleanupFailure() async throws {
        let nativeTransport = RecordingVoiceTransport()
        let media = RecordingVoiceMediaSession()
        var deletedSessionIds: [String] = []
        var warnings: [String] = []
        var establishedSessionIds: [String] = []
        let client = client { [self] request in
            switch (request.httpMethod, request.url?.path, request.url?.query) {
            case ("POST", "/api/chat/conversation", _):
                return try response(for: request, status: 200, body: #"{"ok":true,"sessionId":"voice-fallback-keep"}"#)
            case ("POST", "/api/voice/session", _):
                return try response(
                    for: request,
                    status: 400,
                    body: #"{"ok":false,"error":"voice_not_configured","hint":"Choose a voice provider."}"#
                )
            case ("DELETE", "/api/chat/conversation/voice-fallback-keep", "ifEmpty=1"):
                deletedSessionIds.append("voice-fallback-keep")
                return try response(for: request, status: 500, body: #"{"error":"cleanup_failed"}"#)
            default:
                XCTFail("Unexpected request: \(request.httpMethod ?? "?") \(request.url?.absoluteString ?? "?")")
                return try response(for: request, status: 500, body: #"{"ok":false}"#)
            }
        }

        let model = LiveVoiceCallModel(
            familiar: familiar(),
            sessionId: nil,
            projectRoot: "/repos/cave",
            client: client,
            onSessionEstablished: { establishedSessionIds.append($0) },
            onCleanupWarning: { warnings.append($0) },
            makeNativeTransport: { _ in nativeTransport },
            makeMediaSession: { media }
        )

        await model.start()
        await model.waitForPendingCleanup()

        guard case .fallbackOffer = model.launch else {
            return XCTFail("Expected a fallback offer after mint failure")
        }
        XCTAssertEqual(deletedSessionIds, ["voice-fallback-keep"])
        XCTAssertEqual(model.state.sessionId, "voice-fallback-keep")
        XCTAssertEqual(warnings.count, 1)

        await model.acceptOnDeviceFallback()
        XCTAssertEqual(nativeTransport.startedContexts.map(\.sessionId), ["voice-fallback-keep"])

        nativeTransport.emit(.connected)
        nativeTransport.emit(.final(role: .user, text: "Hello", segmentID: "user-1"))

        model.end()
        await model.waitForPendingCleanup()

        XCTAssertEqual(establishedSessionIds, ["voice-fallback-keep"])
        XCTAssertEqual(deletedSessionIds, ["voice-fallback-keep"])
        XCTAssertEqual(model.state.transcript.map(\.text), ["Hello"])
        XCTAssertEqual(model.state.sessionId, "voice-fallback-keep")
    }

    func testHangupAfterMidReplySessionBindingKeepsTheThreadBoundForTheNextCall() async throws {
        let firstTransport = RecordingVoiceTransport()
        let secondTransport = RecordingVoiceTransport()
        let firstMedia = RecordingVoiceMediaSession()
        let secondMedia = RecordingVoiceMediaSession()
        var establishedSessionIds: [String] = []
        let client = client { [self] request in
            XCTFail("Unexpected request: \(request.httpMethod ?? "?") \(request.url?.absoluteString ?? "?")")
            return try response(for: request, status: 500, body: #"{"ok":false}"#)
        }

        let model = LiveVoiceCallModel(
            familiar: familiar(voiceProvider: "anthropic"),
            sessionId: nil,
            projectRoot: "/repos/cave",
            client: client,
            onSessionEstablished: { establishedSessionIds.append($0) },
            makeNativeTransport: { _ in firstTransport },
            makeMediaSession: { firstMedia }
        )

        await model.start()
        firstTransport.emit(.connected)
        firstTransport.emit(.final(role: .user, text: "Hello", segmentID: "user-1"))
        firstTransport.emit(.processing)

        model.end()
        firstTransport.emit(.sessionBound("session-mid-reply"))
        firstTransport.emit(.sessionBound("session-mid-reply"))
        firstTransport.emit(.speaking)
        firstTransport.emit(.final(role: .assistant, text: "Ignore", segmentID: "assistant-1"))
        await model.waitForPendingCleanup()

        XCTAssertEqual(model.state.phase, .ended)
        XCTAssertEqual(model.state.sessionId, "session-mid-reply")
        XCTAssertEqual(establishedSessionIds, ["session-mid-reply"])
        XCTAssertEqual(model.state.transcript.map(\.text), ["Hello"])

        let resumedModel = LiveVoiceCallModel(
            familiar: familiar(voiceProvider: "anthropic"),
            sessionId: establishedSessionIds.last,
            projectRoot: "/repos/cave",
            client: client,
            makeNativeTransport: { _ in secondTransport },
            makeMediaSession: { secondMedia }
        )

        await resumedModel.start()

        XCTAssertEqual(secondTransport.startedContexts.map(\.sessionId), ["session-mid-reply"])
    }
}

@MainActor
private final class RecordingVoiceTransport: VoiceCallTransport {
    var onEvent: (@MainActor (VoiceCallEvent) -> Void)?
    private(set) var startCalls = 0
    private(set) var startedContexts: [VoiceCallTransportContext] = []

    func start(with context: VoiceCallTransportContext) async throws {
        startCalls += 1
        startedContexts.append(context)
    }

    func setMuted(_ muted: Bool) {}

    func stop() {}

    func emit(_ event: VoiceCallEvent) {
        onEvent?(event)
    }
}

@MainActor
private final class RecordingVoiceMediaSession: VoiceMediaSessionManaging {
    var onInterruption: (@MainActor () -> Void)?
    var onRouteChange: (@MainActor () -> Void)?
    var prepareError: Error?

    func prepare(mode: VoiceCallMode, needsSpeechRecognition: Bool) async throws {
        if let prepareError { throw prepareError }
    }

    func stop() {}
}
