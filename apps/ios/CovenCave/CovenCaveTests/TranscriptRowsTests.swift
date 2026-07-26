import XCTest
@testable import CovenCave

/// TranscriptRow/TranscriptIndex back the chat transcript: rows are derived
/// once per structural change (append/insert/remove/replace) and streamed
/// text deltas update the affected row in place through an O(1) id→position
/// index — never a per-token O(n) scan or separator re-derivation.
final class TranscriptRowsTests: XCTestCase {

    /// Fixed, DST-honest calendar so day-boundary assertions don't depend on
    /// the host machine's locale or timezone.
    private var losAngeles: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return cal
    }

    private var utc: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }

    private func date(_ calendar: Calendar, year: Int = 2026, month: Int = 7,
                      day: Int, hour: Int, minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day,
                                           hour: hour, minute: minute))!
    }

    private func message(_ id: String, at createdAt: Date,
                         text: String = "hi") -> DisplayMessage {
        DisplayMessage(id: id, role: .user, familiarId: nil, text: text,
                       createdAt: createdAt)
    }

    // MARK: - Row derivation

    func testEmptyTranscriptHasNoRows() {
        XCTAssertEqual(TranscriptRow.rows(for: [], calendar: losAngeles), [])
    }

    func testFirstMessageOpensWithADaySeparator() {
        let cal = losAngeles
        let rows = TranscriptRow.rows(for: [message("m1", at: date(cal, day: 1, hour: 9))],
                                      calendar: cal)
        XCTAssertEqual(rows.count, 2)
        guard case .day(_, let dayDate) = rows[0] else {
            return XCTFail("first row should be a day separator, got \(rows[0])")
        }
        XCTAssertEqual(dayDate, date(cal, day: 1, hour: 9))
        guard case .message(let m) = rows[1] else {
            return XCTFail("second row should be the message, got \(rows[1])")
        }
        XCTAssertEqual(m.id, "m1")
    }

    func testSameDayMessagesShareOneSeparator() {
        let cal = losAngeles
        let rows = TranscriptRow.rows(for: [
            message("m1", at: date(cal, day: 1, hour: 9)),
            message("m2", at: date(cal, day: 1, hour: 23, minute: 59)),
        ], calendar: cal)
        XCTAssertEqual(rows.map(\.id), ["day-m1", "m1", "m2"])
    }

    func testCalendarDayBoundaryInsertsASeparator() {
        let cal = losAngeles
        // 23:59 → 00:01: two minutes apart, different calendar days.
        let rows = TranscriptRow.rows(for: [
            message("m1", at: date(cal, day: 1, hour: 23, minute: 59)),
            message("m2", at: date(cal, day: 2, hour: 0, minute: 1)),
        ], calendar: cal)
        XCTAssertEqual(rows.map(\.id), ["day-m1", "m1", "day-m2", "m2"])
    }

    func testDayBoundaryFollowsTheCalendarsTimeZone() {
        // 23:30 and 00:30 LA time straddle LA midnight but share a UTC day
        // (06:30 and 07:30). The separator must follow the calendar it's
        // given — the view's Calendar.current semantics.
        let la = losAngeles
        let msgs = [
            message("m1", at: date(la, day: 1, hour: 23, minute: 30)),
            message("m2", at: date(la, day: 2, hour: 0, minute: 30)),
        ]
        XCTAssertEqual(TranscriptRow.rows(for: msgs, calendar: la).map(\.id),
                       ["day-m1", "m1", "day-m2", "m2"])
        XCTAssertEqual(TranscriptRow.rows(for: msgs, calendar: utc).map(\.id),
                       ["day-m1", "m1", "m2"])
    }

    func testRowIdsAreStableAcrossRebuilds() {
        let cal = losAngeles
        let base = [
            message("m1", at: date(cal, day: 1, hour: 9)),
            message("m2", at: date(cal, day: 1, hour: 10)),
        ]
        let before = TranscriptRow.rows(for: base, calendar: cal)
        // Appending a message must not disturb the identity of earlier rows —
        // stable ids are what keep SwiftUI from tearing down settled bubbles.
        let after = TranscriptRow.rows(for: base + [message("m3", at: date(cal, day: 2, hour: 8))],
                                       calendar: cal)
        XCTAssertEqual(Array(after.prefix(before.count)).map(\.id), before.map(\.id))
        XCTAssertEqual(after.map(\.id), ["day-m1", "m1", "m2", "day-m3", "m3"])
    }

    // MARK: - TranscriptIndex

    func testIndexLooksUpPositionsAndMissesUnknownIds() {
        let cal = losAngeles
        var index = TranscriptIndex()
        index.rebuild(messages: [
            message("m1", at: date(cal, day: 1, hour: 9)),
            message("m2", at: date(cal, day: 1, hour: 10)),
        ])
        XCTAssertEqual(index.position(of: "m1"), 0)
        XCTAssertEqual(index.position(of: "m2"), 1)
        XCTAssertNil(index.position(of: "nope"))
    }

    func testIndexUpdatesAfterInsertAndRemove() {
        let cal = losAngeles
        var messages = [
            message("m1", at: date(cal, day: 1, hour: 9)),
            message("m2", at: date(cal, day: 1, hour: 10)),
        ]
        var index = TranscriptIndex()
        index.rebuild(messages: messages)

        messages.insert(message("m0", at: date(cal, day: 1, hour: 8)), at: 0)
        index.rebuild(messages: messages)
        XCTAssertEqual(index.position(of: "m0"), 0)
        XCTAssertEqual(index.position(of: "m1"), 1)
        XCTAssertEqual(index.position(of: "m2"), 2)

        messages.removeAll { $0.id == "m1" }
        index.rebuild(messages: messages)
        XCTAssertEqual(index.position(of: "m0"), 0)
        XCTAssertNil(index.position(of: "m1"))
        XCTAssertEqual(index.position(of: "m2"), 1)
    }

    // MARK: - ChatThread integration

    @MainActor
    func testThreadDerivesRowsOnStructuralChanges() async {
        let thread = ChatThread(title: "t", familiarIds: ["nova"])
        XCTAssertEqual(thread.transcriptRows, [])

        let firstId = thread.appendSystem("one")
        XCTAssertEqual(thread.transcriptRows.count, 2, "day separator + message")
        XCTAssertEqual(thread.transcriptRows.last?.id, firstId)

        let secondId = thread.appendSystem("two")
        XCTAssertEqual(thread.transcriptRows.count, 3, "same-day append adds one row")

        thread.deleteMessage(firstId)
        XCTAssertEqual(thread.transcriptRows.map(\.id), ["day-\(secondId)", secondId])

        thread.clearMessages()
        XCTAssertEqual(thread.transcriptRows, [])
    }

    @MainActor
    func testTextOnlyMutationUpdatesTheRowWithoutRestructuring() async {
        let thread = ChatThread(title: "t", familiarIds: ["nova"])
        let id = thread.appendSystem("before")
        let idsBefore = thread.transcriptRows.map(\.id)

        thread.updateText(id, "after")

        XCTAssertEqual(thread.transcriptRows.map(\.id), idsBefore,
                       "a text delta must not restructure the row list")
        guard case .message(let updated)? = thread.transcriptRows.last else {
            return XCTFail("expected a message row")
        }
        XCTAssertEqual(updated.text, "after", "the row must carry the live text")
    }

    @MainActor
    func testThreadRebuildsRowsWhenMessagesAreReplacedWholesale() async {
        let cal = losAngeles
        let thread = ChatThread(title: "t", familiarIds: ["nova"])
        // AppModel.loadHistory / ChatThread.reload replace the whole array.
        thread.messages = [
            message("m1", at: date(cal, day: 1, hour: 9)),
            message("m2", at: date(cal, day: 1, hour: 10)),
        ]
        XCTAssertEqual(thread.transcriptRows.count, 3)
        XCTAssertEqual(thread.transcriptRows.last?.id, "m2")
    }

    @MainActor
    func testSnapshotInitDerivesRows() async {
        let cal = losAngeles
        let snapshot = ThreadSnapshot(id: "s1", title: "t", familiarIds: ["nova"],
                                      sessionIds: [:],
                                      messages: [message("m1", at: date(cal, day: 1, hour: 9))],
                                      updatedAt: Date(), archived: nil, pinned: nil, muted: nil)
        let thread = ChatThread(snapshot: snapshot)
        XCTAssertEqual(thread.transcriptRows.count, 2)
        XCTAssertEqual(thread.transcriptRows.last?.id, "m1")
    }
}
