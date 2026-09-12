import XCTest
@testable import CovenCave

/// The focused drawer hierarchy and its broader keyboard destination order.
final class DrawerDestinationOrderTests: XCTestCase {

    func testDrawerKeepsOnlyChatsAndSettingsAsPrimaryDestinations() {
        XCTAssertEqual(AppTab.drawerDestinations, [.chats, .settings])
        XCTAssertEqual(AppTab.drawerDestinations.count, Set(AppTab.drawerDestinations).count,
                       "a drawer destination is placed twice")
        XCTAssertFalse(AppTab.drawerDestinations.contains(.tasks),
                       "Tasks is not a native iOS destination; chat-only omits it entirely")
    }

    /// ⌘1–2 must cover every REACHABLE destination exactly once. `.tasks` is
    /// retained on `AppTab` only for legacy deep-link decoding (see the enum's
    /// doc comment) and is deliberately excluded from both `drawerDestinations`
    /// and `shortcutOrder` — it has no UI surface to shortcut into.
    func testShortcutOrderCoversAllReachableDestinationsExactlyOnce() {
        XCTAssertEqual(AppTab.shortcutOrder.count, AppTab.drawerDestinations.count)
        XCTAssertEqual(Set(AppTab.shortcutOrder), Set(AppTab.drawerDestinations))
        XCTAssertFalse(AppTab.shortcutOrder.contains(.tasks),
                       "Tasks has no UI surface, so it must not receive a keyboard shortcut")
    }

    func testShortcutOrderKeepsSettingsReachable() {
        XCTAssertEqual(AppTab.shortcutOrder, [.chats, .settings])
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
