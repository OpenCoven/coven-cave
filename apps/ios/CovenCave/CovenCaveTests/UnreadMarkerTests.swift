import XCTest
@testable import CovenCave

/// Placement rules for the "New Messages" transcript divider: it sits above
/// the first assistant reply created after the operator's seen boundary, and
/// its run length decides whether the initial scroll lands on it.
final class UnreadMarkerTests: XCTestCase {

    private let base = Date(timeIntervalSince1970: 1_700_000_000)

    private func message(_ id: String, role: DisplayMessage.Role,
                         offset: TimeInterval) -> DisplayMessage {
        DisplayMessage(id: id, role: role, familiarId: role == .assistant ? "fam" : nil,
                       text: "m-\(id)", createdAt: base.addingTimeInterval(offset))
    }

    // MARK: firstUnseenId

    func testNilBoundaryMeansNoDivider() {
        let messages = [message("a", role: .assistant, offset: 10)]
        XCTAssertNil(UnreadMarker.firstUnseenId(messages: messages, seenBoundary: nil))
    }

    func testAllSeenMeansNoDivider() {
        let messages = [
            message("a", role: .assistant, offset: -20),
            message("b", role: .assistant, offset: -10),
        ]
        XCTAssertNil(UnreadMarker.firstUnseenId(messages: messages, seenBoundary: base))
    }

    func testFirstAssistantReplyAfterBoundaryIsTheDivider() {
        let messages = [
            message("old", role: .assistant, offset: -10),
            message("new1", role: .assistant, offset: 10),
            message("new2", role: .assistant, offset: 20),
        ]
        XCTAssertEqual(UnreadMarker.firstUnseenId(messages: messages, seenBoundary: base), "new1")
    }

    func testOperatorSendsAndSystemNotesNeverCountAsUnseen() {
        let messages = [
            message("mine", role: .user, offset: 10),
            message("note", role: .system, offset: 15),
            message("reply", role: .assistant, offset: 20),
        ]
        XCTAssertEqual(UnreadMarker.firstUnseenId(messages: messages, seenBoundary: base), "reply")
    }

    func testExactlyAtBoundaryReadsAsSeen() {
        let messages = [message("edge", role: .assistant, offset: 0)]
        XCTAssertNil(UnreadMarker.firstUnseenId(messages: messages, seenBoundary: base))
    }

    // MARK: unseenRunLength

    func testRunLengthCountsFromDividerToEnd() {
        let messages = [
            message("a", role: .assistant, offset: -10),
            message("b", role: .assistant, offset: 10),
            message("c", role: .user, offset: 15),
            message("d", role: .assistant, offset: 20),
        ]
        XCTAssertEqual(UnreadMarker.unseenRunLength(messages: messages, firstUnseenId: "b"), 3)
    }

    func testRunLengthZeroWithoutDivider() {
        let messages = [message("a", role: .assistant, offset: 10)]
        XCTAssertEqual(UnreadMarker.unseenRunLength(messages: messages, firstUnseenId: nil), 0)
        XCTAssertEqual(UnreadMarker.unseenRunLength(messages: messages, firstUnseenId: "ghost"), 0)
    }
}
