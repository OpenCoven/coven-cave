# Stream Performance Gate Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the existing 200 ms p95 ceiling for a complete 10,000-event production Chat stream.

**Architecture:** Reuse the existing Chat context fixture and Playwright production server. A fixed workload and pure verdict helper validate every trial; a browser spec measures 100 fresh contexts per delivery pattern. The existing performance workflow runs the gate, and the catalogue delegates to it without duplicating the threshold.

**Tech Stack:** Existing Node 24, TypeScript, Playwright/Chromium, Next production build and Node test runner. No new dependencies.

**Spec:** [Issue #6137](https://github.com/OpenCoven/coven-cave/issues/6137), under the authorized [#6119 goal](https://github.com/OpenCoven/coven-cave/issues/6119). The abandoned Chat phase-6 plan is historical evidence, not this plan's authority.

## Global Constraints

- Keep `stream.10k-event.input-blocking-p95-ms` at 200 ms.
- Pin 10,000 SSE records, 9,998 text chunks, 89,294 text bytes, 618,430 SSE bytes and 1,000 history turns. Text tokens carry ordered unique indices.
- Measure burst and paced delivery independently; paced batches contain 100 records with a 10 ms scheduled delay.
- Use 100 fresh browser contexts per pattern, one worker, no retries, and 1440×900 viewport.
- Missing, invalid, incomplete or unsupported evidence fails. Preserve failed samples.
- Use synthetic data, block external browser requests and live mutations, and isolate server homes/configuration. Never exercise a real provider or profile.
- Record head, dirty state, build identity, browser/runtime/OS, workload and raw measurements. A dirty local run is not exact-commit evidence.
- Keep five-sample list benchmarks and their median rule unchanged.
- Routine implementation and protected delivery are already authorized by #6119. No release, access expansion or deletion is included.

## Review Focus

- An observer task starts before stream release: include it when its end overlaps the window.
- Missing/truncated text or duplicate sends: fail completeness even if timing is fast.
- Unsupported observer or missing trials: report unmeasured and fail, never substitute zero.
- One slow delivery pattern: grade it separately; a faster pattern cannot hide it.
- Ambient credentials or occupied server port: use an allowlisted launcher environment and owned server; never attach to a foreign process.

### Task 1: Fixed workload and fail-closed verdict

**Files:** Create `tests/fixtures/chat-stream-performance.ts` and `scripts/chat-stream-performance.test.mjs`; modify `scripts/run-tests.mjs`.

**Interfaces:**

- `STREAM_PERFORMANCE_PROFILE`: frozen workload/viewport/trial/delivery constants, excluding the budget threshold.
- `createStreamWorkload()`: returns numbered SSE frames, expected text and independently checkable counts/byte sizes.
- `evaluateStreamPerformance(pattern, samples)`: returns `pass`, `p95Ms`, `maximumMs`, and bounded failure reasons. Each sample includes index, completion, observer support, one-send/full-text/draft evidence and longest overlapping task.
- `overlappingLongTasks(entries, start, end)`: includes tasks overlapping either edge of the measurement window.
- Threshold lookup reads the existing catalogue entry. Nearest-rank p95 is sorted index `ceil(0.95 * n) - 1`, with exactly 100 valid unique trial indices required.

- [ ] Add tests pinning workload bytes/counts and indexed text; 100 valid samples at 200 ms pass, six 201 ms samples breach, and each invalid/missing/duplicate/non-finite sample or failed semantic assertion fails.
- [ ] Add tests proving overlap-at-start inclusion, out-of-window exclusion, and separate pattern verdicts.
- [ ] Run `node --experimental-strip-types --test scripts/chat-stream-performance.test.mjs`; confirm failures name missing behavior.
- [ ] Implement the smallest pure helpers, wire the test exactly once, and run the helper and existing budget suites plus `pnpm check:tests-wired`.
- [ ] Commit and push the scoped, verified helper change.

### Task 2: Production browser gate and automation

**Files:** Create `tests/chat-context-fixture.ts`, `tests/chat-stream-performance.spec.ts`, and `scripts/run-stream-performance.mjs`; modify `tests/chat-context-performance.spec.ts`, `playwright.config.ts`, `package.json`, `.github/workflows/cave-performance.yml`, `src/lib/performance-budgets.ts`, its test, and `docs/performance-budgets.md`.

**Interfaces:**

- Extract the existing context setup, thread/project navigation and shared synthetic data without behavior changes; both specs import it.
- `pnpm performance:stream` launches only the new spec through the existing production server/config, one worker and zero retries. Preserve per-invocation report artifacts. `--control` injects a 260 ms stall in six of the 100 trials per pattern and must exit unsuccessfully.
- The launcher passes an allowlisted environment to Playwright. Its existing browser cache may remain accessible; server/build HOME, Coven/Cave homes, vault, env file, socket and mutable stores point to owned synthetic paths. Do not inherit provider credentials.
- The browser intercepts only the send response with a synthetic ReadableStream, then drives the real parser/coalescer/renderer. Other API traffic uses the shared fixture. External requests and live mutations are refused.
- Add a `browser-performance` catalogue gate delegated to this spec. The list report reports delegation; it never fabricates a stream metric or applies its five-sample rule to this gate.

- [ ] Add failing catalogue/report delegation and launcher isolation/argument tests to the existing helper test or budget suite; pin the single 200 ms source.
- [ ] Extract the context fixture, implement the bounded launcher/config mode and browser spec. On failed completeness, preserve the failed sample and fail the run; do not retry it to obtain a passing distribution.
- [ ] Measure overlapping Long Tasks from release through rendered terminal response; flush observer records, verify observer support, ordered complete text, one send, completion and retained draft. Report zero as “no task at least 50 ms observed,” not zero execution time. Input paint proxies are supplementary, not INP.
- [ ] Attach every raw sample and both pattern verdicts. Write reports in `finally` and let Playwright own browser/server cleanup. Refuse a reused/foreign server.
- [ ] Run the helper/budget suites, the unchanged context spec, full typecheck/lint and wiring; run the production gate and the positive control. Verify the normal run passes and control fails specifically on the 200 ms budget with complete samples.
- [ ] Add a job to the existing performance workflow using the launcher, current pinned setup/upload actions and always-uploaded reports. Verify the same head on hosted Linux, including control evidence, without replacing required PR checks.
- [ ] Document workload, percentile, observer resolution, isolation, report paths and limits. Commit and push; obtain independent exact-diff review and required current-head checks, then protected squash merge.

## Verification and disposition

The plan delivers a web performance gate, not daemon/native or all-room acceptance. Preserve the issue-owned worktree with its owner/reason after delivery unless separately authorized retirement evidence exists. Record failures, exact heads, commands, hosted receipts and remaining limitations on #6137/#6119.
