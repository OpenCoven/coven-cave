import Foundation
import XCTest
@testable import CovenCave

/// Captures every `POST /api/chat/send` body and refuses it, so a dispatch
/// ends after one request and the test can read what went over the wire.
private final class SendCaptureURLProtocol: URLProtocol {
    nonisolated(unsafe) static var sentBodies: [[String: Any]] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        if request.httpMethod == "POST", request.url?.path == "/api/chat/send",
           let data = try? request.bodyDataForTesting(),
           let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            Self.sentBodies.append(body)
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 400, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"error":"refused by the test"}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// Val's T2 rule for #6104: a retry and a queued replay send the files stored
/// on the user message, never paths re-read from its text.
@MainActor
final class FileMentionDispatchTests: XCTestCase {
    override func setUp() {
        super.setUp()
        SendCaptureURLProtocol.sentBodies = []
    }

    override func tearDown() {
        SendCaptureURLProtocol.sentBodies = []
        super.tearDown()
    }

    private func client() -> CaveClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SendCaptureURLProtocol.self]
        return CaveClient(connection: CaveConnection(host: "http://cave.test:3000"),
                          session: URLSession(configuration: configuration))
    }

    /// The user turn names a picked file and a typed one; only the pick is stored.
    private func userTurn() -> DisplayMessage {
        var user = DisplayMessage(role: .user, text: "Compare @src/a.ts with @src/typed.ts")
        user.mentionedFiles = ["src/a.ts"]
        return user
    }

    func testRetrySendsTheStoredPicksOnly() async throws {
        let thread = ChatThread(
            title: "Nyx", familiarIds: ["nyx"], sessionIds: ["nyx": "session-nyx"],
            projectRoot: "/repos/cave",
            messages: [
                userTurn(),
                DisplayMessage(role: .assistant, familiarId: "nyx", text: "It failed", isError: true),
            ])
        let task = try XCTUnwrap(thread.retry(
            thread.messages[1].id, client: client(),
            liveDispatchLeaseIsCurrent: { true },
            persistAfterRefusal: { true },
            onRefusal: {},
            onChange: {}))
        await task.value

        let body = try XCTUnwrap(SendCaptureURLProtocol.sentBodies.first, "the retry reached the send route")
        XCTAssertEqual(body["mentionedFiles"] as? [String], ["src/a.ts"])
        XCTAssertEqual(body["mentionedFilesRoot"] as? String, "/repos/cave")
    }

    func testQueuedReplaySendsTheStoredPicksOnly() async throws {
        var queued = userTurn()
        queued.queued = true
        queued.queuedTargetFamiliarIds = ["nyx"]
        queued.queuedContext = .init(projectRoot: "/repos/cave", sessionIds: ["nyx": "session-nyx"])
        let thread = ChatThread(
            title: "Nyx", familiarIds: ["nyx"], sessionIds: ["nyx": "session-nyx"],
            projectRoot: "/repos/cave", messages: [queued])
        await thread.replayQueued(
            client: client(),
            onConnectionFailure: { _ in },
            dispatchLeaseIsCurrent: { true },
            targetAccessIsCurrent: { _, _ in true },
            onAccessRefused: { _ in XCTFail("The queued project binding remains valid.") },
            persistBeforeDispatch: { true },
            persistAfterRollback: { true }, onChange: {})

        let body = try XCTUnwrap(SendCaptureURLProtocol.sentBodies.first, "the replay reached the send route")
        XCTAssertEqual(body["mentionedFiles"] as? [String], ["src/a.ts"])
        XCTAssertEqual(body["mentionedFilesRoot"] as? String, "/repos/cave")
    }

    func testADraftKeepsItsPicksUntilItsTextIsCleared() {
        let suiteName = "FileMentionDispatchTests.drafts.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let threadID = "thread-\(UUID().uuidString)"
        let app = AppModel(defaults: defaults, restoreLocalState: false, loadPersistedConnection: false)

        app.persistThreadDraft(threadID, text: "Read @src/a.ts", mentionedFiles: ["src/a.ts"])
        XCTAssertEqual(app.persistedThreadDraftMentions(threadID), ["src/a.ts"], "a restored draft keeps its picks")

        app.persistThreadDraft(threadID, text: "Read it", mentionedFiles: [])
        XCTAssertEqual(app.persistedThreadDraftMentions(threadID), [], "dropping the last pick clears the stored list")

        app.persistThreadDraft(threadID, text: "Read @src/a.ts", mentionedFiles: ["src/a.ts"])
        app.persistThreadDraft(threadID, text: " ")
        XCTAssertNil(app.persistedThreadDraft(threadID))
        XCTAssertEqual(app.persistedThreadDraftMentions(threadID), [], "clearing the draft clears its picks")
    }

    func testATurnWithoutPicksSendsNoMentionsEvenWhenItsTextHasPaths() async throws {
        let thread = ChatThread(
            title: "Nyx", familiarIds: ["nyx"], sessionIds: ["nyx": "session-nyx"],
            projectRoot: "/repos/cave",
            messages: [
                DisplayMessage(role: .user, text: "Look at @src/typed.ts"),
                DisplayMessage(role: .assistant, familiarId: "nyx", text: "It failed", isError: true),
            ])
        let task = try XCTUnwrap(thread.retry(
            thread.messages[1].id, client: client(),
            liveDispatchLeaseIsCurrent: { true },
            persistAfterRefusal: { true },
            onRefusal: {},
            onChange: {}))
        await task.value

        let body = try XCTUnwrap(SendCaptureURLProtocol.sentBodies.first)
        XCTAssertNil(body["mentionedFiles"], "a typed path stays text")
        XCTAssertNil(body["mentionedFilesRoot"])
    }
}
