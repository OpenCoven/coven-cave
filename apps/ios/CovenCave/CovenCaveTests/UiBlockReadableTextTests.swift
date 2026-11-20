import XCTest
@testable import CovenCave

/// The readable coven:ui projection (#6060) is desktop's TypeScript one,
/// bundled into Resources/ui-block-readable.js. The cases are
/// src/lib/ui-block-fallback-fixtures.ts, mirrored into
/// Fixtures/ui-block-fallback-v1.json; a TypeScript test keeps them equal.
final class UiBlockReadableTextTests: XCTestCase {
    struct Case: Decodable {
        let id: String
        let kind: String
        let input: String
        let readable: String
    }

    static func corpus() throws -> [Case] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ui-block-fallback-v1", withExtension: "json"))
        return try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
    }

    func testTheBundledProjectionLoads() {
        XCTAssertTrue(UiBlockReadableText.isAvailable,
                      "Resources/ui-block-readable.js is missing or broken, so Copy would hand back raw markup")
    }

    func testEveryCorpusCaseCopiesAsDesktopDoes() throws {
        let cases = try Self.corpus()
        XCTAssertGreaterThanOrEqual(cases.count, 20)
        for item in cases {
            XCTAssertEqual(UiBlockReadableText.project(item.input), item.readable, item.id)
        }
    }

    func testCopyTextIsTheReadableProjectionOfWhatTheBubbleShows() {
        let projection = AssistantResponseProjection.parse("Here.\n\n```coven:ui\n<Badge>Hi</Badge>\n```\n\nMore")
        XCTAssertTrue(projection.visible.contains("```coven:ui"), "the markdown page projects the block itself")
        XCTAssertEqual(projection.copyText, "Here.\n\nHi\n\nMore")
    }

    func testTextWithoutALiveBlockIsUntouched() {
        for text in ["No blocks here.", "A `coven:ui` mention inline only."] {
            XCTAssertEqual(UiBlockReadableText.project(text), text)
        }
    }

    func testAnUnterminatedBlockIsHeldBackWhileStreaming() {
        let text = "Drafting:\n\n```coven:ui\n<Card title=\"Draft\">"
        XCTAssertEqual(UiBlockReadableText.project(text, streaming: true), "Drafting:\n\n")
        XCTAssertEqual(UiBlockReadableText.project(text), "Drafting:\n\nDraft\n(This block ended early.)")
    }
}
