# Dashboard — World-Class Upgrade Design

**Date:** 2026-06-28
**Surface:** `/dashboard` route → `src/components/dashboard/dashboard-cockpit.tsx`
**Goal:** Make the cockpit a world-class, high-value page — **deepen insights + add interactivity/real-time + a visual pass**, on top of the already-solid cockpit (KPI sparklines, draggable grid, action-inbox, agents/GitHub/reading panels).

## Context

The `/dashboard` cockpit already went past its `2026-06-20-dashboard-refactor-design.md`. It's a standalone Next route (not a workspace mode); the Home composer (`mode: "home"`) is a separate surface and is out of scope. This upgrade is **layered on top** of the existing cockpit, reusing its model, layout persistence (`LAYOUT_KEY`), and `daily-report-ui` / `.dr-*` primitives.

Depends on the shared chart primitives (visx) from the Evals spec's PR 1.

## Data model

**New pure `src/lib/dashboard-analytics.ts`** (kept separate so `dashboard-model.ts` stays thin and its existing tests are untouched):

- `familiarMiniProfiles(sessions, retroRuns, selfReports)` → per-familiar: 7-day session trend, avg confidence, last-active, trend direction. Reuses the existing familiar-analytics/confidence computation rather than reinventing it.
- `resolutionTrend(inboxHistory)` → inbox pending→done rate over time; `boardThroughput(cards)` → cards moved per day.
- `signals(model, github, reading, familiars)` → predictive alerts: PR stalled > 7 days, reading queue growing, familiar trending downward.

Prefer reuse of already-fetched `/api/*` data and existing familiar-analytics computation. Flag any genuinely new read endpoint before adding it; aim for none.

## Page structure

The adaptive busy/caught-up layout and draggable grid are **kept**. Changes:

- **Deepen (charts):**
  - Familiar-load **stacked-area** `TrendChart` (sessions per familiar over 7d).
  - Confidence **`Heatmap`** (familiars × quality factors).
  - Board-status **`DonutChart`** (replaces/augments the CSS flexbox bars).
  - Richer KPI trend tiles (keep sparklines for the smallest).
- **Familiar mini-profiles:** expand the "Agents" panel — each familiar shows session trend, avg confidence, last update, and a link to its `/dashboard/familiars/[id]/analytics`.
- **Interactivity:** KPI tiles become **drill-downs** (click → board filtered by that status / the relevant surface); inline quick actions (assign a board card to a familiar; mark a reading item done) on top of the existing action-inbox bulk triage.
- **Real-time:** convert the request-time cockpit data to a client **polling layer** using the existing `usePausablePoll` pattern (paused when the tab/app is backgrounded, per the established perf convention). SSE is deferred — polling is simpler and matches existing surfaces.
- **Fix orphans:** wire the dead `/dashboard?view=evals` link (open the Evals surface), and link cockpit sessions → their analytics.

## Data flow

Existing client fetches (`/api/board`, `/api/familiars`, `/api/github/*`, `/api/library/reading`, `/api/inbox`, `/api/sessions/list`) plus the new pure aggregations in `dashboard-analytics.ts`. Polling reuses these endpoints on an interval gated by `usePausablePoll`.

## Error handling

- Each panel degrades independently: a failed fetch shows that panel's skeleton/empty state, never blanks the cockpit (current behavior preserved).
- Charts show `EmptyState` under sparse data (< 2 points).
- Optimistic inline actions revert + surface a banner on failure (same pattern as the existing action-inbox).

## Testing

- `src/lib/dashboard-analytics.test.ts` — mini-profile aggregation, resolution/throughput trends, signal thresholds. Pure, no DOM.
- Chart-primitive source tests (shared with Evals — already covered in PR 1).
- Extend `src/app/dashboard-page.test.ts`: new panels render, KPI drill-down links present, polling hook wired, `?view=evals` handled.
- Keep `src/lib/dashboard-model.test.ts` green (model unchanged).
- Wire new test files into `scripts/run-tests.mjs` (+ `ALIAS_LOADER` if `@/` imports).
- Typecheck, `check:tests-wired`, app suite before committing.

## Scope guards

- `dashboard-model.ts` and its tests stay intact; new logic lives in `dashboard-analytics.ts`.
- `daily-report-ui.tsx` / `daily-report.ts` and the shared `.dr-*` global block stay untouched (still shared with `/daily-report`); add only scoped `.dash-*` CSS.
- visx imported only inside the dashboard lazy chunk.
- Aim for **no new API routes**; flag and confirm if one proves unavoidable.
- Lands via a PR on a branch (main is protected; required checks: Frontend build, Rust check, CodeQL, E2E).

## Out of scope

- SSE/websocket push (polling first).
- Reworking the Home composer surface.
- Reworking `/daily-report`.
- Per-familiar theming of the cockpit.

## Sequencing

PR 1 (charts foundation) → PR 3 (this Dashboard upgrade), after the Evals upgrade (PR 2).
