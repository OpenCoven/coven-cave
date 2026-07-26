import Foundation
import ImageIO
import UIKit

enum CaveImageSource: Hashable, Sendable {
    case remoteURL(URL)
    case dataURL(String)

    fileprivate var identity: CaveImageSourceIdentity {
        switch self {
        case .remoteURL(let url):
            return .remoteURL(url.absoluteString)
        case .dataURL(let value):
            return .dataURL(value)
        }
    }
}

protocol CaveImageDecoding: Sendable {
    func decode(data: Data, targetPixelSize: CGSize) async -> UIImage?
}

protocol CaveImageDataLoading: Sendable {
    func data(for source: CaveImageSource) async -> Data?
}

private enum CaveImageSourceIdentity: Hashable, Sendable {
    case remoteURL(String)
    case dataURL(String)
}

private struct CaveImageCacheKey: Hashable, Sendable {
    let source: CaveImageSourceIdentity
    let pixelWidth: Int
    let pixelHeight: Int

    init?(source: CaveImageSource, targetPixelSize: CGSize) {
        guard targetPixelSize.width.isFinite,
              targetPixelSize.height.isFinite,
              targetPixelSize.width > 0,
              targetPixelSize.height > 0 else {
            return nil
        }

        self.source = source.identity
        self.pixelWidth = Int(targetPixelSize.width.rounded(.up))
        self.pixelHeight = Int(targetPixelSize.height.rounded(.up))
    }

    var targetPixelSize: CGSize {
        CGSize(width: pixelWidth, height: pixelHeight)
    }
}

private final class CaveImageCacheKeyBox: NSObject {
    let key: CaveImageCacheKey

    init(_ key: CaveImageCacheKey) {
        self.key = key
    }

    override var hash: Int {
        key.hashValue
    }

    override func isEqual(_ object: Any?) -> Bool {
        guard let other = object as? CaveImageCacheKeyBox else {
            return false
        }
        return key == other.key
    }
}

private final class CaveImageMemoryWarningObserver {
    private var token: NSObjectProtocol?

    init(onMemoryWarning: @escaping @Sendable () -> Void) {
        token = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: nil
        ) { _ in
            onMemoryWarning()
        }
    }

    deinit {
        if let token {
            NotificationCenter.default.removeObserver(token)
        }
    }
}

private final class DefaultCaveImageDataLoader: CaveImageDataLoading, @unchecked Sendable {
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        session = URLSession(configuration: configuration)
    }

    func data(for source: CaveImageSource) async -> Data? {
        switch source {
        case .dataURL(let value):
            return Self.decodeDataURL(value)
        case .remoteURL(let url):
            guard let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https" else {
                return nil
            }

            var request = URLRequest(url: url)
            request.cachePolicy = .reloadIgnoringLocalCacheData

            do {
                let (data, response) = try await session.data(for: request)
                if let response = response as? HTTPURLResponse,
                   !(200...299).contains(response.statusCode) {
                    return nil
                }
                return data.isEmpty ? nil : data
            } catch {
                return nil
            }
        }
    }

    private static func decodeDataURL(_ value: String) -> Data? {
        guard value.range(
            of: "data:image/",
            options: [.anchored, .caseInsensitive]
        ) != nil,
              let comma = value.firstIndex(of: ",") else {
            return nil
        }

        let metadata = value[..<comma]
        guard metadata.lowercased().hasSuffix(";base64") else {
            return nil
        }

        return Data(base64Encoded: String(value[value.index(after: comma)...]))
    }
}

private struct ImageIOCaveImageDecoder: CaveImageDecoding {
    private let recorder: CavePerformanceRecorder?

    init(recorder: CavePerformanceRecorder? = nil) {
        self.recorder = recorder
    }

    func decode(data: Data, targetPixelSize: CGSize) async -> UIImage? {
        let recorder: CavePerformanceRecorder
        if let injectedRecorder = self.recorder {
            recorder = injectedRecorder
        } else {
            recorder = await CavePerformanceRecorder.shared
        }
        await recorder.increment("image.decode")

        let image = await recorder.measure("image.decode") {
            await Task.detached(priority: .userInitiated) {
                Self.makeThumbnail(data: data, targetPixelSize: targetPixelSize)
            }.value
        }
        return Task.isCancelled ? nil : image
    }

    private static func makeThumbnail(data: Data, targetPixelSize: CGSize) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            return nil
        }

        let maxPixelSize = thumbnailMaxPixelSize(source: source, targetPixelSize: targetPixelSize)
        let thumbnailOptions = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ] as CFDictionary

        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions) else {
            return nil
        }

        return UIImage(cgImage: thumbnail, scale: 1, orientation: .up)
    }

    private static func thumbnailMaxPixelSize(
        source: CGImageSource,
        targetPixelSize: CGSize
    ) -> Int {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let sourceWidth = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
              let sourceHeight = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue,
              sourceWidth > 0,
              sourceHeight > 0 else {
            return max(1, Int(max(targetPixelSize.width, targetPixelSize.height).rounded(.up)))
        }

        let widthScale = targetPixelSize.width / sourceWidth
        let heightScale = targetPixelSize.height / sourceHeight
        let scale = min(widthScale, heightScale, 1)
        return max(1, Int((max(sourceWidth, sourceHeight) * scale).rounded(.up)))
    }
}

