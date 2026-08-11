# Tasks Multi-Familiar Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the Tasks page's Familiar grouping option only when the shell scope contains more than one selected familiar.

**Architecture:** `BoardView` already receives `scopeFamiliarIds`, so derive one local `showFamiliarGrouping` boolean from that set and reuse it for the Kanban/Table control, Gantt control, and persisted-preference fallbacks. Keep filtering and task assignment unchanged.

**Tech Stack:** React, TypeScript, Node source-contract tests, pnpm

---

### Task 1: Pin multi-familiar grouping visibility

**Files:**
- Test: `src/components/board-view-familiar-scope.test.ts`

- [ ] **Step 1: Replace the single-familiar fallback pin and add visibility pins**

Add these assertions after the existing multiselect filtering assertion:

```ts
assert.match(
  source,
  /const showFamiliarGrouping = \(scopeFamiliarIds\?\.size \?\? 0\) > 1;/,
  "BoardView exposes familiar grouping only for a true multi-familiar scope",
);

assert.equal(
  (source.match(/\{showFamiliarGrouping \? \(/g) ?? []).length,
  2,
  "Kanban/Table and Gantt both gate their Familiar grouping control on multi-selection",
);
```

Replace the existing `effectiveGroupBy` assertion with:

```ts
assert.match(
  source,
  /const effectiveGroupBy: GroupBy = !showFamiliarGrouping && groupBy === "familiar" \? "status" : groupBy;/,
  "Tasks falls back to status when a saved Familiar grouping is unavailable",
);

assert.match(
  source,
  /const effectiveGanttGroup = ganttGroup === "familiar" && !showFamiliarGrouping \? "project" : ganttGroup;/,
  "Gantt falls back to project when a saved Familiar grouping is unavailable",
);
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/board-view-familiar-scope.test.ts
```

Expected: FAIL because `showFamiliarGrouping` does not exist yet.

### Task 2: Gate Familiar grouping on the selected set

**Files:**
- Modify: `src/components/board-view.tsx:402-410`
- Modify: `src/components/board-view.tsx:1060-1090`
- Test: `src/components/board-view-familiar-scope.test.ts`

- [ ] **Step 1: Derive the shared visibility condition and update fallbacks**

Replace the current familiar-grouping comment and derived values with:

```ts
// The shell already owns familiar scope. Re-expose Familiar grouping only
// when the selected set contains multiple familiars and grouping that union
// adds information; hide it for All and single-familiar scopes.
const showFamiliarGrouping = (scopeFamiliarIds?.size ?? 0) > 1;
const effectiveGroupBy: GroupBy = !showFamiliarGrouping && groupBy === "familiar" ? "status" : groupBy;
const effectiveGanttGroup = ganttGroup === "familiar" && !showFamiliarGrouping ? "project" : ganttGroup;
```

- [ ] **Step 2: Gate both Familiar controls**

In the Gantt grouping control and the Kanban/Table grouping control, replace:

```tsx
{activeFamiliarId === null ? (
```

with:

```tsx
{showFamiliarGrouping ? (
```

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/board-view-familiar-scope.test.ts
```

Expected: `board-view-familiar-scope.test.ts: ok`

### Task 3: Verify and hand off

**Files:**
- Verify: `src/components/board-view.tsx`
- Verify: `src/components/board-view-familiar-scope.test.ts`
- Update tracker: Bead `cave-znoi1`

- [ ] **Step 1: Run type and design checks**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: both commands exit 0.

- [ ] **Step 2: Run the full app suite**

Run:

```bash
pnpm test:app
```

Expected: all app test files pass.

- [ ] **Step 3: Inspect the final scope**

Run:

```bash
git diff --check
git diff -- src/components/board-view.tsx src/components/board-view-familiar-scope.test.ts
git status --short
```

Expected: no whitespace errors; only the two scoped implementation files plus
the pre-existing unrelated work and Beads interaction log are modified.

- [ ] **Step 4: Record verification without closing prematurely**

Update `cave-znoi1` with the branch/worktree, session, familiar owner, changed
files, and exact verification results. Leave it `in_progress` because this
repository closes implementation beads only after merge or explicit completion
criteria.

- [ ] **Step 5: Stop before commit or push**

The active conservative profile does not authorize commit or push. Report the
verified diff and wait for explicit authority.
