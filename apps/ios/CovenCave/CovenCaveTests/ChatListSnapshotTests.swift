import XCTest
@testable import CovenCave

@MainActor
final class ChatListSnapshotTests: XCTestCase {
    func testGlobalListIncludesDirectAndGroupChatsAcrossProjects() {
        let first = chat("alpha", root: "/repos/alpha")
        let second = chat("beta", root: "/repos/beta", familiars: ["nyx", "lyra"])
        let snapshot = ChatListSnapshot(threads: [first, second], sessions: [], familiars: [])

        XCTAssertEqual(Set(snapshot.entries.map(\.id)), ["local:alpha", "local:beta"])
    }

    func testServerConversationIsNotDuplicatedAfterLocalHydration() {
        let local = chat("phone", root: "/repos/alpha")
        local.sessionIds = ["nyx": "server-1"]
        let server = SessionRow(id: "server-1", title: "Desktop title", familiarId: "nyx")
        let snapshot = ChatListSnapshot(threads: [local], sessions: [server], familiars: [])

        XCTAssertEqual(snapshot.entries.map(\.id), ["local:phone"])
    }

    func testDifferentFamiliarDoesNotDisappearBecauseOfAnUnmatchedBinding() {
        let local = chat("phone", root: "/repos/alpha")
        local.sessionIds = ["lyra": "server-1"]
        let server = SessionRow(id: "server-1", title: "Other chat", familiarId: "nyx")
        let snapshot = ChatListSnapshot(threads: [local], sessions: [server], familiars: [])

        XCTAssertEqual(snapshot.entries.count, 2)
    }

    func testArchivedLocalDoesNotReappearAsAServerOnlyChat() {
        let local = chat("archived", root: "/repos/alpha")
        local.archived = true
        local.sessionIds = ["nyx": "server-1"]
        let server = SessionRow(id: "server-1", title: "Archived", familiarId: "nyx")

        let hidden = ChatListSnapshot(threads: [local], sessions: [server], familiars: [])
        XCTAssertTrue(hidden.entries.isEmpty)
        XCTAssertEqual(hidden.archivedCount, 1)
        let visible = ChatListSnapshot(
            threads: [local], sessions: [server], familiars: [], includeArchived: true
        )
        XCTAssertEqual(visible.entries.map(\.id), ["local:archived"])
    }

    func testGroupFanOutSessionsAppearOnlyAsTheGroupConversation() {
        let group = chat("group", root: "/repos/alpha", familiars: ["nyx", "lyra"])
        group.sessionIds = ["nyx": "nyx-session", "lyra": "lyra-session"]
        let sessions = [
            SessionRow(id: "nyx-session", title: "Nyx turn", familiarId: "nyx"),
            SessionRow(id: "lyra-session", title: "Lyra turn", familiarId: "lyra"),
        ]
        let snapshot = ChatListSnapshot(threads: [group], sessions: sessions, familiars: [])
        XCTAssertEqual(snapshot.entries.map(\.id), ["local:group"])
    }

    func testRenamedLocalChatStillMatchesItsAuthoritativeServerTitle() {
        let local = chat("Phone name", root: "/repos/alpha")
        local.sessionIds = ["nyx": "server-1"]
        let server = SessionRow(id: "server-1", title: "Desktop handoff", familiarId: "nyx")
        let snapshot = ChatListSnapshot(
            threads: [local], sessions: [server], familiars: [], query: "desktop"
        )
        XCTAssertEqual(snapshot.entries.map(\.id), ["local:Phone name"])
        XCTAssertEqual(local.title, "Phone name", "search must not rename or rebind the conversation")
    }

