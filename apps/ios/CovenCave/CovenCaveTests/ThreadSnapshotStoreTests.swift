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
}
