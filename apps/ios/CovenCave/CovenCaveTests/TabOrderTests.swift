import XCTest
@testable import CovenCave

/// The tab bar IA: four surfaces in the bar (Chats, Tasks, Canvas, Search),
/// the occasional ones (Calendar, Developer, Settings) in a "More" section
/// that is a sidebar group on iPad and hidden from the iPhone tab bar. These
/// tests pin the invariants that keep every surface reachable and every
/// persisted/deep-linked tab value decodable.
final class TabOrderTests: XCTestCase {

    /// Every tab is either in the bar, in More, or the search role tab —
    /// no surface can silently fall out of the IA when cases are added.
    func testEveryTabIsPlacedExactlyOnce() {
        let placed = AppTab.barTabs + [.search] + AppTab.moreTabs
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

    /// Bar tabs come first in shortcut order (⌘1–3 match the visible bar,
    /// ⌘4 is search), so muscle memory tracks what's on screen.
    func testShortcutOrderLeadsWithBarTabs() {
        XCTAssertEqual(Array(AppTab.shortcutOrder.prefix(AppTab.barTabs.count)),
                       AppTab.barTabs)
        XCTAssertEqual(AppTab.shortcutOrder[AppTab.barTabs.count], .search)
    }

    /// Raw values are persisted (restored tab) and used in deep links —
    /// they must never change spelling.
    func testRawValuesAreStable() {
        let expected: [AppTab: String] = [
            .chats: "chats", .canvas: "canvas", .tasks: "tasks",
            .calendar: "calendar", .dev: "dev", .settings: "settings",
            .search: "search",
        ]
        XCTAssertEqual(expected.count, AppTab.allCases.count)
        for (tab, raw) in expected {
            XCTAssertEqual(tab.rawValue, raw)
            XCTAssertEqual(AppTab(rawValue: raw), tab)
        }
    }
}
