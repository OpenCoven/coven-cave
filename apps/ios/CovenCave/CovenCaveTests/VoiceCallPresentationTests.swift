import XCTest
@testable import CovenCave

final class VoiceCallPresentationTests: XCTestCase {
    private func familiar(voiceProvider: String?) -> Familiar {
        var json: [String: Any] = ["id": "familiar", "display_name": "Nova"]
        if let voiceProvider { json["voiceProvider"] = voiceProvider }
        let data = try! JSONSerialization.data(withJSONObject: json)
        return try! JSONDecoder().decode(Familiar.self, from: data)
    }

    // MARK: - Transport selection

    func testPlannerSelectsRealtimeOnlyForOpenAIProvider() {
        XCTAssertEqual(VoiceTransportPlanner.plan(for: familiar(voiceProvider: "openai")), .realtime)
        XCTAssertEqual(VoiceTransportPlanner.plan(for: familiar(voiceProvider: "anthropic")), .native)
        XCTAssertEqual(VoiceTransportPlanner.plan(for: familiar(voiceProvider: nil)), .native)
    }

    func testFallbackDegradesRealtimeToOnDeviceAndNativeHasNoFallback() {
        XCTAssertEqual(VoiceTransportPlanner.fallback(after: .realtime), .native)
        XCTAssertNil(VoiceTransportPlanner.fallback(after: .native))
    }

    // MARK: - Phase → status copy

    func testConnectingCopyDiffersByTransport() {
        XCTAssertEqual(VoiceCallCopy.status(for: .connecting, mode: .realtime).label, "Connecting")
        XCTAssertEqual(VoiceCallCopy.status(for: .connecting, mode: .native).label, "Starting")
    }

    func testActivePhasesMapToTheirLabels() {
        XCTAssertEqual(VoiceCallCopy.status(for: .listening, mode: .native).label, "Listening")
        XCTAssertEqual(VoiceCallCopy.status(for: .processing, mode: .native).label, "Thinking")
        XCTAssertEqual(VoiceCallCopy.status(for: .speaking, mode: .realtime).label, "Speaking")
    }

    // MARK: - Error → recovery mapping

    func testDeniedPermissionsRouteToSettingsWithNoFallback() {
        let mic = VoiceCallCopy.error(for: "microphone_denied", mode: .realtime)
        XCTAssertEqual(mic.recovery, .openSettings)
        XCTAssertFalse(mic.offersOnDeviceFallback)

        let speech = VoiceCallCopy.error(for: "speech_recognition_denied", mode: .native)
        XCTAssertEqual(speech.recovery, .openSettings)
        XCTAssertFalse(speech.offersOnDeviceFallback)
    }

    func testRealtimeFailuresRetryAndOfferOnDeviceFallback() {
        for code in ["realtime_grant_missing", "realtime_signaling_failed_401",
                     "realtime_ice_5", "realtime_empty_sdp_answer",
                     "realtime_event_decode_failed"] {
            let copy = VoiceCallCopy.error(for: code, mode: .realtime)
            XCTAssertEqual(copy.recovery, .retry, code)
            XCTAssertTrue(copy.offersOnDeviceFallback, code)
        }
    }

    func testOnDeviceTransportFailuresRetryWithoutFallback() {
        for code in ["speech_recognizer_unavailable", "speech_audio_engine_failed",
                     "speech_recognition_failed", "voice_turn_send_failed"] {
            let copy = VoiceCallCopy.error(for: code, mode: .native)
            XCTAssertEqual(copy.recovery, .retry, code)
            XCTAssertFalse(copy.offersOnDeviceFallback, code)
        }
    }

    func testAudioInterruptionOffersFallbackOnlyWhenRealtime() {
        XCTAssertTrue(VoiceCallCopy.error(for: "audio_interrupted", mode: .realtime).offersOnDeviceFallback)
        XCTAssertFalse(VoiceCallCopy.error(for: "audio_interrupted", mode: .native).offersOnDeviceFallback)
    }

    func testUnknownErrorRetriesAndFallsBackOnlyForRealtime() {
        let realtime = VoiceCallCopy.error(for: "totally_unexpected", mode: .realtime)
        XCTAssertEqual(realtime.recovery, .retry)
        XCTAssertTrue(realtime.offersOnDeviceFallback)

        let native = VoiceCallCopy.error(for: "totally_unexpected", mode: .native)
        XCTAssertEqual(native.recovery, .retry)
        XCTAssertFalse(native.offersOnDeviceFallback)
    }

    // MARK: - Mint fallback offer

    func testMintFailureIsAFallbackOfferNotADeadError() {
        let copy = VoiceCallCopy.mintFailureFallback("no API key configured")
        XCTAssertEqual(copy.recovery, .retry)
        XCTAssertTrue(copy.offersOnDeviceFallback)
        XCTAssertTrue(copy.message.contains("no API key configured"))
    }

    func testMintFailureWithoutDetailStillExplainsAndOffersFallback() {
        let copy = VoiceCallCopy.mintFailureFallback(nil)
        XCTAssertTrue(copy.offersOnDeviceFallback)
        XCTAssertFalse(copy.message.isEmpty)
    }

    func testModeLabelsAreDistinct() {
        XCTAssertNotEqual(VoiceCallCopy.modeLabel(.realtime), VoiceCallCopy.modeLabel(.native))
    }
}
