import XCTest
@testable import CovenCave

final class OpenAIRealtimeEventDecoderTests: XCTestCase {
    func testDecoderAccumulatesIncrementalDeltasPerSegmentAndClearsAfterFinal() throws {
        var decoder = OpenAIRealtimeEventDecoder()

        XCTAssertEqual(
            try decoder.decode(json: #"{"type":"conversation.item.input_audio_transcription.delta","item_id":"user-42","delta":"Hello"}"#),
            .partial(role: .user, text: "Hello", segmentID: "user-42", revision: 1)
        )
        XCTAssertEqual(
            try decoder.decode(json: #"{"type":"conversation.item.input_audio_transcription.delta","item_id":"user-42","delta":" world"}"#),
            .partial(role: .user, text: "Hello world", segmentID: "user-42", revision: 2)
        )
        XCTAssertEqual(
            try decoder.decode(json: #"{"type":"conversation.item.input_audio_transcription.completed","item_id":"user-42","transcript":"Hello Coven"}"#),
            .final(role: .user, text: "Hello Coven", segmentID: "user-42")
        )
        XCTAssertEqual(
            try decoder.decode(json: #"{"type":"response.output_audio_transcript.delta","item_id":"assistant-9","delta":"Hi"}"#),
            .partial(role: .assistant, text: "Hi", segmentID: "assistant-9", revision: 1)
        )
        XCTAssertEqual(
            try decoder.decode(json: #"{"type":"response.output_audio_transcript.done","item_id":"assistant-9","transcript":"Hi there"}"#),
            .final(role: .assistant, text: "Hi there", segmentID: "assistant-9")
        )
        XCTAssertEqual(
            try decoder.decode(json: #"{"type":"response.output_audio_transcript.delta","item_id":"assistant-9","delta":"Fresh"}"#),
            .partial(role: .assistant, text: "Fresh", segmentID: "assistant-9", revision: 1)
        )
    }

    func testDecoderIgnoresUnrelatedEventsAndRejectsMissingCorrelation() throws {
        var decoder = OpenAIRealtimeEventDecoder()

        XCTAssertNil(try decoder.decode(json: #"{"type":"response.audio.delta","delta":"..."}"#))
        XCTAssertNil(try decoder.decode(json: #"{"type":"response.output_audio_transcript.delta","delta":"missing item"}"#))
    }
}
