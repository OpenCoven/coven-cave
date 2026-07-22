import SwiftUI
import UserNotifications

@main
struct CovenCaveApp: App {
    @State private var app = AppModel()
    @State private var notificationDelegate = CaveNotificationDelegate()
    @AppStorage(AppearanceMode.storageKey) private var appearanceRaw = AppearanceMode.desktop.rawValue
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        // Mirror the desktop appearance by default; a fixed Light/Dark override
        // makes the phone independent (Settings → Appearance).
        let mode = AppearanceMode(rawValue: appearanceRaw) ?? .desktop
        let resolved = mode.resolve(desktop: app.chrome)
        return WindowGroup {
            // Wide windows earn the split layouts (cave-bgmg): non-Max iPhones
            // report a COMPACT horizontal size class in landscape, so every
            // NavigationSplitView collapses and the lists stretch into one
            // sparse full-width column. Any window wide enough for two real
            // columns behaves as regular — the same call Apple makes for Max
            // phones — which engages the existing balanced splits everywhere.
            WideSplitEnabler {
                RootView()
            }
                .environment(app)
                // Propagate the chrome palette to every view, tint app-wide
                // controls with its accent, and apply the resolved light/dark mode.
                .environment(\.chrome, resolved.chrome)
                .tint(resolved.chrome.accent)
                .preferredColorScheme(resolved.scheme)
                .task {
                    app.startConnectionSupervisor()
                    // Route notification taps (reminders, chat replies) to the
                    // deep-link handler, and show banners while foregrounded.
                    notificationDelegate.onOpen = { app.handleDeepLink($0) }
                    UNUserNotificationCenter.current().delegate = notificationDelegate
                    if app.connection != nil {
                        await app.connectWithRetry()
                    }
                }
                // Returning to the foreground after the desktop was unreachable
                // (locked the phone, desktop blipped/restarted) should recover on
                // its own — retry unless we're already connected or mid-check.
                // A state that *says* connected can be stale after a suspension,
                // so it gets one cheap validation probe instead of blind trust.
                .onChange(of: scenePhase) { _, phase in
                    // Leaving the foreground: flush any debounced thread
                    // persistence synchronously so an in-flight write isn't
                    // lost if the app is suspended or terminated.
                    if phase != .active { app.flushThreads() }
                    guard phase == .active, app.connection != nil else { return }
                    if app.connectionState != .connected,
                       app.connectionState != .checking {
                        Task { await app.connectWithRetry() }
                    } else if app.connectionState == .connected {
                        Task { await app.validateConnectionOnForeground() }
                    }
                }
                // Deep links from the home-screen widget (covencave://…) route to
                // the matching tab/sheet. Handled even before connect — the tab is
                // set so the right surface shows once the desktop is reached.
                .onOpenURL { app.handleDeepLink($0) }
        }
    }
}

/// Promote the horizontal size class to `.regular` in any window wide enough
/// for two real columns (cave-bgmg). Non-Max iPhones report `.compact` in
/// landscape, collapsing every NavigationSplitView into one sparse full-width
/// column; ≥700pt of width is the same bar Apple's Max phones clear. Narrow
/// windows keep the inherited class untouched.
private struct WideSplitEnabler<Content: View>: View {
    @Environment(\.horizontalSizeClass) private var inherited
    @ViewBuilder var content: Content

    var body: some View {
        GeometryReader { geo in
            content.environment(
                \.horizontalSizeClass,
                geo.size.width >= 700 ? .regular : inherited
            )
        }
    }
}
