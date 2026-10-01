# Native iOS Performance Audit

Date: 2026-08-10

Scope: `apps/ios/CovenCave`, covering launch persistence, reconnect/bootstrap
work, image decoding, surface loading, transcript rendering, and markdown
rendering. The first six implementation tasks landed in PR #3623; this closeout
adds typed markdown signatures, renderer instrumentation, the final simulator
validation, and the physical-device handoff.

## September 9 responsiveness hotfix

The renderer's single-file IIFE included the entire Mermaid dependency graph
even though diagram initialization was deferred. Every assistant message
therefore loaded that JavaScript payload, including messages without diagrams.
The diagram engine now lives in a separately bundled local
`markdown-mermaid.js`, loaded only for a settled Mermaid block. Streaming
placeholders, ordinary markdown, code highlighting, and tables keep the small
core renderer; the reader reuses the same lazy engine.

The minified startup JavaScript fell from 3,620,968 bytes to approximately
160 KB (about 95.6% less). This measures per-renderer payload, not total app
download size or a claimed device-latency percentile. The remaining diagram
payload is still packaged offline. `ios-markdown-bundle.test.mjs` enforces a
512 KiB startup ceiling and excludes Mermaid dependencies from the core graph.

`MarkdownBundleLoadingTests` exercises the packaged files in real WKWebView:
ordinary markdown and streaming placeholders load no diagram script; settled
diagrams produce SVG and reuse one script; a missing diagram resource preserves
readable source and rejects the render so native fallback can handle it.
The focused Release simulator run passed these three tests plus the fifteen
existing renderer lifecycle/signature tests. The previously merged renderer
teardown repair remains intact. No new physical-device latency or thermal
claim is made by this hotfix.

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

Capture the `ai.opencoven.cave` / Points of Interest signposts with Instruments'
Points of Interest template. On a physical device, set the template's recording
mode to **deferred**. In immediate mode the device's log buffer outruns the
transfer, because every subsystem's Points of Interest traffic shares it, so a
multi-minute capture keeps only its last minute or so. A 20-cycle warm capture
kept app spans from only its final 48 seconds this way.

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

## Inline image zoom bounds (#5314)

Inline images use `CaveImageCache` rather than a full-source `UIImage` path.
The loader accepts at most 32 MiB of encoded image bytes, preflights base64
before decoding, and enforces the same cap as response chunks arrive.
Requests use an ephemeral session without shared cookies or credentials,
with 15-second request and 30-second resource timeouts. Explicit bearer
requests retain the existing redirect guard; inline remote images do not
receive pairing credentials.

ImageIO rejects source dimensions above 32,768 pixels per axis or 100 million
pixels total. Target dimensions are limited to 4,096 pixels per axis; EXIF
orientation is applied when fitting the target. Two load/decode operations
can run concurrently and six can wait; excess requests return the same
explicit failure UI. Same-source/target requests still share one operation.
The existing 48 MiB decoded-image cache budget remains unchanged. Data-URL
cache keys retain a 32-byte SHA-256 digest rather than the encoded source text.
Cancellation propagates into detached decode work and is checked before and
after ImageIO calls. A synchronous ImageIO call already in progress cannot be
interrupted; its scheduler slot remains held until it actually returns.

Owner disposal, content replacement, another image selection, and pairing
changes cancel pending inline presentation. Pairing generation checks also
reject old WebKit messages queued before the authority changed. Failed image
loads show a static message; the original image HTML is never a fallback.

Native behavioral tests cover resource caps, coalescing, cancellation,
orientation, and the inline entry point. These bounds do **not** establish
physical-device performance acceptance: #5314 still requires Release-device
Time Profiler/Allocations evidence, 100 zoom/dismiss cycles, and the #5310
memory/hitch gates. Simulator tests do not establish VoiceOver acceptance.

Use `pnpm mobile:ios:xcodegen` to generate the local Xcode project. Its wrapper
builds and verifies markdown resources before XcodeGen scans them. Running
XcodeGen directly can omit files later created by the pre-build script.
Verify `markdown.html` exists inside the built app before interpreting a
renderer test result.

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


## Current-shell baseline fixture (#5292, in progress)

