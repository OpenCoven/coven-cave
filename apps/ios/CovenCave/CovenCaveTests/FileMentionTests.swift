import XCTest
@testable import CovenCave

/// `@` file mentions in a one-to-one chat with a project (#6104), ported from
/// the desktop's `src/lib/file-mention.ts`.
final class FileMentionTests: XCTestCase {

    // MARK: Ranking (desktop `filterFileMentions`)

    func testRanksFileNamePrefixThenFileNameThenPathThenSubsequence() {
        let files = [
            "src/c/h/a/t.ts",               // 3: c, h, a, t in order
            "chatty/readme.md",             // 2: only the path contains it
            "src/lib/achat.ts",             // 1: the file name contains it
            "src/components/chat-view.tsx", // 0: the file name starts with it
            "docs/chat.md",                 // 0, and shorter
            "zzz.txt",                      // no match
        ]
        XCTAssertEqual(FileMention.filter(files, query: "chat"), [
            "docs/chat.md",
            "src/components/chat-view.tsx",
            "src/lib/achat.ts",
            "chatty/readme.md",
            "src/c/h/a/t.ts",
        ])
    }

    func testTiesGoToTheShorterPathThenTheLexicallySmallerOne() {
        XCTAssertEqual(FileMention.filter(["b/x.ts", "a/x.ts", "a/x.tsx"], query: "x"), ["a/x.ts", "b/x.ts", "a/x.tsx"])
    }

    func testMatchingIgnoresCaseAndKeepsTheOriginalSpelling() {
        XCTAssertEqual(FileMention.filter(["README.md", "src/readme.ts"], query: "READ"), ["README.md", "src/readme.ts"])
    }

    func testAnEmptyQueryReturnsTheHeadOfTheIndexUnranked() {
        let files = ["z.ts", "a.ts", "m.ts"]
        XCTAssertEqual(FileMention.filter(files, query: "", limit: 2), ["z.ts", "a.ts"])
        XCTAssertEqual(FileMention.filter(files, query: "  "), files)
    }

    func testTheResultLimitHolds() {
        let files = (0..<40).map { "src/file\($0).ts" }
        XCTAssertEqual(FileMention.filter(files, query: "file").count, FileMention.resultLimit)
        XCTAssertTrue(FileMention.filter(files, query: "file", limit: 0).isEmpty)
    }

    func testRowTitleAndFolder() {
        XCTAssertEqual(FileMention.fileName("src/lib/file-mention.ts"), "file-mention.ts")
        XCTAssertEqual(FileMention.folder("src/lib/file-mention.ts"), "src/lib")
        XCTAssertEqual(FileMention.fileName("README.md"), "README.md")
        XCTAssertNil(FileMention.folder("README.md"), "a root file has no folder line")
    }

    // MARK: The trailing token

    func testThePickerOpensOnABoundedAtAndAllowsPaths() {
        XCTAssertEqual(MentionInput.partial("Look at @"), "")
        XCTAssertEqual(MentionInput.partial("Look at @src/comp"), "src/comp")
        XCTAssertNil(MentionInput.partial("mail val@example.com"), "an address is not a mention")
        XCTAssertNil(MentionInput.partial("@a@b"), "a second @ ends the mention, as on the desktop")
        XCTAssertEqual(MentionInput.insert(name: "src/a.ts", into: "Look at @sr"), "Look at @src/a.ts ")
    }

    // MARK: The files a send carries (Val's T2 rule: only picked paths)

    func testOnlyPickedPathsStillInTheTextGo() {
        XCTAssertEqual(
            FileMention.picked(["src/a.ts", "README.md"], in: "See @src/a.ts and @README.md, then @src/a.ts again."),
            ["src/a.ts", "README.md"])
        XCTAssertEqual(
            FileMention.picked(["src/a.ts"], in: "Compare @src/a.ts with @src/typed.ts"),
            ["src/a.ts"], "a path typed into prose stays text")
        XCTAssertEqual(
            FileMention.picked(["src/a.ts", "docs/x.md"], in: "Only @docs/x.md now"),
            ["docs/x.md"], "a pick whose token was deleted does not ride along")
        XCTAssertEqual(FileMention.picked([], in: "@src/a.ts"), [], "nothing picked, nothing sent")
    }

    func testPicksKeepTheirOrderWithoutRepeats() {
        XCTAssertEqual(
            FileMention.picked(["b.ts", "a.ts", "b.ts"], in: "@a.ts then @b.ts"),
            ["b.ts", "a.ts"])
    }

    func testAPickCountsOnlyAsABoundedToken() {
        XCTAssertEqual(FileMention.picked(["example.com"], in: "mail val@example.com"), [])
        XCTAssertEqual(FileMention.picked(["src/a.ts"], in: "(@src/a.ts)"), [], "the @ must start the word, like the picker's boundary")
        XCTAssertEqual(FileMention.picked(["src/a.ts"], in: "open @src/a.ts?"), ["src/a.ts"], "sentence punctuation is not part of the path")
        XCTAssertEqual(FileMention.picked(["src/a.ts"], in: "see @src/a.tsx"), [], "a longer path is a different token")
        XCTAssertEqual(FileMention.picked(["src/a.ts"], in: "first line\n@src/a.ts"), ["src/a.ts"])
    }

