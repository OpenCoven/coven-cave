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
struct MainTabView: View {
    enum Tab: String { case chats, tasks }
    // Plain-String storage (RawRepresentable @AppStorage bridging is unreliable);
    // persisted so the app reopens on the last-used tab.
    @AppStorage("cave.tab") private var rawTab: String = Tab.chats.rawValue

    private var selection: Binding<Tab> {
        Binding(
            get: { Tab(rawValue: rawTab) ?? .chats },
            set: { rawTab = $0.rawValue }
        )
    }

    var body: some View {
        TabView(selection: selection) {
            ChatsHomeView()
                .tabItem { Label("Chats", systemImage: "bubble.left.and.bubble.right.fill") }
                .tag(Tab.chats)
            TasksView()
                .tabItem { Label("Tasks", systemImage: "checklist") }
                .tag(Tab.tasks)
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
