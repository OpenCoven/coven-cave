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

final class ChatViewportRecoveryTests: XCTestCase {
    private func geometry(height: CGFloat, offset: CGFloat, viewport: CGFloat = 600,
                          top: CGFloat = 0, bottom: CGFloat = 0) -> ChatViewportGeometry {
        ChatViewportGeometry(contentHeight: height, viewportHeight: viewport,
                             contentOffset: offset, topInset: top, bottomInset: bottom)
    }

    func testShrinkBeyondNewExtentRecoversWithoutLatestRowGeometry() {
        var recovery = ChatViewportRecovery()
        recovery.update(geometry(height: 10_000, offset: 7_000))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
        recovery.update(geometry(height: 500, offset: 7_000))
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false), "one correction per shrink")
    }

    func testValidHistoryPositionIsNotMovedByShrink() {
        var recovery = ChatViewportRecovery()
        recovery.update(geometry(height: 10_000, offset: 1_000))
        recovery.update(geometry(height: 5_000, offset: 1_000))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testStreamingGrowthAndOrdinaryOverscrollDoNotTriggerRecovery() {
        var recovery = ChatViewportRecovery()
        recovery.update(geometry(height: 5_000, offset: 1_000))
        recovery.update(geometry(height: 6_000, offset: 1_000))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
        recovery.update(geometry(height: 6_000, offset: 5_500))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testCorrectionWaitsUntilGestureAndDecelerationEnd() {
        var recovery = ChatViewportRecovery()
        recovery.update(geometry(height: 10_000, offset: 7_000))
        recovery.update(geometry(height: 500, offset: 7_000))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: true))
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
    }

    func testUIKitSelfCorrectionCancelsPendingRecovery() {
        var recovery = ChatViewportRecovery()
        recovery.update(geometry(height: 10_000, offset: 7_000))
        recovery.update(geometry(height: 500, offset: 7_000))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: true))
        recovery.update(geometry(height: 500, offset: 0))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testInsetsAndToleranceDoNotCreateFalseOutOfRangeSignals() {
        XCTAssertFalse(geometry(height: 1_000, offset: 440, bottom: 40).isBeyondEnd)
        XCTAssertFalse(geometry(height: 500, offset: -44, top: 44).isBeyondEnd)
        XCTAssertFalse(geometry(height: 1_000, offset: 424).isBeyondEnd)
        XCTAssertTrue(geometry(height: 1_000, offset: 425).isBeyondEnd)
    }

    func testInvalidTransientGeometryDoesNotErasePendingShrink() {
        var recovery = ChatViewportRecovery()
        recovery.update(geometry(height: 10_000, offset: 7_000))
        recovery.update(geometry(height: 500, offset: 7_000))
        recovery.update(geometry(height: 0, offset: 0, viewport: 0))
        recovery.update(geometry(height: .infinity, offset: 0))
        recovery.update(geometry(height: 500, offset: .nan))
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
    }

    func testOrdinaryScrollOffsetsDoNotInvalidateSwiftUIStateEveryFrame() {
        XCTAssertEqual(geometry(height: 10_000, offset: 100), geometry(height: 10_000, offset: 3_000))
    }
}