    func testBoundServerActivityOrdersCachedChatsWithoutMutatingTheirHistory() {
        let local = chat("phone", root: "/repos/alpha")
        local.sessionIds = ["nyx": "server-1"]
        local.updatedAt = Date(timeIntervalSince1970: 1)
        let other = chat("other", root: "/repos/beta")
        other.updatedAt = Date(timeIntervalSince1970: 2)
        let server = SessionRow(
            id: "server-1", title: "Desktop update", familiarId: "nyx",
            updatedAt: "2026-09-12T10:00:00Z"
        )
        let snapshot = ChatListSnapshot(
            threads: [other, local], sessions: [server], familiars: []
        )
        XCTAssertEqual(snapshot.entries.map(\.id), ["local:phone", "local:other"])
        XCTAssertEqual(snapshot.entries.first?.updatedAt, caveParseISO(server.updatedAt))
        XCTAssertEqual(local.updatedAt, Date(timeIntervalSince1970: 1))
    }

    func testPinsSortFirstThenRecentActivityWithDeterministicTies() {
        let pinned = chat("pinned", root: nil)
        pinned.pinned = true
        pinned.updatedAt = Date(timeIntervalSince1970: 1)
        let first = chat("a", root: nil)
        let second = chat("b", root: nil)
        first.updatedAt = Date(timeIntervalSince1970: 100)
        second.updatedAt = first.updatedAt

        let snapshot = ChatListSnapshot(
            threads: [second, pinned, first], sessions: [], familiars: []
        )
        XCTAssertEqual(snapshot.entries.map(\.id), ["local:pinned", "local:a", "local:b"])
    }

    func testSearchMatchesChatTitlesAndExactParticipantDisplayNames() {
        let local = chat("Build review", root: nil)
        let familiar = Familiar(id: "nyx", displayName: "Night Owl")
        XCTAssertEqual(ChatListSnapshot(
            threads: [local], sessions: [], familiars: [familiar], query: " night "
        ).entries.count, 1)
        XCTAssertEqual(ChatListSnapshot(
            threads: [local], sessions: [], familiars: [familiar], query: "BUILD"
        ).entries.count, 1)
        XCTAssertTrue(ChatListSnapshot(
            threads: [local], sessions: [], familiars: [familiar], query: "other"
        ).entries.isEmpty)
    }

    func testGeneratedSessionsNeverBecomeConversations() {
        let generated = SessionRow(id: "generated", title: "Background run", generated: true)
        let chat = SessionRow(id: "chat", title: "Real chat", familiarId: "nyx")
        let snapshot = ChatListSnapshot(
            threads: [], sessions: [generated, chat], familiars: []
        )
        XCTAssertEqual(snapshot.entries.map(\.id), ["server:chat"])
    }

    func testFamiliarFilterKeepsOnlyConversationsThatFamiliarTakesPartIn() {
        let direct = chat("direct", root: nil, familiars: ["nyx"])
        let group = chat("group", root: nil, familiars: ["nyx", "lyra"])
        let other = chat("other", root: nil, familiars: ["lyra"])
        let server = SessionRow(id: "server-1", title: "Desktop chat", familiarId: "lyra")

        let all = ChatListSnapshot(threads: [direct, group, other], sessions: [server], familiars: [])
        XCTAssertEqual(all.entries.count, 4)
        XCTAssertEqual(all.familiarIds, ["nyx", "lyra"])

        let nyx = all.filtered(query: "", includeArchived: false, familiarId: "nyx")
        XCTAssertEqual(Set(nyx.entries.map(\.id)), ["local:direct", "local:group"])

        let lyra = ChatListSnapshot(
            threads: [direct, group, other], sessions: [server], familiars: [], familiarId: "lyra"
        )
        XCTAssertEqual(Set(lyra.entries.map(\.id)), ["local:group", "local:other", "server:server-1"])
        XCTAssertEqual(lyra.familiarIds, ["nyx", "lyra"], "the filter roster is not narrowed by the filter itself")
    }

    func testFamiliarFilterComposesWithSearchAndArchive() {
        let visible = chat("Build review", root: nil, familiars: ["nyx"])
        let archived = chat("Build archive", root: nil, familiars: ["nyx"])
        archived.archived = true
        // Built archived-inclusive, as the cache does, so `filtered` can widen
        // and narrow the archive toggle without a rebuild.
        let snapshot = ChatListSnapshot(
            threads: [visible, archived], sessions: [], familiars: [], includeArchived: true
        )

        XCTAssertEqual(
            snapshot.filtered(query: "build", includeArchived: false, familiarId: "nyx").entries.map(\.id),
            ["local:Build review"]
        )
        XCTAssertEqual(
            snapshot.filtered(query: "build", includeArchived: true, familiarId: "nyx").entries.count, 2
        )
        XCTAssertTrue(snapshot.filtered(query: "", includeArchived: true, familiarId: "lyra").entries.isEmpty)
        XCTAssertEqual(snapshot.archivedCount, 1)
    }

