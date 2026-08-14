# Dev App Origin Readiness Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the unrelated launcher readiness change out of PR #4184, then make its bounded retry loop resource-safe and deterministically tested in a separate PR.

**Architecture:** PR #4184 receives a normal revert of the unrelated startup commit so its reviewed branch-repair scope remains intact without rewriting history. A new branch from current `origin/main` carries the startup retry: one absolute deadline bounds all attempts, non-success response bodies are cancelled before retrying, and injected fetch implementations test transient failure and cleanup without racing for a real port.

**Tech Stack:** Node.js ESM scripts, built-in `fetch`, `AbortSignal.timeout`, `node:http`, `node:net`, Node strict assertions, GitHub CLI.

---

## File map

- `scripts/dev-app-origin-health.mjs` — validates launcher arguments and probes the loopback Next.js origin within one bounded deadline.
- `scripts/dev-app-origin-health.test.mjs` — covers ready, redirect, hung, absent, transiently unavailable, and non-success response cleanup behavior.
- `docs/superpowers/specs/2026-08-01-dev-app-origin-readiness-retry-design.md` — approved behavior and scope.
- `docs/superpowers/plans/2026-08-01-dev-app-origin-readiness-retry.md` — execution checklist.

### Task 1: Restore PR #4184 to its focused scope

**Files:**
- Modify through revert: `scripts/dev-app-origin-health.mjs`
- Modify through revert: `scripts/dev-app-origin-health.test.mjs`

- [ ] **Step 1: Confirm the remote PR still contains the unrelated commit**

Run:

```bash
git -C .worktrees/cave-41dj8-review fetch origin
git -C .worktrees/cave-41dj8-review log --oneline origin/main..origin/codex/cave-ox3ky-consolidated
```

Expected: commit `4e16a30f9 fix(dev): wait for loopback origin startup` appears.

- [ ] **Step 2: Revert the unrelated commit without rewriting PR history**

Run:

```bash
git -C .worktrees/cave-41dj8-review revert -S 4e16a30f9dcbd3fb7a8a5e10bc320de8ab582653
```

Expected: a signed revert commit removes only the two launcher-health file changes.

- [ ] **Step 3: Verify the focused PR diff**

Run:

```bash
git -C .worktrees/cave-41dj8-review diff --check origin/main...HEAD
git -C .worktrees/cave-41dj8-review diff --name-status origin/main...HEAD
```

Expected: no `scripts/dev-app-origin-health.*` files remain in PR #4184.

- [ ] **Step 4: Push and merge PR #4184 through protection**

Run:

```bash
git -C .worktrees/cave-41dj8-review push origin codex/cave-ox3ky-consolidated
gh pr checks 4184 --watch --interval 15
```

Expected: all nine required checks pass. Re-query every review thread, then squash-merge only the checked head:

```bash
gh pr merge 4184 --squash --match-head-commit "$(gh pr view 4184 --json headRefOid --jq .headRefOid)"
```

Do not delete the local worktree or branch while another session may still own it.

### Task 2: Reproduce the startup retry defect with deterministic tests

**Files:**
- Modify: `scripts/dev-app-origin-health.test.mjs`

- [ ] **Step 1: Add a transient connection-failure test**

Replace the released-port delayed-server test with:

```js
let transientAttempts = 0;
const transientResponded = await loopbackOriginResponds({
  port: 3000,
  timeoutMs: 500,
  fetchImpl: async () => {
    transientAttempts += 1;
    if (transientAttempts === 1) {
      const error = new Error("origin not listening");
      error.code = "ECONNREFUSED";
      throw error;
    }
    return new Response(null, { status: 204 });
  },
});
assert.equal(transientResponded, true);
assert.equal(transientAttempts, 2, "a refused first connection is retried");
```

- [ ] **Step 2: Add a non-success body-cleanup test**

Add:

```js
let cleanupAttempts = 0;
let bodyCancelled = false;
const cleanupResponded = await loopbackOriginResponds({
  port: 3000,
  timeoutMs: 500,
  fetchImpl: async () => {
    cleanupAttempts += 1;
    if (cleanupAttempts === 1) {
      return {
        status: 503,
        body: {
          async cancel() {
            bodyCancelled = true;
          },
        },
      };
    }
    return new Response(null, { status: 204 });
  },
});
assert.equal(cleanupResponded, true);
assert.equal(bodyCancelled, true, "a non-success response body is cancelled before retry");
assert.equal(cleanupAttempts, 2);
```

- [ ] **Step 3: Run the focused test and verify the cleanup assertion fails**

Run:

```bash
cd .worktrees/fix-dev-app-origin-readiness-retry
node scripts/dev-app-origin-health.test.mjs
```

Expected: FAIL because the current one-shot implementation does not retry or cancel a non-success body.

- [ ] **Step 4: Commit the failing regression tests**

Run:

```bash
git add scripts/dev-app-origin-health.test.mjs
git commit -S -m "test(dev): pin origin readiness retries"
```

### Task 3: Implement bounded, resource-safe retries

**Files:**
- Modify: `scripts/dev-app-origin-health.mjs`

- [ ] **Step 1: Add the retry interval**

Add beside the timeout constants:

```js
const RETRY_DELAY_MS = 50;
```

- [ ] **Step 2: Replace the one-shot fetch with one deadline-bounded loop**

Use:

```js
const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  const remainingMs = deadline - Date.now();
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}${READY_PATH}`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(remainingMs),
    });
    if (response.status >= 200 && response.status < 400) return true;
    await response.body?.cancel();
  } catch {
    // Connection refusal and deadline abort both mean "not ready yet".
  }

  const retryInMs = Math.min(RETRY_DELAY_MS, deadline - Date.now());
  if (retryInMs <= 0) break;
  await new Promise((resolve) => setTimeout(resolve, retryInMs));
}
return false;
```

The catch remains local to the readiness probe: connection refusal is expected during startup, while the absolute deadline still surfaces failure through the function's `false` result and CLI exit code.

- [ ] **Step 3: Run the focused test**

Run:

```bash
node scripts/dev-app-origin-health.test.mjs
```

Expected: `dev-app-origin-health: ok`.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add scripts/dev-app-origin-health.mjs
git commit -S -m "fix(dev): wait for loopback origin startup"
```

### Task 4: Verify and open the separate PR

**Files:**
- Verify: `scripts/dev-app-origin-health.mjs`
- Verify: `scripts/dev-app-origin-health.test.mjs`
- Verify: `docs/superpowers/specs/2026-08-01-dev-app-origin-readiness-retry-design.md`
- Verify: `docs/superpowers/plans/2026-08-01-dev-app-origin-readiness-retry.md`

- [ ] **Step 1: Run focused and repository gates**

Run:

```bash
node scripts/dev-app-origin-health.test.mjs
pnpm lint
pnpm typecheck
git diff --check origin/main...HEAD
```

Expected: all commands exit 0.

- [ ] **Step 2: Review the final branch diff**

Run:

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- scripts/dev-app-origin-health.mjs scripts/dev-app-origin-health.test.mjs
```

Expected: only the approved retry implementation, deterministic tests, design, and plan are present.

- [ ] **Step 3: Push and open the PR**

Run:

```bash
git push -u origin fix/dev-app-origin-readiness-retry
gh pr create \
  --base main \
  --head fix/dev-app-origin-readiness-retry \
  --title "fix(dev): wait for loopback origin startup" \
  --body "Retries transient loopback startup failures within the existing deadline, cancels non-success response bodies before retrying, and replaces the released-port race with deterministic injected-fetch coverage."
```

- [ ] **Step 4: Merge only after protection is satisfied**

Wait for all nine required checks, inspect and resolve every review thread with a fixing-commit reply, then squash-merge using the exact checked head.
