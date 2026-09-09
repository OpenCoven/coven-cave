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

## Renderer integration and physical verification (2026-09-09)

The Phase 0 baseline is reconciled with the renderer lifecycle fix in PR #5324
on main. The integration preserves weak WebKit ownership, terminal disposal,
and late-callback fences. Measurement callbacks follow successful rendering;
a newer pending streaming delta does not suppress the first successful render
or lose its measurement when an earlier transient render fails. Cancelled
stable-frame callbacks cannot complete a later measurement.

The earlier integrated, development-signed **Release** binary (before the
Mermaid payload reduction above) was verified with
`codesign --verify --deep --strict`. Its arm64 UUID is
`9E3098E2-88F8-3764-964C-C29531B903B8`. On the physical iPhone 16 Pro Max,
iOS 26.6.1, all 32 focused native tests passed: 11 renderer lifecycle tests
and 21 performance recorder tests. All four physical UI journeys passed: five
drawer cycles, five rich-render visits, five project switches, and five search
queries. All 101 mobile source-test files passed with the frozen lockfile and
Vitest 4.1.11; typecheck, lint, and test wiring also passed.

The recorder now uses the standard `PointsOfInterest` category. The earlier
custom `performance` category was not collected by the documented Instruments
template. A 190.942-second Time Profiler plus Points of Interest capture saved
and exported successfully. It contains six complete app intervals: five search
queries and one drawer open. Earlier rich-render and project-switch app
processes appear in the trace process list but have no exported app signposts.
Consequently, **the seven-span percentile baseline remains incomplete**.
XCTest duration is not used as an interaction measurement.

## Project-workspace Phase 0 baseline status (updated 2026-09-09)

Issue #5292 extends this audit with seven stable user-interaction spans and a
large deterministic fixture. Implementation and physical Release journey
verification are complete; the table below records the available intervals
and explicitly leaves missing series unmeasured. Earlier device-lock and
incomplete-trace failures are historical diagnostics, superseded by the
successful physical tests and export. The integration is now reconciled with v0.4.2 main; repeat physical verification
and capture all seven series on that smaller renderer before Phase 0 can close.
The earlier timings below are retained as historical evidence, not v0.4.2 metrics. The
reconciled development-signed Release test build succeeded with arm64 UUID
`84F86C66-E821-3207-9663-44C17CDA9071` and passed strict code-signature verification.
All 102 mobile test files, 2,007-file test wiring, frozen installation, typecheck,
and lint passed. All 35 focused native Release simulator tests passed: 21
performance-recorder, 11 renderer-lifecycle, and three packaged-renderer tests.
The unlocked physical iPhone also passed those 35 native Release tests.
Five-visit rich-render UI journeys passed with the test-only capture
attachment pause. The custom Immediate template was recorded by the CLI in
Deferred mode; its saved export retained only rich-render visits four and five
(546.389 ms and 161.231 ms, both warm). First observed is not necessarily first
attempted: complete begin/end pairs do not prove that earlier pairs survived.
A subsequent GUI Immediate recording passed the UI journey but saved no
exportable event stores. Neither capture establishes a cold baseline.

A standard Logging recording with an explicit three-minute retention window
saved and exported the project journey successfully. It contains five drawer,
five switcher-presentation, five projection, and four project-switch/destination
pairs. Coverage and the missing third selection interval are being reconciled against the
UI log before assigning cold/warm labels. The project UI driver now checks the
exact selected project after each tap; its strengthened device run is pending.

The following Logging rich-render capture passed all five visits but exported
only visits two through five. Their warm count is 4, median 133.551 ms, p95 and
maximum 137.642 ms. The interval-table export confirms the same missing initial
events as the raw signpost export. No cold rich-render value is available, and
the seven-span baseline remains open. These small-sample observations do not
establish a regression comparison or a reliable tail-latency estimate.

### Stable spans

All spans use the existing `CavePerformanceRecorder` signpost convention.
Starting a span whose stable name is already active ends the superseded
interval with `phase=cancel`; trace analysis must exclude those intervals.
Completed intervals end with `phase=end`.

| Name | Boundary |
| --- | --- |
| `drawer.open` | Drawer request to the first stable open frame |
| `project.switcher.present` | Switcher request to the first frame containing loaded project rows |
| `project.switch` | Project selection through overlay dismissal and the stable destination frame |
| `destination.stable-frame` | Chats or Tasks selection to the next stable destination frame |
| `search.query` | Published query revision to the stable frame containing its current results |
| `chat.first-rich-render` | First rich assistant message render request through successful JavaScript rendering to its stable-frame callback |
| `project.projection` | Project switcher projection computation |

`project.switch` and `destination.stable-frame` intentionally include the
overlay-dismissal animation. Their future budgets must preserve that boundary
or explicitly introduce a differently named span rather than silently changing
the meaning of these measurements.

### Deterministic Release fixture

Launch with both flags:

```bash
--performance-fixture --performance-instrumentation
```

