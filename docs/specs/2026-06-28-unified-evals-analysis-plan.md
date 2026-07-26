# Unified Evals Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the split Eval Loops and Evals workspaces into one richer Evals analysis/control room.

**Architecture:** Keep existing backend endpoints and persistence. Refactor `EvalsView` to derive richer rollups from existing eval-suite, eval-run, grouped-thread, queue, and retro-loop data. Treat `retro` as a compatibility alias in workspace routing while removing it from the visible nav/add-on surface.

**Tech Stack:** Next.js App Router, React 19, TypeScript, source-text tests, Node test runner, PNPM.

---

### Task 1: Red Tests

**Files:**
- Modify: `src/components/evals/evals-view.test.ts`
- Modify: `src/components/retro-runs-view.test.ts`

- [ ] Add assertions that `EvalsView` fetches `/api/retro-runs`, imports/renders `EvalLoopPanel`, has analysis tabs, and renders eval-loop and thread freshness analysis copy.
- [ ] Add assertions that workspace slash commands route `/evals` and `/eval-loops` to `evals`, the sidebar has no visible `retro` row, and settings no longer expose a `retro` add-on.
- [ ] Run `node --experimental-strip-types --test src/components/evals/evals-view.test.ts src/components/retro-runs-view.test.ts` and confirm the new assertions fail before production edits.

### Task 2: Unified Evals View

**Files:**
- Modify: `src/components/evals/evals-view.tsx`
- Modify: `src/styles/evals.css`

- [ ] Load `/api/retro-runs` alongside existing eval data.
- [ ] Add analysis helpers for suite pass rate, total runs, eval-loop accept/revert counts, running familiar count, stale thread count, and queued eval count.
- [ ] Add top analysis cards and tabs: `Overview`, `Suites`, `Runs`, `Loops`, `Thread freshness`.
- [ ] Move the grouped eval panel into the thread freshness tab and preserve `Run stale evals`.
- [ ] Embed `EvalLoopPanel` in the loop tab for the selected familiar.
- [ ] Add sanitized loop snapshot export and compact recent loop history in overview/loop areas.
- [ ] Run the focused Evals source test and fix failures.

### Task 3: Route And Nav Consolidation

**Files:**
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/sidebar-minimal.tsx`
- Modify: `src/components/command-palette.tsx`
- Modify: `src/components/settings-shell.tsx`
- Modify: `src/lib/slash-commands.ts`
- Modify: `src/app/dashboard/retro/page.tsx`
- Modify: `src/app/retro/page.tsx`

- [ ] Route `/evals` and `/eval-loops` slash commands to `evals`.
- [ ] Render `EvalsView` for both `mode === "evals"` and legacy `mode === "retro"`.
- [ ] Remove visible `retro` sidebar/settings/add-on gating while keeping the mode type for compatibility.
- [ ] Redirect `/dashboard/retro` and `/retro` to the unified Evals route.
- [ ] Run the focused retro/nav source test and fix failures.

### Task 4: Verification And Merge

**Files:**
- All touched files

- [ ] Run focused tests for evals, retro/nav, eval loop panel, and affected surface loading/error states.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm check:tests-wired`.
- [ ] Run `git diff --check`.
- [ ] Run `pnpm test:app`.
- [ ] Commit with hooks enabled, push `feat/unified-eval-analysis`, open PR, review comments/CI, merge to `main`, delete feature branch/worktree, release Coven claim.
