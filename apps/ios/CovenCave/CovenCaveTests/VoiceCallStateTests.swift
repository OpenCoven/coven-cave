import XCTest
@testable import CovenCave

final class VoiceCallStateTests: XCTestCase {
    private func connectedState(mode: VoiceCallMode = .native) -> VoiceCallState {
        var state = VoiceCallState(mode: mode)
        state.send(.start)
        state.receive(.permissionGranted)
        state.receive(.connected)
        return state
    }

    func testProviderMetadataSelectsTheAppropriateCallMode() {
        XCTAssertEqual(VoiceCallMode.forVoiceProvider("openai"), .realtime)
        XCTAssertEqual(VoiceCallMode.forVoiceProvider("anthropic"), .native)
        XCTAssertEqual(VoiceCallMode.forVoiceProvider("local"), .native)
    }

    func testLifecycleReachesListeningAndMuteDoesNotChangeThePhase() {
        var state = VoiceCallState(mode: .native)

        state.send(.start)
        XCTAssertEqual(state.phase, .requestingPermission)
        state.receive(.permissionGranted)
        XCTAssertEqual(state.phase, .connecting)
        state.receive(.connected)
        XCTAssertEqual(state.phase, .listening)

        state.send(.setMuted(true))
        XCTAssertTrue(state.isMuted)
        XCTAssertEqual(state.phase, .listening)
        XCTAssertFalse(state.shouldCaptureAudio)
    }

    func testPartialTranscriptUpdatesOneInProgressRowAndFinalPromotesItOnce() {
        var state = connectedState()

        state.receive(.partial(role: .user, text: "Review", segmentID: "user-1", revision: 1))
        let partialID = state.transcript[0].id
        state.receive(.partial(role: .user, text: "Review this", segmentID: "user-1", revision: 2))
        state.receive(.final(role: .user, text: "Review this", segmentID: "user-1"))
        state.receive(.final(role: .user, text: "Review this branch", segmentID: "user-1"))

        XCTAssertEqual(state.transcript.count, 1)
        XCTAssertEqual(state.transcript[0].id, partialID)
        XCTAssertEqual(state.transcript[0].role, .user)
        XCTAssertEqual(state.transcript[0].text, "Review this")
        XCTAssertTrue(state.transcript[0].isFinal)
    }

    func testFinalTranscriptRetriesDeduplicateBySegmentID() {
        var state = connectedState(mode: .realtime)

        state.receive(.final(role: .user, text: "Hello", segmentID: "user-1"))
        state.receive(.final(role: .assistant, text: "Hi there", segmentID: "assistant-1"))
        state.receive(.final(role: .user, text: "Hello", segmentID: "user-1"))
        state.receive(.final(role: .assistant, text: "Hi there", segmentID: "assistant-1"))

        XCTAssertEqual(state.transcript.map(\.role), [.user, .assistant])
        XCTAssertEqual(state.transcript.map(\.text), ["Hello", "Hi there"])
        XCTAssertTrue(state.transcript.allSatisfy(\.isFinal))
    }

    func testIdenticalFinalUtterancesWithDifferentSegmentIDsRemainSeparate() {
        var state = connectedState()

        state.receive(.final(role: .user, text: "Yes", segmentID: "user-1"))
        state.receive(.final(role: .user, text: "Yes", segmentID: "user-2"))

        XCTAssertEqual(state.transcript.map(\.text), ["Yes", "Yes"])
        XCTAssertEqual(state.transcript.map(\.segmentID), ["user-1", "user-2"])
    }

    func testOlderPartialRevisionCannotOverwriteNewerPartial() {
        var state = connectedState()

        state.receive(.partial(role: .user, text: "Review", segmentID: "user-1", revision: 1))
        state.receive(.partial(role: .user, text: "Review this", segmentID: "user-1", revision: 2))
        state.receive(.partial(role: .user, text: "Review", segmentID: "user-1", revision: 1))

        XCTAssertEqual(state.transcript[0].text, "Review this")
        XCTAssertEqual(state.transcript[0].partialRevision, 2)
    }

