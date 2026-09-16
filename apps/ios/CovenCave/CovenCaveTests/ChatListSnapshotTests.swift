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

    private func chat(
        _ id: String,
        root: String?,
        familiars: [String] = ["nyx"]
    ) -> ChatThread {
        ChatThread(id: id, title: id, familiarIds: familiars, projectRoot: root)
    }
}
