import XCTest
@testable import CovenCave

@MainActor
final class TerminalComposerTests: XCTestCase {
    func testRecognisedTerminalCommandsStayLocal() {
        XCTAssertEqual(TerminalCommand.parse("/help"), .local(.help))
        XCTAssertEqual(TerminalCommand.parse("/cls"), .local(.clear))
    }

    func testUnknownSlashInputPassesThroughToShell() {
        XCTAssertEqual(
            TerminalCommand.parse("/usr/bin/env swift --version"),
            .send("/usr/bin/env swift --version")
        )
        XCTAssertEqual(TerminalCommand.parse("/clear now"), .send("/clear now"))
        XCTAssertEqual(TerminalCommand.parse("/workspace/scripts/check"), .send("/workspace/scripts/check"))
    }

    func testSuggestionsAreTerminalSpecific() {
        XCTAssertEqual(TerminalCommand.matches("/c").map(\.name), ["/clear"])
        XCTAssertTrue(TerminalCommand.matches("/clear now").isEmpty)
    }

    func testTerminalSessionContextUsesActiveProjectRootAndStableProjectThreadID() {
        let live = ProjectInfo(
            id: "alpha",
            name: "Alpha",
            root: "/repos/live-alpha",
            color: nil,
            updatedAt: nil
        )
        let stale = ProjectInfo(
            id: "alpha",
            name: "Stale",
            root: "/repos/stale-alpha",
            color: nil,
            updatedAt: nil
        )

        let context = TerminalSessionContext(
            projectContext: .project(stale),
            registeredProjects: [live]
        )

        guard case .project(let session) = context else {
            return XCTFail("expected a project-backed terminal session")
        }

        XCTAssertEqual(session.projectRoot, "/repos/live-alpha")
        XCTAssertEqual(
            session.threadId,
            "ios-terminal::project::alpha::\(PtyTerminalProjectIdentity.rootFingerprint("/repos/live-alpha"))"
        )
        XCTAssertEqual(context.id, "project:alpha")
    }

    func testTerminalThreadIDNormalizesEquivalentRootsButChangesWhenRootMoves() {
        let alpha = ProjectInfo(
            id: "alpha",
            name: "Alpha",
            root: "/repos/live-alpha/",
            color: nil,
            updatedAt: nil
        )
        let movedAlpha = ProjectInfo(
            id: "alpha",
            name: "Alpha",
            root: "/repos/live-alpha-moved",
            color: nil,
            updatedAt: nil
        )

        let original = TerminalSessionContext(
            projectContext: .project(alpha),
            registeredProjects: [alpha]
        )
        let equivalent = TerminalSessionContext(
            projectContext: .project(
                ProjectInfo(
                    id: "alpha",
                    name: "Alpha",
                    root: "  /repos/live-alpha  ",
                    color: nil,
                    updatedAt: nil
                )
            ),
            registeredProjects: [alpha]
        )
        let moved = TerminalSessionContext(
            projectContext: .project(movedAlpha),
            registeredProjects: [movedAlpha]
        )

        guard case .project(let originalSession) = original,
              case .project(let equivalentSession) = equivalent,
              case .project(let movedSession) = moved else {
            return XCTFail("expected project-backed terminal sessions")
        }

        XCTAssertEqual(
            originalSession.threadId,
            equivalentSession.threadId,
            "equivalent roots should keep the same persistent PTY identity"
        )
        XCTAssertNotEqual(
            originalSession.threadId,
            movedSession.threadId,
            "moving the effective project root must mint a new PTY identity"
        )
    }

    func testUnassignedContextStaysRecoveryOnly() {
        let alpha = ProjectInfo(
            id: "alpha",
            name: "Alpha",
            root: "/repos/alpha",
            color: nil,
            updatedAt: nil
        )
        XCTAssertEqual(
            TerminalSessionContext(
                projectContext: .unassigned,
                registeredProjects: [alpha]
            ),
            .unassigned
        )
        XCTAssertEqual(
            TerminalSessionContext(
                projectContext: nil,
                registeredProjects: [alpha]
            ),
            .unresolved
        )
    }

    func testAskFamiliarHandoffIsAnUnsentChatDraftWithProjectRoot() {
        let app = AppModel()
        app.selectedTab = .terminal
        app.requestTerminalFamiliarHandoff(draft: "git status", projectRoot: "/repo")

        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertTrue(app.newChatRequested)
        XCTAssertEqual(app.terminalFamiliarHandoff?.draft, "git status")
        XCTAssertEqual(app.terminalFamiliarHandoff?.projectRoot, "/repo")

        let thread = ChatThread(title: "Review", familiarIds: ["nova"], projectRoot: "/repo")
        app.applyTerminalFamiliarHandoff(to: thread)

        XCTAssertNil(app.terminalFamiliarHandoff)
        XCTAssertTrue(app.threadDrafts[thread.id]?.contains("git status") == true)
        XCTAssertTrue(app.threadDrafts[thread.id]?.contains("Project root: /repo") == true)
    }

