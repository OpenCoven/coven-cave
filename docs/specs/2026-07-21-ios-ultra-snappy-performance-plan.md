# iOS Ultra-Snappy Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure and remove the highest-impact launch, network, media, persistence, and chat rendering bottlenecks in the native iOS app.

**Architecture:** Add small testable performance primitives first, then optimize independent hot paths behind stable interfaces. Preserve the current `AppModel`, `ChatThread`, and SwiftUI navigation contracts while moving expensive decoding/I/O off the main actor, coalescing duplicate work, and bounding transcript updates.

**Tech Stack:** Swift 6, SwiftUI Observation, URLSession, OSLog signposts, XCTest, XcodeGen, Node source-contract tests.

---

## File Map

- Create `apps/ios/CovenCave/CovenCave/Performance/CavePerformance.swift`: named spans, counters, and debug snapshots.
- Create `apps/ios/CovenCave/CovenCave/Media/CaveImageCache.swift`: bounded decoded/downsampled image cache with in-flight coalescing.
- Create `apps/ios/CovenCave/CovenCave/Views/CachedImageView.swift`: SwiftUI adapter for cached remote and data-URL images.
- Create `apps/ios/CovenCave/CovenCave/State/ThreadSnapshotStore.swift`: off-main thread snapshot load/save.
- Create `apps/ios/CovenCave/CovenCave/State/TranscriptRows.swift`: stable row metadata and message-id lookup.
- Modify `AppModel.swift`: concurrent bootstrap, reconnect single-flight, snapshot store integration.
- Modify `CaveClient.swift`: injectable transport session for deterministic request-count tests.
- Modify `RootView.swift`, `ChatsHomeView.swift`, and `CanvasView.swift`: eliminate duplicate/overlapping loads.
- Modify `ChatThread.swift`, `ChatView.swift`, and `MessageBubble.swift`: bounded stream invalidation, stable rows, cached attachments.
- Modify `MarkdownWebView.swift`: exact render signatures and performance spans.
- Add XCTest files under `apps/ios/CovenCave/CovenCaveTests/`.
- Add Node source-contract tests under `scripts/` and register them in `scripts/run-tests.mjs`.
- Create `docs/performance/ios-performance-audit.md`: baseline, findings, before/after evidence, remaining physical-device gates.

### Task 1: Performance measurement foundation

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Performance/CavePerformance.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/CavePerformanceTests.swift`
- Modify: `apps/ios/CovenCave/project.yml`

- [ ] **Step 1: Write the failing unit tests**

```swift
import XCTest
@testable import CovenCave

final class CavePerformanceTests: XCTestCase {
    func testMeasureRecordsDurationAndCount() async {
        let recorder = CavePerformanceRecorder()
        let clock = TestPerformanceClock(values: [.zero, .milliseconds(12)])

        let value = await recorder.measure("bootstrap", clock: clock) { 42 }

        XCTAssertEqual(value, 42)
        XCTAssertEqual(recorder.snapshot()["bootstrap"]?.count, 1)
        XCTAssertEqual(recorder.snapshot()["bootstrap"]?.latestMilliseconds, 12)
    }

    func testCounterAccumulatesDeterministically() {
        let recorder = CavePerformanceRecorder()
        recorder.increment("network.request")
        recorder.increment("network.request", by: 2)
        XCTAssertEqual(recorder.counter("network.request"), 3)
    }
}
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
cd apps/ios/CovenCave
xcodegen generate
xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/CavePerformanceTests
```

Expected: compile failure because `CavePerformanceRecorder` and
`TestPerformanceClock` do not exist.

- [ ] **Step 3: Implement the recorder**

Implement a `@MainActor` recorder with:

```swift
struct CavePerformanceSample: Equatable {
    var count: Int
    var latestMilliseconds: Double
    var maximumMilliseconds: Double
}

protocol CavePerformanceClock: Sendable {
    func now() -> Duration
}