The explicit `--performance-fixture` launch argument installs deterministic,
non-sensitive data: 20 projects, 1,000 local chats, 1,000 server sessions,
1,000 tasks, 12 familiars, and an unassigned conversation. It uses a separate
preferences suite and thread store. Pairing and live connection configuration
are disabled in this mode. Enable `--performance-instrumentation` separately
to record spans in a Release build.

The first conversation, **Rich streaming fixture**, contains Markdown and a
synthetic text update every 50 ms while the scene is active. Updates use the
existing in-place transcript mutation path. The response grows for 200 updates
(about ten seconds), then holds that length while its final character keeps
alternating, so rendering continues at the same cadence and message size stays
bounded. It never snaps back to the opening text: no live reply shrinks, and a
multi-thousand-point shrink leaves the transcript blank when it is not following
the latest message (#5613). Each foreground interval starts the sequence again;
backgrounding cancels the loop.
This exercises rendering and publication, not network ingestion or server work.

The current shell has Chats and Settings, with inline chat search.
`drawer.open` starts at the drawer-state change and waits for SwiftUI's
animation-removal completion, layout, and two display ticks. Closing cancels
an unfinished open sample. `destination.stable-frame` starts at a change of
selected destination and waits for its transaction to complete and the drawer
to close and finish animating, then ends at the next display tick. Until
2026-09-28 it instead hopped to a task, mounted a reporter view and waited two
display ticks, which added about 36–40 ms at 60 Hz that was not app work (see
#5292). Samples from before then are not comparable. Delayed callbacks match their
original span so they cannot complete a newer visit. These measurements include
the existing animation duration; no fixed sleep substitutes for completion. Retired
Tasks/project-switcher journeys must not be restored to satisfy the older
baseline wording. `chat.list-projection` measures construction of the current
chat list snapshot, including source filtering. `search.query` starts when a
new query is published and ends after layout and two display ticks. Superseded
queries, backgrounding, and navigation to Settings cancel unfinished samples.
These boundaries do not establish that every asynchronous renderer is idle.

`chat.first-rich-render` covers an assistant Markdown bubble's renderer creation
through its first successful JavaScript render, height publication, and two
display ticks after attachment to a window. It includes cold WebKit acquisition.
Each renderer instance records at most one sample; scrolling a bubble out and
back into a newly created renderer is a separate mount, not a second sample on
the same renderer. Failure, teardown, or app deactivation cancels an unfinished
sample. Image loading and later streaming updates are outside this boundary.

Physical Release measurements, cold/warm distributions, trace-based bottleneck
ranking, and measured budgets remain outstanding. No simulator, parser, or
unit-test result in this work constitutes that acceptance.

### Release capture driver

Generate the Xcode project with `pnpm mobile:ios:xcodegen`. The
`CovenCavePerformance` scheme builds the app and UI runner in Release, selecting
only `PerformanceBaselineUITests`; it does not enable testability or import the
production app into the native unit-test target. The ordinary Debug scheme skips
this capture class; routine PR CI compiles the UI bundle and runs native unit
tests. Qualify the capture journey separately with the Release scheme.

```bash
xcodebuild build-for-testing \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCavePerformance \
  -destination 'id=<physical-core-device-uuid>' \
  -derivedDataPath /tmp/cave-performance-release
```

Use portrait orientation for this driver: its drawer tap-placement guard follows
the current portrait panel width and footer inset. It waits for the control to
reach its on-screen position; this is not an animation measurement. Landscape
safe-area geometry needs a separate driver qualification.

The driver opens the rich streaming fixture, visits Settings and Chats, searches
for `Fixture chat 999`, and selects its exact local chat row. Leaving the rich
thread makes the next cycle mount a renderer again. Warm journeys perform one
explicit priming cycle followed by the requested measured cycles. Cold journeys
launch a new app process for each cycle; this does **not** establish a clean
install or cold OS/WebKit caches. App startup precedes the cycle window and
must be analyzed separately if launch latency is being reported.

Configure the UI runner through its generated `.xctestrun` file, not an assumed
forwarding of shell environment variables. Copy that file within its generated
`Build/Products` directory to preserve `__TESTROOT__` paths. Set the UI target's
`EnvironmentVariables.CAVE_PERFORMANCE_REPETITIONS` to the desired count
(1–100; default 1). For externally launched warm Instruments captures, also set
`EnvironmentVariables.CAVE_PERFORMANCE_ATTACH_RUNNING` to `1`, and set
`OnlyTestIdentifiers` to
`["PerformanceBaselineUITests/testCurrentShellWarmJourneys"]`. Run the copied
file using `xcodebuild test-without-building -xctestrun <copy> -destination
'id=<physical-core-device-uuid>'`.

For attach captures, first install the exact signed `CovenCave.app` and
`CovenCaveUITests-Runner.app` from `Build/Products/Release-iphoneos` with
`xcrun devicectl device install app --device <physical-core-device-uuid> <app>`.
Do this **before** Instruments launches the fixture. In the copied UI target
configuration, set `UseDestinationArtifacts` to `true` so the test run cannot
reinstall the running capture app. Xcode restricts this option to physical iOS
devices; a Simulator run cannot qualify that installation policy. As specified
by `man xcodebuild.xctestrun`:

- Preserve `TestHostBundleIdentifier` from the generated configuration.
- Set `UITargetAppBundleIdentifier` to `ai.opencoven.cave`.
- Move the generated `TestBundlePath` value to
  `TestBundleDestinationRelativePath` (it uses the `__TESTHOST__` placeholder).
- Remove `TestBundlePath`, `TestHostPath`, and `UITargetAppPath`.

Verify the captured app process identity survives the driver; matching bundle
identifiers alone do not prove Instruments remained attached to the same process.

In attach mode Instruments must first launch `ai.opencoven.cave` with **both**
`--performance-instrumentation --performance-fixture`. Activating an existing
app does not apply launch arguments; the runner's process-state check cannot
verify them. Retain the external launch command as fixture evidence. The warm
driver leaves that process running so Instruments controls capture completion.
For cold attach captures, select only
`PerformanceBaselineUITests/testCurrentShellColdJourneys`, set repetitions to
`1`, and retain a fresh external launch/PID receipt for that cycle. The driver
cannot establish process freshness from its running-state check. It performs
one cold cycle and leaves that process running; attached cold repetitions above
one fail before activation. Repeat cold captures through separate external
launches and traces. Do not run the default full suite with attach enabled:
method ordering cannot establish cold-process freshness, and an attached trace
must not be assumed to follow later launches.
Instruments uses the hardware UDID, which can differ from the CoreDevice UUID
accepted by `devicectl` and `xcodebuild`.

Each successful cycle retains a JSON XCTest attachment containing its phase,
index, and start/end Unix timestamps from the UI runner. Export these from the
`.xcresult`, correlate them with the trace's clock, and include only completed
app spans wholly inside the selected cycle windows. Exclude `priming-exclude`
and cancelled spans. Keep cold and warm distributions separate. A cycle's
wall-clock duration includes UI automation and is **not** an interaction sample;
calculate count, median, p95, and maximum from the named app spans only. Verify
clock alignment and trace coverage before calculating statistics. These driver
instructions alone do not supply physical measurements or ratify budgets.

### Automated warm capture on a device

A device keeps only about the last 48 seconds of signposts per Instruments
recording. That held in immediate and deferred mode, with the all-subsystem
template and with the Points of Interest instrument alone. One long recording
therefore cannot hold a warm distribution. `pnpm ios:performance:capture` runs
one recording per measured cycle instead, then merges them:

```bash
pnpm ios:performance:capture --device <core-device-uuid> \
  --products /tmp/cave-performance-release/Build/Products --out /tmp/cave-capture
```

Build with `build-for-testing` as above and install both apps first. Keep the
phone unlocked, in portrait, with Auto-Lock off; the script refuses a locked
device. It reads the hardware UDID for Instruments from `devicectl`. From the
generated `.xctestrun` it writes an attach-mode copy for one warm cycle
(`CAVE_PERFORMANCE_REPETITIONS=1`, `CAVE_PERFORMANCE_ATTACH_RUNNING=1`,
`UseDestinationArtifacts`, retained attachments).

Each round (20 by default, `--rounds N`):

1. It launches a fresh fixture process and confirms that PID is the running Cave
   process. A failed rich open can leave a process unable to mount its renderer
   for the rest of its life (#5613).
2. It attaches the Points of Interest instrument, retrying and waking the device
   tunnel through `devicectl` process listings.
3. It runs the driver's priming cycle plus one warm cycle.
4. It stops and saves the recording.

A round is retried up to three times when any of these happens:

- the driver fails;
- the fixture process changes during the cycle;
- the recording hangs while saving;
- the retained data does not cover the warm window, meaning it starts after the
  window or holds no completed span inside it.

`--resume` keeps covered rounds, and `--analyze-only` re-merges every `r<N>`
round directory in an existing `--out` directory.

The merge keeps completed spans wholly inside each round's warm window,
excludes the priming cycle and cancelled spans, and prints count, median,
nearest-rank p95 and max per span. Every span is emitted with an exclusive
signpost ID, so when two intervals of one name overlap (renderer spans run per
mounted bubble), the trace cannot pair them. That whole group is reported as
overlapping and left out rather than guessed. A span with no completed sample
still gets a row. It writes the same data to `summary.json`
and names any round it skipped. The 2026-09-27 baseline on #5292 came from
these rounds, and re-analysing that capture with this script reproduces it.
`--cold` measures the first cycle of a freshly launched fixture process
instead (`testCurrentShellColdJourneys`, phase `cold-app-launch`), one process
and one recording per round. App startup precedes the window and is excluded;
this is not a clean install and does not clear OS or WebKit caches. A cold
process emits no span before the driver's first tap, so a cold round counts as
covered when all four of the journey's `drawer.open` spans fall inside its
window. In both modes the recorder starts the driver only after `xctrace`
reports that it is recording, and is stopped as soon as the test case ends,
before `xcodebuild` writes its result bundle.

### Device baseline, 2026-10-01 (#5292)

Signed Release `CovenCavePerformance` build of `main` at `ce0c9c71f` (0.5.5,
build 2026100108) on an iPhone 16 Pro Max, iOS 27.0 (24A437), portrait, with
the isolated fixture and instrumentation enabled. Points of Interest only;
no desktop endpoint is involved (the fixture is offline).

The capture receipt on [#5292](https://github.com/OpenCoven/coven-cave/issues/5292#issuecomment-5941001437)
records 10 rounds in each mode. The device UUID is shown as the receipt's
placeholder; the cold command below expands its elided products path to the
same Release products directory used for the warm command.

```bash
pnpm ios:performance:capture --device <core-device-uuid> \
  --products /tmp/cave-dev-evidence-release/Build/Products \
  --out /tmp/cave-dev-evidence-capture --rounds 10
node scripts/ios-performance-capture.mjs --cold --device <core-device-uuid> \
  --products /tmp/cave-dev-evidence-release/Build/Products \
  --out /tmp/cave-dev-evidence-cold --rounds 10
```

| span | warm (10 cycles) n · median / p95 / max ms | cold (10 processes) n · median / p95 / max ms |
| --- | --- | --- |
| `drawer.open` | 40 · 66.3 / 82.9 / 99.4 | 40 · 81.7 / 82.8 / 98.8 |
| `destination.stable-frame` | 20 · 72.3 / 73.7 / 74.1 | 20 · 95.5 / 134.4 / 141.8 |
| `search.query` | 41 · 59.8 / 173.5 / 185.8 | 40 · 124.5 / 142.0 / 150.0 |
| `chat.first-rich-render` | 20 · 220.2 / 268.8 / 333.2 | 20 · 315.9 / 438.6 / 449.0 |
| `markdown.webview.init` | 20 · 167.0 / 236.8 / 293.1 | 20 · 264.7 / 350.1 / 356.2 |
| `markdown.render.streaming` | 1,301 · 4.8 / 19.0 / 55.7 | 1,263 · 5.0 / 19.1 / 124.0 |
| `markdown.render.settled` | 10 · 9.3 / 13.5 / 13.5 | 10 · 9.8 / 11.9 / 11.9 |
| `chat.list-projection` | 297 · 1.9 / 6.2 / 8.2 | 150 · 1.9 / 3.3 / 5.0 |

Warm `search.query` splits into 31 typed queries (57.7 / 69.4 / 100.2 ms) and
one clear back to 1,500 rows per cycle (10 samples, 171.0 / 185.8 / 185.8 ms),
the recorded known exception. In a cold process the first rich render is the
first WebKit acquisition (10 samples, median 399 ms, max 449 ms) and the first
destination switch takes 103.9–141.8 ms; the second of each is near warm cost.
