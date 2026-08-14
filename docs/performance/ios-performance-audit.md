# Native iOS Performance Audit

Date: 2026-08-10

Scope: `apps/ios/CovenCave`, covering launch persistence, reconnect/bootstrap
work, image decoding, surface loading, transcript rendering, and markdown
rendering. The first six implementation tasks landed in PR #3623; this closeout
adds typed markdown signatures, renderer instrumentation, the final simulator
validation, and the physical-device handoff.

## Before/after metrics

The request/work-count evidence is deterministic rather than a claim about
production-device latency. It proves duplicate work was removed, hot-path work
is bounded, and the optimized paths preserve behavior.

| Path | Baseline | Current bound | Evidence |
| --- | --- | --- | --- |
| Identical attachment decode | Two identical body evaluations or concurrent callers created two decode opportunities | Two identical requests produce exactly one decode per source and target pixel size | `CaveImageCacheTests.testIdenticalDataURLAndTargetSizeDecodeOnce`, `testConcurrentIdenticalLoadsShareOneDecode` |
| Reconnect probe | Two overlapping refresh callers could issue two probes | Two overlapping callers issue exactly one probe | `ConnectionRefreshCoordinatorTests.testConcurrentRefreshesShareOneProbe` |
| Bootstrap resources | Three independent resource reads cost approximately `A + B + C` | The same three reads cost approximately `max(A, B, C)`; failures remain isolated per resource | `testBootstrapLoadsIndependentResourcesConcurrently`, `testBootstrapFailureIsIsolatedPerResource` |
| Thread snapshot load | `Data(contentsOf:)` and JSON decoding ran from `AppModel` initialization | Thread snapshots load through `ThreadSnapshotStore`; missing, corrupt, cancelled, and legacy data paths are explicit | `ThreadSnapshotStoreTests` |
| Chat-list appearance | Two appearances could issue two session-list requests | Two appearances issue one initial request while `sessionsLoaded` is true; pull-to-refresh remains unconditional | `ChatsHomeView.swift`, `ios-surface-load-discipline.test.mjs` |
| Stream mutation lookup | `N` text publications each performed an O(message-count) `firstIndex` scan | `N` text publications use O(1) message-id lookup; the index rebuilds only after structural changes | `TranscriptRowsTests.testIndexUpdatesAfterInsertAndRemove`, `testTextOnlyMutationUpdatesTheRowWithoutRestructuring` |
| Transcript rows | `Array(messages.enumerated())` and day-separator checks were recreated during body evaluation | Stable rows are derived on structural changes and rendered directly | `TranscriptRows.swift`, `ChatView.swift`, `TranscriptRowsTests` |
| Auto-follow scroll | Every published text change could request a scroll | Scroll requests are coalesced to display cadence, while completion still forces the final scroll | `ChatView.swift`, `ios-chat-draft-lag.test.mjs` |
| Markdown streaming | Ad hoc interpolated keys controlled the existing 150 ms throttle | Typed content/style signatures preserve the throttle; `K` identical updates produce zero DOM rebuilds and increment the skip counter `K` times | `MarkdownRenderSignatureTests`, `MarkdownWebView.swift`, `ios-markdown-accent.test.mjs` |

The 50 ms stream-publication cadence caps observed transcript invalidation at
approximately 20 updates per second. The markdown path independently caps
streaming DOM rebuild attempts at approximately 6.7 per second through its
existing 150 ms throttle.

## Instrumentation

`CavePerformanceRecorder` stores bounded aggregate samples and emits OSLog
signpost intervals. Debug builds enable the shared recorder; release builds
leave it disabled by default.

| Name | Kind | Boundary |
| --- | --- | --- |
| `image.decode` | counter and span | ImageIO downsample/decode |
| `markdown.webview.init` | span | `WKWebView` configuration and allocation |
| `markdown.render.streaming` | span | Streaming `caveRender` JavaScript call |
| `markdown.render.settled` | span | Settled `caveRender` JavaScript call |
| `markdown.render.skipped` | counter | Identical render and style signatures |

The recorder tests use injected clocks to prove exact aggregation: a 12 ms
sample records `count = 1`, `latestMilliseconds = 12`, and
`maximumMilliseconds = 12`; the synchronous path records the same shape for
renderer acquisition.

One focused run on the available iPhone 16 Pro simulator recorded:

| Span | Latest duration |
| --- | ---: |
| `markdown.webview.init` | 2517.846584 ms |
| `markdown.render.streaming` | 5.099291 ms |
| `markdown.render.settled` | 10.029041 ms |

These are single-run simulator observations, not device budgets or percentile
claims. `MarkdownRenderSignatureTests` prints the `IOS_PERF` records so a future
run can retain comparable evidence. Renderer acquisition starts before
`WKWebView` allocation and ends when the bundled renderer navigation finishes
or fails, so its cold simulator observation includes bundle loading and WebKit
startup rather than allocation alone.

