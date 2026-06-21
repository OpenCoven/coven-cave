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
    enum AppTab: String { case chats, tasks }

    // @AppStorage holds the durable saved tab (read reliably at view init); the
    // visible tab is a plain @State the TabView can own without being fought by
    // the cold-launch reset.
    @AppStorage("cave.tab") private var savedTab = AppTab.chats.rawValue
    @State private var selection: AppTab = .chats
    @State private var restored = false

    var body: some View {
        TabView(selection: $selection) {
            Tab("Chats", systemImage: "bubble.left.and.bubble.right.fill", value: AppTab.chats) {
                ChatsHomeView()
            }
            Tab("Tasks", systemImage: "checklist", value: AppTab.tasks) {
                TasksView()
            }
        }
        // TabView wins a layout race at cold launch and resets its selection to
        // the first tab, overriding any seeded value — but the binding DOES drive
        // the tab once that settles. So re-assert the saved tab a beat later (from
        // @AppStorage, already loaded — a fresh UserDefaults read here races
        // cfprefsd). The `restored` guard stops the launch reset from persisting
        // over the saved value first.
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            if let saved = AppTab(rawValue: savedTab) { selection = saved }
            restored = true
        }
        .onChange(of: selection) { _, newValue in
            guard restored else { return }
            savedTab = newValue.rawValue
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
