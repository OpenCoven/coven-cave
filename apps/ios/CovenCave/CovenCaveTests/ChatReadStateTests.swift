import XCTest
@testable import CovenCave

final class ChatReadStateTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "ChatReadStateTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    @MainActor
    func testMarkingOneConversationReadDoesNotClearItsSiblings() throws {
        let app = model()
        let first = thread("first")
        let second = thread("second")
        let key = "\(app.projectContext(for: first).id)|nyx"
        app.familiarViews[key] = Date(timeIntervalSince1970: 1)
        let siblingBoundary = try XCTUnwrap(app.seenBoundary(for: second))

        app.markThreadViewed(first)

        XCTAssertGreaterThan(try XCTUnwrap(app.seenBoundary(for: first)), siblingBoundary)
        XCTAssertEqual(app.seenBoundary(for: second), siblingBoundary)
        XCTAssertEqual(app.familiarViews[key], Date(timeIntervalSince1970: 1))
    }

    @MainActor
    func testReadBoundarySurvivesModelRecreationWithTheSameDefaults() {
        let first = model()
        let chat = thread("persisted")
        first.markThreadViewed(chat)

        let restored = model()
        XCTAssertEqual(restored.seenBoundary(for: chat), first.seenBoundary(for: chat))
        XCTAssertNil(restored.seenBoundary(for: thread("different")))
    }

    @MainActor
    func testGroupReadDoesNotMarkItsDirectConversationRead() throws {
        let app = model()
        let group = ChatThread(id: "group", title: "Group", familiarIds: ["nyx", "lyra"])
        let direct = thread("direct")
        let context = app.projectContext(for: group)
        app.familiarViews["\(context.id)|nyx"] = Date(timeIntervalSince1970: 1)
        app.familiarViews["\(context.id)|lyra"] = Date(timeIntervalSince1970: 2)

        app.markThreadViewed(group)

        XCTAssertEqual(app.seenBoundary(for: direct), Date(timeIntervalSince1970: 1))
        XCTAssertGreaterThan(try XCTUnwrap(app.seenBoundary(for: group)), Date(timeIntervalSince1970: 2))
    }

    @MainActor
    func testReadAcknowledgesDisplayedServerActivityDespiteClockSkew() {
        let app = model()
        let chat = thread("server-backed")
        let displayedActivity = Date().addingTimeInterval(60)

        app.markThreadViewed(chat, through: displayedActivity)

        XCTAssertEqual(app.seenBoundary(for: chat), displayedActivity)
    }

    @MainActor
    private func model() -> AppModel {
        AppModel(defaults: defaults, restoreLocalState: false, widgetSnapshotDefaults: defaults)
    }

    @MainActor
    private func thread(_ id: String) -> ChatThread {
        ChatThread(id: id, title: id, familiarIds: ["nyx"])
    }
}
