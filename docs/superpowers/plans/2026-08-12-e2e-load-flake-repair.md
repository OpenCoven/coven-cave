# E2E Load-Flake Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the no-active-familiar E2E scenario deterministic by giving its first fallback familiar an accessible project, then re-measure the three CI symptoms without changing product behavior or global timeouts.

**Architecture:** Keep the repair inside the test fixture that owns the scenario. Intercept only the `/api/projects` collection endpoint for this page, return one accessible project for both unscoped and Aster-scoped reads, and leave the shared Playwright permission seed unchanged.

**Tech Stack:** TypeScript, Playwright 1.62, Next.js 16, pnpm

---

### Task 1: Repair the no-active-familiar project fixture

**Files:**
- Modify: `tests/chat-boot-landing.spec.ts:46-65`
- Test: `tests/chat-boot-landing.spec.ts:232-247`

- [ ] **Step 1: Preserve the failing baseline evidence**

Run from the managed worktree:

```bash
CI=1 pnpm exec playwright test tests/chat-boot-landing.spec.ts tests/task-work-fit.spec.ts tests/reader.spec.ts \
  --project=desktop \
  --grep 'booting with no active familiar asks which one instead of picking|opening the code rail does not re-send the task.s first prompt|a rewrite replaces the body, says it is a lens, and is cached' \
  --repeat-each=8
```

Expected current-main result: the chat scenario fails or flakes with
`getByRole('heading', { name: 'Start a new chat' })` absent, and the error
context shows `Give this familiar project access` for Aster. The observed
baseline is 2 hard failures, 2 flaky retries, and 23 passes.

- [ ] **Step 2: Add the minimal fixture-owned projects response**

In `seedWithoutActiveFamiliar`, add a route after the familiar route and
before navigation:

```ts
await page.route(
  (url) => url.pathname === "/api/projects",
  (route) => route.fulfill({
    json: {
      ok: true,
      projects: [{
        id: "e2e-project",
        name: "E2E Project",
        root: "/repo/alpha",
        access: "write",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    },
  }),
);
```

This response intentionally covers both the unscoped registry read and the
`familiarId=aster` scoped readiness read. Do not add an active-familiar local
storage value, grant Aster globally, or change Playwright timeouts.

- [ ] **Step 3: Verify the repaired scenario under CI-shaped repetition**

Run:

```bash
CI=1 pnpm exec playwright test tests/chat-boot-landing.spec.ts \
  --project=desktop \
  --grep 'booting with no active familiar asks which one instead of picking' \
  --repeat-each=12
```

Expected: 15 passed, 0 flaky, 0 failed: 12 target repetitions plus the three
desktop-project prerequisite checks. The assertions must still prove Aster and
Nova are offered while `chat-new-dashboard` remains absent.

- [ ] **Step 4: Verify the complete chat-boot landing contract**

Run:

```bash
CI=1 pnpm exec playwright test tests/chat-boot-landing.spec.ts --project=desktop
```

Expected: 8 passed, 0 flaky, 0 failed: the file's five scenarios plus the
three desktop-project prerequisite checks.

### Task 2: Re-measure the other CI symptoms

**Files:**
- Test: `tests/task-work-fit.spec.ts:277-296`
- Test: `tests/reader.spec.ts:339-358`
- No source modifications unless a symptom reproduces with diagnostic evidence

- [ ] **Step 1: Stress all three named scenarios together**

Run:

```bash
CI=1 pnpm exec playwright test tests/chat-boot-landing.spec.ts tests/task-work-fit.spec.ts tests/reader.spec.ts \
  --project=desktop \
  --grep 'booting with no active familiar asks which one instead of picking|opening the code rail does not re-send the task.s first prompt|a rewrite replaces the body, says it is a lens, and is cached' \
  --repeat-each=12
```

Expected: 39 passed, 0 flaky, 0 failed: 36 target repetitions plus the three
desktop-project prerequisite checks.

- [ ] **Step 2: Stop on a Task Work or Reader recurrence**

If either non-chat scenario fails, preserve its trace and error context, append
the evidence to `cave-9ta9k`, and return to root-cause analysis. Do not raise a
timeout or modify production code under this plan.

- [ ] **Step 3: Record non-reproduction honestly**

If both non-chat scenarios pass, append their exact repetition count to
`cave-9ta9k`. Keep their historical CI evidence in the bead; the result means
only that this patch needs no speculative changes for them.

### Task 3: Run static gates and prepare the handoff

**Files:**
- Modify: `tests/chat-boot-landing.spec.ts`
- Preserve uncommitted design and plan documents until Val decides whether they belong in the PR

- [ ] **Step 1: Run repository verification**

Run:

```bash
pnpm typecheck
pnpm check:tests-wired
git diff --check
git status --short
```

Expected: all commands exit 0. Git status contains only the intended fixture
change and the two approved workflow documents.

- [ ] **Step 2: Update the Bead with delivery evidence**

Append the worktree path, branch, changed file, exact test counts, static-gate
results, and any remaining proof gap to `cave-9ta9k`. Keep it `in_progress`
until the requested completion criteria are satisfied.

- [ ] **Step 3: Stop before Git publication**

Do not commit, push, open a PR, or close the bead without Val's explicit
authorization. Report the verified diff and the exact next publication command.
