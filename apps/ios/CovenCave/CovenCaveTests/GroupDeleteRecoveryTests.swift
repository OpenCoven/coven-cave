import XCTest
@testable import CovenCave

@MainActor
final class GroupDeleteRecoveryTests: XCTestCase {
    // MARK: - Group re-sync (the refusal's recovery gesture)

    func testReconcileDropsPhantomBubbleNoSessionHolds() throws {
        // A reply cancelled before it landed leaves a local bubble no server
        // transcript holds. Every later ordinal is then one too high; the
        // re-sync must drop the phantom and adopt the ids it can name.
        let user = DisplayMessage(role: .user, familiarId: nil, text: "hello")
        let phantom = DisplayMessage(role: .assistant, familiarId: "nyx", text: "cancelled draft")
        let reply = DisplayMessage(role: .assistant, familiarId: "nyx", text: "hi there")

        let result = ChatThread.reconciledGroupTranscript(
            current: [user, phantom, reply],
            transcripts: [
                (familiarId: "nyx", turns: try decodeTurns("""
                [
                  {"id":"u1","role":"user","text":"hello"},
                  {"id":"a1","role":"assistant","text":"hi there"}
                ]
                """)),
            ]
        )

        XCTAssertEqual(result.messages.map(\.id), [user.id, reply.id])
        XCTAssertEqual(result.messages[0].serverTurnId, "u1")
        XCTAssertEqual(result.messages[1].serverTurnId, "a1")
        XCTAssertEqual(result.absentForSession[phantom.id]?.contains("nyx"), true)
        XCTAssertEqual(result.absentForSession[phantom.id]?.count, 1)
    }

    func testReconcileKeepsFanOutMessageAndRecordsTheMissedSession() throws {
        // A prompt fanned out to four familiars but reached only three; the
        // fourth session's transcript cleanly skipped it. The merged list keeps
        // the prompt (three sessions hold it) and records which session
        // provably lacks it, so a delete skips that session instead of letting
        // it refuse the whole delete.
        let prompt = DisplayMessage(role: .user, familiarId: nil, text: "hello all")
        let nyxReply = DisplayMessage(role: .assistant, familiarId: "nyx", text: "hi")
        let miloReply = DisplayMessage(role: .assistant, familiarId: "milo", text: "yo")
        let sageReply = DisplayMessage(role: .assistant, familiarId: "sage", text: "hey")
        let tessReply = DisplayMessage(role: .assistant, familiarId: "tess", text: "sup")

        let result = ChatThread.reconciledGroupTranscript(
            current: [prompt, nyxReply, miloReply, sageReply, tessReply],
            transcripts: [
                (familiarId: "nyx", turns: try decodeTurns("""
                [
                  {"id":"u1","role":"user","text":"hello all"},
                  {"id":"a1","role":"assistant","text":"hi"}
                ]
                """)),
                (familiarId: "milo", turns: try decodeTurns("""
                [
                  {"id":"u2","role":"user","text":"hello all"},
                  {"id":"a2","role":"assistant","text":"yo"}
                ]
                """)),
                (familiarId: "sage", turns: try decodeTurns("""
                [
                  {"id":"u3","role":"user","text":"hello all"},
                  {"id":"a3","role":"assistant","text":"hey"}
                ]
                """)),
                (familiarId: "tess", turns: try decodeTurns("""
                [
                  {"id":"a4","role":"assistant","text":"sup"}
                ]
                """)),
            ]
        )

        XCTAssertEqual(result.messages.map(\.id),
                       [prompt.id, nyxReply.id, miloReply.id, sageReply.id, tessReply.id])
        XCTAssertEqual(result.absentForSession[prompt.id]?.contains("tess"), true)
        XCTAssertEqual(result.absentForSession[prompt.id]?.count, 1)
        XCTAssertNil(result.absentForSession[nyxReply.id])
    }

    func testReconcileRestoresServerTurnsTheLocalListNeverShowed() throws {
        // A retried reply re-appends its prompt+reply pair on the server while
        // the local bubble was re-streamed in place, so the server holds turns
        // the local list never showed. The re-sync restores them so the
        // session's transcript stops disagreeing at that position.
        let user = DisplayMessage(role: .user, familiarId: nil, text: "hello")
        let retried = DisplayMessage(role: .assistant, familiarId: "nyx", text: "first attempt")
        let next = DisplayMessage(role: .user, familiarId: nil, text: "continue")

        let result = ChatThread.reconciledGroupTranscript(
            current: [user, retried, next],
            transcripts: [
                (familiarId: "nyx", turns: try decodeTurns("""
                [
                  {"id":"u1","role":"user","text":"hello"},
                  {"id":"a1","role":"assistant","text":"first attempt"},
                  {"id":"u2","role":"user","text":"hello"},
                  {"id":"a2","role":"assistant","text":"second attempt"},
                  {"id":"u3","role":"user","text":"continue"}
                ]
                """)),
            ]
        )

        XCTAssertEqual(result.messages.count, 5)
        XCTAssertEqual(result.messages.map(\.serverTurnId), ["u1", "a1", "u2", "a2", "u3"])
        XCTAssertEqual(result.messages[3].familiarId, "nyx")
    }

    func testReconcileKeepsMessageWhenTheWalkCannotSay() throws {
        // When neither side lines up the walk bails: nothing is dropped or
        // adopted on a guess, because guessing is how a delete removes a
        // stranger's turn. The already-matched prefix keeps its ids.
        let user = DisplayMessage(role: .user, familiarId: nil, text: "hello")
        let reply = DisplayMessage(role: .assistant, familiarId: "nyx", text: "hi there")

        let result = ChatThread.reconciledGroupTranscript(
            current: [user, reply],
            transcripts: [
                (familiarId: "nyx", turns: try decodeTurns("""
                [
                  {"id":"u1","role":"user","text":"hello"},
                  {"id":"x1","role":"assistant","text":"diff one"},
                  {"id":"x2","role":"assistant","text":"diff two"},
                  {"id":"x3","role":"assistant","text":"diff three"},
                  {"id":"x4","role":"assistant","text":"diff four"},
                  {"id":"a1","role":"assistant","text":"hi there"}
                ]
                """)),
            ]
        )

        XCTAssertEqual(result.messages.map(\.id), [user.id, reply.id])
        XCTAssertEqual(result.messages[0].serverTurnId, "u1")
        XCTAssertNil(result.messages[1].serverTurnId)
        XCTAssertNil(result.absentForSession[reply.id])
    }

    // MARK: - The partial-delete report sentence

    func testPartialDeleteSentenceUsesEachChatsOwnReason() {
        let sentence = ChatThread.partialDeleteSentence(
            [
                (familiarId: "nyx", reason: "the desktop went away."),
                (familiarId: "milo", reason: "the desktop refused (status 403)"),
            ],
            familiarNames: ["nyx": "Nyx", "milo": "Milo"]
        )

        XCTAssertEqual(
            sentence,
            "That message was deleted, but it is still in this chat with "
                + "Nyx — the desktop went away; Milo — the desktop refused (status 403)."
        )
    }

    func testPartialDeleteSentenceFallsBackToFamiliarIdWithoutDisplayName() {
        let sentence = ChatThread.partialDeleteSentence(
            [(familiarId: "nyx", reason: "refused")],
            familiarNames: [:]
        )

        XCTAssertEqual(
            sentence,
            "That message was deleted, but it is still in this chat with nyx — refused."
        )
    }

    // MARK: - Helpers

    private func decodeTurns(_ json: String) throws -> [ChatTurn] {
        try JSONDecoder().decode([ChatTurn].self, from: Data(json.utf8))
    }
}
