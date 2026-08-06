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
<<<<<<< Updated upstream
    // Declaration order IS the memberwise initializer's argument order, so it
    // has to match how the call sites read: the required `refreshToken` ahead
    // of the defaulted flag and callbacks.
    let refreshToken: Int
    var requiresExplicitSelection = false
    var onResolved: (() -> Void)?
=======
    // Declaration order IS the memberwise-init argument order, so it has to
    // match how the call sites read: refreshToken, then the optional knobs,
    // with onResolved last. Both callers pass refreshToken before onResolved,
    // and Swift rejects the reverse.
    let refreshToken: Int
    var requiresExplicitSelection = false
>>>>>>> Stashed changes
    var onManageAccess: (() -> Void)?
    var onResolved: (() -> Void)?

    @State private var projects: [ProjectInfo] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var resolvedLoadKey: LoadKey?
    @State private var reloadToken = 0
    @State private var loadGeneration = 0

    private struct LoadKey: Hashable {
        let familiarIds: [String]
        let refreshToken: Int
        let reloadToken: Int
        let requiresExplicitSelection: Bool
    }

    private struct LoadIdentity: Hashable {
        let key: LoadKey
        let generation: Int
    }

    private var familiarKey: [String] {
        ChatProjectSelection.familiarKey(familiarIds)
    }

    private var loadKey: LoadKey {
        LoadKey(
            familiarIds: familiarKey,
            refreshToken: refreshToken,
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
            } else if resolvedLoadKey != loadKey {
                ProgressView("Finding shared projects…")
            } else if let errorMessage {
                VStack(alignment: .leading, spacing: 8) {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                    Button("Retry") { reloadToken += 1 }
                }
            } else if projects.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label(
                        familiarKey.count == 1
                            ? "This familiar has no accessible projects."
                            : "These familiars do not share an accessible project.",
                        systemImage: "folder.badge.questionmark"
                    )
                    .foregroundStyle(.secondary)
                    if let onManageAccess {
                        Button("Project access", action: onManageAccess)
                    }
                }
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
        loadGeneration &+= 1
        let identity = LoadIdentity(key: loadKey, generation: loadGeneration)

        resolvedLoadKey = nil
        projects = []
        errorMessage = nil
        isResolved = false

        guard !familiarKey.isEmpty else {
            isLoading = false
            return
        }

        isLoading = true
        defer {
            if loadGeneration == identity.generation {
                isLoading = false
            }
        }

        guard app.client != nil else {
            guard loadGeneration == identity.generation else { return }
            isLoading = false
            errorMessage = "Connect to your Cave to load projects."
            resolvedLoadKey = identity.key
            return
        }

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
            guard loadGeneration == identity.generation, loadKey == identity.key else {
                return
            }
            isLoading = false
            projects = loaded
            selectedRoot = requiresExplicitSelection
                ? nil
                : ChatProjectSelection.resolvedRoot(
                    current: selectedRoot,
                    recent: recentRoots,
                    projects: loaded
                )
            isResolved = selectedRoot != nil
            resolvedLoadKey = identity.key
            if isResolved { onResolved?() }
        } catch is CancellationError {
            return
        } catch {
            guard loadGeneration == identity.generation, loadKey == identity.key else {
                return
            }
            isLoading = false
            projects = []
            isResolved = false
            errorMessage = error.localizedDescription
            resolvedLoadKey = identity.key
        }
    }
}
