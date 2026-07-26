# Unified Evals Analysis Design

## Goal

Merge the split `Eval Loops` and `Evals` workspaces into one analysis-first Evals control room. The unified surface should help a maintainer answer:

- Are suite-based evals passing or drifting?
- Are familiar eval-loop iterations being accepted or reverted?
- Are loop locks/runs healthy or stale?
- Which thread eval snapshots are stale, blocked, queued, or never run?

## Surface Model

The `evals` workspace mode becomes the canonical UI. `/evals` and `/eval-loops` both route there. The old `retro` mode remains as a compatibility alias only, so deep links do not break, but it is no longer a separate sidebar/settings surface.

The sidebar exposes one `Evals` item with the flask icon. The title remains `Evals`, and the page itself explains the merged scope through operational data rather than marketing copy.

## Page Structure

`EvalsView` owns the unified surface:

- Analysis header: total suites, total suite runs, latest suite pass rate, eval-loop accept/revert counts, running familiars, stale grouped thread count, and queued manual eval count.
- Overview tab: compact analysis cards, coverage notes, and the recent eval-loop run list.
- Suites tab: the existing suite editor and run controls.
- Runs tab: the existing per-suite run history and result detail.
- Loops tab: embedded `EvalLoopPanel` for the selected familiar plus sanitized loop history/export controls.
- Thread freshness tab: grouped eval snapshot details and the manual stale-eval queue action.

The existing grouped eval panel and suite runner stay intact, but the group panel moves out of the editor-only flow so it reads as operational state.

## Data Flow

The unified view loads the existing endpoints:

- `/api/evals/suites`
- `/api/evals/runs`
- `/api/evals/groups`
- `/api/evals/thread-states`
- `/api/evals/queue`
- `/api/retro-runs`
- `/api/skills/eval-loop/:familiarId`

No new persistence layer is required. Analysis rollups are derived client-side from existing DTOs and sanitized API responses.

## Compatibility

- Keep `/dashboard/retro` and `/retro` as redirects to the unified Evals route.
- Keep `/eval-loops` slash command support, but make it open `evals`.
- Keep `retro` mode accepted internally as an alias to render `EvalsView`, so saved state or stale links do not blank the workspace.

## Testing

Use focused source tests first because these surfaces already pin wiring through source assertions. Add coverage that:

- sidebar/settings no longer expose a separate `retro` add-on surface
- `/evals` and `/eval-loops` open `evals`
- the unified Evals view fetches retro-loop snapshot data
- the unified Evals view renders analysis, suite, run, loop, and thread freshness sections
- the embedded loop controls remain available through `EvalLoopPanel`

Then run focused component/source tests, typecheck, wired-test check, whitespace check, and the app test suite before committing.
