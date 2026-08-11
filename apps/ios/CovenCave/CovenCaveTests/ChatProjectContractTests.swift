import XCTest
@testable import CovenCave

final class ChatProjectContractTests: XCTestCase {
    @MainActor
    func testFirstTurnBodyUsesPersistedProjectWithoutSession() throws {
        let thread = ChatThread(
            title: "New Nyx chat",
            familiarIds: ["nyx"],
            projectRoot: "/repos/cave"
        )

        let body = try XCTUnwrap(
            thread.makeSendBody(
                familiarId: "nyx",
                prompt: "hello",
                runId: "run-1"
            )
        )

        XCTAssertEqual(body.projectRoot, "/repos/cave")
        XCTAssertNil(body.sessionId)
    }

    @MainActor
    func testGroupFirstTurnBodiesUseTheSamePersistedProject() throws {
        let thread = ChatThread(
            title: "Nova and Sage",
            familiarIds: ["nova", "sage"],
            projectRoot: "/repos/shared"
        )

        for familiarId in thread.familiarIds {
            let body = try XCTUnwrap(
                thread.makeSendBody(
                    familiarId: familiarId,
                    prompt: "hello",
                    runId: "run-\(familiarId)"
                )
            )
            XCTAssertEqual(body.projectRoot, "/repos/shared")
            XCTAssertNil(body.sessionId)
        }
    }

    @MainActor
    func testUnresolvedFirstTurnCannotBuildRequest() {
        let thread = ChatThread(title: "New Nyx chat", familiarIds: ["nyx"])

        XCTAssertNil(
            thread.makeSendBody(
                familiarId: "nyx",
                prompt: "hello",
                runId: "run-1"
            )
        )
    }

    @MainActor
    func testUnresolvedSendAndEnqueueDoNotMutateTranscript() {
        let thread = ChatThread(title: "New Nyx chat", familiarIds: ["nyx"])
        let client = CaveClient(
            connection: CaveConnection(host: "http://cave.invalid")
        )
        var changeCount = 0

        thread.send("hello", client: client) {
            changeCount += 1
        }
        thread.enqueue("offline hello")

        XCTAssertTrue(thread.messages.isEmpty)
        XCTAssertEqual(changeCount, 0)
        XCTAssertTrue(thread.needsProjectSelection)
    }

    @MainActor
    func testLegacyResumedThreadCanUseServerSessionProvenance() throws {
        let thread = ChatThread(
            title: "Existing Nyx chat",
            familiarIds: ["nyx"],
            sessionIds: ["nyx": "session-1"]
        )

        let body = try XCTUnwrap(
            thread.makeSendBody(
                familiarId: "nyx",
                prompt: "continue",
                runId: "run-1"
            )
        )

        XCTAssertNil(body.projectRoot)
        XCTAssertEqual(body.sessionId, "session-1")
    }

    func testSessionRowDecodesProjectRootProvenance() throws {
        let data = Data(
            """
            {
              "id": "session-1",
              "title": "Nyx chat",
              "familiarId": "nyx",
              "project_root": "/repos/cave"
            }
            """.utf8
        )

        let row = try JSONDecoder().decode(SessionRow.self, from: data)

        XCTAssertEqual(row.projectRoot, "/repos/cave")
    }

    func testProjectErrorEnvelopePreservesActionableMessage() {
        let data = Data(
            """
            {
              "ok": false,
              "code": "project_root_required",
              "error": "Choose a project this familiar can access before starting chat."
            }
            """.utf8
        )

        let error = CaveClient.serverResponseError(statusCode: 400, data: data)

        XCTAssertEqual(
            error.localizedDescription,
            "Choose a project this familiar can access before starting chat."
        )
        XCTAssertTrue(error.requiresProjectSelection)
    }

    func testProjectAccessDeniedRequiresProjectSelection() {
        let data = Data(
            """
            {
              "code": "project_access_denied",
              "error": "Nyx cannot access that project."
            }
            """.utf8
        )

        let error = CaveClient.serverResponseError(statusCode: 403, data: data)

        XCTAssertTrue(error.requiresProjectSelection)
        XCTAssertFalse(CaveError.isAuthFailure(error))
    }

