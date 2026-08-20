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
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        suiteName = "SessionSwitchTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private func makeApp() -> AppModel {
        AppModel(defaults: defaults, restoreLocalState: false)
    }

    private func thread(_ id: String) -> ChatThread {
        ChatThread(id: id, title: id, familiarIds: ["nyx"])
    }

    private func project(_ id: String) -> ProjectInfo {
        ProjectInfo(
            id: id,
            name: id.capitalized,
            root: "/repos/\(id)",
            color: nil,
            updatedAt: nil,
            access: nil
        )
    }

    /// The switch must actually reach the chat list, not dead-end.
    func testSwitchingToAnotherSessionRequestsItAndSelectsChats() {
        let app = makeApp()
        app.selectedTab = .settings
        app.threads = [thread("current-session")]
        let chosen = thread("other-session")
        app.threads.append(chosen)

        XCTAssertTrue(app.switchConversation(to: chosen, currentThreadId: "current-session"))

        XCTAssertTrue(app.threadToOpen === chosen)
        XCTAssertEqual(app.selectedTab, .chats)
        XCTAssertNil(app.pendingProjectNavigationIntent)
    }

    /// Re-picking the conversation already open must not rebuild it — that
    /// would tear down the chat being looked at and lose scroll position.
    func testChoosingTheCurrentSessionIsANoOp() {
        let app = makeApp()
        let current = thread("current-session")

        XCTAssertFalse(app.switchConversation(to: current, currentThreadId: "current-session"))

        XCTAssertNil(app.threadToOpen)
        XCTAssertNil(app.pendingProjectNavigationIntent)
    }

    /// A chat with nothing open behind it (no current id) still switches,
    /// rather than being mistaken for a no-op.
    func testSwitchingWithNoCurrentSessionStillOpens() {
        let app = makeApp()
        let chosen = thread("first-session")
        app.threads = [chosen]

        XCTAssertTrue(app.switchConversation(to: chosen, currentThreadId: nil))

        XCTAssertTrue(app.threadToOpen === chosen)
        XCTAssertNil(app.pendingProjectNavigationIntent)
    }

    /// Switching sessions must also land in the chosen thread's owning project.
    func testSwitchingSessionAlignsProjectContext() {
        let app = makeApp()
        let alpha = project("alpha")
        let beta = project("beta")
        let chosen = ChatThread(
            id: "beta-session",
            title: "Beta session",
            familiarIds: ["nyx"],
            projectRoot: beta.root
        )
        app.projects = [alpha, beta]
        app.projectsLoaded = true
        app.threads = [chosen]
        app.projectContext = .project(alpha)

        XCTAssertTrue(app.switchConversation(to: chosen, currentThreadId: "alpha-session"))

        XCTAssertEqual(app.projectContext, .project(beta))
        XCTAssertTrue(app.threadToOpen === chosen)
        XCTAssertNil(app.pendingProjectNavigationIntent)
    }

    /// The chosen session must stay put once opened. After the view consumes
    /// the one-shot request, that session is the current one — so the picker
    /// offering it again must not re-request it and rebuild the live chat.
    func testChosenSessionSticksAfterTheRequestIsConsumed() {
        let app = makeApp()
        let chosen = thread("sticky-session")
        app.threads = [chosen]

        XCTAssertTrue(app.switchConversation(to: chosen, currentThreadId: "previous-session"))
        XCTAssertTrue(app.threadToOpen === chosen)

        // ChatsHomeView clears the intent once it has opened the thread.
        app.threadToOpen = nil

        // Re-picking it now that it is the open conversation must do nothing.
        XCTAssertFalse(app.switchConversation(to: chosen, currentThreadId: chosen.id))
        XCTAssertNil(app.threadToOpen)
        XCTAssertNil(app.pendingProjectNavigationIntent)
    }
}
