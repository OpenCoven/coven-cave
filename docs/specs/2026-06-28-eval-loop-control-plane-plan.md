# Eval Loop Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daemon-owned eval-loop lock recovery API and a dedicated Cave Eval Loops surface that can run and unblock familiar eval loops safely.

**Architecture:** Coven owns eval-loop filesystem state and exposes lock metadata plus a constrained clear-lock endpoint. Cave proxies that endpoint and promotes the existing hidden Retro Runs mode into an operational Eval Loops space with run and recovery controls.

**Tech Stack:** Rust daemon/API in `OpenCoven/coven`, Next.js/React/Tauri Cave UI in `OpenCoven/coven-cave`, filesystem-backed eval-loop state, existing source-level tests.

---

### Task 1: Daemon Lock Metadata

**Files:**
- Modify: `OpenCoven/coven/crates/coven-cli/src/eval_loop.rs`

- [ ] Add failing tests for lock metadata:
  - `get_eval_loop_state_reports_lock_metadata`
  - `get_eval_loop_state_marks_old_lock_stale`
- [ ] Run `cargo test -p coven-cli get_eval_loop_state_reports_lock_metadata get_eval_loop_state_marks_old_lock_stale` and confirm both fail because the DTO has no lock metadata.
- [ ] Add `EvalLoopLockDto` and include `lock: EvalLoopLockDto` on `EvalLoopStateDto`.
- [ ] Implement metadata from `eval-loop/run.lock` and `eval-loop/run.json`.
- [ ] Mark locks stale when modified more than one hour ago.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Daemon Clear-Lock API

**Files:**
- Modify: `OpenCoven/coven/crates/coven-cli/src/eval_loop.rs`
- Modify: `OpenCoven/coven/crates/coven-cli/src/api.rs`

- [ ] Add failing eval-loop tests:
  - `clear_eval_loop_lock_removes_stale_lock`
  - `clear_eval_loop_lock_requires_force_for_fresh_lock`
  - `clear_eval_loop_lock_returns_false_when_missing`
- [ ] Run the focused tests and confirm they fail because `clear_eval_loop_lock` does not exist.
- [ ] Implement `clear_eval_loop_lock(coven_home, familiar_id, force)`.
- [ ] Add API route `DELETE /skills/eval-loop/:familiarId/run-lock`.
- [ ] Add API route tests for success and fresh-lock conflict.
- [ ] Run `cargo test -p coven-cli eval_loop` and relevant API tests.

### Task 3: Cave Proxy Route

**Files:**
- Create: `OpenCoven/coven-cave/src/app/api/skills/eval-loop/[familiarId]/run-lock/route.ts`
- Modify: `OpenCoven/coven-cave/src/app/api/api-contracts.test.ts`
- Modify: `OpenCoven/coven-cave/src/components/eval-loop-panel.test.ts`

- [ ] Add failing API contract assertion for `DELETE /skills/eval-loop/[familiarId]/run-lock`.
- [ ] Add failing source assertion that the proxy calls `/api/v1/skills/eval-loop/${familiarId}/run-lock`.
- [ ] Implement the DELETE proxy route with `{ force?: boolean }` body parsing and redacted errors.
- [ ] Run the focused tests and confirm they pass.

### Task 4: EvalLoopPanel Recovery Controls

**Files:**
- Modify: `OpenCoven/coven-cave/src/components/eval-loop-panel.tsx`
- Modify: `OpenCoven/coven-cave/src/components/eval-loop-panel.test.ts`

- [ ] Add failing source/component assertions for lock status and a keyboard-accessible "Clear eval-loop lock" button.
- [ ] Extend `EvalLoopState` with optional `lock` metadata.
- [ ] Add clear-lock handler that calls the new Cave route, clears errors on success, and refreshes state.
- [ ] Show locked/stale/run-json metadata when present.
- [ ] Run focused tests.

### Task 5: Dedicated Cave Surface

**Files:**
- Modify: `OpenCoven/coven-cave/src/components/retro-runs-view.tsx`
- Modify: `OpenCoven/coven-cave/src/components/retro-runs-view.test.ts`
- Modify: `OpenCoven/coven-cave/src/components/sidebar-minimal.tsx`
- Modify: `OpenCoven/coven-cave/src/components/settings-shell.tsx`
- Modify: `OpenCoven/coven-cave/src/lib/slash-commands.ts`
- Modify: `OpenCoven/coven-cave/src/components/workspace.tsx`

- [ ] Add failing tests that the surface is named `Eval Loops`, is exposed as an optional sidebar add-on, and slash command `/evals` opens it.
- [ ] Rename visible surface copy from Retro Runs to Eval Loops while keeping internal `retro` mode if that minimizes churn.
- [ ] Add `retro`/`evals` to add-on settings and sidebar gating.
- [ ] Update workspace title to `Eval Loops`.
- [ ] Run focused tests.

### Task 6: Verification And PR Readiness

**Files:**
- Both repos.

- [ ] Run Coven focused tests: `cargo test -p coven-cli eval_loop`.
- [ ] Run Cave focused tests for eval loop and retro surface.
- [ ] Run formatting/type checks that match touched areas.
- [ ] Review diffs for no unrelated primary-checkout changes.
- [ ] Ask Val before pushing or opening PRs.

