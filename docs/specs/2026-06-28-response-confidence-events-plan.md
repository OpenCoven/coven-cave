# Response Confidence Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add append-only per-response familiar confidence diagnostics and surface their rollups in Familiar Analytics and Eval Loops.

**Architecture:** Reuse the existing familiar self-report domain. Add response-level event types and rollups in `thread-self-report.ts`, append/list storage in `familiar-self-reports.ts`, a guarded listing API route, analytics data/model fields, and compact UI panels.

**Tech Stack:** Next.js App Router, TypeScript, node:test, JSONL filesystem storage, existing Cave CSS tokens.

---

### Task 1: Model And Rollups

**Files:**
- Modify: `src/lib/thread-self-report.ts`
- Modify: `src/lib/thread-self-report.test.ts`

- [ ] Write failing tests for `normalizeResponseConfidenceEvent` clamping 1-100 scores and for `aggregateResponseConfidenceEvents` computing average confidence, low-confidence count, factor averages, tags, and newest event.
- [ ] Run `node --experimental-strip-types --test src/lib/thread-self-report.test.ts` and confirm the new tests fail because the helpers do not exist.
- [ ] Add `ResponseConfidenceFactorKey`, `ResponseConfidenceFactor`, `ResponseConfidenceEvent`, `ResponseConfidenceRollup`, `normalizeResponseConfidenceEvent`, and `aggregateResponseConfidenceEvents`.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Storage

**Files:**
- Modify: `src/lib/server/familiar-self-reports.ts`
- Modify: `src/lib/server/familiar-self-reports.test.ts`

- [ ] Write failing tests for `appendResponseConfidenceEvent` and `listResponseConfidenceEvents`, including secret redaction, newest-first order, limit, `before`, missing directory, and familiar path guard behavior.
- [ ] Run `node --experimental-strip-types --test src/lib/server/familiar-self-reports.test.ts` and confirm failure on missing exports.
- [ ] Add response-confidence JSONL read/list/append helpers under `self-reports/response-confidence`.
- [ ] Re-run the focused storage test and confirm it passes.

### Task 3: API

**Files:**
- Create: `src/app/api/familiars/[id]/response-confidence/route.ts`
- Modify: `src/app/api/api-contracts.test.ts`

- [ ] Add the API contract row for `/familiars/[id]/response-confidence`.
- [ ] Run `node --experimental-strip-types --test src/app/api/api-contracts.test.ts` and confirm the route is missing.
- [ ] Implement a guarded GET route that reads `limit` and `before`, calls `listResponseConfidenceEvents`, and returns `{ ok, events, total }`.
- [ ] Re-run the API contract test and confirm it passes.

### Task 4: Analytics Data And UI

**Files:**
- Modify: `src/components/familiar-analytics-data.ts`
- Modify: `src/components/familiar-analytics-view.tsx`
- Modify: `src/components/familiar-analytics-view.test.ts`
- Modify: `src/components/eval-loop-panel.tsx`
- Modify: `src/app/globals.css`

- [ ] Add failing analytics tests that mock `/api/familiars/cody/response-confidence?limit=100`, assert model response confidence rollup values, and assert source wiring for a `ResponseConfidenceSection` plus `EvalLoopPanel` prop.
- [ ] Run `node --experimental-strip-types --test src/components/familiar-analytics-view.test.ts` and confirm failure on missing fields/source wiring.
- [ ] Fetch response confidence events in analytics data, include them in the model, and compute the rollup with `aggregateResponseConfidenceEvents`.
- [ ] Add `ResponseConfidenceSection` and pass the rollup into `EvalLoopPanel`.
- [ ] Add compact CSS for factor/tag display using existing `fa-*` patterns.
- [ ] Re-run the focused analytics test and confirm it passes.

### Task 5: Verification

**Files:**
- All touched files.

- [ ] Run focused tests:
  - `node --experimental-strip-types --test src/lib/thread-self-report.test.ts`
  - `node --experimental-strip-types --test src/lib/server/familiar-self-reports.test.ts`
  - `node --experimental-strip-types --test src/app/api/api-contracts.test.ts`
  - `node --experimental-strip-types --test src/components/familiar-analytics-view.test.ts`
- [ ] Run project gates:
  - `pnpm typecheck`
  - `pnpm check:tests-wired`
  - targeted `pnpm test:app` if time permits, otherwise at minimum the focused tests above.
- [ ] Run `git diff --check`.
- [ ] Report local branch status and ask before commit/push/PR.
