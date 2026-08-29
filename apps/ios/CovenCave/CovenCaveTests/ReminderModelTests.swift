import XCTest
@testable import CovenCave

final class ReminderModelTests: XCTestCase {
    func testReminderDecodesLinkedSessionAndCardCompatFieldsLeniently() throws {
        let data = Data(
            """
            {
              "ok": true,
              "items": [
                {
                  "id": "rem-session",
                  "kind": "reminder",
                  "title": "Resume thread",
                  "status": "pending",
                  "link": {
                    "kind": "session",
                    "ref": "session-123",
                    "sessionId": " session-123 ",
                    "threadId": "thread-123"
                  }
                },
                {
                  "id": "rem-card",
                  "kind": "reminder",
                  "title": "Open card",
                  "status": "pending",
                  "link": {
                    "kind": "card",
                    "ref": "card-ref",
                    "cardId": " card-123 ",
                    "taskId": "task-123"
                  }
                },
                {
                  "id": "rem-bad",
                  "kind": "reminder",
                  "title": "Broken link",
                  "status": "pending",
                  "link": 42
                }
              ]
            }
            """.utf8
        )

        let decoded = try JSONDecoder().decode(InboxResponse.self, from: data).items

        XCTAssertEqual(decoded[0].link?.resolvedThreadNavigationID, "thread-123")
        XCTAssertEqual(decoded[0].link?.sessionId, "session-123")
        XCTAssertEqual(decoded[1].link?.resolvedTaskID, "task-123")
        XCTAssertEqual(decoded[1].link?.cardId, "card-123")
        XCTAssertNil(decoded[2].link)
    }

    func testReminderRoundTripPreservesSimpleAndCompatLinkFields() throws {
        let reminder = Reminder(
            id: "rem-1",
            kind: "reminder",
            title: "Check in",
            status: "pending",
            link: Reminder.Link(
                kind: .session,
                ref: "session-123",
                sessionId: "session-123",
                threadId: "thread-123"
            )
        )

        let encoded = try JSONEncoder().encode(reminder)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        let link = try XCTUnwrap(object["link"] as? [String: Any])

        XCTAssertEqual(link["kind"] as? String, "session")
        XCTAssertEqual(link["ref"] as? String, "session-123")
        XCTAssertEqual(link["sessionId"] as? String, "session-123")
        XCTAssertEqual(link["threadId"] as? String, "thread-123")

        let simple = Reminder(
            id: "rem-2",
            kind: "reminder",
            title: "Open card",
            status: "pending",
            link: Reminder.Link(kind: .card, ref: "card-123")
        )
        let simpleEncoded = try JSONEncoder().encode(simple)
        let simpleObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: simpleEncoded) as? [String: Any]
        )
        let simpleLink = try XCTUnwrap(simpleObject["link"] as? [String: Any])

        XCTAssertEqual(simpleLink["kind"] as? String, "card")
        XCTAssertEqual(simpleLink["ref"] as? String, "card-123")
        XCTAssertNil(simpleLink["sessionId"])
        XCTAssertNil(simpleLink["threadId"])
        XCTAssertNil(simpleLink["cardId"])
        XCTAssertNil(simpleLink["taskId"])
    }
}

private actor RecordingReminderNotificationScheduler: ReminderNotificationScheduling {
    private var pending: [String: Reminder] = [:]
    private var syncCountValue = 0

    func requestAuthorizationIfNeeded() async {}

    func sync(_ reminders: [Reminder]) async {
        syncCountValue += 1
        pending = Dictionary(
            uniqueKeysWithValues: reminders
                .filter { $0.status == "pending" && $0.fireAt != nil }
                .map { ($0.id, $0) }
        )
    }

    func pendingIDs() -> [String] {
        pending.keys.sorted()
    }

    func pendingReminder(_ id: String) -> Reminder? {
        pending[id]
    }

    func syncCount() -> Int {
        syncCountValue
    }
}

private final class ReminderTestCoreClient: AppModelCoreResourceClient, ReminderManagingClient, @unchecked Sendable {
    typealias BulkHandler = (String, [String]) async throws -> CaveClient.BulkInboxOutcome
    typealias SingleHandler = (String) async throws -> Reminder?
    typealias SnoozeHandler = (String, Int) async throws -> Reminder?

    private let remindersValue: [Reminder]
    private let bulkHandler: BulkHandler
    private let markDoneHandler: SingleHandler
    private let dismissHandler: SingleHandler
    private let snoozeHandler: SnoozeHandler

