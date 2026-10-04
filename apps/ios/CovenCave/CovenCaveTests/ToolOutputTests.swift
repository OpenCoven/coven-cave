import Foundation
import XCTest
@testable import CovenCave

private final class ToolOutputURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    static var responseURL: URL?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try XCTUnwrap(Self.handler)(request)
            let response = HTTPURLResponse(url: Self.responseURL ?? request.url!, statusCode: status, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private actor DeferredToolOutput: ToolOutputLoading {
    let started: XCTestExpectation
    var pending: [String: CheckedContinuation<String, Error>] = [:]
    init(started: XCTestExpectation) { self.started = started }
    func toolOutput(sessionId: String, toolId: String) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            pending[toolId] = continuation
            started.fulfill()
        }
    }
    func finish(_ toolId: String, result: Result<String, Error>) {
        pending.removeValue(forKey: toolId)?.resume(with: result)
    }
}

@MainActor
final class ToolOutputTests: XCTestCase {
    private func client() -> (CaveClient, URLSession) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ToolOutputURLProtocol.self]
        let session = URLSession(configuration: config)
        return (CaveClient(connection: CaveConnection(host: "https://tool-output.example.test"), session: session), session)
    }

    func testEncodedIdentifiersCannotChangeTheTargetAndOutputIsVerbatim() async throws {
        let sessionId = "chat ?#%&🧙"
        let toolId = "call/&?toolId=other+%#🧙"
        let output = "<script>alert('plain text')</script>\n**no markdown**"
        ToolOutputURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            let url = try XCTUnwrap(request.url)
            XCTAssertEqual(url.path, "/api/chat/conversation/\(sessionId)/tool-output")
            let query = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
            XCTAssertEqual(query, [URLQueryItem(name: "toolId", value: toolId)])
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
            return (200, try JSONSerialization.data(withJSONObject: ["ok": true, "output": output]))
        }
        let (client, session) = client()
        defer { session.invalidateAndCancel(); ToolOutputURLProtocol.handler = nil }
        let actual = try await client.toolOutput(sessionId: sessionId, toolId: toolId)
        XCTAssertEqual(actual, output)
    }

    func testMalformedTargetsNeverDispatch() async {
        var calls = 0
        ToolOutputURLProtocol.handler = { _ in calls += 1; return (200, Data()) }
        let (client, session) = client()
        defer { session.invalidateAndCancel(); ToolOutputURLProtocol.handler = nil }
        let targets = [("", "a"), ("..", "a"), ("a/b", "a"), ("a\\b", "a"), ("a\0b", "a"),
                       (" chat", "a"), (String(repeating: "🧙", count: 121), "a"),
                       ("chat", ""), ("chat", " a"), ("chat", String(repeating: "🧙", count: 129))]
        for (chat, tool) in targets {
            do {
                _ = try await client.toolOutput(sessionId: chat, toolId: tool)
                XCTFail("Malformed target accepted")
            } catch { XCTAssertEqual(error as? ToolOutputError, .invalidRequest) }
        }
        XCTAssertEqual(calls, 0)
    }

    func testResponseFromAnotherEndpointCannotSupplyToolOutput() async {
        let (client, session) = client()
        defer {
            session.invalidateAndCancel()
            ToolOutputURLProtocol.handler = nil
            ToolOutputURLProtocol.responseURL = nil
        }
        ToolOutputURLProtocol.handler = { _ in (200, Data(#"{"ok":true,"output":"OTHER_SCOPE_OUTPUT"}"#.utf8)) }
        for destination in ["https://other.example.test/api/chat/conversation/chat/tool-output?toolId=a",
                            "https://tool-output.example.test/api/chat/conversation/other-chat/tool-output?toolId=a",
                            "https://tool-output.example.test/api/chat/conversation/chat/tool-output?toolId=b"] {
            ToolOutputURLProtocol.responseURL = URL(string: destination)
            do {
                _ = try await client.toolOutput(sessionId: "chat", toolId: "a")
                XCTFail("A response from a different endpoint must not become this tool's output")
            } catch { XCTAssertEqual(error as? ToolOutputError, .invalidResponse) }
        }
    }

    func testRefusalsNeverExposeErrorBodiesOrRetryUnauthorizedReads() async {
        let (client, session) = client()
        defer { session.invalidateAndCancel(); ToolOutputURLProtocol.handler = nil }
        for (status, expected) in [(400, ToolOutputError.invalidRequest), (401, .unauthorized),
                                   (403, .unauthorized), (404, .unavailable), (409, .ambiguous)] {
            var calls = 0
            ToolOutputURLProtocol.handler = { _ in
                calls += 1
                return (status, Data(#"{"ok":false,"error":"PRIVATE_SERVER_SENTINEL"}"#.utf8))
            }
            do {
                _ = try await client.toolOutput(sessionId: "chat", toolId: "a")
                XCTFail("Refusal accepted")
            } catch {
                XCTAssertEqual(error as? ToolOutputError, expected)
                XCTAssertFalse(expected.message.contains("PRIVATE_SERVER_SENTINEL"))
            }
            XCTAssertEqual(calls, 1)
        }
    }

    func testEmptyOutputIsValidButMalformedAndOversizedResponsesAreNot() async throws {
        let (client, session) = client()
        defer { session.invalidateAndCancel(); ToolOutputURLProtocol.handler = nil }
        ToolOutputURLProtocol.handler = { _ in (200, Data(#"{"ok":true,"output":""}"#.utf8)) }
        let empty = try await client.toolOutput(sessionId: "chat", toolId: "a")
        XCTAssertEqual(empty, "")
        for json in [#"{"ok":false,"output":"secret"}"#, #"{"ok":true,"output":null}"#,
                     #"{"ok":true,"output":123}"#, #"{"output":"secret"}"#, "not json"] {
            ToolOutputURLProtocol.handler = { _ in (200, Data(json.utf8)) }
            do {
                _ = try await client.toolOutput(sessionId: "chat", toolId: "a")
                XCTFail("Malformed response accepted")
            } catch { XCTAssertEqual(error as? ToolOutputError, .invalidResponse) }
        }
        // Unicode proves this cap is UTF-8 bytes, not Swift Character count.
        for body in [try JSONSerialization.data(withJSONObject: ["ok": true, "output": String(repeating: "🧙", count: 65_537)]),
                     Data(repeating: 32, count: 2 * 1024 * 1024 + 1)] {
            ToolOutputURLProtocol.handler = { _ in (200, body) }
            do {
                _ = try await client.toolOutput(sessionId: "chat", toolId: "a")
                XCTFail("Oversized response accepted")
            } catch { XCTAssertEqual(error as? ToolOutputError, .tooLarge) }
        }
    }

    func testEachReadUsesTheCurrentOriginBoundCredential() async throws {
        let keys = [CaveConnection.tokenKey, CaveConnection.tokenOriginKey, DeviceAccessStore.activeKey]
        let saved = keys.map { KeychainStore.string(forKey: $0) }
        let (client, session) = client()
        defer {
            session.invalidateAndCancel(); ToolOutputURLProtocol.handler = nil
            for (key, value) in zip(keys, saved) {
                if let value { KeychainStore.set(value, forKey: key) }
                else { KeychainStore.remove(key) }
            }
        }
        let base = try XCTUnwrap(client.connection.baseURL)
        for token in ["first-test-credential", "rotated-test-credential"] {
            CaveConnection.saveAccessToken(token, for: base)
            ToolOutputURLProtocol.handler = { request in
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(token)")
                return (200, Data(#"{"ok":true,"output":"safe"}"#.utf8))
            }
            _ = try await client.toolOutput(sessionId: "chat", toolId: "a")
        }
        CaveConnection.saveAccessToken("wrong-origin", for: URL(string: "https://other.example.test")!)
        ToolOutputURLProtocol.handler = { _ in XCTFail("Cross-origin credential dispatched"); return (200, Data()) }
        do {
            _ = try await client.toolOutput(sessionId: "chat", toolId: "a")
            XCTFail("Cross-origin read accepted")
        } catch { XCTAssertTrue(error is CaveError) }
    }

    func testClearDiscardsALateResultEvenWhenLoaderIgnoresCancellation() async {
        let started = expectation(description: "read started")
        let loader = DeferredToolOutput(started: started)
        let store = ToolOutputStore()
        let task = Task { await store.load(sessionId: "chat", toolId: "old", using: loader) }
        await fulfillment(of: [started], timeout: 2)
        XCTAssertEqual(store.state, .loading)
        store.clear()
        await loader.finish("old", result: .success("must stay cleared"))
        await task.value
        XCTAssertEqual(store.state, .idle)
    }

    func testNewReadWinsOverLateOldRead() async {
        let oldStarted = expectation(description: "old read started")
        let newStarted = expectation(description: "new read started")
        let oldLoader = DeferredToolOutput(started: oldStarted)
        let newLoader = DeferredToolOutput(started: newStarted)
        let store = ToolOutputStore()
        let old = Task { await store.load(sessionId: "old-chat", toolId: "old", using: oldLoader) }
        await fulfillment(of: [oldStarted], timeout: 2)
        let new = Task { await store.load(sessionId: "new-chat", toolId: "new", using: newLoader) }
        await fulfillment(of: [newStarted], timeout: 2)
        await newLoader.finish("new", result: .success("new output"))
        await new.value
        await oldLoader.finish("old", result: .success("old output"))
        await old.value
        XCTAssertEqual(store.state, .loaded("new output"))
    }

    func testCancelledReadNeverPublishesOutput() async {
        let started = expectation(description: "read started")
        let loader = DeferredToolOutput(started: started)
        let store = ToolOutputStore()
        let task = Task { await store.load(sessionId: "chat", toolId: "a", using: loader) }
        await fulfillment(of: [started], timeout: 2)
        task.cancel()
        await loader.finish("a", result: .success("cancelled output"))
        await task.value
        XCTAssertEqual(store.state, .idle)
    }

    func testLoaderPublishesOnlyFixedTypedFailure() async {
        let started = expectation(description: "read started")
        let loader = DeferredToolOutput(started: started)
        let store = ToolOutputStore()
        let task = Task { await store.load(sessionId: "chat", toolId: "a", using: loader) }
        await fulfillment(of: [started], timeout: 2)
        await loader.finish("a", result: .failure(ToolOutputError.unauthorized))
        await task.value
        XCTAssertEqual(store.state, .failed(.unauthorized))
    }

    func testTargetUsesRecordedConversationAndRefusesOtherDesktopOrMissingEvidence() throws {
        let connection = CaveConnection(host: "https://original.example.test/cave")
        let reference = try XCTUnwrap(ToolOutputReference(sessionId: "original-chat", connection: connection))
        let scope = ToolOutputScope(threadId: "local-thread", familiarIds: ["nyx"],
                                    sessionIds: ["nyx": "replacement-chat"], connection: connection)
        let step = ActivityStep(id: "colliding-call", kind: .tool, title: "Read", status: .ok)
        let target = ToolOutputTarget(messageId: "old-message", reference: reference, step: step,
                                      scope: scope, client: CaveClient(connection: connection))
        XCTAssertEqual(target.sessionId, "original-chat")
        let legacy = ToolOutputTarget(messageId: "old-message", reference: nil, step: step,
                                      scope: scope, client: CaveClient(connection: connection))
        XCTAssertNil(legacy.sessionId, "never guess from the current thread map or local thread id")
        for host in ["https://other.example.test/cave", "https://original.example.test/other"] {
            let moved = ToolOutputTarget(messageId: "old-message", reference: reference, step: step,
                                         scope: scope, client: CaveClient(connection: CaveConnection(host: host)))
            XCTAssertNil(moved.sessionId, "a different host or deployment cannot resolve this reference")
        }
    }

    func testReferenceNormalizesEndpointWithoutPersistingURLCredentials() throws {
        let connection = CaveConnection(host: "https://user:secret@desktop.example.test:443/cave/?token=private#fragment")
        let reference = try XCTUnwrap(ToolOutputReference(sessionId: "chat", connection: connection))
        XCTAssertEqual(reference.endpoint, "https://desktop.example.test/cave")
        XCTAssertTrue(reference.matches(CaveConnection(host: "https://desktop.example.test/cave")))
        XCTAssertFalse(reference.matches(nil))
        XCTAssertNil(ToolOutputReference(sessionId: nil, connection: connection))
    }

    func testHistorySnapshotAndDuplicateKeepTheOriginalReference() throws {
        let reference = try XCTUnwrap(ToolOutputReference(sessionId: "saved-chat",
            connection: CaveConnection(host: "https://desktop.example.test")))
        let turns = try JSONDecoder().decode([ChatTurn].self, from: Data(#"[{"id":"u","role":"user","text":"hello"},{"id":"a","role":"assistant","text":"result"}]"#.utf8))
        let messages = DisplayMessage.restoredTranscript(from: turns, familiarId: "nyx", toolOutputReference: reference)
        XCTAssertNil(messages[0].toolOutputReference)
        XCTAssertEqual(messages[1].toolOutputReference, reference)
        let reloaded = try JSONDecoder().decode(DisplayMessage.self, from: JSONEncoder().encode(messages[1]))
        XCTAssertEqual(reloaded.toolOutputReference, reference)
        XCTAssertEqual(DisplayMessage.duplicate(of: reloaded).toolOutputReference, reference)
        XCTAssertNil(DisplayMessage.restored(from: turns[1], familiarId: "nyx").toolOutputReference)
        let legacy = try JSONDecoder().decode(DisplayMessage.self,
            from: JSONEncoder().encode(DisplayMessage(role: .assistant, familiarId: "nyx", text: "legacy")))
        XCTAssertNil(legacy.toolOutputReference)
    }

    func testGroupHistoryAdoptsOnlyTheMatchingFamiliarReference() throws {
        let connection = CaveConnection(host: "https://desktop.example.test")
        let nyx = try XCTUnwrap(ToolOutputReference(sessionId: "nyx-chat", connection: connection))
        let sage = try XCTUnwrap(ToolOutputReference(sessionId: "sage-chat", connection: connection))
        let nyxTurns = try JSONDecoder().decode([ChatTurn].self, from: Data(#"[{"id":"n","role":"assistant","text":"nyx result"}]"#.utf8))
        let sageTurns = try JSONDecoder().decode([ChatTurn].self, from: Data(#"[{"id":"s","role":"assistant","text":"sage result"}]"#.utf8))
        let local = DisplayMessage(role: .assistant, familiarId: "nyx", text: "nyx result")
        let result = ChatThread.reconciledGroupTranscript(current: [local],
            transcripts: [(familiarId: "nyx", turns: nyxTurns), (familiarId: "sage", turns: sageTurns)],
            toolOutputReferences: ["nyx": nyx, "sage": sage])
        XCTAssertEqual(result.messages.first(where: { $0.familiarId == "nyx" })?.toolOutputReference, nyx)
        XCTAssertEqual(result.messages.first(where: { $0.familiarId == "sage" })?.toolOutputReference, sage)
        XCTAssertEqual(result.messages.count, 2)
    }
}
