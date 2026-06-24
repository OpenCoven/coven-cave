import SwiftUI

/// The native iOS command reference. Grouped by section, searchable, and
/// tappable: picking a command drops it into the composer ready to run.
struct CommandsSheet: View {
    @Environment(\.dismiss) private var dismiss
    /// Called with the chosen command's canonical name (e.g. "/save ").
    let onPick: (SlashCommand) -> Void

    @State private var query = ""

    private var sections: [(SlashCommand.Section, [SlashCommand])] {
        SlashCommand.Section.allCases.compactMap { section in
            let items = filtered.filter { $0.section == section }
            return items.isEmpty ? nil : (section, items)
        }
    }

    private var filtered: [SlashCommand] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return SlashCatalog.available }
        return SlashCatalog.available.filter { command in
            command.tokens.contains { $0.lowercased().contains(q) }
                || command.description.lowercased().contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if filtered.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
                ForEach(sections, id: \.0) { section, commands in
                    Section(section.label) {
                        ForEach(commands) { command in
                            Button { onPick(command); dismiss() } label: { row(command) }
                                .buttonStyle(.plain)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .themedListBackground()
            .navigationTitle("Commands")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search commands")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .themedSheetBackground()
    }

    private func row(_ command: SlashCommand) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(command.name)
                        .font(.system(.body, design: .monospaced).weight(.semibold))
                        .foregroundStyle(.primary)
                    if let arg = command.argPlaceholder {
                        Text("<\(arg)>")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
                Text(command.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !command.aliases.isEmpty {
                    Text("also " + command.aliases.joined(separator: ", "))
                        .font(.caption2.monospaced())
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 6)
            Image(systemName: "arrow.up.left")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}
