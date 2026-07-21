import SwiftUI
import UIKit

@MainActor
struct CachedImageView<Content: View, Placeholder: View>: View {
    private struct LoadIdentity: Hashable {
        let source: CaveImageSource
        let pixelWidth: Int
        let pixelHeight: Int

        var targetPixelSize: CGSize {
            CGSize(width: pixelWidth, height: pixelHeight)
        }
    }

    let source: CaveImageSource?
    let targetSize: CGSize
    let cache: CaveImageCache
    @ViewBuilder let content: (UIImage) -> Content
    @ViewBuilder let placeholder: () -> Placeholder

    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?
    @State private var loadedIdentity: LoadIdentity?

    init(
        source: CaveImageSource?,
        targetSize: CGSize,
        cache: CaveImageCache = .shared,
        @ViewBuilder content: @escaping (UIImage) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.source = source
        self.targetSize = targetSize
        self.cache = cache
        self.content = content
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let image, loadedIdentity == loadIdentity {
                content(image)
            } else {
                placeholder()
            }
        }
        .task(id: loadIdentity) {
            await loadImage(for: loadIdentity)
        }
    }

    private var loadIdentity: LoadIdentity? {
        guard let source,
              targetSize.width.isFinite,
              targetSize.height.isFinite,
              targetSize.width > 0,
              targetSize.height > 0 else {
            return nil
        }

        return LoadIdentity(
            source: source,
            pixelWidth: Int((targetSize.width * displayScale).rounded(.up)),
            pixelHeight: Int((targetSize.height * displayScale).rounded(.up))
        )
    }

    private func loadImage(for identity: LoadIdentity?) async {
        image = nil
        loadedIdentity = nil

        guard let identity else {
            return
        }

        let loadedImage = await cache.image(
            for: identity.source,
            targetPixelSize: identity.targetPixelSize
        )
        guard !Task.isCancelled else {
            return
        }

        image = loadedImage
        loadedIdentity = identity
    }
}
