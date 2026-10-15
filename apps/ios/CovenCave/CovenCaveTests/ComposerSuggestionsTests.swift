import XCTest
@testable import CovenCave

/// The phone's port of the desktop's `/skill` and `/prompt` rules (#5876).
/// Cases mirror src/lib/slash-skill.test.ts and slash-prompt.test.ts so the
/// two clients phrase and resolve a skill or prompt the same way.
final class ComposerSuggestionsTests: XCTestCase {
    private let skills = [
        SkillOption(id: "code-review", name: "code-review", description: "Review a change for bugs"),
        SkillOption(id: "release-notes", name: "Release Notes", description: "Draft notes", argumentHint: "[version]"),
        SkillOption(id: "code-review", name: "code-review (dup)"),
        SkillOption(id: "web-research", name: "web research"),
    ]
    private let prompts = [
        PromptOption(id: "standup", name: "Standup update", description: "Yesterday, today, blockers",
                     tags: ["daily"], body: "Yesterday:\nToday:\nBlockers:"),
        PromptOption(id: "bug-report", name: "Bug report", description: nil, tags: ["triage"], body: "Steps: {{steps}}"),
    ]

    // MARK: Skills

    func testDedupeKeepsTheFirstRowPerId() {
        XCTAssertEqual(SkillInvocation.dedupe(skills).map(\.name), ["code-review", "Release Notes", "web research"])
    }

    func testFilterMatchesIdNameOrDescriptionAndDedupes() {
        XCTAssertEqual(SkillInvocation.filter(skills, partial: "").map(\.id), ["code-review", "release-notes", "web-research"])
        XCTAssertEqual(SkillInvocation.filter(skills, partial: "BUGS").map(\.id), ["code-review"])
        XCTAssertEqual(SkillInvocation.filter(skills, partial: "notes").map(\.id), ["release-notes"])
    }

    func testResolvePrefersAnExactMatchThenASubstring() {
        XCTAssertEqual(SkillInvocation.resolve("release notes", in: skills)?.id, "release-notes")
        XCTAssertEqual(SkillInvocation.resolve("review", in: skills)?.id, "code-review")
        XCTAssertNil(SkillInvocation.resolve("  ", in: skills))
        XCTAssertNil(SkillInvocation.resolve("nothing", in: skills))
    }

    func testInvocationSplitsTheNameFromItsArguments() {
        let whole = SkillInvocation.resolveInvocation("web research", in: skills)
        XCTAssertEqual(whole?.skill.id, "web-research")
        XCTAssertEqual(whole?.args, "", "a multi-word name resolves whole first")

        let split = SkillInvocation.resolveInvocation("code-review check auth.ts", in: skills)
        XCTAssertEqual(split?.skill.id, "code-review")
        XCTAssertEqual(split?.args, "check auth.ts")

        let paragraph = SkillInvocation.resolveInvocation("code-review\n\nlook at the login flow", in: skills)
        XCTAssertEqual(paragraph?.skill.id, "code-review", "a newline separates the name too")
        XCTAssertEqual(paragraph?.args, "look at the login flow")

        XCTAssertNil(SkillInvocation.resolveInvocation("nope do it", in: skills))
    }

    func testPromptPhrasingMatchesTheDesktop() {
        let skill = skills[0]
        XCTAssertEqual(SkillInvocation.prompt(for: skill), "Use the \"code-review\" skill.")
        XCTAssertEqual(SkillInvocation.prompt(for: skill, args: "check auth.ts"),
                       "Use the \"code-review\" skill with: check auth.ts")
        XCTAssertEqual(SkillInvocation.prompt(for: skill, args: "line one\nline two"),
                       "Use the \"code-review\" skill.\n\nline one\nline two",
                       "multi-line arguments are the operator's prose, carried as the body")
        XCTAssertEqual(SkillInvocation.prompt(for: skill, args: "", message: "also check tests"),
                       "Use the \"code-review\" skill.\n\nalso check tests")
    }

    // MARK: Prompts

    func testPromptFilterMatchesTagsToo() {
        XCTAssertEqual(PromptPick.filter(prompts, partial: "").map(\.id), ["standup", "bug-report"])
        XCTAssertEqual(PromptPick.filter(prompts, partial: "triage").map(\.id), ["bug-report"])
        XCTAssertEqual(PromptPick.filter(prompts, partial: "blockers").map(\.id), ["standup"])
    }

