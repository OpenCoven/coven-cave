import SwiftUI
import UIKit

private let chatScrollAnchorContentSpace = "chat-transcript-content"

/// Keeps what the reader is looking at in place when content above it changes
/// height (#6090), the way a browser's scroll anchoring does.
///
/// `LazyVStack` estimates unrealized rows, and a realized row can still grow when
/// WebKit replaces its loading placeholder. Growth above the viewport leaves the
/// offset unchanged, so everything on screen is pushed down: a reader at the
/// latest reply suddenly sees older text. While following latest the follow path
/// corrects this; once a gesture stops following, nothing did.
///
/// Positions are in content coordinates, so they move only when layout changes,
/// never because of scrolling, and a correction cannot feed back into itself.
struct ChatScrollAnchor {
    struct Row: Equatable {
        let minY: CGFloat
        let maxY: CGFloat
    }

    private var settled: [String: Row] = [:]
    private var pending: [String: Row] = [:]

    mutating func note(_ id: String, _ row: Row) {
        guard row.minY.isFinite, row.maxY.isFinite else { return }
        pending[id] = row
    }

    mutating func remove(_ id: String) {
        settled[id] = nil
        pending[id] = nil
    }

    /// Absorbs one layout pass and returns how far the offset must move to keep
    /// the anchor row still. Every row below a growing row reports the same
    /// move, so a pass yields one correction from one row rather than one per row.
    mutating func takeCorrection(viewportTop: CGFloat, viewportHeight: CGFloat, preserving: Bool) -> CGFloat {
        defer {
            settled.merge(pending) { _, new in new }
            pending.removeAll(keepingCapacity: true)
        }
        guard preserving,
              let id = anchorId(top: viewportTop, bottom: viewportTop + viewportHeight),
              let old = settled[id], let new = pending[id] else { return 0 }
        let delta = new.minY - old.minY
        return abs(delta) < 0.5 ? 0 : delta
    }

    /// The topmost row whose top edge is on screen. A row taller than the
    /// viewport may have none in view, so the row spanning the top edge is the
    /// fallback: that is the reader inside the latest reply.
    private func anchorId(top: CGFloat, bottom: CGFloat) -> String? {
        var inView: (id: String, minY: CGFloat)?
        var spanning: (id: String, minY: CGFloat)?
        for (id, row) in settled {
            if row.minY >= top, row.minY < bottom {
                if inView == nil || row.minY < inView!.minY { inView = (id, row.minY) }
            } else if row.minY < top, row.maxY > top {
                if spanning == nil || row.minY > spanning!.minY { spanning = (id, row.minY) }
            }
        }
        return inView?.id ?? spanning?.id
    }
}

/// Not observable on purpose: row positions change on layout passes, and the
/// transcript must not re-render because of them.
@MainActor
final class ChatScrollAnchorCoordinator {
    weak var scrollView: UIScrollView? {
        didSet {
            guard scrollView !== oldValue else { return }
            contentSizeObservation = nil
            if oldValue != nil { reset() }
            contentSizeObservation = scrollView?.observe(\.contentSize, options: [.new]) { [weak self] _, _ in
                MainActor.assumeIsolated { self?.scheduleFlush() }
            }
            // A row can report before the probe finds its UIScrollView.
            scheduleFlush()
        }
    }
    private var contentSizeObservation: NSKeyValueObservation?
    private var anchor = ChatScrollAnchor()
    private var preserving: (@MainActor () -> Bool)?
    private var flushScheduled = false
    /// SwiftUI can report a row's new position before UIKit publishes the
    /// matching scrollable extent. Keep any bounded-out movement until that
    /// native extent arrives, even if no row reports another position.
    private var unappliedCorrection: CGFloat = 0

    func note(_ id: String, _ row: ChatScrollAnchor.Row, preserving: @escaping @MainActor () -> Bool) {
        anchor.note(id, row)
        self.preserving = preserving
        scheduleFlush()
    }

