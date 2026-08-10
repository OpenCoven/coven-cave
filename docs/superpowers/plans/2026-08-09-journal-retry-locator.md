# Journal Retry Locator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Journal error-state E2E assertion select the Journal-owned Retry action even when the shell exposes another Retry button.

**Architecture:** Keep all product behavior unchanged and modify only the ambiguous Playwright assertion in `tests/journal.spec.ts`. Use the existing accessible `Journal entry` region as the semantic boundary, then verify the regression in focused, CI-mode, file-level, wiring, and complete-suite runs.

**Tech Stack:** TypeScript, Playwright, pnpm, Next.js E2E web server

---

## File Structure

- Modify: `tests/journal.spec.ts` — scope the error-state Retry visibility assertion to the accessible Journal entry region.
- Reference: `docs/superpowers/specs/2026-08-09-journal-retry-locator-design.md` — approved behavior and verification contract; no changes required during implementation.

### Task 1: Scope the Journal Retry assertion

**Files:**
- Modify: `tests/journal.spec.ts:207-212`

- [ ] **Step 1: Reproduce the existing strict-locator failure**

Run:

```bash
pnpm exec playwright test tests/journal.spec.ts \
  --project=desktop \
  --grep "shows a retryable error instead of stale or endless loading content" \
  --workers=1
```

Expected: FAIL at the page-global `getByRole("button", { name: "Retry" })` assertion because strict mode resolves both the shell daemon-status Retry button and the Journal error-state Retry button.

- [ ] **Step 2: Replace the global lookup with the accessible Journal region scope**

Change the assertion in `tests/journal.spec.ts` to:

```ts
await expect(
  page
    .getByRole("region", { name: "Journal entry" })
    .getByRole("button", { name: "Retry" }),
).toBeVisible();
```

Do not modify application code, hide the daemon banner, rename either Retry action, or introduce CSS-class scoping.

- [ ] **Step 3: Run the focused test normally**

Run:

```bash
pnpm exec playwright test tests/journal.spec.ts \
  --project=desktop \
  --grep "shows a retryable error instead of stale or endless loading content" \
  --workers=1
```

Expected: PASS with one desktop test passing.

- [ ] **Step 4: Run the focused test in CI mode**

Run:

```bash
CI=true pnpm exec playwright test tests/journal.spec.ts \
  --project=desktop \
  --grep "shows a retryable error instead of stale or endless loading content" \
  --workers=1
```

Expected: PASS with no strict-locator error under the CI configuration.

- [ ] **Step 5: Run the complete Journal E2E file**

Run:

```bash
pnpm exec playwright test tests/journal.spec.ts --project=desktop --workers=1
```

Expected: all tests in `tests/journal.spec.ts` PASS.

- [ ] **Step 6: Commit the test fix**

```bash
git add tests/journal.spec.ts
git commit -m "test: scope Journal retry assertion"
```

Expected: one commit containing only the scoped locator change and no AI attribution trailer.

### Task 2: Verify the repository and record evidence

**Files:**
- Verify: `tests/journal.spec.ts`
- Update through CLI: Bead `cave-6vagb`

- [ ] **Step 1: Verify E2E test wiring**

Run:

```bash
pnpm check:tests-wired
```

Expected: PASS with the repository reporting that test files are wired into the configured test commands.

- [ ] **Step 2: Run static repository gates**

Run:

```bash
pnpm lint && pnpm typecheck
```

Expected: both commands PASS without warnings or TypeScript errors.

- [ ] **Step 3: Run the application and API test suites**

Run:

```bash
pnpm test:app && pnpm test:api
```

Expected: both suites PASS.

- [ ] **Step 4: Run the complete Playwright E2E suite**

Run:

```bash
pnpm test:e2e
```

Expected: the complete configured Playwright suite PASS, including the Journal regression on the desktop project and all configured mobile/WebKit coverage.

- [ ] **Step 5: Confirm the branch contains only the approved scope**

Run:

```bash
git status --short
git diff origin/main...HEAD -- tests/journal.spec.ts \
  docs/superpowers/specs/2026-08-09-journal-retry-locator-design.md \
  docs/superpowers/plans/2026-08-09-journal-retry-locator.md
```

Expected: the worktree is clean after committing the plan and implementation; the branch diff contains only the design document, implementation plan, and one accessibility-scoped test assertion.

- [ ] **Step 6: Record verification evidence on the Bead**

Run:

```bash
bd comments add cave-6vagb \
  "Implemented on fix/cave-6vagb-journal-retry-scope. Scoped the Journal Retry assertion to the accessible Journal entry region; no product behavior changed. Verification: focused desktop PASS, CI=true focused desktop PASS, full journal.spec.ts PASS, check:tests-wired PASS, lint PASS, typecheck PASS, app tests PASS, API tests PASS, full Playwright E2E PASS."
```

Expected: Bead `cave-6vagb` remains `in_progress` and contains the branch, scope, and verification evidence needed for PR handoff. Do not close it before merge.
