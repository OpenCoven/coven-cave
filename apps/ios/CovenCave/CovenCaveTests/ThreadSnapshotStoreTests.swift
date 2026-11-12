import XCTest
@testable import CovenCave

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
                              title: String = "Chat") -> ThreadSnapshot {
        ThreadSnapshot(
            id: id,
            title: title,
            familiarIds: ["nova"],
            sessionIds: ["nova": "session-1"],
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