    func testTranscriptRowIDsAreDeterministicForIdenticalEventStreams() {
        var first = connectedState()
        var second = connectedState()

        first.receive(.partial(role: .assistant, text: "I can", segmentID: "assistant-1", revision: 1))
        first.receive(.final(role: .assistant, text: "I can help.", segmentID: "assistant-1"))
        second.receive(.partial(role: .assistant, text: "I can", segmentID: "assistant-1", revision: 1))
        second.receive(.final(role: .assistant, text: "I can help.", segmentID: "assistant-1"))

        XCTAssertEqual(first.transcript, second.transcript)
        XCTAssertEqual(first.transcript[0].id, "assistant::assistant-1")
    }

    func testSameSegmentIDForDifferentRolesCreatesIndependentRows() {
        var state = connectedState(mode: .realtime)

        state.receive(.partial(role: .user, text: "Yes", segmentID: "0", revision: 1))
        state.receive(.partial(role: .assistant, text: "Right", segmentID: "0", revision: 1))
        state.receive(.final(role: .user, text: "Yes.", segmentID: "0"))
        state.receive(.final(role: .assistant, text: "Right.", segmentID: "0"))

        XCTAssertEqual(state.transcript.map(\.id), ["user::0", "assistant::0"])
        XCTAssertEqual(state.transcript.map(\.text), ["Yes.", "Right."])
        XCTAssertTrue(state.transcript.allSatisfy(\.isFinal))
    }

    func testTranscriptExpansionIsIndependentFromTheCallLifecycle() {
        var state = connectedState()

        state.send(.setTranscriptExpanded(true))
        state.send(.end)

        XCTAssertTrue(state.isTranscriptExpanded)
        XCTAssertEqual(state.phase, .ended)

        state.send(.setTranscriptExpanded(false))
        XCTAssertFalse(state.isTranscriptExpanded)
        XCTAssertEqual(state.phase, .ended)
    }

    func testLateCallbacksAfterEndCannotResurrectTheCallOrTranscript() {
        var state = connectedState()
        state.receive(.final(role: .user, text: "Keep this", segmentID: "user-1"))
        state.send(.end)

        state.receive(.connected)
        state.receive(.partial(role: .assistant, text: "Ignore", segmentID: "assistant-1", revision: 1))
        state.receive(.final(role: .assistant, text: "Ignore", segmentID: "assistant-1"))
        state.receive(.failed("late failure"))

        XCTAssertEqual(state.phase, .ended)
        XCTAssertFalse(state.isAudioActive)
        XCTAssertEqual(state.transcript.map(\.text), ["Keep this"])
    }

    func testFailureIsTerminalAndPreventsFurtherAudioTransitions() {
        var state = connectedState()

        state.receive(.failed("network unavailable"))
        state.receive(.listening)
        state.receive(.speaking)

        XCTAssertEqual(state.phase, .error("network unavailable"))
        XCTAssertFalse(state.isAudioActive)
    }

    func testPermissionDenialTerminatesWithoutStartingAudio() {
        var state = VoiceCallState(mode: .native)
        state.send(.start)

        state.receive(.permissionDenied)
        state.receive(.connected)

        XCTAssertEqual(state.phase, .error("microphone_denied"))
        XCTAssertFalse(state.isAudioActive)
        XCTAssertFalse(state.shouldCaptureAudio)
    }

    func testStalePermissionDenialAfterConnectionIsIgnored() {
        var state = connectedState()

        state.receive(.permissionDenied)

        XCTAssertEqual(state.phase, .listening)
        XCTAssertTrue(state.shouldCaptureAudio)
    }

    func testStaleTransportFailureWhileIdleIsIgnored() {
        var state = VoiceCallState(mode: .native)

        state.receive(.failed("late failure"))

        XCTAssertEqual(state.phase, .idle)
        XCTAssertFalse(state.isAudioActive)
    }
}
