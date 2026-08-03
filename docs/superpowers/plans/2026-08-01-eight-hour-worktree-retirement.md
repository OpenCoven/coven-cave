# Eight-Hour Worktree Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change only the branch/worktree retirement recency window from 24 hours to a mandatory 8 hours.

**Architecture:** Export one lifecycle cooldown constant and use it in both metadata-aware and legacy classifiers. Pin the exact 8-hour boundary in unit and patrol integration tests, then align the binding branch-curator policy, deletion proof, evaluation fixture, and current retirement design documentation without weakening the maintenance gate.

**Tech Stack:** TypeScript, Node.js assertion tests, JSON evaluation fixtures, Markdown policy documentation, GitHub pull-request workflow.

---

## File map

- `src/lib/worktree-lifecycle.ts` — lifecycle lanes, cooldown threshold, and human-readable reasons.
- `src/lib/worktree-lifecycle.test.ts` — exact classifier boundary coverage.
- `scripts/worktree-lifecycle-patrol.test.mjs` — end-to-end inventory timestamp and lane coverage.
- `.agents/skills/branch-curator/SKILL.md` — binding curator recency rule.
- `.agents/skills/branch-curator/references/deletion-proof.md` — normative under-gate numeric cutoff and proof requirements.
- `.agents/skills/branch-curator/evals/evals.json` — evaluation prompt and expected cutoff behavior.
- `docs/superpowers/specs/2026-07-31-automatic-local-branch-retirement-design.md` — current automatic-retirement architecture.
- `docs/superpowers/specs/2026-08-01-eight-hour-worktree-retirement-design.md` — approved change design.
- `docs/workflows/beads-familiars.md` — familiar patrol lifecycle lane documentation.

### Task 1: Pin the eight-hour classifier boundary

**Files:**
- Modify: `src/lib/worktree-lifecycle.test.ts`

- [ ] **Step 1: Import and assert the new public constant**

Add `RETIREMENT_COOLDOWN_MS` to the dynamic import destructuring and define:

```ts
const HOUR = 60 * 60 * 1000;
assert.equal(
  RETIREMENT_COOLDOWN_MS,
  8 * HOUR,
  "retirement cooldown remains the mandatory eight-hour window",
);
```

- [ ] **Step 2: Add the before-boundary test**

Add a landed, metadata-aware observation with:

```ts
updatedAtMs: NOW - RETIREMENT_COOLDOWN_MS + 1,
```

Assert:

```ts
assert.equal(item.lane, "cooldown");
assert.match(item.reasons.join("\n"), /8-hour cooldown/);
```

- [ ] **Step 3: Add the exact-boundary test**

Add the same landed observation with:

```ts
updatedAtMs: NOW - RETIREMENT_COOLDOWN_MS,
```

Assert:

```ts
assert.equal(item.lane, "retire-after-gate");
assert.match(item.reasons.join("\n"), /older than 8 hours/);
assert.match(item.reasons.join("\n"), /maintenance gate/);
```

- [ ] **Step 4: Run the unit test and verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
```

Expected: FAIL because `RETIREMENT_COOLDOWN_MS` is not exported and current reasons still say 24 hours.

- [ ] **Step 5: Commit the failing tests**

Run:

```bash
git add src/lib/worktree-lifecycle.test.ts
git commit -S -m "test(worktrees): pin eight-hour retirement boundary"
```

### Task 2: Implement the eight-hour runtime policy

**Files:**
- Modify: `src/lib/worktree-lifecycle.ts`

- [ ] **Step 1: Replace the day constant**

Replace:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;
```

with:

```ts
export const RETIREMENT_COOLDOWN_MS = 8 * 60 * 60 * 1000;
```

- [ ] **Step 2: Update both classification paths**

In `classifyLifecycleUnitInternal` and `classifyLifecycleUnitWithoutMetadata`,
replace `ageMs < DAY_MS` with:

```ts
ageMs < RETIREMENT_COOLDOWN_MS
```

Use these exact reasons:

```ts
"landed work remains inside the mandatory 8-hour cooldown"
```

and:

```ts
"clean landed work is older than 8 hours"
```

- [ ] **Step 3: Run the unit test**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add src/lib/worktree-lifecycle.ts
git commit -S -m "fix(worktrees): use an eight-hour retirement cooldown"
```

### Task 3: Pin the patrol integration boundary

**Files:**
- Modify: `scripts/worktree-lifecycle-patrol.test.mjs`

- [ ] **Step 1: Change the post-landing timestamp**

The fixture lands at `2026-08-10T21:30:00Z`. Change the eligibility probe to the
exact eight-hour boundary:

```js
patrol(["--json", "--now", "2026-08-11T05:30:00Z"])
```

- [ ] **Step 2: Update the assertion message**

Use:

```js
"the stable direct landing becomes eligible after 8 hours"
```

- [ ] **Step 3: Run the patrol test**

Run:

```bash
node scripts/worktree-lifecycle-patrol.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit the integration test**

