import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @AppStorage(AppearanceMode.storageKey) private var appearanceRaw = AppearanceMode.desktop.rawValue
    @State private var editingHost: String = ""
    @State private var showDisconnectConfirm = false
    @State private var exportArchive: ExportArchive?
    @State private var exportFailed = false
    @State private var themeError = false
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

    var body: some View {
        NavigationStack {
            Form {
                connectionCard
                themeSection
                appearanceSection
                chatsSection
                hostSection
                disconnectSection
                aboutSection
            }
            .themedListBackground()
            .readableListWidth(680)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                editingHost = app.connection?.host ?? ""
                pushMode = (app.publishedMode ?? (chrome.colorScheme == .light ? "light" : "dark")) == "light" ? .light : .dark
            }
            .onChange(of: app.publishedMode) { _, mode in
                // Keep the preview/push mode in step when the desktop flips mode
                // from elsewhere, so the swatches and selection stay truthful.
                guard let mode else { return }
                pushMode = mode == "light" ? .light : .dark
            }
            .confirmationDialog("Disconnect from your desktop?",
                                isPresented: $showDisconnectConfirm,
                                titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) { app.disconnect() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You'll need to re-enter your desktop address to reconnect.")
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
        }
    }

    // MARK: - Connection hero

    /// A glanceable header card: a themed glyph, the desktop host, and a live
    /// status pill — so the most important state (am I connected?) reads at once
    /// instead of buried in a labelled row.
    private var connectionCard: some View {
        Section {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(chrome.accent.opacity(0.18))
                    Image(systemName: "desktopcomputer")
                        .font(.title2)
                        .foregroundStyle(chrome.accent)
                }
                .frame(width: 52, height: 52)

                VStack(alignment: .leading, spacing: 3) {
                    Text("Your desktop")
                        .font(.headline)
                    Text(app.connection?.host ?? "Not set up")
                        .font(.footnote.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    statusBadge.padding(.top, 2)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .listRowBackground(chrome.bgRaised.opacity(0.6))
        } footer: {
            Text("Connected over your Tailscale network — no token or password to manage.")
        }
    }

    // MARK: - Theme (overrides the desktop)

    /// The headline feature: pick any of the desktop's named themes from the
    /// phone. Selecting one publishes it to the desktop (`PUT /api/theme`), which
    /// adopts it and re-publishes the resolved palette — so both the Mac and this
    /// phone re-theme together within a couple of seconds.
    private var themeSection: some View {
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
        } header: {
            Text("Theme")
        } footer: {
            Text("Sets the palette for your Cave desktop **and** this phone. Your desktop must be open; it updates within a few seconds.")
        }
    }

    private func push(themeId: String, mode: String) {
        Task {
            let ok = await app.setDesktopTheme(themeId: themeId, mode: mode)
            if ok { Haptics.success() } else { Haptics.error(); themeError = true }
        }
    }

    // MARK: - Appearance (this phone only)

    private var appearanceSection: some View {
        Section {
            Picker(selection: $appearanceRaw) {
                ForEach(AppearanceMode.allCases) { mode in
                    Label(mode.label, systemImage: mode.icon).tag(mode.rawValue)
                }
            } label: {
                Label("Light / Dark", systemImage: "circle.lefthalf.filled")
            }
        } header: {
            Text("On this phone")
        } footer: {
            Text("“Match desktop” follows your Cave desktop's light/dark mode. Light or Dark fixes it on this phone only — handy when you're outdoors and the desktop is dark.")
        }
    }

    // MARK: - Chats

    private var chatsSection: some View {
        Section {
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
            Text("Save every conversation as Markdown files in a single .zip.")
        }
    }

    // MARK: - Change host

    private var hostSection: some View {
        Section {
            LabeledContent("Status") { statusBadge }
            Button("Re-check connection") {
                Task { await app.refreshConnection() }
            }
            TextField("my-mac.tailnet.ts.net", text: $editingHost)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .font(.callout.monospaced())
            Button("Save and reconnect") {
                Task { await app.configure(host: editingHost) }
            }
            .disabled(editingHost.trimmingCharacters(in: .whitespaces).isEmpty
                      || editingHost == app.connection?.host)
        } header: {
            Text("Connection")
        } footer: {
            Text("Change this if your desktop's Tailscale name changes.")
        }
    }

    private var disconnectSection: some View {
        Section {
            Button("Disconnect", role: .destructive) {
                showDisconnectConfirm = true
            }
        }
    }

    private var aboutSection: some View {
        Section("About") {
            LabeledContent("Version") {
                Text(appVersion)
                    .font(.callout.monospaced())
                    .foregroundStyle(.secondary)
            }
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
