import SwiftUI

@main
struct CovenCaveApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                // Match the desktop appearance: propagate its palette to every
                // view, tint app-wide controls with its accent, and follow its
                // light/dark mode (defaults to dark until a theme loads).
                .environment(\.chrome, app.chrome)
                .tint(app.chrome.accent)
                .preferredColorScheme(app.chrome.colorScheme)
                .task {
                    if app.connection != nil {
                        await app.refreshConnection()
                    }
                }
        }
    }
}
