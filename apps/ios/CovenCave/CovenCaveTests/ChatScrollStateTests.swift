import SwiftUI
import UIKit
import XCTest
@testable import CovenCave

final class ChatScrollStateTests: XCTestCase {
    func testDeferredResourcesWaitForValidViewport() {
        let size = CGSize(width: 390, height: 300)
        XCTAssertFalse(ChatResourceViewport.isNearby(size: size, viewport: nil))
        XCTAssertFalse(ChatResourceViewport.isNearby(size: size, viewport: .zero))
        XCTAssertFalse(ChatResourceViewport.isNearby(size: size,
            viewport: CGRect(x: 0, y: 0, width: 390, height: CGFloat.infinity)))
        XCTAssertFalse(ChatResourceViewport.isNearby(size: .zero,
            viewport: CGRect(x: 0, y: 0, width: 390, height: 600)))
        XCTAssertTrue(ChatResourceViewport.isNearby(size: size,
            viewport: CGRect(x: 0, y: 0, width: 390, height: 600)))
        XCTAssertTrue(ChatResourceViewport.isNearby(size: size,
            viewport: CGRect(x: 0, y: 800, width: 390, height: 600)))
        XCTAssertFalse(ChatResourceViewport.isNearby(size: size,
            viewport: CGRect(x: 0, y: 2000, width: 390, height: 600)))
    }

    func testHistoricalMarkdownStaysBoundedIncludingUnderVoiceOver() {
        for voiceOver in [false, true] {
            XCTAssertFalse(MessageProseView.shouldMountMarkdown(historical: true, deferredSpan: false,
                streaming: false, voiceOver: voiceOver, nearby: false))
            XCTAssertTrue(MessageProseView.shouldMountMarkdown(historical: true, deferredSpan: false,
                streaming: false, voiceOver: voiceOver, nearby: true))
            XCTAssertTrue(MessageProseView.shouldMountMarkdown(historical: true, deferredSpan: true,
                streaming: true, voiceOver: voiceOver, nearby: false))
        }
    }

    func testLatestMarkdownAndVoiceOverTimelineStayAvailable() {
        XCTAssertTrue(MessageProseView.shouldMountMarkdown(historical: false, deferredSpan: false,
            streaming: false, voiceOver: false, nearby: false))
        XCTAssertTrue(MessageProseView.shouldMountMarkdown(historical: false, deferredSpan: true,
            streaming: false, voiceOver: true, nearby: false))
        XCTAssertFalse(MessageProseView.shouldMountMarkdown(historical: false, deferredSpan: true,
            streaming: false, voiceOver: false, nearby: false))
    }

    func testIdleUsesFreshGeometryWhenTheRowCallbackArrivesLate() {
        var state = ChatScrollState()
        state.beginUserScroll()
        state.endUserScroll(
            currentGeometry: ChatScrollGeometry(contentHeight: 500, visibleBottom: 300),
            previousGeometry: ChatScrollGeometry(contentHeight: 500, visibleBottom: 500))
        XCTAssertFalse(state.isAtBottom)
        XCTAssertFalse(state.isFollowingLatest, "a delayed row callback must not pull a history reader back to latest")
    }

    func testFreshIdleGeometryKeepsAReturnWhenOnlyTheLatestReplyGrew() {
        var state = ChatScrollState()
        state.beginUserScroll()
        state.updateGeometry(atBottom: false, movedAway: true)
        state.updateGeometry(atBottom: true)
        state.endUserScroll(
            currentGeometry: ChatScrollGeometry(contentHeight: 700, visibleBottom: 500),
            previousGeometry: ChatScrollGeometry(contentHeight: 500, visibleBottom: 500))
        XCTAssertFalse(state.isAtBottom)
        XCTAssertTrue(state.isFollowingLatest, "growth after reaching the tail still preserves the return intent")
    }

