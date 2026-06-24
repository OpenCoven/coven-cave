import AppIntents
import WidgetKit
import Foundation

/// Mark the widget's "next reminder" done, straight from the home-screen widget.
/// Self-contained (no app-model dependency) so it compiles into the widget
/// extension too: it reads the API base the app published to the shared snapshot
/// and POSTs to the inbox endpoint, then refreshes the widget.
struct CompleteReminderIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Reminder"

    @Parameter(title: "Reminder ID")
    var reminderId: String

    init() {}
    init(reminderId: String) { self.reminderId = reminderId }

    func perform() async throws -> some IntentResult {
        await WidgetInboxAction.post(reminderId: reminderId, action: "done")
        return .result()
    }
}

/// Snooze the widget's "next reminder" by 15 minutes.
struct SnoozeReminderIntent: AppIntent {
    static var title: LocalizedStringResource = "Snooze Reminder"

    @Parameter(title: "Reminder ID")
    var reminderId: String

    init() {}
    init(reminderId: String) { self.reminderId = reminderId }

    func perform() async throws -> some IntentResult {
        let body = try? JSONSerialization.data(withJSONObject: ["minutes": 15])
        await WidgetInboxAction.post(reminderId: reminderId, action: "snooze", body: body)
        return .result()
    }
}

enum WidgetInboxAction {
    /// `POST /api/inbox/{id}/{action}` using the API base the app published to the
    /// shared snapshot. Best-effort: a failure leaves the reminder untouched and
    /// the next app refresh re-publishes the truth.
    static func post(reminderId: String, action: String, body: Data? = nil) async {
        guard let base = WidgetSnapshotStore.read()?.apiBaseURL else { return }
        let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
        let escaped = reminderId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? reminderId
        guard let url = URL(string: "\(trimmed)/api/inbox/\(escaped)/\(action)") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        _ = try? await URLSession.shared.data(for: req)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
