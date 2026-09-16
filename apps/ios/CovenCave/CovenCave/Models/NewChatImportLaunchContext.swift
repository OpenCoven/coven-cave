import Foundation

struct NewChatImportLaunchContext: Equatable, Sendable {
    enum ValidationResult: Equatable, Sendable {
        case valid
        case accessUnavailable
        case projectChanged
        case familiarAccessRevoked([String])
    }

    let projectId: String
    let projectRoot: String
    let familiarIds: [String]

    init?(
        selectedProject: ProjectInfo?,
        selectedFamiliarIds: [String]
    ) {
        guard let selectedProject else { return nil }
        let projectId = Self.normalized(selectedProject.id)
        let projectRoot = Self.normalized(selectedProject.root)
        let familiarIds = ChatProjectSelection.familiarKey(selectedFamiliarIds)
        guard !projectId.isEmpty,
              !projectRoot.isEmpty,
              projectId == selectedProject.id,
              projectRoot == selectedProject.root,
              ProjectContext.openContext(for: projectRoot, in: []) != nil,
              !familiarIds.isEmpty else { return nil }
        self.projectId = projectId
        self.projectRoot = projectRoot
        self.familiarIds = familiarIds
    }

    func validate(
        registeredProjects: [ProjectInfo],
        accessibleProjects: [ProjectInfo],
        projectMembership: ProjectMembershipIndex,
        membershipLoaded: Bool
    ) -> ValidationResult {
        guard membershipLoaded else { return .accessUnavailable }
        guard registeredProjects.contains(where: {
            $0.id == projectId && $0.root == projectRoot
        }) else {
            return .projectChanged
        }

        let revokedFamiliarIds = familiarIds.filter {
            !projectMembership.contains($0, inProjectID: projectId)
        }
        guard revokedFamiliarIds.isEmpty else {
            return .familiarAccessRevoked(revokedFamiliarIds)
        }
        guard accessibleProjects.contains(where: {
            $0.id == projectId && $0.root == projectRoot
        }) else { return .accessUnavailable }
        return .valid
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
