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

    /// Reader above a long latest reply, which then shrinks sharply.
    private func shrunkLatestReply() -> ChatViewportRecovery {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "latest", height: 9_000)
        recovery.update(geometry(height: 10_000, offset: 7_000))
        recovery.noteLatestRow(id: "latest", height: 40)
        recovery.update(geometry(height: 500, offset: 7_000))
        return recovery
    }

    func testShrinkBeyondNewExtentRecoversWithoutLatestRowGeometry() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "latest", height: 9_000)
        recovery.update(geometry(height: 10_000, offset: 7_000))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
        recovery.noteLatestRow(id: "latest", height: 40)
        recovery.update(geometry(height: 500, offset: 7_000))
        XCTAssertTrue(recovery.hasPendingRecovery)
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false), "one correction per shrink")
    }

    func testViewportReportingBeforeLatestRowStillRecovers() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "latest", height: 9_000)
        recovery.update(geometry(height: 10_000, offset: 7_000))
        recovery.update(geometry(height: 500, offset: 7_000))
        XCTAssertFalse(recovery.hasPendingRecovery, "an extent change alone is not a latest-reply shrink")
        recovery.noteLatestRow(id: "latest", height: 40)
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
    }

    func testStaleInRangeGeometryDoesNotDiscardLatestRowShrink() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "latest", height: 9_000)
        recovery.update(geometry(height: 10_000, offset: 7_000))
        recovery.noteLatestRow(id: "latest", height: 40)
        XCTAssertFalse(recovery.hasPendingRecovery, "old extent is still in range")
        recovery.update(geometry(height: 500, offset: 7_000))
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
    }

    func testLazyHistoryReestimationNeverPullsReaderToLatest() {
        // Reading older content: history rows materialize and the lazy stack's
        // estimated extent drops for a frame before the offset settles. The
        // latest reply itself did not change, so this is not recovery.
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "latest", height: 1_200)
        recovery.update(geometry(height: 4_554, offset: 3_800))
        recovery.update(geometry(height: 4_323, offset: 3_800))
        XCTAssertFalse(recovery.hasPendingRecovery)
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
        recovery.update(geometry(height: 4_323, offset: 3_569))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testNewLatestMessageIsAFreshBaselineNotAShrink() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "older", height: 9_000)
        recovery.update(geometry(height: 10_000, offset: 9_400))
        recovery.noteLatestRow(id: "newer", height: 40)
        recovery.update(geometry(height: 2_000, offset: 9_400))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testValidHistoryPositionIsNotMovedByShrink() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "latest", height: 6_000)
        recovery.update(geometry(height: 10_000, offset: 1_000))
        recovery.noteLatestRow(id: "latest", height: 1_000)
        recovery.update(geometry(height: 5_000, offset: 1_000))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testStreamingGrowthAndOrdinaryOverscrollDoNotTriggerRecovery() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "latest", height: 1_000)
        recovery.update(geometry(height: 5_000, offset: 1_000))
        recovery.noteLatestRow(id: "latest", height: 2_000)
        recovery.update(geometry(height: 6_000, offset: 1_000))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
        recovery.update(geometry(height: 6_000, offset: 5_500))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testCorrectionWaitsUntilGestureAndDecelerationEnd() {
        var recovery = shrunkLatestReply()
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: true))
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
    }

    func testUIKitSelfCorrectionCancelsPendingRecovery() {
        var recovery = shrunkLatestReply()
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: true))
        recovery.update(geometry(height: 500, offset: 0))
        XCTAssertFalse(recovery.hasPendingRecovery)
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testInsetsAndToleranceDoNotCreateFalseOutOfRangeSignals() {
        XCTAssertFalse(geometry(height: 1_000, offset: 440, bottom: 40).isBeyondEnd)
        XCTAssertFalse(geometry(height: 500, offset: -44, top: 44).isBeyondEnd)
        XCTAssertFalse(geometry(height: 1_000, offset: 424).isBeyondEnd)
        XCTAssertTrue(geometry(height: 1_000, offset: 425).isBeyondEnd)
    }

    func testInvalidTransientGeometryDoesNotErasePendingShrink() {
        var recovery = shrunkLatestReply()
        recovery.update(geometry(height: 0, offset: 0, viewport: 0))
        recovery.update(geometry(height: .infinity, offset: 0))
        recovery.update(geometry(height: 500, offset: .nan))
        recovery.noteLatestRow(id: "latest", height: .nan)
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
    }

    func testOrdinaryScrollOffsetsDoNotInvalidateSwiftUIStateEveryFrame() {
        XCTAssertEqual(geometry(height: 10_000, offset: 100), geometry(height: 10_000, offset: 3_000))
    }
}