    func testFreshIdleGeometryCancelsAReturnWhenTheReaderMovesAwayAgain() {
        var state = ChatScrollState()
        state.beginUserScroll()
        state.updateGeometry(atBottom: false, movedAway: true)
        state.updateGeometry(atBottom: true)
        state.endUserScroll(
            currentGeometry: ChatScrollGeometry(contentHeight: 500, visibleBottom: 300),
            previousGeometry: ChatScrollGeometry(contentHeight: 500, visibleBottom: 500))
        XCTAssertFalse(state.isFollowingLatest)
    }

    @MainActor
    func testIdleReconcilesTheCurrentNativeViewportBeforeLateRowCallbacks() {
        let scrollView = UIScrollView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
        scrollView.contentSize = CGSize(width: 390, height: 2_000)
        scrollView.contentOffset.y = 700
        let coordinator = ChatScrollAnchorCoordinator()
        coordinator.scrollView = scrollView
        coordinator.note("latest", ChatScrollAnchor.Row(minY: 1_000, maxY: 1_500), preserving: { false })
        coordinator.noteLatestGeometry("latest", ChatScrollGeometry(contentHeight: 500, visibleBottom: 500))
        var state = ChatScrollState()
        state.beginUserScroll()
        state.endUserScroll(currentGeometry: coordinator.geometry(for: "latest"),
                            previousGeometry: coordinator.reportedGeometry(for: "latest"))
        XCTAssertFalse(state.isAtBottom)
        XCTAssertFalse(state.isFollowingLatest)
    }

    @MainActor
    func testNativeRowGeometryKeepsViewportBoundsWithBottomContentInsets() {
        let scrollView = UIScrollView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
        scrollView.contentSize = CGSize(width: 390, height: 2_000)
        scrollView.contentInset.bottom = 120
        scrollView.contentOffset.y = 900
        let coordinator = ChatScrollAnchorCoordinator()
        coordinator.scrollView = scrollView
        coordinator.note("latest", ChatScrollAnchor.Row(minY: 1_000, maxY: 1_500), preserving: { false })
        XCTAssertEqual(coordinator.geometry(for: "latest"), ChatScrollGeometry(contentHeight: 500, visibleBottom: 500))
    }

    @MainActor
    func testNativeRowGeometryUsesPendingLayoutAndResetsItsReportedBaseline() {
        let scrollView = UIScrollView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
        scrollView.contentSize = CGSize(width: 390, height: 3_000)
        scrollView.contentOffset.y = 1_400
        let coordinator = ChatScrollAnchorCoordinator()
        coordinator.scrollView = scrollView
        coordinator.note("latest", ChatScrollAnchor.Row(minY: 1_500, maxY: 2_000), preserving: { false })
        coordinator.noteLatestGeometry("latest", ChatScrollGeometry(contentHeight: 500, visibleBottom: 500))
        XCTAssertEqual(coordinator.geometry(for: "latest"), ChatScrollGeometry(contentHeight: 500, visibleBottom: 500))
        coordinator.reset()
        XCTAssertNil(coordinator.geometry(for: "latest"))
        XCTAssertNil(coordinator.reportedGeometry(for: "latest"))
    }

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

    func testReturningToBottomSurvivesStreamingGrowthBeforeGestureIdle() {
        var state = ChatScrollState()
        state.beginUserScroll()
        state.updateGeometry(atBottom: false)
        state.endUserScroll()
        state.beginUserScroll()
        state.updateGeometry(atBottom: true)
        // A streamed line grows after reaching the tail but before deceleration ends.
        state.updateGeometry(atBottom: false)
        state.endUserScroll()
        XCTAssertTrue(state.isFollowingLatest, "streaming growth must not erase the reader's return to latest")
    }

    func testMovingAwayAfterReturningCancelsFollowEvenAfterGrowth() {
        var state = ChatScrollState()
        state.beginUserScroll()
        state.updateGeometry(atBottom: false, movedAway: true)
        state.updateGeometry(atBottom: true)
        state.updateGeometry(atBottom: false)
        state.updateGeometry(atBottom: false, movedAway: true)
        state.endUserScroll()
        XCTAssertFalse(state.isFollowingLatest, "reader reversal keeps history under reader control")
    }

