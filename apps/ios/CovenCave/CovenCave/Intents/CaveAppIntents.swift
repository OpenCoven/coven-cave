import AppIntents
import Foundation

/// Create a reminder by voice / Spotlight / Shortcuts — e.g. "New Coven reminder".
/// Runs without opening the app: it reads the saved connection and POSTs directly.
struct NewReminderIntent: AppIntent {
    static var title: LocalizedStringResource = "New Reminder"
    static var description = IntentDescription("Create a reminder in Coven Cave.")

    @Parameter(title: "Reminder", requestValueDialog: "What's the reminder?")
    var text: String

    @Parameter(title: "When")
    var when: Date?

    static var parameterSummary: some ParameterSummary {
        Summary("Remind me to \(\.$text) at \(\.$when)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let connection = CaveConnection.load() else {
            return .result(dialog: "Open Coven Cave and connect to your desktop first.")
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .result(dialog: "I need something to remind you about.") }
        let fireAt = when ?? Date().addingTimeInterval(3600)
        do {
            try await CaveClient(connection: connection).createReminder(title: trimmed, fireAt: fireAt)
            return .result(dialog: "Reminder set: \(trimmed)")
        } catch {
            return .result(dialog: "Couldn't reach your desktop to set that reminder.")
        }
    }
}

/// Ask what's running — e.g. "What's running in Coven Cave". Read-only summary.
struct RunningTasksIntent: AppIntent {
    static var title: LocalizedStringResource = "Running Tasks"
    static var description = IntentDescription("Summarize the tasks currently running.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let connection = CaveConnection.load() else {
            return .result(dialog: "Open Coven Cave and connect to your desktop first.")
        }
        let running = ((try? await CaveClient(connection: connection).tasks()) ?? [])
            .filter { $0.status == .running }
        guard !running.isEmpty else { return .result(dialog: "Nothing is running right now.") }
        let names = running.prefix(3).map(\.title).joined(separator: ", ")
        let more = running.count > 3 ? ", and \(running.count - 3) more" : ""
        let count = running.count
        return .result(dialog: "\(count) task\(count == 1 ? "" : "s") running: \(names)\(more).")
    }
}

/// Surfaces the intents to Siri, Spotlight, and the Shortcuts app with spoken
/// phrases. Discovered automatically once the app has launched at least once.
struct CaveShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: NewReminderIntent(),
            phrases: [
                "New \(.applicationName) reminder",
                "Set a reminder in \(.applicationName)",
            ],
            shortTitle: "New Reminder",
            systemImageName: "bell.badge"
        )
        AppShortcut(
            intent: RunningTasksIntent(),
            phrases: [
                "What's running in \(.applicationName)",
                "\(.applicationName) running tasks",
            ],
            shortTitle: "Running Tasks",
            systemImageName: "play.circle"
        )
    }
}
