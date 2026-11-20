# Native transport command ownership implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Checkbox state is not evidence of completion; current source, verification receipts and merged PRs are authoritative.

**Goal:** Repair native harness deadlines and cleanup while advancing every original #6195 termination/result criterion.

**Architecture:** A finite POSIX anchor owns the command group across root exit. A Node adapter retains logs, deadline/cancellation outcomes and receipts; the transport harness uses it before fixture teardown.

**Tech Stack:** Node 24, Python 3 standard library, POSIX process groups, XCTest/Xcode and existing Cave fixtures.

**Spec:** `docs/superpowers/specs/2026-11-17-native-harness-ownership-design.md`.

## Global constraints

- Preserve the 600000 ms default command deadline and full 5000 ms graceful-shutdown allowance; explicit caller deadlines retain their values. Bound the formerly unbounded terminal observation to 1000 ms after that allowance, without admitting additional successful command work.
- Never signal an arbitrary or stale PID/group; the anchor controls only its own currently held private group.
- Timeout, cancellation, output/acknowledgement loss and incomplete cleanup cannot report success.
- Preserve diagnostics, first failures, original historical-cause limitations and all foreign/user state.
- Authority ends at signed scoped feature publication and draft PR; the worktree is intentionally retained for review.

## Review focus

- Root exit before descendant output closes must still honor the deadline and clean up the owned group.
- A cancelled or timed-out zero exit must remain a failure.
- Lost anchors or escaped output must fail within bounds without signaling unrelated identities.
- Log/receipt failures must not orphan owned work or produce success.
- Simulator/unit success must not substitute for complete harness/result/cleanup or historical causation.

### Task 1: Finite owned command runner

**Files:** Create `scripts/native-harness-command.py`, `scripts/native-harness-command.mjs` and `scripts/native-harness-command.test.mjs`.

**Interface:** `runNativeCommand({ command, args, cwd, env, logPath, receiptPath, timeoutMs = 600000, signal, onLine })` resolves a successful structured receipt or rejects an error carrying `receipt`; only fully drained zero-exit owned work succeeds.

- [ ] Write a formal behavioral regression using the unchanged production run function and a real leased descendant retaining stdout; require deadline failure instead of eventual success.
- [ ] Run it and retain the expected RED with exact source/test hashes and all leased processes gone.
- [ ] Implement the private-session anchor and Node adapter, preserving the fixed execution/force bounds and complete logs.
- [ ] Cover success/failure, retained-pipe root exit, cancellation, ignored TERM, invalid anchor, identity loss, unrelated process preservation and output/log failure with real processes and explicit absence checks.
- [ ] Run the complete focused runner and existing teardown/process ownership tests; retain first failures and fresh GREEN evidence.

### Task 2: Harness integration and qualification

**Files:** Modify `scripts/runtime-activity-native-transport.mjs`, `scripts/run-tests.mjs`, `scripts/ci-paths.mjs` and `scripts/ci-paths.test.mjs`; extend runner tests at the actual caller boundary.

- [ ] Route every finite harness command through the adapter, preserving labels, stage parsing and exact timeout values. Route SIGINT/SIGTERM through the command AbortController before fixture cleanup.
- [ ] Prove cancellation and outcome propagation at the real caller boundary, require owner-only JS/Python/test paths to select native and frontend validation, then run focused/native lane, app tests, wiring, lint and type checks appropriate to changed scripts.
- [ ] Restore locked dependencies, produce an exact current production build and create one owned simulator. Use scratch COVEN_HOME/COVEN_CAVE_HOME with unchanged HOME.
- [ ] Run one bounded full native unit transport qualification; observe its same live handle and retain exact source/toolchain/runtime, result bundle, actual test counts and cleanup.
- [ ] If historical teardown stalls recur, capture the exact live command/diagnostic boundary within existing bounds and investigate that evidence. Preserve missing historical samples and never claim causation from a different successful run.

### Task 3: Review and scoped delivery

- [ ] Audit every objective/spec requirement against current evidence and preserve any incomplete native/historical gate.
- [ ] Obtain a fresh whole-branch review as required by executing-plans; fix important findings with regression evidence and rerun affected checks.
- [ ] Create normal hooked signed scoped commits with Coven provenance, verify signatures and exact heads, then publish feature branch and draft PR only if gates pass.
- [ ] Read back serialized one-line prose issue/PR payloads, retain the worktree with owner/reason, and write the morning handoff with exact first failures, evidence and one imperative next step.