The optional `--performance-fixture-start-tasks` flag starts task work used by
the UI journeys. Fixture mode is compiled into Release but remains opt-in. It
contains 20 projects, 1,000 local chats, 1,000 server sessions, 1,000 tasks,
and 12 Familiars with overlapping project membership. It also contains
Unassigned/recovery records, an active streaming conversation, and rich
Markdown. All values are deterministic synthetic data.

Fixture persistence is isolated from normal app state:

- chat snapshots use
  `Application Support/performance-fixture/cave-threads.json`;
- widget snapshots use fixture-specific `UserDefaults`, not the production app
  group;
- persisted desktop connection restoration and normal networking are disabled;
- the fixture uses isolated lock preferences and launches unlocked.

The records are distributed across 20 projects. A selected project therefore
renders approximately 50 chats, tasks, and sessions, while global search and
project projection still traverse the full fixture.

### Historical physical Release evidence (before v0.4.2)

Target:

| Field | Value |
| --- | --- |
| Device | iPhone 16 Pro Max (`iPhone17,2`) |
| OS | iOS 26.6.1 (`23G83`) |
| Device identifier | Kept in local evidence; pass it as `$DEVICE_UDID` |
| Xcode | 26.6 (`17F113`) |
| Configuration | Release, automatic development signing |
| Fixture | 20 projects; 1,000 local chats; 1,000 server sessions; 1,000 tasks; 12 Familiars |
| Desktop endpoint | None; deterministic fixture mode |
| Transport | CoreDevice `localNetwork`; tunnel connected |

The earlier development-signed Release binary, UUID
`9E3098E2-88F8-3764-964C-C29531B903B8`, passed 36 focused tests on this
device (32 native and four UI tests). The usable trace was recorded from
07:09:19.017 to 07:12:29.959 CDT on 2026-09-09 and ended with `User pressed Stop`,
not a device disconnection.

All durations below are milliseconds. “Cold” means the first attempted named
interval in a fresh UI-journey app process, not a clean-install launch or cold
OS cache. “Warm” means subsequent attempts in that process. A cancelled first
attempt does not promote a later completion into the cold bucket. Cold labels
also require independent evidence that the entire process journey was retained;
the historical classification below remains provisional pending that check. p95 uses
nearest rank; at these small sample counts it equals the maximum and is only
a baseline observation, not a reliable tail-latency estimate.

| Span | Cold count | Cold median | Cold p95 | Cold max | Warm count | Warm median | Warm p95 | Warm max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `drawer.open` | 1 | 172.994 | 172.994 | 172.994 | — | — | — | — |
| `project.switcher.present` | — | — | — | — | — | — | — | — |
| `project.switch` | — | — | — | — | — | — | — | — |
| `destination.stable-frame` | — | — | — | — | — | — | — | — |
| `search.query` | 1 | 268.148 | 268.148 | 268.148 | 4 | 190.063 | 196.698 | 196.698 |
| `chat.first-rich-render` | — | — | — | — | — | — | — | — |
| `project.projection` | — | — | — | — | — | — | — | — |

The em dashes mean **not measured**, not zero. Analysis filters the
`ai.opencoven.cave` subsystem to the three fresh UI-journey app processes
started after capture began, excluding the partially observed initial drawer
process and the unit-test process with injected clocks. It pairs begin/end
records by process, span name, and signpost identifier. Cancelled, incomplete,
and ambiguous intervals are excluded; none occurred in the six recovered
intervals. Only the final search process contributed samples.

The raw trace, XCTest result bundle, exported XML, analysis script, and sample
JSON are retained in the maintainer's private `ios-baseline-20260909` evidence
bundle. The all-process trace is not published because it includes unrelated
process metadata. Instruments emitted system-dylib overlap warnings during
save/export; no CPU attribution claim is made from this trace. The six explicit
app begin/end pairs remain inspectable in the exported signpost table.

No bottleneck ranking or Phase 1 budget is ratified from these partial series.
The remaining spans plus SwiftUI, memory, and Power Profiler evidence still
need collection.

Exact Release test-build command:

```bash
cd apps/ios/CovenCave
xcodebuild \
  -project CovenCave.xcodeproj \
  -scheme CovenCave \
  -configuration Release \
  -destination "platform=iOS,id=$DEVICE_UDID" \
  -derivedDataPath build-device \
  -allowProvisioningUpdates \
  ENABLE_TESTABILITY=YES \
  -only-testing:CovenCaveUITests/PerformanceBaselineUITests/testRepeatedDrawerOpen \
  test
```

When `xcrun xctrace list devices` reports the iPhone as online, use
`test-without-building` against the same DerivedData while Instruments records
the isolated journeys. Keep cold and warm runs separate, preserve the raw
`.trace` bundles, exclude `phase=cancel`, and report count, median, p95, and
maximum from completed intervals only.

### Isolated capture procedure (coverage validation required)

Start Instruments after the XCTest UI runner has started, and before the
fixture app launches. Starting the recording before runner installation can
lose the device connection. An earlier Deferred recording listed several
completed app processes but exported signposts only for the final process; the
cause is not established.

The UI tests accept an optional `CAVE_PERFORMANCE_CAPTURE_DELAY_SECONDS`
runner environment variable. It defaults to no delay and accepts finite values
between 0 and 60 seconds, exclusive of 0. This test-only pause precedes
`XCUIApplication.launch()` and is outside all measured app intervals.

