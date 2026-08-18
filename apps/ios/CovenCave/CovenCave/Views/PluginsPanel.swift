import SwiftUI

private func isDesktopManaged(_ plugin: MarketplacePlugin) -> Bool {
    plugin.kind == "craft" || plugin.kind == "knowledge-pack"
}

enum MarketplacePluginCatalogLoadOutcome: Equatable {
    case applied
    case superseded
    case failed
}

enum MarketplacePluginMutationDisposition: Equatable {
    case confirmed
    case mutationFailed
    case refreshFailed
    case unconfirmed
}

enum MarketplacePluginMutationReconciliation {
    static func isConfirmed(
        _ outcome: MarketplacePluginCatalogLoadOutcome,
        installed: Bool?,
        expectedInstalled: Bool
    ) -> Bool {
        outcome == .applied && installed == expectedInstalled
    }

    static func disposition(
        mutationFailed: Bool,
        catalogOutcome: MarketplacePluginCatalogLoadOutcome,
        installed: Bool?,
        expectedInstalled: Bool
    ) -> MarketplacePluginMutationDisposition {
        if isConfirmed(
            catalogOutcome,
            installed: installed,
            expectedInstalled: expectedInstalled
        ) {
            return .confirmed
        }
        if catalogOutcome == .failed { return .refreshFailed }
        if mutationFailed { return .mutationFailed }
        return .unconfirmed
    }
}

