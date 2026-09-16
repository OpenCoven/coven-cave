import XCTest
@testable import CovenCave

final class ChatScrollStateTests: XCTestCase {
    func testInitialAndDelayedLayoutKeepFollowing() {
        var state = ChatScrollState()
        state.updateGeometry(atBottom: false)
        XCTAssertTrue(state.isFollowingLatest)
        XCTAssertFalse(state.isAtBottom)
        state.endUserScroll()
        XCTAssertTrue(state.isFollowingLatest, "programmatic idle is not a user scroll")
        state.updateGeometry(atBottom: true)
        state.updateGeometry(atBottom: false)
        XCTAssertTrue(state.isFollowingLatest, "late markdown growth keeps bottom intent")
    }

    func testUserReadingHistoryIsNotOverriddenByLayout() {
        var state = ChatScrollState()
        state.beginUserScroll()
        XCTAssertFalse(state.isFollowingLatest, "cancel pending follow before the first geometry update")
        state.updateGeometry(atBottom: false)
        state.endUserScroll()
        state.updateGeometry(atBottom: false)
        XCTAssertFalse(state.isFollowingLatest)
        XCTAssertFalse(state.isUserScrolling)
    }

    func testReturningToBottomResumesFollowingAfterGesture() {
        var state = ChatScrollState()
        state.beginUserScroll()
        state.updateGeometry(atBottom: true)
        XCTAssertFalse(state.isFollowingLatest, "do not fight a gesture still in progress")
        state.endUserScroll()
        XCTAssertTrue(state.isFollowingLatest)
    }

    func testExplicitJumpResumesFollowingWithoutPretendingItArrived() {
        var state = ChatScrollState()
        state.beginUserScroll()
        state.updateGeometry(atBottom: false)
        state.followLatest()
        XCTAssertTrue(state.isFollowingLatest)
        XCTAssertFalse(state.isUserScrolling)
        XCTAssertFalse(state.isAtBottom, "the jump affordance stays until geometry confirms arrival")
        state.updateGeometry(atBottom: true)
        XCTAssertTrue(state.isAtBottom)
    }

    func testGeometryTracksRepeatedGrowthWhileStillAwayFromBottom() {
        let first = ChatScrollGeometry(contentHeight: 1_000, visibleBottom: 600)
        let second = ChatScrollGeometry(contentHeight: 1_200, visibleBottom: 600)
        XCTAssertNotEqual(first, second)
        XCTAssertFalse(first.isAtBottom)
        XCTAssertFalse(second.isAtBottom)
        XCTAssertTrue(ChatScrollGeometry(contentHeight: 100, visibleBottom: 600).isAtBottom)
        XCTAssertTrue(ChatScrollGeometry(contentHeight: 1_000, visibleBottom: 980).isAtBottom)
    }
}
