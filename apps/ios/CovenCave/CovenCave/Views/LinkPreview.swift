import SwiftUI
import UIKit
import LinkPresentation

/// The first `http(s)` URL in a string (used to preview links in chat bubbles).
func firstLink(in text: String) -> URL? {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    for match in detector.matches(in: text, options: [], range: range) {
        if let url = match.url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            return url
        }
    }
    return nil
}

/// Process-wide cache of fetched link metadata so a bubble doesn't re-fetch on
/// every re-render / scroll.
@MainActor
final class LinkMetadataCache {
    static let shared = LinkMetadataCache()
    private var cache: [String: LPLinkMetadata] = [:]

    func fetch(_ url: URL) async -> LPLinkMetadata? {
        let key = url.absoluteString
        if let hit = cache[key] { return hit }
        let provider = LPMetadataProvider()
        guard let metadata = try? await provider.startFetchingMetadata(for: url) else { return nil }
        cache[key] = metadata
        return metadata
    }
}

/// A compact preview card for a URL: site thumbnail/icon + title + host, tappable
/// to open. Built in SwiftUI (LPLinkView doesn't size reliably inside SwiftUI),
/// fed by the fetched `LPLinkMetadata`. Renders nothing until metadata loads, so
/// the markdown link still stands; image falls back to a link glyph.
struct LinkPreviewCard: View {
    let url: URL
    @Environment(\.chrome) private var chrome
    @State private var metadata: LPLinkMetadata?
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let metadata {
                Button { UIApplication.shared.open(url) } label: { card(metadata) }
                    .buttonStyle(.plain)
            } else {
                // A zero-height placeholder (not EmptyView) so `.task` actually
                // runs to fetch the metadata before there's a card to show.
                Color.clear.frame(width: 1, height: 1)
            }
        }
        .task(id: url) {
            guard metadata == nil, let m = await LinkMetadataCache.shared.fetch(url) else { return }
            metadata = m
            image = await Self.loadImage(m)
        }
    }

    private func card(_ m: LPLinkMetadata) -> some View {
        HStack(spacing: 10) {
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Image(systemName: "link").font(.title3).foregroundStyle(chrome.accent)
                }
            }
            .frame(width: 52, height: 52)
            .clipped()
            .background(chrome.bgElevated)

            VStack(alignment: .leading, spacing: 2) {
                Text(m.title ?? url.host ?? url.absoluteString)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                Text(url.host ?? url.absoluteString)
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .padding(.vertical, 6)
            .padding(.trailing, 10)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: 280, alignment: .leading)
        .glassFill(.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 1)
        )
    }

    /// Load the preview image (or favicon) from the metadata's providers.
    private static func loadImage(_ m: LPLinkMetadata) async -> UIImage? {
        let provider = m.imageProvider ?? m.iconProvider
        guard let provider, provider.canLoadObject(ofClass: UIImage.self) else { return nil }
        return await withCheckedContinuation { cont in
            provider.loadObject(ofClass: UIImage.self) { obj, _ in
                cont.resume(returning: obj as? UIImage)
            }
        }
    }
}
