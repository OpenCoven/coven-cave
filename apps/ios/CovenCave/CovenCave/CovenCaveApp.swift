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
            RootView()
                .environment(app)
                // Propagate the chrome palette to every view, tint app-wide
                // controls with its accent, and apply the resolved light/dark mode.
                .environment(\.chrome, resolved.chrome)
                .tint(resolved.chrome.accent)
                .preferredColorScheme(resolved.scheme)
                .task {
                    // Route notification taps to the reminders list, and show
                    // reminder banners while the app is foregrounded.
                    notificationDelegate.onOpen = { app.handleDeepLink($0) }
                    UNUserNotificationCenter.current().delegate = notificationDelegate
                    if app.connection != nil {
                        await app.connectWithRetry()
                    }
                }
                // Returning to the foreground after the desktop was unreachable
                // (locked the phone, desktop blipped/restarted) should recover on
                // its own — retry unless we're already connected or mid-check.
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active, app.connection != nil,
                          app.connectionState != .connected,
                          app.connectionState != .checking else { return }
                    Task { await app.connectWithRetry() }
                }
                // Deep links from the home-screen widget (covencave://…) route to
                // the matching tab/sheet. Handled even before connect — the tab is
                // set so the right surface shows once the desktop is reached.
                .onOpenURL { app.handleDeepLink($0) }
        }
    }
}
