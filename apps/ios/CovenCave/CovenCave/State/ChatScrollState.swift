import Foundation
import SwiftUI

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

/// The transcript's tail, keyed by thread: opening another thread is neither
/// an append nor a removal.
struct ChatTranscriptTail: Equatable {
    let threadId: String
    let count: Int
    let lastMessageId: String?
}

/// Whether a transcript change is the reader's own send (#5933). A send from
/// this phone appends a queued user message (online sends stay queued until
/// every fan-out leg settles; offline compose parks one) and then, in the same
/// synchronous call, any reply placeholders. So the newest message is a
/// placeholder by the time the view sees the change, and the decision reads
/// every message appended after the previous tail instead.
enum ChatOwnSend {
    static func isOwnSend(from old: ChatTranscriptTail, to new: ChatTranscriptTail,
                          messages: [DisplayMessage]) -> Bool {
        // Another thread, a removal, or an insert behind an unchanged tail
        // (reconnect replay) was not sent from the composer.
        guard old.threadId == new.threadId, new.count > old.count,
              new.lastMessageId != old.lastMessageId else { return false }
        let appended: ArraySlice<DisplayMessage>
        if let previous = old.lastMessageId,
           let index = messages.lastIndex(where: { $0.id == previous }) {
            appended = messages[(index + 1)...]
        } else {
            appended = messages.suffix(new.count - old.count)
        }
        // History pulled from another device carries user turns that were
        // never queued on this phone.
        return appended.contains { $0.role == .user && $0.isQueued }
    }
}

/// The floating day chip names the day a reader is scrolling through. A
/// programmatic scroll (the send-time reveal, a jump to latest) is not
/// reading, and a reader following latest is already at the newest day.
enum ChatDayChipPolicy {
    static func revealsChip(on phase: ScrollPhase) -> Bool {
        switch phase {
        case .tracking, .interacting, .decelerating: return true
        default: return false
        }
    }

    static func showsChip(active: Bool, followingLatest: Bool) -> Bool {
        active && !followingLatest
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
/// - the transcript itself got shorter: the latest row shrank in place (same
///   row id, measured height), or rows were removed from the transcript, and
/// - the viewport reports an offset beyond the valid content extent.
///
/// Lazy history rows re-estimating their heights while the reader scrolls
/// up can shrink the total content height for a frame before UIKit settles
/// the offset. That transient is not a shrink of the latest reply, so it never
/// arms recovery and never pulls a reader of older content back to latest.
/// Normal streaming growth, a valid history position, and an active gesture
/// are likewise never treated as a request to follow the latest message.
///
/// A reader following latest is the exception (#5933): following wants the
/// end of the transcript, so an offset beyond that end is never a place the
/// reader chose, and it is clamped once per excursion without shrink evidence.
struct ChatViewportRecovery {
    private var geometry: ChatViewportGeometry?
    private var latestRowId: String?
    private var latestRowHeight: CGFloat?
    private var latestRowShrank = false
    private var rowsRemoved = false
    private var pending = false
    private var followingLatest = false
    /// A follow-only correction was taken and the offset has not been seen
    /// back in range since: one correction per excursion beyond the end.
    private var followCorrectionTaken = false

    /// The latest row's own measured height. A different row id is a fresh
    /// baseline: an appended message is growth, and any evidence gathered for
    /// the previous row is discarded so the new row cannot inherit it.
    /// Removal is reported separately through `noteRowsRemoved()`.
    mutating func noteLatestRow(id: String, height: CGFloat) {
        guard height.isFinite, height > 0 else { return }
        if latestRowId == id {
            if let latestRowHeight, height < latestRowHeight - 1 {
                latestRowShrank = true
            }
        } else if latestRowId != nil, !rowsRemoved {
            latestRowShrank = false
            pending = false
            followCorrectionTaken = false
        }
        latestRowId = id
        latestRowHeight = height
        // The viewport may not have reported the new extent yet; a stale
        // in-range geometry must not discard this evidence.
        evaluate(consumesEvidence: false)
    }

    /// The transcript lost rows (a deleted or retracted message). The new last
    /// row is a different id, so this is the structural shrink signal that a
    /// same-id height comparison cannot see.
    mutating func noteRowsRemoved() {
        rowsRemoved = true
        evaluate(consumesEvidence: false)
    }

    /// Whether the reader is following latest outside a gesture. Resuming
    /// follow while already beyond the end arms a correction; leaving follow
    /// drops one that only following asked for, so a reader who scrolled
    /// away keeps their place. Shrink or removal evidence is kept either way.
    mutating func noteFollowingLatest(_ following: Bool) {
        guard following != followingLatest else { return }
        followingLatest = following
        if following {
            followCorrectionTaken = false
            evaluate(consumesEvidence: false)
        } else if !latestRowShrank, !rowsRemoved {
            pending = false
        }
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
        rowsRemoved = false
        followCorrectionTaken = true
        return true
    }

    private mutating func evaluate(consumesEvidence: Bool) {
        guard let geometry else { return }
        if geometry.isBeyondEnd {
            if latestRowShrank || rowsRemoved || (followingLatest && !followCorrectionTaken) {
                pending = true
            }
        } else if consumesEvidence {
            // A valid offset consumes any shrink evidence: UIKit (or the
            // reader) already landed somewhere legitimate.
            pending = false
            latestRowShrank = false
            rowsRemoved = false
            followCorrectionTaken = false
        }
    }
}
