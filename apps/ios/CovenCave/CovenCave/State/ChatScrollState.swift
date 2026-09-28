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

/// A shrinking latest reply can leave the scroll view holding an offset beyond
/// its new extent (#5613). This observer belongs to the viewport, not a row
/// that can be unmounted, and it only clamps that invalid offset back into
/// range. Two independent signals must agree before it arms:
///
/// - the latest row itself got shorter (same row id, measured height), and
/// - the viewport reports an offset beyond the valid content extent.
///
/// Lazy history rows re-estimating their heights while the reader scrolls
/// up can shrink the total content height for a frame before UIKit settles
/// the offset. That transient is not a shrink of the latest reply, so it never
/// arms recovery and never pulls a reader of older content back to latest.
/// Normal streaming growth, a valid history position, and an active gesture
/// are likewise never treated as a request to follow the latest message.
struct ChatViewportRecovery {
    private var geometry: ChatViewportGeometry?
    private var latestRowId: String?
    private var latestRowHeight: CGFloat?
    private var latestRowShrank = false
    private var pending = false

    /// The latest row's own measured height. A different row id (a new
    /// message, another thread) is a fresh baseline, not a shrink.
    mutating func noteLatestRow(id: String, height: CGFloat) {
        guard height.isFinite, height > 0 else { return }
        if latestRowId == id, let latestRowHeight, height < latestRowHeight - 1 {
            latestRowShrank = true
        }
        latestRowId = id
        latestRowHeight = height
        // The viewport may not have reported the new extent yet; a stale
        // in-range geometry must not discard this evidence.
        evaluate(consumesEvidence: false)
    }

    mutating func update(_ geometry: ChatViewportGeometry) {
        guard geometry.isValid else { return }
        self.geometry = geometry
        evaluate(consumesEvidence: true)
    }

    /// Whether a correction is waiting; the caller re-checks with
    /// `takeRecovery` after one runloop turn so a settling frame can cancel it.
    var hasPendingRecovery: Bool { pending }

    mutating func takeRecovery(isUserScrolling: Bool) -> Bool {
        guard pending, !isUserScrolling, geometry?.isBeyondEnd == true else { return false }
        pending = false
        latestRowShrank = false
        return true
    }

    private mutating func evaluate(consumesEvidence: Bool) {
        guard let geometry else { return }
        if geometry.isBeyondEnd {
            if latestRowShrank { pending = true }
        } else if consumesEvidence {
            // A valid offset consumes any shrink evidence: UIKit (or the
            // reader) already landed somewhere legitimate.
            pending = false
            latestRowShrank = false
        }
    }
}
