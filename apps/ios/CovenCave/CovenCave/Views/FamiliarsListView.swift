import SwiftUI

/// The all-familiars roster (design: "Familiars" drawer destination): every
/// summoned familiar with its avatar, role, and live presence. Tapping one
/// dismisses the sheet and routes to that familiar's threads.
struct FamiliarsListView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.dismiss) private var dismiss

    /// Host-supplied: route to the familiar's surface after dismissal.
    var openFamiliar: (Familiar) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if app.familiars.isEmpty {
                    ContentUnavailableView {
                        Label("No familiars", systemImage: "cat")
                    } description: {
                        Text("Familiars summoned on the desktop appear here.")
                    }
                } else {
                    List(app.familiars) { familiar in
                        FamiliarRosterRow(familiar: familiar) {
                            dismiss()
                            openFamiliar(familiar)
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(chrome.border.opacity(0.6))
                    }
                    .listStyle(.plain)
                }
            }
            .themedListBackground()
            .navigationTitle("Familiars")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .themedSheetBackground()
    }
}

/// One roster row: 46pt avatar with presence dot, name + role, and a trailing
/// presence label matching the design's active/idle treatment.
private struct FamiliarRosterRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let familiar: Familiar
    var action: () -> Void

    private var isActive: Bool { Presence.isActive(familiar.status) }

    private var presenceLabel: String {
        guard let status = familiar.status?.lowercased(), !status.isEmpty else { return "idle" }
        switch status {
        case "active", "online": return "active"
        case "busy", "running": return "busy"
        default: return status
        }
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 13) {
                AvatarView(familiar: familiar,
                           url: app.client?.avatarURL(for: familiar),
                           size: 46, showStatus: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(familiar.displayName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(chrome.textPrimary)
                        .lineLimit(1)
                    if let role = familiar.role, !role.isEmpty {
                        Text(role)
                            .font(.system(size: 13.5))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text(presenceLabel)
                    .font(.caption)
                    .foregroundStyle(isActive ? AnyShapeStyle(Color.green) : AnyShapeStyle(.secondary))
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(familiar.displayName), \(presenceLabel)")
        .accessibilityHint(Text("Opens this familiar's chats."))
    }
}
