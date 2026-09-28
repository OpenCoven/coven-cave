import Foundation

/// Layout changes are not a request to stop following the conversation.
struct ChatScrollState {
    private(set) var isAtBottom = true
    private(set) var isFollowingLatest = true
    private(set) var isUserScrolling = false

    mutating func updateGeometry(atBottom: Bool) {
        isAtBottom = atBottom
        if atBottom && !isUserScrolling {
            isFollowingLatest = true
        }
    }

    mutating func beginUserScroll() {
        isUserScrolling = true
        isFollowingLatest = false
    }

    mutating func endUserScroll() {
        guard isUserScrolling else { return }
        isUserScrolling = false
        isFollowingLatest = isAtBottom
    }

    mutating func followLatest() {
        isFollowingLatest = true
        isUserScrolling = false
    }
}

struct ChatScrollGeometry: Equatable {
    // Both values are local to the latest row, not the lazy stack's estimate.
    let contentHeight: CGFloat
    let visibleBottom: CGFloat

    var isAtBottom: Bool { visibleBottom >= contentHeight - 24 }
}

/// Reduced viewport signal: ordinary in-range scroll offsets compare equal, so
/// observing recovery does not invalidate ChatView on every scrolling frame.
struct ChatViewportGeometry: Equatable {
    let contentHeight: CGFloat
    let isBeyondEnd: Bool
    let isValid: Bool

    init(contentHeight: CGFloat, viewportHeight: CGFloat, contentOffset: CGFloat,
         topInset: CGFloat, bottomInset: CGFloat) {
        self.contentHeight = contentHeight
        self.isValid = [contentHeight, viewportHeight, contentOffset, topInset, bottomInset]
            .allSatisfy { $0.isFinite } && contentHeight > 0 && viewportHeight > 0
        let maximumOffset = max(-topInset, contentHeight + bottomInset - viewportHeight)
        self.isBeyondEnd = isValid && contentOffset > maximumOffset + 24
    }
}

/// A shrinking lazy transcript can retain an offset beyond its new extent.
/// This observer belongs to the viewport, not a row that can be unmounted.
/// It never treats normal streaming growth or a valid history position as a
/// request to follow the latest message, and never fights an active gesture.
struct ChatViewportRecovery {
    private var previousHeight: CGFloat?
    private var pending = false

    mutating func update(_ geometry: ChatViewportGeometry) {
        guard geometry.isValid else { return }
        if let previousHeight, geometry.contentHeight < previousHeight - 1,
           geometry.isBeyondEnd {
            pending = true
        }
        previousHeight = geometry.contentHeight
        if !geometry.isBeyondEnd { pending = false }
    }

    mutating func takeRecovery(isUserScrolling: Bool) -> Bool {
        guard pending, !isUserScrolling else { return false }
        pending = false
        return true
    }
}
