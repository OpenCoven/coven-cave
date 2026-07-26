import XCTest
@testable import CovenCave

@MainActor
final class LaunchThreadIntentTests: XCTestCase {

    func testLaunchThreadIntentWaitsForHydrationAndConsumesOnlyOnce() {
        let app = AppModel()
        app.launchThreadId = "hydrated-thread"

        XCTAssertNil(app.consumeLaunchThreadIntent())
        XCTAssertEqual(app.launchThreadId, "hydrated-thread")

        let expected = ChatThread(id: "hydrated-thread", title: "Hydrated", familiarIds: [])
        app.threads = [expected]

        XCTAssertTrue(app.consumeLaunchThreadIntent() === expected)
        XCTAssertNil(app.launchThreadId)
        XCTAssertNil(app.consumeLaunchThreadIntent())
    }
}
