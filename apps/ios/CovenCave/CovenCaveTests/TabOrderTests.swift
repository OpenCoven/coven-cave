import XCTest
@testable import CovenCave

/// The four primary tabs and their keyboard order.
final class TabOrderTests: XCTestCase {

    func testEveryTabIsPlacedExactlyOnce() {
        let placed = AppTab.barTabs
        XCTAssertEqual(placed.count, Set(placed).count, "a tab is placed twice")
        XCTAssertEqual(Set(placed), Set(AppTab.allCases),
                       "every AppTab case must be placed in the tab IA")
    }

    /// ⌘1–N must cover every tab exactly once so relocated surfaces stay
    /// keyboard-reachable (hidden tabs remain selectable by value).
    func testShortcutOrderCoversAllTabsExactlyOnce() {
        XCTAssertEqual(AppTab.shortcutOrder.count, AppTab.allCases.count)
        XCTAssertEqual(Set(AppTab.shortcutOrder), Set(AppTab.allCases))
    }

    func testShortcutOrderLeadsWithBarTabs() {
        XCTAssertEqual(AppTab.shortcutOrder, AppTab.barTabs)
    }

    /// Raw values are persisted (restored tab) and used in deep links —
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
