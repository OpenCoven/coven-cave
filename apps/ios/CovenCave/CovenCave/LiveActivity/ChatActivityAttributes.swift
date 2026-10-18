import ActivityKit
import Foundation

/// Shared between the app (which starts/ends the activity) and the widget
/// extension (which renders it). The thread + familiar name and start time are
/// fixed for the life of the turn. The Lock Screen carries only a generic
/// running label; tool/progress titles remain inside the authenticated chat.
struct ChatActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let statusLabel: String

        private static let runningLabel = "Working…"
        private enum CodingKeys: String, CodingKey { case statusLabel }

        // Preserve the existing call/wire shape without giving a trace title
        // disclosure rights merely because a Live Activity is enabled.
        init(statusLabel _: String) {
            statusLabel = Self.runningLabel
        }

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            // Old activities may have persisted a tool/progress title. Check
            // the field's type, but never restore that text onto the screen.
            _ = try values.decodeIfPresent(String.self, forKey: .statusLabel)
            statusLabel = Self.runningLabel
        }
    }
    var threadId: String
    var familiarName: String
    var startedAt: Date
}