Run:

```bash
git add scripts/worktree-lifecycle-patrol.test.mjs
git commit -S -m "test(worktrees): use eight-hour landing cooldown"
```

### Task 4: Align the binding curation policy

**Files:**
- Modify: `.agents/skills/branch-curator/SKILL.md`
- Modify: `.agents/skills/branch-curator/references/deletion-proof.md`
- Modify: `.agents/skills/branch-curator/evals/evals.json`
- Modify: `docs/superpowers/specs/2026-07-31-automatic-local-branch-retirement-design.md`
- Modify: `docs/workflows/beads-familiars.md`

- [ ] **Step 1: Update the curator rule**

In `SKILL.md`, change the unconditional live signal to:

```md
- Its tip or reflog changed in the last 8 hours. Recency is unconditional;
```

- [ ] **Step 2: Update the normative deletion proof**

Change the required disposition to “older than 8 hours” and change:

```bash
recency_cutoff_epoch=$((now_epoch - 86400))
```

to:

```bash
recency_cutoff_epoch=$((now_epoch - 28800))
```

- [ ] **Step 3: Update the evaluation fixture**

Change evaluation 14 to ask about the last 8 hours and require a numeric
8-hour cutoff.

- [ ] **Step 4: Update current design documentation**

Search the automatic-retirement design for retirement-specific 24-hour wording:

```bash
rg -n "24 hours|24-hour|86400" \
  docs/superpowers/specs/2026-07-31-automatic-local-branch-retirement-design.md
```

Replace only retirement-recency references with 8-hour wording. Do not change
maintenance-gate lease limits or unrelated durations.

- [ ] **Step 5: Align the familiar workflow cooldown lane**

In `docs/workflows/beads-familiars.md`, change only the lifecycle `cooldown`
lane's retirement-recency statement from a mandatory 24-hour window to a
mandatory 8-hour window. Preserve all maintenance/deletion gates and unrelated
durations.

- [ ] **Step 6: Verify no stale retirement policy remains**

Run:

```bash
rg -n "last 24 hours|older than 24 hours|24-hour cooldown|24-hour recency window|now_epoch - 86400|numeric 24-hour cutoff" \
  .agents/skills/branch-curator \
  src/lib/worktree-lifecycle.ts \
  src/lib/worktree-lifecycle.test.ts \
  scripts/worktree-lifecycle-patrol.test.mjs \
  docs/superpowers/specs/2026-07-31-automatic-local-branch-retirement-design.md \
  docs/workflows/beads-familiars.md
```

Expected: no matches.

- [ ] **Step 7: Commit policy alignment**

Run:

```bash
git add \
  .agents/skills/branch-curator/SKILL.md \
  .agents/skills/branch-curator/references/deletion-proof.md \
  .agents/skills/branch-curator/evals/evals.json \
  docs/superpowers/specs/2026-07-31-automatic-local-branch-retirement-design.md \
  docs/workflows/beads-familiars.md
git commit -S -m "docs(worktrees): require eight-hour retirement recency"
```

### Task 5: Verify and publish

**Files:**
- Verify all files listed above
- Include: `docs/superpowers/specs/2026-08-01-eight-hour-worktree-retirement-design.md`
- Include: `docs/superpowers/plans/2026-08-01-eight-hour-worktree-retirement.md`

- [ ] **Step 1: Run targeted verification**

Run:

```bash
node --experimental-strip-types src/lib/worktree-lifecycle.test.ts
node scripts/worktree-lifecycle-patrol.test.mjs
pnpm typecheck
pnpm check:tests-wired
git diff --check origin/main...HEAD
```

Expected: all commands exit 0.

- [ ] **Step 2: Review the final diff**

Run:

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
```

Expected: only retirement cooldown runtime, tests, binding policy, evaluation,
current design, and the approved spec/plan are changed.

- [ ] **Step 3: Record verification in Beads**

Run:

```bash
bd update cave-m1qd0 --notes "Branch fix/retirement-cooldown-8h; verification: lifecycle unit, patrol integration, typecheck, test wiring, and diff check passed."
```

- [ ] **Step 4: Push and open the PR**

Run:

```bash
git push -u origin fix/retirement-cooldown-8h
gh pr create \
  --base main \
  --head fix/retirement-cooldown-8h \
  --title "fix(worktrees): use an eight-hour retirement cooldown" \
  --body "Changes only branch/worktree retirement recency from 24 hours to a mandatory 8 hours. Keeps the repository-wide maintenance gate, deletion proof, and unrelated 24-hour policies unchanged."
```

- [ ] **Step 5: Merge through protected main**

Read all review comments, fix any valid findings, wait for all nine required
checks, then squash-merge the exact checked head. Close `cave-m1qd0` only after
the merge is confirmed on `origin/main`.
