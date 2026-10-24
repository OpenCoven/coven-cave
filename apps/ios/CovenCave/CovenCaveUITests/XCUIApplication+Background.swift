import XCTest

extension XCUIApplication {
    /// Send the app to the background, as pressing Home does on a phone.
    /// On the iPhone Duo simulator `XCUIDevice.shared.press(.home)` leaves the
    /// app running in the foreground, so a test that relies on backgrounding
    /// (privacy clearing, lifecycle) would pass vacuously or fail for the
    /// wrong reason. Bringing Safari to the front backgrounds it for real.
    @MainActor
    func sendToBackground() {
        XCUIDevice.shared.press(.home)
        if waitUntilBackgrounded(timeout: 2) { return }
        XCUIApplication(bundleIdentifier: "com.apple.mobilesafari").activate()
        _ = waitUntilBackgrounded(timeout: 5)
    }

    @MainActor
    private func waitUntilBackgrounded(timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if state == .runningBackground || state == .runningBackgroundSuspended { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        return false
    }
}