    func testBeginningToReadHistoryNearBottomDoesNotLatchAReturn() {
        var state = ChatScrollState()
        state.beginUserScroll()
        state.updateGeometry(atBottom: true, movedAway: true)
        state.updateGeometry(atBottom: false, movedAway: true)
        state.endUserScroll()
        XCTAssertFalse(state.isFollowingLatest)
    }

    func testDecelerationDoesNotResetTheSameGestureReturn() {
        var state = ChatScrollState()
        state.beginUserScroll()
        state.updateGeometry(atBottom: false, movedAway: true)
        state.updateGeometry(atBottom: true)
        state.beginUserScroll()
        state.updateGeometry(atBottom: false)
        state.endUserScroll()
        XCTAssertTrue(state.isFollowingLatest)
        state.beginUserScroll()
        state.updateGeometry(atBottom: false, movedAway: true)
        state.endUserScroll()
        XCTAssertFalse(state.isFollowingLatest, "the next gesture cannot inherit the previous return")
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

    // MARK: Scroll anchoring (#6090)

    private func row(_ minY: CGFloat, _ maxY: CGFloat) -> ChatScrollAnchor.Row {
        ChatScrollAnchor.Row(minY: minY, maxY: maxY)
    }

    /// History rows at 0–900 and 900–1,800, the latest reply at 1,800–3,000.
    private func settledTranscript() -> ChatScrollAnchor {
        var anchor = ChatScrollAnchor()
        anchor.note("history-a", row(0, 900))
        anchor.note("history-b", row(900, 1_800))
        anchor.note("latest", row(1_800, 3_000))
        _ = anchor.takeCorrection(viewportTop: 2_400, viewportHeight: 600, preserving: true)
        return anchor
    }

    func testGrowthAboveKeepsAReaderInsideTheLatestReplyInPlace() {
        var anchor = settledTranscript()
        anchor.note("history-b", row(900, 3_200))
        anchor.note("latest", row(3_200, 4_400))
        XCTAssertEqual(anchor.takeCorrection(viewportTop: 2_400, viewportHeight: 600, preserving: true), 1_400)
    }

    func testOnePassCorrectsOnceHoweverManyRowsMoved() {
        var anchor = settledTranscript()
        anchor.note("history-a", row(0, 1_500))
        anchor.note("history-b", row(1_500, 2_400))
        anchor.note("latest", row(2_400, 3_600))
        XCTAssertEqual(anchor.takeCorrection(viewportTop: 2_400, viewportHeight: 600, preserving: true), 600)
        XCTAssertEqual(anchor.takeCorrection(viewportTop: 3_000, viewportHeight: 600, preserving: true), 0)
    }

    func testGrowthBelowTheReaderDoesNotMoveThem() {
        var anchor = settledTranscript()
        anchor.note("latest", row(1_800, 5_000))
        XCTAssertEqual(anchor.takeCorrection(viewportTop: 300, viewportHeight: 600, preserving: true), 0)
    }

    func testTheLatestReplyStreamingUnderItsReaderDoesNotMoveThem() {
        var anchor = settledTranscript()
        anchor.note("latest", row(1_800, 3_400))
        XCTAssertEqual(anchor.takeCorrection(viewportTop: 2_400, viewportHeight: 600, preserving: true), 0)
    }

    func testAnchorIsTheTopmostRowInViewNotOneBelowAGrowingVisibleRow() {
        var anchor = settledTranscript()
        anchor.note("history-b", row(900, 2_100))
        anchor.note("latest", row(2_100, 3_300))
        XCTAssertEqual(anchor.takeCorrection(viewportTop: 800, viewportHeight: 1_200, preserving: true), 0,
                       "the reader's first visible row did not move")
    }

    func testRowRemovedAboveMovesTheReaderBackWithTheirContent() {
        var anchor = settledTranscript()
        anchor.remove("history-a")
        anchor.note("history-b", row(0, 900))
        anchor.note("latest", row(900, 2_100))
        XCTAssertEqual(anchor.takeCorrection(viewportTop: 2_400, viewportHeight: 600, preserving: true), -900)
    }

    func testFollowingLeavesTheOffsetToTheFollowPathButKeepsTheBaseline() {
        var anchor = settledTranscript()
        anchor.note("history-b", row(900, 3_200))
        anchor.note("latest", row(3_200, 4_400))
        XCTAssertEqual(anchor.takeCorrection(viewportTop: 2_400, viewportHeight: 600, preserving: false), 0)
        XCTAssertEqual(anchor.takeCorrection(viewportTop: 3_800, viewportHeight: 600, preserving: true), 0,
                       "growth absorbed while following is not corrected again later")
    }

    /// A SwiftUI row can report its new position before UIScrollView has its
    /// matching contentSize. The first bounded adjustment must not discard the
    /// remainder: no second row callback is required when UIKit catches up.
    @MainActor
    func testAnchorCorrectionSurvivesDelayedNativeContentSize() async {
        let scrollView = UIScrollView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.contentSize = CGSize(width: 390, height: 3_000)
        scrollView.contentOffset.y = 2_400
        let coordinator = ChatScrollAnchorCoordinator()
        defer { withExtendedLifetime(coordinator) {} }
        coordinator.scrollView = scrollView
        coordinator.note("latest", row(1_800, 3_000), preserving: { true })
        await settleAnchorLayout()

        coordinator.note("latest", row(3_200, 4_400), preserving: { true })
        await settleAnchorLayout()
        XCTAssertEqual(scrollView.contentOffset.y, 2_400, accuracy: 0.5,
                       "the correction must respect the currently available native extent")

        scrollView.contentSize.height = 4_400
        await settleAnchorLayout()
        XCTAssertEqual(scrollView.contentOffset.y, 3_800, accuracy: 0.5,
                       "the unapplied 1,400pt correction survives until UIKit can apply it")

        scrollView.contentSize.height = 4_500
        await settleAnchorLayout()
        XCTAssertEqual(scrollView.contentOffset.y, 3_800, accuracy: 0.5,
                       "a correction already applied is never repeated on another size update")
    }

    @MainActor
    func testAnchorCorrectionSurvivesPartiallyAvailableNativeExtent() async {
        let scrollView = UIScrollView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.contentSize = CGSize(width: 390, height: 3_000)
        scrollView.contentOffset.y = 2_400
        let coordinator = ChatScrollAnchorCoordinator()
        defer { withExtendedLifetime(coordinator) {} }
        coordinator.scrollView = scrollView
        coordinator.note("latest", row(1_800, 3_000), preserving: { true })
        await settleAnchorLayout()

        scrollView.contentSize.height = 3_200
        coordinator.note("latest", row(3_200, 4_400), preserving: { true })
        await settleAnchorLayout()
        XCTAssertEqual(scrollView.contentOffset.y, 2_600, accuracy: 0.5)

        // The reader moves another 100pt while UIKit is catching up. Apply
        // only the outstanding 1,200pt, preserving that intentional movement.
        scrollView.contentOffset.y = 2_500
        scrollView.contentSize.height = 4_400
        await settleAnchorLayout()
        XCTAssertEqual(scrollView.contentOffset.y, 3_700, accuracy: 0.5)
    }

    @MainActor
    func testFollowingLatestCancelsAnUnappliedAnchorCorrection() async {
        let scrollView = UIScrollView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.contentSize = CGSize(width: 390, height: 3_000)
        scrollView.contentOffset.y = 2_400
        let coordinator = ChatScrollAnchorCoordinator()
        defer { withExtendedLifetime(coordinator) {} }
        coordinator.scrollView = scrollView
        var preserving = true
        coordinator.note("latest", row(1_800, 3_000), preserving: { preserving })
        await settleAnchorLayout()
        coordinator.note("latest", row(3_200, 4_400), preserving: { preserving })
        await settleAnchorLayout()

        // A jump takes ownership even if no native size update occurs until
        // the reader has already started another gesture.
        preserving = false
        coordinator.cancelPendingCorrection()
        preserving = true
        scrollView.contentSize.height = 4_400
        await settleAnchorLayout()
        XCTAssertEqual(scrollView.contentOffset.y, 2_400, accuracy: 0.5,
                       "once following owns the offset, an old anchor cannot move it")
    }

    @MainActor
    func testAdditionalLayoutGrowthUsesThePendingAnchorPosition() async {
        let scrollView = UIScrollView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.contentSize = CGSize(width: 390, height: 3_000)
        scrollView.contentOffset.y = 2_400
        let coordinator = ChatScrollAnchorCoordinator()
        defer { withExtendedLifetime(coordinator) {} }
        coordinator.scrollView = scrollView
        coordinator.note("latest", row(1_800, 3_000), preserving: { true })
        await settleAnchorLayout()
        coordinator.note("latest", row(3_200, 4_400), preserving: { true })
        await settleAnchorLayout()

        // Another row realizes before UIKit has made room for the first
        // displacement. The same visible reply remains the anchor.
        coordinator.note("latest", row(3_800, 5_000), preserving: { true })
        await settleAnchorLayout()
        scrollView.contentSize.height = 5_000
        await settleAnchorLayout()
        XCTAssertEqual(scrollView.contentOffset.y, 4_400, accuracy: 0.5,
                       "both layout displacements apply once when the extent catches up")
    }

    @MainActor
    func testResetDropsCorrectionsFromThePreviousConversation() async {
        let scrollView = UIScrollView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.contentSize = CGSize(width: 390, height: 3_000)
        scrollView.contentOffset.y = 2_400
        let coordinator = ChatScrollAnchorCoordinator()
        defer { withExtendedLifetime(coordinator) {} }
        coordinator.scrollView = scrollView
        coordinator.note("latest", row(1_800, 3_000), preserving: { true })
        await settleAnchorLayout()
        coordinator.note("latest", row(3_200, 4_400), preserving: { true })
        await settleAnchorLayout()

        coordinator.reset()
        scrollView.contentSize.height = 4_400
        await settleAnchorLayout()
        XCTAssertEqual(scrollView.contentOffset.y, 2_400, accuracy: 0.5)
    }

    @MainActor
    private func settleAnchorLayout() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.main.async { continuation.resume() }
        }
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

