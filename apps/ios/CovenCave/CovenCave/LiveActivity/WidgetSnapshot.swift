import Foundation

/// A tiny snapshot the app publishes to the shared App Group so the home-screen
/// widget can render without its own network access. Written after reminders /
/// tasks load; read by the widget's timeline provider.
struct WidgetSnapshot: Codable, Hashable {
    var dueTaskCount: Int
    var runningTaskCount: Int
    var projectContextID: String?
    var updatedAt: Date
}

enum WidgetSnapshotStore {
    static let appGroup = "group.ai.opencoven.cave"
    private static let key = "widget.snapshot.v1"

    private static func resolvedDefaults(_ defaults: UserDefaults?) -> UserDefaults? {
        defaults ?? UserDefaults(suiteName: appGroup)
    }

    static func write(_ snapshot: WidgetSnapshot, defaults: UserDefaults? = nil) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        resolvedDefaults(defaults)?.set(data, forKey: key)
    }

    static func read(defaults: UserDefaults? = nil) -> WidgetSnapshot? {
        guard let data = resolvedDefaults(defaults)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }
}
