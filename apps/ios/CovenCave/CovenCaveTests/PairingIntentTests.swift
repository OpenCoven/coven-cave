import XCTest
@testable import CovenCave

@MainActor
final class PairingIntentTests: XCTestCase {
    func testConnectDeepLinkQueuesPairingIntentWithoutChangingConnection() throws {
        let app = AppModel()
        let existing = CaveConnection(host: "old-desktop.example.ts.net")
        app.connection = existing
        let url = try XCTUnwrap(
            URL(string: "covencave://connect?host=new-desktop.example.ts.net&token=new-secret")
        )

        app.handleDeepLink(url)

        XCTAssertEqual(app.pendingPairingIntent?.host, "new-desktop.example.ts.net")
        XCTAssertEqual(app.pendingPairingIntent?.token, "new-secret")
        XCTAssertEqual(app.connection, existing)
    }

    func testConnectDeepLinkPreservesRequestedChatUntilPairingCompletes() throws {
        let app = AppModel()
        let url = try XCTUnwrap(
            URL(string: "covencave://connect?host=new-desktop.example.ts.net&token=new-secret#chat-thread-123")
        )

        app.handleDeepLink(url)

        XCTAssertEqual(app.pendingPairingIntent?.threadId, "thread-123")
    }

    func testCompletedPairingQueuesRequestedChatNavigation() {
        let app = AppModel()
        let intent = PairingIntent(
            host: "new-desktop.example.ts.net",
            token: "new-secret",
            threadId: "thread-123"
        )
        app.connection = CaveConnection(host: intent.host)
        app.connectionState = .connected
        app.stagePairingDestination(intent)
        app.armPairingDestination(intent, lease: app.captureConnectionDispatchLease())

        app.resumePairingDestination(intent)

        XCTAssertEqual(
            app.pendingProjectNavigationIntent,
            ProjectNavigationIntent(entity: .thread(id: "thread-123"), destination: .chats)
        )
    }

    func testSupersededPairingDoesNotNavigateOnTheReplacementConnection() {
        let app = AppModel()
        let intent = PairingIntent(
            host: "old-desktop.example.ts.net",
            token: "old-secret",
            threadId: "thread-123"
        )
        app.stagePairingDestination(intent)
        app.connection = CaveConnection(host: "replacement.example.ts.net")
        app.connectionState = .connected
        app.armPairingDestination(intent, lease: app.captureConnectionDispatchLease())

        app.resumePairingDestination(intent)

        XCTAssertNil(app.pendingProjectNavigationIntent)
    }

    func testDiscoveryRelocationStillNavigatesOnThePairedHost() {
        let app = AppModel()
        let intent = PairingIntent(
            host: "desktop.example.ts.net",
            token: "secret",
            threadId: "thread-123"
        )
        app.stagePairingDestination(intent)
        app.connection = CaveConnection(host: "https://desktop.example.ts.net:8443")
        app.connectionState = .connected
        app.armPairingDestination(intent, lease: app.captureConnectionDispatchLease())

        XCTAssertEqual(app.pendingProjectNavigationIntent?.threadId, "thread-123")
    }

    func testPairingDestinationWaitsForTheConnectionToBecomeReady() {
        let app = AppModel()
        let intent = PairingIntent(
            host: "new-desktop.example.ts.net",
            token: "new-secret",
            threadId: "thread-123"
        )
        app.connection = CaveConnection(host: intent.host)
        app.connectionState = .checking
        app.stagePairingDestination(intent)
        app.armPairingDestination(intent, lease: app.captureConnectionDispatchLease())

        app.resumePairingDestination(intent)

        XCTAssertNil(app.pendingProjectNavigationIntent)

        app.connectionState = .connected

        XCTAssertEqual(app.pendingProjectNavigationIntent?.threadId, "thread-123")
    }

    func testPairingDestinationSurvivesDelayedConnectionAfterPortRelocation() {
        let app = AppModel()
        let intent = PairingIntent(
            host: "desktop.example.ts.net",
            token: "secret",
            threadId: "thread-123"
        )
        let original = CaveConnection(host: "https://desktop.example.ts.net:3000")
        let relocated = CaveConnection(host: "https://desktop.example.ts.net:8443")
        app.connection = original
        app.connectionState = .checking
        app.stagePairingDestination(intent)
        app.armPairingDestination(intent, lease: app.captureConnectionDispatchLease())

        app.rebasePairingDestinationLease(from: original, to: relocated)
        app.connection = relocated
        app.connectionState = .connected

        XCTAssertEqual(app.pendingProjectNavigationIntent?.threadId, "thread-123")
    }

