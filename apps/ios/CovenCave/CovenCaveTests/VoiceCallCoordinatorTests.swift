import XCTest
@testable import CovenCave

@MainActor
final class VoiceCallCoordinatorTests: XCTestCase {
    private let context = VoiceCallTransportContext(familiarId: "familiar", sessionId: "session", grant: nil)
    func testEndStopsMediaAndTransportOnceAndRejectsLateTransportCallbacks() async {
        let media = FakeVoiceMediaSession()
        let transport = FakeVoiceTransport()
        let coordinator = VoiceCallCoordinator(
            mode: .realtime, transport: transport, mediaSession: media, context: context
        )

        await coordinator.start()
        XCTAssertEqual(media.prepareCalls.count, 1)
        XCTAssertEqual(media.prepareCalls[0].0, .realtime)
        XCTAssertFalse(media.prepareCalls[0].1)
        XCTAssertEqual(transport.startCalls, 1)

        transport.emit(.connected)
        XCTAssertEqual(coordinator.state.phase, .listening)

        coordinator.end()
        coordinator.end()
        transport.emit(.partial(role: .assistant, text: "late", segmentID: "a-1", revision: 1))

        XCTAssertEqual(coordinator.state.phase, .ended)
        XCTAssertTrue(coordinator.state.transcript.isEmpty)
        XCTAssertEqual(transport.stopCalls, 1)
        XCTAssertEqual(media.stopCalls, 1)
    }

    func testTransportFailureCleansUpOnceAndCannotBeRevivedByLaterCallbacks() async {
        let media = FakeVoiceMediaSession()
        let transport = FakeVoiceTransport()
        let coordinator = VoiceCallCoordinator(
            mode: .native, transport: transport, mediaSession: media, context: context
        )

        await coordinator.start()
        transport.emit(.connected)
        transport.emit(.failed("network unavailable"))
        transport.emit(.listening)

        XCTAssertEqual(coordinator.state.phase, .error("network unavailable"))
        XCTAssertEqual(transport.stopCalls, 1)
        XCTAssertEqual(media.stopCalls, 1)
    }

    func testSetupFailureBeforeConnectionIsTerminalAndCleansUp() async {
        let media = FakeVoiceMediaSession()
        media.prepareError = VoiceCallMediaError.speechRecognitionDenied
        let transport = FakeVoiceTransport()
        let coordinator = VoiceCallCoordinator(
            mode: .native, transport: transport, mediaSession: media, context: context
        )

        await coordinator.start()

        XCTAssertEqual(coordinator.state.phase, .error("speech_recognition_denied"))
        XCTAssertEqual(transport.startCalls, 0)
        XCTAssertEqual(transport.stopCalls, 1)
        XCTAssertEqual(media.stopCalls, 1)
    }

    func testEndDuringPermissionWaitDeactivatesAudioPreparedAfterTheCallEnds() async {
        let media = FakeVoiceMediaSession()
        media.suspendsPreparation = true
        let transport = FakeVoiceTransport()
        let coordinator = VoiceCallCoordinator(
            mode: .native, transport: transport, mediaSession: media, context: context
        )
        media.onPreparationWait = {
            coordinator.end()
            media.finishPreparationWithActiveAudio()
        }

        await coordinator.start()

        XCTAssertEqual(coordinator.state.phase, .ended)
        XCTAssertFalse(media.isAudioActive)
        XCTAssertEqual(media.stopCalls, 2)
        XCTAssertEqual(transport.startCalls, 0)
    }
}

@MainActor
private final class FakeVoiceTransport: VoiceCallTransport {
    var onEvent: (@MainActor (VoiceCallEvent) -> Void)?
    private(set) var startCalls = 0
    private(set) var stopCalls = 0

    func start(with context: VoiceCallTransportContext) async throws {
        startCalls += 1
    }

    func setMuted(_ muted: Bool) {}

    func stop() {
        stopCalls += 1
    }

    func emit(_ event: VoiceCallEvent) {
        onEvent?(event)
    }
}

@MainActor
private final class FakeVoiceMediaSession: VoiceMediaSessionManaging {
    var onInterruption: (@MainActor () -> Void)?
    var onRouteChange: (@MainActor () -> Void)?
    private(set) var prepareCalls: [(VoiceCallMode, Bool)] = []
    private(set) var stopCalls = 0
    var prepareError: Error?
    var suspendsPreparation = false
    private var prepareContinuation: CheckedContinuation<Void, Never>?
    private(set) var isAudioActive = false
    var onPreparationWait: (() -> Void)?

    func prepare(mode: VoiceCallMode, needsSpeechRecognition: Bool) async throws {
        prepareCalls.append((mode, needsSpeechRecognition))
        if let prepareError { throw prepareError }
        if suspendsPreparation {
            await withCheckedContinuation {
                prepareContinuation = $0
                onPreparationWait?()
            }
        }
    }

    func finishPreparationWithActiveAudio() {
        isAudioActive = true
        let continuation = prepareContinuation
        prepareContinuation = nil
        continuation?.resume()
    }

    func stop() {
        stopCalls += 1
        isAudioActive = false
    }
}
