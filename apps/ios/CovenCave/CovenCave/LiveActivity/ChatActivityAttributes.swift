import ActivityKit
import Foundation

/// Shared between the app (which starts/ends the activity) and the widget
/// extension (which renders it). The thread + familiar name and start time are
/// fixed for the life of the turn; only the status label changes as the
/// agent's activity trail advances.
struct ChatActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var statusLabel: String
    }
    var threadId: String
    var familiarName: String
    var startedAt: Date
}