    func testEnhanceOriginReviewRunsNeverBecomeConversations() throws {
        let review = try JSONDecoder().decode(SessionRow.self, from: Data(
            #"{"id":"review","title":"Thread you just completed (session…","origin":"enhance","familiarId":"nyx"}"#.utf8
        ))
        let chat = SessionRow(id: "chat", title: "Real chat", familiarId: "nyx")
        XCTAssertTrue(review.isGeneratedRun, "the one-shot utility lane is hidden, matching the web")
        XCTAssertTrue(review.isThreadReflection)
        let snapshot = ChatListSnapshot(threads: [], sessions: [review, chat], familiars: [])
        XCTAssertEqual(snapshot.entries.map(\.id), ["server:chat"], "reviews never mix with live chats")
        XCTAssertEqual(snapshot.reflections.map(\.id), ["reflection:review"], "…but stay reachable apart")
        XCTAssertEqual(snapshot.archivedCount, 0)
        XCTAssertEqual(snapshot.familiarIds, ["nyx"])
    }

    func testThreadReflectionMatchesOnlyTheEnhanceReviewOpener() {
        func row(_ title: String, origin: String?) -> SessionRow {
            var row = SessionRow(id: title, title: title, familiarId: "nyx")
            row.origin = origin
            return row
        }
        XCTAssertTrue(row("Thread you just completed (session 1)", origin: "enhance").isThreadReflection)
        XCTAssertTrue(row("  thread you just completed…", origin: "enhance").isThreadReflection)
        XCTAssertFalse(row("Improve this prompt", origin: "enhance").isThreadReflection,
                       "other enhance runs stay hidden outright")
        XCTAssertFalse(row("Thread you just completed", origin: nil).isThreadReflection,
                       "a user chat that happens to share the words is a chat")
        XCTAssertFalse(row("Thread you just completed", origin: "journal").isThreadReflection)
    }

    func testReflectionsHonorFamiliarFilterSearchAndArchive() {
        func reflection(_ id: String, familiar: String, updatedAt: String, archived: Bool = false) -> SessionRow {
            var row = SessionRow(id: id, title: "Thread you just completed \(id)", familiarId: familiar)
            row.origin = "enhance"
            row.updatedAt = updatedAt
            row.archivedAt = archived ? updatedAt : nil
            return row
        }
        let snapshot = ChatListSnapshot(
            threads: [],
            sessions: [SessionRow(id: "chat", title: "Real chat", familiarId: "nyx")],
            familiars: [],
            reflectionSessions: [
                reflection("old", familiar: "nyx", updatedAt: "2026-09-01T00:00:00Z"),
                reflection("new", familiar: "nyx", updatedAt: "2026-09-20T00:00:00Z"),
                reflection("lyra", familiar: "lyra", updatedAt: "2026-09-10T00:00:00Z"),
                reflection("gone", familiar: "nyx", updatedAt: "2026-09-25T00:00:00Z", archived: true),
            ],
            includeArchived: true
        )

        XCTAssertEqual(snapshot.reflections.map(\.id),
                       ["reflection:new", "reflection:lyra", "reflection:old"],
                       "newest first; archived reflections never show, even with archived chats")
        XCTAssertEqual(snapshot.archivedCount, 0, "reflections never count toward Show archived")
        XCTAssertEqual(snapshot.familiarIds, ["nyx"], "the familiar roster counts chats only")
        XCTAssertEqual(
            snapshot.filtered(query: "", includeArchived: false, familiarId: "lyra").reflections.map(\.id),
            ["reflection:lyra"]
        )
        XCTAssertEqual(
            snapshot.filtered(query: "old", includeArchived: false).reflections.map(\.id),
            ["reflection:old"]
        )
    }

