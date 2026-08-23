import XCTest
@testable import CovenCave

/// The Familiar hub's tab IA (`cave-9rwd.2`).
///
/// The same shape as `DrawerDestinationOrderTests`: a placed-exactly-once
/// check, so a fourth tab added later cannot quietly fail to appear, and a
/// stable-raw-value check, because the selection is a persisted, deep-linkable
/// identity rather than an index into an array.
final class FamiliarHubNavigationTests: XCTestCase {

    func testEveryTabIsPlacedExactlyOnce() {
        XCTAssertEqual(
            FamiliarHubTab.ordered.count, Set(FamiliarHubTab.ordered).count,
            "a hub tab is placed twice")
        XCTAssertEqual(
            Set(FamiliarHubTab.ordered), Set(FamiliarHubTab.allCases),
            "every FamiliarHubTab must appear in the hub's tab bar")
    }

    /// Overview leads: the hub exists to answer "what is this Familiar doing",
    /// and opening on Profile would make the roster's tap land somewhere the
    /// old detail page already went.
    func testOverviewIsTheLeadingTab() {
        XCTAssertEqual(FamiliarHubTab.ordered.first, .overview)
        XCTAssertEqual(FamiliarHubTab.ordered, [.overview, .profile, .analytics])
    }

    func testRawValuesAreStable() {
        let expected: [FamiliarHubTab: String] = [
            .overview: "overview", .profile: "profile", .analytics: "analytics",
        ]
        XCTAssertEqual(expected.count, FamiliarHubTab.allCases.count)
        for (tab, raw) in expected {
            XCTAssertEqual(tab.rawValue, raw)
            XCTAssertEqual(tab.id, raw)
            XCTAssertEqual(FamiliarHubTab(rawValue: raw), tab)
        }
    }

    func testEveryTabHasItsOwnTitleAndIcon() {
        var titles = Set<String>()
        var icons = Set<String>()
        for tab in FamiliarHubTab.allCases {
            XCTAssertFalse(tab.title.isEmpty)
            XCTAssertFalse(tab.systemImage.isEmpty)
            XCTAssertTrue(titles.insert(tab.title).inserted, "\(tab) reuses another tab's title")
            XCTAssertTrue(icons.insert(tab.systemImage).inserted, "\(tab) reuses another tab's icon")
        }
    }
}
