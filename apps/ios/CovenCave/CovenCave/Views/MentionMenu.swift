import SwiftUI

/// Autocomplete surface floating above the composer while the user types an
/// `@mention` in a group chat. Mirrors `SlashCommandMenu`; lists the group's
/// familiars (avatar + name + role).
struct MentionMenu: View {
    let familiars: [Familiar]
    var avatarURL: (Familiar) -> URL? = { _ in nil }
    let onSelect: (Familiar) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(familiars) { familiar in
                        Button { onSelect(familiar) } label: { row(familiar) }
                            .buttonStyle(.plain)
                        if familiar.id != familiars.last?.id {
                            Divider().padding(.leading, 52)
                        }
                    }
                }
            }
            .frame(maxHeight: 248)
        }
        .glassFill(.elevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color(.separator).opacity(0.6), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.14), radius: 16, y: 6)
    }

    private func row(_ familiar: Familiar) -> some View {
        HStack(spacing: 10) {
            AvatarView(familiar: familiar, url: avatarURL(familiar), size: 32)
            VStack(alignment: .leading, spacing: 1) {
                Text("@\(familiar.displayName)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                if let role = familiar.role, !role.isEmpty {
                    Text(role).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}
