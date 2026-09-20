import XCTest
import UIKit
import ImageIO
@testable import CovenCave

private func makeTestImage(pixelSize: CGSize) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: pixelSize, format: format).image { context in
        UIColor.systemPurple.setFill()
        context.fill(CGRect(origin: .zero, size: pixelSize))
    }
}

private actor CountingImageDecoder: CaveImageDecoding {
    private var count = 0
    private var active = 0
    private var peak = 0
    private let delay: Duration
    private let outputPixelSize: CGSize?

    init(delay: Duration = .zero, outputPixelSize: CGSize? = nil) {
        self.delay = delay
        self.outputPixelSize = outputPixelSize
    }

    func decode(data: Data, targetPixelSize: CGSize) async -> UIImage? {
        count += 1
        active += 1
        peak = max(peak, active)
        defer { active -= 1 }
        if delay > .zero {
            try? await Task.sleep(for: delay)
        }
        if let outputPixelSize {
            return makeTestImage(pixelSize: outputPixelSize)
        }
        return UIImage()
    }

    func decodeCount() -> Int {
        count
    }

    func peakConcurrency() -> Int { peak }
}

private actor SuspendedFirstImageDecoder: CaveImageDecoding {
    private var count = 0
    private var firstDecodeStarted = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private var firstDecodeContinuation: CheckedContinuation<Void, Never>?

    func decode(data: Data, targetPixelSize: CGSize) async -> UIImage? {
        count += 1
        guard count == 1 else {
            return UIImage()
        }

        firstDecodeStarted = true
        let waiters = startWaiters
        startWaiters.removeAll()
        for waiter in waiters {
            waiter.resume()
        }

        await withCheckedContinuation { continuation in
            firstDecodeContinuation = continuation
        }
        return UIImage()
    }

    func waitUntilFirstDecodeStarts() async {
        if firstDecodeStarted {
            return
        }
        await withCheckedContinuation { continuation in
            startWaiters.append(continuation)
        }
    }

    func releaseFirstDecode() {
        firstDecodeContinuation?.resume()
        firstDecodeContinuation = nil
    }

    func decodeCount() -> Int {
        count
    }
}

private final class BoundedImageURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        var headers = ["Content-Type": "image/png", "X-Content-Type-Options": "nosniff"]
        if url.path == "/lying" { headers["Content-Length"] = "1" }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200,
            httpVersion: "HTTP/1.1", headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(repeating: 1, count: 8))
        client?.urlProtocol(self, didLoad: Data([2]))
        // Deliberately never completes: crossing the byte cap must end the request.
    }
    override func stopLoading() {}
}

final class CaveImageCacheTests: XCTestCase {
    private let firstDataURL = "data:image/png;base64,AQID"
    private let secondDataURL = "data:image/png;base64,BAUG"
    private let thirdDataURL = "data:image/png;base64,BwgJ"

