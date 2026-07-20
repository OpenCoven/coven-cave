# New Reminder Modal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-port the approved compact New Reminder modal redesign onto current `main` without carrying stale branch history or raw pixel typography.

**Architecture:** Keep `NewReminderModal` as the existing orchestration component and preserve its create/edit data contracts. Add the approved phrase examples, Advanced details disclosure, and plan summary in place; update source-contract tests to pin accessibility, state transitions, responsive containment, and link placement.

**Tech Stack:** React, TypeScript, Next.js, Node test runner, Tailwind-style design tokens, pnpm.

---

### Task 1: Port the reminder redesign contracts

**Files:**
- Modify: `src/components/new-reminder-modal.test.ts`
- Modify: `src/components/reminder-link-field.test.ts`

- [ ] **Step 1: Port the failing source contracts**

Copy only the assertions introduced by commit `8a37eba93` that require:

```ts
const WHEN_EXAMPLES = [
  "in 30m",
  "tomorrow at 9am",
  "every tuesday 4pm",
  "jul 20",
] as const;
```

The tests must also require:

```ts
const [detailsOpen, setDetailsOpen] = useState(false);
aria-expanded={detailsOpen}
aria-controls="new-reminder-details"
id="new-reminder-details"
data-reminder-plan="true"
id="new-reminder-plan-summary"
```

Keep the existing balanced-block helpers from the stale commit so mapped buttons and the disclosure trigger are checked within bounded JSX regions.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/new-reminder-modal.test.ts \
  src/components/reminder-link-field.test.ts
```

Expected: FAIL because `WHEN_EXAMPLES`, `detailsOpen`, and the new plan identifiers do not exist on current `main`.

- [ ] **Step 3: Commit the red tests**

```bash
git add src/components/new-reminder-modal.test.ts src/components/reminder-link-field.test.ts
git commit -S -m "test(reminders): pin compact modal redesign" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

### Task 2: Implement the compact modal

**Files:**
- Modify: `src/components/new-reminder-modal.tsx`

- [ ] **Step 1: Add phrase examples and selection state**

Add the `WHEN_EXAMPLES` constant and a `selectWhenExample` handler that performs exactly:

```ts
const selectWhenExample = (example: WhenExample) => {
  setWhenText(example);
  setManualFireAt("");
  setWhenDirty(true);
  setError(null);
};
```

Render each example with the existing `Button` component and `key={example}`.

- [ ] **Step 2: Add the Advanced details disclosure**

Add:

```ts
const [detailsOpen, setDetailsOpen] = useState(false);
```

Reset it to `false` for a new reminder. In edit mode, set it with:

```ts
setDetailsOpen(mapped.preset !== "none" || editing.link != null);
```

The trigger must expose `aria-expanded`, target `new-reminder-details`, and toggle the boolean. Place recurrence and link controls inside the conditional region.

- [ ] **Step 3: Add the compact plan summary**

Keep `describeRecurrence` and `nextOccurrences` as the data sources. Render a live region with:

```tsx
id="new-reminder-plan-summary"
data-reminder-plan="true"
aria-live="polite"
```

Show a concise once/repeat label, the parsed phrase or cadence, and up to three upcoming occurrences.

- [ ] **Step 4: Port the approved layout using design tokens**

Follow commit `8a37eba93` for layout and responsive containment, but replace every raw text class:

```text
text-[11px] -> text-[length:var(--text-xs)]
text-[12px] or text-[13px] -> text-[length:var(--text-sm)]
text-[14px] or text-[15px] -> text-[length:var(--text-base)]
text-[19px] -> text-[length:var(--text-xl)]
```

Reuse existing border, radius, color, focus-ring, and button utilities. Do not modify persistence or recurrence helpers.

- [ ] **Step 5: Run the focused tests and design codemod**

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/new-reminder-modal.test.ts \
  src/components/reminder-link-field.test.ts
node scripts/codemods/tokenize-tsx-design.mjs
pnpm lint
pnpm typecheck
```

Expected: both tests pass, codemod reports no remaining drift after rewrites, lint exits 0, and TypeScript exits 0.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/components/new-reminder-modal.tsx \
  src/components/new-reminder-modal.test.ts \
  src/components/reminder-link-field.test.ts
git commit -S -m "feat(reminders): redesign new reminder modal" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push
```

### Task 3: Review, merge, and remove stale branches

**Files:**
- Verify: `docs/superpowers/specs/2026-07-19-new-reminder-design.md`
- Verify: `docs/superpowers/plans/2026-07-19-new-reminder-design.md`

- [ ] **Step 1: Run final branch checks**

```bash
pnpm test:app
pnpm lint
pnpm typecheck
git diff --check origin/main...HEAD
```

Expected: all commands exit 0.

- [ ] **Step 2: Open and review the focused PR**

```bash
gh pr create \
  --base main \
  --head feat/new-reminder-design-v2 \
  --title "feat(reminders): redesign new reminder modal" \
  --body "Focused re-port of the approved compact New Reminder design with phrase examples, accessible Advanced details, plan preview, and token-compliant typography."
```

Run a read-only code review against `origin/main`, resolve all conversations, and wait for every required check.

- [ ] **Step 3: Squash-merge and clean branches**

```bash
gh pr merge --squash --delete-branch
git worktree remove .worktrees/feat-new-reminder-design-v2
git branch -D feat/new-reminder-design-v2
git push origin --delete feat/new-reminder-design
git branch -D feat/new-reminder-design
```

Expected: the focused PR is merged, both reminder branches are deleted, and no reminder worktree remains.
