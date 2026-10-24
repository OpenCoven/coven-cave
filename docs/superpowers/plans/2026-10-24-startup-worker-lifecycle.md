# Startup-worker lifecycle implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution, with failing-first tests and one independent whole-branch review. Checkboxes are not completion evidence; use the canonical issue checkpoints and actual results.

**Goal:** Stop and drain scheduled-chat and backup-sync workers safely, remove disabled backup tick work, and prove the production lifetime and idle behavior.

**Architecture:** Keep each worker's process-global owner and existing execution/persistence authority. Add explicit stop/drain operations and configuration fencing; the custom server coordinates shutdown through a small global bridge because its module graph is separate from Next's. One shared shutdown deadline preserves the existing three-second quit budget inside the native five-second stop window; deadline expiry reports incomplete drain without cancelling or replaying effects.

**Tech stack:** TypeScript, existing Node timers and promises, Vitest fake clocks, real filesystem regression tests, the custom Node server, and isolated production measurements.

**Spec:** [#6209](https://github.com/OpenCoven/coven-cave/issues/6209), implementing the maintainer's attached [#6119](https://github.com/OpenCoven/coven-cave/issues/6119) goal after [#6174](https://github.com/OpenCoven/coven-cave/pull/6174) merged.

## Global constraints

- Keep scheduled-chat's 15-second cadence, backup's 15-minute eligibility cadence, the existing backup configuration interval, and supported boot catch-up.
- Do not cancel or replay admitted sends, archives or writes. Preserve uncertain execution and durable claim semantics.
- Missing backup state still defaults; malformed, unreadable and newer state remains byte-identical and cannot change credentials or start archive/prune work.
- Keep manual/scheduled/quit single-flight behavior, encryption, retention and destination policy. A drain result is not execution success.
- Do not add a framework, dependency, authority store, cross-process ownership redesign or unrelated worker changes.
- Use synthetic homes, data, sockets and owned processes only. Preserve failed samples and old worktrees; no release, deployment or deletion.

## Review focus

1. Stop racing a startup read or configuration update must prevent a stale completion from restoring its timer.
2. A start during drain must not overlap the previous owner; repeated start/stop/restart must keep one owner.
3. A hung admitted operation must yield an explicit deadline result while its reference is retained and it is never replayed.
4. The custom HTTP server must not exit before the quit push/drain merely because its HTTP listener has closed; non-custom production launch paths must retain their existing quit behavior.
5. Rejected configuration, failed persistence and failed stop operations must remain explicit and must not silently disable a previously valid configuration or report successful drain.

### Task 1: Own the scheduled-chat worker

**Files:** `src/lib/server/scheduled-chat-scheduler.ts`; new `src/lib/server/scheduled-chat-scheduler.behavior.test.ts`; `scripts/run-tests.mjs`.

**Interfaces:** Preserve `scheduledChatStore()` and ordinary send admission. Keep `startScheduledChatScheduler()` callable without arguments, with a returned promise if startup must wait for a prior drain. Add `stopScheduledChatScheduler(): Promise<void>`; it stops future timer passes synchronously and resolves only when admitted work settles. A caller's observation deadline must not clear an unfinished owner.

- [ ] Add behavioral cases for one timer across repeated starts, no overlapping slow tick passes, stop clearing the timer before waiting, admitted dispatch settling after stop, restart waiting for drain, stop racing restart, and the production-build guard. Run them against unchanged code and retain the failures.
- [ ] Implement one process-global owner with its timer, pending pass and fenced lifecycle transition. Preserve the existing durable store, current per-session claim rules and error reporting; do not turn shutdown into a new send/retry path.
- [ ] Run the new cases plus existing scheduled-chat store, dispatch and route tests. Confirm no timer survives teardown and no admitted work was cancelled or repeated.

### Task 2: Own backup configuration and shutdown

**Files:** `src/lib/server/backup-sync.ts`; new `src/lib/server/backup-sync-scheduler.behavior.test.ts`; existing `src/lib/server/backup-sync.test.ts`; `scripts/run-tests.mjs`.

**Interfaces:** Preserve configuration, overview and manual-run APIs. Keep `startBackupSyncScheduler()` callable without arguments. Add `stopBackupSyncScheduler(options?: { pushOnQuit?: boolean }): Promise<void>`. Configuration updates reconfigure only an already-started scheduler; they do not unexpectedly start workers in tests or maintenance callers.

- [ ] Add failing cases for no recurring timer or tick work when missing/disabled, one timer after enablement, timer removal on disablement, start/stop/restart, stale configuration reads, slow eligibility checks, admitted archive drain, and quit joining an existing run rather than writing a duplicate archive.
- [ ] Track the timer and pending eligibility/archive work in the existing process-global owner. Fence stale reads and clear admission before drain. Keep rejected state and credentials unchanged. Preserve boot catch-up when enabled, while configuring a stopped worker remains a data-only operation.
- [ ] Run the behavioral tests and real filesystem/API preservation, retention, encryption and single-flight tests, including all existing #6172 refusal cases.

### Task 3: Reconcile the actual shutdown owner

**Files:** New `src/lib/server/startup-worker-shutdown.ts` and its behavioral tests; `src/instrumentation.ts`; `src/instrumentation.behavior.test.ts`; `server.ts`; relevant existing server/bundle tests.

**Interfaces:** Register callbacks from the actual Next worker module instances through the same process-global bridge pattern already used by event publication. The custom server marks itself as the shutdown coordinator before `app.prepare()`, then owns the signal-to-HTTP-close-and-worker-drain decision. Outcomes distinguish drained, failed, unavailable and pending workers. The observer uses the existing three-second quit budget and never aborts worker promises.

- [ ] Write failing tests for separate module instances sharing the bridge, idempotent shutdown, concurrent HTTP close and drain, a slow quit push outliving HTTP close, deadline expiry, rejected stop callbacks, and initialization/shutdown races. Verify the native five-second boundary from source and retain failures.
- [ ] Register worker callbacks before starting their owners, and connect the custom server's signal path to them. Remove competing backup signal ownership only when the custom coordinator is present; preserve existing non-custom production quit behavior. Do not bundle the chat route graph into the custom server just to import a stop function.
- [ ] Run instrumentation and server tests, typecheck, lint and test wiring. Inspect the actual built custom-server shutdown path; unused exports alone do not satisfy this task.

### Task 4: Measure and deliver

**Files:** `docs/core-contract-and-room-boundaries.md`; a bounded evidence directory linked from #6209; owning tests/scripts only where reusable measurement support is necessary.

- [ ] Record before/after production source and build IDs, OS/hardware, workload, sampling interval/count and startup/idle timer, request, CPU and memory evidence. Include disabled and enabled backup, repeated start/stop, admitted work and a deliberately delayed shutdown. Use retained synthetic markers and independently verify owned process/port/socket cleanup.
- [ ] Update the two lifetime rows and maintenance/rollback guidance, keeping unverified native/device behavior explicit. Record the all-optional-rooms-absent baseline as the next separate outcome rather than claiming it from room visibility flags.
- [ ] Run scoped tests, `pnpm typecheck`, `pnpm lint`, `pnpm check:tests-wired`, `pnpm test:app`, `pnpm test:api`, `node scripts/docs-index.test.mjs` and a normal `pnpm build`. Preserve each first failure and distinguish focused corrections from full-suite results.
- [ ] Commit/push explicit paths with hooks, obtain one read-only whole-branch review, fix substantive findings with failing-first tests, and require complete exact-head hosted checks before the authorized protected squash merge. Record exact merge evidence and intentionally retained unit disposition. Keep #6119 open.
