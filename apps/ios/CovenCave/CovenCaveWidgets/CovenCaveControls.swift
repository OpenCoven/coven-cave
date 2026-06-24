import AppIntents
import SwiftUI
import WidgetKit

// Control Center / Lock Screen controls (iOS 18). Each is a one-tap shortcut
// that opens the app at the right surface via the covencave:// deep links the
// app already routes (see CovenCaveApp.onOpenURL). The Tasks control also shows
// a live "running" count read from the shared App Group snapshot.

/// Open the reminders list.
struct RemindersControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "ai.opencoven.cave.control.reminders") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "covencave://reminders")!)) {
                Label("Reminders", systemImage: "bell.fill")
            }
        }
        .displayName("Coven Reminders")
        .description("Open your reminders in Coven Cave.")
    }
}

/// Supplies the current "running tasks" count for the Tasks control.
struct RunningTasksValueProvider: ControlValueProvider {
    var previewValue: Int { 1 }

    func currentValue() async throws -> Int {
        WidgetSnapshotStore.read()?.runningTaskCount ?? 0
    }
}

/// Show how many tasks are running and open the Tasks tab.
struct TasksControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(
            kind: "ai.opencoven.cave.control.tasks",
            provider: RunningTasksValueProvider()
        ) { running in
            ControlWidgetButton(action: OpenURLIntent(URL(string: "covencave://tasks")!)) {
                Label(running > 0 ? "\(running) running" : "Tasks", systemImage: "play.circle.fill")
            }
        }
        .displayName("Coven Tasks")
        .description("See running tasks and open the Tasks tab.")
    }
}
