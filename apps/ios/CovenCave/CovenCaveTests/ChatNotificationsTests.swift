import XCTest
@testable import CovenCave

private func reminder(link: Reminder.Link? = nil) -> Reminder {
    Reminder(
        id: "rem-1",
        kind: "reminder",
        title: "Reminder",
        status: "pending",
        link: link
    )
}

/// The notify/suppress decision, banner-body construction, and deep-link
/// round-trip for chat turn-completion notifications. All pure logic — the
/// UNUserNotificationCenter plumbing is intentionally not under test.
final class ChatNotificationsTests: XCTestCase {

    func testLiveActivityStateWithholdsTraceTitlesBeforeEncoding() throws {
        for title in ["PRIVATE_TOOL_ARGUMENT", "PRIVATE_REASONING_SUMMARY", "PRIVATE_OPAQUE_SIGNATURE"] {
            let state = ChatActivityAttributes.ContentState(statusLabel: title)
            let encoded = try JSONEncoder().encode(state)
            XCTAssertEqual(state.statusLabel, "Working…")
            XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains(title))
        }
    }

    func testRestoredLiveActivityStateDoesNotRediscloseAnOldTraceTitle() throws {
        let sentinel = "PRIVATE_RESTORED_TOOL_TITLE"
        let saved = try JSONSerialization.data(withJSONObject: ["statusLabel": sentinel])
        let state = try JSONDecoder().decode(ChatActivityAttributes.ContentState.self, from: saved)
        XCTAssertEqual(state.statusLabel, "Working…")
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(state), as: UTF8.self).contains(sentinel))
    }

    /// golden-13 (#6061): the shared tool sentinels, folded through the real
    /// stream decoder, reach neither the final-reply banner nor the Live
    /// Activity state. Tool payloads fold into steps, never the reply text.
    func testToolPayloadSentinelsStayOutOfFinalReplyBannerAndLiveActivity() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "runtime-activity-v1", withExtension: "json"))
        let corpus = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let section = try XCTUnwrap(corpus["reasoningPrivacySentinels"] as? [String: Any])
        let sentinels = try XCTUnwrap(section["tool"] as? [String: String]).values.sorted()
        XCTAssertEqual(sentinels.count, 3)
        let frames: [[String: Any]] = [
            ["kind": "tool_use", "id": "golden13", "name": sentinels[0], "status": "running",
             "input": "{\"note\":\"\(sentinels[1])\"}"],
            ["kind": "tool_use", "id": "golden13", "name": sentinels[0], "status": "ok",
             "input": "{\"note\":\"\(sentinels[1])\"}", "output": sentinels[2]],
        ]
        var steps: [ActivityStep] = []
        var labels: [String] = []
        for frame in frames {
            let json = String(decoding: try JSONSerialization.data(withJSONObject: frame), as: UTF8.self)
            steps = try XCTUnwrap(ActivityFold.fold(steps, event: try XCTUnwrap(StreamEvent.decode(json))))
            if let title = steps.last?.title { labels.append(title) }
        }
        XCTAssertFalse(labels.isEmpty)
        let reply = "The comparison is complete."
        var surfaces = [ChatNotifications.preview(text: reply, isError: false),
                        ChatNotifications.preview(text: "", isError: true)]
        for label in labels {
            let state = ChatActivityAttributes.ContentState(statusLabel: label)
            surfaces.append(state.statusLabel)
            surfaces.append(String(decoding: try JSONEncoder().encode(state), as: UTF8.self))
        }
        XCTAssertEqual(surfaces[0], reply)
        for surface in surfaces {
            for sentinel in sentinels { XCTAssertFalse(surface.contains(sentinel), sentinel) }
        }
    }

    // MARK: - Notify/suppress decision

    func testNotifiesWhenBackgroundedUnmutedAndEnabled() {
        XCTAssertTrue(ChatNotifications.shouldNotify(appActive: false,
                                                     threadMuted: false,
                                                     enabled: true))
    }

    func testForegroundSuppresses() {
        XCTAssertFalse(ChatNotifications.shouldNotify(appActive: true,
                                                      threadMuted: false,
                                                      enabled: true))
    }

    func testMutedThreadSuppresses() {
        XCTAssertFalse(ChatNotifications.shouldNotify(appActive: false,
                                                      threadMuted: true,
                                                      enabled: true))
    }

    func testDisabledToggleSuppresses() {
        XCTAssertFalse(ChatNotifications.shouldNotify(appActive: false,
                                                      threadMuted: false,
                                                      enabled: false))
    }

    // MARK: - Banner body

    func testPreviewUsesTheFirstNonEmptyLine() {
        XCTAssertEqual(ChatNotifications.preview(text: "\n\n  Done!  \nMore detail",
                                                 isError: false),
                       "Done!")
    }

    func testPreviewCapsLongReplies() {
        let long = String(repeating: "a", count: 400)
        let preview = ChatNotifications.preview(text: long, isError: false)
        XCTAssertEqual(preview.count, ChatNotifications.previewCap + 1) // + ellipsis
        XCTAssertTrue(preview.hasSuffix("…"))
    }

    func testErrorTurnsStillProduceABody() {
        XCTAssertEqual(ChatNotifications.preview(text: "", isError: true),
                       "The run failed.")
        XCTAssertEqual(ChatNotifications.preview(text: "boom", isError: true),
                       "⚠️ boom")
    }

    func testEmptySuccessGetsAFallbackBody() {
        XCTAssertEqual(ChatNotifications.preview(text: "  \n ", isError: false),
                       "Reply ready.")
    }

    // MARK: - Deep link round-trip

    func testDeepLinkRoundTripsThreadId() throws {
        let url = try XCTUnwrap(ChatNotifications.deepLinkURL(threadId: "T-123"))
        XCTAssertEqual(url.absoluteString, "covencave://thread/T-123")
        XCTAssertEqual(ChatNotifications.threadId(fromDeepLink: url), "T-123")
    }

    func testForeignURLsCarryNoThreadId() {
        for raw in ["covencave://reminders", "covencave://thread", "covencave://thread/",
                    "https://thread/abc", "covencave://tasks/xyz", "covencave://task/card-123"] {
            let url = URL(string: raw)!
            XCTAssertNil(ChatNotifications.threadId(fromDeepLink: url), raw)
        }
    }

    func testReminderDeepLinkDoesNotOfferRetiredTaskEntity() {
        XCTAssertNil(ReminderNotifications.deepLinkURL(taskId: "card-123"))
    }

    func testReminderDeepLinkUsesThreadEntityForLinkedSessionOrThread() throws {
        let url = try XCTUnwrap(
            ReminderNotifications.deepLinkURL(for: reminder(link: Reminder.Link(
                kind: .session,
                ref: "session-123",
                threadId: "thread-123"
            )))
        )
        XCTAssertEqual(url.absoluteString, "covencave://thread/thread-123")
    }

    func testReminderDeepLinkDoesNotOfferLinkedCard() {
        XCTAssertNil(
            ReminderNotifications.deepLinkURL(for: reminder(link: Reminder.Link(
                kind: .card,
                taskId: "card-123"
            )))
        )
    }

    func testReminderDeepLinkDoesNotFallBackToTasks() {
        XCTAssertNil(ReminderNotifications.deepLinkURL(for: reminder()))
        XCTAssertNil(ReminderNotifications.deepLinkURL())
    }

    func testRetirementOnlyMatchesReminderNotificationIdentifiers() {
        XCTAssertTrue(ReminderNotifications.isRetiredRequest(identifier: "cave.reminder.rem-1"))
        for identifier in ["cave.chat.thread-1", "cave.connection.reconnected", "other.reminder.1"] {
            XCTAssertFalse(ReminderNotifications.isRetiredRequest(identifier: identifier), identifier)
        }
    }

    @MainActor
    func testColdNotificationTapWaitsForOpenHandler() throws {
        let delegate = CaveNotificationDelegate()
        let url = try XCTUnwrap(URL(string: "covencave://thread/cold-notification"))
        var opened: URL?

        delegate.open(url)
        XCTAssertNil(opened)

        delegate.onOpen = { opened = $0 }
        XCTAssertEqual(opened, url)
    }
}
