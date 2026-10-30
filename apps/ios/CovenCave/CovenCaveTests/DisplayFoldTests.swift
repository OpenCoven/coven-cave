import SwiftUI
import XCTest
@testable import CovenCave

/// Fold layout math against the geometry the iPhone Duo simulator reports
/// for its open inner display (iOS 27.1): a 951×669pt window whose division
/// region is 40pt wide — the hinge at x 475.5 plus 20pt interaction margins
/// either side — and an 84pt status-bar column on the trailing edge.
final class DisplayFoldTests: XCTestCase {
    private let window = CGRect(x: 0, y: 0, width: 951, height: 669)
    /// The window less the trailing status column and home indicator.
    private let safeArea = CGRect(x: 0, y: 0, width: 867, height: 635)

    private func bookFold(active: Bool = true) -> DisplayFold {
        DisplayFold(frame: CGRect(x: 455.5, y: 0, width: 40, height: 669), isActive: active, window: window)
    }

    /// The same device rotated: the hinge now runs side to side.
    private func tabletopFold() -> DisplayFold {
        let tall = CGRect(x: 0, y: 0, width: 669, height: 951)
        return DisplayFold(frame: CGRect(x: 0, y: 455.5, width: 669, height: 40), isActive: true, window: tall)
    }

    func testFoldAxisFollowsTheHinge() {
        XCTAssertEqual(bookFold().axis, .vertical)
        XCTAssertEqual(tabletopFold().axis, .horizontal)
        // Lying flat the region keeps its place; only `isActive` changes.
        XCTAssertEqual(bookFold(active: false).axis, .vertical)
    }

    func testSplitColumnEndsOnTheHingeOnlyWhileFolded() {
        XCTAssertEqual(FoldLayout.splitColumnWidth(container: window, fold: bookFold()), 476)
        XCTAssertNil(FoldLayout.splitColumnWidth(container: window, fold: bookFold(active: false)),
                     "flat, the sidebar keeps its usual width")
        XCTAssertNil(FoldLayout.splitColumnWidth(container: window, fold: tabletopFold()),
                     "a side-to-side hinge does not divide columns")
        XCTAssertNil(FoldLayout.splitColumnWidth(container: window, fold: nil))
    }

    func testSplitColumnIgnoresAHingeOutsideTheWindow() {
        // Split View on the inner display: this app holds only the left half.
        let leftHalf = CGRect(x: 0, y: 0, width: 470, height: 669)
        XCTAssertNil(FoldLayout.splitColumnWidth(container: leftHalf, fold: bookFold()))
    }

    func testBookFoldMovesACompositionPastTheHinge() {
        let insets = FoldLayout.avoidingInsets(container: safeArea, fold: bookFold(), tabletop: .bottom)
        XCTAssertEqual(insets.leading, 495.5, "content starts past the hinge and its margin")
        XCTAssertEqual(insets.trailing, 0)
        XCTAssertEqual(insets.top, 0)
        XCTAssertEqual(insets.bottom, 0)
    }

    func testBookFoldInsetIsRelativeToTheContainer() {
        // A detail column that starts where the split view capped the sidebar.
        let detail = CGRect(x: 420, y: 0, width: 447, height: 635)
        let insets = FoldLayout.avoidingInsets(container: detail, fold: bookFold(), tabletop: nil)
        XCTAssertEqual(insets.leading, 75.5)
    }

    func testNoInsetWithoutAnActiveFoldCrossingTheContainer() {
        let none = EdgeInsets()
        XCTAssertEqual(FoldLayout.avoidingInsets(container: safeArea, fold: nil, tabletop: .bottom), none)
        XCTAssertEqual(FoldLayout.avoidingInsets(container: safeArea, fold: bookFold(active: false), tabletop: .bottom), none)
        // A sidebar that ends before the hinge has nothing to avoid.
        let sidebar = CGRect(x: 0, y: 0, width: 420, height: 635)
        XCTAssertEqual(FoldLayout.avoidingInsets(container: sidebar, fold: bookFold(), tabletop: .bottom), none)
    }

    func testNoInsetWhenThePastHingePaneIsTooNarrow() {
        // Only 260pt would remain past the hinge: leave the content where it is.
        let narrow = CGRect(x: 0, y: 0, width: 755.5, height: 635)
        XCTAssertEqual(FoldLayout.avoidingInsets(container: narrow, fold: bookFold(), tabletop: .bottom), EdgeInsets())
    }

    func testTabletopUsesTheRequestedPane() {
        let tall = CGRect(x: 0, y: 0, width: 669, height: 917)
        let lower = FoldLayout.avoidingInsets(container: tall, fold: tabletopFold(), tabletop: .bottom)
        XCTAssertEqual(lower.top, 495.5, "controls move below the hinge")
        XCTAssertEqual(lower.bottom, 0)

        let upper = FoldLayout.avoidingInsets(container: tall, fold: tabletopFold(), tabletop: .top)
        XCTAssertEqual(upper.bottom, 461.5, "something to read moves above it")
        XCTAssertEqual(upper.top, 0)

        XCTAssertEqual(FoldLayout.avoidingInsets(container: tall, fold: tabletopFold(), tabletop: nil), EdgeInsets(),
                       "scrolling content stays put across a tabletop fold")
    }
}
