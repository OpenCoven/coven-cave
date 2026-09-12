import AppIntents
import SwiftUI
import WidgetKit

/// A chat-only entrypoint from Control Center or the Lock Screen.
struct ChatsControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(
            kind: "ai.opencoven.cave.control.chats"
        ) {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "covencave://chats")!)) {
                Label("Chats", systemImage: "bubble.left.and.bubble.right.fill")
            }
        }
        .displayName("Coven Chats")
        .description("Open your conversations.")
    }
}
