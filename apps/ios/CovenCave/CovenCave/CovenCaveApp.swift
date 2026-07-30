import SwiftUI
import UserNotifications

@main
struct CovenCaveApp: App {
    @State private var app: AppModel
    @State private var notificationDelegate: CaveNotificationDelegate
    /// Owns the biometric app-unlock + approval state. Created alongside
    /// `AppModel` so its cold-start lock decision is settled before the first
    /// view mounts (see `LockScreenView`, substituted in for the whole root).
    @State private var appLock: AppLock
    @State private var pairingApprovalFailed = false
    @AppStorage(AppearanceMode.storageKey) private var appearanceRaw = AppearanceMode.desktop.rawValue
    @Environment(\.scenePhase) private var scenePhase

    @MainActor
    init() {
        let app = AppModel()
        let notificationDelegate = CaveNotificationDelegate()
        notificationDelegate.onOpen = { app.handleDeepLink($0) }
        // Register before SwiftUI mounts a view or starts a task. A cold-launch
        // notification response can otherwise arrive before any delegate exists.
        UNUserNotificationCenter.current().delegate = notificationDelegate
        _app = State(initialValue: app)
        _notificationDelegate = State(initialValue: notificationDelegate)
        _appLock = State(initialValue: AppLock())
    }

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
                // Full replacement, never a translucent overlay: while locked,
                // RootView (and everything under it) simply isn't mounted, so
                // a cold launch can never flash app content before auth. The
                // privacy shield is layered separately, above whichever of
                // these is mounted, so a quick `.inactive`/`.background` blip
                // shields snapshots without tearing down RootView's
                // navigation state the way a full lock replacement would.
                ZStack {
                    if appLock.isLocked {
                        LockScreenView(appLock: appLock)
                    } else {
                        RootView()
                    }
                    if appLock.isPrivacyShielded {
                        PrivacyShieldView()
                    }
                }
                .animation(nil, value: appLock.isPrivacyShielded)
            }
                .environment(app)
                .environment(appLock)
                // Propagate the chrome palette to every view, tint app-wide
                // controls with its accent, and apply the resolved light/dark mode.
                .environment(\.chrome, resolved.chrome)
                .tint(resolved.chrome.accent)
                .preferredColorScheme(resolved.scheme)
                .task {
                    #if DEBUG
                    guard !app.isConnectingPreview else { return }
                    #endif
                    app.startConnectionSupervisor()
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
                // `.inactive` immediately raises the privacy shield (see
                // `AppLock.sceneDidBecomeInactive`) so app-switcher/control-
                // center snapshots never expose content, but deliberately
                // does NOT count toward the 60s re-lock window or the
                // auto-prompt cycle — LocalAuthentication's own prompt (and
                // the app switcher/control center) can bounce the scene
                // through `.inactive` without a genuine background stint,
                // which must never force re-authentication on a quick return.
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .background: appLock.sceneDidEnterBackground()
                    case .active: appLock.sceneDidBecomeActive()
                    case .inactive: appLock.sceneDidBecomeInactive()
                    @unknown default: break
                    }
                }
                // Deep links from the home-screen widget (covencave://…) route to
                // the matching destination/sheet. Handled even before connect — the destination is
                // set so the right surface shows once the desktop is reached.
                .onOpenURL { app.handleDeepLink($0) }
                .task { await processPendingPairingIntent() }
                .onChange(of: app.pendingPairingIntent) {
                    Task { await processPendingPairingIntent() }
                }
                .onChange(of: appLock.isLocked) {
                    Task { await processPendingPairingIntent() }
                }
                .alert("Couldn't confirm it's you", isPresented: $pairingApprovalFailed) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text("Authentication failed or was cancelled, so your desktop pairing was not changed.")
                }
        }
    }

    @MainActor
    private func processPendingPairingIntent() async {
        guard let intent = app.takePendingPairingIntent(isLocked: appLock.isLocked) else { return }
        let requiresApproval = PairingApprovalPolicy.requiresApproval(
            hasExistingPairing: app.connection != nil
        )
        if !requiresApproval {
            await app.configure(host: intent.host, token: intent.token)
            return
        }

        let approved = await appLock.performApprovedAction(
            reason: "Confirm it's you to replace your desktop pairing"
        ) {
            await app.configure(host: intent.host, token: intent.token)
        }
        if !approved { pairingApprovalFailed = true }
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