For a prepared Release test build, copy its `.xctestrun` file alongside the
original in `Build/Products`, then set the UI runner environment:

```python
import plistlib
from pathlib import Path

products = Path("build-device/Build/Products")
plans = list(products.glob("CovenCave_*.xctestrun"))
assert len(plans) == 1
plan = plistlib.loads(plans[0].read_bytes())
plan["CovenCaveUITests"].setdefault("EnvironmentVariables", {})[
    "CAVE_PERFORMANCE_CAPTURE_DELAY_SECONDS"
] = "40"
(products / "CovenCave-capture.xctestrun").write_bytes(plistlib.dumps(plan))
```

Use `xcodebuild test-without-building -xctestrun` with that copy and exactly
one `-only-testing:CovenCaveUITests/PerformanceBaselineUITests/<method>`.
When `PERFORMANCE_CAPTURE_READY` appears in its log, start the chosen
signpost-capable Instruments configuration before the 40-second pause ends.
The current exportable configuration is the standard Logging template with
`--all-processes --window 180s --time-limit 150s`; the retention window exceeds
the recording limit. Verify `Windowed (3 minutes)` in the exported TOC.
A signpost-only configuration avoids CPU sampling, but trace finalization may
still perform remote symbol processing. Blank plus Points of Interest and a
custom Immediate `os_signpost` template both entered that stage locally;
neither is yet a validated replacement capture recipe. Use the same verified
configuration for each reported latency journey; collect CPU profiles
separately. Wait for the journey to pass, stop Instruments, and wait for the
trace to save before launching the next journey. Export and inspect
actual completed span counts and align every expected interaction with the UI
log before assigning cold/warm labels; successful UI assertions alone are not
timing evidence. Keep the raw trace and generated test plan private.

### Simulator journey evidence

The iPhone 16 Pro simulator on iOS 26.5 passed all three deterministic UI
journeys:

| Journey | Repetitions | Result |
| --- | ---: | --- |
| Repeated drawer open | 5 | Passed |
| Repeated project switch | 5 | Passed |
| Repeated global search publication | 5 | Passed |

The complete run recorded 3 passed tests and 0 failures in
`Test-CovenCave-2026.09.06_19-02-22--0500.xcresult`. A focused repeated-drawer
run also passed in
`Test-CovenCave-2026.09.05_07-19-19--0500.xcresult`.

The navigation journeys launch with
`--performance-fixture-start-tasks`. This avoids mounting rich Markdown during
accessibility automation because the iOS 26.5 simulator reports duplicate
`UIAccessibilityLoaderWebShared` implementations in WebCore and WebKit and
warns that the condition can cause mysterious crashes. The default fixture
starts on the rich-chat path. The new dedicated rich-render journey passed
on the physical device; its timing series still needs a separate capture.

These results prove the fixture and repeated interaction paths are stable under
automation. They do not provide simulator latency percentiles: the available
`xctrace` CLI could not finalize a usable simulator trace, and XCTest wall-clock
duration includes build, runner startup, and automation overhead rather than
the instrumented interaction boundaries.

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

Capture the `ai.opencoven.cave` / `PointsOfInterest` signposts with Instruments'
Points of Interest template.

## Budget status

The design budgets remain the validation contract. A pass below means the
automated evidence directly enforces the bound; a deferred row is not treated
as passed.

| Budget | Status | Evidence / next measurement |
| --- | --- | --- |
| App model initialization <= 50 ms p95 | Deferred | Thread snapshot I/O moved out of initialization, but no `app-model.init` p95 series is captured. Add the named span and collect repeated Release samples. |
| First connection bootstrap local processing <= 250 ms | Deferred | Single-flight and concurrent-resource tests pass; add a local-processing span and collect repeated Release samples. |
| Warm tab selection to stable frame <= 100 ms | Deferred | The destination stable-frame hook exists, but no completed physical series was exported. Its drawer-dismissal boundary also differs from direct tab selection; do not silently compare the two. |
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

The following broader performance gates remain unclaimed; the focused physical
Release interaction tests and partial signpost capture above do not satisfy them:

1. Cold-launch p50/p95 and first-interaction latency from a clean install.
2. Instruments Energy Log during a long streamed response and repeated image
   attachment viewing.
3. Thermal behavior during sustained chat, voice, and reconnect activity.
4. Memory-pressure behavior with large transcripts and mixed attachment sizes.
5. Wi-Fi/cellular handoff, packet loss, and radio-energy behavior.
6. Complete seven-span Release-build OSLog series with instrumentation enabled.
   Capture/export is verified; the missing series in the table remain open.

## Plan differences

- `CaveImageCache` uses injected loader/decoder protocols and
  `image(for:targetPixelSize:)` rather than the plan's loader-closure API.
- The current native view tree has no `CanvasView.swift`; duplicate-load
  coverage applies to the surviving scene-aware root and chat surfaces.
- The image adapter is implemented through the current cache-backed attachment
  and avatar paths rather than a file named `CachedImageView.swift`.

These are implementation-shape differences, not relaxed performance bounds.
