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

    func testNonConnectDeepLinkStillRoutesWithoutCreatingPairingIntent() throws {
        let app = AppModel()
        app.selectedTab = .settings
        let url = try XCTUnwrap(URL(string: "covencave://tasks"))

        app.handleDeepLink(url)

        XCTAssertEqual(app.selectedTab, .tasks)
        XCTAssertEqual(app.deepLink, .tasks)
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
            isProcessing: false
        ))
        XCTAssertFalse(PendingPairingProcessorPolicy.mayBegin(
            isLocked: false,
            isAuthenticating: true,
            isProcessing: false
        ))
        XCTAssertFalse(PendingPairingProcessorPolicy.mayBegin(
            isLocked: false,
            isAuthenticating: false,
            isProcessing: true
        ))
        XCTAssertTrue(PendingPairingProcessorPolicy.mayBegin(
            isLocked: false,
            isAuthenticating: false,
            isProcessing: false
        ))
    }

    func testInitialPairingDoesNotRequireApproval() {
        XCTAssertFalse(PairingApprovalPolicy.requiresApproval(hasExistingPairing: false))
    }

    func testReplacingExistingPairingRequiresApproval() {
        XCTAssertTrue(PairingApprovalPolicy.requiresApproval(hasExistingPairing: true))
    }
}
