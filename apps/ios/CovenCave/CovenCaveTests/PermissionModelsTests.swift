import XCTest
@testable import CovenCave

/// Pure-logic coverage for the permissions protocol port: wire decoding
/// (including the server's lenient access-level normalization), the union-max
/// effective-access resolver, and the proposal undo-window countdown.
final class PermissionModelsTests: XCTestCase {

    // MARK: - Decoding

    func testDecodesGrantsResponseFixture() throws {
        let json = """
        {
          "ok": true,
          "grants": [
            { "familiarId": "nova", "projectId": "cave", "access": "read",
              "source": "human", "grantedAt": "2026-07-01T10:00:00.000Z" },
            { "familiarId": "ember", "projectId": "docs", "access": "write",
              "source": "bootstrap", "grantedAt": "2026-07-01T11:00:00.000Z" }
          ],
          "accessGroups": [
            { "id": "g1", "name": "Builders", "memberFamiliarIds": ["nova"],
              "projectGrants": [ { "projectId": "docs", "access": "write", "grantedAt": "x" } ],
              "createdAt": "x", "updatedAt": "x" }
          ],
          "supremeFamiliarId": "supreme",
          "mobileMutationsAllowed": false,
          "audit": [
            { "id": "a1", "at": "2026-07-01T12:00:00.000Z", "familiarId": "nova",
              "projectId": "cave", "surface": "file-write", "decision": "deny",
              "reason": "requires-write", "requiredAccess": "write" }
          ]
        }
        """
        let decoded = try JSONDecoder().decode(
            ProjectGrantsResponse.self, from: Data(json.utf8))
        XCTAssertTrue(decoded.ok)
        XCTAssertEqual(decoded.grants?.count, 2)
        XCTAssertEqual(decoded.grants?[0].access, .read)
        XCTAssertEqual(decoded.grants?[1].source, "bootstrap")
        XCTAssertEqual(decoded.accessGroups?.first?.projectGrants.first?.access, .write)
        XCTAssertEqual(decoded.supremeFamiliarId, "supreme")
        XCTAssertEqual(decoded.mobileMutationsAllowed, false)
        XCTAssertEqual(decoded.audit?.first?.allowed, false)
        XCTAssertEqual(decoded.audit?.first?.requiredAccess, .write)
    }

    func testLegacyGrantWithoutAccessNormalizesToWrite() throws {
        // v1 grants predate levels and unlocked every surface → "write",
        // matching the server's normalizeAccessLevel.
        let json = """
        { "familiarId": "nova", "projectId": "cave", "source": "human", "grantedAt": "x" }
        """
        let grant = try JSONDecoder().decode(ProjectGrant.self, from: Data(json.utf8))
        XCTAssertEqual(grant.access, .write)
    }

    func testUnknownAccessLevelNormalizesToWrite() throws {
        let json = """
        { "familiarId": "nova", "projectId": "cave", "access": "admin",
          "source": "human", "grantedAt": "x" }
        """
        let grant = try JSONDecoder().decode(ProjectGrant.self, from: Data(json.utf8))
        XCTAssertEqual(grant.access, .write)
    }

    func testUnknownProposalStatusNeverRendersActionable() throws {
        // Future server states must not show Accept/Undo buttons.
        let json = """
        { "id": "p1", "proposedBy": "nova", "targetFamiliarId": "ember",
          "projectId": "cave", "status": "escalated", "createdAt": "x" }
        """
        let proposal = try JSONDecoder().decode(GrantProposal.self, from: Data(json.utf8))
        XCTAssertEqual(proposal.status, .rejected)
    }

    // MARK: - Effective access (union-max)

    private let groups = [
        FamiliarAccessGroup(
            id: "g1", name: "Builders", description: nil,
            memberFamiliarIds: ["nova"],
            projectGrants: [GroupProjectGrant(projectId: "cave", access: .write)]
        ),
        FamiliarAccessGroup(
            id: "g2", name: "Readers", description: nil,
            memberFamiliarIds: ["nova", "ember"],
            projectGrants: [GroupProjectGrant(projectId: "cave", access: .read)]
        ),
    ]

