import XCTest
@testable import CovenCave

private final class ContinuityHeldReadProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var pending: [ContinuityHeldReadProtocol] = []
    private static var onStart: (() -> Void)?

    static func observeStart(_ callback: @escaping () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        onStart = callback
    }

    static func takeRequest() throws -> ContinuityHeldReadProtocol {
        lock.lock()
        defer { lock.unlock() }
        let request = try XCTUnwrap(pending.first)
        pending.removeFirst()
        return request
    }

    static func reset() {
        lock.lock()
        defer { lock.unlock() }
        pending.removeAll()
        onStart = nil
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.pending.append(self)
        let callback = Self.onStart
        Self.lock.unlock()
        callback?()
    }

    override func stopLoading() {}

    func finish(with conversation: Conversation?) throws {
        let response = try XCTUnwrap(HTTPURLResponse(
            url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        ))
        let data = try JSONEncoder().encode(ConversationResponse(ok: true, error: nil, conversation: conversation))
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class ConversationChaptersTests: XCTestCase {
    override func tearDown() {
        ContinuityHeldReadProtocol.reset()
        super.tearDown()
    }

    private func heldReadClient() -> CaveClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContinuityHeldReadProtocol.self]
        let session = URLSession(configuration: configuration)
        addTeardownBlock { session.invalidateAndCancel() }
        return CaveClient(connection: CaveConnection(host: "http://continuity.test"), session: session)
    }

    private func readConversation(_ text: String) -> Conversation {
        Conversation(sessionId: "c", turns: [
            ChatTurn(id: "source", role: "user", text: text, createdAt: "2026-09-09T00:00:00Z"),
        ], activeLeafId: "source")
    }

    private func turn(_ id: String, _ date: String = "2026-09-09T00:00:00Z",
                      parent: String? = nil) -> ChapterSourceTurn {
        ChapterSourceTurn(id: id, parentId: parent, createdAt: date)
    }

    func testUTCIdentityContiguousDaysAndAppendStability() {
        let turns = [turn("a", "2026-09-08T23:59:59Z"), turn("b"), turn("c"),
                     turn("back", "2026-09-08T12:00:00Z")]
        let index = ConversationChapters.build(conversationId: "exact/chat", activeBranch: turns)
        XCTAssertEqual(index.status, .complete)
        XCTAssertEqual(index.chapters.map(\.day), ["2026-09-08", "2026-09-09", "2026-09-08"])
        XCTAssertEqual(index.chapters.map(\.turnCount), [1, 2, 1])
        XCTAssertEqual(index.chapters.map(\.lastTurnId), ["a", "c", "back"])
        XCTAssertEqual(index.chapters[0].id, #"["utc-day-v1","exact/chat","a"]"#)
        let appended = ConversationChapters.build(conversationId: "exact/chat", activeBranch: turns + [turn("later")])
        XCTAssertEqual(Array(appended.chapters.prefix(3)).map(\.id), index.chapters.map(\.id))
    }

    func testStrictUTCMetadataCalendarValidityAndUnknownDates() {
        XCTAssertEqual(ConversationChapters.utcDay("2024-02-29T00:00:00Z"), "2024-02-29")
        XCTAssertEqual(ConversationChapters.utcDay("2024-02-29T00:00:00.123Z"), "2024-02-29")
        for date in ["2026-02-29T00:00:00Z", "2026-02-31T00:00:00Z",
                     "2026-09-09T24:00:00Z", "2026-09-09T00:60:00Z",
                     "2026-09-09T00:00:60Z", "2026-09-09T00:00:00",
                     "2026-09-09T00:30:00+02:00", "2026-09-08T23:30:00-02:00",
                     "2026-09-09T00:00:00+00:00", "2026-09-09T00:00:00-00:00",
                     "2026-09-09T00:00:00.1Z", "2026-09-09T00:00:00.12Z",
                     "2026-09-09T00:00:00.1234Z", "2024-02-29T00:00:00.123456Z",
                     "2026-09-09T00:00:00Z\n", "2026-09-09T00:00:00z",
                     "2026-09-09T00:00:00+24:00", "not-a-date"] {
            XCTAssertNil(ConversationChapters.utcDay(date), date)
            XCTAssertEqual(ConversationChapters.build(conversationId: "c", activeBranch: [turn("a", date)]).status,
                           .unavailable, date)
        }
        XCTAssertNil(ConversationChapters.utcDay(nil))
    }

    @MainActor
    func testRejectedChapterMetadataDoesNotRewriteTheRestoredTimestamp() throws {
        let timestamp = "2026-09-09T00:30:00.123+02:00"
        let thread = ChatThread(title: "t", familiarIds: ["nyx"], sessionIds: ["nyx": "c"])
        let conversation = Conversation(sessionId: "c", turns: [
            ChatTurn(id: "a", role: "user", text: "original", createdAt: timestamp),
        ], activeLeafId: "a")
        try thread.restoreConversation(conversation, familiarId: "nyx")
        XCTAssertEqual(thread.chapterIndex.status, .unavailable)
        XCTAssertTrue(thread.chapterIndex.chapters.isEmpty)
        XCTAssertEqual(conversation.turns[0].createdAt, timestamp)
        XCTAssertEqual(thread.messages[0].text, "original")
        XCTAssertEqual(thread.messages[0].createdAt,
                       ConversationChapters.sourceDate("2026-09-08T22:30:00.123Z"))
    }

    func testDuplicateAndPartialNeverExposeStableAnchors() {
        let duplicate = ConversationChapters.build(conversationId: "c", activeBranch: [turn("a"), turn("a")])
        XCTAssertEqual(duplicate.status, .unavailable)
        XCTAssertTrue(duplicate.chapters.isEmpty)
        let partial = ConversationChapters.build(conversationId: "c", activeBranch: [turn("a")], partial: true)
        XCTAssertEqual(partial.status, .partial)
        XCTAssertTrue(partial.chapters.isEmpty)
    }

    func testActiveBranchIgnoresSiblingArrayOrderAndClockRollback() {
        let turns = [turn("sibling", parent: "a"), turn("b", "2026-09-08T00:00:00Z", parent: "a"),
                     turn("a"), turn("c", parent: "b")]
        XCTAssertEqual(ConversationChapters.activeBranch(turns, activeLeafId: "c")?.map(\.id), ["a", "b", "c"])
        XCTAssertNil(ConversationChapters.activeBranch(turns, activeLeafId: nil))
        XCTAssertNil(ConversationChapters.activeBranch(turns, activeLeafId: "missing"))
        XCTAssertNil(ConversationChapters.activeBranch([turn("a", parent: "b"), turn("b", parent: "a")], activeLeafId: "a"))
        XCTAssertNil(ConversationChapters.activeBranch([turn("a", parent: "missing")], activeLeafId: "a"))
        XCTAssertNil(ConversationChapters.activeBranch([turn("a"), turn("a")], activeLeafId: "a"))
    }

    func testOrphanSystemEchoDoesNotResortTheActiveChain() {
        var echo = turn("echo", "2026-09-08T23:00:00Z")
        echo.role = "system"
        let turns = [turn("a"), turn("b", "2026-09-08T00:00:00Z", parent: "a"), echo]
        XCTAssertEqual(ConversationChapters.activeBranch(turns, activeLeafId: "b")?.map(\.id), ["echo", "a", "b"])
    }

    @MainActor
    func testLegacyUnlinkedRestorePreservesStoredOrderWithoutChapterOptIn() throws {
        let conversation = try JSONDecoder().decode(Conversation.self, from: Data(#"""
        {
          "sessionId": "legacy",
          "turns": [
            {"id":"user","role":"user","text":"original request","parentId":null,"createdAt":"2026-09-09T00:00:00Z"},
            {"id":"reply","role":"assistant","text":"original reply","createdAt":"2026-09-08T00:00:00Z"}
          ]
        }
        """#.utf8))
        let thread = ChatThread(title: "Legacy", familiarIds: ["nyx"], sessionIds: ["nyx": "legacy"])
        XCTAssertNil(conversation.activeLeafId)
        try thread.restoreConversation(conversation, familiarId: "nyx")
        XCTAssertEqual(thread.messages.compactMap(\.serverTurnId), ["user", "reply"])
        XCTAssertEqual(thread.messages.map(\.text), ["original request", "original reply"])
        XCTAssertEqual(thread.chapterIndex.chapters.map(\.day), ["2026-09-09", "2026-09-08"])
        let displayIds = thread.messages.map(\.id)
        try thread.restoreConversation(conversation, familiarId: "nyx")
        XCTAssertEqual(thread.messages.map(\.id), displayIds)
        XCTAssertEqual(thread.displayId(for: thread.chapterIndex.chapters[0]), displayIds[0])

        var invalidMetadata = conversation
        invalidMetadata.turns[0].createdAt = "unknown"
        try thread.restoreConversation(invalidMetadata, familiarId: "nyx")
        XCTAssertEqual(thread.chapterIndex.status, .unavailable)
        XCTAssertEqual(thread.messages.map(\.id), displayIds)
        XCTAssertEqual(thread.messages.map(\.text), ["original request", "original reply"])
    }

    @MainActor
    func testSystemAncestorRestoreRetainsRootAndWeavesOnlyUnseenEchoes() throws {
        let conversation = try JSONDecoder().decode(Conversation.self, from: Data(#"""
        {
          "sessionId": "system-chain",
          "activeLeafId": "reply",
          "turns": [
            {"id":"reply","role":"assistant","text":"reply","parentId":"user","createdAt":"2026-09-09T00:00:00Z"},
            {"id":"user","role":"user","text":"request","parentId":"root","createdAt":"2026-09-09T00:00:00Z"},
            {"id":"echo","role":"system","text":"echo","parentId":null,"createdAt":"2026-09-07T00:00:00Z"},
            {"id":"root","role":"system","text":"ancestor","parentId":null,"createdAt":"2026-09-08T00:00:00Z"}
          ]
        }
        """#.utf8))
        let thread = ChatThread(title: "System chain", familiarIds: ["nyx"], sessionIds: ["nyx": "system-chain"])
        try thread.restoreConversation(conversation, familiarId: "nyx")
        XCTAssertEqual(thread.messages.compactMap(\.serverTurnId), ["echo", "root", "user", "reply"])
        XCTAssertEqual(thread.messages.map(\.role), [.system, .system, .user, .assistant])
        XCTAssertEqual(thread.messages.filter { $0.serverTurnId == "root" }.count, 1)
        let rootChapter = try XCTUnwrap(thread.chapterIndex.chapters.first { $0.firstTurnId == "root" })
        XCTAssertEqual(thread.displayId(for: rootChapter), thread.messages[1].id)
        let displayIds = thread.messages.map(\.id)
        try thread.restoreConversation(conversation, familiarId: "nyx")
        XCTAssertEqual(thread.messages.map(\.id), displayIds)
    }

    @MainActor
    func testMalformedDatesWithOrphanEchoPreserveDecodedBodiesAndSourceIds() throws {
        var conversation = try JSONDecoder().decode(Conversation.self, from: Data(#"""
        {
          "sessionId": "c",
          "activeLeafId": "reply",
          "turns": [
            {"id":"reply","role":"assistant","text":"original reply","parentId":"user","createdAt":"2026-09-09T00:00:00Z"},
            {"id":"user","role":"user","text":"original request","parentId":null,"createdAt":"not-a-date"},
            {"id":"echo","role":"system","text":"original echo","parentId":null,"createdAt":"2026-09-08T00:00:00Z"}
          ]
        }
        """#.utf8))
        let thread = ChatThread(title: "t", familiarIds: ["nyx"], sessionIds: ["nyx": "c"])
        try thread.restoreConversation(conversation, familiarId: "nyx")
        XCTAssertEqual(thread.messages.compactMap(\.serverTurnId), ["user", "echo", "reply"])
        XCTAssertEqual(thread.messages.map(\.text), ["original request", "original echo", "original reply"])
        XCTAssertEqual(thread.chapterIndex.status, .unavailable)
        XCTAssertTrue(thread.chapterIndex.chapters.isEmpty)
        XCTAssertEqual(conversation.turns[1].createdAt, "not-a-date")
        var displayIds: [String: String] = [:]
        for message in thread.messages {
            displayIds[try XCTUnwrap(message.serverTurnId)] = message.id
        }

        conversation.turns[1].createdAt = "2026-09-08T00:00:00Z"
        conversation.turns[2].createdAt = "not-a-date"
        try thread.restoreConversation(conversation, familiarId: "nyx")
        XCTAssertEqual(thread.messages.compactMap(\.serverTurnId), ["user", "reply", "echo"])
        XCTAssertEqual(thread.messages.map(\.text), ["original request", "original reply", "original echo"])
        XCTAssertEqual(thread.chapterIndex.status, .unavailable)
        XCTAssertTrue(thread.chapterIndex.chapters.isEmpty)
        XCTAssertEqual(conversation.turns[2].createdAt, "not-a-date")
        for message in thread.messages {
            XCTAssertEqual(message.id, displayIds[try XCTUnwrap(message.serverTurnId)])
        }
    }

    @MainActor
    func testProductionRestoreAndNavigationPreserveDisplayIdentityAndExactTarget() throws {
        let thread = ChatThread(title: "Renamable title", familiarIds: ["nyx"], sessionIds: ["nyx": "c"])
        let conversation = Conversation(sessionId: "c", familiarId: "nyx", turns: [
            ChatTurn(id: "a", role: "user", text: "first", createdAt: "2026-09-08T23:59:59Z"),
            ChatTurn(id: "other", role: "assistant", text: "sibling", createdAt: "2026-09-10T00:00:00Z", parentId: "a"),
            ChatTurn(id: "b", role: "assistant", text: "active", createdAt: "2026-09-09T00:00:00Z", parentId: "a"),
        ], activeLeafId: "b")
        try thread.restoreConversation(conversation, familiarId: "nyx")
        XCTAssertEqual(thread.messages.compactMap(\.serverTurnId), ["a", "b"])
        let displayId = thread.messages[0].id
        let chapter = try XCTUnwrap(thread.chapterIndex.chapters.first)
        XCTAssertEqual(thread.displayId(for: chapter), displayId)
        XCTAssertNotEqual(displayId, "a")
        XCTAssertEqual(ConversationChapters.utcDay(conversation.turns[0].createdAt), chapter.day)
        try thread.restoreConversation(conversation, familiarId: "nyx")
        XCTAssertEqual(thread.messages[0].id, displayId)
        let index = thread.chapterIndex
        thread.updateText(displayId, "text-only stream patch")
        XCTAssertEqual(thread.chapterIndex, index, "no chapter work on streamed text")
        thread.title = "Renamed"
        XCTAssertEqual(thread.displayId(for: chapter), displayId)
        thread.sessionIds["nyx"] = "different"
        XCTAssertNil(thread.displayId(for: chapter), "never redirect a stale sheet to another chat")
        thread.sessionIds["nyx"] = "c"
        thread.clearMessages()
        XCTAssertNil(thread.displayId(for: chapter), "removed source anchor cannot jump")
    }

    @MainActor
    func testUnverifiedSnapshotAndLocalTailRequireRefresh() throws {
        let thread = ChatThread(title: "t", familiarIds: ["nyx"], sessionIds: ["nyx": "c"])
        XCTAssertEqual(thread.chapterIndex.status, .needsRefresh)
        try thread.restoreConversation(Conversation(sessionId: "c", turns: [
            ChatTurn(id: "a", role: "user", text: "first", createdAt: "2026-09-09T00:00:00Z"),
        ], activeLeafId: "a"), familiarId: "nyx")
        thread.appendSystem("local only")
        XCTAssertEqual(thread.chapterIndex.status, .needsRefresh)
        XCTAssertEqual(ChatThread(snapshot: thread.snapshot).chapterIndex.status, .needsRefresh)
    }

    @MainActor
    func testLateReloadCannotOverwriteQueuedSendThatSettledDuringGET() async throws {
        let thread = ChatThread(title: "t", familiarIds: ["nyx"], sessionIds: ["nyx": "c"])
        try thread.restoreConversation(readConversation("initial"), familiarId: "nyx")
        let client = heldReadClient()
        let started = expectation(description: "history GET held")
        ContinuityHeldReadProtocol.observeStart { started.fulfill() }
        let read = Task { try await thread.reload(client: client) }
        defer { read.cancel() }
        await fulfillment(of: [started], timeout: 5)
        let held = try ContinuityHeldReadProtocol.takeRequest()
        let originalClock = thread.updatedAt

        thread.enqueue("new queued send")
        let localId = try XCTUnwrap(thread.messages.last?.id)
        thread.messages[thread.messages.count - 1].queued = false
        thread.updatedAt = originalClock
        XCTAssertFalse(thread.isStreaming)
        XCTAssertFalse(thread.messages.contains(where: \.isQueued))

        try held.finish(with: readConversation("stale server snapshot"))
        try await read.value
        XCTAssertEqual(thread.messages.map(\.text), ["initial", "new queued send"])
        XCTAssertEqual(thread.messages.last?.id, localId)
    }

    @MainActor
    func testLateReloadCannotOverwriteInPlaceTextMutation() async throws {
        let thread = ChatThread(title: "t", familiarIds: ["nyx"], sessionIds: ["nyx": "c"])
        try thread.restoreConversation(readConversation("initial"), familiarId: "nyx")
        let client = heldReadClient()
        let started = expectation(description: "history GET held")
        ContinuityHeldReadProtocol.observeStart { started.fulfill() }
        let read = Task { try await thread.reload(client: client) }
        defer { read.cancel() }
        await fulfillment(of: [started], timeout: 5)
        let held = try ContinuityHeldReadProtocol.takeRequest()
        let originalClock = thread.updatedAt
        let displayId = thread.messages[0].id
        thread.updateText(displayId, "new streamed text")
        thread.updatedAt = originalClock

        try held.finish(with: readConversation("stale server snapshot"))
        try await read.value
        XCTAssertEqual(thread.messages[0].text, "new streamed text")
        XCTAssertEqual(thread.messages[0].id, displayId)
    }

    @MainActor
    func testSupersededReloadCannotApplyEvenBeforeNewerReadCompletes() async throws {
        let thread = ChatThread(title: "t", familiarIds: ["nyx"], sessionIds: ["nyx": "c"])
        try thread.restoreConversation(readConversation("initial"), familiarId: "nyx")
        let client = heldReadClient()
        let firstStarted = expectation(description: "older GET held")
        ContinuityHeldReadProtocol.observeStart { firstStarted.fulfill() }
        let older = Task { try await thread.reload(client: client) }
        defer { older.cancel() }
        await fulfillment(of: [firstStarted], timeout: 5)
        let first = try ContinuityHeldReadProtocol.takeRequest()

        let secondStarted = expectation(description: "newer GET held")
        ContinuityHeldReadProtocol.observeStart { secondStarted.fulfill() }
        let newer = Task { try await thread.reload(client: client) }
        defer { newer.cancel() }
        await fulfillment(of: [secondStarted], timeout: 5)
        let second = try ContinuityHeldReadProtocol.takeRequest()

        try first.finish(with: readConversation("superseded snapshot"))
        try await older.value
        XCTAssertEqual(thread.messages[0].text, "initial")
        try second.finish(with: readConversation("current snapshot"))
        try await newer.value
        XCTAssertEqual(thread.messages[0].text, "current snapshot")
    }

    @MainActor
    func testSourceSwitchAwayAndBackInvalidatesHeldRead() async throws {
        let thread = ChatThread(title: "t", familiarIds: ["nyx"], sessionIds: ["nyx": "c"])
        try thread.restoreConversation(readConversation("initial"), familiarId: "nyx")
        let client = heldReadClient()
        let started = expectation(description: "history GET held")
        ContinuityHeldReadProtocol.observeStart { started.fulfill() }
        let read = Task { try await thread.reload(client: client) }
        defer { read.cancel() }
        await fulfillment(of: [started], timeout: 5)
        let held = try ContinuityHeldReadProtocol.takeRequest()
        thread.sessionIds["nyx"] = "different"
        thread.sessionIds["nyx"] = "c"

        try held.finish(with: readConversation("stale prior binding"))
        try await read.value
        XCTAssertEqual(thread.messages[0].text, "initial")
    }

    @MainActor
    func testEmptyHydrationTicketRejectsMessagesAddedThenCleared() {
        let thread = ChatThread(title: "t", familiarIds: ["nyx"], sessionIds: ["nyx": "c"])
        let read = thread.beginConversationRead()
        thread.enqueue("new send")
        thread.clearMessages()
        XCTAssertTrue(thread.messages.isEmpty)
        XCTAssertFalse(thread.canApplyConversationRead(read))
    }
}