    func testAtMostTenPathsGo() {
        let picks = (0..<12).map { "f\($0).ts" }
        let prompt = picks.map { "@\($0)" }.joined(separator: " ")
        XCTAssertEqual(FileMention.picked(picks, in: prompt), (0..<10).map { "f\($0).ts" })
    }

    // MARK: The send body

    @MainActor
    func testAOneToOneProjectChatSendsItsPickedMentionsWithTheRoot() throws {
        let thread = ChatThread(title: "Nyx", familiarIds: ["nyx"], projectRoot: "/repos/cave")
        let body = try XCTUnwrap(thread.makeSendBody(
            familiarId: "nyx", prompt: "Read @src/a.ts and @src/typed.ts please", runId: "r",
            mentionedFiles: ["src/a.ts"]))
        XCTAssertEqual(body.mentionedFiles, ["src/a.ts"], "the body sends what it is given, never paths read from the prompt")
        XCTAssertEqual(body.mentionedFilesRoot, "/repos/cave")
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        XCTAssertEqual(encoded["mentionedFiles"] as? [String], ["src/a.ts"])
        XCTAssertEqual(encoded["mentionedFilesRoot"] as? String, "/repos/cave")
    }

    @MainActor
    func testGroupAndProjectlessChatsSendNoFileMentions() throws {
        let group = ChatThread(title: "Nyx and Sage", familiarIds: ["nyx", "sage"], projectRoot: "/repos/cave")
        let groupBody = try XCTUnwrap(group.makeSendBody(
            familiarId: "nyx", prompt: "@Sage look at @src/a.ts", runId: "r", mentionedFiles: ["src/a.ts"]))
        XCTAssertNil(groupBody.mentionedFiles, "a group chat's @ names familiars")
        XCTAssertNil(groupBody.mentionedFilesRoot)

        let resumed = ChatThread(title: "Nyx", familiarIds: ["nyx"], sessionIds: ["nyx": "session-1"])
        let resumedBody = try XCTUnwrap(resumed.makeSendBody(
            familiarId: "nyx", prompt: "@src/a.ts", runId: "r", mentionedFiles: ["src/a.ts"]))
        XCTAssertNil(resumedBody.mentionedFiles, "without a project there is no root to be relative to")
    }

    @MainActor
    func testATypedPathWithoutAPickOmitsBothFields() throws {
        let thread = ChatThread(title: "Nyx", familiarIds: ["nyx"], projectRoot: "/repos/cave")
        let body = try XCTUnwrap(thread.makeSendBody(familiarId: "nyx", prompt: "hello @src/a.ts", runId: "r"))
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        XCTAssertNil(encoded["mentionedFiles"])
        XCTAssertNil(encoded["mentionedFilesRoot"])
    }

    @MainActor
    func testTheBodyCapsMentionsAtTen() throws {
        let thread = ChatThread(title: "Nyx", familiarIds: ["nyx"], projectRoot: "/repos/cave")
        let body = try XCTUnwrap(thread.makeSendBody(
            familiarId: "nyx", prompt: "x", runId: "r", mentionedFiles: (0..<12).map { "f\($0).ts" }))
        XCTAssertEqual(body.mentionedFiles?.count, FileMention.maxPerSend)
    }

    // MARK: Picks stored on the user message

