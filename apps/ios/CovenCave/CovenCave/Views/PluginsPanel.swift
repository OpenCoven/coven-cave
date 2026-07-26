import SwiftUI

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
    let tryInChat: () -> Void

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
                    tryInChat: {
                        dismiss()
                        tryInChat()
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
                            installButton(plugin)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
    }

    @ViewBuilder
    private func installButton(_ plugin: MarketplacePlugin) -> some View {
        Button {
            Task { await toggle(plugin.id) }
        } label: {
            if mutating.contains(plugin.id) {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 36, height: 36)
            } else {
                Image(systemName: plugin.installed ? "checkmark" : "plus")
                    .frame(width: 36, height: 36)
                    .background(plugin.installed ? chrome.accent : chrome.bgRaised, in: Circle())
                    .foregroundStyle(plugin.installed ? chrome.accentForeground : chrome.textPrimary)
            }
        }
        .buttonStyle(.plain)
        .disabled(mutating.contains(plugin.id) || !plugin.available || plugin.kind == "craft")
        .accessibilityLabel(plugin.installed
                            ? "Remove \(plugin.displayName)"
                            : "Add \(plugin.displayName)")
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
        Image(systemName: symbol(for: plugin))
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(gradient(for: plugin), in: RoundedRectangle(cornerRadius: size * 0.24))
    }

    private func symbol(for plugin: MarketplacePlugin) -> String {
        switch plugin.kind {
        case "mcp": return "server.rack"
        case "prompt": return "text.quote"
        case "craft": return "sparkles.rectangle.stack"
        case "knowledge-pack": return "books.vertical.fill"
        case "api": return "network"
        default: return "puzzlepiece.extension.fill"
        }
    }

    private func gradient(for plugin: MarketplacePlugin) -> LinearGradient {
        let palettes: [[Color]] = [
            [.indigo, .purple], [.blue, .cyan], [.orange, .pink],
            [.green, .teal], [.gray, .indigo],
        ]
        let scalar = plugin.id.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        let colors = palettes[scalar % palettes.count]
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private func loadPlugins() async {
        guard let client = app.client else {
            loading = false
            errorMessage = "Connect to your desktop to browse plugins."
            return
        }
        loading = true
        defer { loading = false }
        do {
            plugins = try await client.marketplacePlugins()
            errorMessage = nil
            if let selected {
                self.selected = currentPlugin(selected.id)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func toggle(_ id: String) async {
        guard let client = app.client,
              let index = plugins.firstIndex(where: { $0.id == id }),
              !mutating.contains(id) else { return }
        let wasInstalled = plugins[index].installed
        mutating.insert(id)
        defer { mutating.remove(id) }
        do {
            if wasInstalled {
                try await client.uninstallMarketplacePlugin(id: id)
            } else {
                try await client.installMarketplacePlugin(id: id)
            }
            await loadPlugins()
            app.showToast(
                wasInstalled ? "Plugin removed" : "Plugin added",
                systemImage: wasInstalled ? "minus.circle" : "checkmark.circle.fill",
                style: .info)
        } catch {
            app.showToast(error.localizedDescription,
                          systemImage: "exclamationmark.triangle.fill",
                          style: .error)
        }
    }
}

private struct MarketplacePluginDetailView: View {
    @Environment(\.chrome) private var chrome
    let plugin: MarketplacePlugin
    let busy: Bool
    let toggleInstall: () -> Void
    let tryInChat: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: "puzzlepiece.extension.fill")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(chrome.accent)
                        .frame(width: 62, height: 62)
                        .glass(.raised, cornerRadius: 15)
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

                if plugin.kind == "craft" {
                    detailSection("Installation") {
                        Label(
                            "Manage this Craft from Cave on your desktop.",
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
                .disabled(busy || !plugin.available || plugin.kind == "craft")

                Button(action: tryInChat) {
                    Label("Try in chat", systemImage: "bubble.left.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
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
        if plugin.kind == "craft" { return "Desktop only" }
        if !plugin.available { return "Unavailable" }
        return plugin.installed ? "Remove" : "Add"
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
