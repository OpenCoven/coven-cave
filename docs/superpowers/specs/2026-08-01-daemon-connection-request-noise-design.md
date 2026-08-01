# Daemon Connection and Request-Noise Design

## Context

The Cave shell polls `/api/daemon/status` every five seconds. A failed local
health request can take longer than that because `callDaemonTarget()` applies a
hard deadline and then retries failed GET requests. The interval starts another
request without waiting for the previous one, so an unavailable daemon can
produce overlapping probes.

The status route is also much heavier than a heartbeat. It loads a reconciled
config/state snapshot, checks every configured executor, persists hub
reachability, may replay offline travel work, may wake a local sub-daemon, and
resolves version metadata. Settings surfaces can request the same route while
the shell poll is active.

The Cave-side paths that created unattached interactive daemon PTYs have already
landed on `main`. The remaining PTY reaper and event-log compaction work belongs
to the upstream Coven daemon and cannot be completed in this repository's
single PR.

## Goals

1. Keep shell connection state responsive without overlapping requests.
2. Bound request volume and latency while the daemon is unavailable.
3. Prevent concurrent consumers from multiplying identical daemon probes.
4. Keep detailed diagnostics and travel/executor side effects out of the
   recurring heartbeat.
5. Apply the same cancellation, deduplication, and backpressure rules to other
   high-noise request producers found by the audit.
6. Preserve explicit Start, Retry, refresh, stream, and mutation behavior.

## Non-goals

- Replacing health polling with WebSockets or SSE.
- Changing separately owned onboarding or iOS reconnection work.
- Implementing upstream daemon PTY reaping or SQLite event compaction.
- Refactoring unrelated API routes or UI surfaces without measured evidence.

## Chosen Architecture

### 1. Pure connection snapshot

Add a server module that resolves the configured daemon target and returns only
the fields needed by the shell connection banner and auto-start decision:

- `running`
- machine-readable `availability`
- normalized failure reason
- `checkedAt`
- target summary

It must not probe executors, mutate travel state, replay queued work, start a
daemon, or resolve installed version metadata.

Expose the snapshot through a narrow connection endpoint. The existing
`/api/daemon/status` route remains the detailed Settings/diagnostics endpoint.

### 2. Bounded server probe broker

Connection snapshots share one in-flight probe per resolved target. A short,
bounded TTL allows near-simultaneous consumers to reuse the latest result.
Cache entries are keyed by target identity so local/hub configuration changes
cannot reuse a result for the wrong destination.

Background heartbeat probes do not perform the generic GET transport retry:
the next supervised poll is already the retry, and doubling a failed health
request is what lets one poll exceed the interval. Explicit trusted refreshes
after Start bypass stale cache and request a fresh probe.

The broker exposes test-only dependency seams and reset/invalidation helpers;
it never caches indefinitely or converts failures into successful responses.

### 3. Serial adaptive connection supervisor

Replace the shell's fixed interval with a testable controller:

- only one request may be in flight;
- the next timer is scheduled after the current request settles;
- online checks use the normal foreground cadence;
- unavailable/offline checks use bounded exponential backoff with jitter;
- hidden/background windows do not poll;
- focus/visibility recovery triggers one immediate fresh request;
- unmount aborts the active request and clears its timer;
- manual Retry and successful Start trigger a fresh request without waiting for
  the backoff timer;
- stale completions cannot overwrite newer explicit refreshes.

The existing connection classification and offline/healthy hysteresis remain
authoritative. A transient missed probe must not immediately announce a hard
offline state, and an explicit trusted post-Start success may clear the banner
immediately.

The scheduler receives injectable clocks, randomness, request functions, and
visibility state so timing behavior is deterministic in tests.

### 4. Detailed status remains explicit

Settings and diagnostics continue using `/api/daemon/status` for executor,
travel, workspace, version, and daemon details. Those reads are surface-scoped,
abortable, and user-refreshable. The recurring shell heartbeat no longer pays
their cost or triggers their side effects.

Any configuration mutation or successful daemon Start invalidates the relevant
connection snapshot before a trusted refresh. This prevents a cached offline
answer from restoring the banner after recovery.

### 5. Adjacent request-noise audit

Inventory current mount-time, recurring, visibility, and retry producers from
the branch state. Patch only paths with concrete evidence of at least one of:

- overlapping requests;
- duplicate requests for the same resource;
- work continuing after unmount or supersession;
- fixed-rate retry during persistent failure;
- expensive full-detail reads used only for a small health signal.

Use existing shared lifecycle primitives where they fit. Add a focused helper
only when the daemon supervisor's semantics are distinct. Do not change
explicit user actions, mutations, or active streams merely to reduce counts.

## Error Handling

- Transport, timeout, malformed, authorization, and HTTP failures retain the
  existing machine-readable availability taxonomy.
- Abort caused by supersession, backgrounding, or unmount is neutral and must
  not publish an offline result.
- The connection endpoint reports storage/reconciliation unavailability
  separately from daemon offline state.
- No broad catch converts an unknown server defect into a healthy snapshot.
- Client failures remain retryable and never offer Start unless the accepted
  classification proves the local target is offline.

## Validation

### Baseline and regression loop

1. Record the current offline request timing and demonstrate overlapping
   five-second polls when a request lasts beyond the interval.
2. Add failing tests for serial scheduling, backoff/jitter bounds, focus
   recovery, abort neutrality, stale-response fencing, server single-flight,
   TTL/key separation, and trusted invalidation.
3. Implement the smallest unit that makes each test pass.
4. Measure the patched offline loop: peak in-flight connection requests must be
   one, and request cadence must back off within the documented bounds.
5. Audit adjacent producers and repeat the evidence-first loop for each change.

### Repository gates

- focused daemon connection/API/component tests;
- focused tests for every adjacent producer changed;
- `pnpm check:tests-wired`;
- `pnpm typecheck`;
- `pnpm lint`;
- relevant app and API suites;
- production build;
- desktop startup smoke if native launch behavior is touched;
- `git diff --check`;
- cumulative code review before PR;
- all required PR checks and review conversations resolved before squash merge.

## Success Criteria

- The shell never overlaps connection probes.
- Persistent failure reduces rather than increases request pressure.
- Concurrent heartbeat consumers share equivalent server work.
- The heartbeat route performs no executor/travel/replay/start/version work.
- Explicit Start/Retry observes a fresh result.
- All changed request producers have tested lifecycle/backpressure behavior.
- One scoped PR merges to `main`, the Bead records verification evidence, and
  the branch/worktree is cleaned after `pnpm beads:worktrees`.