    func testDirectReadPlusGroupWriteIsWrite() {
        let effective = PermissionModels.resolveEffectiveAccess(
            directGrants: [ProjectGrant(familiarId: "nova", projectId: "cave", access: .read)],
            groups: groups, familiarId: "nova", projectId: "cave"
        )
        XCTAssertEqual(effective.level, .write)
        XCTAssertEqual(effective.direct, .read)
        XCTAssertEqual(effective.groups.count, 2)
        XCTAssertFalse(effective.viaGroupOnly)
    }

    func testGroupOnlyAccessReportsViaGroup() {
        let effective = PermissionModels.resolveEffectiveAccess(
            directGrants: [], groups: groups, familiarId: "ember", projectId: "cave"
        )
        XCTAssertEqual(effective.level, .read)
        XCTAssertNil(effective.direct)
        XCTAssertEqual(effective.groups.map(\.groupName), ["Readers"])
        XCTAssertTrue(effective.viaGroupOnly)
    }

    func testNoGrantsMeansNoAccess() {
        let effective = PermissionModels.resolveEffectiveAccess(
            directGrants: [], groups: groups, familiarId: "ghost", projectId: "cave"
        )
        XCTAssertNil(effective.level)
        XCTAssertNil(effective.direct)
        XCTAssertTrue(effective.groups.isEmpty)
    }

    func testNonMemberGroupGrantDoesNotLeak() {
        let effective = PermissionModels.resolveEffectiveAccess(
            directGrants: [], groups: groups, familiarId: "ember", projectId: "docs"
        )
        XCTAssertNil(effective.level)
    }

    // MARK: - Undo window

    private func proposal(status: GrantProposalStatus, finalizesAt: String?) -> GrantProposal {
        GrantProposal(
            id: "p1", proposedBy: "nova", targetFamiliarId: "ember", projectId: "cave",
            access: .write, status: status, createdAt: "x",
            acceptedAt: nil, finalizesAt: finalizesAt
        )
    }

    func testAcceptingProposalCountsDownWholeSeconds() {
        let now = Date()
        let ends = PermissionModels.isoFormatter.string(from: now.addingTimeInterval(29.4))
        let remaining = proposal(status: .accepting, finalizesAt: ends)
            .undoSecondsRemaining(now: now)
        XCTAssertEqual(remaining, 30) // rounds up — never shows 0s while undoable
    }

    func testElapsedWindowIsNoLongerUndoable() {
        let now = Date()
        let ends = PermissionModels.isoFormatter.string(from: now.addingTimeInterval(-1))
        XCTAssertNil(proposal(status: .accepting, finalizesAt: ends).undoSecondsRemaining(now: now))
    }

    func testPendingProposalHasNoCountdown() {
        let now = Date()
        let ends = PermissionModels.isoFormatter.string(from: now.addingTimeInterval(30))
        XCTAssertNil(proposal(status: .pending, finalizesAt: ends).undoSecondsRemaining(now: now))
        XCTAssertNil(proposal(status: .accepting, finalizesAt: nil).undoSecondsRemaining(now: now))
    }

    func testParsesISOWithAndWithoutFractionalSeconds() {
        XCTAssertNotNil(PermissionModels.parseISO("2026-07-01T10:00:00.123Z"))
        XCTAssertNotNil(PermissionModels.parseISO("2026-07-01T10:00:00Z"))
        XCTAssertNil(PermissionModels.parseISO("not-a-date"))
    }

    // MARK: - Save-error mapping (Code tab)

    func testPermissionSaveErrorsBecomeActionableGuidance() {
        let mapped = CodeEditorView.saveErrorMessage(
            CaveError.transport("missing familiarId for project access"))
        XCTAssertTrue(mapped.contains("Allow file edits from phone"))

        let writeLevel = CodeEditorView.saveErrorMessage(
            CaveError.transport("file-write requires write access"))
        XCTAssertTrue(writeLevel.contains("desktop Settings"))

        // Unrelated failures pass through untouched.
        let other = CodeEditorView.saveErrorMessage(CaveError.transport("disk full"))
        XCTAssertEqual(other, "disk full")
    }
}
