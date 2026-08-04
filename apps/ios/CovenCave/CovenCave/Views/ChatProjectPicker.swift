import SwiftUI

/// Resolves the launch project shared by every familiar in a new chat. The
/// server remains authoritative; this picker prevents avoidable first-turn
/// failures and repairs legacy or stale local threads.
struct ChatProjectPicker: View {
    @Environment(AppModel.self) private var app

    let familiarIds: [String]
    let recentRoots: [String]
    @Binding var selectedRoot: String?
    @Binding var isResolved: Bool
    var requiresExplicitSelection = false
    var onResolved: (() -> Void)?

    @State private var projects: [ProjectInfo] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var reloadToken = 0

    private struct LoadKey: Hashable {
        var familiarIds: [String]
        var reloadToken: Int
        var requiresExplicitSelection: Bool
    }

    private var familiarKey: [String] {
        ChatProjectSelection.familiarKey(familiarIds)
    }

    private var loadKey: LoadKey {
        LoadKey(
            familiarIds: familiarKey,
            reloadToken: reloadToken,
            requiresExplicitSelection: requiresExplicitSelection
        )
    }

    var body: some View {
        Group {
            if familiarKey.isEmpty {
                Label(
                    "Choose a familiar before selecting a project.",
                    systemImage: "person.crop.circle.badge.questionmark"
                )
                .foregroundStyle(.secondary)
            } else if isLoading {
                ProgressView("Finding shared projects…")
            } else if let errorMessage {
                VStack(alignment: .leading, spacing: 8) {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                    Button("Retry") { reloadToken += 1 }
                }
            } else if projects.isEmpty {
                Label(
                    familiarKey.count == 1
                        ? "This familiar has no accessible projects."
                        : "These familiars do not share an accessible project.",
                    systemImage: "folder.badge.questionmark"
                )
                .foregroundStyle(.secondary)
            } else {
                projectPicker
            }
        }
        .font(.body)
        .task(id: loadKey) {
            await loadProjects()
        }
    }

    private var projectPicker: some View {
        Picker(
            "Project",
            selection: Binding(
                get: { selectedRoot },
                set: { root in
                    selectedRoot = root
                    isResolved = root != nil
                    if root != nil { onResolved?() }
                }
            )
        ) {
            Text("Choose a project").tag(String?.none)
            ForEach(projects) { project in
                Text(projectOptionLabel(project))
                    .tag(Optional(project.root))
                    .accessibilityLabel(projectAccessibilityLabel(project))
            }
        }
        .pickerStyle(.menu)
        .accessibilityHint("Chooses where this chat can work")
    }

    private func projectOptionLabel(_ project: ProjectInfo) -> String {
        guard let access = project.access else { return project.name }
        return "\(project.name) · \(projectAccessLabel(access))"
    }

    private func projectAccessibilityLabel(_ project: ProjectInfo) -> String {
        guard let access = project.access else { return project.name }
        return "\(project.name), \(projectAccessLabel(access).lowercased()) access"
    }

    private func projectAccessLabel(_ access: ProjectAccessLevel) -> String {
        access == .read ? "Read" : "Full"
    }

    @MainActor
    private func loadProjects() async {
        guard !familiarKey.isEmpty else {
            projects = []
            selectedRoot = nil
            isResolved = false
            errorMessage = nil
            isLoading = false
            return
        }

        guard app.client != nil else {
            projects = []
            isResolved = false
            errorMessage = "Connect to your Cave to load projects."
            isLoading = false
            return
        }

        isLoading = true
        isResolved = false
        errorMessage = nil
        do {
            let loaded = try await ChatProjectSelection.loadProjectsWithRecovery(
                load: {
                    guard let currentClient = app.client else {
                        throw CaveError.notConfigured
                    }
                    return try await currentClient.projects(familiarIds: familiarKey)
                },
                recover: { _ in
                    await app.recoverConnectionInBackground()
                    return app.connectionState == .connected
                }
            )
            try Task.checkCancellation()
            projects = loaded
            selectedRoot = requiresExplicitSelection
                ? nil
                : ChatProjectSelection.resolvedRoot(
                    current: selectedRoot,
                    recent: recentRoots,
                    projects: loaded
                )
            isResolved = selectedRoot != nil
            if isResolved { onResolved?() }
        } catch is CancellationError {
            return
        } catch {
            projects = []
            isResolved = false
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
