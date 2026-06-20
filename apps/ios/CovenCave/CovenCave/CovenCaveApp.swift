import SwiftUI

@main
struct CovenCaveApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .preferredColorScheme(.dark)
                .task {
                    if app.connection != nil {
                        await app.refreshConnection()
                    }
                }
        }
    }
}