    func testOpenedReflectionStaysOutOfTheLiveList() {
        var review = SessionRow(id: "review", title: "Thread you just completed", familiarId: "nyx")
        review.origin = "enhance"
        // Tapping a reflection hydrates a local thread bound only to that run.
        let hydrated = chat("hydrated", root: nil)
        hydrated.sessionIds = ["nyx": "review"]
        let live = chat("live", root: nil)
        let snapshot = ChatListSnapshot(
            threads: [hydrated, live], sessions: [], familiars: [], reflectionSessions: [review]
        )

        XCTAssertEqual(snapshot.entries.map(\.id), ["local:live"])
        XCTAssertEqual(snapshot.reflections.map(\.id), ["reflection:review"])
    }

    func testCacheReusesFilteredProjectionUntilInputsChange() {
        let cache = ChatListSnapshotCache()
        let nyx = chat("nyx chat", root: nil, familiars: ["nyx"])
        let lyra = chat("lyra chat", root: nil, familiars: ["lyra"])
        func resolve(_ familiarId: String?) -> [String] {
            cache.resolve(threads: [nyx, lyra], sessions: [], familiars: [],
                          query: "", includeArchived: false, familiarId: familiarId).entries.map(\.id)
        }

        XCTAssertEqual(resolve("nyx"), ["local:nyx chat"])
        XCTAssertEqual(resolve("lyra"), ["local:lyra chat"])
        XCTAssertEqual(resolve("nyx"), ["local:nyx chat"], "switching back reuses the projection")
        XCTAssertEqual(Set(resolve(nil)), ["local:nyx chat", "local:lyra chat"])

        lyra.familiarIds = ["nyx"]
        XCTAssertEqual(Set(resolve("nyx")), ["local:nyx chat", "local:lyra chat"],
                       "a metadata change drops memoized projections")
    }

    func testCacheNeverServesAStaleFilteredList() {
        let cache = ChatListSnapshotCache()
        let alpha = chat("alpha", root: "/repos/alpha")
        let beta = chat("beta", root: "/repos/beta")

        let all = cache.resolve(threads: [alpha, beta], sessions: [], familiars: [],
                                query: "", includeArchived: false)
        XCTAssertEqual(Set(all.entries.map(\.id)), ["local:alpha", "local:beta"])
        let again = cache.resolve(threads: [alpha, beta], sessions: [], familiars: [],
                                  query: "", includeArchived: false)
        XCTAssertEqual(again.entries.map(\.id), all.entries.map(\.id), "an unchanged filter returns the same list")

        let searched = cache.resolve(threads: [alpha, beta], sessions: [], familiars: [],
                                     query: "beta", includeArchived: false)
        XCTAssertEqual(searched.entries.map(\.id), ["local:beta"], "a new query filters again")

        let gamma = chat("gamma", root: "/repos/gamma")
        let grown = cache.resolve(threads: [alpha, beta, gamma], sessions: [], familiars: [],
                                  query: "", includeArchived: false)
        XCTAssertEqual(Set(grown.entries.map(\.id)), ["local:alpha", "local:beta", "local:gamma"],
                       "new data with a previously seen filter is filtered afresh")

        gamma.archived = true
        let archivedHidden = cache.resolve(threads: [alpha, beta, gamma], sessions: [], familiars: [],
                                           query: "", includeArchived: false)
        XCTAssertEqual(Set(archivedHidden.entries.map(\.id)), ["local:alpha", "local:beta"])
        XCTAssertEqual(archivedHidden.archivedCount, 1)
        let archivedShown = cache.resolve(threads: [alpha, beta, gamma], sessions: [], familiars: [],
                                          query: "", includeArchived: true)
        XCTAssertEqual(Set(archivedShown.entries.map(\.id)), ["local:alpha", "local:beta", "local:gamma"])
    }

    private func chat(
        _ id: String,
        root: String?,
        familiars: [String] = ["nyx"]
    ) -> ChatThread {
        ChatThread(id: id, title: id, familiarIds: familiars, projectRoot: root)
    }
}
