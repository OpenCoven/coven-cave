# Deterministic Cave-Home Reclaim Conformance Design

## Goal

Make GitHub issue #3940's released-owner reclaim retry scenario independent
of Windows runner scheduling while preserving the production reconciliation
lock contract byte-for-byte.

The test must prove that persistent Windows `EPERM` fencing failures retry
until the configured protocol deadline, time out with `ETIMEDOUT`, and leave
the owned lock directory intact.

## Confirmed Root Cause

The failure is test-clock nondeterminism, not a production lock regression.

- Windows job `89831971694` ran the reclaim timeout path for roughly 330 ms,
  completed only one fence attempt, and failed `reclaimAttempts >= 2`.
- Windows job `89830933193` ran the byte-identical tree, completed the same
  path in roughly 186 ms, and passed.
- Commit `52468bb16` made the adjacent candidate-publication scenario use the
  existing injected `lockNow` clock, but reset the reclaim scenario to a
  150 ms wall-clock timeout without giving it the same deterministic clock.
- Production `acquireLock()` already uses `options.lockNow ?? Date.now`, so no
  runtime seam or behavior change is required.

## Chosen Approach

Use injected monotonic protocol time in every persistent-`EPERM` retry-count
test.

- Give candidate publication and released-lock fencing a local clock starting
  at zero.
- Advance that clock by a fixed amount inside the injected failing rename.
- Pass the clock through the existing `lockNow` option.
- Use a fixed protocol deadline and assert the exact number of attempts needed
  to reach it.
- Apply the same deterministic pattern to the cross-platform takeover suite,
  which currently carries equivalent 150 ms wall-clock retry assertions.

This keeps the filesystem and retry loop real while replacing only the
unstable deadline source.

Rejected alternatives:

- Increasing the wall-clock timeout would make CI slower without making the
  retry-count assertion deterministic.
- Weakening or removing the retry assertion would stop testing the behavior
  that prevented one-shot Windows failures.
- Injecting a scheduler or changing production backoff would expand the
  runtime surface without addressing a production defect.

## Test Contract

For a 500 ms protocol deadline and a 100 ms advancement per injected rename
failure:

1. Five candidate or fence rename attempts occur.
2. The next acquisition-loop deadline check throws `ETIMEDOUT`.
3. Candidate publication reuses one candidate directory and cleans it up.
4. Failed released-lock fencing leaves the lock directory and owner token
   unchanged.
5. Real runner latency cannot change the attempt count because `Date.now()` is
   not consulted by these scenarios.

The active-owner timeout scenario remains wall-clock based. It intentionally
tests elapsed waiting behavior rather than a retry count and is outside issue
#3940.

## Verification

- Preserve the live failing Windows job as the RED evidence.
- Run the focused takeover suite repeatedly, sequentially and concurrently.
- Run the complete conformance suite locally, acknowledging that the
  Windows-only test skips on macOS.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm check:tests-wired`,
  `pnpm test:app`, `pnpm test:conformance`, `pnpm build`, and
  `git diff --check`.
- Push a PR and require successful Ubuntu and Windows conformance legs.
- Prove two complete conformance matrix executions on the final PR head: the
  initial pull-request run plus one full workflow rerun. Both Ubuntu and
  Windows legs and the required aggregate must pass in both attempts.
- Confirm the production reconciliation files have no diff.

## Completion Criteria

- No persistent-`EPERM` retry-count scenario depends on a real 150 ms window.
- Production lock timeouts, backoff, reclaim rules, and diagnostics are
  unchanged.
- Focused repetition and required cross-environment CI are green on Ubuntu and
  Windows.
- The PR is merged, issue #3940 is closed with evidence, and Bead
  `cave-vjowd` records the final verification.
