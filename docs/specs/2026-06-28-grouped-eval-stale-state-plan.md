# Grouped Eval Stale State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add thread eval freshness verification, grouped manual queueing, richer per-thread eval details, and a review-first Thread Signals summary.

**Architecture:** Keep the domain logic in `src/lib/evals/eval-model.ts` and `src/lib/thread-self-report.ts`; keep local persistence in `src/lib/server/eval-store.ts`; keep the Evals and Analytics UI as thin renderers over those pure helpers.

**Tech Stack:** Next.js/React, Node test runner, filesystem-backed JSON store, existing Cave CSS tokens.

---

### Task 1: Thread Eval State Model

**Files:**
- Modify: `src/lib/evals/eval-model.ts`
- Modify: `src/lib/evals/eval-model.test.ts`

- [x] Add `ThreadEvalSnapshot`, `ThreadEvalCurrent`, `ThreadEvalState`, `EvalGroup`, `EvalGroupRollup`, and `ManualEvalQueueItem`.
- [x] Add failing tests for never-run, fresh, stale reasons, running locks, blocked locks, group rollup, and queue item construction.
- [x] Implement `deriveThreadEvalState`, `rollupEvalGroup`, and `buildManualEvalQueueItems`.
- [x] Extend `ThreadEvalState.details` with reviewable freshness evidence.
- [x] Verify with `node --experimental-strip-types --test src/lib/evals/eval-model.test.ts`.

### Task 2: Eval Store And API Routes

**Files:**
- Modify: `src/lib/server/eval-store.ts`
- Modify: `src/lib/server/eval-store.test.ts`
- Create: `src/app/api/evals/groups/route.ts`
- Create: `src/app/api/evals/thread-states/route.ts`
- Create: `src/app/api/evals/queue/route.ts`
- Modify: `src/app/api/api-contracts.test.ts`

- [x] Add tests for saving/listing groups and thread snapshots.
- [x] Add tests for creating manual queue items from runnable stale states.
- [x] Add local JSON persistence under the eval store for groups, thread states, and queue.
- [x] Add API routes for listing/saving groups, listing/saving thread snapshots, and listing/enqueueing queue items.
- [x] Wire routes into the API contract test.
- [x] Verify with `node --experimental-strip-types --test src/lib/server/eval-store.test.ts`.

### Task 3: Evals Surface

**Files:**
- Modify: `src/components/evals/evals-view.tsx`
- Modify: `src/components/evals/evals-view.test.ts`
- Modify: `src/styles/evals.css`

- [x] Add source tests for group/thread-state/queue endpoint wiring.
- [x] Load groups, thread snapshots, and queue beside suites.
- [x] Render group rollup and stale reasons.
- [x] Add detailed thread eval rows showing evaluated-through turn, latest turn, confidence event count drift, and rubric version drift.
- [x] Add a manual `Run stale evals` queue action.
- [x] Verify with `node --experimental-strip-types --test src/components/evals/evals-view.test.ts`.

### Task 4: Thread Signals Review Queue

**Files:**
- Modify: `src/lib/thread-self-report.ts`
- Modify: `src/components/thread-signals-section.tsx`
- Modify: `src/components/thread-signals-section.test.ts`
- Modify: `src/app/globals.css`

- [x] Add failing tests for ranked summary review items.
- [x] Implement `buildThreadSignalReviewQueue`.
- [x] Render a `Review queue` above the broad Thread Signals breakdown.
- [x] Include report count and latest report recency.
- [x] Verify with `node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/thread-signals-section.test.ts`.

### Task 5: Automation Follow-Up

**Files:**
- Internal Workboard card

- [x] Track the deferred scheduler as `Phase 3: Automate grouped thread eval scheduling safely` on the `coven` board.
- [x] Keep automation out of this implementation until scheduler guardrails are designed.