    func testAMessageStoresItsPicksAndOlderSnapshotsStillDecode() throws {
        var message = DisplayMessage(role: .user, text: "Read @src/a.ts")
        message.mentionedFiles = ["src/a.ts"]
        let decoded = try JSONDecoder().decode(DisplayMessage.self, from: JSONEncoder().encode(message))
        XCTAssertEqual(decoded.mentionedFiles, ["src/a.ts"])

        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(message)) as? [String: Any])
        legacy.removeValue(forKey: "mentionedFiles")
        let old = try JSONDecoder().decode(DisplayMessage.self, from: JSONSerialization.data(withJSONObject: legacy))
        XCTAssertNil(old.mentionedFiles, "a snapshot from before #6104 decodes with no picks")
    }

    @MainActor
    func testAnOfflineQueuedMessageKeepsItsPicks() throws {
        let thread = ChatThread(title: "Nyx", familiarIds: ["nyx"], projectRoot: "/repos/cave")
        thread.enqueue("Read @src/a.ts", mentionedFiles: ["src/a.ts"])
        let queued = try XCTUnwrap(thread.messages.last)
        XCTAssertTrue(queued.isQueued)
        XCTAssertEqual(queued.mentionedFiles, ["src/a.ts"])

        thread.enqueue("Read @src/typed.ts")
        XCTAssertNil(thread.messages.last?.mentionedFiles, "no picks are stored as nil, not an empty list")
    }

    // MARK: The file index request

    func testTheRootIsEncodedStrictlyEnoughForURLSearchParams() {
        XCTAssertEqual(CaveClient.queryValue("/Users/v/A&B+C=D?E#F G"), "/Users/v/A%26B%2BC%3DD%3FE%23F%20G")
        XCTAssertEqual(CaveClient.queryValue("/repos/coven-cave"), "/repos/coven-cave")
    }

    func testOnlyARepositoryListingYieldsFiles() throws {
        func decode(_ json: String) throws -> [String] {
            try JSONDecoder().decode(ProjectFilesResponse.self, from: Data(json.utf8)).indexedFiles
        }
        XCTAssertEqual(try decode(#"{"ok":true,"repo":true,"root":"/r","files":["a.ts"],"truncated":false}"#), ["a.ts"])
        XCTAssertEqual(try decode(#"{"ok":true,"repo":false,"error":"not a git repository"}"#), [])
        XCTAssertEqual(try decode(#"{"ok":false,"error":"path not allowed"}"#), [])
    }

    // MARK: Menu rows

    func testFileRowsShowTheNameAndFolderAndSayATapAddsTheFile() throws {
        let list = try XCTUnwrap(ComposerSuggestionList.make(
            intent: .mention(partial: ""), commands: [], argumentRows: [], mentions: [],
            files: ["src/lib/file-mention.ts", "README.md"]))
        XCTAssertEqual(list.items.map(\.title), ["file-mention.ts", "README.md"])
        XCTAssertEqual(list.items.map(\.subtitle), ["src/lib", nil])
        XCTAssertEqual(list.items.first?.kind, .file("src/lib/file-mention.ts"))
        XCTAssertEqual(list.items.first?.systemImage, "doc.text")
        XCTAssertEqual(list.footer, "Tap to add the file · type to filter")
        XCTAssertNil(ComposerSuggestionList.make(
            intent: .mention(partial: "zz"), commands: [], argumentRows: [], mentions: [], files: []))
    }

    func testFamiliarMentionsWinWhenAChatSuppliesBoth() throws {
        let nyx = Familiar(id: "nyx", displayName: "Nyx", role: nil)
        let list = try XCTUnwrap(ComposerSuggestionList.make(
            intent: .mention(partial: ""), commands: [], argumentRows: [], mentions: [nyx], files: ["a.ts"]))
        XCTAssertEqual(list.items.map(\.title), ["@Nyx"])
    }

    // MARK: Store

    @MainActor
    func testTheIndexLoadsOncePerRootAndJoinsAConcurrentLoad() async {
        let store = ComposerSuggestionStore()
        let calls = FileIndexCounter()
        let load: @Sendable (String) async throws -> [String] = { root in
            await calls.bump()
            try await Task.sleep(for: .milliseconds(30))
            return ["\(root)/a.ts"]
        }
        async let first: Void = store.ensureProjectFiles(root: "one", host: "h", load: load)
        async let second: Void = store.ensureProjectFiles(root: "one", host: "h", load: load)
        _ = await (first, second)
        let count = await calls.value
        XCTAssertEqual(count, 1)
        XCTAssertEqual(store.files(for: "one"), ["one/a.ts"])
        XCTAssertEqual(store.files(for: "two"), [], "another root's index is not shown")
        XCTAssertEqual(store.projectFilesState, .loaded)

        await store.ensureProjectFiles(root: "one", host: "h", load: load)
        let fresh = await calls.value
        XCTAssertEqual(fresh, 1, "a fresh index is reused")
    }

    @MainActor
    func testAnotherRootReplacesTheIndexAndAStaleOneReloads() async {
        var clock = Date(timeIntervalSince1970: 0)
        let store = ComposerSuggestionStore(now: { clock })
        let calls = FileIndexCounter()
        let load: @Sendable (String) async throws -> [String] = { root in
            await calls.bump()
            return ["\(root).ts"]
        }
        await store.ensureProjectFiles(root: "one", host: "h", load: load)
        await store.ensureProjectFiles(root: "two", host: "h", load: load)
        XCTAssertEqual(store.files(for: "two"), ["two.ts"])
        XCTAssertEqual(store.files(for: "one"), [])

        clock = clock.addingTimeInterval(ComposerSuggestionStore.projectFilesFreshFor + 1)
        await store.ensureProjectFiles(root: "two", host: "h", load: load)
        let count = await calls.value
        XCTAssertEqual(count, 3)
    }

    @MainActor
    func testAFailureIsReportedAndAnotherHostStartsOver() async {
        let store = ComposerSuggestionStore()
        store.seedProjectFiles(["a.ts"], root: "one")
        struct Denied: Error {}
        await store.ensureProjectFiles(root: "one", host: "another-desktop", load: { _ in throw Denied() })
        XCTAssertEqual(store.files(for: "one"), [], "another desktop's files are not shown")
        XCTAssertEqual(store.projectFilesState, .failed)
    }
}

private actor FileIndexCounter {
    private(set) var value = 0
    func bump() { value += 1 }
}