    init(
        reminders: [Reminder],
        bulkHandler: @escaping BulkHandler = { _, _ in
            CaveClient.BulkInboxOutcome(updated: [], deletedIds: [])
        },
        markDoneHandler: @escaping SingleHandler = { _ in nil },
        dismissHandler: @escaping SingleHandler = { _ in nil },
        snoozeHandler: @escaping SnoozeHandler = { _, _ in nil }
    ) {
        self.remindersValue = reminders
        self.bulkHandler = bulkHandler
        self.markDoneHandler = markDoneHandler
        self.dismissHandler = dismissHandler
        self.snoozeHandler = snoozeHandler
    }

    func ping() async -> Bool { true }
    func projects() async throws -> [ProjectInfo] { [] }
    func projectGrants() async throws -> ProjectGrantsResponse {
        ProjectGrantsResponse(
            ok: true,
            grants: [],
            accessGroups: [],
            supremeFamiliarId: nil,
            mobileMutationsAllowed: nil,
            audit: nil,
            error: nil
        )
    }
    func familiars() async throws -> [Familiar] { [] }
    func sessions(includeArchived: Bool = false) async throws -> [SessionRow] { [] }
    func tasks() async throws -> [BoardCard] { [] }
    func fetchTheme() async throws -> ThemeSnapshot {
        ThemeSnapshot(
            themeId: "cave",
            mode: "dark",
            tokens: [:],
            updatedAt: "2026-08-19T00:00:00Z"
        )
    }
    func operatorProfile() async throws -> OperatorProfile {
        OperatorProfile(name: nil, pronouns: nil, avatarPresent: false, avatarUpdatedAt: nil)
    }
    func refreshAccessToken() async -> String? { nil }

    func reminders() async throws -> [Reminder] {
        remindersValue
    }

    func bulkInboxAction(
        _ action: String,
        ids: [String]
    ) async throws -> CaveClient.BulkInboxOutcome {
        try await bulkHandler(action, ids)
    }

    func markReminderDone(id: String) async throws -> Reminder? {
        try await markDoneHandler(id)
    }

    func dismissReminder(id: String) async throws -> Reminder? {
        try await dismissHandler(id)
    }

    func snoozeReminder(id: String, minutes: Int) async throws -> Reminder? {
        try await snoozeHandler(id, minutes)
    }
}

