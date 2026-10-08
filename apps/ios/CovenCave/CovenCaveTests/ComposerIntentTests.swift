import XCTest
@testable import CovenCave

final class ComposerIntentTests: XCTestCase {
    private func command(_ token: String) -> SlashCommand {
        guard let command = SlashCatalog.command(for: token) else {
            XCTFail("Expected \(token) in the catalog"); fatalError()
        }
        return command
    }

    // MARK: Command list

    func testBareSlashAndPartialTokenStayInTheCommandList() {
        XCTAssertEqual(ComposerIntent.detect("/", allowsMentions: false), .commands(prefix: "/"))
        XCTAssertEqual(ComposerIntent.detect("/mo", allowsMentions: false), .commands(prefix: "/mo"))
        // Bare `/skill` must keep listing both `/skill` and `/skills` — the
        // picker only opens after a space, as on the desktop.
        XCTAssertEqual(ComposerIntent.detect("/skill", allowsMentions: true), .commands(prefix: "/skill"))
    }

    func testProseAndEmptyDraftsHaveNoIntent() {
        XCTAssertEqual(ComposerIntent.detect("", allowsMentions: true), .none)
        XCTAssertEqual(ComposerIntent.detect("hello there", allowsMentions: true), .none)
        XCTAssertEqual(ComposerIntent.detect("email me at a@b.c", allowsMentions: true), .none)
    }

    // MARK: Argument pickers

    func testSpaceAfterModelOpensTheModelArgumentPicker() {
        XCTAssertEqual(ComposerIntent.detect("/model ", allowsMentions: false),
                       .argument(command("/model"), partial: ""))
        XCTAssertEqual(ComposerIntent.detect("/model op", allowsMentions: false),
                       .argument(command("/model"), partial: "op"))
        XCTAssertEqual(ComposerIntent.detect("/model   opus ", allowsMentions: false),
                       .argument(command("/model"), partial: "opus"))
    }

    func testAliasesResolveToTheSameArgumentPicker() {
        XCTAssertEqual(ComposerIntent.detect("/m op", allowsMentions: false),
                       .argument(command("/model"), partial: "op"))
        XCTAssertEqual(ComposerIntent.detect("/agent no", allowsMentions: false),
                       .argument(command("/familiar"), partial: "no"))
    }

    func testFamiliarArgumentPickerIsNativeAndCaseInsensitive() {
        XCTAssertEqual(ComposerIntent.detect("/Familiar No", allowsMentions: false),
                       .argument(command("/familiar"), partial: "No"))
    }

    func testDesktopOnlyCommandsNeverOpenAnArgumentPicker() {
        // `/skill` and `/prompt` declare pickers for the follow-up, but stay
        // desktop-only until the phone can fetch their rows.
        XCTAssertEqual(command("/skill").argCompletion, .skill)
        XCTAssertEqual(command("/prompt").argCompletion, .prompt)
        XCTAssertEqual(ComposerIntent.detect("/skill co", allowsMentions: false), .none)
        XCTAssertEqual(ComposerIntent.detect("/prompt st", allowsMentions: false), .none)
        XCTAssertEqual(ComposerIntent.detect("/board x", allowsMentions: false), .none)
    }

    func testFreeTextArgumentsAndUnknownCommandsHaveNoPicker() {
        XCTAssertEqual(command("/run").argCompletion, .none)
        XCTAssertEqual(ComposerIntent.detect("/run tell me", allowsMentions: false), .none)
        XCTAssertEqual(ComposerIntent.detect("/nope arg", allowsMentions: false), .none)
    }

    func testMultiLineDraftsAreProseNotArgumentLookups() {
        XCTAssertEqual(ComposerIntent.detect("/model opus\nsecond line", allowsMentions: false), .none)
        XCTAssertEqual(ComposerIntent.detect("/model\nopus", allowsMentions: false), .none)
    }

    // MARK: Mentions

    func testTrailingMentionOnlyWhenAllowed() {
        XCTAssertEqual(ComposerIntent.detect("@", allowsMentions: true), .mention(partial: ""))
        XCTAssertEqual(ComposerIntent.detect("hey @no", allowsMentions: true), .mention(partial: "no"))
        XCTAssertEqual(ComposerIntent.detect("hey @no", allowsMentions: false), .none)
        XCTAssertEqual(ComposerIntent.detect("hey @nova ", allowsMentions: true), .none)
    }

    func testFreeTextCommandStillCompletesAMidSentenceMention() {
        XCTAssertEqual(ComposerIntent.detect("/run ask @sa", allowsMentions: true), .mention(partial: "sa"))
    }

    func testArgumentPickerWinsOverAMentionInsideTheArgument() {
        XCTAssertEqual(ComposerIntent.detect("/familiar @no", allowsMentions: true),
                       .argument(command("/familiar"), partial: "@no"))
    }

    // MARK: Rows

    private let roster = [
        Familiar(id: "nova", displayName: "Nova", role: "Orchestrator"),
        Familiar(id: "cody", displayName: "Cody", role: "Code"),
        Familiar(id: "sage", displayName: "Sage", role: nil),
    ]
    private let models = [
        ChatModelOption(id: "claude-opus-5-5", label: "Opus 5.5"),
        ChatModelOption(id: "claude-sonnet-5", label: "Sonnet 5"),
        ChatModelOption(id: "gpt-6", label: "gpt-6"),
    ]

    func testFamiliarRowsFilterByNameOrIdAndCarryTheIdAsValue() {
        let all = ComposerArgumentRows.rows(for: command("/familiar"), partial: "",
                                            familiars: roster, models: models)
        XCTAssertEqual(all.map(\.id), ["nova", "cody", "sage"])
        XCTAssertEqual(all.first?.value, "nova")
        XCTAssertEqual(all.first?.subtitle, "Orchestrator")
        XCTAssertNotNil(all.first?.familiar)

        let co = ComposerArgumentRows.rows(for: command("/familiar"), partial: "CO",
                                           familiars: roster, models: models)
        XCTAssertEqual(co.map(\.id), ["cody"])
    }

    func testModelRowsFilterByLabelOrIdAndHideARedundantSubtitle() {
        let opus = ComposerArgumentRows.rows(for: command("/model"), partial: "opus",
                                             familiars: roster, models: models)
        XCTAssertEqual(opus.map(\.value), ["claude-opus-5-5"])
        XCTAssertEqual(opus.first?.title, "Opus 5.5")
        XCTAssertEqual(opus.first?.subtitle, "claude-opus-5-5")
        XCTAssertNil(opus.first?.familiar)

        let gpt = ComposerArgumentRows.rows(for: command("/model"), partial: "gpt",
                                            familiars: roster, models: models)
        XCTAssertNil(gpt.first?.subtitle, "a label equal to the id should not repeat it")
    }

    func testPickersWithoutRowsYieldNothing() {
        XCTAssertTrue(ComposerArgumentRows.rows(for: command("/skill"), partial: "",
                                                familiars: roster, models: models).isEmpty)
        XCTAssertTrue(ComposerArgumentRows.rows(for: command("/run"), partial: "",
                                                familiars: roster, models: models).isEmpty)
        XCTAssertTrue(ComposerArgumentRows.rows(for: command("/model"), partial: "",
                                                familiars: roster, models: []).isEmpty)
    }
}