actor CaveImageCache {
    static let shared = CaveImageCache()

    private static let defaultMemoryCostLimit = 48 * 1_024 * 1_024
    private static let defaultKeyLimit = 256

    private let cache = NSCache<CaveImageCacheKeyBox, UIImage>()
    private let memoryCostLimit: Int
    private let keyLimit: Int
    private let dataLoader: any CaveImageDataLoading
    private let decoder: any CaveImageDecoding
    private var indexedKeys: Set<CaveImageCacheKey> = []
    private var indexedCosts: [CaveImageCacheKey: Int] = [:]
    private var indexedMemoryCost = 0
    private var recencyOrder: [CaveImageCacheKey] = []
    private var inFlight: [CaveImageCacheKey: Task<UIImage?, Never>] = [:]
    private var generation = 0
    private lazy var memoryWarningObserver = CaveImageMemoryWarningObserver { [weak self] in
        Task {
            await self?.removeAllImages()
        }
    }

    var indexedEntryCount: Int {
        indexedKeys.count
    }

    init(
        memoryCostLimit: Int = defaultMemoryCostLimit,
        keyLimit: Int = defaultKeyLimit,
        dataLoader: any CaveImageDataLoading = DefaultCaveImageDataLoader(),
        decoder: (any CaveImageDecoding)? = nil,
        performanceRecorder: CavePerformanceRecorder? = nil
    ) {
        self.memoryCostLimit = max(1, memoryCostLimit)
        self.keyLimit = max(1, keyLimit)
        self.dataLoader = dataLoader
        self.decoder = decoder ?? ImageIOCaveImageDecoder(recorder: performanceRecorder)
        cache.totalCostLimit = self.memoryCostLimit
        cache.countLimit = self.keyLimit
    }

    func image(for source: CaveImageSource, targetPixelSize: CGSize) async -> UIImage? {
        _ = memoryWarningObserver

        guard let key = CaveImageCacheKey(source: source, targetPixelSize: targetPixelSize) else {
            return nil
        }

        let keyBox = CaveImageCacheKeyBox(key)
        if let image = cache.object(forKey: keyBox) {
            markRecentlyUsed(key)
            return image
        }
        removeFromIndex(key)

        if let existing = inFlight[key] {
            return await existing.value
        }

        let dataLoader = self.dataLoader
        let decoder = self.decoder
        let loadGeneration = generation
        let task: Task<UIImage?, Never> = Task.detached(priority: .userInitiated) {
            guard !Task.isCancelled,
                  let data = await dataLoader.data(for: source),
                  !Task.isCancelled else {
                return nil
            }
            return await decoder.decode(data: data, targetPixelSize: key.targetPixelSize)
        }
        inFlight[key] = task

        let image = await task.value
        guard generation == loadGeneration else {
            return nil
        }

        inFlight.removeValue(forKey: key)
        if let image {
            insert(image, for: key)
        }
        return image
    }

    func removeAllImages() {
        generation &+= 1
        for task in inFlight.values {
            task.cancel()
        }
        inFlight.removeAll()
        cache.removeAllObjects()
        indexedKeys.removeAll()
        indexedCosts.removeAll()
        indexedMemoryCost = 0
        recencyOrder.removeAll()
    }

    private func insert(_ image: UIImage, for key: CaveImageCacheKey) {
        removeFromIndex(key)
        cache.removeObject(forKey: CaveImageCacheKeyBox(key))

        let cost = image.decodedMemoryCost
        guard cost <= memoryCostLimit else {
            return
        }

        while indexedKeys.count >= keyLimit
                || indexedMemoryCost > memoryCostLimit - cost {
            guard let leastRecentlyUsed = recencyOrder.first else {
                break
            }
            evict(leastRecentlyUsed)
        }

        cache.setObject(image, forKey: CaveImageCacheKeyBox(key), cost: cost)
        indexedKeys.insert(key)
        indexedCosts[key] = cost
        indexedMemoryCost += cost
        recencyOrder.append(key)
    }

    private func removeFromIndex(_ key: CaveImageCacheKey) {
        guard indexedKeys.remove(key) != nil else {
            return
        }
        if let removedCost = indexedCosts.removeValue(forKey: key) {
            indexedMemoryCost -= removedCost
        }
        recencyOrder.removeAll { $0 == key }
    }

    private func evict(_ key: CaveImageCacheKey) {
        removeFromIndex(key)
        cache.removeObject(forKey: CaveImageCacheKeyBox(key))
    }

    private func markRecentlyUsed(_ key: CaveImageCacheKey) {
        guard indexedKeys.contains(key) else {
            return
        }
        recencyOrder.removeAll { $0 == key }
        recencyOrder.append(key)
    }
}

private extension UIImage {
    var decodedMemoryCost: Int {
        guard let cgImage else {
            return 0
        }
        let (cost, overflow) = cgImage.bytesPerRow.multipliedReportingOverflow(by: cgImage.height)
        return overflow ? Int.max : cost
    }
}
