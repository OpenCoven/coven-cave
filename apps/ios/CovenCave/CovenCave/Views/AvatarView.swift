import SwiftUI

/// Circular familiar avatar: remote image if available, else coloured initials.
struct AvatarView: View {
    @Environment(\.chrome) private var chrome
    let familiar: Familiar?
    var url: URL?
    var size: CGFloat = 44
    /// Show a presence dot (online/idle/busy/offline) in the bottom-trailing
    /// corner when the familiar reports a status. Opt-in so it only appears on
    /// "who's around" surfaces (chat list, header), not every avatar.
    var showStatus: Bool = false
    /// Name used for the initials fallback when `familiar` is nil — e.g. the
    /// human operator, who has no `Familiar` record. Ignored when `familiar`
    /// is set.
    var fallbackName: String? = nil

    var body: some View {
        let color = Theme.color(for: familiar)
        ZStack {
            Circle().fill(color.opacity(0.22))
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        initials(color)
                    }
                }
            } else {
                initials(color)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(color.opacity(0.35), lineWidth: 1))
        .overlay(alignment: .bottomTrailing) { statusDot }
    }

    @ViewBuilder private var statusDot: some View {
        if showStatus, let dot = Presence.color(for: familiar?.status) {
            Circle()
                .fill(dot)
                // Ring in the surrounding background colour so the dot reads as
                // separate from the avatar on the themed floor.
                .overlay(Circle().strokeBorder(chrome.bgBase, lineWidth: max(1.5, size * 0.06)))
                .frame(width: size * 0.32, height: size * 0.32)
                .offset(x: size * 0.04, y: size * 0.04)
        }
    }

    private func initials(_ color: Color) -> some View {
        Text(Theme.initials(familiar?.displayName ?? fallbackName ?? "?"))
            .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
            .foregroundStyle(color)
    }
}

/// Overlapping cluster of avatars for group threads.
struct AvatarClusterView: View {
    @Environment(\.chrome) private var chrome
    let familiars: [Familiar]
    var size: CGFloat = 44

    var body: some View {
        let shown = Array(familiars.prefix(3))
        ZStack {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, fam in
                AvatarView(familiar: fam, size: size * 0.62)
                    .overlay(Circle().strokeBorder(chrome.bgBase, lineWidth: 1.5))
                    .offset(offset(index: index, count: shown.count))
            }
        }
        .frame(width: size, height: size)
    }

    private func offset(index: Int, count: Int) -> CGSize {
        let spread = size * 0.18
        switch (count, index) {
        case (1, _): return .zero
        case (2, 0): return CGSize(width: -spread, height: -spread)
        case (2, 1): return CGSize(width: spread, height: spread)
        case (_, 0): return CGSize(width: 0, height: -spread)
        case (_, 1): return CGSize(width: -spread, height: spread)
        default: return CGSize(width: spread, height: spread)
        }
    }
}
