import AppIntents
import Foundation

/// Retained only so a saved shortcut explains the retirement without writing
/// reminders or reopening a retired destination.
struct NewReminderIntent: AppIntent {
    static var title: LocalizedStringResource = "New Reminder"
    static var description = IntentDescription("Reminders are available on desktop.")
    static var isDiscoverable: Bool = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @Parameter(title: "Reminder", requestValueDialog: "What's the reminder?")
    var text: String

    @Parameter(title: "When")
    var when: Date?

    static var parameterSummary: some ParameterSummary {
        Summary("Remind me to \(\.$text) at \(\.$when)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: "Reminders are available in Coven Cave on your desktop.")
    }
}

/// A compatibility response for previously saved task-summary shortcuts.
struct RunningTasksIntent: AppIntent {
    static var title: LocalizedStringResource = "Running Tasks"
    static var description = IntentDescription("Tasks are available on desktop.")
    static var isDiscoverable: Bool = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: "Tasks are available in Coven Cave on your desktop.")
    }
}

struct OpenChatsIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Chats"
    static var description = IntentDescription("Open your Coven Cave conversations.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "covencave://chats")!))
    }
}

/// Only chat is offered to Siri, Spotlight, and the Shortcuts app.
struct CaveShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenChatsIntent(),
            phrases: [
                "Open \(.applicationName) chats",
                "Open chats in \(.applicationName)",
            ],
            shortTitle: "Open Chats",
            systemImageName: "bubble.left.and.bubble.right"
        )
    }
}
