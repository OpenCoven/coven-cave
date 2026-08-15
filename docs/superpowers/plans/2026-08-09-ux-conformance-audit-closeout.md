# UX Conformance Audit Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `cave-ui5z` using reproducible design-gate evidence instead of recreating a missing heuristic percentage scorecard.

**Architecture:** This is a tracker closeout, not a product feature. The authoritative sources are the committed design-token drift gate, design ESLint rules, and codemod no-op check; repository changes occur only if one of those gates fails.

**Tech Stack:** Beads CLI, Node test runner, ESLint, Cave design codemods.

---

### Task 0: Claim the audit after `cave-1vpy` is complete

- [ ] **Step 1: Claim the Bead**

```bash
bd update cave-ui5z --assignee ""
bd update cave-ui5z --claim
```

Expected: `cave-ui5z` becomes `in_progress` and is assigned to the current
actor. The explicit unassignment retires the stale `sage` assignment before
the atomic claim. Do not claim it while `cave-1vpy` is still active.

### Task 1: Confirm the original scorecard is unavailable

- [ ] **Step 1: Verify the referenced scorecard is absent**

```bash
test ! -e research/synthesis/cave-ux-heuristic-audit-2026-07-03.md
git log --all --oneline -- research/synthesis/cave-ux-heuristic-audit-2026-07-03.md
```

Expected: the file is absent and Git history prints no owning commit.

- [ ] **Step 2: Record why percentages are not reproducible**

```bash
bd comments add cave-ui5z \
  "The referenced research/synthesis/cave-ux-heuristic-audit-2026-07-03.md scorecard is absent from the checkout and has no Git history. The historical 70%→90% percentage cannot be reproduced honestly; closeout will use the live enforceable drift/lint contracts instead."
```

### Task 2: Run the authoritative live conformance gates

- [ ] **Step 1: Run the raw design-token scanner**

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  --test src/lib/design-token-drift.test.ts
```

Expected: PASS.

- [ ] **Step 2: Capture the enforced baselines**

```bash
sed -n '/const BASELINES = {/,/^};/p' src/lib/design-token-drift.test.ts
```

Expected enforced ceilings on the current base:

```text
offScaleFontSizePx: 139
offScaleSpacingPx: 1631
offScaleRadiusPx: 232
hexOutsideDefinitions: 0
inlineTsxStyles: 215
```

If the source values differ, record the source values rather than these
historical numbers.

- [ ] **Step 3: Run design lint and codemod checks**

```bash
pnpm lint
```

Expected: `codemod:design:check` and `lint:design` PASS with zero warnings.

- [ ] **Step 4: Run the complete app test suite**

```bash
pnpm test:app
```

Expected: PASS, including the wired design-token drift test.

### Task 3: Decide whether a code PR is necessary

- [ ] **Step 1: If every gate passed, record supersession evidence**

```bash
bd comments add cave-ui5z \
  "Closeout evidence: design-token-drift.test.ts passed; pnpm lint passed (TSX codemod no-op + design ESLint); pnpm test:app passed. Current enforced ceilings are font=139, spacing=1631, radius=232, render hex=0, inline TSX=215. The missing heuristic scorecard has been superseded by these executable, ratcheted contracts."
bd close cave-ui5z \
  --reason "Superseded by executable design-token drift, codemod, and ESLint gates; live conformance evidence recorded."
```

- [ ] **Step 2: If any gate failed, do not close**

Keep the Bead `in_progress`, add the exact failing command/output as a comment,
and create a narrowly scoped fix branch only for the failure. The fix must use
the normal protected PR path and the Bead closes only after that PR merges.

- [ ] **Step 3: Verify tracker state**

```bash
bd show cave-ui5z --json
```

Expected after the all-green path: status `closed`, with the evidence comment
and close reason present.
