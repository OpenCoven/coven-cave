import Foundation
import UserNotifications

/// Schedules on-device notifications for upcoming reminders so the phone buzzes
/// when one is due — even when the desktop is asleep or off the tailnet. Today
/// the phone only *lists* reminders; this makes them actionable away from the desk.
///
/// Idempotent: each `sync` clears our previously-scheduled reminders and re-adds
/// the current upcoming set, so edits/completions on the desktop are reflected on
/// the next refresh. We own only identifiers prefixed with `idPrefix`, so other
/// notifications (if any are ever added) are left untouched.
@MainActor
enum ReminderNotifications {
    private static let idPrefix = "cave.reminder."
    /// iOS keeps at most 64 pending requests per app; stay comfortably under.
    private static let maxScheduled = 60

    /// Ask once. Safe to call repeatedly — the system only prompts while the
    /// status is undetermined; afterwards this is a cheap no-op.
    static func requestAuthorizationIfNeeded() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return }
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    }

    /// Reschedule local notifications to match `reminders`. Only pending reminders
    /// with a future fire time are scheduled; the soonest `maxScheduled` win.
    static func sync(_ reminders: [Reminder]) async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional else {
            await clear()
            return
        }

        await clear()

        let now = Date()
        let upcoming = reminders
            .filter { $0.status == "pending" }
            .compactMap { r -> (Reminder, Date)? in
                guard let iso = r.fireAt, let date = caveParseISO(iso), date > now else { return nil }
                return (r, date)
            }
            .sorted { $0.1 < $1.1 }
            .prefix(maxScheduled)

        for (reminder, fireDate) in upcoming {
            let content = UNMutableNotificationContent()
            content.title = "Reminder"
            content.body = reminder.title
            content.sound = .default
            // Tapping routes to the reminders list via the app's deep-link handler.
            content.userInfo = ["deepLink": "covencave://reminders"]
            let comps = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute, .second], from: fireDate)
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
            let request = UNNotificationRequest(
                identifier: idPrefix + reminder.id, content: content, trigger: trigger)
            try? await center.add(request)
        }
    }

    /// Remove every notification we scheduled that is still pending.
    static func clear() async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        let ours = pending.map(\.identifier).filter { $0.hasPrefix(idPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ours)
    }
}

/// Bridges notification taps (and foreground presentation) back to the app's
/// deep-link router. Set as the notification-center delegate at launch.
final class CaveNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    var onOpen: ((URL) -> Void)?

    /// Show reminder banners even while the app is in the foreground.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    /// A tapped reminder opens the reminders list.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let raw = response.notification.request.content.userInfo["deepLink"] as? String,
              let url = URL(string: raw) else { return }
        await MainActor.run { onOpen?(url) }
    }
}
