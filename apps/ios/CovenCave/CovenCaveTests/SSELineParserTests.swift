import XCTest
@testable import CovenCave

/// SSELineParser is the shared frame decoder for the send stream AND the
/// mid-turn resume stream (cave-h40l). Its `lastEventId` is the resume
/// cursor, so exact-once semantics across a drop hang on these behaviors.
final class SSELineParserTests: XCTestCase {
    func testSingleDataLineDecodesImmediately() {
        var parser = SSELineParser()
        let event = parser.consume(#"data: {"kind":"assistant_chunk","text":"hi"}"#)
        guard case .assistantChunk(let text)? = event else {
            return XCTFail("expected assistant_chunk, got \(String(describing: event))")
        }
        XCTAssertEqual(text, "hi")
    }

    func testIdLineSetsResumeCursorBeforeItsEvent() {
        var parser = SSELineParser()
        XCTAssertNil(parser.consume("id: 7"))
        XCTAssertEqual(parser.lastEventId, 7)
        let event = parser.consume(#"data: {"kind":"assistant_chunk","text":"x"}"#)
        XCTAssertNotNil(event)
        // The frame's cursor is the id the server sent WITH it — a consumer
        // that stores lastEventId after applying the event resumes exactly
        // after this frame, never skipping or doubling it.
        XCTAssertEqual(parser.lastEventId, 7)
    }

    func testEventsWithoutIdsLeaveCursorNil() {
        var parser = SSELineParser()
        _ = parser.consume(#"data: {"kind":"user","text":"hello"}"#)
        XCTAssertNil(parser.lastEventId, "no id: line means no resume cursor — resume starts from 0")
    }

    func testKeepAliveCommentsAndUnknownFieldsAreIgnored() {
        var parser = SSELineParser()
        XCTAssertNil(parser.consume(": hb"))
        XCTAssertNil(parser.consume("event: message"))
        XCTAssertNil(parser.consume("retry: 500"))
        XCTAssertNil(parser.consume(""))
        XCTAssertNil(parser.lastEventId)
    }

    func testMalformedIdIsIgnoredNotAdopted() {
        var parser = SSELineParser()
        XCTAssertNil(parser.consume("id: not-a-number"))
        XCTAssertNil(parser.lastEventId)
        _ = parser.consume("id: 3")
        XCTAssertEqual(parser.lastEventId, 3)
    }

    func testTrailingFrameWithoutBlankLineFlushes() {
        var parser = SSELineParser()
        // A first data line that fails immediate decode is buffered…
        XCTAssertNil(parser.consume("data: {\"kind\":"))
        // …joined by a continuation, and recovered by the end-of-stream flush.
        XCTAssertNil(parser.consume(#"data: "done"}"#))
        let event = parser.flush()
        guard case .done? = event else {
            return XCTFail("expected done from multi-line flush, got \(String(describing: event))")
        }
        XCTAssertNil(parser.flush(), "flush drains the buffer")
    }

    func testBlankLineBoundaryFlushesBufferedFrame() {
        var parser = SSELineParser()
        XCTAssertNil(parser.consume("data: {\"kind\":"))
        XCTAssertNil(parser.consume(#"data: "error","message":"boom"}"#))
        let event = parser.consume("")
        guard case .error(let message)? = event else {
            return XCTFail("expected error frame at boundary, got \(String(describing: event))")
        }
        XCTAssertEqual(message, "boom")
    }

    func testCursorAdvancesAcrossFrames() {
        var parser = SSELineParser()
        _ = parser.consume("id: 1")
        _ = parser.consume(#"data: {"kind":"user","text":"q"}"#)
        _ = parser.consume("id: 2")
        let second = parser.consume(#"data: {"kind":"assistant_chunk","text":"a"}"#)
        XCTAssertNotNil(second)
        XCTAssertEqual(parser.lastEventId, 2)
    }
}