    func testNewLatestRowDoesNotInheritPreviousRowsPendingRecovery() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "older", height: 9_000)
        recovery.update(geometry(height: 10_000, offset: 7_000))
        recovery.noteLatestRow(id: "older", height: 40)
        recovery.update(geometry(height: 500, offset: 7_000))
        XCTAssertTrue(recovery.hasPendingRecovery)
        recovery.noteLatestRow(id: "newer", height: 200)
        XCTAssertFalse(recovery.hasPendingRecovery, "an appended row starts a fresh baseline")
        recovery.update(geometry(height: 700, offset: 7_000))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testRemovedLatestMessageRecoversAnOffsetBeyondTheShorterTranscript() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "removed", height: 9_000)
        recovery.update(geometry(height: 10_000, offset: 7_000))
        recovery.noteRowsRemoved()
        recovery.noteLatestRow(id: "previous", height: 300)
        recovery.update(geometry(height: 1_000, offset: 7_000))
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false), "one correction per removal")
    }

    func testRemovalWithAValidOffsetDoesNotMoveTheReader() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "removed", height: 2_000)
        recovery.update(geometry(height: 10_000, offset: 1_000))
        recovery.noteRowsRemoved()
        recovery.noteLatestRow(id: "previous", height: 300)
        recovery.update(geometry(height: 8_300, offset: 1_000))
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

    // #5933: a reader following latest who is left beyond the end (for
    // example by an own send while scrolled past the last row) is clamped back
    // even though nothing shrank. Case 109's not-following reader is not.
    func testFollowingReaderBeyondTheEndRecoversWithoutShrinkEvidence() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "latest", height: 200)
        recovery.update(geometry(height: 2_000, offset: 1_400))
        recovery.noteFollowingLatest(true)
        XCTAssertFalse(recovery.hasPendingRecovery, "an in-range follower needs no correction")
        recovery.update(geometry(height: 2_000, offset: 1_900))
        XCTAssertTrue(recovery.hasPendingRecovery)
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false), "one correction per excursion")
    }

    func testResumingFollowWhileAlreadyBeyondTheEndRecovers() {
        var recovery = ChatViewportRecovery()
        recovery.noteLatestRow(id: "latest", height: 200)
        recovery.update(geometry(height: 900, offset: 700))
        XCTAssertFalse(recovery.hasPendingRecovery, "not following: never moved without shrink evidence")
        recovery.noteFollowingLatest(true)
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
    }

    func testShortTranscriptOffsetBeyondItsEndRecoversWhileFollowing() {
        // A short transcript cannot scroll: any offset past the top inset is
        // empty space below the conversation.
        var recovery = ChatViewportRecovery()
        recovery.noteFollowingLatest(true)
        recovery.noteLatestRow(id: "placeholder", height: 60)
        recovery.update(geometry(height: 300, offset: 400))
        XCTAssertTrue(recovery.takeRecovery(isUserScrolling: false))
    }

    func testFollowingNeverInterruptsAGesture() {
        var recovery = ChatViewportRecovery()
        recovery.noteFollowingLatest(true)
        recovery.noteLatestRow(id: "latest", height: 200)
        recovery.update(geometry(height: 2_000, offset: 1_900))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: true))
    }

    func testStoppingFollowDropsAFollowOnlyCorrection() {
        var recovery = ChatViewportRecovery()
        recovery.noteFollowingLatest(true)
        recovery.noteLatestRow(id: "latest", height: 200)
        recovery.update(geometry(height: 2_000, offset: 1_900))
        XCTAssertTrue(recovery.hasPendingRecovery)
        recovery.noteFollowingLatest(false)
        XCTAssertFalse(recovery.hasPendingRecovery, "a reader who scrolled away keeps their place")
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testLazyHistoryReestimationStillNeverPullsANonFollowingReader() {
        var recovery = ChatViewportRecovery()
        recovery.noteFollowingLatest(false)
        recovery.noteLatestRow(id: "latest", height: 1_200)
        recovery.update(geometry(height: 4_554, offset: 3_800))
        recovery.update(geometry(height: 4_323, offset: 3_800))
        XCTAssertFalse(recovery.takeRecovery(isUserScrolling: false))
    }

    func testOrdinaryScrollOffsetsDoNotInvalidateSwiftUIStateEveryFrame() {
        XCTAssertEqual(geometry(height: 10_000, offset: 100), geometry(height: 10_000, offset: 3_000))
    }
}