This audit does not claim app-model, network, persistence, or stream-publication
span timings. Those paths have deterministic request/work bounds above, but do
not yet emit named recorder spans.

Release builds keep the shared recorder disabled unless profiling is explicitly
requested. Enable it with the `CAVE_PERFORMANCE_INSTRUMENTATION=1` environment
variable or the `--performance-instrumentation` process argument. For an
installed simulator Release build:

```bash
SIMCTL_CHILD_CAVE_PERFORMANCE_INSTRUMENTATION=1 \
  xcrun simctl launch --terminate-running-process \
  "$SIMULATOR_ID" ai.opencoven.cave
```

Capture the `ai.opencoven.cave` / `performance` signposts with Instruments'
Points of Interest template.

## Budget status

The design budgets remain the validation contract. A pass below means the
automated evidence directly enforces the bound; a deferred row is not treated
as passed.

| Budget | Status | Evidence / next measurement |
| --- | --- | --- |
| App model initialization <= 50 ms p95 | Deferred | Thread snapshot I/O moved out of initialization, but no `app-model.init` p95 series is captured. Add the named span and collect repeated Release samples. |
| First connection bootstrap local processing <= 250 ms | Deferred | Single-flight and concurrent-resource tests pass; add a local-processing span and collect repeated Release samples. |
| Warm tab selection to stable frame <= 100 ms | Deferred | No stable-frame timing hook exists. Measure with a Release signpost around tab selection and first stable frame. |
| Chat publication cadence 10-20 updates/second | Pass (upper bound) | The 50 ms coalescer limits publication to at most 20 updates/second; terminal events still flush immediately. |
| Main-thread attachment decode in row body = 0 | Pass | `MessageBubble.body` no longer calls `UIImage.fromDataUrl`; cache tests prove one downsampled decode per source/size. |
| Duplicate in-flight fetches for the same bootstrap resource = 0 | Pass | Two concurrent refresh callers share one probe; independent bootstrap resources run once each. |
| Idle background polling while scene inactive = 0 | Pass | Scene-keyed tasks guard on `.active`; the surface-load source contract pins this behavior. |
| Synchronous persistence write on composer keystroke = 0 | Pass | Draft persistence is delayed 250 ms; thread snapshot encoding/writes are debounced and delegated to `ThreadSnapshotStore`. |

## Memory and I/O risk

- The image cache uses target-pixel-size keys, ImageIO downsampling,
  in-flight coalescing, bounded cost/count limits, and generation-aware clear
  behavior. Full-resolution attachment decoding is no longer performed from
  `MessageBubble.body`.
- Thread snapshots use an actor, atomic replacement, compatible JSON decoding,
  and cancellation checks so a cancelled save cannot replace the last valid
  snapshot.
- Performance samples and counters evict the oldest distinct key at their
  configured limits; the recorder does not retain an unbounded event history.
- Transcript rows and indexes are proportional to the current message count,
  not the number of streamed text deltas.

## Validation

Run from the repository worktree:

```bash
pnpm test:mobile
pnpm typecheck
node scripts/ios-chat-draft-lag.test.mjs
node scripts/ios-message-bubble-equatable.test.mjs
node scripts/ios-surface-load-discipline.test.mjs
```

Result: 86 mobile source-contract files passed, TypeScript passed, and all
three targeted iOS source-contract tests passed.

Native validation used an available iPhone 16 Pro simulator, disabled signing,
and reused the pinned WebRTC package cache:

```bash
cd apps/ios/CovenCave
xcodegen generate

xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,id=<simulator-udid>' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO

xcodebuild build -project CovenCave.xcodeproj -scheme CovenCave \
  -configuration Release \
  -destination 'platform=iOS Simulator,id=<simulator-udid>' \
  -derivedDataPath build-release CODE_SIGNING_ALLOWED=NO
```

Result: the full XCTest/UI-test scheme passed in 248.534 seconds and the Release
simulator build succeeded.

## Physical-device gates

These remain intentionally unclaimed until a maintainer runs them on a real
supported iPhone:

1. Cold-launch p50/p95 and first-interaction latency from a clean install.
2. Instruments Energy Log during a long streamed response and repeated image
   attachment viewing.
3. Thermal behavior during sustained chat, voice, and reconnect activity.
4. Memory-pressure behavior with large transcripts and mixed attachment sizes.
5. Wi-Fi/cellular handoff, packet loss, and radio-energy behavior.
6. Release-build OSLog signpost capture with instrumentation explicitly enabled
   through the procedure above.

## Plan differences

- `CaveImageCache` uses injected loader/decoder protocols and
  `image(for:targetPixelSize:)` rather than the plan's loader-closure API.
- The current native view tree has no `CanvasView.swift`; duplicate-load
  coverage applies to the surviving scene-aware root and chat surfaces.
- The image adapter is implemented through the current cache-backed attachment
  and avatar paths rather than a file named `CachedImageView.swift`.

These are implementation-shape differences, not relaxed performance bounds.
