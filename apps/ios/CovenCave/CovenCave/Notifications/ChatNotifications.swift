import Foundation
import UserNotifications

/// Local notifications for chat turns that finish while the app is in the
/// background — send a prompt, pocket the phone, and the phone still tells you
/// the reply landed. The pure decision/content helpers live here so they can
/// be unit-tested; `ChatTurnNotifier` drives them from the stream lifecycle.
///
/// Identifiers are thread-scoped (`cave.chat.<threadId>`) so a newer reply in
/// the same thread replaces the previous banner instead of stacking, and so
/// `ReminderNotifications` (prefix `cave.reminder.`) never touches ours.
@MainActor
enum ChatNotifications {
    static let idPrefix = "cave.chat."
    /// Settings → Notifications toggle (default on; authorization still gates).
    static let enabledKey = "cave.chat.notifications"
    /// Longest reply preview shown in the banner body.
    static let previewCap = 160

    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true
    }

    // MARK: - Decision (pure)

    /// Whether a finished turn should post a banner. Foreground turns are
    /// visible in the transcript already; muted threads asked for silence;
    /// the toggle is the global off-switch. Error turns DO notify — a failed
    /// run is exactly what you want to learn about while away.
    nonisolated static func shouldNotify(appActive: Bool, threadMuted: Bool,
                                         enabled: Bool) -> Bool {
        enabled && !appActive && !threadMuted
    }

    /// Banner body from the final reply: first non-empty line, capped. Errors
    /// get a readable fallback when the message carries no text.
    nonisolated static func preview(text: String, isError: Bool) -> String {
        let firstLine = text.split(separator: "\n", omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty } ?? ""
        if firstLine.isEmpty {
            return isError ? "The run failed." : "Reply ready."
        }
        let capped = firstLine.count > previewCap
            ? String(firstLine.prefix(previewCap)) + "…" : firstLine
        return isError ? "⚠️ \(capped)" : capped
    }

    // MARK: - Deep link (pure)

    /// `covencave://thread/<id>` — routed by `AppModel.handleDeepLink` to the
    /// existing `requestOpen` one-shot (same hook the chat list already uses).
    nonisolated static func deepLinkURL(threadId: String) -> URL? {
        var comps = URLComponents()
        comps.scheme = "covencave"
        comps.host = "thread"
        comps.path = "/" + threadId
        return comps.url
    }

    /// The thread id carried by a chat deep link, or nil for any other URL.
    nonisolated static func threadId(fromDeepLink url: URL) -> String? {
        guard url.scheme == "covencave", url.host == "thread" else { return nil }
        let id = url.pathComponents.count > 1 ? url.pathComponents[1] : ""
        return id.isEmpty ? nil : id
    }

    // MARK: - Posting

    /// Ask once. Safe to call repeatedly — the system only prompts while the
    /// status is undetermined; afterwards this is a cheap no-op.
    static func requestAuthorizationIfNeeded() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return }
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    }

    /// Post the turn-completion banner. Tapping opens the thread.
    static func post(threadId: String, title: String, body: String) async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = idPrefix + threadId
        if let url = deepLinkURL(threadId: threadId) {
            content.userInfo = ["deepLink": url.absoluteString]
        }
        let request = UNNotificationRequest(identifier: idPrefix + threadId,
                                            content: content, trigger: nil)
        try? await center.add(request)
    }

    /// Opening a thread makes its banner stale — clear it from the shade.
    static func removeDelivered(threadId: String) {
        UNUserNotificationCenter.current()
            .removeDeliveredNotifications(withIdentifiers: [idPrefix + threadId])
    }
}
