# iOS Ultra-Snappy Performance Design

## Objective

Make the native iOS application feel immediate during cold launch, tab changes,
chat streaming, long-thread scrolling, image display, and reconnect recovery.
The work must be evidence-driven: every optimization needs a repeatable
measurement or regression test, and product correctness must remain unchanged.

## Success Conditions

- Cold launch reaches a stable interactive root without unnecessary serial
  network work or synchronous decoding on the main actor.
- Returning to an already loaded app does not refetch unrelated surfaces.
- Chat streaming updates at a bounded cadence and does not animate or scroll the
  entire transcript for every text delta.
- Long transcripts do not repeatedly decode attachment data or construct an
  unbounded number of heavyweight markdown WebViews.
- Avatar and attachment images are decoded, resized, and cached once per
  resource/target size instead of during every SwiftUI body evaluation.
- Performance-critical operations expose signposts or deterministic benchmark
  hooks so regressions can be measured.
- Native unit tests, source-contract tests, release build, and simulator smoke
  validation pass.

## Performance Budgets

These are engineering targets rather than claims about every physical device.
They provide a stable validation contract for representative simulator and
release-build measurements.

| Path | Budget |
|---|---:|
| App model initialization excluding OS launch overhead | <= 50 ms p95 |
| First connection bootstrap after transport response | <= 250 ms local processing |
| Warm tab selection to first stable frame | <= 100 ms |
| Chat stream UI publication cadence | 10-20 updates/second |
| Main-thread attachment decode during row body evaluation | 0 |
| Duplicate in-flight fetches for the same bootstrap resource | 0 |
| Idle background polling while scene is inactive | 0 |
| Synchronous persistence write on composer keystroke | 0 |

## Considered Approaches

### 1. Large architectural rewrite

Split `AppModel` into many stores, replace the chat model, and rebuild the
rendering pipeline. This might produce a clean end state, but it has the highest
regression risk and makes before/after attribution weak.

### 2. Instrument-first targeted optimization (selected)

Add lightweight native measurements, profile the current paths, then optimize
the proven hot spots in isolated layers: bootstrap/network, media/markdown, chat
state publication, and navigation. This preserves behavior, produces reviewable
changes, and allows each gain to be validated independently.

### 3. Cosmetic responsiveness only

Add more optimistic transitions, skeletons, and animations without reducing
work. This can mask latency but does not improve CPU, memory, battery, or
interaction contention, so it is insufficient.

## Architecture

### Performance instrumentation

Introduce a small iOS performance utility around `ContinuousClock` and
`OSSignposter`. It records named spans in debug/test builds and emits signposts
for Instruments in all development builds. The utility must have negligible
release overhead and no external dependency.

Critical spans:

- app-model initialization
- connection bootstrap
- loaded-surface refresh
- thread snapshot decode/encode
- attachment decode/resize
- markdown renderer acquisition and settled render
- chat stream publication

Deterministic unit tests will exercise pure timing/counter helpers. Source
contract tests may pin instrumentation at integration points where XCTest cannot
instantiate the full app safely.

### Bootstrap and network

Connection bootstrap should perform independent reads concurrently after the
health/auth decision succeeds. Theme, operator profile, and familiars do not
depend on each other. Loaded surfaces should only refresh when their tab has
previously been activated.

Duplicate requests need single-flight protection at the `AppModel` layer for
resources that can be triggered simultaneously by scene activation, reconnect,
and a surface task. Cancellation must not leave stale in-flight state.

Polling remains scene-aware. Polls should skip work when the resource already
has an equivalent snapshot, and should avoid overlapping a manual refresh.

### Image pipeline

Replace body-time `UIImage.fromDataUrl` decoding with a bounded, actor-safe image
cache keyed by resource identity and pixel target. Decode and downsample away
from the main actor, then publish the prepared image. Remote avatars should use
the same cache rather than independent `AsyncImage` loaders.

The cache must:

- coalesce identical in-flight loads
- enforce a memory cost limit
- downsample to the displayed pixel size
- return a deterministic fallback on failure
- avoid persisting credentials or sensitive image bytes

### Markdown pipeline

Each settled assistant bubble currently owns a WKWebView-backed renderer.
WebViews are heavyweight, so the transcript should bound active markdown
renderers. Recent/visible messages use the rich renderer; older off-screen
messages use a native lightweight representation until they approach the
viewport or open in Reader.

Renderer work remains throttled while streaming. Settled output should be
memoized by markdown/style key so SwiftUI updates that do not change content do
not call JavaScript again.

### Chat state and scrolling

The existing 50 ms stream coalescer is retained. The remaining work is to stop
whole-transcript side effects:

- avoid `Array(enumerated())` allocation on every body pass
- cache day-boundary metadata instead of rescanning dates per row
- do not attach a transcript-wide animation to every message-count change
- throttle bottom-follow scrolling to the display cadence
- keep message-row equality narrow and stable
- avoid O(n) message lookup for each stream delta by maintaining message-id
  indices or another bounded lookup structure

Correctness invariants include final stream completeness, resume behavior,
message order, reply attribution, offline queue replay, and accessibility.

### Persistence

Thread snapshots already debounce writes, but initialization still decodes files
on the main actor. Snapshot reads and JSON decoding move off-main, then publish
once. Writes use immutable snapshots captured on the main actor and encode/write
off-main with atomic replacement.

No data migration is introduced. Existing snapshot files remain compatible.

## Validation Loop

1. Capture baseline source metrics and native benchmark timings.
2. Add failing regression tests for the targeted behavior.
3. Implement one isolated optimization.
4. Run the focused XCTest or Node source-contract test.
5. Rerun the benchmark and retain the change only when it improves or protects a
   measured path without correctness regressions.
6. Run the complete iOS unit suite and repository mobile suite.
7. Generate the Xcode project, build the Release configuration for an iPhone
   simulator, and launch a representative simulator smoke.
8. Record before/after evidence and remaining device-only checks in the audit.

## Deliverables

- `docs/performance/ios-performance-audit.md` with findings, severity, evidence,
  implemented changes, budgets, and remaining device-only verification.
- Native performance instrumentation and benchmark coverage.
- Optimized bootstrap/network, image, markdown, chat, and persistence paths where
  profiling confirms material cost.
- Regression tests that fail if the optimized contracts are removed.

## Scope Boundaries

- Do not duplicate the open sidebar warmup PR.
- Do not redesign product UI or navigation.
- Do not change server API contracts unless a measured client bottleneck cannot
  be solved safely on-device.
- Android and the responsive web shell are audited only where they share the
  same API or performance contract; the implementation focus is the native iOS
  app under `apps/ios/CovenCave`.
- Physical-device thermal, energy, and radio measurements are documented as a
  final manual gate when unavailable to automation.