    func testMalformedEnvelopeFallsBackToStatus() {
        let error = CaveClient.serverResponseError(
            statusCode: 502,
            data: Data("not-json".utf8)
        )

        XCTAssertEqual(error.localizedDescription, "Server returned status 502.")
        XCTAssertFalse(error.requiresProjectSelection)
    }

    func testServerFailureStillAllowsInterruptedStreamRecovery() {
        let error = CaveError.serverResponse(
            status: 503,
            code: nil,
            message: "Temporarily unavailable."
        )

        XCTAssertFalse(error.isDefinitiveServerResponse)
    }

    func testClientFailureSkipsInterruptedStreamRecovery() {
        let error = CaveError.serverResponse(
            status: 403,
            code: "project_access_denied",
            message: "Nova cannot access that project."
        )

        XCTAssertTrue(error.isDefinitiveServerResponse)
    }

    func testServerErrorDecoderCapsBodiesAt64KiB() {
        let padding = String(repeating: "x", count: 65_536)
        let data = Data(
            """
            {
              "code": "project_root_required",
              "error": "This message must not be decoded past the cap.",
              "padding": "\(padding)"
            }
            """.utf8
        )

        let error = CaveClient.serverResponseError(statusCode: 400, data: data)

        XCTAssertEqual(error.localizedDescription, "Server returned status 400.")
        XCTAssertFalse(error.requiresProjectSelection)
    }

    @MainActor
    func testProjectErrorReopensSelectionBeforeFirstSession() {
        let thread = ChatThread(
            title: "Fresh",
            familiarIds: ["nova"],
            projectRoot: "/repos/stale"
        )
        let error = CaveError.serverResponse(
            status: 403,
            code: "project_access_denied",
            message: "Nova cannot access that project."
        )

        XCTAssertTrue(thread.applyProjectRecovery(for: error))
        XCTAssertNil(thread.projectRoot)
        XCTAssertTrue(thread.needsProjectSelection)
    }

    @MainActor
    func testProjectErrorCannotRelabelStartedSession() {
        let thread = ChatThread(
            title: "Existing",
            familiarIds: ["nova"],
            sessionIds: ["nova": "session-1"],
            projectRoot: "/repos/original"
        )
        let error = CaveError.serverResponse(
            status: 403,
            code: "project_access_denied",
            message: "Nova cannot access that project."
        )

        XCTAssertFalse(thread.applyProjectRecovery(for: error))
        XCTAssertEqual(thread.projectRoot, "/repos/original")
        XCTAssertFalse(thread.needsProjectSelection)
    }

    @MainActor
    func testOrdinaryTransportErrorDoesNotReopenProjectSelection() {
        let thread = ChatThread(
            title: "Fresh",
            familiarIds: ["nova"],
            projectRoot: "/repos/cave"
        )

        XCTAssertFalse(thread.applyProjectRecovery(for: URLError(.timedOut)))
        XCTAssertEqual(thread.projectRoot, "/repos/cave")
        XCTAssertFalse(thread.needsProjectSelection)
    }

    @MainActor
    func testProjectCanChangeOnlyBeforeFirstServerSession() {
        let fresh = ChatThread(
            title: "Fresh",
            familiarIds: ["nova"],
            projectRoot: "/repos/a"
        )
        XCTAssertTrue(fresh.canChangeProject)

        fresh.sessionIds["nova"] = " \n "
        XCTAssertTrue(fresh.canChangeProject)

        fresh.sessionIds["nova"] = "session-1"

        XCTAssertFalse(fresh.canChangeProject)
    }

    @MainActor
    func testGroupRequiresProjectOrSessionForEveryParticipant() {
        let thread = ChatThread(
            title: "Group",
            familiarIds: ["nova", "sage"],
            sessionIds: ["nova": "session-1"]
        )
        XCTAssertFalse(thread.canSendMessages)

        thread.sessionIds["sage"] = "session-2"
        XCTAssertTrue(thread.canSendMessages)

        thread.sessionIds = [:]
        thread.projectRoot = "/repos/shared"
        XCTAssertTrue(thread.canSendMessages)
    }

    func testProjectLoadKeyIsSortedAndDistinct() {
        XCTAssertEqual(
            ChatProjectSelection.familiarKey(["sage", "nova", "sage", ""]),
            ["nova", "sage"]
        )
    }
}
