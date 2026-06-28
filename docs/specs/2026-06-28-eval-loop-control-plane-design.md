# Eval Loop Control Plane Design

## Goal

Let familiars run and recover their own eval-loop iterations from a sanctioned control plane, either from Cave's dedicated UI or through daemon APIs, without requiring a human or agent to delete files inside a familiar workspace by hand.

## Current State

- Coven daemon already exposes eval-loop state and run enqueue endpoints.
- Eval-loop enqueue writes `eval-loop/run.json` and `eval-loop/run.lock` in the familiar workspace.
- A stale `run.lock` blocks new runs with `409 run_in_progress`.
- Cave already proxies state and run requests, has an `EvalLoopPanel`, and has a hidden `Retro Runs` workspace mode.
- Cave should not directly delete arbitrary files inside familiar workspaces.

## Architecture

The Coven daemon remains the only layer allowed to inspect or clear eval-loop lock files. Cave calls daemon-owned endpoints and renders the result in a dedicated workspace surface.

Daemon additions:

- Add `EvalLoopLockDto` to the eval-loop state, including `locked`, `run_id`, `run_json_exists`, `lock_updated_at`, and `stale`.
- Add `clear_eval_loop_lock(coven_home, familiar_id, force)` that removes only the resolved familiar's `eval-loop/run.lock`.
- Add `DELETE /api/v1/skills/eval-loop/:familiarId/run-lock` with JSON body `{ "force": true }`.
- Reject clearing a non-stale lock unless `force` is true.

Cave additions:

- Add a Next API route `DELETE /api/skills/eval-loop/:familiarId/run-lock` that proxies to the daemon and redacts errors.
- Promote the hidden Retro Runs mode into an optional sidebar surface named `Eval Loops`.
- Rename the surface title from `Retro Runs` to `Eval Loops`, keeping the existing retro history list as the lower-level data model.
- Add per-familiar controls to run synthesis, prompt, or memory iterations and to clear a blocked/stale lock.

## UI Shape

The dedicated Cave surface should be an operational dashboard, not a marketing page:

- Header: "Eval Loops", refresh, export.
- Metrics: total runs, accepted, reverted, running/blocked familiars.
- Familiar panel: one row per familiar with active/running/blocked state.
- Detail panel: existing `EvalLoopPanel` for the selected familiar, including run buttons.
- Recovery affordance: if state reports a lock, show the run id, age, whether `run.json` exists, and a "Clear lock" button. The button calls the Cave proxy route and refreshes state.

## Safety

- Cave never constructs workspace filesystem paths for lock removal.
- Daemon resolves the familiar workspace from `familiars.toml` or the standard fallback.
- Daemon removes only `eval-loop/run.lock`, never `run.json` or result history.
- Non-stale locks require `force: true`; the UI labels that as an override.
- All daemon data returned to Cave stays redacted at the Next route boundary.

## Verification

Daemon:

- Unit test lock metadata in state.
- Unit test stale and non-stale lock clearing.
- API routing test for `DELETE /skills/eval-loop/:id/run-lock`.
- `cargo test -p coven-cli eval_loop`.

Cave:

- Route contract test for the new DELETE proxy.
- Component/source tests that the sidebar can expose Eval Loops and the surface renders `EvalLoopPanel`.
- Focused component tests for blocked lock affordance.
- `pnpm test:app -- eval-loop retro-runs` or the closest supported targeted runner.

