import Foundation
import XCTest
@testable import CovenCave

private final class ThreadSnapshotRevocationProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let status = url.host?.split(separator: "-").last?.split(separator: ".").first
            .flatMap { Int($0) } ?? 403
        var headers = ["Content-Type": "application/json"]
        if url.host?.contains("managed") == true { headers["x-coven-device-pairing"] = "1" }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)!
        let code = url.host?.contains("write") == true ? "project_write_access_required"
            : url.host?.contains("flow") == true ? "flow_session_read_only"
            : url.host?.contains("trust") == true ? "untrusted_harness" : "project_access_denied"
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        let body = url.host?.contains("managed-gateway") == true
            ? #"{"ok":false,"error":"forbidden","message":"Device approval is required. Open /connect."}"#
            : "{\"ok\":false,\"code\":\"\(code)\",\"error\":\"Controlled refusal\"}"
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private actor RevocationHydrationGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var started = false
    func wait() async {
        started = true
        await withCheckedContinuation { continuation = $0 }
    }
    func release() {
        continuation?.resume()
        continuation = nil
    }
}

final class ThreadSnapshotStoreTests: XCTestCase {
    private var directory: URL!
    private var fileURL: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("thread-snapshot-store-tests-\(UUID().uuidString)", isDirectory: true)
        fileURL = directory.appendingPathComponent("cave-threads.json")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func makeSnapshot(id: String = UUID().uuidString,
                              title: String = "Chat",
                              sessionId: String = "session-1") -> ThreadSnapshot {
        ThreadSnapshot(
            id: id,
            title: title,
            familiarIds: ["nova"],
            sessionIds: ["nova": sessionId],
            projectRoot: "/repos/cave",
            messages: [
                DisplayMessage(role: .user, familiarId: nil, text: "hello"),
                DisplayMessage(role: .assistant, familiarId: "nova", text: "hi there")
            ],
            updatedAt: Date(timeIntervalSinceReferenceDate: 700_000_000),
            archived: nil,
            pinned: true,
            muted: nil
        )
    }

    // MARK: - Access revocation

    @MainActor
    func testHydrationStartedBeforeRefusalCannotRestoreRevokedMemory() async throws {
        let revoked = makeSnapshot(id: "late-hydrated", sessionId: "denied-session")
        let kept = makeSnapshot(id: "kept", sessionId: "other-session")
        let store = ThreadSnapshotStore(url: fileURL)
        try await store.save([revoked, kept])
        let suite = "ThreadSnapshotStoreTests.hydration.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ThreadSnapshotRevocationProtocol.self]
        let session = URLSession(configuration: configuration)
        defer {
            session.invalidateAndCancel()
            defaults.removePersistentDomain(forName: suite)
        }
        let gate = RevocationHydrationGate()
        let app = AppModel(defaults: defaults, loadPersistedConnection: false,
                           threadStoreURL: fileURL, widgetSnapshotDefaults: defaults,
                           threadSnapshotLoader: {
            await gate.wait()
            return [revoked, kept]
        }, clientSession: session)
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while !(await gate.started), ContinuousClock.now < deadline { await Task.yield() }
        let started = await gate.started
        XCTAssertTrue(started)
        app.connection = CaveConnection(host: "cache-revocation.invalid")
        let client = try XCTUnwrap(app.client)
        do {
            _ = try await client.conversation(sessionId: "denied-session")
            XCTFail("Expected an access refusal")
        } catch CaveError.badResponse(403) { }
        await gate.release()
        let hydrated = ContinuousClock.now.advanced(by: .seconds(5))
        while !app.threads.contains(where: { $0.id == kept.id }), ContinuousClock.now < hydrated {
            await Task.yield()
        }
        XCTAssertEqual(app.threads.map(\.id), [kept.id])
        var rebound = revoked
        rebound.sessionIds = ["nova": "new-session"]
        let staleThread = ChatThread(snapshot: rebound)
        app.threads.append(staleThread)
        XCTAssertEqual(app.threads.map(\.id), [kept.id])
        XCTAssertTrue(staleThread.messages.isEmpty)
    }

