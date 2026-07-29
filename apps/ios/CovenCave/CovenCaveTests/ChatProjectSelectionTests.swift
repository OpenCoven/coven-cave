import XCTest
@testable import CovenCave

final class ChatProjectSelectionTests: XCTestCase {
    private func project(
        _ id: String,
        _ name: String,
        _ access: ProjectAccessLevel,
        updatedAt: String? = nil
    ) -> ProjectInfo {
        ProjectInfo(
            id: id,
            name: name,
            root: "/repos/\(id)",
            color: nil,
            updatedAt: updatedAt,
            access: access
        )
    }

    func testSharedProjectsIntersectByIdAndKeepLeastAccess() {
        let result = ChatProjectSelection.sharedProjects([
            [
                project("shared", "Zulu", .write),
                project("nova", "Nova", .write),
            ],
            [
                project("shared", "Zulu", .read),
                project("sage", "Sage", .write),
            ],
        ])

        XCTAssertEqual(result.map(\.id), ["shared"])
        XCTAssertEqual(result.first?.access, .read)
    }

    func testProjectInfoDecodesScopedAccessLevel() throws {
        let data = Data(
            """
            {
              "id": "cave",
              "name": "Coven Cave",
              "root": "/repos/cave",
              "access": "read"
            }
            """.utf8
        )

        let decoded = try JSONDecoder().decode(ProjectInfo.self, from: data)

        XCTAssertEqual(decoded.access, .read)
    }

    func testSharedProjectsUseStableNameThenIdOrdering() {
        let first = [
            project("zulu", "Zulu", .write),
            project("alpha-b", "Alpha", .write),
            project("alpha-a", "alpha", .write),
        ]
        let second = Array(first.reversed())

        XCTAssertEqual(
            ChatProjectSelection.sharedProjects([first, second]).map(\.id),
            ["alpha-a", "alpha-b", "zulu"]
        )
    }

    func testSharedProjectsRequireEveryParticipantScope() {
        XCTAssertTrue(
            ChatProjectSelection.sharedProjects([
                [project("cave", "Cave", .write)],
                [],
            ]).isEmpty
        )
        XCTAssertTrue(ChatProjectSelection.sharedProjects([]).isEmpty)
    }

    func testResolvedRootKeepsCurrentSelection() {
        let projects = [
            project("z", "Zulu", .write),
            project("a", "Alpha", .write),
        ]

        XCTAssertEqual(
            ChatProjectSelection.resolvedRoot(
                current: "/repos/z",
                recent: ["/repos/a"],
                projects: projects
            ),
            "/repos/z"
        )
    }

    func testResolvedRootUsesFirstAccessibleRecentRoot() {
        let projects = [
            project("z", "Zulu", .write),
            project("a", "Alpha", .write),
        ]

        XCTAssertEqual(
            ChatProjectSelection.resolvedRoot(
                current: "/missing",
                recent: ["/missing-too", "/repos/z", "/repos/a"],
                projects: projects
            ),
            "/repos/z"
        )
    }

    func testResolvedRootFallsBackToAlphabeticalFirstProject() {
        let projects = [
            project("z", "Zulu", .write),
            project("a", "Alpha", .write),
        ]

        XCTAssertEqual(
            ChatProjectSelection.resolvedRoot(
                current: nil,
                recent: [],
                projects: projects
            ),
            "/repos/a"
        )
        XCTAssertNil(
            ChatProjectSelection.resolvedRoot(
                current: "/missing",
                recent: ["/missing-too"],
                projects: []
            )
        )
    }

    func testExplicitImportParticipantsCannotExpandProjectSendScope() {
        XCTAssertEqual(
            ChatProjectSelection.importedFamiliarIDs(
                preferred: ["nova", "nova", ""],
                discovered: ["sage", "nova"]
            ),
            ["nova"]
        )
    }

    func testLegacyImportParticipantsUseStableDiscoveryOrder() {
        XCTAssertEqual(
            ChatProjectSelection.importedFamiliarIDs(
                preferred: [],
                discovered: ["sage", "nova", "sage", ""]
            ),
            ["sage", "nova"]
        )
    }
}
