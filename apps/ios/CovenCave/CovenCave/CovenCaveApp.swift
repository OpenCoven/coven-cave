import SwiftUI

@main
struct CovenCaveApp: App {
    @State private var app = AppModel()
    @AppStorage(AppearanceMode.storageKey) private var appearanceRaw = AppearanceMode.desktop.rawValue

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
                    if app.connection != nil {
                        await app.refreshConnection()
                    }
                }
        }
    }
}
