# Cave-Native Eval Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the Evals starter template catalog so it is directly applicable to Coven Cave familiar operations.

**Architecture:** Keep the existing template module and gallery. Tighten the catalog tests first, then replace the generic template records with Cave-native self-contained starter suites.

**Tech Stack:** Next.js App Router, React, TypeScript, Node test runner, PNPM.

---

### Task 1: Red Test For Cave-Native Templates

**Files:**
- Modify: `src/lib/evals/eval-templates.test.ts`

- [ ] Add required template ID assertions for the Cave operational starters.
- [ ] Add a guard that generic benchmark starter IDs are absent.
- [ ] Remove the dead `|| true` branch in grader value validation.
- [ ] Run `node --experimental-strip-types --test src/lib/evals/eval-templates.test.ts` and confirm it fails because the current catalog is generic.

### Task 2: Replace The Template Catalog

**Files:**
- Modify: `src/lib/evals/eval-templates.ts`

- [ ] Replace generic fact/math/translation examples with Cave-native starter suites.
- [ ] Keep prompts self-contained and editable after cloning.
- [ ] Prefer deterministic graders where precise outputs are requested.
- [ ] Use `llm_judge` only where usefulness, triage quality, or tone requires semantic grading.
- [ ] Run the focused template test and fix failures.

### Task 3: Verify Gallery Wiring

**Files:**
- Modify if needed: `src/components/evals/evals-view.test.ts`
- Modify if needed: `src/components/evals/evals-view.tsx`
- Modify if needed: `src/styles/evals.css`
- Modify if needed: `scripts/run-tests.mjs`

- [ ] Confirm the existing gallery wiring still imports `templatesByCategory` and `instantiateTemplate`.
- [ ] Confirm `eval-templates.test.ts` is wired into `pnpm test:app`.
- [ ] Run focused Evals tests.

### Task 4: Verification

**Files:**
- All touched files

- [ ] Run `node --experimental-strip-types --test src/lib/evals/eval-templates.test.ts src/components/evals/evals-view.test.ts`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm check:tests-wired`.
- [ ] Run `git diff --check`.

