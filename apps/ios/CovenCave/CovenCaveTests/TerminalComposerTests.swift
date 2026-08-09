import XCTest
@testable import CovenCave

@MainActor
final class TerminalComposerTests: XCTestCase {
    func testRecognisedTerminalCommandsStayLocal() {
        XCTAssertEqual(TerminalCommand.parse("/help"), .local(.help))
        XCTAssertEqual(TerminalCommand.parse("/cls"), .local(.clear))
        XCTAssertEqual(TerminalCommand.parse("/cwd"), .local(.chooseWorkingDirectory))
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
        XCTAssertEqual(TerminalCommand.matches("/c").map(\.name), ["/clear", "/cwd"])
        XCTAssertTrue(TerminalCommand.matches("/clear now").isEmpty)
    }

    func testAskFamiliarHandoffIsAnUnsentChatDraftWithCwd() {
        let app = AppModel()
        app.selectedTab = .terminal
        app.requestTerminalFamiliarHandoff(draft: "git status", cwd: "/repo")

        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertTrue(app.newChatRequested)
        XCTAssertEqual(app.terminalFamiliarHandoff?.draft, "git status")
        XCTAssertEqual(app.terminalFamiliarHandoff?.cwd, "/repo")

        let thread = ChatThread(title: "Review", familiarIds: ["nova"], projectRoot: "/repo")
        app.applyTerminalFamiliarHandoff(to: thread)

        XCTAssertNil(app.terminalFamiliarHandoff)
        XCTAssertTrue(app.threadDrafts[thread.id]?.contains("git status") == true)
        XCTAssertTrue(app.threadDrafts[thread.id]?.contains("Working directory: /repo") == true)
    }
}
