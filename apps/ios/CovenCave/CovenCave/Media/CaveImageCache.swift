import Foundation
import ImageIO
import UIKit

extension Notification.Name {
    /// The configured endpoint or credential is being replaced or removed.
    /// Posted synchronously by AppModel on MainActor before authority changes.
    static let caveImageAuthorityChanged = Notification.Name("cave.imageAuthorityChanged")
}

enum CaveImageSource: Hashable, Sendable {
    case remoteURL(URL)
    case authenticatedRemoteURL(URL, bearerToken: String)
    case dataURL(String)

    fileprivate var identity: CaveImageSourceIdentity {
        switch self {
        case .remoteURL(let url):
            return .remoteURL(url.absoluteString, bearerToken: nil)
        case .authenticatedRemoteURL(let url, let bearerToken):
            return .remoteURL(url.absoluteString, bearerToken: bearerToken)
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
    case remoteURL(String, bearerToken: String?)
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
              targetPixelSize.height > 0,
              targetPixelSize.width <= 4096, targetPixelSize.height <= 4096 else {
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

private final class BoundedImageTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let byteLimit: Int
    private var data = Data()
    private var rejected = false
    private var continuation: CheckedContinuation<Data?, Never>?
    private let completionLock = NSLock()
    private var completed = false
    private var completedResult: Data?

    init(byteLimit: Int) { self.byteLimit = byteLimit }

    func receive(configuration: URLSessionConfiguration, request: URLRequest) async -> Data? {
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let task = session.dataTask(with: request)
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                completionLock.lock()
                if completed {
                    let result = completedResult
                    completionLock.unlock()
                    continuation.resume(returning: result)
                } else {
                    self.continuation = continuation
                    completionLock.unlock()
                    task.resume()
                }
            }
        } onCancel: {
            task.cancel()
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard response.expectedContentLength <= Int64(byteLimit),
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            rejected = true
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        guard !rejected else { return }
        guard chunk.count <= byteLimit - data.count else {
            rejected = true
            data.removeAll()
            dataTask.cancel()
            return
        }
        data.append(chunk)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let result = error == nil && !rejected && !data.isEmpty ? data : nil
        data.removeAll()
        completionLock.lock()
        completed = true
        completedResult = result
        let completion = continuation
        continuation = nil
        completionLock.unlock()
        completion?.resume(returning: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(DeviceAccessRedirectGuard.permitsRedirect(for: task.originalRequest) ? request : nil)
    }
}

final class DefaultCaveImageDataLoader: CaveImageDataLoading, @unchecked Sendable {
    static let maximumEncodedBytes = 32 * 1_024 * 1_024
    private let configuration: URLSessionConfiguration
    private let byteLimit: Int

    init(configuration: URLSessionConfiguration = .ephemeral, byteLimit: Int = maximumEncodedBytes) {
        self.byteLimit = max(1, min(byteLimit, Self.maximumEncodedBytes))
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        self.configuration = configuration.copy() as! URLSessionConfiguration
    }

    func data(for source: CaveImageSource) async -> Data? {
        guard !Task.isCancelled else { return nil }
        switch source {
        case .dataURL(let value):
            return decodeDataURL(value)
        case .remoteURL, .authenticatedRemoteURL:
            guard let request = Self.request(for: source) else { return nil }
            return await BoundedImageTransfer(byteLimit: byteLimit).receive(configuration: configuration, request: request)
        }
    }

    static func request(for source: CaveImageSource) -> URLRequest? {
        let url: URL
        let bearerToken: String?
        switch source {
        case .remoteURL(let remoteURL):
            url = remoteURL
            bearerToken = nil
        case .authenticatedRemoteURL(let remoteURL, let token):
            url = remoteURL
            bearerToken = token
        case .dataURL:
            return nil
        }
        guard let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            return nil
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func decodeDataURL(_ value: String) -> Data? {
        guard value.range(
            of: "data:image/",
            options: [.anchored, .caseInsensitive]
        ) != nil,
              let comma = value.firstIndex(of: ",") else {
            return nil
        }

        let metadata = value[..<comma]
        guard metadata.utf8.count <= 256, metadata.lowercased().hasSuffix(";base64") else {
            return nil
        }

        let payload = value[value.index(after: comma)...]
        // Bound the encoded text before making its String copy or decoded Data.
        let maximumCharacters = ((byteLimit + 2) / 3) * 4
        let count = payload.utf8.count
        let padding = payload.hasSuffix("==") ? 2 : (payload.hasSuffix("=") ? 1 : 0)
        guard count <= maximumCharacters, count % 4 == 0,
              (count / 4) * 3 - padding <= byteLimit,
              let data = Data(base64Encoded: String(payload)),
              data.count <= byteLimit else { return nil }
        return data
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

        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
              let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue,
              width.isFinite, height.isFinite, width > 0, height > 0,
              width <= 32_768, height <= 32_768, width * height <= 100_000_000 else { return nil }
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

        // ImageIO applies EXIF orientation when creating the thumbnail. Fit
        // the displayed dimensions, including mirrored quarter-turns (5–8).
        let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
        let swapsAxes = (5...8).contains(orientation)
        let displayWidth = swapsAxes ? sourceHeight : sourceWidth
        let displayHeight = swapsAxes ? sourceWidth : sourceHeight
        let widthScale = targetPixelSize.width / displayWidth
        let heightScale = targetPixelSize.height / displayHeight
        let scale = min(widthScale, heightScale, 1)
        return max(1, Int((max(sourceWidth, sourceHeight) * scale).rounded(.up)))
    }
}

private final class CaveImageWaiter: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    /// Commit under the cancellation lock so cancellation and cache insertion
    /// have one ordering. A cancelled last waiter cannot populate the cache.
    func commitIfActive(_ commit: () -> Void) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !cancelled else { return false }
        commit()
        return true
    }
}

private actor CaveImageLoadScheduler {
    static let shared = CaveImageLoadScheduler()
    private struct Waiting {
        let id: UUID
        let cancellation: CaveImageWaiter
        let continuation: CheckedContinuation<Bool, Never>
    }
    private var active = 0
    private var waiting: [Waiting] = []

    func run(_ operation: @Sendable () async -> UIImage?) async -> UIImage? {
        guard await acquire() else { return nil }
        let result = Task.isCancelled ? nil : await operation()
        release()
        return Task.isCancelled ? nil : result
    }

    private func acquire() async -> Bool {
        guard !Task.isCancelled else { return false }
        if active < 2 {
            active += 1
            return true
        }
        // Bound both active byte buffers and queued work under rapid repeated taps.
        guard waiting.count < 6 else { return false }
        let id = UUID()
        let cancellation = CaveImageWaiter()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !cancellation.isCancelled, !Task.isCancelled else {
                    continuation.resume(returning: false)
                    return
                }
                waiting.append(Waiting(id: id, cancellation: cancellation, continuation: continuation))
            }
        } onCancel: {
            cancellation.cancel()
            Task { await self.cancel(id) }
        }
    }