    @MainActor
    func testToolOutputAccessDenialsPurgeOnlyTheirConversationAndKeepOtherFailuresCached() async throws {
        let suite = "ThreadSnapshotStoreTests.toolOutput.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let cases: [(Int, Bool, ToolOutputError)] = [
            (401, true, .unauthorized), (403, true, .unauthorized),
            (404, false, .unavailable), (409, false, .ambiguous),
            (400, false, .invalidRequest), (500, false, .transport), (503, false, .transport)
        ]
        for (status, shouldPurge, expectedError) in cases {
            var revoked = makeSnapshot(id: "output-thread", sessionId: "output-session")
            revoked.messages = [DisplayMessage(role: .assistant, familiarId: "nova",
                                               text: "private-output-cache-sentinel")]
            var kept = makeSnapshot(id: "kept-thread", title: "Keep every field", sessionId: "other-session")
            kept.archived = false
            kept.muted = false
            let statusFile = directory.appendingPathComponent("tool-output-\(status).json")
            let store = ThreadSnapshotStore(url: statusFile)
            try await store.save([revoked, kept])
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [ThreadSnapshotRevocationProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let app = AppModel(defaults: defaults, restoreLocalState: false,
                               loadPersistedConnection: false, threadStoreURL: statusFile,
                               widgetSnapshotDefaults: defaults, clientSession: session)
            app.connection = CaveConnection(host: "cache-tool-output-\(status).invalid")
            app.threads = [ChatThread(snapshot: revoked), ChatThread(snapshot: kept)]
            let heldThread = try XCTUnwrap(app.threads.first)
            app.setThreadDraft(heldThread.id, text: "private output draft")
            let beforeRequest = try await store.load()
            XCTAssertEqual(beforeRequest, [revoked, kept], "HTTP \(status) must begin with two cached snapshots")
            XCTAssertEqual(heldThread.messages, revoked.messages)
            XCTAssertFalse(heldThread.transcriptRows.isEmpty)
            XCTAssertEqual(heldThread.sessionIds, ["nova": "output-session"])
            XCTAssertEqual(app.threadDrafts[heldThread.id], "private output draft")
            let client = try XCTUnwrap(app.client)
            do {
                _ = try await client.toolOutput(sessionId: "output-session", toolId: "saved-tool")
                XCTFail("Expected tool-output refusal for HTTP \(status)")
            } catch let error as ToolOutputError {
                XCTAssertEqual(error, expectedError, "HTTP \(status)")
                XCTAssertFalse(error.message.contains("Controlled refusal"), "Server error text must remain private")
                XCTAssertFalse(error.message.contains("project_access_denied"), "Server error codes are not display copy")
            }
            let afterRequest = try await store.load()
            XCTAssertEqual(afterRequest, shouldPurge ? [kept] : [revoked, kept], "HTTP \(status) selective disk policy")
            XCTAssertEqual(app.threads.map(\.id), shouldPurge ? [kept.id] : [revoked.id, kept.id],
                           "HTTP \(status) held conversation policy")
            XCTAssertEqual(app.threads.first(where: { $0.id == kept.id })?.snapshot, kept,
                           "HTTP \(status) must preserve every unrelated snapshot field")
            if shouldPurge {
                XCTAssertTrue(heldThread.messages.isEmpty, "HTTP \(status) clears cached transcript memory")
                XCTAssertTrue(heldThread.transcriptRows.isEmpty, "HTTP \(status) clears held transcript rows")
                XCTAssertTrue(heldThread.sessionIds.isEmpty, "HTTP \(status) clears held session bindings")
                XCTAssertNil(app.threadDrafts[heldThread.id], "HTTP \(status) clears the draft mirror")
                XCTAssertEqual(app.toast?.text, "Chat access was denied. Check your desktop connection.")
                XCTAssertEqual(app.toast?.style, .warning)
                XCTAssertNil(app.toast?.actionTitle)
                XCTAssertNil(app.toast?.action)
            } else {
                XCTAssertEqual(heldThread.messages, revoked.messages, "HTTP \(status) keeps cached transcript memory")
                XCTAssertFalse(heldThread.transcriptRows.isEmpty, "HTTP \(status) keeps held transcript rows")
                XCTAssertEqual(heldThread.sessionIds, ["nova": "output-session"])
                XCTAssertEqual(app.threadDrafts[heldThread.id], "private output draft")
                XCTAssertNil(app.toast, "HTTP \(status) must not announce an access revocation")
            }
        }
    }

