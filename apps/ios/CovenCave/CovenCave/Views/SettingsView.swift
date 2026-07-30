import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(AppLock.self) private var appLock
    @Environment(\.chrome) private var chrome
    @AppStorage(AppearanceMode.storageKey) private var appearanceRaw = AppearanceMode.desktop.rawValue
    @AppStorage(ChatNotifications.enabledKey) private var chatNotificationsEnabled = true
    @State private var exportArchive: ExportArchive?
    @State private var exportFailed = false
    @State private var themeError = false
    @State private var securityAuthFailed = false
    /// Light/Dark used both to preview the theme swatches and as the mode pushed
    /// to the desktop. Seeded from the desktop's published mode on appear.
    @State private var pushMode: ColorScheme = .dark

    /// Marketing version + build, e.g. "1.2.0 (34)", read from the bundle.
    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "\(version) (\(build))"
    }

    /// Top level mirrors the design handoff's settings IA: profile hero, then
    /// Appearance / Wards / Chats / Community / Legal groups and a centered
    /// mono brand footer. Connection plumbing (address, re-check, disconnect)
    /// lives one level down behind the hero.
    var body: some View {
        NavigationStack {
            Form {
                heroSection
                appearanceSection
                wardsSection
                securitySection
                chatsSection
                communitySection
                legalSection
            }
            .themedListBackground()
            .readableListWidth(680)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { app.navigationDrawerOpen = true } label: {
                        Image(systemName: "line.3.horizontal")
                    }
                    .accessibilityLabel("Open navigation")
                }
            }
            .onAppear {
                pushMode = (app.publishedMode ?? (chrome.colorScheme == .light ? "light" : "dark")) == "light" ? .light : .dark
            }
            .onChange(of: app.publishedMode) { _, mode in
                // Keep the preview/push mode in step when the desktop flips mode
                // from elsewhere, so the swatches and selection stay truthful.
                guard let mode else { return }
                pushMode = mode == "light" ? .light : .dark
            }
            .sheet(item: $exportArchive) { archive in
                ActivityView(items: [archive.url])
            }
            .alert("Couldn't export chats", isPresented: $exportFailed) {
                Button("OK", role: .cancel) {}
            }
            .alert("Couldn't change the theme", isPresented: $themeError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Your desktop didn't confirm the change. Check the connection and try again.")
            }
            .alert("Couldn't confirm it's you", isPresented: $securityAuthFailed) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Authentication failed or was cancelled, so this setting wasn't changed.")
            }
        }
    }

    // MARK: - Profile hero (per the design: sigil avatar, name, mono host + status dot)

    /// The most important state — who am I and am I connected? — reads at once:
    /// a gradient sigil avatar, the cave's name, and the desktop host in mono
    /// behind a live status dot. Tapping through opens the Connection page
    /// (address, re-check, disconnect), keeping the top level uncluttered.
    private var heroSection: some View {
        Section {
            NavigationLink {
                ConnectionSettingsView()
            } label: {
                HStack(spacing: 14) {
                    Circle()
                        .fill(chrome.accentGradient)
                        .frame(width: 54, height: 54)
                        .overlay {
                            Image(systemName: "moon.stars.fill")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundStyle(chrome.accentForeground)
                        }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(app.operatorDisplayName)
                            .font(.headline)
                        HStack(spacing: 6) {
                            Circle().fill(statusTint).frame(width: 7, height: 7)
                            Text(statusLine)
                                .font(.footnote.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 6)
            }
            .listRowBackground(chrome.bgRaised.opacity(0.6))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(app.operatorDisplayName), \(statusAccessibilityLabel)")
            .accessibilityHint("Opens connection settings.")
        }
    }

    private var statusTint: Color {
        switch app.connectionState {
        case .connected: return .green
        case .unreachable, .needsAuth: return .orange
        case .checking, .unconfigured: return .secondary
        }
    }

    private var statusLine: String {
        switch app.connectionState {
        case .connected: return app.connection?.host ?? "Connected"
        case .checking: return "Checking…"
        case .unreachable: return "Unreachable"
        case .needsAuth: return "Needs pairing"
        case .unconfigured: return "Not set up"
        }
    }

    private var statusAccessibilityLabel: String {
        switch app.connectionState {
        case .connected: return "connected to \(app.connection?.host ?? "your desktop")"
        case .checking: return "checking connection"
        case .unreachable: return "desktop unreachable"
        case .needsAuth: return "needs pairing"
        case .unconfigured: return "not set up"
        }
    }

    // MARK: - Appearance (theme pushed to the desktop + this phone's override)

    /// The headline feature: pick any of the desktop's named themes from the
    /// phone. Selecting one publishes it to the desktop (`PUT /api/theme`), which
    /// adopts it and re-publishes the resolved palette — so both the Mac and this
    /// phone re-theme together within a couple of seconds. The trailing row
    /// overrides light/dark on this phone alone.
    private var appearanceSection: some View {
        Section {
            Picker("Mode", selection: $pushMode) {
                Label("Light", systemImage: "sun.max.fill").tag(ColorScheme.light)
                Label("Dark", systemImage: "moon.fill").tag(ColorScheme.dark)
            }
            .pickerStyle(.segmented)
            .listRowBackground(chrome.bgRaised.opacity(0.4))
            .onChange(of: pushMode) { _, scheme in
                let mode = scheme == .light ? "light" : "dark"
                // Only push when this is a genuine flip away from the desktop's
                // current mode (not the initial sync from `publishedMode`), and
                // only if a theme is already active to carry into the new mode.
                guard mode != app.publishedMode, let id = app.publishedThemeId else { return }
                Haptics.tap()
                push(themeId: id, mode: mode)
            }

            ThemeGrid(
                mode: pushMode,
                selectedId: app.publishedThemeId,
                isBusy: app.publishingTheme
            ) { id in
                let mode = pushMode == .light ? "light" : "dark"
                guard id != app.publishedThemeId || mode != app.publishedMode else { return }
                Haptics.tap()
                push(themeId: id, mode: mode)
            }
            .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
            .listRowBackground(Color.clear)

            Picker(selection: $appearanceRaw) {
                ForEach(AppearanceMode.allCases) { mode in
                    Label(mode.label, systemImage: mode.icon).tag(mode.rawValue)
                }
            } label: {
                Label("On this phone", systemImage: "iphone")
            }
        } header: {
            Text("Appearance")
        } footer: {
            Text("Theme re-paints your Cave desktop **and** this phone within a few seconds. “Match desktop” follows its light/dark mode; Light or Dark fixes this phone only.")
        }
    }

    private func push(themeId: String, mode: String) {
        Task {
            let ok = await app.setDesktopTheme(themeId: themeId, mode: mode)
            if ok { Haptics.success() } else { Haptics.error(); themeError = true }
        }
    }

    // MARK: - Wards (familiar project access)

    private var wardsSection: some View {
        Section {
            NavigationLink {
                PermissionsView()
            } label: {
                Label("Familiar permissions", systemImage: "key.fill")
                    .foregroundStyle(.primary)
            }
        } header: {
            Text("Wards")
        } footer: {
            Text("Per-familiar project access. Changes from the phone require the desktop opt-in.")
        }
    }

    // MARK: - Security (biometric app lock + approvals)

    /// Two persisted toggles gated behind `AppLock`: unlocking the app itself
    /// and approving credential-affecting actions (desktop host changes,
    /// disconnect). Both bind straight to `appLock`'s published state rather
    /// than a locally mirrored `@State`, so a toggle only visibly moves once
    /// the authentication it requires actually succeeds — a failed/cancelled
    /// prompt just leaves the row where it was.
    private var securitySection: some View {
        Section {
            Toggle(isOn: Binding(
                get: { appLock.lockEnabled },
                set: { newValue in
                    Task {
                        if await !appLock.setLockEnabled(newValue) { securityAuthFailed = true }
                    }
                }
            )) {
                Label("Require \(appLock.biometricLabel) to unlock", systemImage: appLock.biometricSystemImage)
                    .foregroundStyle(.primary)
            }
            .disabled(!appLock.canUseDeviceAuthentication)

            Toggle(isOn: Binding(
                get: { appLock.approvalEnabled },
                set: { newValue in
                    Task {
                        if await !appLock.setApprovalEnabled(newValue) { securityAuthFailed = true }
                    }
                }
            )) {
                Label("Require \(appLock.biometricLabel) for approvals", systemImage: "checkmark.shield")
                    .foregroundStyle(.primary)
            }
            .disabled(!appLock.canUseDeviceAuthentication)
        } header: {
            Text("Security")
        } footer: {
            if appLock.canUseDeviceAuthentication {
                Text("Unlock guards the app itself on cold start and after being away 60 seconds or more. Approvals re-confirm it's you before changing or disconnecting your paired desktop. Your device passcode always works as a fallback.")
            } else {
                Text("Turn on a passcode (Settings → Face ID & Passcode, or Touch ID & Passcode) to enable app lock and approvals.")
            }
        }
    }

    // MARK: - Chats

    private var chatsSection: some View {
        Section {
            Toggle(isOn: $chatNotificationsEnabled) {
                Label("Reply notifications", systemImage: "bell.badge")
                    .foregroundStyle(.primary)
            }
            .onChange(of: chatNotificationsEnabled) { _, enabled in
                guard enabled else { return }
                Task { await ChatNotifications.requestAuthorizationIfNeeded() }
            }
            Button {
                do {
                    exportArchive = ExportArchive(url: try app.exportAllThreadsZip())
                } catch {
                    exportFailed = true
                }
            } label: {
                Label("Export all chats", systemImage: "square.and.arrow.up.on.square")
                    .foregroundStyle(.primary)
            }
            .disabled(app.threads.isEmpty)
        } header: {
            Text("Chats")
        } footer: {
            Text("Get notified when a familiar finishes replying while you're away. Export saves every chat as Markdown in a .zip.")
        }
    }

    // MARK: - Community & Legal

    private var communitySection: some View {
        Section("Community") {
            linkRow("Discord", value: "OpenCoven", url: "https://discord.gg/opencoven")
            linkRow("X", value: "@OpenCvn", url: "https://x.com/OpenCvn")
            linkRow("Docs", value: "docs.opencoven.ai", url: "https://docs.opencoven.ai")
            linkRow("Podcast", value: "pod.opencoven.ai", url: "https://pod.opencoven.ai")
            linkRow("Blog", value: "mind.opencoven.ai", url: "https://mind.opencoven.ai")
        }
    }

    private var legalSection: some View {
        Section {
            linkRow("Terms of Service", value: "opencoven.ai/terms", url: "https://opencoven.ai/terms")
            linkRow("Privacy", value: "opencoven.ai/privacy", url: "https://opencoven.ai/privacy")
        } header: {
            Text("Legal")
        } footer: {
            // Design's mono brand footer, centered under the last group.
            Text("Coven Cave · \(appVersion)")
                .font(.caption.monospaced())
                .frame(maxWidth: .infinity)
                .padding(.top, 10)
        }
    }

    @ViewBuilder
    private func linkRow(_ label: String, value: String, url: String) -> some View {
        if let destination = URL(string: url) {
            Link(destination: destination) {
                LabeledContent(label) {
                    Label(value, systemImage: "arrow.up.right")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .foregroundStyle(.primary)
        }
    }
}

// MARK: - Connection detail (pushed from the hero)

/// Everything about the desktop link that used to sprawl across the settings
/// top level: live status, re-check, changing the Tailscale address, and the
/// destructive disconnect.
private struct ConnectionSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(AppLock.self) private var appLock
    @State private var editingHost: String = ""
    @State private var showDisconnectConfirm = false
    @State private var approvalFailed = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Status") { statusBadge }
                Button("Re-check connection") {
                    Task { await app.refreshConnection() }
                }
            } footer: {
                Text("Connected over your Tailscale network with a paired Cave access token.")
            }

            Section {
                TextField("my-mac.tailnet.ts.net", text: $editingHost)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .font(.callout.monospaced())
                Button("Save and reconnect") {
                    Task {
                        let approved = await appLock.performApprovedAction(
                            reason: "Confirm it's you to change your desktop connection"
                        ) {
                            await app.configure(host: editingHost)
                        }
                        if !approved { approvalFailed = true }
                    }
                }
                .disabled(editingHost.trimmingCharacters(in: .whitespaces).isEmpty
                          || editingHost == app.connection?.host)
            } header: {
                Text("Desktop address")
            } footer: {
                Text("Change this if your desktop's Tailscale name changes.")
            }

            Section {
                Button("Disconnect", role: .destructive) {
                    showDisconnectConfirm = true
                }
            }
        }
        .themedListBackground()
        .readableListWidth(680)
        .navigationTitle("Connection")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { editingHost = app.connection?.host ?? "" }
        .confirmationDialog("Disconnect from your desktop?",
                            isPresented: $showDisconnectConfirm,
                            titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) {
                Task {
                    let approved = await appLock.performApprovedAction(
                        reason: "Confirm it's you to disconnect from your desktop"
                    ) {
                        app.disconnect()
                    }
                    if !approved { approvalFailed = true }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to re-enter your desktop address to reconnect.")
        }
        .alert("Couldn't confirm it's you", isPresented: $approvalFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Authentication failed or was cancelled, so nothing changed.")
        }
    }

    private var statusBadge: some View {
        Group {
            switch app.connectionState {
            case .connected:
                Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            case .checking:
                Label("Checking…", systemImage: "clock").foregroundStyle(.secondary)
            case .unreachable:
                Label("Unreachable", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            case .needsAuth:
                Label("Needs pairing", systemImage: "qrcode.viewfinder").foregroundStyle(.orange)
            case .unconfigured:
                Label("Not set up", systemImage: "circle").foregroundStyle(.secondary)
            }
        }
        .font(.subheadline)
    }
}

// MARK: - Theme picker grid

/// A responsive grid of theme swatch cards. Each card paints the theme's true
/// canvas colour with an accent sample, so the roster reads like a row of real
/// palettes rather than a list of names. The selected card is ringed in its own
/// accent and badged with a check.
private struct ThemeGrid: View {
    let mode: ColorScheme
    let selectedId: String?
    let isBusy: Bool
    let onSelect: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 12)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(ThemeRoster.all) { theme in
                ThemeSwatchCard(
                    theme: theme,
                    mode: mode,
                    isSelected: theme.id == selectedId
                ) { onSelect(theme.id) }
                .disabled(isBusy)
            }
        }
    }
}

private struct ThemeSwatchCard: View {
    let theme: ThemeOption
    let mode: ColorScheme
    let isSelected: Bool
    let action: () -> Void

    private var accent: Color { theme.accent(mode) }
    private var background: Color { theme.background(mode) }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .topTrailing) {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(background)
                        .frame(height: 62)
                        .overlay(alignment: .bottomLeading) {
                            HStack(spacing: 6) {
                                Circle().fill(accent).frame(width: 16, height: 16)
                                Text("Aa")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(accent)
                            }
                            .padding(10)
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(isSelected ? accent : Color.primary.opacity(0.12),
                                              lineWidth: isSelected ? 2.5 : 1)
                        }

                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.body)
                            .foregroundStyle(accent)
                            .background(Circle().fill(background).padding(1))
                            .padding(6)
                            .transition(.scale.combined(with: .opacity))
                    }
                }

                Text(theme.name)
                    .font(.caption.weight(isSelected ? .semibold : .regular))
                    .foregroundStyle(isSelected ? .primary : .secondary)
                    .lineLimit(1)
                    .padding(.top, 6)
            }
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.18), value: isSelected)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(theme.name)
        .accessibilityHint(theme.blurb)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}
