import SwiftUI

/// Circular familiar avatar: remote image if available, else coloured initials.
struct AvatarView: View {
    let familiar: Familiar?
    var url: URL?
    var size: CGFloat = 44

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
    }

    private func initials(_ color: Color) -> some View {
        Text(Theme.initials(familiar?.displayName ?? "?"))
            .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
            .foregroundStyle(color)
    }
}

/// Overlapping cluster of avatars for group threads.
struct AvatarClusterView: View {
    let familiars: [Familiar]
    var size: CGFloat = 44

    var body: some View {
        let shown = Array(familiars.prefix(3))
        ZStack {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, fam in
                AvatarView(familiar: fam, size: size * 0.62)
                    .overlay(Circle().strokeBorder(Color(.systemBackground), lineWidth: 1.5))
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