    private func cancel(_ id: UUID) {
        guard let index = waiting.firstIndex(where: { $0.id == id }) else { return }
        waiting.remove(at: index).continuation.resume(returning: false)
    }

    private func release() {
        active -= 1
        while !waiting.isEmpty {
            let next = waiting.removeFirst()
            if next.cancellation.isCancelled {
                next.continuation.resume(returning: false)
            } else {
                active += 1
                next.continuation.resume(returning: true)
                break
            }
        }
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
    private struct WaitingImage {
        let cancellation: CaveImageWaiter
        let continuation: CheckedContinuation<UIImage?, Never>
    }
    private struct ImageLoad {
        let id: UUID
        let task: Task<Void, Never>
        var waiters: [UUID: WaitingImage]
    }
    private var inFlight: [CaveImageCacheKey: ImageLoad] = [:]
    private lazy var memoryWarningObserver = CaveImageMemoryWarningObserver { [weak self] in
        Task {
            await self?.removeAllImages()
        }
    }

    var pendingRequestCount: Int {
        inFlight.values.reduce(0) { $0 + $1.waiters.count }
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
        guard !Task.isCancelled,
              let key = CaveImageCacheKey(source: source, targetPixelSize: targetPixelSize) else {
            return nil
        }
        let keyBox = CaveImageCacheKeyBox(key)
        if let image = cache.object(forKey: keyBox) {
            markRecentlyUsed(key)
            return Task.isCancelled ? nil : image
        }
        removeFromIndex(key)

        let waiterID = UUID()
        let cancellation = CaveImageWaiter()
        let image = await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<UIImage?, Never>) in
                guard !cancellation.isCancelled, !Task.isCancelled else {
                    continuation.resume(returning: nil)
                    return
                }
                let waiter = WaitingImage(cancellation: cancellation, continuation: continuation)
                if inFlight[key] != nil {
                    inFlight[key]?.waiters[waiterID] = waiter
                    return
                }
                let loadID = UUID()
                let dataLoader = self.dataLoader
                let decoder = self.decoder
                let task: Task<Void, Never> = Task.detached(priority: .userInitiated) { [weak self] in
                    let image = await CaveImageLoadScheduler.shared.run {
                        guard !Task.isCancelled, let data = await dataLoader.data(for: source),
                              !Task.isCancelled else { return nil }
                        return await decoder.decode(data: data, targetPixelSize: key.targetPixelSize)
                    }
                    await self?.finishLoad(key, id: loadID, image: Task.isCancelled ? nil : image)
                }
                inFlight[key] = ImageLoad(id: loadID, task: task, waiters: [waiterID: waiter])
            }
        } onCancel: {
            // Publish cancellation synchronously, before actor scheduling can race completion.
            cancellation.cancel()
            Task { await self.cancelWaiter(waiterID, for: key) }
        }
        return Task.isCancelled ? nil : image
    }

    private func cancelWaiter(_ waiterID: UUID, for key: CaveImageCacheKey) {
        guard var load = inFlight[key], let waiter = load.waiters.removeValue(forKey: waiterID) else { return }
        if load.waiters.isEmpty {
            inFlight.removeValue(forKey: key)
            load.task.cancel()
        } else {
            inFlight[key] = load
        }
        waiter.continuation.resume(returning: nil)
    }

    private func finishLoad(_ key: CaveImageCacheKey, id: UUID, image: UIImage?) {
        guard let load = inFlight[key], load.id == id else { return }
        inFlight.removeValue(forKey: key)
        if let image {
            for waiter in load.waiters.values {
                if waiter.cancellation.commitIfActive({ insert(image, for: key) }) { break }
            }
        }
        for waiter in load.waiters.values {
            waiter.continuation.resume(returning: waiter.cancellation.isCancelled ? nil : image)
        }
    }

    func removeAllImages() {
        let abandoned = inFlight.values
        inFlight.removeAll()
        for load in abandoned {
            load.task.cancel()
            for waiter in load.waiters.values {
                waiter.continuation.resume(returning: nil)
            }
        }
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
