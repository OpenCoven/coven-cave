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