    func testAuthenticatedRemoteURLUsesBearerHeaderWithoutQueryCredential() throws {
        let url = try XCTUnwrap(URL(string: "https://cave.test/marketplace-logos/github.png"))
        let request = try XCTUnwrap(
            DefaultCaveImageDataLoader.request(
                for: .authenticatedRemoteURL(url, bearerToken: "test-token")
            )
        )

        XCTAssertEqual(request.url, url)
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Authorization"),
            "Bearer test-token"
        )
        XCTAssertNil(request.url?.query)
    }

    func testIdenticalDataURLAndTargetSizeDecodeOnce() async {
        let decoder = CountingImageDecoder()
        let cache = CaveImageCache(decoder: decoder)
        let source = CaveImageSource.dataURL(firstDataURL)
        let target = CGSize(width: 44, height: 44)

        let first = await cache.image(for: source, targetPixelSize: target)
        let second = await cache.image(for: source, targetPixelSize: target)
        let decodeCount = await decoder.decodeCount()

        XCTAssertNotNil(first)
        XCTAssertTrue(first === second)
        XCTAssertEqual(decodeCount, 1)
    }

    func testConcurrentIdenticalLoadsShareOneDecode() async {
        let decoder = CountingImageDecoder(delay: .milliseconds(50))
        let cache = CaveImageCache(decoder: decoder)
        let source = CaveImageSource.dataURL(firstDataURL)
        let target = CGSize(width: 240, height: 240)

        async let first = cache.image(for: source, targetPixelSize: target)
        async let second = cache.image(for: source, targetPixelSize: target)
        let images = await (first, second)
        let decodeCount = await decoder.decodeCount()

        XCTAssertNotNil(images.0)
        XCTAssertTrue(images.0 === images.1)
        XCTAssertEqual(decodeCount, 1)
    }

    func testCancelledCallerDoesNotReceiveOrCacheLateDecodedImage() async {
        let decoder = SuspendedFirstImageDecoder()
        let cache = CaveImageCache(decoder: decoder)
        let source = CaveImageSource.dataURL(firstDataURL)
        let target = CGSize(width: 44, height: 44)
        let request = Task {
            await cache.image(for: source, targetPixelSize: target)
        }
        await decoder.waitUntilFirstDecodeStarts()
        request.cancel()
        await decoder.releaseFirstDecode()
        let result = await request.value
        let cachedCount = await cache.indexedEntryCount
        XCTAssertNil(result, "A dismissed owner must not receive a late image")
        XCTAssertEqual(cachedCount, 0, "Abandoned work must not populate the cache")
    }

    func testAlreadyCancelledCallerDoesNotStartDecodeOrReceiveCachedImage() async {
        let decoder = CountingImageDecoder()
        let cache = CaveImageCache(decoder: decoder)
        let source = CaveImageSource.dataURL(firstDataURL)
        let target = CGSize(width: 44, height: 44)
        let cancelledMiss = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return await cache.image(for: source, targetPixelSize: target)
        }
        let miss = await cancelledMiss.value
        let countAfterMiss = await decoder.decodeCount()
        XCTAssertNil(miss)
        XCTAssertEqual(countAfterMiss, 0)

        _ = await cache.image(for: source, targetPixelSize: target)
        let cancelledHit = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return await cache.image(for: source, targetPixelSize: target)
        }
        let hit = await cancelledHit.value
        XCTAssertNil(hit)
    }

    func testOversizedDataURLIsRejectedBeforeDecode() async {
        let loader = DefaultCaveImageDataLoader()
        // Valid base64 encoding 32 MiB + 1 byte; header length is not payload length.
        let payload = String(repeating: "AAAA", count: (32 * 1_024 * 1_024) / 3 + 1)
        let result = await loader.data(for: .dataURL("data:image/png;base64," + payload))
        XCTAssertNil(result, "Encoded image payload must be capped before full base64 allocation")
    }

    func testCancellingOneCallerKeepsSharedDecodeForRemainingCaller() async {
        let decoder = SuspendedFirstImageDecoder()
        let cache = CaveImageCache(decoder: decoder)
        let source = CaveImageSource.dataURL(firstDataURL)
        let target = CGSize(width: 44, height: 44)
        let first = Task { await cache.image(for: source, targetPixelSize: target) }
        await decoder.waitUntilFirstDecodeStarts()
        let second = Task { await cache.image(for: source, targetPixelSize: target) }
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while await cache.pendingRequestCount < 2, ContinuousClock.now < deadline {
            await Task.yield()
        }
        let pending = await cache.pendingRequestCount
        XCTAssertEqual(pending, 2)
        first.cancel()
        let abandoned = await first.value
        XCTAssertNil(abandoned, "Cancellation must complete before the shared decoder is released")
        await decoder.releaseFirstDecode()
        let retained = await second.value
        let count = await decoder.decodeCount()
        XCTAssertNotNil(retained)
        XCTAssertEqual(count, 1, "The remaining caller must reuse the original decode")
    }

    func testStreamingLimitDoesNotTrustMissingOrLyingContentLength() async {
        for path in ["missing", "lying"] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [BoundedImageURLProtocol.self]
            let loader = DefaultCaveImageDataLoader(configuration: configuration, byteLimit: 8)
            let finished = expectation(description: "Over-limit stream ends without EOF: \(path)")
            let task = Task {
                let data = await loader.data(for: .remoteURL(URL(string: "https://image.test/\(path)")!))
                XCTAssertNil(data)
                finished.fulfill()
            }
            await fulfillment(of: [finished], timeout: 5)
            task.cancel()
            await task.value
        }
    }

    func testAlreadyCancelledRemoteTransferCompletes() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BoundedImageURLProtocol.self]
        let loader = DefaultCaveImageDataLoader(configuration: configuration)
        let finished = expectation(description: "Already cancelled remote request finishes")
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            let result = await loader.data(for: .remoteURL(URL(string: "https://image.test/cancelled")!))
            XCTAssertNil(result)
            finished.fulfill()
        }
        await fulfillment(of: [finished], timeout: 5)
        task.cancel()
    }

    func testDataURLByteBoundaryAndMalformedInput() async {
        let loader = DefaultCaveImageDataLoader(byteLimit: 2)
        let exact = await loader.data(for: .dataURL("data:image/png;base64,AQI="))
        let over = await loader.data(for: .dataURL("data:image/png;base64,AQID"))
        let malformed = await loader.data(for: .dataURL("data:image/png;base64,????"))
        XCTAssertEqual(exact, Data([1, 2]))
        XCTAssertNil(over)
        XCTAssertNil(malformed)
    }

    func testOversizedTargetIsRejectedBeforeDecoding() async {
        let decoder = CountingImageDecoder()
        let cache = CaveImageCache(decoder: decoder)
        let image = await cache.image(for: .dataURL(firstDataURL), targetPixelSize: CGSize(width: 4097, height: 64))
        let count = await decoder.decodeCount()
        XCTAssertNil(image)
        XCTAssertEqual(count, 0)
    }

    @MainActor
    func testOversizedSourceDimensionIsRejected() async throws {
        let source = makeTestImage(pixelSize: CGSize(width: 33_000, height: 1))
        let data = try XCTUnwrap(source.pngData())
        let cache = CaveImageCache()
        let result = await cache.image(for: .dataURL("data:image/png;base64," + data.base64EncodedString()),
                                       targetPixelSize: CGSize(width: 64, height: 64))
        XCTAssertNil(result)
    }

    func testFortyEightMegapixelSourceIsDownsampled() async throws {
        let data = try autoreleasepool {
            let context = try XCTUnwrap(CGContext(data: nil, width: 8000, height: 6000,
                bitsPerComponent: 8, bytesPerRow: 8000, space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue))
            let image = try XCTUnwrap(context.makeImage())
            let encoded = NSMutableData()
            let destination = try XCTUnwrap(CGImageDestinationCreateWithData(encoded, "public.png" as CFString, 1, nil))
            CGImageDestinationAddImage(destination, image, nil)
            XCTAssertTrue(CGImageDestinationFinalize(destination))
            return encoded as Data
        }
        let cache = CaveImageCache()
        let image = await cache.image(for: .dataURL("data:image/png;base64," + data.base64EncodedString()),
                                      targetPixelSize: CGSize(width: 1024, height: 1024))
        let cgImage = try XCTUnwrap(image?.cgImage)
        XCTAssertEqual(cgImage.width, 1024)
        XCTAssertEqual(cgImage.height, 768)
    }

    func testHighlyCompressedPixelCountOverLimitIsRejected() async throws {
        let data = try autoreleasepool {
            let context = try XCTUnwrap(CGContext(data: nil, width: 10001, height: 10000,
                bitsPerComponent: 8, bytesPerRow: 10001, space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue))
            let image = try XCTUnwrap(context.makeImage())
            let encoded = NSMutableData()
            let destination = try XCTUnwrap(CGImageDestinationCreateWithData(encoded, "public.png" as CFString, 1, nil))
            CGImageDestinationAddImage(destination, image, nil)
            XCTAssertTrue(CGImageDestinationFinalize(destination))
            return encoded as Data
        }
        XCTAssertLessThan(data.count, DefaultCaveImageDataLoader.maximumEncodedBytes)
        let cache = CaveImageCache()
        let image = await cache.image(for: .dataURL("data:image/png;base64," + data.base64EncodedString()),
                                      targetPixelSize: CGSize(width: 1024, height: 1024))
        XCTAssertNil(image, "Compressed bytes below the cap must still obey the source pixel limit")
    }

    @MainActor
    func testHEIFThumbnailRemainsSupported() async throws {
        let source = makeTestImage(pixelSize: CGSize(width: 400, height: 200))
        let encoded = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(encoded, "public.heic" as CFString, 1, nil))
        CGImageDestinationAddImage(destination, try XCTUnwrap(source.cgImage), nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        let cache = CaveImageCache()
        let image = await cache.image(for: .dataURL("data:image/heic;base64," + (encoded as Data).base64EncodedString()),
                                      targetPixelSize: CGSize(width: 100, height: 100))
        let cgImage = try XCTUnwrap(image?.cgImage)
        XCTAssertEqual(cgImage.width, 100)
        XCTAssertEqual(cgImage.height, 50)
    }

    @MainActor
    func testRotatedJPEGFitsBothTargetDimensions() async throws {
        let source = makeTestImage(pixelSize: CGSize(width: 400, height: 200))
        let encoded = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(encoded, "public.jpeg" as CFString, 1, nil))
        CGImageDestinationAddImage(destination, try XCTUnwrap(source.cgImage),
                                  [kCGImagePropertyOrientation: 6] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        let cache = CaveImageCache()
        let image = await cache.image(for: .dataURL("data:image/jpeg;base64," + (encoded as Data).base64EncodedString()),
                                      targetPixelSize: CGSize(width: 100, height: 50))
        let cgImage = try XCTUnwrap(image?.cgImage)
        XCTAssertLessThanOrEqual(cgImage.width, 100)
        XCTAssertLessThanOrEqual(cgImage.height, 50)
        XCTAssertLessThan(cgImage.width, cgImage.height, "EXIF rotation must be applied")
        XCTAssertEqual(image?.imageOrientation, .up)
    }

    func testConcurrentDistinctImagesBoundDecodeConcurrency() async {
        let decoder = CountingImageDecoder(delay: .milliseconds(100))
        let cache = CaveImageCache(decoder: decoder)
        let successes = await withTaskGroup(of: Bool.self, returning: Int.self) { group in
            for index in 0..<6 {
                group.addTask {
                    let source = CaveImageSource.dataURL("data:image/png;base64," + Data([UInt8(index)]).base64EncodedString())
                    return await cache.image(for: source, targetPixelSize: CGSize(width: 44, height: 44)) != nil
                }
            }
            var count = 0
            for await success in group { if success { count += 1 } }
            return count
        }
        let peak = await decoder.peakConcurrency()
        XCTAssertEqual(successes, 6)
        XCTAssertLessThanOrEqual(peak, 2)
    }

    func testCachedDataURLDoesNotRetainItsEncodedPayload() async {
        let decoder = CountingImageDecoder()
        let cache = CaveImageCache(decoder: decoder)
        let source = "data:image/png;base64," + Data(repeating: 1, count: 1_048_576).base64EncodedString()
        _ = await cache.image(for: .dataURL(source), targetPixelSize: CGSize(width: 8, height: 8))
        let entries = await cache.indexedEntryCount
        let retainedBytes = await cache.indexedSourceIdentityByteCount
        XCTAssertEqual(entries, 1)
        XCTAssertLessThanOrEqual(retainedBytes, 256, "Image cost limits must not hide megabytes in a cache key")
    }

    func testTargetPixelSizesUseSeparateCacheEntries() async {
        let decoder = CountingImageDecoder()
        let cache = CaveImageCache(decoder: decoder)
        let source = CaveImageSource.dataURL(firstDataURL)

        _ = await cache.image(for: source, targetPixelSize: CGSize(width: 44, height: 44))
        _ = await cache.image(for: source, targetPixelSize: CGSize(width: 88, height: 88))
        _ = await cache.image(for: source, targetPixelSize: CGSize(width: 44, height: 44))
        let decodeCount = await decoder.decodeCount()
        let entryCount = await cache.indexedEntryCount

        XCTAssertEqual(decodeCount, 2)
        XCTAssertEqual(entryCount, 2)
    }

    func testBoundedIndexEvictionAndExplicitClearAreDeterministic() async {
        let decoder = CountingImageDecoder()
        let cache = CaveImageCache(keyLimit: 1, decoder: decoder)
        let target = CGSize(width: 44, height: 44)

        _ = await cache.image(for: .dataURL(firstDataURL), targetPixelSize: target)
        _ = await cache.image(for: .dataURL(secondDataURL), targetPixelSize: target)
        _ = await cache.image(for: .dataURL(firstDataURL), targetPixelSize: target)
        let decodeCountAfterEviction = await decoder.decodeCount()
        let entryCountAfterEviction = await cache.indexedEntryCount

        XCTAssertEqual(decodeCountAfterEviction, 3)
        XCTAssertEqual(entryCountAfterEviction, 1)

        await cache.removeAllImages()
        let entryCountAfterClear = await cache.indexedEntryCount
        XCTAssertEqual(entryCountAfterClear, 0)

        _ = await cache.image(for: .dataURL(firstDataURL), targetPixelSize: target)
        let decodeCountAfterClear = await decoder.decodeCount()
        XCTAssertEqual(decodeCountAfterClear, 4)
    }

    func testKeyLimitEvictsLeastRecentlyUsedImageAfterCacheHit() async {
        let decoder = CountingImageDecoder()
        let cache = CaveImageCache(keyLimit: 2, decoder: decoder)
        let target = CGSize(width: 44, height: 44)
        let firstSource = CaveImageSource.dataURL(firstDataURL)
        let secondSource = CaveImageSource.dataURL(secondDataURL)

        let first = await cache.image(for: firstSource, targetPixelSize: target)
        _ = await cache.image(for: secondSource, targetPixelSize: target)
        let recentlyHitFirst = await cache.image(for: firstSource, targetPixelSize: target)
        _ = await cache.image(for: .dataURL(thirdDataURL), targetPixelSize: target)
        let survivingFirst = await cache.image(for: firstSource, targetPixelSize: target)
        let decodeCountBeforeReloadingEvictedEntry = await decoder.decodeCount()

        XCTAssertTrue(first === recentlyHitFirst)
        XCTAssertTrue(first === survivingFirst)
        XCTAssertEqual(decodeCountBeforeReloadingEvictedEntry, 3)

        _ = await cache.image(for: secondSource, targetPixelSize: target)
        let decodeCountAfterReloadingEvictedEntry = await decoder.decodeCount()
        XCTAssertEqual(decodeCountAfterReloadingEvictedEntry, 4)
    }

    func testCostLimitEvictsLeastRecentlyUsedImageAfterCacheHit() async {
        let outputPixelSize = CGSize(width: 16, height: 16)
        let sampleImage = makeTestImage(pixelSize: outputPixelSize)
        guard let sampleCGImage = sampleImage.cgImage else {
            XCTFail("Expected a CGImage-backed test image")
            return
        }

        let imageCost = sampleCGImage.bytesPerRow * sampleCGImage.height
        let decoder = CountingImageDecoder(outputPixelSize: outputPixelSize)
        let cache = CaveImageCache(
            memoryCostLimit: imageCost * 2,
            keyLimit: 3,
            decoder: decoder
        )
        let target = CGSize(width: 44, height: 44)
        let firstSource = CaveImageSource.dataURL(firstDataURL)
        let secondSource = CaveImageSource.dataURL(secondDataURL)

        let first = await cache.image(for: firstSource, targetPixelSize: target)
        _ = await cache.image(for: secondSource, targetPixelSize: target)
        let recentlyHitFirst = await cache.image(for: firstSource, targetPixelSize: target)
        _ = await cache.image(for: .dataURL(thirdDataURL), targetPixelSize: target)
        let indexedEntryCount = await cache.indexedEntryCount
        let survivingFirst = await cache.image(for: firstSource, targetPixelSize: target)
        let decodeCountBeforeReloadingEvictedEntry = await decoder.decodeCount()

        XCTAssertEqual(indexedEntryCount, 2)
        XCTAssertTrue(first === recentlyHitFirst)
        XCTAssertTrue(first === survivingFirst)
        XCTAssertEqual(decodeCountBeforeReloadingEvictedEntry, 3)

        _ = await cache.image(for: secondSource, targetPixelSize: target)
        let decodeCountAfterReloadingEvictedEntry = await decoder.decodeCount()
        XCTAssertEqual(decodeCountAfterReloadingEvictedEntry, 4)
    }

    @MainActor
    func testDataURLUsesImageIODownsamplingAndCachesInstrumentedDecode() async throws {
        let sourceImage = makeTestImage(pixelSize: CGSize(width: 80, height: 40))
        let pngData = try XCTUnwrap(sourceImage.pngData())
        let dataURL = "data:image/png;base64,\(pngData.base64EncodedString())"
        let recorder = CavePerformanceRecorder(enabled: true)
        let cache = CaveImageCache(performanceRecorder: recorder)
        let target = CGSize(width: 20, height: 20)

        let firstResult = await cache.image(for: .dataURL(dataURL), targetPixelSize: target)
        let secondResult = await cache.image(for: .dataURL(dataURL), targetPixelSize: target)
        let first = try XCTUnwrap(firstResult)
        let second = try XCTUnwrap(secondResult)
        let cgImage = try XCTUnwrap(first.cgImage)

        XCTAssertLessThanOrEqual(cgImage.width, Int(target.width))
        XCTAssertLessThanOrEqual(cgImage.height, Int(target.height))
        XCTAssertTrue(first === second)
        XCTAssertEqual(recorder.counter("image.decode"), 1)
        XCTAssertEqual(recorder.snapshot()["image.decode"]?.count, 1)
    }

    func testClearDropsAnImageThatFinishesDecodingFromAnOlderGeneration() async {
        let decoder = SuspendedFirstImageDecoder()
        let cache = CaveImageCache(decoder: decoder)
        let source = CaveImageSource.dataURL(firstDataURL)
        let target = CGSize(width: 44, height: 44)

        let firstLoad = Task {
            await cache.image(for: source, targetPixelSize: target)
        }
        await decoder.waitUntilFirstDecodeStarts()
        await cache.removeAllImages()
        await decoder.releaseFirstDecode()

        let staleImage = await firstLoad.value
        XCTAssertNil(staleImage)

        let reloadedImage = await cache.image(for: source, targetPixelSize: target)
        let decodeCount = await decoder.decodeCount()
        XCTAssertNotNil(reloadedImage)
        XCTAssertEqual(decodeCount, 2)
    }
}