@MainActor
final class CavePerformanceRecorder {
    static let shared = CavePerformanceRecorder()
    func increment(_ name: String, by amount: Int = 1)
    func counter(_ name: String) -> Int
    func snapshot() -> [String: CavePerformanceSample]
    func measure<T>(
        _ name: String,
        clock: any CavePerformanceClock = ContinuousPerformanceClock(),
        operation: () async throws -> T
    ) async rethrows -> T
}
```

Use `OSSignposter` to begin/end intervals and keep only aggregate samples, not
unbounded event history.

- [ ] **Step 4: Run the focused test**

Expected: `CavePerformanceTests` passes.

### Task 2: Cached and downsampled image pipeline

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Media/CaveImageCache.swift`
- Create: `apps/ios/CovenCave/CovenCave/Views/CachedImageView.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/CaveImageCacheTests.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/AvatarView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/MessageBubble.swift`
- Modify: `apps/ios/CovenCave/CovenCave/UIImage+Resize.swift`

- [ ] **Step 1: Write failing cache tests**

Cover:

```swift
func testIdenticalDataURLLoadsOnlyOnce() async throws
func testConcurrentIdenticalLoadsShareOneDecode() async throws
func testDifferentTargetSizesUseDifferentEntries() async throws
func testCostLimitEvictsLeastRecentlyUsedImage() async throws
```

Inject a decoder closure that increments an actor-isolated counter so tests prove
one decode rather than merely equal images.

- [ ] **Step 2: Run the focused test and confirm failure**

Run the same `xcodebuild test` command with
`-only-testing:CovenCaveTests/CaveImageCacheTests`.

- [ ] **Step 3: Implement `CaveImageCache`**

Use an actor with:

```swift
actor CaveImageCache {
    static let shared = CaveImageCache()

    struct Key: Hashable, Sendable {
        let source: String
        let pixelWidth: Int
        let pixelHeight: Int
    }

    func image(
        source: String,
        targetPixels: CGSize,
        scale: CGFloat,
        loader: @Sendable () async throws -> Data
    ) async throws -> UIImage
}
```

Back it with `NSCache<CacheKeyBox, UIImage>` for memory-pressure eviction and a
`[Key: Task<UIImage, Error>]` dictionary for in-flight coalescing. Downsample via
`CGImageSourceCreateThumbnailAtIndex`; never decode full-resolution attachments
for a 44-point avatar.

- [ ] **Step 4: Replace body-time decoding**

`AvatarView` and attachment thumbnails must render through `CachedImageView`.
`MessageBubble.body` must contain no `UIImage.fromDataUrl` call. Preserve the
same fallback, clipping, context menu, and zoom behavior.

- [ ] **Step 5: Run image tests and the existing message-bubble pins**

```bash
node scripts/ios-message-bubble-equatable.test.mjs
cd apps/ios/CovenCave && xcodebuild test -project CovenCave.xcodeproj \
  -scheme CovenCave -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/CaveImageCacheTests
```

Expected: all pass; performance counter `image.decode` increments once for
identical sources and sizes.

### Task 3: Off-main thread snapshot persistence

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/State/ThreadSnapshotStore.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/ThreadSnapshotStoreTests.swift`
- Modify: `apps/ios/CovenCave/CovenCave/State/AppModel.swift`

- [ ] **Step 1: Write failing round-trip and cancellation tests**

Cover compatible decode of current `ThreadSnapshot`, atomic overwrite, missing
file returning `[]`, corrupt file surfacing a typed error, and a cancelled save
not replacing the last valid snapshot.

- [ ] **Step 2: Run the tests and confirm failure**

Expected: compile failure because `ThreadSnapshotStore` does not exist.

- [ ] **Step 3: Implement the actor**

```swift
actor ThreadSnapshotStore {
    init(url: URL)
    func load() throws -> [ThreadSnapshot]
    func save(_ snapshots: [ThreadSnapshot]) throws
}
```

Perform directory creation, file reads, JSON decode/encode, and atomic writes
inside the actor. Keep the existing JSON shape.

- [ ] **Step 4: Integrate with `AppModel`**

Capture immutable snapshots on the main actor, then call the store actor. During
initialization, start one load task and publish decoded threads once. Do not
block `AppModel.init()` with `Data(contentsOf:)`.

- [ ] **Step 5: Run persistence tests**

Expected: tests pass and the `app-model.init` span excludes file I/O.

### Task 4: Concurrent bootstrap and reconnect single-flight

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/State/ConnectionRefreshCoordinator.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/ConnectionRefreshCoordinatorTests.swift`
- Modify: `apps/ios/CovenCave/CovenCave/State/AppModel.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/RootView.swift`