    func testNewerPairingSuppressesStaleDestinationOnTheSameHost() throws {
        let app = AppModel()
        let oldIntent = PairingIntent(
            host: "desktop.example.ts.net",
            token: "old-secret",
            threadId: "old-thread"
        )
        app.connection = CaveConnection(host: oldIntent.host)
        app.connectionState = .connected
        app.stagePairingDestination(oldIntent)
        let oldLease = app.captureConnectionDispatchLease()
        let replacementURL = try XCTUnwrap(
            URL(string: "covencave://connect?host=desktop.example.ts.net&token=new-secret#chat-new-thread")
        )
        app.handleDeepLink(replacementURL)

        app.armPairingDestination(oldIntent, lease: oldLease)
        app.resumePairingDestination(oldIntent)

        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertEqual(app.pendingPairingIntent?.threadId, "new-thread")
    }

    func testNewerOrdinaryNavigationCancelsTheStagedPairingDestination() throws {
        let app = AppModel()
        let intent = PairingIntent(
            host: "desktop.example.ts.net",
            token: "secret",
            threadId: "thread-123"
        )
        app.connection = CaveConnection(host: intent.host)
        app.connectionState = .checking
        app.stagePairingDestination(intent)
        app.armPairingDestination(intent, lease: app.captureConnectionDispatchLease())
        let tasksURL = try XCTUnwrap(URL(string: "covencave://tasks"))

        app.handleDeepLink(tasksURL)
        app.connectionState = .connected

        XCTAssertEqual(
            app.pendingProjectNavigationIntent,
            ProjectNavigationIntent(destination: .tasks)
        )
        XCTAssertNotEqual(app.pendingProjectNavigationIntent?.threadId, intent.threadId)
    }

    func testPairingWithoutDestinationPreservesPendingProjectNavigation() {
        let app = AppModel()
        let pendingNavigation = ProjectNavigationIntent(destination: .tasks)
        app.pendingProjectNavigationIntent = pendingNavigation
        let pairing = PairingIntent(
            host: "desktop.example.ts.net",
            token: "secret"
        )

        app.stagePairingDestination(pairing)

        XCTAssertEqual(app.pendingProjectNavigationIntent, pendingNavigation)
    }

