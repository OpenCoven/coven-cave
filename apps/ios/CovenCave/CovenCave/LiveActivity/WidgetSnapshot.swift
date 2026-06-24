import Foundation

/// A tiny snapshot the app publishes to the shared App Group so the home-screen
/// widget can render without its own network access. Written after reminders /
/// tasks load; read by the widget's timeline provider.
struct WidgetSnapshot: Codable, Hashable {
    var nextReminderTitle: String?
    var nextReminderDate: Date?
    var dueTaskCount: Int
    var runningTaskCount: Int
    var updatedAt: Date
}

enum WidgetSnapshotStore {
    static let appGroup = "group.ai.opencoven.cave"
    private static let key = "widget.snapshot.v1"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func write(_ snapshot: WidgetSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults?.set(data, forKey: key)
    }

    static func read() -> WidgetSnapshot? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }
}