/// #5933: the own-send decision. A live send appends the user message and its
/// reply placeholders in one synchronous call, so the transcript's last
/// message is a placeholder by the time the view sees the change.
final class ChatOwnSendTests: XCTestCase {
    private func tail(_ messages: [DisplayMessage], thread: String = "t1") -> ChatTranscriptTail {
        ChatTranscriptTail(threadId: thread, count: messages.count, lastMessageId: messages.last?.id)
    }

    private let history = [
        DisplayMessage(id: "u0", role: .user, familiarId: nil, text: "earlier"),
        DisplayMessage(id: "a0", role: .assistant, familiarId: "nyx", text: "reply"),
    ]

    private var sentUser: DisplayMessage {
        DisplayMessage(id: "u1", role: .user, familiarId: nil, text: "new", queued: true,
                       queuedDispatchInFlight: true)
    }

    private var placeholder: DisplayMessage {
        DisplayMessage(id: "p1", role: .assistant, familiarId: "nyx", text: "", streaming: true)
    }

    func testLiveSendWithPlaceholderIsAnOwnSend() {
        let after = history + [sentUser, placeholder]
        XCTAssertTrue(ChatOwnSend.isOwnSend(from: tail(history), to: tail(after), messages: after))
    }

    func testGroupSendWithSeveralPlaceholdersIsAnOwnSend() {
        let second = DisplayMessage(id: "p2", role: .assistant, familiarId: "lyra", text: "", streaming: true)
        let after = history + [sentUser, placeholder, second]
        XCTAssertTrue(ChatOwnSend.isOwnSend(from: tail(history), to: tail(after), messages: after))
    }

