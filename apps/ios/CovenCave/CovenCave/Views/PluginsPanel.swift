import SwiftUI

/// Local catalog until the Cave API publishes connector/skill discovery.
/// Installed toggles are intentionally session-local; they do not imply that a
/// desktop connector was installed or authorized.
struct PluginsPanel: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.chrome) private var chrome
    @State private var query = ""
    @State private var selected: PluginCatalogItem?
    @State private var added: Set<String> = []
    let tryInChat: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if query.isEmpty {
                        sectionLabel("Installed")
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 14) {
                                ForEach(Self.installed) { plugin in
                                    VStack(spacing: 6) {
                                        pluginTile(plugin, size: 50)
                                        Text(plugin.name).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    sectionLabel(query.isEmpty ? "Featured" : "Results")
                    ForEach(filtered) { plugin in
                        Button { selected = plugin } label: {
                            HStack(spacing: 13) {
                                pluginTile(plugin, size: 46)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(plugin.name).font(.headline).foregroundStyle(.primary)
                                    Text(plugin.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                                Button {
                                    if added.contains(plugin.id) { added.remove(plugin.id) }
                                    else { added.insert(plugin.id) }
                                } label: {
                                    Image(systemName: added.contains(plugin.id) ? "checkmark" : "plus")
                                        .frame(width: 34, height: 34)
                                        .background(added.contains(plugin.id) ? chrome.accent : chrome.bgRaised,
                                                    in: Circle())
                                        .foregroundStyle(added.contains(plugin.id) ? chrome.accentForeground : chrome.textPrimary)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(added.contains(plugin.id) ? "Remove \(plugin.name)" : "Add \(plugin.name)")
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(chrome.bgBase)
            .navigationTitle("Plugins")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search plugins…")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "chevron.left") }
                }
            }
            .navigationDestination(item: $selected) { plugin in
                PluginDetailView(plugin: plugin) {
                    dismiss()
                    tryInChat()
                }
            }
        }
        .themedSheetBackground()
    }

    private var filtered: [PluginCatalogItem] {
        guard !query.isEmpty else { return Self.featured }
        return Self.featured.filter {
            $0.name.localizedCaseInsensitiveContains(query)
                || $0.summary.localizedCaseInsensitiveContains(query)
        }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption2.weight(.semibold)).kerning(1)
            .foregroundStyle(.secondary)
    }

    private func pluginTile(_ plugin: PluginCatalogItem, size: CGFloat) -> some View {
        Image(systemName: plugin.symbol)
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(plugin.gradient, in: RoundedRectangle(cornerRadius: size * 0.24))
    }

    // TODO: Replace this catalog with CaveClient connector/skill discovery once
    // the desktop API exposes a stable endpoint for mobile.
    static let installed = [
        PluginCatalogItem("GitHub", "Triage pull requests and issues", "chevron.left.forwardslash.chevron.right", [.gray, .black]),
        PluginCatalogItem("Gmail", "Search and work with mail", "envelope.fill", [.red, .orange]),
        PluginCatalogItem("Calendar", "Plan around your calendar", "calendar", [.blue, .indigo]),
        PluginCatalogItem("Linear", "Track issues and projects", "point.topleft.down.curvedto.point.bottomright.up", [.indigo, .purple]),
    ]
    static let featured = installed + [
        PluginCatalogItem("Data Analytics", "Answer product and business questions", "chart.bar.fill", [.cyan, .blue]),
        PluginCatalogItem("Google Drive", "Work across Drive, Docs, Sheets, and Slides", "externaldrive.fill", [.green, .yellow]),
        PluginCatalogItem("Notion", "Search and read workspace content", "doc.text.fill", [.gray, .black]),
        PluginCatalogItem("Figma", "Design-to-code workflows", "paintpalette.fill", [.orange, .purple]),
    ]
}

struct PluginCatalogItem: Identifiable, Hashable {
    let id: String
    let name: String
    let summary: String
    let symbol: String
    let colors: [Color]
    var gradient: LinearGradient { LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing) }

    init(_ name: String, _ summary: String, _ symbol: String, _ colors: [Color]) {
        id = name
        self.name = name
        self.summary = summary
        self.symbol = symbol
        self.colors = colors
    }
}

private struct PluginDetailView: View {
    @Environment(\.chrome) private var chrome
    let plugin: PluginCatalogItem
    let tryInChat: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: plugin.symbol)
                    .font(.system(size: 30, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(plugin.gradient, in: RoundedRectangle(cornerRadius: 15))
                Text(plugin.name).font(.largeTitle.bold())
                Text(plugin.summary).foregroundStyle(.secondary)
                RoundedRectangle(cornerRadius: 18)
                    .fill(plugin.gradient.opacity(0.42))
                    .frame(height: 155)
                    .overlay {
                        Text("@\(plugin.name) \(plugin.summary)")
                            .padding(16)
                            .background(chrome.bgElevated, in: RoundedRectangle(cornerRadius: 14))
                            .padding(22)
                    }
                detailSection("Apps") {
                    Label(plugin.name, systemImage: plugin.symbol)
                }
                detailSection("Skills") {
                    HStack {
                        skillChip("Overview")
                        skillChip("Quick start")
                    }
                }
                detailSection("Information") {
                    LabeledContent("Capabilities", value: "Interactive, Write")
                    Divider()
                    LabeledContent("Developer", value: "OpenCoven")
                    Divider()
                    LabeledContent("Version", value: "0.1.8")
                }
            }
            .padding(20)
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: tryInChat) {
                Label("Try in chat", systemImage: "bubble.left.fill")
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .padding(16)
            .background(chrome.bgBase)
        }
        .background(chrome.bgBase)
        .navigationTitle(plugin.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func detailSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.bold())
            content()
        }
    }

    private func skillChip(_ text: String) -> some View {
        Label(text, systemImage: "cube.fill")
            .font(.subheadline)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(chrome.bgRaised, in: Capsule())
            .overlay(Capsule().stroke(chrome.border))
    }
}
