import SwiftUI

@main
struct CovenCaveApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                // Appearance: mirror the desktop's palette/mode by default, or
                // honor this device's local override (Light/Dark/System) — the
                // effective* accessors resolve which applies.
                .environment(\.chrome, app.effectivePalette)
                .tint(app.effectivePalette.accent)
                .preferredColorScheme(app.effectiveColorScheme)
                .task {
                    if app.connection != nil {
                        await app.refreshConnection()
                    }
                }
        }
    }
}