    private func scheduleFlush() {
        guard !flushScheduled else { return }
        flushScheduled = true
        // Rows report one at a time; wait for the whole layout pass.
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated { self?.flush() }
        }
    }

    fileprivate func remove(_ id: String) {
        anchor.remove(id)
    }

    func reset() {
        anchor = ChatScrollAnchor()
        cancelPendingCorrection()
        preserving = nil
    }

    func cancelPendingCorrection() {
        unappliedCorrection = 0
    }

    private func flush() {
        flushScheduled = false
        guard let scrollView else { return }
        let insets = scrollView.adjustedContentInset
        let offset = scrollView.contentOffset.y
        let shouldPreserve = preserving?() ?? false
        let delta = anchor.takeCorrection(
            // The row baseline already includes earlier layout displacement;
            // the native offset may still be waiting for room to apply it.
            viewportTop: offset + insets.top + unappliedCorrection,
            viewportHeight: scrollView.bounds.height - insets.top - insets.bottom,
            preserving: shouldPreserve
        )
        guard shouldPreserve else {
            unappliedCorrection = 0
            return
        }
        unappliedCorrection += delta
        guard abs(unappliedCorrection) >= 0.5 else {
            unappliedCorrection = 0
            return
        }
        let lowest = -insets.top
        let highest = max(offset, scrollView.contentSize.height + insets.bottom - scrollView.bounds.height)
        let requested = unappliedCorrection
        // Assigning the offset directly keeps a drag or deceleration running;
        // `setContentOffset(_:animated:)` would stop it.
        scrollView.contentOffset.y = min(max(offset + requested, lowest), highest)
        let applied = scrollView.contentOffset.y - offset
        unappliedCorrection -= applied
        // The top bound is already authoritative; unlike a growing bottom
        // extent, there is no later contentSize that can make it negative.
        if unappliedCorrection < 0, scrollView.contentOffset.y <= lowest + 0.5 {
            unappliedCorrection = 0
        }
        #if DEBUG
        ChatScrollTrace.shared.note(
            "anchorCorrection delta=\(Int(delta.rounded())) requested=\(Int(requested.rounded())) "
                + "applied=\(Int(applied.rounded())) remaining=\(Int(unappliedCorrection.rounded())) "
                + "nativeHeight=\(Int(scrollView.contentSize.height.rounded()))"
        )
        #endif
    }
}

/// Reports one transcript row's position for scroll anchoring.
struct ChatScrollAnchorRowModifier: ViewModifier {
    let id: String
    let coordinator: ChatScrollAnchorCoordinator
    let preserving: @MainActor () -> Bool

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: ChatScrollAnchor.Row.self) { geometry in
                let frame = geometry.frame(in: .named(chatScrollAnchorContentSpace))
                return ChatScrollAnchor.Row(minY: frame.minY, maxY: frame.maxY)
            } action: { row in
                coordinator.note(id, row, preserving: preserving)
            }
            .onDisappear { coordinator.remove(id) }
    }
}

private final class ChatScrollViewProbe: UIView {
    var onResolve: ((UIScrollView) -> Void)?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { return }
        var ancestor = superview
        while let view = ancestor {
            if let scrollView = view as? UIScrollView {
                onResolve?(scrollView)
                return
            }
            ancestor = view.superview
        }
    }
}

private struct ChatScrollViewFinder: UIViewRepresentable {
    let coordinator: ChatScrollAnchorCoordinator

    func makeUIView(context: Context) -> ChatScrollViewProbe {
        let probe = ChatScrollViewProbe()
        probe.isUserInteractionEnabled = false
        probe.onResolve = { [weak coordinator] in coordinator?.scrollView = $0 }
        return probe
    }

    func updateUIView(_ uiView: ChatScrollViewProbe, context: Context) {}
}

extension View {
    /// Marks the transcript content: the space rows report in, and the place the
    /// coordinator finds its scroll view from.
    func chatScrollAnchorContent(_ coordinator: ChatScrollAnchorCoordinator) -> some View {
        coordinateSpace(.named(chatScrollAnchorContentSpace))
            .background(ChatScrollViewFinder(coordinator: coordinator).allowsHitTesting(false))
    }
}