/// The desktop's real marketplace catalog. Install state and setup readiness
/// come from `/api/marketplace`; iOS never invents connectors or stores secret
/// configuration locally.
struct PluginsPanel: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.chrome) private var chrome
    @State private var query = ""
    @State private var plugins: [MarketplacePlugin] = []
    @State private var selected: MarketplacePlugin?
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var mutating: Set<String> = []
    /// Monotonic request token: a slower, older refresh must never overwrite a
    /// newer catalog snapshot after concurrent pull-to-refresh/install work.
    @State private var loadGeneration = 0
    let tryInChat: (MarketplacePlugin) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if loading && plugins.isEmpty {
                    ProgressView("Loading plugins…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, plugins.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn’t load plugins", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("Retry") { Task { await loadPlugins() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if filtered.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    catalog
                }
            }
            .background(chrome.bgBase)
            .navigationTitle("Plugins")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search plugins…")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel("Close plugins")
                }
            }
            .navigationDestination(item: $selected) { plugin in
                MarketplacePluginDetailView(
                    plugin: currentPlugin(plugin.id) ?? plugin,
                    busy: mutating.contains(plugin.id),
                    toggleInstall: { Task { await toggle(plugin.id) } },
                    tryInChat: { selectedPlugin in
                        dismiss()
                        tryInChat(selectedPlugin)
                    })
            }
        }
        .themedSheetBackground()
        .task { await loadPlugins() }
        .refreshable { await loadPlugins() }
    }

    private var catalog: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                let installed = filtered.filter(\.installed)
                if query.isEmpty && !installed.isEmpty {
                    sectionLabel("Installed")
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 14) {
                            ForEach(installed) { plugin in
                                Button { selected = plugin } label: {
                                    VStack(spacing: 7) {
                                        pluginTile(plugin, size: 52)
                                        Text(plugin.displayName)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                    .frame(width: 70)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                sectionLabel(query.isEmpty ? "Available" : "Results")
                ForEach(filtered) { plugin in
                    HStack(spacing: 13) {
                        Button { selected = plugin } label: {
                            HStack(spacing: 13) {
                                pluginTile(plugin, size: 46)
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        Text(plugin.displayName)
                                            .font(.headline)
                                            .foregroundStyle(.primary)
                                        if plugin.updateAvailable {
                                            Text("Update")
                                                .font(.caption2.weight(.semibold))
                                                .foregroundStyle(chrome.accent)
                                        }
                                    }
                                    Text(plugin.description.isEmpty ? plugin.category : plugin.description)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                    if plugin.requiresSetup && !plugin.configured {
                                        Label("Setup required on desktop", systemImage: "key")
                                            .font(.caption)
                                            .foregroundStyle(.orange)
                                    }
                                }
                                Spacer(minLength: 8)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens plugin details")

                        installButton(plugin)
                    }
                }
            }
            .padding(16)
        }
    }

    @ViewBuilder
    private func installButton(_ plugin: MarketplacePlugin) -> some View {
        let desktopManaged = isDesktopManaged(plugin)
        Button {
            Task { await toggle(plugin.id) }
        } label: {
            if mutating.contains(plugin.id) {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 36, height: 36)
            } else {
                Image(systemName: desktopManaged
                      ? "desktopcomputer"
                      : (plugin.installed ? "checkmark" : "plus"))
                    .frame(width: 36, height: 36)
                    .background(
                        plugin.installed && !desktopManaged ? chrome.accent : chrome.bgRaised,
                        in: Circle()
                    )
                    .foregroundStyle(
                        plugin.installed && !desktopManaged
                            ? chrome.accentForeground
                            : chrome.textPrimary
                    )
            }
        }
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        .buttonStyle(.plain)
        .disabled(mutating.contains(plugin.id) || !plugin.available || desktopManaged)
        .accessibilityLabel(
            desktopManaged
                ? "Manage \(plugin.displayName) on desktop"
                : (plugin.installed
                   ? "Remove \(plugin.displayName)"
                   : "Add \(plugin.displayName)")
        )
    }

    private var filtered: [MarketplacePlugin] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return plugins }
        return plugins.filter {
            $0.displayName.localizedCaseInsensitiveContains(q)
                || $0.description.localizedCaseInsensitiveContains(q)
                || $0.category.localizedCaseInsensitiveContains(q)
                || $0.capabilities.contains(where: { $0.localizedCaseInsensitiveContains(q) })
        }
    }

    private func currentPlugin(_ id: String) -> MarketplacePlugin? {
        plugins.first { $0.id == id }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption2.weight(.semibold))
            .kerning(1)
            .foregroundStyle(.secondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func pluginTile(_ plugin: MarketplacePlugin, size: CGFloat) -> some View {
        MarketplacePluginLogo(plugin: plugin, size: size)
    }

    @discardableResult
    private func loadPlugins() async -> MarketplacePluginCatalogLoadOutcome {
        loadGeneration += 1
        let generation = loadGeneration
        guard let client = app.client else {
            loading = false
            errorMessage = "Connect to your desktop to browse plugins."
            return .failed
        }
        loading = true
        defer {
            if generation == loadGeneration { loading = false }
        }
        do {
            let refreshed = try await client.marketplacePlugins()
            guard generation == loadGeneration else { return .superseded }
            plugins = refreshed
            errorMessage = nil
            if let selected {
                self.selected = currentPlugin(selected.id)
            }
            return .applied
        } catch {
            guard generation == loadGeneration else { return .superseded }
            errorMessage = error.localizedDescription
            return .failed
        }
    }

    private func toggle(_ id: String) async {
        guard let client = app.client,
              let plugin = plugins.first(where: { $0.id == id }),
              !mutating.contains(id),
              !isDesktopManaged(plugin) else { return }
        let wasInstalled = plugin.installed
        mutating.insert(id)
        defer { mutating.remove(id) }
        var mutationFailure: Error?
        do {
            if wasInstalled {
                try await client.uninstallMarketplacePlugin(id: id)
            } else {
                try await client.installMarketplacePlugin(id: id)
            }
        } catch {
            mutationFailure = error
        }

        // A dropped response is ambiguous: the desktop may have committed the
        // write. Re-read authoritative catalog state after both success and
        // failure, and never infer success from the transport result alone.
        let catalogOutcome = await loadPlugins()
        let disposition = MarketplacePluginMutationReconciliation.disposition(
            mutationFailed: mutationFailure != nil,
            catalogOutcome: catalogOutcome,
            installed: currentPlugin(id)?.installed,
            expectedInstalled: !wasInstalled
        )
        switch disposition {
        case .confirmed:
            app.showToast(
                wasInstalled ? "Plugin removed" : "Plugin added",
                systemImage: wasInstalled ? "minus.circle" : "checkmark.circle.fill",
                style: .info)
        case .mutationFailed:
            app.showToast(mutationFailure?.localizedDescription ?? "Plugin change failed",
                          systemImage: "exclamationmark.triangle.fill",
                          style: .error)
        case .refreshFailed:
            app.showToast(
                "Couldn’t confirm the plugin status",
                systemImage: "arrow.clockwise",
                style: .warning)
        case .unconfirmed:
            app.showToast(
                "Plugin status didn’t match the requested change",
                systemImage: "exclamationmark.triangle.fill",
                style: .warning)
        }
    }
}