    func testFirstSendInAnEmptyChatIsAnOwnSend() {
        let after = [sentUser, placeholder]
        XCTAssertTrue(ChatOwnSend.isOwnSend(from: tail([]), to: tail(after), messages: after))
    }

    func testOfflineQueuedSendIsAnOwnSend() {
        var queued = sentUser
        queued.queuedDispatchInFlight = nil
        let after = history + [queued]
        XCTAssertTrue(ChatOwnSend.isOwnSend(from: tail(history), to: tail(after), messages: after))
    }

    func testArrivingReplyIsNotAnOwnSend() {
        let before = history + [sentUser]
        let after = before + [DisplayMessage(id: "a1", role: .assistant, familiarId: "nyx", text: "hi")]
        XCTAssertFalse(ChatOwnSend.isOwnSend(from: tail(before), to: tail(after), messages: after))
    }

    func testSwitchingToALongerThreadIsNotAnOwnSend() {
        let other = history + [sentUser, placeholder]
        XCTAssertFalse(ChatOwnSend.isOwnSend(from: tail([], thread: "t1"),
                                             to: tail(other, thread: "t2"), messages: other))
    }

    func testRemovalIsNotAnOwnSend() {
        let before = history + [sentUser]
        XCTAssertFalse(ChatOwnSend.isOwnSend(from: tail(before), to: tail(history), messages: history))
    }

