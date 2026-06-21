import SwiftUI

/// Autocomplete surface that floats above the composer while the user is typing
/// a `/command`. Mirrors the web composer popover: name · description · arg hint,
/// with desktop-only commands tagged so nothing is a surprise on tap.
struct SlashCommandMenu: View {
    /// Commands matching the current partial token.
    let commands: [SlashCommand]
    /// Invoked when a row is tapped.
    let onSelect: (SlashCommand) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(commands) { command in
                        Button { onSelect(command) } label: { row(command) }
                            .buttonStyle(.plain)
                        if command.id != commands.last?.id {
                            Divider().padding(.leading, 16)
                        }
                    }
                }
            }
            .frame(maxHeight: 248)

            footer
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color(.separator).opacity(0.6), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.14), radius: 16, y: 6)
    }

    private func row(_ command: SlashCommand) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(command.name)
                        .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                        .foregroundStyle(.primary)
                    if let arg = command.argPlaceholder {
                        Text(arg)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                    if command.availability == .desktopOnly {
                        Text("Desktop")
                            .font(.system(size: 9, weight: .semibold))
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Color.secondary.opacity(0.18), in: Capsule())
                            .foregroundStyle(.secondary)
                    }
                }
                Text(command.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Image(systemName: "command")
                .font(.system(size: 9))
            Text("Tap to run · type to filter")
                .font(.system(size: 10))
        }
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 7)
        .background(Color(.secondarySystemBackground).opacity(0.5))
        .overlay(Divider(), alignment: .top)
    }
}
