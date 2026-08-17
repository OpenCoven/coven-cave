# Settings Vertical Scroll Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Settings content pane scroll vertically within its fixed viewport in standalone and embedded modes.

**Architecture:** `SettingsShell` already assigns `overflow-y-auto` to its content main and uses a shrinkable intermediate flex row. The root lacks `flex`, preventing its `flex-col` and descendant `flex-1` sizing contract from taking effect. Add that one utility and pin the complete three-level scroll boundary in the existing source-contract test.

**Tech Stack:** Next.js, React, TypeScript, Tailwind utility classes, Node `assert` source-contract tests.

---

### Task 1: Pin the Settings scroll boundary

**Files:**
- Modify: `src/components/settings-shell-polish.test.ts:709-726`
- Test: `src/components/settings-shell-polish.test.ts`

- [ ] **Step 1: Write the failing test**

Add a root class assertion for `w-full flex flex-col overflow-hidden`, plus a second assertion that requires the `min-h-0 flex-1` body and the `settings-shell__content min-h-0 flex-1 overflow-y-auto` main to appear in the same shell.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/settings-shell-polish.test.ts`. Expected: the root-flex assertion fails before implementation.

- [ ] **Step 3: Write the minimal implementation**

Add `flex` immediately before `flex-col` to the Settings root class in `src/components/settings-shell.tsx`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run `node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/settings-shell-polish.test.ts`. Expected: `settings-shell-polish.test.ts OK`.

- [ ] **Step 5: Run proportional verification**

Run `pnpm typecheck`, `pnpm lint`, `pnpm test:app`, and `git diff --check`.

- [ ] **Step 6: Record completion evidence and commit when authorized**

Update Bead `cave-e5991` with the focused test and quality-gate results. Do not commit or push without explicit authorization under the repository’s conservative workflow.