@MainActor
final class AppModelReminderNotificationTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        suiteName = "AppModelReminderNotificationTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private func makeApp(
        client: ReminderTestCoreClient,
        scheduler: RecordingReminderNotificationScheduler
    ) -> AppModel {
        let app = AppModel(
            defaults: defaults,
            restoreLocalState: false,
            coreResourceClientFactory: { _ in client },
            reminderNotificationScheduler: scheduler
        )
        app.connection = CaveConnection(host: "http://cave.test:3000")
        return app
    }

    private func scheduledReminder(
        _ id: String,
        status: String = "pending",
        fireAt: String,
        updatedAt: String? = nil
    ) -> Reminder {
        Reminder(
            id: id,
            kind: "reminder",
            title: id,
            status: status,
            fireAt: fireAt,
            updatedAt: updatedAt
        )
    }

    private func futureISO(_ secondsFromNow: TimeInterval) -> String {
        PermissionModels.isoFormatter.string(from: Date().addingTimeInterval(secondsFromNow))
    }

    func testDeleteRemindersPartialSuccessResyncsPendingNotifications() async {
        let keep = scheduledReminder("keep", fireAt: futureISO(600))
        let delete = scheduledReminder("delete", fireAt: futureISO(900))
        let scheduler = RecordingReminderNotificationScheduler()
        let client = ReminderTestCoreClient(
            reminders: [delete, keep],
            bulkHandler: { action, _ in
                XCTAssertEqual(action, "delete")
                return CaveClient.BulkInboxOutcome(updated: [], deletedIds: ["delete"])
            }
        )
        let app = makeApp(client: client, scheduler: scheduler)

        await app.loadReminders()
        await app.deleteReminders(["delete", "keep"])

        let pendingIDs = await scheduler.pendingIDs()
        let syncCount = await scheduler.syncCount()
        XCTAssertEqual(app.reminders.map(\.id), ["keep"])
        XCTAssertEqual(pendingIDs, ["keep"])
        XCTAssertEqual(syncCount, 2)
    }

    func testDismissReminderRemovesPendingNotificationAfterSuccess() async {
        let fireAt = futureISO(600)
        let pending = scheduledReminder("dismiss-me", fireAt: fireAt)
        let scheduler = RecordingReminderNotificationScheduler()
        let client = ReminderTestCoreClient(
            reminders: [pending],
            dismissHandler: { id in
                XCTAssertEqual(id, "dismiss-me")
                return Reminder(
                    id: id,
                    kind: "reminder",
                    title: id,
                    status: "dismissed",
                    fireAt: fireAt
                )
            }
        )
        let app = makeApp(client: client, scheduler: scheduler)

        await app.loadReminders()
        await app.dismissReminder(pending)

        let pendingIDs = await scheduler.pendingIDs()
        let syncCount = await scheduler.syncCount()
        XCTAssertEqual(app.reminders.first?.status, "dismissed")
        XCTAssertEqual(pendingIDs, [])
        XCTAssertEqual(syncCount, 2)
    }

    func testDismissReminderFailureKeepsPendingNotificationAfterRevert() async {
        let pending = scheduledReminder("dismiss-me", fireAt: futureISO(600))
        let scheduler = RecordingReminderNotificationScheduler()
        let client = ReminderTestCoreClient(
            reminders: [pending],
            dismissHandler: { _ in
                throw NSError(
                    domain: "AppModelReminderNotificationTests",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Network dropped"]
                )
            }
        )
        let app = makeApp(client: client, scheduler: scheduler)

        await app.loadReminders()
        await app.dismissReminder(pending)

        let pendingIDs = await scheduler.pendingIDs()
        let syncCount = await scheduler.syncCount()
        XCTAssertEqual(app.reminders.first?.status, "pending")
        XCTAssertEqual(app.remindersError, "Network dropped")
        XCTAssertEqual(pendingIDs, ["dismiss-me"])
        XCTAssertEqual(syncCount, 2)
    }

    func testMarkRemindersDonePartialSuccessResyncsPendingNotifications() async {
        let done = scheduledReminder("done-me", fireAt: futureISO(600))
        let keep = scheduledReminder("keep-me", fireAt: futureISO(900))
        let scheduler = RecordingReminderNotificationScheduler()
        let client = ReminderTestCoreClient(
            reminders: [done, keep],
            bulkHandler: { action, _ in
                XCTAssertEqual(action, "done")
                return CaveClient.BulkInboxOutcome(
                    updated: [
                        Reminder(
                            id: "done-me",
                            kind: "reminder",
                            title: "done-me",
                            status: "done",
                            fireAt: done.fireAt
                        ),
                    ],
                    deletedIds: []
                )
            }
        )
        let app = makeApp(client: client, scheduler: scheduler)

        await app.loadReminders()
        await app.markRemindersDone(["done-me", "keep-me"])

        let pendingIDs = await scheduler.pendingIDs()
        XCTAssertEqual(app.reminders.first(where: { $0.id == "done-me" })?.status, "done")
        XCTAssertEqual(app.reminders.first(where: { $0.id == "keep-me" })?.status, "pending")
        XCTAssertEqual(pendingIDs, ["keep-me"])
    }

    func testSnoozeRemindersPartialSuccessReplacesPendingNotification() async {
        let oldFireAt = futureISO(600)
        let revertedFireAt = futureISO(900)
        let newFireAt = futureISO(3_600)
        let snoozed = scheduledReminder("snoozed", fireAt: oldFireAt)
        let reverted = scheduledReminder("reverted", fireAt: revertedFireAt)
        let scheduler = RecordingReminderNotificationScheduler()
        let client = ReminderTestCoreClient(
            reminders: [snoozed, reverted],
            snoozeHandler: { id, minutes in
                XCTAssertEqual(minutes, 30)
                guard id == "snoozed" else {
                    throw NSError(
                        domain: "AppModelReminderNotificationTests",
                        code: 2,
                        userInfo: [NSLocalizedDescriptionKey: "Timed out"]
                    )
                }
                return Reminder(
                    id: id,
                    kind: "reminder",
                    title: id,
                    status: "pending",
                    fireAt: newFireAt
                )
            }
        )
        let app = makeApp(client: client, scheduler: scheduler)

        await app.loadReminders()
        await app.snoozeReminders(["snoozed", "reverted"], minutes: 30)

        let pendingIDs = await scheduler.pendingIDs()
        let snoozedPending = await scheduler.pendingReminder("snoozed")
        let revertedPending = await scheduler.pendingReminder("reverted")
        XCTAssertEqual(app.reminders.first(where: { $0.id == "snoozed" })?.fireAt, newFireAt)
        XCTAssertEqual(app.reminders.first(where: { $0.id == "reverted" })?.fireAt, revertedFireAt)
        XCTAssertEqual(pendingIDs, ["reverted", "snoozed"])
        XCTAssertEqual(snoozedPending?.fireAt, newFireAt)
        XCTAssertEqual(revertedPending?.fireAt, revertedFireAt)
    }
}