    func testReplayPlaceholderInsertedBeforeTheTailIsNotAnOwnSend() {
        // Reconnect replay inserts a reply after an older queued message; the
        // newest message is unchanged, so nothing was sent from the composer.
        let before = history + [sentUser, DisplayMessage(id: "u2", role: .user, familiarId: nil, text: "later")]
        var after = before
        after.insert(placeholder, at: 3)
        XCTAssertFalse(ChatOwnSend.isOwnSend(from: tail(before), to: tail(after), messages: after))
    }

    func testHistoryFromAnotherDeviceIsNotAnOwnSend() {
        // Pull to refresh can bring in turns sent elsewhere; their user
        // messages were never queued on this phone.
        let after = history + [DisplayMessage(id: "u9", role: .user, familiarId: nil, text: "from desk"),
                               DisplayMessage(id: "a9", role: .assistant, familiarId: "nyx", text: "ok")]
        XCTAssertFalse(ChatOwnSend.isOwnSend(from: tail(history), to: tail(after), messages: after))
    }
}

/// #5933: the floating day chip belongs to the reader's own scroll.
final class ChatDayChipPolicyTests: XCTestCase {
    func testOnlyAReadersScrollRevealsTheChip() {
        XCTAssertTrue(ChatDayChipPolicy.revealsChip(on: .tracking))
        XCTAssertTrue(ChatDayChipPolicy.revealsChip(on: .interacting))
        XCTAssertTrue(ChatDayChipPolicy.revealsChip(on: .decelerating))
        XCTAssertFalse(ChatDayChipPolicy.revealsChip(on: .animating), "a programmatic send-time scroll is not reading")
        XCTAssertFalse(ChatDayChipPolicy.revealsChip(on: .idle))
    }

    func testChipStaysHiddenWhileFollowingLatest() {
        XCTAssertTrue(ChatDayChipPolicy.showsChip(active: true, followingLatest: false))
        XCTAssertFalse(ChatDayChipPolicy.showsChip(active: true, followingLatest: true))
        XCTAssertFalse(ChatDayChipPolicy.showsChip(active: false, followingLatest: false))
    }
}