    @MainActor
    func testConversationSpecificRequestsPurgeTheirRefusedSession() async throws {
        let suite = "ThreadSnapshotStoreTests.boundaries.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        for operation in ["turn-delete", "voice-discard", "voice-grant", "session-flags", "session-delete",
                          "model-read", "model-write", "recovery", "unbound-recovery"] {
            let revoked = makeSnapshot(id: "cached", sessionId: "known-session")
            let kept = makeSnapshot(id: "kept", sessionId: "other-session")
            let operationFile = directory.appendingPathComponent(operation + ".json")
            let store = ThreadSnapshotStore(url: operationFile)
            try await store.save([revoked, kept])
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [ThreadSnapshotRevocationProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let app = AppModel(defaults: defaults, restoreLocalState: false,
                               loadPersistedConnection: false, threadStoreURL: operationFile,
                               widgetSnapshotDefaults: defaults, clientSession: session)
            app.connection = CaveConnection(host: "cache-boundary-403.invalid")
            let client = try XCTUnwrap(app.client)
            do {
                switch operation {
                case "turn-delete": _ = try await client.deleteConversationTurn(sessionId: "known-session", turnId: "turn")
                case "voice-discard": _ = try await client.discardVoiceConversationIfEmpty(sessionId: "known-session")
                case "voice-grant": _ = try await client.mintVoiceSession(familiarId: "nova", sessionId: "known-session")
                case "session-flags": try await client.setSessionFlags(sessionId: "known-session", pinned: true)
                case "session-delete": try await client.deleteSession(sessionId: "known-session")
                case "model-read": _ = try await client.chatModelState(familiarId: "nova", sessionId: "known-session")
                case "model-write": _ = try await client.setChatModel(familiarId: "nova", sessionId: "known-session", model: nil, scope: "session")
                default:
                    for try await _ in client.resumeStream(runId: "opaque-run-id", cursor: 0,
                                                           sessionId: operation == "recovery" ? "known-session" : nil) {}
                }
                XCTFail("Expected a refusal for \(operation)")
            } catch is CaveError { }
            let reloaded = try await store.load()
            XCTAssertEqual(reloaded, operation == "unbound-recovery" ? [revoked, kept] : [kept], operation)
        }
    }

    @MainActor
    func testAnUnsavedRefusedThreadCannotBeCachedAfterRebinding() async throws {
        let suite = "ThreadSnapshotStoreTests.unsaved.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ThreadSnapshotRevocationProtocol.self]
        let session = URLSession(configuration: configuration)
        defer {
            session.invalidateAndCancel()
            defaults.removePersistentDomain(forName: suite)
        }
        let app = AppModel(defaults: defaults, restoreLocalState: false,
                           loadPersistedConnection: false, threadStoreURL: fileURL,
                           widgetSnapshotDefaults: defaults, clientSession: session)
        app.connection = CaveConnection(host: "cache-revocation.invalid")
        app.threads = [ChatThread(snapshot: makeSnapshot(id: "local-unsaved", sessionId: "denied-session"))]
        let heldThread = app.threads[0]
        let client = try XCTUnwrap(app.client)
        do {
            _ = try await client.conversation(sessionId: "denied-session")
            XCTFail("Expected an access refusal")
        } catch CaveError.badResponse(403) { }
        XCTAssertTrue(app.threads.isEmpty)
        XCTAssertTrue(heldThread.messages.isEmpty)
        heldThread.sessionIds["nova"] = "replacement-session"
        let flushed = await app.flushThreadsAndWait()
        XCTAssertTrue(flushed)
        let reloaded = try await ThreadSnapshotStore(url: fileURL).load()
        XCTAssertEqual(reloaded, [])
    }