- [ ] **Step 1: Write failing single-flight tests**

Prove that two simultaneous refresh requests execute one probe and both callers
receive the result. Prove cancellation clears the in-flight task. Prove a
loaded-surface refresh starts independent loaders concurrently.

- [ ] **Step 2: Add injectable client protocols**

Extract the minimal methods used by bootstrap into:

```swift
protocol CaveBootstrapClient: Sendable {
    func ping() async -> Bool
    func familiars() async throws -> [Familiar]
    func fetchTheme() async throws -> ThemeSnapshot
    func operatorProfile() async throws -> OperatorProfile
}
```

`CaveClient` conforms without changing public API behavior.

- [ ] **Step 3: Implement single-flight refresh**

`ConnectionRefreshCoordinator` owns at most one
`Task<ConnectionRefreshResult, Never>`. `AppModel.refreshConnection` delegates
the transport decision to it and applies the result on the main actor.

- [ ] **Step 4: Parallelize independent bootstrap reads**

After successful auth/probe:

```swift
async let familiarsResult = Result { try await client.familiars() }
async let themeResult = Result { try await client.fetchTheme() }
async let profileResult = Result { try await client.operatorProfile() }
let results = await (familiarsResult, themeResult, profileResult)
```

Apply successful values independently; one optional resource failure must not
discard the others.

- [ ] **Step 5: Run coordinator tests**

Expected: one probe for concurrent callers and elapsed test time near the
slowest loader rather than the sum of all loaders.

### Task 5: Eliminate duplicate surface loads

**Files:**
- Create: `scripts/ios-surface-load-discipline.test.mjs`
- Modify: `apps/ios/CovenCave/CovenCave/Views/CanvasView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing source-contract test**

Assert that:

- `CanvasView` has one scene-aware load task, not two independent `.task`
  modifiers.
- `ChatsHomeView` guards initial `loadSessions()` with `sessionsLoaded`.
- both surfaces keep pull-to-refresh behavior.

- [ ] **Step 2: Run and confirm failure**

```bash
node scripts/ios-surface-load-discipline.test.mjs
```

Expected: failure on the duplicate Canvas tasks and unguarded Chats load.

- [ ] **Step 3: Consolidate the load tasks**

Use one `.task(id: scenePhase)` in Canvas:

```swift
.task(id: scenePhase) {
    guard scenePhase == .active else { return }
    if !app.canvasLoaded { await app.loadCanvas() }
}
```

Use:

```swift
.task {
    if !app.sessionsLoaded { await app.loadSessions() }
}
```

in Chats. Manual refresh remains unconditional.

- [ ] **Step 4: Run the contract test and `pnpm test:mobile`**

Expected: pass.

### Task 6: Stable transcript rows and bounded stream lookup

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/State/TranscriptRows.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/TranscriptRowsTests.swift`
- Modify: `apps/ios/CovenCave/CovenCave/State/ChatThread.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatView.swift`

- [ ] **Step 1: Write failing row-builder tests**

Cover stable message IDs, correct day separators across timezone/calendar
boundaries, no separator on the first message when not desired, and index lookup
updates after insert/remove.

- [ ] **Step 2: Implement transcript row metadata**

