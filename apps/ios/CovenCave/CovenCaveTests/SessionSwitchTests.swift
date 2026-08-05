import XCTest
@testable import CovenCave

/// The session switcher's routing contract.
///
/// Choosing a session in ChatView's picker used to do nothing at all: the
/// picker pushed onto a `[ChatRoute]` binding whose `NavigationStack` was never
/// bound to it, so the tap wrote into state nothing rendered. The switch now
/// goes through `AppModel`, which is what these tests pin.
@MainActor
final class SessionSwitchTests: XCTestCase {

    private func thread(_ id: String) -> ChatThread {
        ChatThread(id: id, title: id, familiarIds: ["nyx"])
    }

    /// The switch must actually reach the chat list, not dead-end.
    func testSwitchingToAnotherSessionRequestsItAndSelectsChats() {
        let app = AppModel()
        app.selectedTab = .settings
        let chosen = thread("other-session")

        XCTAssertTrue(app.switchConversation(to: chosen, currentThreadId: "current-session"))

        XCTAssertTrue(app.threadToOpen === chosen)
        XCTAssertEqual(app.selectedTab, .chats)
    }

    /// Re-picking the conversation already open must not rebuild it — that
    /// would tear down the chat being looked at and lose scroll position.
    func testChoosingTheCurrentSessionIsANoOp() {
        let app = AppModel()
        let current = thread("current-session")

        XCTAssertFalse(app.switchConversation(to: current, currentThreadId: "current-session"))

        XCTAssertNil(app.threadToOpen)
    }

    /// A chat with nothing open behind it (no current id) still switches,
    /// rather than being mistaken for a no-op.
    func testSwitchingWithNoCurrentSessionStillOpens() {
        let app = AppModel()
        let chosen = thread("first-session")

        XCTAssertTrue(app.switchConversation(to: chosen, currentThreadId: nil))

        XCTAssertTrue(app.threadToOpen === chosen)
    }

    /// The chosen session must stay put once opened. After the view consumes
    /// the one-shot request, that session is the current one — so the picker
    /// offering it again must not re-request it and rebuild the live chat.
    func testChosenSessionSticksAfterTheRequestIsConsumed() {
        let app = AppModel()
        let chosen = thread("sticky-session")

        XCTAssertTrue(app.switchConversation(to: chosen, currentThreadId: "previous-session"))
        XCTAssertTrue(app.threadToOpen === chosen)

        // ChatsHomeView clears the intent once it has opened the thread.
        app.threadToOpen = nil

        // Re-picking it now that it is the open conversation must do nothing.
        XCTAssertFalse(app.switchConversation(to: chosen, currentThreadId: chosen.id))
        XCTAssertNil(app.threadToOpen)
    }
}