    @MainActor
    func testSendAccessDenialPurgesButOperationOnlyRefusalsKeepTheSnapshot() async throws {
        let suite = "ThreadSnapshotStoreTests.send.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        for (host, shouldPurge) in [("cache-status-401.invalid", true), ("cache-status-403.invalid", true),
                                    ("cache-managed-gateway-403.invalid", true),
                                    ("cache-managed-write-403.invalid", false),
                                    ("cache-write-403.invalid", false), ("cache-flow-403.invalid", false),
                                    ("cache-trust-403.invalid", false), ("cache-status-500.invalid", false)] {
            let snapshot = makeSnapshot(id: "cached", sessionId: "send-session")
            let statusFile = directory.appendingPathComponent(host + ".json")
            let store = ThreadSnapshotStore(url: statusFile)
            try await store.save([snapshot])
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [ThreadSnapshotRevocationProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let app = AppModel(defaults: defaults, restoreLocalState: false,
                               loadPersistedConnection: false, threadStoreURL: statusFile,
                               widgetSnapshotDefaults: defaults, clientSession: session)
            app.connection = CaveConnection(host: host)
            let client = try XCTUnwrap(app.client)
            do {
                for try await _ in client.sendStream(.init(familiarId: "nova", prompt: "Synthetic continuation",
                                                           sessionId: "send-session", projectRoot: "/repos/cave")) {}
                XCTFail("Expected a server refusal")
            } catch CaveError.serverResponse { }
            let reloaded = try await store.load()
            XCTAssertEqual(reloaded, shouldPurge ? [] : [snapshot], host)
        }
    }

    func testPurgeRemovesEverySnapshotReferencingTheConversation() async throws {
        let direct = makeSnapshot(id: "denied-session", sessionId: "other-direct-session")
        var group = makeSnapshot(id: "group", sessionId: "allowed-group-session")
        group.sessionIds["sage"] = "denied-session"
        var flow = makeSnapshot(id: "flow", sessionId: "allowed-flow-session")
        flow.flowSessionIds = ["denied-session", "other-flow-session"]
        let kept = makeSnapshot(id: "kept", sessionId: "unrelated-session")
        let snapshots = [direct, group, flow, kept]
        let store = ThreadSnapshotStore(url: fileURL)
        try await store.save(snapshots)

        try await store.purgeConversation(sessionId: "denied-session")
        try await store.save(snapshots)

        let reloaded = try await ThreadSnapshotStore(url: fileURL).load()
        XCTAssertEqual(reloaded, [kept])
    }

    func testReceivedRevocationStillPurgesWhenTheCallerIsCancelled() async throws {
        let revoked = makeSnapshot(id: "revoked", sessionId: "denied-session")
        let kept = makeSnapshot(id: "kept", sessionId: "unrelated-session")
        let store = ThreadSnapshotStore(url: fileURL)
        try await store.save([revoked, kept])
        let task = Task {
            while !Task.isCancelled { await Task.yield() }
            try await store.purgeConversation(sessionId: "denied-session")
        }
        task.cancel()
        try await task.value

        let reloaded = try await ThreadSnapshotStore(url: fileURL).load()
        XCTAssertEqual(reloaded, [kept])
    }