```swift
enum TranscriptRow: Identifiable, Equatable {
    case day(id: String, date: Date)
    case message(DisplayMessage)
}

struct TranscriptIndex {
    private(set) var positionByMessageID: [String: Int]
    mutating func rebuild(messages: [DisplayMessage])
    func position(of id: String) -> Int?
}
```

Build rows only when message identity/date metadata changes, not for every
streamed text delta.

- [ ] **Step 3: Replace O(n) stream mutation lookup**

Use `TranscriptIndex` in `ChatThread.mutate`. Rebuild after structural changes
such as append/insert/remove; text-only mutations retain the same index.

- [ ] **Step 4: Remove per-body enumeration allocation**

`ChatView` renders `thread.transcriptRows` directly. Remove
`Array(thread.messages.enumerated())` and `shouldShowDaySeparator(at:)`.

- [ ] **Step 5: Bound auto-scroll work**

Add a display-cadence scroll coalescer so multiple text publications inside one
frame request one `scrollTo`. Keep the existing `atBottom` guard and final
scroll on stream completion.

- [ ] **Step 6: Run transcript and existing chat tests**

```bash
node scripts/ios-chat-draft-lag.test.mjs
node scripts/ios-message-bubble-equatable.test.mjs
cd apps/ios/CovenCave && xcodebuild test -project CovenCave.xcodeproj \
  -scheme CovenCave -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/TranscriptRowsTests \
  -only-testing:CovenCaveTests/SSELineParserTests
```

Expected: pass; stream publication remains complete and ordered.

### Task 7: Markdown render signatures and measured throttling

**Files:**
- Create: `apps/ios/CovenCave/CovenCaveTests/MarkdownRenderSignatureTests.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/MarkdownWebView.swift`

- [ ] **Step 1: Write failing signature tests**

Create a pure `MarkdownRenderSignature` and prove style-only changes do not
change the content signature, while markdown/streaming/reader changes do.

- [ ] **Step 2: Implement the pure signature**

```swift
struct MarkdownRenderSignature: Equatable {
    let markdown: String
    let streaming: Bool
    let reader: Bool
}

struct MarkdownStyleSignature: Equatable {
    let fontScale: CGFloat
    let theme: ReaderTheme
    let accentHex: String?
}
```

Replace interpolated string keys with these typed values. Keep the existing
150 ms streaming throttle and style-only JavaScript path.

- [ ] **Step 3: Instrument render acquisition and flush**

Measure `markdown.webview.init`, `markdown.render.streaming`, and
`markdown.render.settled`. Increment `markdown.render.skipped` when signatures
prove no work is needed.

- [ ] **Step 4: Run the focused tests**

Expected: style-only updates skip DOM rebuild and existing behavior remains.

### Task 8: Audit report and full validation

**Files:**
- Create: `docs/performance/ios-performance-audit.md`
- Modify: `docs/mobile-readiness.md`

- [ ] **Step 1: Record baseline and after metrics**

Include source evidence, test/benchmark commands, request counts, span timings,
memory-risk findings, implemented changes, and findings intentionally deferred
because they require a physical device.

- [ ] **Step 2: Run repository validation**

```bash
pnpm test:mobile
pnpm typecheck
node scripts/ios-chat-draft-lag.test.mjs
node scripts/ios-message-bubble-equatable.test.mjs
node scripts/ios-surface-load-discipline.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Run native tests**

```bash
cd apps/ios/CovenCave
xcodegen generate
xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO
```

Expected: all XCTest and UI-test targets pass.

- [ ] **Step 4: Build Release for simulator**

```bash
xcodebuild build -project CovenCave.xcodeproj -scheme CovenCave \
  -configuration Release \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath build-release CODE_SIGNING_ALLOWED=NO
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Update the Bead**

Attach branch/worktree, changed-file summary, exact validation output, and
before/after evidence to `cave-9om1`. Keep it open until the change merges or the
explicit completion criteria are accepted.
