import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var app = app
        Group {
            if app.deepLink == .search && !app.hasLoadedSurfaces && app.connectionState != .connected {
                // Search deep link before a connection exists: land on the
                // local-index SearchView rather than the Connect screen. The
                // hasLoadedSurfaces guard limits this to the genuine
                // pre-connection case — once the tab tree has data, a stale
                // .search marker must never tear it down on a connection blip.
                SearchView()
            } else {
                switch app.connectionState {
                case .unconfigured, .needsAuth:
                    // No endpoint, or the desktop is up but demands pairing —
                    // only the user can fix either, so the Connect screen takes
                    // over fully.
                    ConnectionView()
                case .checking where app.connection != nil && !app.hasLoadedSurfaces:
                    ConnectingView()
                case .unreachable where !app.hasLoadedSurfaces:
                    // Never got in this session — nothing to keep on screen.
                    ConnectionView()
                default:
                    // Connected — or a transient drop AFTER surfaces loaded. Keep
                    // the tab tree mounted (cached data stays usable, offline
                    // compose keeps queueing) and narrate recovery with the pill
                    // instead of tearing down to the Connect screen.
                    MainTabView()
                }
            }
        }
        .overlay(alignment: .top) {
            if showsReconnectPill {
                ReconnectPill(lastSeenAt: app.lastConnectedAt) {
                    Task { await app.refreshConnection(reloadLoadedSurfaces: true, quiet: true) }
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.25), value: showsReconnectPill)
        // While the pill is up over the tabs, quietly re-probe so a desktop
        // that comes back (restarted, woke from sleep) reconnects on its own.
        // The Connect screen has its own ticker for the pre-surfaces case;
        // the hasLoadedSurfaces guard keeps the two from double-probing.
        // Keyed on scenePhase so backgrounding stops the timer.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                if Task.isCancelled { return }
                guard app.hasLoadedSurfaces,
                      case .unreachable = app.connectionState else { continue }
                await app.refreshConnection(reloadLoadedSurfaces: true, quiet: true)
            }
        }
        .background(chrome.bgBase.ignoresSafeArea())
        .foregroundStyle(chrome.textPrimary)
        // Frosted, accent-infused tab + navigation bars that track the desktop
        // palette and degrade to solid themed surfaces under Reduce Transparency.
        .glassBars()
        // The Diary presents HERE, not inside MainTabView: the switch above
        // swaps the tab tree out on a transient connection flap, and a cover
        // presented from within it would dismiss mid-reply, aborting the
        // diary's stream.
        .fullScreenCover(isPresented: $app.diaryPresented) {
            DiaryView()
        }
    }

    /// The tabs are mounted but the desktop is out of reach (or a recovery
    /// probe is in flight) — show the honest "Reconnecting…" pill.
    private var showsReconnectPill: Bool {
        guard app.hasLoadedSurfaces else { return false }
        switch app.connectionState {
        case .unreachable, .checking: return true
        default: return false
        }
    }
}

/// Floating "Reconnecting… · last seen Xm" capsule shown over the mounted tab
/// tree during a connection drop. Tapping it fires an immediate quiet probe
/// instead of waiting out the 10s ticker.
private struct ReconnectPill: View {
    @Environment(\.chrome) private var chrome
    var lastSeenAt: Date?
    var retry: () -> Void

    var body: some View {
        Button(action: retry) {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                    .tint(chrome.textSecondary)
                label
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .glass(.elevated, in: Capsule())
        .padding(.top, 6)
        .accessibilityLabel(label)
        .accessibilityHint(Text("Tap to retry now."))
    }

    /// `Text(_:style:)` renders an auto-updating relative clock ("2 min"),
    /// so the pill's age counts up without a timer.
    private var label: Text {
        guard let lastSeenAt else { return Text("Reconnecting…") }
        return Text("Reconnecting… · last seen \(Text(lastSeenAt, style: .relative)) ago")
    }
}

/// Bottom tab bar shown once connected: Chats, Tasks, Developer, Settings.
///
/// Uses the modern `Tab(value:)` API (iOS 18+). The legacy `.tabItem`/`.tag`
/// TabView on the iOS 26 SDK reset the selection to the first tab on a cold
/// launch, clobbering any restored value; the value-based `Tab` API honours the
/// initial selection, so the app reliably reopens on the last-used tab.
struct MainTabView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    /// Tab order, used to map ⌘1–7 to the right tab.
    private let tabOrder: [AppTab] = [.chats, .canvas, .tasks, .calendar, .dev, .settings, .search]

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            Tab("Chats", systemImage: "bubble.left.and.bubble.right.fill", value: AppTab.chats) {
                ChatsHomeView()
            }
            Tab("Canvas", systemImage: "wand.and.stars", value: AppTab.canvas) {
                CanvasView()
            }
            Tab("Tasks", systemImage: "checklist", value: AppTab.tasks) {
                TasksView()
            }
            Tab("Calendar", systemImage: "calendar", value: AppTab.calendar) {
                CalendarView()
            }
            Tab("Developer", systemImage: "chevron.left.forwardslash.chevron.right", value: AppTab.dev) {
                DeveloperView()
            }
            Tab("Settings", systemImage: "gearshape.fill", value: AppTab.settings) {
                SettingsView()
            }
            Tab(value: .search, role: .search) {
                SearchView()
            }
        }
        // Command confirmations float above the whole tab bar so they're visible
        // whether a command stays in chat or jumps to the Tasks tab.
        .toast($app.toast)
        // Hardware-keyboard tab switching (iPad / Mac over Tailscale): ⌘1–6.
        // Hidden buttons keep the shortcuts active without affecting layout.
        .background {
            ForEach(Array(tabOrder.enumerated()), id: \.element) { index, tab in
                Button {
                    app.selectedTab = tab
                } label: { EmptyView() }
                .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
            }
        }
        // Keep the app chrome in step with desktop theme changes: re-fetch while
        // connected. `loadTheme` is best-effort and only assigns on change, so an
        // unchanged theme is a cheap no-op. Keyed on scenePhase so the 20s poll
        // only runs while the app is active — backgrounding cancels the task
        // (no needless network while the user isn't looking), and returning to
        // the foreground restarts it with an immediate refresh.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                if app.connectionState == .connected { await app.loadTheme() }
                try? await Task.sleep(for: .seconds(20))
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
