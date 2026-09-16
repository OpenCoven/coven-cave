import XCTest
@testable import CovenCave

final class SlashCommandTests: XCTestCase {
    func testTaskCommandsStayRecognizedButDesktopOnly() {
        for token in ["/board", "/tasks", "/task"] {
            guard case .command(let command, let args) = SlashInput.parse("\(token) legacy-id") else {
                return XCTFail("Expected a recognized legacy command: \(token)")
            }
            XCTAssertEqual(args, "legacy-id")
            XCTAssertEqual(command.action, .desktopOnly("Tasks"))
            XCTAssertTrue(command.availability == .desktopOnly)
            XCTAssertFalse(SlashCatalog.available.contains(command))
            XCTAssertTrue(SlashCatalog.matches(token).isEmpty)
        }
    }

    func testAutocompleteExcludesRetiredOperationalSurfaces() {
        let offered = SlashCatalog.matches("/")
        XCTAssertEqual(offered, SlashCatalog.available)
        for token in ["/board", "/tasks", "/task", "/remind", "/automations"] {
            XCTAssertFalse(offered.contains { $0.tokens.contains(token) }, token)
        }
    }

    func testChatCommandsKeepTheirActualActions() {
        XCTAssertEqual(SlashCatalog.command(for: "/model")?.action, .switchModel)
        XCTAssertEqual(SlashCatalog.command(for: "/familiar")?.action, .familiarPicker)
        XCTAssertEqual(SlashCatalog.command(for: "/sessions")?.action, .openSessions)
        for token in ["/run", "/codex", "/claude"] {
            XCTAssertEqual(SlashCatalog.command(for: token)?.action, .sendAsPrompt)
        }
    }

    func testOnlyMessageCommandsRequireSendAuthorization() {
        for token in ["/run", "/codex", "/claude", "/diagram"] {
            XCTAssertEqual(SlashCatalog.command(for: token)?.sendsChatMessage, true, token)
        }
        for token in ["/help", "/board", "/tasks", "/new", "/model", "/sessions"] {
            XCTAssertEqual(SlashCatalog.command(for: token)?.sendsChatMessage, false, token)
        }
    }
}
