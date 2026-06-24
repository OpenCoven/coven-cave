import ActivityKit
import Foundation

/// Shared between the app (which starts/ends the activity) and the widget
/// extension (which renders it). The title + start time are fixed for the life
/// of the activity; only the status label changes.
struct TaskActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var statusLabel: String
    }
    var taskId: String
    var title: String
    var startedAt: Date
}
