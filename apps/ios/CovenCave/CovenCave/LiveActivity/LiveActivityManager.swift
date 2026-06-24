import ActivityKit
import Foundation

/// Owns the single "task running" Live Activity. The app starts one for a
/// running task (from the task detail), and it ends automatically once that
/// task leaves the running state — or when the user stops it.
@MainActor
@Observable
final class LiveActivityManager {
    static let shared = LiveActivityManager()
    private init() {}

    private var current: Activity<TaskActivityAttributes>?
    /// The task currently tracked on the Lock Screen, if any (observed by views).
    private(set) var currentTaskId: String?

    var isSupported: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// Start (or replace) the Live Activity for a running task.
    func start(for card: BoardCard) async {
        guard isSupported else { return }
        await endCurrent()
        let attributes = TaskActivityAttributes(taskId: card.id, title: card.title, startedAt: Date())
        let state = TaskActivityAttributes.ContentState(statusLabel: card.status.label)
        do {
            current = try Activity.request(attributes: attributes,
                                           content: .init(state: state, staleDate: nil))
            currentTaskId = card.id
        } catch {
            current = nil
            currentTaskId = nil
        }
    }

    /// Stop tracking (user-initiated).
    func stop() async { await endCurrent() }

    /// End the activity if the tracked task is gone or no longer running. Called
    /// after task mutations / refreshes so completion auto-dismisses the card.
    func reconcile(_ tasks: [BoardCard]) async {
        guard let id = currentTaskId else { return }
        let stillRunning = tasks.first { $0.id == id }?.status == .running
        if !stillRunning { await endCurrent() }
    }

    private func endCurrent() async {
        guard let activity = current else { currentTaskId = nil; return }
        await activity.end(.init(state: activity.content.state, staleDate: nil),
                           dismissalPolicy: .immediate)
        current = nil
        currentTaskId = nil
    }
}
