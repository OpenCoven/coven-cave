import XCTest
@testable import CovenCave

/// The four primary drawer destinations and their keyboard order.
final class DrawerDestinationOrderTests: XCTestCase {

    func testEveryDestinationIsPlacedExactlyOnce() {
        let placed = AppTab.drawerDestinations
        XCTAssertEqual(placed.count, Set(placed).count, "a drawer destination is placed twice")
        XCTAssertEqual(Set(placed), Set(AppTab.allCases),
                       "every AppTab case must be placed in the drawer IA")
    }

    /// ⌘1–4 must cover every destination exactly once so every primary surface
    /// remains keyboard-reachable.
    func testShortcutOrderCoversAllDestinationsExactlyOnce() {
        XCTAssertEqual(AppTab.shortcutOrder.count, AppTab.allCases.count)
        XCTAssertEqual(Set(AppTab.shortcutOrder), Set(AppTab.allCases))
    }

    func testShortcutOrderMatchesDrawerDestinations() {
        XCTAssertEqual(AppTab.shortcutOrder, AppTab.drawerDestinations)
    }

    /// Raw values are persisted (restored destination) and used in deep links —
    /// they must never change spelling.
    func testRawValuesAreStable() {
        let expected: [AppTab: String] = [
            .chats: "chats", .tasks: "tasks", .terminal: "terminal",
            .settings: "settings",
        ]
        XCTAssertEqual(expected.count, AppTab.allCases.count)
        for (tab, raw) in expected {
            XCTAssertEqual(tab.rawValue, raw)
            XCTAssertEqual(AppTab(rawValue: raw), tab)
        }
    }
}
