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

        XCTAssertEqual(
            app.pendingPairingIntent,
            PairingIntent(host: "new-desktop.example.ts.net", token: "new-secret")
        )
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

    func testPendingPairingIntentRemainsWhileLockedAndConsumesOnceUnlocked() throws {
        let app = AppModel()
        let url = try XCTUnwrap(
            URL(string: "covencave://connect?host=new-desktop.example.ts.net&token=new-secret")
        )
        app.handleDeepLink(url)

        XCTAssertNil(app.takePendingPairingIntent(isLocked: true))
        XCTAssertNotNil(app.pendingPairingIntent)
        XCTAssertEqual(
            app.takePendingPairingIntent(isLocked: false),
            PairingIntent(host: "new-desktop.example.ts.net", token: "new-secret")
        )
        XCTAssertNil(app.pendingPairingIntent)
    }

    func testInitialPairingDoesNotRequireApproval() {
        XCTAssertFalse(PairingApprovalPolicy.requiresApproval(hasExistingPairing: false))
    }

    func testReplacingExistingPairingRequiresApproval() {
        XCTAssertTrue(PairingApprovalPolicy.requiresApproval(hasExistingPairing: true))
    }
}