    func testNonConnectDeepLinkStillRoutesWithoutCreatingPairingIntent() throws {
        let suiteName = "PairingIntentTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let app = AppModel(defaults: defaults, restoreLocalState: false)
        app.selectedTab = .settings
        let url = try XCTUnwrap(URL(string: "covencave://tasks"))

        app.handleDeepLink(url)

        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.deepLink, .tasks)
        XCTAssertNil(app.pendingProjectNavigationIntent)
        XCTAssertNil(app.pendingPairingIntent)
    }

    func testMatchingPendingPairingIntentIsConsumedConditionally() throws {
        let app = AppModel()
        let url = try XCTUnwrap(
            URL(string: "covencave://connect?host=new-desktop.example.ts.net&token=new-secret")
        )
        app.handleDeepLink(url)
        let intent = try XCTUnwrap(app.pendingPairingIntent)

        XCTAssertTrue(app.consumePendingPairingIntent(matching: intent.id))
        XCTAssertNil(app.pendingPairingIntent)
    }

    func testNonmatchingPendingPairingIntentIsPreserved() throws {
        let app = AppModel()
        let url = try XCTUnwrap(
            URL(string: "covencave://connect?host=new-desktop.example.ts.net&token=new-secret")
        )
        app.handleDeepLink(url)
        let intent = try XCTUnwrap(app.pendingPairingIntent)

        XCTAssertFalse(app.consumePendingPairingIntent(matching: UUID()))
        XCTAssertEqual(app.pendingPairingIntent, intent)
    }

    func testNewIntentSurvivesCompletionOfOlderIntent() throws {
        let app = AppModel()
        let oldURL = try XCTUnwrap(
            URL(string: "covencave://connect?host=old-request.example.ts.net&token=old-secret")
        )
        let newURL = try XCTUnwrap(
            URL(string: "covencave://connect?host=new-request.example.ts.net&token=new-secret")
        )
        app.handleDeepLink(oldURL)
        let oldIntent = try XCTUnwrap(app.pendingPairingIntent)
        app.handleDeepLink(newURL)
        let newIntent = try XCTUnwrap(app.pendingPairingIntent)

        XCTAssertNotEqual(oldIntent.id, newIntent.id)
        XCTAssertFalse(app.consumePendingPairingIntent(matching: oldIntent.id))
        XCTAssertEqual(app.pendingPairingIntent, newIntent)
    }

    func testTakingMatchingPendingPairingIntentReturnsPayloadAndClearsIt() throws {
        let app = AppModel()
        let url = try XCTUnwrap(
            URL(string: "covencave://connect?host=new-desktop.example.ts.net&token=new-secret")
        )
        app.handleDeepLink(url)
        let intent = try XCTUnwrap(app.pendingPairingIntent)

        XCTAssertEqual(app.takePendingPairingIntent(matching: intent.id), intent)
        XCTAssertNil(app.pendingPairingIntent)
    }

    func testTakingNonmatchingPendingPairingIntentPreservesIt() throws {
        let app = AppModel()
        let url = try XCTUnwrap(
            URL(string: "covencave://connect?host=new-desktop.example.ts.net&token=new-secret")
        )
        app.handleDeepLink(url)
        let intent = try XCTUnwrap(app.pendingPairingIntent)

        XCTAssertNil(app.takePendingPairingIntent(matching: UUID()))
        XCTAssertEqual(app.pendingPairingIntent, intent)
    }

    func testTakingReplacedIntentCannotReturnStalePayload() throws {
        let app = AppModel()
        let oldURL = try XCTUnwrap(
            URL(string: "covencave://connect?host=old-request.example.ts.net&token=old-secret")
        )
        let newURL = try XCTUnwrap(
            URL(string: "covencave://connect?host=new-request.example.ts.net&token=new-secret")
        )
        app.handleDeepLink(oldURL)
        let oldIntent = try XCTUnwrap(app.pendingPairingIntent)
        app.handleDeepLink(newURL)
        let newIntent = try XCTUnwrap(app.pendingPairingIntent)

        XCTAssertNil(app.takePendingPairingIntent(matching: oldIntent.id))
        XCTAssertEqual(app.pendingPairingIntent, newIntent)
    }

    func testPairingIntentIdentityIsUniqueEvenForIdenticalPayloads() {
        let first = PairingIntent(host: "desktop.example.ts.net", token: "secret")
        let second = PairingIntent(host: "desktop.example.ts.net", token: "secret")

        XCTAssertNotEqual(first.id, second.id)
        XCTAssertNotEqual(first, second)
    }

    func testPendingPairingProcessorDefersWhileLockedAuthenticatingOrAlreadyProcessing() {
        XCTAssertFalse(PendingPairingProcessorPolicy.mayBegin(
            isLocked: true,
            isAuthenticating: false,
            isProcessing: false,
            isActive: true
        ))
        XCTAssertFalse(PendingPairingProcessorPolicy.mayBegin(
            isLocked: false,
            isAuthenticating: true,
            isProcessing: false,
            isActive: true
        ))
        XCTAssertFalse(PendingPairingProcessorPolicy.mayBegin(
            isLocked: false,
            isAuthenticating: false,
            isProcessing: true,
            isActive: true
        ))
    }

    func testPendingPairingProcessorDefersWhileSceneIsInactiveOrBackgrounded() {
        XCTAssertFalse(PendingPairingProcessorPolicy.mayBegin(
            isLocked: false,
            isAuthenticating: false,
            isProcessing: false,
            isActive: false
        ))
    }

    func testPendingPairingProcessorBeginsWhileUnlockedIdleAndActive() {
        XCTAssertTrue(PendingPairingProcessorPolicy.mayBegin(
            isLocked: false,
            isAuthenticating: false,
            isProcessing: false,
            isActive: true
        ))
    }

    func testInitialPairingDoesNotRequireApproval() {
        XCTAssertFalse(PairingApprovalPolicy.requiresApproval(hasExistingPairing: false))
    }

    func testReplacingExistingPairingRequiresApproval() {
        XCTAssertTrue(PairingApprovalPolicy.requiresApproval(hasExistingPairing: true))
    }
}
