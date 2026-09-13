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
