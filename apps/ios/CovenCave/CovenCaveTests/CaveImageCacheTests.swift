import XCTest
import UIKit
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
    private let delay: Duration
    private let outputPixelSize: CGSize?

    init(delay: Duration = .zero, outputPixelSize: CGSize? = nil) {
        self.delay = delay
        self.outputPixelSize = outputPixelSize
    }

    func decode(data: Data, targetPixelSize: CGSize) async -> UIImage? {
        count += 1
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

final class CaveImageCacheTests: XCTestCase {
    private let firstDataURL = "data:image/png;base64,AQID"
    private let secondDataURL = "data:image/png;base64,BAUG"
    private let thirdDataURL = "data:image/png;base64,BwgJ"

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
