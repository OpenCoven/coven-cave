import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            switch app.connectionState {
            case .unconfigured:
                ConnectionView()
            case .checking where app.connection != nil && app.familiars.isEmpty:
                ConnectingView()
            case .unreachable:
                ConnectionView()
            default:
                MainTabView()
            }
        }
    }
}

/// Bottom tab bar shown once connected: Chats + Tasks.
///
/// Uses the modern `Tab(value:)` API (iOS 18+). The legacy `.tabItem`/`.tag`
/// TabView on the iOS 26 SDK reset the selection to the first tab on a cold
/// launch, clobbering any restored value; the value-based `Tab` API honours the
/// initial selection, so the app reliably reopens on the last-used tab.
struct MainTabView: View {
    @Environment(AppModel.self) private var app

    /// Tab order, used to map ⌘1–5 to the right tab.
    private let tabOrder: [AppTab] = [.chats, .read, .tasks, .dev, .settings]

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            Tab("Chats", systemImage: "bubble.left.and.bubble.right.fill", value: AppTab.chats) {
                ChatsHomeView()
            }
            Tab("Read", systemImage: "books.vertical.fill", value: AppTab.read) {
                ReadingView()
            }
            Tab("Tasks", systemImage: "checklist", value: AppTab.tasks) {
                TasksView()
            }
            Tab("Developer", systemImage: "chevron.left.forwardslash.chevron.right", value: AppTab.dev) {
                DeveloperView()
            }
            Tab("Settings", systemImage: "gearshape.fill", value: AppTab.settings) {
                SettingsView()
            }
        }
        // Command confirmations float above the whole tab bar so they're visible
        // whether a command stays in chat or jumps to the Tasks tab.
        .toast($app.toast)
        // Hardware-keyboard tab switching (iPad / Mac over Tailscale): ⌘1–5.
        // Hidden buttons keep the shortcuts active without affecting layout.
        .background {
            ForEach(Array(tabOrder.enumerated()), id: \.element) { index, tab in
                Button {
                    app.selectedTab = tab
                } label: { EmptyView() }
                .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
            }
        }
    }
}

struct ConnectingView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 16) {
            ProgressView().controlSize(.large)
            Text("Connecting to your desktop…")
                .foregroundStyle(.secondary)
            if let host = app.connection?.host {
                Text(host).font(.footnote.monospaced()).foregroundStyle(.tertiary)
            }
        }
        .padding()
    }
}
