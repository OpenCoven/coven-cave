import XCTest
@testable import CovenCave

@MainActor
final class ChatNewConversationContextTests: XCTestCase {
    private func familiar(_ id: String) -> Familiar {
        Familiar(
            id: id,
            displayName: id.capitalized,
            role: nil,
            description: nil,
            pronouns: nil,
            color: nil,
            status: "active",
            harness: nil,
            model: nil,
            icon: nil,
            avatarUrl: nil,
            activeSessions: nil,
            memoryFreshness: nil
        )
    }

    func testSelectedFamiliarUsesItsId() {
        XCTAssertEqual(
            ChatNewConversationContext.fixedFamiliarId(
                selection: .familiar(familiar("nyx")),
                detailPath: []
            ),
            "nyx"
        )
    }

    func testSelectedDirectThreadUsesItsFamiliar() {
        let thread = ChatThread(title: "Direct", familiarIds: ["nyx"])

        XCTAssertEqual(
            ChatNewConversationContext.fixedFamiliarId(
                selection: .thread(thread),
                detailPath: []
            ),
            "nyx"
        )
    }

    func testVisibleDetailThreadOverridesSidebarSelection() {
        let thread = ChatThread(title: "Direct", familiarIds: ["sage"])

        XCTAssertEqual(
            ChatNewConversationContext.fixedFamiliarId(
                selection: .familiar(familiar("nyx")),
                detailPath: [.thread(thread)]
            ),
            "sage"
        )
    }

    func testVisibleGroupThreadKeepsGeneralMode() {
        let thread = ChatThread(title: "Group", familiarIds: ["nyx", "sage"])

        XCTAssertNil(
            ChatNewConversationContext.fixedFamiliarId(
                selection: .familiar(familiar("nyx")),
                detailPath: [.thread(thread)]
            )
        )
    }

    func testMissingContextKeepsGeneralMode() {
        XCTAssertNil(
            ChatNewConversationContext.fixedFamiliarId(
                selection: nil,
                detailPath: []
            )
        )
    }
}
