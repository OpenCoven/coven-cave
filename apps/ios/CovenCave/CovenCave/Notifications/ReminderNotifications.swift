import Foundation
import UserNotifications

/// Removes local alerts left by the retired reminders surface. Backend
/// reminders and chat notifications are never changed by this migration.
@MainActor
enum ReminderNotifications {
    private nonisolated static let idPrefix = "cave.reminder."

    nonisolated static func deepLinkURL(taskId: String? = nil) -> URL? {
        nil
    }

    nonisolated static func deepLinkURL(for reminder: Reminder) -> URL? {
        if let threadId = reminder.link?.resolvedThreadNavigationID {
            return ProjectNavigationIntent(
                entity: .thread(id: threadId),
                destination: .chats
            ).url
        }
        return nil
    }

    nonisolated static func isRetiredRequest(identifier: String) -> Bool {
        identifier.hasPrefix(idPrefix)
    }

    /// Legacy callers may still request reconciliation; only chat owns new
    /// notification permission prompts.
    static func requestAuthorizationIfNeeded() async {
        await clear()
    }

    /// Kept for legacy reminder mutations, but never schedules new alerts.
    static func sync(_: [Reminder]) async {
        await clear()
    }

    /// Clear only alerts issued by the retired reminder scheduler.
    static func clear() async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        let ours = pending.map(\.identifier).filter { isRetiredRequest(identifier: $0) }
        center.removePendingNotificationRequests(withIdentifiers: ours)
        let delivered = await center.deliveredNotifications()
        let retired = delivered.map(\.request.identifier).filter { isRetiredRequest(identifier: $0) }
        center.removeDeliveredNotifications(withIdentifiers: retired)
    }
}

/// Bridges notification taps (and foreground presentation) back to the app's
/// deep-link router. Set as the notification-center delegate at launch.
final class CaveNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    override init() {
        super.init()
        Task { await ReminderNotifications.clear() }
    }

    @MainActor private var pendingOpen: URL?
    @MainActor var onOpen: ((URL) -> Void)? {
        didSet {
            guard let onOpen, let pendingOpen else { return }
            self.pendingOpen = nil
            onOpen(pendingOpen)
        }
    }

    /// Buffer a cold-launch tap until the SwiftUI app installs its router.
    @MainActor
    func open(_ url: URL) {
        guard let onOpen else {
            pendingOpen = url
            return
        }
        onOpen(url)
    }

    /// A reminder already being delivered during migration stays silent.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        guard !ReminderNotifications.isRetiredRequest(identifier: notification.request.identifier) else {
            return []
        }
        return [.banner, .sound]
    }

    /// Taps use the shared router, which also rejects retired destinations.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let raw = response.notification.request.content.userInfo["deepLink"] as? String,
              let url = URL(string: raw) else { return }
        await MainActor.run { open(url) }
    }
}
