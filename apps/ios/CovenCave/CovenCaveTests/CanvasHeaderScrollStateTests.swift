import XCTest
@testable import CovenCave

final class CanvasHeaderScrollStateTests: XCTestCase {
    func testNormalizedOffsetAddsInsetAndClampsAtZero() {
        XCTAssertEqual(CanvasHeaderScrollState.normalizedOffset(contentOffsetY: -12, topInset: 8), 0)
        XCTAssertEqual(CanvasHeaderScrollState.normalizedOffset(contentOffsetY: 12, topInset: 8), 20)
    }

    func testIncreasingNormalizedOffsetHidesAfterTwentyFourPoints() {
        var state = CanvasHeaderScrollState()

        XCTAssertTrue(state.observe(offset: 40))
        XCTAssertTrue(state.observe(offset: 52))
        XCTAssertFalse(state.observe(offset: 64))
        XCTAssertFalse(state.controlsVisible)
    }

    func testDecreasingNormalizedOffsetRevealsAfterEightPointsAfterDirectionChange() {
        var state = CanvasHeaderScrollState()

        _ = state.observe(offset: 40)
        _ = state.observe(offset: 52)
        _ = state.observe(offset: 64)
        XCTAssertFalse(state.controlsVisible)

        XCTAssertFalse(state.observe(offset: 60))
        XCTAssertTrue(state.observe(offset: 56))
        XCTAssertTrue(state.controlsVisible)
    }

    func testDirectionChangeResetsAccumulatedDistanceBeforeHiding() {
        var state = CanvasHeaderScrollState()

        XCTAssertTrue(state.observe(offset: 40))
        XCTAssertTrue(state.observe(offset: 50))
        XCTAssertTrue(state.observe(offset: 45))

        XCTAssertTrue(state.observe(offset: 55))
        XCTAssertTrue(state.controlsVisible)

        XCTAssertTrue(state.observe(offset: 68))
        XCTAssertTrue(state.controlsVisible)

        XCTAssertFalse(state.observe(offset: 69))
        XCTAssertFalse(state.controlsVisible)
    }

    func testRepeatedSubHalfPointMotionEventuallyHidesWithoutAdvancingBaseline() {
        var state = CanvasHeaderScrollState()

        XCTAssertTrue(state.observe(offset: 40))
        for step in 1..<80 {
            XCTAssertTrue(state.observe(offset: 40 + (0.3 * CGFloat(step))))
        }
        XCTAssertFalse(state.observe(offset: 64))
        XCTAssertFalse(state.controlsVisible)
    }

    func testOscillatingJitterBelowHalfPointStaysVisible() {
        var state = CanvasHeaderScrollState()

        XCTAssertTrue(state.observe(offset: 40))
        XCTAssertTrue(state.observe(offset: 39.7))
        XCTAssertTrue(state.observe(offset: 40.1))
        XCTAssertTrue(state.observe(offset: 39.8))
        XCTAssertTrue(state.controlsVisible)
    }

    func testNearTopAlwaysRevealsAndReturnsCurrentVisibility() {
        var visibleState = CanvasHeaderScrollState()
        XCTAssertTrue(visibleState.observe(offset: 3))
        XCTAssertTrue(visibleState.controlsVisible)

        var state = CanvasHeaderScrollState()

        _ = state.observe(offset: 40)
        _ = state.observe(offset: 52)
        _ = state.observe(offset: 64)
        XCTAssertFalse(state.controlsVisible)

        XCTAssertTrue(state.observe(offset: 3))
        XCTAssertTrue(state.controlsVisible)

        XCTAssertTrue(state.observe(offset: 5))
        XCTAssertTrue(state.controlsVisible)
        XCTAssertTrue(state.observe(offset: 17))
        XCTAssertTrue(state.controlsVisible)
    }

    func testNearTopResetClearsPriorAccumulationBeforeHiding() {
        var state = CanvasHeaderScrollState()

        XCTAssertTrue(state.observe(offset: 40))
        XCTAssertTrue(state.observe(offset: 52))

        XCTAssertTrue(state.observe(offset: 4))
        XCTAssertTrue(state.controlsVisible)

        XCTAssertTrue(state.observe(offset: 16))
        XCTAssertTrue(state.controlsVisible)

        XCTAssertTrue(state.observe(offset: 27))
        XCTAssertTrue(state.controlsVisible)

        XCTAssertFalse(state.observe(offset: 28))
        XCTAssertFalse(state.controlsVisible)
    }
}
