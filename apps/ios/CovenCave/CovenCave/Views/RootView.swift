import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
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
                    // the primary shell mounted (cached data stays usable, offline
                    // compose keeps queueing) and narrate recovery with the pill
                    // instead of tearing down to the Connect screen.
                    MainShellView()
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
        // Brief "Connected" confirmation over the freshly mounted shell when a
        // connection lands — the connect screen's success is no longer an
        // abrupt teleport into the app. Purely decorative and self-dismissing.
        .overlay {
            ConnectedMomentOverlay()
        }
        // While the pill is up over the shell, quietly re-probe so a desktop
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
        // Frosted, accent-infused navigation bars that track the desktop
        // palette and degrade to solid themed surfaces under Reduce Transparency.
        .glassNavigationBars()
    }

    /// The primary shell is mounted but the desktop is out of reach (or a recovery
    /// probe is in flight) — show the honest "Reconnecting…" pill.
    private var showsReconnectPill: Bool {
        guard app.hasLoadedSurfaces else { return false }
        switch app.connectionState {
        case .unreachable, .checking: return true
        default: return false
        }
    }
}

/// Brief celebratory "Connected" chip that fades in over the primary shell the
/// moment a connection lands (fresh pairing or reconnect from the Connect
/// screen), then self-dismisses. Skips entirely when the connection predates
/// this view (normal warm launches) and collapses to a plain fade under
/// Reduce Motion.
private struct ConnectedMomentOverlay: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visible = false

    var body: some View {
        ZStack {
            if visible {
                Label("Connected", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundStyle(Color.green)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .glass(.elevated, in: Capsule())
                    .transition(
                        reduceMotion
                            ? .opacity.animation(.easeInOut(duration: 0.2))
                            : .scale(scale: 0.86).combined(with: .opacity)
                    )
                    .accessibilityAddTraits(.isStaticText)
            }
        }
        .allowsHitTesting(false)
        .task(id: app.connectedAt) {
            // Only celebrate a connection that landed just now — not one
            // restored long before this overlay appeared (warm launch).
            guard let connectedAt = app.connectedAt,
                  Date().timeIntervalSince(connectedAt) < 3
            else { return }
            withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.35)) {
                visible = true
            }
            try? await Task.sleep(for: .seconds(1.4))
            withAnimation(.easeOut(duration: 0.3)) {
                visible = false
            }
        }
    }
}

/// Floating "Reconnecting… · last seen Xm" capsule shown over the mounted
/// primary shell during a connection drop. Tapping it fires an immediate quiet probe
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

/// Connected application shell. It mounts exactly one primary destination and
/// overlays the global drawer for navigation and cross-surface handoffs.
struct MainShellView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var presentedOverlay: MainOverlay?
    @State private var projectToOpen: ProjectInfo?

    var body: some View {
        ZStack {
            selectedDestination

            CaveNavigationDrawer(
                isOpen: Binding(
                    get: { app.navigationDrawerOpen },
                    set: { app.navigationDrawerOpen = $0 }
                ),
                openProjects: { project in
                    projectToOpen = project
                    presentedOverlay = .projects
                },
                openFamiliars: { presentedOverlay = .familiars },
                openThread: { app.requestOpen($0) },
                newChat: {
                    app.selectedTab = .chats
                    app.newChatRequested = true
                },
                searchChats: {
                    app.selectedTab = .chats
                    app.chatSearchRequested = true
                }
            )
            .zIndex(100)
        }
        .fullScreenCover(item: $presentedOverlay) { overlay in
            switch overlay {
            case .projects:
                ProjectsPanel(initialProject: projectToOpen) {
                    presentedOverlay = nil
                    projectToOpen = nil
                }
            case .familiars: FamiliarsListView { familiar in
                presentedOverlay = nil
                app.requestOpen(app.directThread(for: familiar.id))
            }
            }
        }
        // Command confirmations float above the whole shell so they're visible
        // whether a command stays in chat or jumps to the Tasks destination.
        .toast(Binding(get: { app.toast }, set: { app.toast = $0 }))
        // Hardware-keyboard destination switching (iPad / Mac over Tailscale): ⌘1–4.
        // Hidden buttons keep the shortcuts active without affecting layout.
        .background {
            ForEach(Array(AppTab.shortcutOrder.enumerated()), id: \.element) { index, tab in
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

    @ViewBuilder
    private var selectedDestination: some View {
        switch app.selectedTab {
        case .chats:
            ChatsHomeView()
        case .tasks:
            TasksView()
        case .terminal:
            TerminalView()
        case .settings:
            SettingsView()
        }
    }
}

private enum MainOverlay: String, Identifiable {
    case projects
    case familiars
    var id: String { rawValue }
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
