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
4. Keep detailed diagnostics, executor probes, version resolution, and
   unrelated side effects out of the recurring heartbeat while preserving
   focused travel transition/replay semantics.
5. Apply the same cancellation, deduplication, and backpressure rules to other
   high-noise request producers found by the audit.
6. Preserve explicit Start, Retry, refresh, stream, and mutation behavior.

## Non-goals

- Replacing health polling with WebSockets or SSE.
- Changing separately owned onboarding or iOS reconnection work.
- Implementing upstream daemon PTY reaping or SQLite event compaction.
- Refactoring unrelated API routes or UI surfaces without measured evidence.

## Chosen Architecture

### 1. Connection snapshot and separate travel reconciliation

Add a server module that resolves the configured daemon target and returns only
the fields needed by the shell connection banner and auto-start decision:

- `running`
- machine-readable `availability`
- normalized failure reason
- `checkedAt`
- target summary

Expose that snapshot through a narrow read-only connection endpoint. `GET
/api/daemon/connection` awaits only the shared snapshot broker and returns the
result; a successful snapshot must never be replaced by downstream travel
reconciliation work.

Move the focused travel side effects into a dedicated `POST
/api/daemon/travel/reconcile` route. That route first reuses the current
connection snapshot through the same broker, then runs a narrow shared helper
that persists hub reachability, advances the 10s travel-local failover/wake
transition, and replays queued travel work when a healthy hub recovers. The
POST boundary may be slow without delaying connection state, and it must not
probe executors, resolve installed version metadata, or construct the broader
diagnostics payload.

The framework-free travel reconcile requester owns an independent outage
cadence. When an accepted hub snapshot reports `availability: "unreachable"`,
Workspace flips the requester into outage mode, which immediately POSTs once
and then re-arms a one-shot ten-second timer until a structurally definite
non-outage answer clears the cadence. Definite reachable hub answers clear and
trigger one recovery/replay pass, definite local or unconfigured-hub answers
clear without triggering, and unknown payloads stay inert so fallback
`status-unavailable` polls do not erase an active outage window. This keeps
recovery/replay checks within the travel-local threshold even while the
connection supervisor backs off.

The travel helper executes behind a per-target serial boundary keyed by the
sanitized target identity. Equivalent concurrent calls share one in-flight
reconcile; non-equivalent calls serialize and reload current state before
acting. Wake state is stamped only after a successful local daemon start, so a
failed or thrown start remains retryable on the next heartbeat.

### 2. Bounded server probe broker

Connection snapshots share one in-flight probe per resolved target. A short,
bounded TTL allows near-simultaneous consumers to reuse the latest result.
Cache entries are keyed by target identity so local/hub configuration changes
cannot reuse a result for the wrong destination.

Background heartbeat probes do not perform the generic GET transport retry:
the next supervised poll is already the retry, and doubling a failed health
request is what lets one poll exceed the interval. The connection snapshot and
the detailed `/api/daemon/status` route share the exact same 1500ms no-retry
health probe contract so Workspace and Settings classify the same answered-slow
hub deterministically. Explicit trusted refreshes after Start bypass stale
cache and request a fresh probe.

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
workspace, version, and daemon details. Those reads are surface-scoped,
abortable, and user-refreshable. The detailed status route and the dedicated
travel POST route share the same serial travel reconciler; the recurring shell
heartbeat never constructs or pays for the broader diagnostics payload.

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
- The travel reconcile POST route returns an explicit generic non-2xx error
  when focused wake/replay work fails, without leaking daemon paths, stacks, or
  raw start diagnostics.
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
- The read-only connection route performs no travel imports, executor/version
  work, or unrelated detailed diagnostics; focused travel transition/replay
  semantics live behind the separate serial POST reconciler shared with the
  status route.
- Explicit Start/Retry observes a fresh result.
- All changed request producers have tested lifecycle/backpressure behavior.
- One scoped PR merges to `main`, the Bead records verification evidence, and
  the branch/worktree is cleaned after `pnpm beads:worktrees`.
