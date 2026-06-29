# Evals — Analysis-Grade Upgrade Design

**Date:** 2026-06-28
**Surface:** `evals` workspace mode (`src/components/evals/evals-view.tsx`)
**Goal:** Take the already-unified Evals control room to *full coverage* — surface the eval data that exists in the model/API but isn't shown today, and make it a world-class analysis surface. Additive, not a rewrite.

## Context

The current 5-tab Evals view (Overview / Suites / Runs / Loops / Threads) is the implemented output of `2026-06-28-unified-evals-analysis-design.md`. Eval work is **concurrently in flight** (open PR #2049 eval templates; today's `eval-loop-control-plane` and `grouped-eval-stale-state` specs). Therefore this upgrade is deliberately **additive** — new panels + a pure analytics lib — and leaves existing tab internals alone to avoid collisions.

Coverage gaps this design closes (all four chosen):
1. **Trends over time** — pass-rate / accept-revert history, not just the latest run.
2. **Run-vs-run comparison** — case-level diffs and regressions.
3. **Failure clustering & filtering** — which cases/graders fail most; filter to failures.
4. **EvalGroups UI + SLA** — `EvalGroup` exists in the model + `/api/evals/groups`, but has no UI; add management + pass-rate thresholds with breach alerts.

## Prerequisite: shared chart primitives (lands first, PR 1)

World-class viz needs more than the single `Sparkline`. We add **visx** (modular, tree-shakeable) — chosen over Recharts so each surface's lazy chunk ships only the chart code it uses (the build is gated by `bundle-budget.mjs`).

- New `src/components/ui/charts/`: `TrendChart` (multi-series line/area + threshold marker), `BarChart`, `Heatmap`, `DonutChart`. Thin wrappers themed to our CSS tokens; each independently testable.
- **Imported only inside lazy chunks** (Evals + Dashboard are already route/lazy-split) so the main bundle stays lean. Bump the relevant per-chunk budget in `bundle-budget.mjs` if the gate trips, and `log` the change.
- `Sparkline` stays for tiny inline tiles.

## Data model

**New pure `src/lib/evals/eval-analytics.ts`** — derives everything from existing DTOs; **no new persistence**:

- `suiteTrend(runs: EvalRun[])` → time series of pass rate per suite, with a per-grader-kind breakdown.
- `loopTrend(loopRuns)` → accept/revert counts over time, per track.
- `diffRuns(a: EvalRun, b: EvalRun)` → per-case status matrix: `pass→pass`, `pass→fail` (regression), `fail→pass` (fix), `fail→fail`, plus added/removed cases.
- `failureClusters(runs: EvalRun[])` → per-case and per-grader failure frequency + flakiness (alternating pass/fail across runs).
- `groupHealth(groups, runs, threadStates)` → per-group rollups + **SLA breach** (latest pass rate below the group's threshold).

The only schema change: add an optional `slaPolicy?: { minPassRate: number }` to `EvalGroup` (`eval-model.ts`) and persist it through the existing `/api/evals/groups` POST. No new route.

## Page structure (additive)

`EvalsView` gains two tabs and one enhancement; existing tabs untouched:

- **New "Insights" tab** — the analytical home:
  - Suite pass-rate `TrendChart` (per suite; threshold marker when an SLA is set).
  - Loop accept/revert `TrendChart` per track.
  - Failure-frequency `BarChart` + flaky-case list (from `failureClusters`).
  - A coverage badge: suites/threads covered, SLA status roll-up.
- **Runs tab → "Compare" mode** — pick run A and run B → `diffRuns` matrix with **regressions highlighted**; plus results filtering (failures-only / by grader kind / text search). The existing run history/detail stays.
- **New "Groups" tab** — EvalGroups CRUD (create/edit/delete, member selection), per-group health (`groupHealth`) with a `Heatmap` or status list, and **SLA threshold config with breach badges**.

## Data flow

All from existing endpoints, loaded as today: `/api/evals/{suites,runs,groups,thread-states,queue}`, `/api/retro-runs`, `/api/skills/eval-loop/:familiarId`. Analytics rollups are derived client-side (pure lib). Group SLA writes go through the existing groups POST.

Remember the daemon envelope gotcha: run eval-loop daemon responses through `unwrapDaemonEvalState` (`src/lib/eval-loop-daemon.ts`) before reading iteration/state fields.

## Error handling

- Charts render an empty/`EmptyState` when a series has < 2 points (no misleading single-point lines).
- `diffRuns` handles non-overlapping case sets (added/removed) without throwing.
- SLA breach is informational (a badge), never blocks running an eval.

## Testing

- `src/lib/evals/eval-analytics.test.ts` — `diffRuns` (regression/fix/added/removed), `suiteTrend`/`loopTrend` shapes, `failureClusters` (frequency + flakiness), `groupHealth` SLA breach thresholds. Pure, no DOM.
- Chart-primitive source tests (axis/series/threshold props wired; themed classes present).
- Additive assertions in `src/components/evals/evals-view.test.ts`: Insights tab renders the trend/bar charts; Runs Compare mode + filters present; Groups tab CRUD + SLA wired.
- Wire all new test files into `scripts/run-tests.mjs` (and `ALIAS_LOADER` if they import via `@/`).
- Run typecheck, `check:tests-wired`, and the app suite before committing.

## Scope guards / collision management

- **Additive only.** Do not rewrite the existing tab internals — coordinate with the live eval PRs (#2049 templates is a creation flow; this is analysis — non-overlapping).
- One small additive field on `EvalGroup` + the groups POST; no new persistence layer, no new routes.
- visx imported only inside the Evals lazy chunk; main bundle unaffected.
- Lands via a PR on a branch (main is protected; required checks: Frontend build, Rust check, CodeQL, E2E).

## Out of scope

- CI/CD auto-running evals on `git push` / PR.
- LLM-judge calibration tooling.
- Audit trail of suite edits.
- Cross-run statistical significance testing.

## Sequencing

PR 1 (charts foundation, shared with Dashboard) → PR 2 (this Evals upgrade).
