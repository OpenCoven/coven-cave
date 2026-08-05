# Supervisor-safe Daemon Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover a local daemon without competing with an existing supervisor and without transiently presenting successful recovery as daemon instability.

**Architecture:** Add a CLI lifecycle preflight to the server-side start boundary, keep the daemon serve lock authoritative, and return a structured deferred outcome when another live owner is unreachable. Thread automatic/manual intent through the start client and give Workspace a bounded recovery presentation state that suppresses transient banners but restores the existing actionable failure state after two confirmed offline polls.

**Tech Stack:** TypeScript, Node child processes, Next.js route handlers, React state, Node test runner.

---

### Task 1: Pin lifecycle-safe automatic start behavior

**Files:**
- Modify: `src/lib/daemon-start.test.ts`
- Modify: `src/lib/daemon-start.ts`

- [ ] Add failing tests that inject lifecycle results and assert `stale` and
  `unknown` automatic starts return `code: "owner_unreachable"` without calling
  `spawnImpl`.
- [ ] Run `node --experimental-strip-types src/lib/daemon-start.test.ts` and
  confirm both cases fail because the preflight contract does not exist.
- [ ] Add `automatic?: boolean` and an injectable lifecycle inspector to
  `startLocalDaemon`; normalize `coven daemon status --json` into running,
  stopped, stale, or unknown and fail closed only for automatic starts.
- [ ] Add a failing launcher-exit race test in which health becomes ready during
  the bounded grace, then extend readiness polling after runner exit without
  weakening timeout cleanup.
- [ ] Re-run the focused daemon-start test and confirm it passes.

### Task 2: Thread automatic intent and structured outcomes through the API

**Files:**
- Modify: `src/app/api/daemon/start/route.test.ts`
- Modify: `src/app/api/daemon/start/route.ts`
- Modify: `src/lib/daemon-desktop-auto-start.test.ts`
- Modify: `src/lib/daemon-desktop-auto-start.ts`

- [ ] Add failing route coverage proving `{ automatic: true }` reaches
  `startLocalDaemon({ automatic: true })` while an empty/manual body does not.
- [ ] Add failing client coverage proving automatic requests send the intent,
  distinguish a deferred `owner_unreachable` response from a hard failure, and
  preserve the unbound WebView fetch call.
- [ ] Run both focused tests and confirm the new assertions fail for missing
  request/outcome behavior.
- [ ] Implement a discriminated `started | deferred | failed` client outcome;
  preserve manual error reporting and suppress automatic deferred diagnostics.
- [ ] Re-run both focused tests and confirm they pass.

### Task 3: Make the shell quiet only during bounded recovery

**Files:**
- Modify: `src/components/workspace-daemon-connection.test.ts`
- Modify: `src/components/daemon-start-button.test.ts`
- Modify: `src/components/chat-surface.test.ts`
- Modify: `src/components/workspace.tsx`

- [ ] Add failing source-contract assertions for automatic start intent,
  `recovering`/`deferred` state, immediate clear on running, two-offline-poll
  exhaustion, and suppression of only `daemon-offline`/`daemon-start-error`.
- [ ] Run the three focused tests and confirm failure on the absent recovery
  state machine.
- [ ] Implement the smallest Workspace state/ref integration: automatic starts
  enter recovering, deferred outcomes receive two offline polls, running clears
  immediately, and manual starts retain immediate diagnostics.
- [ ] Re-run the focused tests and confirm all pass.

### Task 4: Verify the complete recovery contract

**Files:**
- Modify only if test wiring is missing: `scripts/run-tests.mjs`
- Update Bead evidence: `cave-9pqt9`

- [ ] Run `pnpm check:tests-wired` and confirm every modified/new test is wired.
- [ ] Run the focused daemon start, route, coordinator, and Workspace suites.
- [ ] Run `pnpm typecheck`, `pnpm lint`, and `git diff --check`.
- [ ] Start the native app with `bash scripts/dev-app.sh`, verify a healthy
  daemon produces no banner, and verify a simulated bounded automatic recovery
  does not disturb the live daemon or its SQLite state.
- [ ] Record branch, unmanaged-worktree retirement requirement, root-cause
  evidence, and verification output on `cave-9pqt9`. Do not commit or push
  without Val's explicit authorization.