    @MainActor
    func testAReplacedConnectionCannotPurgeTheCurrentCache() async throws {
        let kept = makeSnapshot(id: "kept", sessionId: "shared-session-id")
        let store = ThreadSnapshotStore(url: fileURL)
        try await store.save([kept])
        let suite = "ThreadSnapshotStoreTests.replaced.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ThreadSnapshotRevocationProtocol.self]
        let session = URLSession(configuration: configuration)
        defer {
            session.invalidateAndCancel()
            defaults.removePersistentDomain(forName: suite)
        }
        let app = AppModel(defaults: defaults, restoreLocalState: false,
                           loadPersistedConnection: false, threadStoreURL: fileURL,
                           widgetSnapshotDefaults: defaults, clientSession: session)
        app.connection = CaveConnection(host: "cache-old.invalid")
        let oldClient = try XCTUnwrap(app.client)
        app.connection = CaveConnection(host: "cache-successor.invalid")

        do {
            _ = try await oldClient.conversation(sessionId: "shared-session-id")
            XCTFail("Expected the old connection's refusal")
        } catch CaveError.badResponse(403) {}

        let reloaded = try await store.load()
        XCTAssertEqual(reloaded, [kept])
    }

    @MainActor
    func testOnlyDefinitiveConversationAccessRefusalsPurgeTheCache() async throws {
        let suite = "ThreadSnapshotStoreTests.status.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        for (status, shouldPurge) in [(401, true), (403, true), (404, false), (500, false)] {
            let snapshot = makeSnapshot(id: "cached", sessionId: "status-session")
            let statusFile = directory.appendingPathComponent("status-\(status).json")
            let store = ThreadSnapshotStore(url: statusFile)
            try await store.save([snapshot])
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [ThreadSnapshotRevocationProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let app = AppModel(defaults: defaults, restoreLocalState: false,
                               loadPersistedConnection: false, threadStoreURL: statusFile,
                               widgetSnapshotDefaults: defaults, clientSession: session)
            app.connection = CaveConnection(host: "cache-status-\(status).invalid")
            let client = try XCTUnwrap(app.client)
            do {
                _ = try await client.conversation(sessionId: "status-session")
                XCTFail("Expected HTTP \(status)")
            } catch CaveError.badResponse(let received) {
                XCTAssertEqual(received, status)
            }
            let reloaded = try await ThreadSnapshotStore(url: statusFile).load()
            XCTAssertEqual(reloaded, shouldPurge ? [] : [snapshot], "HTTP \(status)")
        }
    }

    @MainActor
    func testConversationRefusalPurgesOnlyRevokedSnapshotAndSurvivesRelaunch() async throws {
        var revoked = makeSnapshot(id: "revoked-thread", sessionId: "revoked-session")
        revoked.messages = [DisplayMessage(role: .assistant, familiarId: "nova", text: "revocation-cache-secret-6487")]
        var kept = makeSnapshot(id: "kept-thread", title: "Keep every field", sessionId: "kept-session")
        kept.archived = false
        kept.muted = false
        let store = ThreadSnapshotStore(url: fileURL)
        try await store.save([revoked, kept])
        let suite = "ThreadSnapshotStoreTests.revocation.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ThreadSnapshotRevocationProtocol.self]
        let session = URLSession(configuration: configuration)
        defer {
            session.invalidateAndCancel()
            defaults.removePersistentDomain(forName: suite)
        }
        let app = AppModel(defaults: defaults, restoreLocalState: false,
                           loadPersistedConnection: false, threadStoreURL: fileURL,
                           widgetSnapshotDefaults: defaults, clientSession: session)
        app.connection = CaveConnection(host: "cache-revocation.invalid")
        app.threads = [ChatThread(snapshot: revoked), ChatThread(snapshot: kept)]
        let heldThread = app.threads[0]
        app.setThreadDraft(heldThread.id, text: "private draft")
        let client = try XCTUnwrap(app.client)

        do {
            _ = try await client.conversation(sessionId: "revoked-session")
            XCTFail("The conversation must still report its access refusal")
        } catch CaveError.badResponse(403) {
            // The actual client boundary learns that this conversation is forbidden.
        }

        let afterRefusal = try await store.load()
        XCTAssertEqual(afterRefusal, [kept])
        XCTAssertEqual(app.threads.map(\.id), [kept.id])
        XCTAssertTrue(heldThread.messages.isEmpty)
        XCTAssertTrue(heldThread.transcriptRows.isEmpty)
        XCTAssertTrue(heldThread.sessionIds.isEmpty)
        XCTAssertNil(app.threadDrafts[heldThread.id])
        // A later background flush still holds the old in-memory snapshot.
        // Even session rebinding must not resurrect its revoked transcript.
        heldThread.sessionIds["nova"] = "replacement-session"
        heldThread.messages = revoked.messages
        app.threads.append(heldThread)
        XCTAssertTrue(heldThread.messages.isEmpty, "A late history response must not restore memory")
        XCTAssertTrue(heldThread.sessionIds.isEmpty, "A late session event must not restore its binding")
        XCTAssertEqual(app.threads.map(\.id), [kept.id], "A late rollback must not reinsert a revoked thread")
        app.setThreadDraft(heldThread.id, text: "late draft callback")
        XCTAssertNil(app.threadDrafts[heldThread.id])
        for _ in 0..<2 {
            heldThread.revokeAccess()
            heldThread.messages = []
            heldThread.sessionIds = [:]
            heldThread.projectRoot = nil
            heldThread.title = "Chat"
        }
        let flushed = await app.flushThreadsAndWait()
        XCTAssertTrue(flushed)
        let afterFlush = try await ThreadSnapshotStore(url: fileURL).load()
        XCTAssertEqual(afterFlush, [kept])
        XCTAssertFalse(String(decoding: try Data(contentsOf: fileURL), as: UTF8.self)
            .contains("revocation-cache-secret-6487"))

        let relaunched = AppModel(defaults: defaults, loadPersistedConnection: false,
                                  threadStoreURL: fileURL, widgetSnapshotDefaults: defaults)
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while !relaunched.threads.contains(where: { $0.id == kept.id }), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(relaunched.threads.map(\.snapshot), [kept])
    }

