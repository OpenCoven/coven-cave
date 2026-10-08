import XCTest
@testable import CovenCave

/// Transcript polish (#5881): folded repeat steps and compact system notices.
final class TranscriptPolishTests: XCTestCase {
    private func tool(_ id: String, _ title: String = "Bash", detail: String? = "npm test",
                      status: ActivityStep.Status = .ok) -> ChatTimelineEntry {
        .tool(ActivityStep(id: id, kind: .tool, title: title, detail: detail, status: status))
    }

    private func shape(_ entries: [ChatTimelineDisplayEntry]) -> [String] {
        entries.map {
            switch $0 {
            case .text(let id, _): "text:\(id)"
            case .tools(let steps): "tools:\(steps.map(\.id).joined(separator: "+"))"
            case .reasoning(let block): "reasoning:\(block.id)"
            }
        }
    }

    func testIdenticalBackToBackStepsFoldIntoOneRow() {
        let folded = ChatActivityTimeline.collapsingRepeats([tool("a"), tool("b"), tool("c")])
        XCTAssertEqual(shape(folded), ["tools:a+b+c"])
    }

    func testProseBetweenStepsKeepsThemApart() {
        let folded = ChatActivityTimeline.collapsingRepeats([
            tool("a"), .text(id: "prose:a", text: "checking again"), tool("b"),
        ])
        XCTAssertEqual(shape(folded), ["tools:a", "text:prose:a", "tools:b"])
    }

    func testADifferentTitleDetailOrOutcomeStartsANewRow() {
        let folded = ChatActivityTimeline.collapsingRepeats([
            tool("a"), tool("b", "Read"), tool("c", "Read", detail: "src/app.ts"),
            tool("d", "Read", detail: "src/app.ts", status: .error), tool("e", "Read", detail: "src/app.ts", status: .error),
        ])
        XCTAssertEqual(shape(folded), ["tools:a", "tools:b", "tools:c", "tools:d+e"],
                       "only exact repeats fold; failures fold with failures")
    }

    func testLiveStepsNeverFold() {
        let folded = ChatActivityTimeline.collapsingRepeats([
            tool("a"), tool("b", status: .running), tool("c", status: .running),
        ])
        XCTAssertEqual(shape(folded), ["tools:a", "tools:b", "tools:c"], "a running step stays its own row")
    }

    func testMissingAndEmptyDetailCountAsTheSame() {
        let folded = ChatActivityTimeline.collapsingRepeats([tool("a", detail: nil), tool("b", detail: "")])
        XCTAssertEqual(shape(folded), ["tools:a+b"])
    }

    func testDisplayIdsStayStableAsRepeatsAccumulate() {
        let one = ChatActivityTimeline.collapsingRepeats([tool("a")])
        let three = ChatActivityTimeline.collapsingRepeats([tool("a"), tool("b"), tool("c")])
        XCTAssertEqual(one.first?.id, three.first?.id, "the folded row keeps its first step's identity")
    }

    // MARK: System notes

    func testShortOneLineNotesAreNotices() {
        XCTAssertEqual(SystemNoteStyle.style(for: "Model set to Opus 5.5.", hasAction: false), .notice)
        XCTAssertEqual(SystemNoteStyle.style(for: "No skill matches “x”. Type /skill to pick one.", hasAction: false), .notice)
        XCTAssertEqual(SystemNoteStyle.style(for: "  Transcript cleared  \n", hasAction: false), .notice,
                       "surrounding whitespace doesn't make a note multi-line")
    }

    func testCommandOutputAndActionsKeepTheCard() {
        XCTAssertEqual(SystemNoteStyle.style(for: "$ coven doctor\nrunning…", hasAction: false), .card)
        XCTAssertEqual(SystemNoteStyle.style(for: "Deleted 1 of 2 copies.", hasAction: true), .card,
                       "a note with a Retry button stays a card")
        XCTAssertEqual(SystemNoteStyle.style(for: String(repeating: "x", count: SystemNoteStyle.noticeMaxLength + 1),
                                             hasAction: false), .card)
        XCTAssertEqual(SystemNoteStyle.style(for: "   ", hasAction: false), .card)
    }
}
