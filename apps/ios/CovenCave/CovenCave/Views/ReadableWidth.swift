import SwiftUI

extension View {
    /// Cap content to a centred column so a ScrollView/VStack doesn't stretch
    /// edge-to-edge on a wide screen (iPad). A no-op on iPhone, where the
    /// available width is already below `maxWidth`.
    func readableWidth(_ maxWidth: CGFloat = 620) -> some View {
        frame(maxWidth: maxWidth)
            .frame(maxWidth: .infinity, alignment: .center)
    }

    /// Centre a `List`'s rows in a column of at most `maxWidth`. A plain
    /// `.frame(maxWidth:)` doesn't work on List (it's a greedy container), so
    /// this insets the scroll content by the leftover space on each side. No-op
    /// on iPhone (available width ≤ maxWidth → zero inset).
    func readableListWidth(_ maxWidth: CGFloat = 620) -> some View {
        modifier(ReadableListWidth(maxWidth: maxWidth))
    }
}

extension View {
    /// Pin a split-view sidebar to a real column. Without an explicit width
    /// the sidebar sizes by trait defaults and can present as a floating
    /// overlay at in-between window widths (Designed-for-iPad on macOS);
    /// with one it stays a fixed pane and the detail keeps the rest.
    ///
    /// On a folded iPhone Duo the column asks to end on the hinge instead and
    /// the system grants what it allows; `splitDetailColumn()` covers the rest.
    func sidebarColumn() -> some View {
        modifier(SidebarColumnWidth())
    }

    /// The other half of `sidebarColumn()` on a folded iPhone Duo. The split
    /// view caps the sidebar below the hinge (~420pt of the inner display's
    /// 951pt; any larger minimum collapses the sidebar entirely), so the
    /// detail starts short of the fold. This keeps the detail's content in
    /// the pane past the hinge and leaves the sliver before it empty, rather
    /// than folding a conversation down the middle. Tabletop leaves it alone:
    /// a transcript scrolls across that fold and its composer already sits in
    /// the lower pane. A no-op everywhere else.
    func splitDetailColumn() -> some View {
        foldAvoiding(tabletop: nil)
    }
}

private struct SidebarColumnWidth: ViewModifier {
    @Environment(\.displayFold) private var fold

    func body(content: Content) -> some View {
        // Split views here span the window, so the window is the container.
        // One modifier either way: branching would swap the sidebar's view
        // identity as the fold arrives, and the split drops the column. The
        // minimum stays at 300: a minimum past ~400pt collapses it too.
        let onFold = fold.flatMap { FoldLayout.splitColumnWidth(container: $0.window, fold: $0) }
        content.navigationSplitViewColumnWidth(
            min: min(300, onFold ?? 300),
            ideal: onFold ?? 340,
            max: max(420, onFold ?? 420)
        )
    }
}

private struct ReadableListWidth: ViewModifier {
    let maxWidth: CGFloat

    func body(content: Content) -> some View {
        GeometryReader { geo in
            content.contentMargins(
                .horizontal,
                max(0, (geo.size.width - maxWidth) / 2),
                for: .scrollContent
            )
        }
    }
}
