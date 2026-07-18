import Foundation

/// Incremental parser for one SSE (`text/event-stream`) connection, shared by
/// the original send stream and the mid-turn resume stream (cave-h40l).
///
/// Feed it lines; it returns a decoded `StreamEvent` whenever a frame
/// completes, and tracks the last `id:` seen — the server puts the run
/// buffer's seq there, so `lastEventId` is always a valid resume cursor for
/// `GET /api/chat/stream?cursor=`.
struct SSELineParser {
    /// Last `id:` field seen — the resume cursor. Nil until the server sends one.
    private(set) var lastEventId: Int?
    private var dataLines: [String] = []

    /// Consume one line. Returns a decoded event when the line completes a
    /// frame (single-`data:` fast path or blank-line boundary), else nil.
    mutating func consume(_ line: String) -> StreamEvent? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            // Blank line = frame boundary. Flush accumulated data.
            return flush()
        }
        if trimmed.hasPrefix("id:") {
            let value = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            if let id = Int(value) { lastEventId = id }
            return nil
        }
        if trimmed.hasPrefix("data:") {
            let payload = String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            // Fast path: most frames are one data line; decode immediately so
            // a missing trailing blank line can't strand the final event.
            if dataLines.isEmpty, let event = StreamEvent.decode(payload) {
                return event
            }
            dataLines.append(payload)
            return nil
        }
        // Other SSE fields (event:, retry:, ": comment" keep-alives) are ignored.
        return nil
    }

    /// Flush any buffered multi-line frame — call at end of stream too, so a
    /// trailing event with no terminating blank line still decodes.
    mutating func flush() -> StreamEvent? {
        guard !dataLines.isEmpty else { return nil }
        let joined = dataLines.joined(separator: "\n")
        dataLines.removeAll()
        return StreamEvent.decode(joined)
    }
}
