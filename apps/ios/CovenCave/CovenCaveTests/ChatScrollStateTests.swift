import SwiftUI
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
