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
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(snapshots)
        try Task.checkCancellation()
        try data.write(to: url, options: .atomic)
    }
}
