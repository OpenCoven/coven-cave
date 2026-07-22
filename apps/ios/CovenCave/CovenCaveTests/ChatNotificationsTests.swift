import XCTest
@testable import CovenCave

/// The notify/suppress decision, banner-body construction, and deep-link
/// round-trip for chat turn-completion notifications. All pure logic — the
/// UNUserNotificationCenter plumbing is intentionally not under test.
final class ChatNotificationsTests: XCTestCase {

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
                    "https://thread/abc", "covencave://tasks/xyz"] {
            let url = URL(string: raw)!
            XCTAssertNil(ChatNotifications.threadId(fromDeepLink: url), raw)
        }
    }
}