    // MARK: - Round-trip / legacy compatibility

    func testLoadDecodesSnapshotsWrittenByTheLegacyPersistencePath() async throws {
        // The shipped persistence encoded with a bare JSONEncoder (default
        // date strategy) — the store must keep decoding those files.
        let legacy = [makeSnapshot(title: "Legacy chat")]
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(legacy).write(to: fileURL, options: .atomic)

        let store = ThreadSnapshotStore(url: fileURL)
        let loaded = try await store.load()

        XCTAssertEqual(loaded, legacy)
    }

    func testSaveThenLoadRoundTripsAndKeepsLegacyDecodableShape() async throws {
        let snapshots = [makeSnapshot(title: "Round trip")]
        let store = ThreadSnapshotStore(url: fileURL)

        try await store.save(snapshots)

        let reloaded = try await store.load()
        XCTAssertEqual(reloaded, snapshots)
        // The on-disk shape must stay readable by the legacy decoder too.
        let data = try Data(contentsOf: fileURL)
        XCTAssertEqual(try JSONDecoder().decode([ThreadSnapshot].self, from: data), snapshots)
    }

    @MainActor
    func testProjectRootRoundTripsWithSnapshot() async throws {
        let store = ThreadSnapshotStore(url: fileURL)
        try await store.save([makeSnapshot()])

        let loaded = try await store.load()
        let snapshot = try XCTUnwrap(loaded.first)

        XCTAssertEqual(snapshot.projectRoot, "/repos/cave")
        XCTAssertEqual(ChatThread(snapshot: snapshot).projectRoot, "/repos/cave")
    }

    func testLegacySnapshotWithoutProjectRootStillDecodes() throws {
        let data = Data(
            """
            {
              "id": "legacy",
              "title": "Legacy chat",
              "familiarIds": ["nova"],
              "sessionIds": {},
              "messages": [],
              "updatedAt": 700000000
            }
            """.utf8
        )

        let snapshot = try JSONDecoder().decode(ThreadSnapshot.self, from: data)

        XCTAssertNil(snapshot.projectRoot)
    }

    // MARK: - Atomic overwrite

    func testSaveAtomicallyReplacesThePreviousSnapshot() async throws {
        let store = ThreadSnapshotStore(url: fileURL)
        try await store.save([makeSnapshot(id: "first", title: "First")])

        let replacement = [makeSnapshot(id: "second", title: "Second")]
        try await store.save(replacement)

        let reloaded = try await store.load()
        XCTAssertEqual(reloaded, replacement)
    }

