import XCTest
@testable import CovenCave

/// The focused drawer hierarchy and its broader keyboard destination order.
final class DrawerDestinationOrderTests: XCTestCase {

    func testDrawerKeepsOnlyChatsAndTasksAsPrimaryDestinations() {
        XCTAssertEqual(AppTab.drawerDestinations, [.chats, .tasks])
        XCTAssertEqual(AppTab.drawerDestinations.count, Set(AppTab.drawerDestinations).count,
                       "a drawer destination is placed twice")
        XCTAssertFalse(AppTab.drawerDestinations.contains(.settings),
                       "Settings is reached from the profile avatar, not a primary row")
    }

    /// ⌘1–3 must cover every destination exactly once so every application surface
    /// remains keyboard-reachable.
    func testShortcutOrderCoversAllDestinationsExactlyOnce() {
        XCTAssertEqual(AppTab.shortcutOrder.count, AppTab.allCases.count)
        XCTAssertEqual(Set(AppTab.shortcutOrder), Set(AppTab.allCases))
    }

    func testShortcutOrderKeepsSettingsReachable() {
        XCTAssertEqual(AppTab.shortcutOrder, [.chats, .tasks, .settings])
    }

    /// Raw values are persisted and used by deterministic launch selectors.
    func testRawValuesAreStable() {
        let expected: [AppTab: String] = [
            .chats: "chats", .tasks: "tasks", .settings: "settings",
        ]
        XCTAssertEqual(expected.count, AppTab.allCases.count)
        for (tab, raw) in expected {
            XCTAssertEqual(tab.rawValue, raw)
            XCTAssertEqual(AppTab(rawValue: raw), tab)
        }
    }
}
