import XCTest
@testable import CovenCave

/// The one suggestion menu's model (#5879).
final class ComposerSuggestionListTests: XCTestCase {
    private func command(_ token: String) -> SlashCommand { SlashCatalog.command(for: token)! }
    private let nyx = Familiar(id: "nyx", displayName: "Nyx", role: "Code familiar")
    private let sage = Familiar(id: "sage", displayName: "Sage", role: nil)

    func testCommandRowsAreMonospacedWithTheirArgumentHint() throws {
        let list = try XCTUnwrap(ComposerSuggestionList.make(
            intent: .commands(prefix: "/mo"), commands: [command("/model")], argumentRows: [], mentions: []))
        let row = try XCTUnwrap(list.items.first)
        XCTAssertEqual(row.title, "/model")
        XCTAssertEqual(row.detail, "model")
        XCTAssertTrue(row.monospaced)
        XCTAssertEqual(row.kind, .command(command("/model")))
        XCTAssertEqual(list.footer, "Tap to run · type to filter")
        XCTAssertNil(list.command)
    }

    func testArgumentRowsNameTheirCommandAndSayWhatATapDoes() throws {
        let familiarRow = ComposerArgumentRow(id: "nyx", title: "Nyx", subtitle: "Code familiar", value: "nyx", familiar: nyx)
        let familiars = try XCTUnwrap(ComposerSuggestionList.make(
            intent: .argument(command("/familiar"), partial: ""), commands: [], argumentRows: [familiarRow], mentions: []))
        XCTAssertEqual(familiars.command, command("/familiar"))
        XCTAssertEqual(familiars.footer, "Tap to run · type to filter")
        XCTAssertEqual(familiars.items.first?.familiar, nyx)
        XCTAssertFalse(familiars.items.first!.monospaced)

        let promptRow = ComposerArgumentRow(id: "standup", title: "Standup update", subtitle: nil, value: "standup")
        let prompts = try XCTUnwrap(ComposerSuggestionList.make(
            intent: .argument(command("/prompt"), partial: "st"), commands: [], argumentRows: [promptRow], mentions: []))
        XCTAssertEqual(prompts.footer, "Tap to insert · type to filter", "a prompt inserts, it doesn't run")
    }

    func testMentionRowsCarryTheAtSign() throws {
        let list = try XCTUnwrap(ComposerSuggestionList.make(
            intent: .mention(partial: ""), commands: [], argumentRows: [], mentions: [nyx, sage]))
        XCTAssertEqual(list.items.map(\.title), ["@Nyx", "@Sage"])
        XCTAssertEqual(list.items.first?.subtitle, "Code familiar")
        XCTAssertEqual(list.footer, "Tap to mention · type to filter")
    }

    func testNothingToSuggestIsNoMenu() {
        XCTAssertNil(ComposerSuggestionList.make(intent: .none, commands: [command("/help")], argumentRows: [], mentions: [nyx]))
        XCTAssertNil(ComposerSuggestionList.make(intent: .commands(prefix: "/zz"), commands: [], argumentRows: [], mentions: []))
        XCTAssertNil(ComposerSuggestionList.make(intent: .argument(command("/skill"), partial: "zz"),
                                                 commands: [], argumentRows: [], mentions: []))
        XCTAssertNil(ComposerSuggestionList.make(intent: .mention(partial: "zz"), commands: [], argumentRows: [], mentions: []))
    }

    func testItemIdsAreUniqueAcrossKinds() throws {
        let row = ComposerArgumentRow(id: "nyx", title: "Nyx", value: "nyx")
        let argument = try XCTUnwrap(ComposerSuggestionList.make(
            intent: .argument(command("/familiar"), partial: ""), commands: [], argumentRows: [row], mentions: []))
        let mention = try XCTUnwrap(ComposerSuggestionList.make(
            intent: .mention(partial: ""), commands: [], argumentRows: [], mentions: [nyx]))
        XCTAssertNotEqual(argument.items.first?.id, mention.items.first?.id)
    }

    func testSelectionWrapsAndClamps() {
        XCTAssertEqual(SuggestionSelection.move(0, by: 1, count: 3), 1)
        XCTAssertEqual(SuggestionSelection.move(2, by: 1, count: 3), 0, "↓ from the last row wraps to the first")
        XCTAssertEqual(SuggestionSelection.move(0, by: -1, count: 3), 2, "↑ from the first row wraps to the last")
        XCTAssertEqual(SuggestionSelection.move(7, by: 1, count: 3), 0, "a stale index is clamped before moving")
        XCTAssertEqual(SuggestionSelection.move(0, by: 1, count: 0), 0)
        XCTAssertEqual(SuggestionSelection.clamp(5, count: 2), 1)
        XCTAssertEqual(SuggestionSelection.clamp(-1, count: 2), 0)
    }
}