    func testPromptResolve() {
        XCTAssertEqual(PromptPick.resolve("standup update", in: prompts)?.id, "standup")
        XCTAssertEqual(PromptPick.resolve("bug", in: prompts)?.id, "bug-report")
        XCTAssertNil(PromptPick.resolve("", in: prompts))
    }

    // MARK: Rows

    func testSkillAndPromptRows() {
        let skillRows = ComposerArgumentRows.rows(
            for: SlashCatalog.command(for: "/skill")!, partial: "rev",
            familiars: [], models: [], skills: skills)
        XCTAssertEqual(skillRows.map(\.value), ["code-review"])
        XCTAssertEqual(skillRows.first?.subtitle, "Review a change for bugs")

        let promptRows = ComposerArgumentRows.rows(
            for: SlashCatalog.command(for: "/prompts")!, partial: "",
            familiars: [], models: [], prompts: prompts)
        XCTAssertEqual(promptRows.map(\.title), ["Standup update", "Bug report"])
    }

    // MARK: Catalog

    func testSkillAndPromptCommandsAreNative() {
        XCTAssertEqual(SlashCatalog.command(for: "/skill")?.action, .invokeSkill)
        XCTAssertEqual(SlashCatalog.command(for: "/skills")?.action, .browseSkills)
        XCTAssertEqual(SlashCatalog.command(for: "/prompt")?.action, .insertPrompt)
        XCTAssertEqual(SlashCatalog.command(for: "/prompts")?.action, .browsePrompts)
        for token in ["/skill", "/skills", "/prompt", "/prompts"] {
            XCTAssertEqual(SlashCatalog.command(for: token)?.availability, .native, token)
        }
        XCTAssertTrue(SlashCatalog.command(for: "/skill")!.sendsChatMessage, "a skill sends a message")
        XCTAssertFalse(SlashCatalog.command(for: "/prompt")!.sendsChatMessage, "a prompt only inserts")
    }

    // MARK: Store

    @MainActor
    func testStoreLoadsOncePerKindAndJoinsAConcurrentLoad() async {
        let store = ComposerSuggestionStore()
        let calls = Counter()
        let load: @Sendable () async throws -> [SkillOption] = {
            await calls.bump()
            try await Task.sleep(for: .milliseconds(30))
            return [SkillOption(id: "a", name: "a"), SkillOption(id: "a", name: "dup")]
        }
        async let first: Void = store.ensureLoaded(.skills, host: "h", skills: load, prompts: { [] })
        async let second: Void = store.ensureLoaded(.skills, host: "h", skills: load, prompts: { [] })
        _ = await (first, second)
        let count = await calls.value
        XCTAssertEqual(count, 1)
        XCTAssertEqual(store.skills.map(\.name), ["a"])
        XCTAssertEqual(store.loadState(.skills), .loaded)

        await store.ensureLoaded(.skills, host: "h", skills: load, prompts: { [] })
        let fresh = await calls.value
        XCTAssertEqual(fresh, 1, "a fresh cache is reused")
    }

    @MainActor
    func testAnotherHostStartsOverAndAFailureIsReported() async {
        let store = ComposerSuggestionStore()
        store.seed(skills: [SkillOption(id: "a", name: "a")], prompts: [], host: "one")
        struct Boom: Error {}
        await store.ensureLoaded(.skills, host: "two", skills: { throw Boom() }, prompts: { [] })
        XCTAssertTrue(store.skills.isEmpty, "another desktop's skills are not shown")
        XCTAssertEqual(store.loadState(.skills), .failed)
    }

    @MainActor
    func testAStaleCacheReloads() async {
        var clock = Date(timeIntervalSince1970: 0)
        let store = ComposerSuggestionStore(now: { clock })
        let calls = Counter()
        let load: @Sendable () async throws -> [PromptOption] = {
            await calls.bump()
            return []
        }
        await store.ensureLoaded(.prompts, host: "h", skills: { [] }, prompts: load)
        clock = clock.addingTimeInterval(ComposerSuggestionStore.freshFor + 1)
        await store.ensureLoaded(.prompts, host: "h", skills: { [] }, prompts: load)
        let count = await calls.value
        XCTAssertEqual(count, 2)
    }
}

private actor Counter {
    private(set) var value = 0
    func bump() { value += 1 }
}
