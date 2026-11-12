import SwiftUI
import XCTest
@testable import CovenCave

/// The window-width rule behind every split view: two real columns need
/// 700pt, whatever size class the system reports.
final class SplitWidthTests: XCTestCase {
    func testWideWindowsSplitEvenWhenTheSystemSaysCompact() {
        // A non-Max iPhone in landscape, and iPhone Duo's open inner display.
        XCTAssertEqual(SplitWidth.sizeClass(forWidth: 852, inherited: .compact), .regular)
        XCTAssertEqual(SplitWidth.sizeClass(forWidth: 867, inherited: .regular), .regular)
    }

    func testNarrowRegularWindowsStack() {
        // iPhone Duo's inner display rotated upright.
        XCTAssertEqual(SplitWidth.sizeClass(forWidth: 669, inherited: .regular), .compact)
    }

    func testNarrowCompactWindowsAreUnchanged() {
        // iPhone Duo's closed outer display and any iPhone in portrait.
        XCTAssertEqual(SplitWidth.sizeClass(forWidth: 381, inherited: .compact), .compact)
        XCTAssertNil(SplitWidth.sizeClass(forWidth: 381, inherited: nil))
    }

    func testTheBoundaryIsInclusive() {
        XCTAssertEqual(SplitWidth.sizeClass(forWidth: 700, inherited: .compact), .regular)
        XCTAssertEqual(SplitWidth.sizeClass(forWidth: 699.5, inherited: .regular), .compact)
    }
}
