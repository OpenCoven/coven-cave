import Foundation

/// Owns the thread snapshot file: directory creation, reads, JSON coding, and
/// atomic writes all happen on this actor, never on the main actor. The JSON
/// shape is the legacy `AppModel` one (bare encoder/decoder, default date
/// strategy) so files written before the store existed keep decoding.
actor ThreadSnapshotStore {
    enum StoreError: Error {
        /// The file exists but no longer decodes as `[ThreadSnapshot]`.
        case corruptSnapshot(underlying: Error)
    }

    private let url: URL
    /// A later flush may still contain a value captured before access changed.
    /// Keep those conversations out of this store until a fresh app launch.
    private var refusedConversationIDs: Set<String> = []
    private var refusedSnapshotIDs: Set<String> = []

    init(url: URL) {
        self.url = url
    }

    /// Read and decode every persisted snapshot. A missing file is a normal
    /// first launch — `[]` — while an unreadable payload is surfaced as
    /// `StoreError.corruptSnapshot` so callers can tell the states apart.
    func load() throws -> [ThreadSnapshot] {
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch let error as NSError
            where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {
            return []
        } catch {
            throw StoreError.corruptSnapshot(underlying: error)
        }
        do {
            return try JSONDecoder().decode([ThreadSnapshot].self, from: data)
        } catch {
            throw StoreError.corruptSnapshot(underlying: error)
        }
    }

    /// Encode and atomically replace the snapshot file. Cancellation is
    /// honoured before the write, so a cancelled save never replaces the last
    /// valid snapshot with a partial state.
    func save(_ snapshots: [ThreadSnapshot]) throws {
        try Task.checkCancellation()
        try write(retainedSnapshots(snapshots), cancellable: true)
    }

    /// Complete the disk purge before the denied conversation read returns.
    /// This security invalidation must finish even if its caller is cancelled.
    func purgeConversation(sessionId: String, snapshotIDs: Set<String> = []) throws {
        guard !sessionId.isEmpty else { return }
        refusedConversationIDs.insert(sessionId)
        refusedSnapshotIDs.formUnion(snapshotIDs)
        let snapshots = try load()
        let retained = retainedSnapshots(snapshots)
        guard retained.count != snapshots.count else { return }
        try write(retained, cancellable: false)
    }

    private func retainedSnapshots(_ snapshots: [ThreadSnapshot]) -> [ThreadSnapshot] {
        for snapshot in snapshots where refusedConversationIDs.contains(snapshot.id)
            || snapshot.sessionIds.values.contains(where: { refusedConversationIDs.contains($0) })
            || (snapshot.flowSessionIds ?? []).contains(where: { refusedConversationIDs.contains($0) }) {
            // Session promotion/rebinding keeps the local thread and its messages.
            // Remember that identity so a later binding cannot revive the data.
            refusedSnapshotIDs.insert(snapshot.id)
        }
        return snapshots.filter { snapshot in
            !refusedSnapshotIDs.contains(snapshot.id)
                && !refusedConversationIDs.contains(snapshot.id)
                && snapshot.sessionIds.values.allSatisfy { !refusedConversationIDs.contains($0) }
                && (snapshot.flowSessionIds ?? []).allSatisfy { !refusedConversationIDs.contains($0) }
        }
    }

    private func write(_ snapshots: [ThreadSnapshot], cancellable: Bool) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(snapshots)
        if cancellable { try Task.checkCancellation() }
        try data.write(to: url, options: .atomic)
    }
}
