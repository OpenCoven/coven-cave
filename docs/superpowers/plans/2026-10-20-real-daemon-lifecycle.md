# Real daemon lifecycle implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this scoped delivery.
> Checkbox state is not evidence of completion; code, merged PRs, and issue #6120 are authoritative.

**Goal:** Produce actual isolated CLI lifecycle evidence for #6120, under #6119.

**Architecture:** An opt-in Node script invokes an explicit native binary in private synthetic homes. It uses the existing Cave health-contract validator and verifies the instance against the CLI's authenticated status. The existing deterministic benchmark remains a policy test; no new production service or dependency is introduced.

**Tech Stack:** Node 24 built-ins, existing TypeScript health validator, native Coven CLI.

**Spec:** https://github.com/OpenCoven/coven-cave/issues/6120

## Global constraints

- No real profile, inherited credentials, provider invocation, or remote target.
- macOS/Linux only initially; Windows and packaged/native recovery remain unverified.
- Preserve failed samples and cleanup failures. Five samples justify a median and range, not a p95/SLO claim.
- Keep existing budgets. Normal launch success alone does not prove readiness.
- No private payloads in reports; record binary digest/version and machine/commit provenance.

## Review focus

- A successful launcher with incompatible or wrong-instance health must fail.
- Missing executables and timeouts must produce a failed report and bounded cleanup.
- A process group can outlive its launcher; inspect the group after graceful stop.
- One failed sample cannot disappear from aggregate success.
- Child environment and working directory must not discover user configuration.

### Task 1: Isolated lifecycle probe and evidence

**Files:** Create `scripts/daemon-lifecycle-probe.mjs` and its `.test.mjs`; register the test in `scripts/run-tests.mjs`; add `bench:daemon-lifecycle` to `package.json`; update `docs/runtime-startup-supervision.md`; create `docs/performance/daemon-lifecycle.md`.

**Interfaces:** `validateReadyDaemon(status, health, home)` rejects anything except matching ready PID, socket, startup identity and supported contract. `runDaemonLifecycleProbe({ binary, samples })` returns a versioned report containing every sample and cleanup result. `runOwnedCommand(binary, args, options)` bounds execution/output and tracks owned groups. `cleanupOwnedGroups(groups, dependencies)` verifies group disappearance after TERM/KILL deadlines. Dependencies exist only to test cleanup refusal deterministically.

- [x] Write tests for incompatible/wrong-instance readiness, missing and hanging subprocesses, cleanup failure, and retained failed samples.
- [x] Run `node --experimental-strip-types --test scripts/daemon-lifecycle-probe.test.mjs`; observe the missing implementation failure.
- [x] Implement fresh start, already-running adoption, concurrent start, restart, marker preservation and shutdown per private sample. Use a minimal child environment, absolute native binary, short canonical temp roots, bounded HTTP response and command deadlines. Never kill by port or daemon-reported PID; cleanup only groups created by this process.
- [x] Run targeted tests and the probe with the installed native binary, five samples. Retain raw numeric evidence and limitations; fix harness defects rather than masking failed samples.
- [x] Correct stale startup API/version prose. Document invocation, evidence meaning and exclusions.
- [ ] Run test registration, lint/typecheck and relevant existing lifecycle contract tests. Review the diff independently, then commit/push/PR and merge only after exact-head checks pass.

## Execution rulings

The maintainer's goal authorizes routine implementation and protected delivery; no additional plan-approval round is required. GitHub #6120 is the durable progress record, consistent with the repository's sole-queue contract. This plan is a scoped implementation artifact, not a parallel task queue.

Independent review identified inherited pipes that could prevent timeout
settlement and missing interruption cleanup. Both subprocess regressions failed
on `ee8bc8058`, then passed after bounded pipe termination and cancellation were
added. Escaped-descendant reclamation remains explicitly outside this smoke
probe; it cannot prevent the probe from reporting a failed command.