    func testSwitchProjectClearsPendingTerminalHandoffAndNewChatFlow() {
        let alpha = ProjectInfo(
            id: "alpha",
            name: "Alpha",
            root: "/repos/alpha",
            color: nil,
            updatedAt: nil
        )
        let beta = ProjectInfo(
            id: "beta",
            name: "Beta",
            root: "/repos/beta",
            color: nil,
            updatedAt: nil
        )
        let app = AppModel()
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.projectContext = .project(alpha)
        app.selectedTab = .terminal
        app.requestTerminalFamiliarHandoff(draft: "git status", projectRoot: alpha.root)

        app.switchProject(to: .project(beta))

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertEqual(app.selectedTab, .terminal)
        XCTAssertFalse(app.newChatRequested)
        XCTAssertNil(app.terminalFamiliarHandoff)
    }
}

@MainActor
final class PtyTerminalTransportTests: XCTestCase {
    func testReplacedSocketIgnoresLateOutputFrames() async {
        let oldSocket = ControlledSocket()
        let newSocket = ControlledSocket()
        let terminal = makeTerminal(sockets: [oldSocket.socket, newSocket.socket])
        var output: [String] = []
        terminal.onData = { output.append(String(decoding: $0, as: UTF8.self)) }

        terminal.connect(
            wsBase: URL(string: "ws://cave.example")!,
            threadId: "session-a",
            projectRoot: "/repos/alpha",
            cols: 80,
            rows: 24
        )
        await drainTerminalTasks()

        terminal.connect(
            wsBase: URL(string: "ws://cave.example")!,
            threadId: "session-b",
            projectRoot: "/repos/beta",
            cols: 80,
            rows: 24
        )
        await drainTerminalTasks()

        await oldSocket.finish(.success(.data(outputFrame("stale"))))
        await newSocket.finish(.success(.data(outputFrame("fresh"))))
        await drainTerminalTasks()

        XCTAssertEqual(output, ["fresh"])
        terminal.disconnect()
    }

    func testReplacedSocketIgnoresLateReceiveErrors() async {
        let oldSocket = ControlledSocket()
        let newSocket = ControlledSocket()
        let terminal = makeTerminal(sockets: [oldSocket.socket, newSocket.socket])

        terminal.connect(
            wsBase: URL(string: "ws://cave.example")!,
            threadId: "session-a",
            projectRoot: "/repos/alpha",
            cols: 80,
            rows: 24
        )
        await drainTerminalTasks()

        terminal.connect(
            wsBase: URL(string: "ws://cave.example")!,
            threadId: "session-b",
            projectRoot: "/repos/beta",
            cols: 80,
            rows: 24
        )
        await drainTerminalTasks()

        await oldSocket.finish(.failure(SocketFailure(message: "stale receive")))
        await drainTerminalTasks()

        XCTAssertTrue(terminal.connected)
        XCTAssertFalse(terminal.exited)
        XCTAssertNil(terminal.error)
        terminal.disconnect()
    }

    private func makeTerminal(sockets: [PtyTerminalSocket]) -> PtyTerminal {
        var remaining = sockets
        return PtyTerminal(socketFactory: { _ in
            precondition(!remaining.isEmpty, "unexpected socket request")
            return remaining.removeFirst()
        })
    }

    private func drainTerminalTasks() async {
        for _ in 0..<4 {
            await Task.yield()
        }
    }

    private func outputFrame(_ text: String) -> Data {
        var data = Data([0x01])
        data.append(Data(text.utf8))
        return data
    }
}

private struct SocketFailure: LocalizedError, Sendable {
    let message: String

    var errorDescription: String? { message }
}

private actor ControlledSocketController {
    private var continuations: [CheckedContinuation<PtyTerminalSocket.Message, Error>] = []
    private var queuedResults: [Result<PtyTerminalSocket.Message, SocketFailure>] = []

    func receive() async throws -> PtyTerminalSocket.Message {
        if !queuedResults.isEmpty {
            return try queuedResults.removeFirst().get()
        }
        return try await withCheckedThrowingContinuation { continuation in
            continuations.append(continuation)
        }
    }

    func finish(_ result: Result<PtyTerminalSocket.Message, SocketFailure>) {
        guard !continuations.isEmpty else {
            queuedResults.append(result)
            return
        }
        let continuation = continuations.removeFirst()
        switch result {
        case .success(let message):
            continuation.resume(returning: message)
        case .failure(let error):
            continuation.resume(throwing: error)
        }
    }
}

private struct ControlledSocket {
    let socket: PtyTerminalSocket
    private let controller = ControlledSocketController()

    init() {
        socket = PtyTerminalSocket(receive: { [controller] in
            try await controller.receive()
        })
    }

    func finish(_ result: Result<PtyTerminalSocket.Message, SocketFailure>) async {
        await controller.finish(result)
    }
}
