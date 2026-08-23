import XCTest
@testable import CovenCave

final class NewChatImportLaunchContextTests: XCTestCase {
    private func project(
        _ id: String,
        _ name: String,
        root: String? = nil
    ) -> ProjectInfo {
        ProjectInfo(
            id: id,
            name: name,
            root: root ?? "/repos/\(id)",
            color: nil,
            updatedAt: nil,
            access: nil
        )
    }

    private func membership(_ rows: [String: Set<String>]) -> ProjectMembershipIndex {
        ProjectMembershipIndex(familiarIDsByProjectID: rows)
    }

    func testCaptureRequiresActiveProjectAndNonEmptyRoster() {
        let alpha = project("alpha", "Alpha")

        XCTAssertNil(
            NewChatImportLaunchContext(
                activeProject: nil,
                selectedFamiliarIds: ["nova"]
            )
        )
        XCTAssertNil(
            NewChatImportLaunchContext(
                activeProject: alpha,
                selectedFamiliarIds: []
            )
        )
    }

    func testCaptureNormalizesStablePreferredRoster() throws {
        let alpha = project("alpha", "Alpha")
        let context = try XCTUnwrap(
            NewChatImportLaunchContext(
                activeProject: alpha,
                selectedFamiliarIds: ["sage", "nova", "sage", ""]
            )
        )

        XCTAssertEqual(context.projectId, "alpha")
        XCTAssertEqual(context.projectRoot, "/repos/alpha")
        XCTAssertEqual(context.familiarIds, ["nova", "sage"])
    }

    func testValidationSucceedsWhenProjectAndRosterStayActive() throws {
        let alpha = project("alpha", "Alpha")
        let context = try XCTUnwrap(
            NewChatImportLaunchContext(
                activeProject: alpha,
                selectedFamiliarIds: ["nova", "sage"]
            )
        )

        XCTAssertEqual(
            context.validate(
                projectContext: .project(alpha),
                activeProject: alpha,
                projectMembership: membership(["alpha": Set(["nova", "sage"])])
            ),
            .valid
        )
    }

    func testValidationRejectsProjectSwitchWhilePickerIsOpen() throws {
        let alpha = project("alpha", "Alpha")
        let beta = project("beta", "Beta")
        let context = try XCTUnwrap(
            NewChatImportLaunchContext(
                activeProject: alpha,
                selectedFamiliarIds: ["nova"]
            )
        )

        XCTAssertEqual(
            context.validate(
                projectContext: .project(beta),
                activeProject: beta,
                projectMembership: membership(["beta": Set(["nova"])])
            ),
            .projectChanged
        )
    }

    func testValidationRejectsProjectRootChangesForSameProjectID() throws {
        let alpha = project("alpha", "Alpha", root: "/repos/alpha")
        let movedAlpha = project("alpha", "Alpha", root: "/repos/alpha-renamed")
        let context = try XCTUnwrap(
            NewChatImportLaunchContext(
                activeProject: alpha,
                selectedFamiliarIds: ["nova"]
            )
        )

        XCTAssertEqual(
            context.validate(
                projectContext: .project(movedAlpha),
                activeProject: movedAlpha,
                projectMembership: membership(["alpha": Set(["nova"])])
            ),
            .projectChanged
        )
    }

    func testValidationRejectsUnassignedWhilePickerIsOpen() throws {
        let alpha = project("alpha", "Alpha")
        let context = try XCTUnwrap(
            NewChatImportLaunchContext(
                activeProject: alpha,
                selectedFamiliarIds: ["nova"]
            )
        )

        XCTAssertEqual(
            context.validate(
                projectContext: .unassigned,
                activeProject: nil,
                projectMembership: membership(["alpha": Set(["nova"])])
            ),
            .unassigned
        )
    }

    func testValidationRejectsAccessRevocationWhilePickerIsOpen() throws {
        let alpha = project("alpha", "Alpha")
        let context = try XCTUnwrap(
            NewChatImportLaunchContext(
                activeProject: alpha,
                selectedFamiliarIds: ["nova", "sage"]
            )
        )

        XCTAssertEqual(
            context.validate(
                projectContext: .project(alpha),
                activeProject: alpha,
                projectMembership: membership(["alpha": Set(["nova"])])
            ),
            .familiarAccessRevoked(["sage"])
        )
    }
}
