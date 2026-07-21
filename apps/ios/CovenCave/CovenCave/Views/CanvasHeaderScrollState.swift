import CoreGraphics

struct CanvasHeaderScrollState {
    private enum Direction: Equatable {
        case up
        case down
    }

    private(set) var controlsVisible = true
    private var lastOffset: CGFloat?
    private var accumulatedDistance: CGFloat = 0
    private var lastDirection: Direction?

    static func normalizedOffset(contentOffsetY: CGFloat, topInset: CGFloat) -> CGFloat {
        max(0, contentOffsetY + topInset)
    }

    @discardableResult
    mutating func observe(offset: CGFloat) -> Bool {
        if offset <= 4 {
            controlsVisible = true
            resetMotionTracking(for: offset)
            return controlsVisible
        }

        guard let previousOffset = lastOffset else {
            lastOffset = offset
            accumulatedDistance = 0
            lastDirection = nil
            return controlsVisible
        }

        let delta = offset - previousOffset
        if abs(delta) < 0.5 {
            return controlsVisible
        }

        let direction: Direction = delta > 0 ? .up : .down
        if direction != lastDirection {
            accumulatedDistance = 0
            lastDirection = direction
        }

        accumulatedDistance += abs(delta)
        lastOffset = offset

        switch direction {
        case .up:
            guard controlsVisible, accumulatedDistance >= 24 else { return controlsVisible }
            controlsVisible = false
            resetMotionTracking(for: offset)
            return controlsVisible
        case .down:
            guard !controlsVisible, accumulatedDistance >= 8 else { return controlsVisible }
            controlsVisible = true
            resetMotionTracking(for: offset)
            return controlsVisible
        }
    }

    private mutating func resetMotionTracking(for offset: CGFloat) {
        lastOffset = offset
        accumulatedDistance = 0
        lastDirection = nil
    }
}
