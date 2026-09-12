import XCTest
@testable import CovenCave

final class NewChatImportLaunchContextTests: XCTestCase {
    private func project(_ id: String, root: String? = nil) -> ProjectInfo {
        ProjectInfo(id: id, name: id, root: root ?? "/repos/\(id)", color: nil, updatedAt: nil, access: .write)
    }

    private func context() throws -> NewChatImportLaunchContext {
        try XCTUnwrap(NewChatImportLaunchContext(
            selectedProject: project("alpha"),
            selectedFamiliarIds: ["sage", "nova", "sage", ""]
        ))
    }

    func testCaptureRequiresLocalProjectAndNonEmptyRoster() {
        XCTAssertNil(NewChatImportLaunchContext(selectedProject: nil, selectedFamiliarIds: ["nova"]))
        XCTAssertNil(NewChatImportLaunchContext(selectedProject: project("alpha"), selectedFamiliarIds: []))
        XCTAssertNil(NewChatImportLaunchContext(
            selectedProject: project("alpha", root: "/repos/../alpha"),
            selectedFamiliarIds: ["nova"]
        ))
    }

    func testCaptureKeepsStablePreferredRoster() throws {
        let captured = try context()
        XCTAssertEqual(captured.projectId, "alpha")
        XCTAssertEqual(captured.projectRoot, "/repos/alpha")
        XCTAssertEqual(captured.familiarIds, ["nova", "sage"])
    }

    func testLocalSelectionSurvivesAmbientProjectChangesAndGrantReordering() throws {
        let captured = try context()
        let membership = ProjectMembershipIndex(familiarIDsByProjectID: ["alpha": ["nova", "sage"]])
        for catalog in [[project("beta"), project("alpha")], [project("alpha"), project("beta")]] {
            XCTAssertEqual(captured.validate(
                registeredProjects: catalog,
                accessibleProjects: catalog,
                projectMembership: membership,
                membershipLoaded: true
            ), .valid)
            XCTAssertEqual(captured.projectId, "alpha")
        }
    }

    func testValidationRejectsProjectRootChangesForSameProjectID() throws {
        XCTAssertEqual(try context().validate(
            registeredProjects: [project("alpha", root: "/repos/renamed")],
            accessibleProjects: [project("alpha", root: "/repos/renamed")],
            projectMembership: ProjectMembershipIndex(familiarIDsByProjectID: ["alpha": ["nova", "sage"]]),
            membershipLoaded: true
        ), .projectChanged)
    }

    func testValidationRejectsRemovedProjectWithoutSelectingAnother() throws {
        XCTAssertEqual(try context().validate(
            registeredProjects: [project("beta")],
            accessibleProjects: [project("beta")],
            projectMembership: ProjectMembershipIndex(familiarIDsByProjectID: ["beta": ["nova", "sage"]]),
            membershipLoaded: true
        ), .projectChanged)
    }

    func testValidationRejectsAccessRevocationWhilePickerIsOpen() throws {
        XCTAssertEqual(try context().validate(
            registeredProjects: [project("alpha")],
            accessibleProjects: [project("alpha")],
            projectMembership: ProjectMembershipIndex(familiarIDsByProjectID: ["alpha": ["nova"]]),
            membershipLoaded: true
        ), .familiarAccessRevoked(["sage"]))
    }

    func testValidationRejectsMissingOrStaleGrantsEvenWithCachedMembership() throws {
        let captured = try context()
        let membership = ProjectMembershipIndex(familiarIDsByProjectID: ["alpha": ["nova", "sage"]])
        XCTAssertEqual(captured.validate(
            registeredProjects: [project("alpha")],
            accessibleProjects: [],
            projectMembership: membership,
            membershipLoaded: true
        ), .accessUnavailable)
        XCTAssertEqual(captured.validate(
            registeredProjects: [project("alpha")],
            accessibleProjects: [project("alpha")],
            projectMembership: membership,
            membershipLoaded: false
        ), .accessUnavailable)
    }
}
