import Foundation
import UIKit

/// Bridges the chat stream lifecycle to away-from-app surfaces: local
/// notifications when a turn finishes while backgrounded, a Live Activity for
/// the running turn (Dynamic Island / Lock Screen), and a background-task
/// grace window so an in-flight stream can finish after the user pockets the
/// phone. `ChatThread.stream` calls the three hooks; everything else is
/// resolved here so the thread model stays UIKit-free beyond this seam.
@MainActor
final class ChatTurnNotifier {
    static let shared = ChatTurnNotifier()
    private init() {}

    /// Set once at app construction — resolves familiar display names.
    weak var app: AppModel?

    /// One background grace window per in-flight turn (keyed by message id) so
    /// backgrounding mid-stream leaves ~30s for the reply + banner to land.
    private var graceTasks: [String: UIBackgroundTaskIdentifier] = [:]
    /// Last status label pushed to the Live Activity — skip no-op updates.
    private var lastStatusLabel: String?

    /// A turn began streaming into `messageId`.
    func turnStarted(thread: ChatThread, familiarId: String, messageId: String) {
        let token = UIApplication.shared.beginBackgroundTask(withName: "cave.chat.turn") {
            [weak self] in self?.endGrace(messageId)
        }
        if token != .invalid { graceTasks[messageId] = token }
        guard ChatNotifications.isEnabled else { return }
        Task { await ChatNotifications.requestAuthorizationIfNeeded() }
        let name = familiarName(familiarId)
        Task {
            await LiveActivityManager.shared.startChat(threadId: thread.id,
                                                       familiarName: name)
        }
    }

    /// The running turn's activity trail advanced — mirror it on the island.
    func turnStatus(thread: ChatThread, label: String?) {
        guard let label, !label.isEmpty, label != lastStatusLabel else { return }
        lastStatusLabel = label
        Task {
            await LiveActivityManager.shared.updateChat(threadId: thread.id,
                                                        statusLabel: label)
        }
    }

    /// The stream into `messageId` ended (any path — done, error, resync, or
    /// re-queued offline). Posts the banner when the reply landed while the
    /// app was away, and retires the Live Activity once the thread is idle.
    func turnFinished(thread: ChatThread, messageId: String) {
        defer { endGrace(messageId) }
        if !thread.isStreaming {
            lastStatusLabel = nil
            Task { await LiveActivityManager.shared.endChat(threadId: thread.id) }
        }
        // Re-queued offline sends remove the placeholder — nothing landed.
        guard let message = thread.messages.first(where: { $0.id == messageId }),
              !message.streaming else { return }
        let active = UIApplication.shared.applicationState == .active
        guard ChatNotifications.shouldNotify(appActive: active,
                                             threadMuted: thread.muted,
                                             enabled: ChatNotifications.isEnabled)
        else { return }
        let title = message.familiarId.map(familiarName) ?? thread.title
        let body = ChatNotifications.preview(text: message.text,
                                             isError: message.isError)
        let threadId = thread.id
        Task { await ChatNotifications.post(threadId: threadId, title: title, body: body) }
    }

    private func familiarName(_ id: String) -> String {
        app?.familiar(id)?.displayName ?? id
    }

    private func endGrace(_ messageId: String) {
        guard let token = graceTasks.removeValue(forKey: messageId) else { return }
        UIApplication.shared.endBackgroundTask(token)
    }
}
