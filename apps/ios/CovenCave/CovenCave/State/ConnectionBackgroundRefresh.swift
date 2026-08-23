import BackgroundTasks
import Foundation

/// Opportunistic iOS background maintenance for the paired desktop link.
///
/// BGAppRefreshTask is not a persistent connection and iOS does not promise a
/// cadence. When the system grants time, Cave performs exactly one ping and
/// rolls a near-expiry token. Foreground recovery remains owned by AppModel's
/// single jittered supervisor.
@MainActor
final class ConnectionBackgroundRefresh {
    static let shared = ConnectionBackgroundRefresh()
    static let identifier = "ai.opencoven.cave.connection-refresh"
    static let earliestRefreshInterval: TimeInterval = 12 * 60 * 60

    private weak var app: AppModel?
    private var registered = false
    private var operation: Task<Void, Never>?
    private weak var activeTask: BGAppRefreshTask?

    private init() {}

    /// Must run during app initialization, before launch completes, so iOS can
    /// deliver a background launch directly to the registered handler.
    func register(app: AppModel) {
        self.app = app
        guard !registered else { return }
        registered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.identifier,
            using: nil
        ) { [weak self] task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in self?.handle(refreshTask) }
        }
    }

    /// Replace our pending request so repeated background transitions never
    /// accumulate multiple refreshes. `earliestBeginDate` is a floor only;
    /// the system may run substantially later or not at all.
    func schedule() {
        guard app?.connection != nil else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.identifier)
            return
        }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.identifier)
        let request = BGAppRefreshTaskRequest(identifier: Self.identifier)
        request.earliestBeginDate = Date(
            timeIntervalSinceNow: Self.earliestRefreshInterval
        )
        try? BGTaskScheduler.shared.submit(request)
    }

    /// The foreground supervisor has the richer recovery context. Do not let a
    /// short background maintenance pass race it when the scene becomes active.
    func cancelRunningForForeground() {
        guard let activeTask else { return }
        operation?.cancel()
        finish(activeTask, success: false)
    }

    private func handle(_ task: BGAppRefreshTask) {
        // Queue the successor before any network work. Expiration or process
        // suspension cannot otherwise create a permanent scheduling gap.
        schedule()

        if let previous = activeTask {
            operation?.cancel()
            finish(previous, success: false)
        }
        activeTask = task
        task.expirationHandler = { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.operation?.cancel()
                self.finish(task, success: false)
            }
        }

        operation = Task { @MainActor [weak self] in
            guard let self else {
                task.setTaskCompleted(success: false)
                return
            }
            let success = await self.app?.performBackgroundConnectionMaintenance() ?? false
            self.finish(task, success: success && !Task.isCancelled)
        }
    }

    /// Identity guarding makes normal completion and expiration converge on
    /// one `setTaskCompleted` call, as required by BackgroundTasks.
    private func finish(_ task: BGAppRefreshTask, success: Bool) {
        guard activeTask === task else { return }
        task.expirationHandler = nil
        activeTask = nil
        operation = nil
        task.setTaskCompleted(success: success)
    }
}