    // MARK: - Missing / corrupt files

    func testLoadReturnsEmptyWhenFileDoesNotExist() async throws {
        let store = ThreadSnapshotStore(url: fileURL)

        let loaded = try await store.load()

        XCTAssertEqual(loaded, [])
    }

    func testLoadThrowsTypedErrorForCorruptFile() async throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not json at all".utf8).write(to: fileURL, options: .atomic)

        let store = ThreadSnapshotStore(url: fileURL)
        do {
            _ = try await store.load()
            XCTFail("Expected a corrupt-snapshot error")
        } catch ThreadSnapshotStore.StoreError.corruptSnapshot {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    // MARK: - Cancellation

    func testCancelledSaveDoesNotReplaceTheLastValidSnapshot() async throws {
        let store = ThreadSnapshotStore(url: fileURL)
        let original = [makeSnapshot(id: "original", title: "Original")]
        try await store.save(original)

        // Deterministic: the task spins until its cancellation flag is set,
        // so save() always runs inside an already-cancelled task.
        let task = Task {
            while !Task.isCancelled { await Task.yield() }
            try await store.save([makeSnapshot(id: "replacement", title: "Replacement")])
        }
        task.cancel()
        let result = await task.result

        switch result {
        case .success:
            XCTFail("Expected the cancelled save to throw")
        case .failure(let error):
            XCTAssertTrue(error is CancellationError, "Unexpected error: \(error)")
        }
        let reloaded = try await store.load()
        XCTAssertEqual(reloaded, original)
    }

    // MARK: - golden-13 (#6061): tool payloads in the on-device thread cache

    /// The shared tool sentinels, folded through the real stream decoder and
    /// saved with the thread. A successful tool's result and an opaque payload
    /// signature never reach the file. The bounded argument summary shown on
    /// the activity step is cached with it; that is not asserted here.
    func testThreadCacheNeverHoldsAToolResultOrPayloadSignature() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "runtime-activity-v1", withExtension: "json"))
        let corpus = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let section = try XCTUnwrap(corpus["reasoningPrivacySentinels"] as? [String: Any])
        let tool = try XCTUnwrap(section["tool"] as? [String: String])
        let argument = try XCTUnwrap(tool["argument"])
        let result = try XCTUnwrap(tool["result"])
        let signature = try XCTUnwrap(tool["payloadSignature"])
        let input = String(decoding: try JSONSerialization.data(withJSONObject: ["note": argument]), as: UTF8.self)
        let frames: [[String: Any]] = [
            ["kind": "tool_use", "id": "golden13", "name": "Read", "status": "running", "input": input,
             "signature": signature, "encrypted_content": signature],
            ["kind": "tool_use", "id": "golden13", "name": "Read", "status": "ok", "input": input, "output": result,
             "signature": signature, "encrypted_content": signature],
        ]
        var steps: [ActivityStep] = []
        for frame in frames {
            let json = String(decoding: try JSONSerialization.data(withJSONObject: frame), as: UTF8.self)
            steps = try XCTUnwrap(ActivityFold.fold(steps, event: try XCTUnwrap(StreamEvent.decode(json))))
        }
        var reply = DisplayMessage(role: .assistant, familiarId: "nova", text: "The comparison is complete.")
        reply.activity = steps
        var snapshot = makeSnapshot(title: "Golden thirteen")
        snapshot.messages = [DisplayMessage(role: .user, familiarId: nil, text: "Compare the files"), reply]

        let store = ThreadSnapshotStore(url: fileURL)
        try await store.save([snapshot])
        let saved = String(decoding: try Data(contentsOf: fileURL), as: UTF8.self)

        XCTAssertFalse(saved.contains(result), "a successful tool's result is not cached")
        XCTAssertFalse(saved.contains(signature), "an opaque payload signature is not cached")
    }
}