private struct MarketplacePluginDetailView: View {
    @Environment(\.chrome) private var chrome
    let plugin: MarketplacePlugin
    let busy: Bool
    let toggleInstall: () -> Void
    let tryInChat: (MarketplacePlugin) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top, spacing: 14) {
                    MarketplacePluginLogo(plugin: plugin, size: 62)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(plugin.displayName).font(.largeTitle.bold())
                        Text(plugin.category).foregroundStyle(.secondary)
                    }
                }

                Text(plugin.description.isEmpty
                     ? "No description was published for this plugin."
                     : plugin.description)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if isDesktopManaged(plugin) {
                    detailSection("Installation") {
                        Label(
                            desktopManagementCopy,
                            systemImage: "desktopcomputer"
                        )
                        .foregroundStyle(.secondary)
                    }
                }

                detailSection("Capabilities") {
                    if plugin.capabilities.isEmpty {
                        Text("No capabilities declared")
                            .foregroundStyle(.secondary)
                    } else {
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 104), spacing: 8)],
                            alignment: .leading,
                            spacing: 8
                        ) {
                            ForEach(plugin.capabilities, id: \.self) { capability in
                                Text(capability)
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(chrome.bgRaised, in: Capsule())
                            }
                        }
                    }
                }

                detailSection("Information") {
                    LabeledContent("Developer", value: plugin.author)
                    Divider()
                    LabeledContent("Version", value: plugin.version)
                    Divider()
                    LabeledContent("Kind", value: plugin.kind.capitalized)
                    if plugin.requiresSetup {
                        Divider()
                        LabeledContent("Configuration",
                                       value: plugin.configured ? "Ready" : "Desktop setup required")
                    }
                }

                if !plugin.requiredConfig.isEmpty {
                    detailSection("Required configuration") {
                        ForEach(plugin.requiredConfig) { field in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(field.title).font(.subheadline.weight(.medium))
                                Text(field.sensitive ? "Secure value managed by your desktop" : field.env)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            if field.id != plugin.requiredConfig.last?.id { Divider() }
                        }
                    }
                }
            }
            .padding(20)
        }
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 10) {
                Button(action: toggleInstall) {
                    if busy {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text(installActionLabel)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.bordered)
                .disabled(busy || !plugin.available || isDesktopManaged(plugin))

                Button(action: { tryInChat(plugin) }) {
                    Label("Try in chat", systemImage: "bubble.left.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canTryInChat)
                .accessibilityHint(
                    canTryInChat
                        ? "Prefills the composer with this plugin"
                        : "Install and configure this plugin on your desktop first"
                )
            }
            .frame(minHeight: 48)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .glassChrome(.bottom)
        }
        .background(chrome.bgBase)
        .navigationTitle(plugin.displayName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var installActionLabel: String {
        if isDesktopManaged(plugin) { return "Desktop only" }
        if !plugin.available { return "Unavailable" }
        return plugin.installed ? "Remove" : "Add"
    }

    private var canTryInChat: Bool {
        !busy
            && plugin.available
            && plugin.installed
            && (!plugin.requiresSetup || plugin.configured)
    }

    private var desktopManagementCopy: String {
        if plugin.kind == "knowledge-pack" {
            return "Manage this Knowledge pack from Cave on your desktop."
        }
        return "Manage this Craft from Cave on your desktop."
    }

    private func detailSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.bold())
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass(.raised, cornerRadius: 16)
    }
}

private struct MarketplacePluginLogo: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let plugin: MarketplacePlugin
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.24)
                .fill(chrome.bgRaised)
            if let source = app.client?.marketplaceLogoSource(for: plugin) {
                CachedImageView(
                    source: source,
                    targetSize: CGSize(width: size, height: size)
                ) { image in
                    Image(uiImage: image)
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .foregroundStyle(chrome.textPrimary)
                        .padding(size * 0.23)
                } placeholder: {
                    fallback
                }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var fallback: some View {
        Text(plugin.logo?.monogram ?? monogram(plugin.displayName))
            .font(.system(size: size * 0.28, weight: .bold, design: .rounded))
            .foregroundStyle(chrome.textSecondary)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    private func monogram(_ value: String) -> String {
        let words = value.split { !$0.isLetter && !$0.isNumber }
        guard let first = words.first else { return "?" }
        if words.count == 1 {
            return String(first.prefix(2)).uppercased()
        }
        return "\(first.prefix(1))\(words.last?.prefix(1) ?? "")".uppercased()
    }
}
