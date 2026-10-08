import SwiftUI

/// One row in the composer's argument picker (`/model …`, `/familiar …`).
/// `value` is what the command receives as its argument when the row is picked.
struct ComposerArgumentRow: Identifiable, Hashable {
    let id: String
    let title: String
    var subtitle: String?
    /// The argument handed to `dispatch(command, args:)` on pick.
    let value: String
    /// Shown as an avatar when the row stands for a familiar.
    var familiar: Familiar?

    static func == (lhs: ComposerArgumentRow, rhs: ComposerArgumentRow) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// Second-level autocomplete floating above the composer while the user types
/// a command argument. Same glass chrome as `SlashCommandMenu` / `MentionMenu`;
/// the footer names the command so the surface is self-describing.
struct ComposerArgumentMenu: View {
    @Environment(\.chrome) private var chrome
    let command: SlashCommand
    let rows: [ComposerArgumentRow]
    var avatarSource: (Familiar) -> CaveImageSource? = { _ in nil }
    let onSelect: (ComposerArgumentRow) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(rows) { row in
                        Button { onSelect(row) } label: { rowView(row) }
                            .buttonStyle(.plain)
                            .accessibilityLabel(accessibilityLabel(row))
                        if row.id != rows.last?.id {
                            Divider().padding(.leading, row.familiar == nil ? 16 : 52)
                        }
                    }
                }
            }
            .frame(maxHeight: 248)

            footer
        }
        .glassFill(.elevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color(.separator).opacity(0.6), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.14), radius: 16, y: 6)
    }

    private func rowView(_ row: ComposerArgumentRow) -> some View {
        HStack(spacing: 10) {
            if let familiar = row.familiar {
                AvatarView(familiar: familiar, source: avatarSource(familiar), size: 32)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(row.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                if let subtitle = row.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
        }
        .padding(.horizontal, row.familiar == nil ? 16 : 12)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private func accessibilityLabel(_ row: ComposerArgumentRow) -> String {
        [row.title, row.subtitle].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Text(command.name)
                .font(.system(.caption2, design: .monospaced).weight(.semibold))
                .foregroundStyle(chrome.accent)
            Text(command.argCompletion == .prompt ? "· tap to insert · type to filter" : "· tap to run · type to filter")
                .font(.caption2)
        }
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 7)
        .background(Color(.secondarySystemBackground).opacity(0.5))
        .overlay(Divider(), alignment: .top)
    }
}
