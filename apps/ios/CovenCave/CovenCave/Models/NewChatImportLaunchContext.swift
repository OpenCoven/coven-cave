import Foundation

struct NewChatImportLaunchContext: Equatable, Sendable {
    enum ValidationResult: Equatable, Sendable {
        case valid
        case unassigned
        case projectChanged
        case familiarAccessRevoked([String])
    }

    let projectId: String
    let projectRoot: String
    let familiarIds: [String]

    init?(
        activeProject: ProjectInfo?,
        selectedFamiliarIds: [String]
    ) {
        guard let activeProject else { return nil }
        let projectId = Self.normalized(activeProject.id)
        let projectRoot = Self.normalized(activeProject.root)
        let familiarIds = ChatProjectSelection.familiarKey(selectedFamiliarIds)
        guard !projectId.isEmpty,
              !projectRoot.isEmpty,
              !familiarIds.isEmpty else { return nil }
        self.projectId = projectId
        self.projectRoot = projectRoot
        self.familiarIds = familiarIds
    }

    func validate(
        projectContext: ProjectContext?,
        activeProject: ProjectInfo?,
        projectMembership: ProjectMembershipIndex
    ) -> ValidationResult {
        if projectContext == .unassigned {
            return .unassigned
        }

        guard let activeProject else { return .projectChanged }
        let activeProjectId = Self.normalized(activeProject.id)
        let activeProjectRoot = Self.normalized(activeProject.root)
        guard activeProjectId == projectId,
              activeProjectRoot == projectRoot else {
            return .projectChanged
        }

        let revokedFamiliarIds = familiarIds.filter {
            !projectMembership.contains($0, inProjectID: activeProjectId)
        }
        return revokedFamiliarIds.isEmpty
            ? .valid
            : .familiarAccessRevoked(revokedFamiliarIds)
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
