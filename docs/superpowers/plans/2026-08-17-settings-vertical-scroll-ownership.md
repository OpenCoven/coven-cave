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

Add this assertion after the existing embedded-mode assertions:

```ts
assert.match(
  shellSource,
  /className=\{`settings-shell\$\{embedded \? " settings-shell--embedded h-full" : " h-\[100dvh\]"\} w-full flex flex-col overflow-hidden bg-\[var\(--bg-base\)\] text-\[var\(--text-primary\)\]`\}/,
  "Settings root establishes the viewport-bounded flex column that contains the scroll owner",
);
assert.match(
  shellSource,
  /<div className="flex min-h-0 flex-1 flex-col md:flex-row">[\s\S]{0,7000}<main[\s\S]{0,240}className="settings-shell__content min-h-0 flex-1 overflow-y-auto/,
  "Settings bounds its body and gives vertical scrolling only to the content main",
);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/settings-shell-polish.test.ts
```

Expected: FAIL at `Settings root establishes the viewport-bounded flex column` because the root class is missing `flex`.

- [ ] **Step 3: Write the minimal implementation**

In the root `div` in `src/components/settings-shell.tsx`, add `flex` immediately before `flex-col`:

```tsx
className={`settings-shell${embedded ? " settings-shell--embedded h-full" : " h-[100dvh]"} w-full flex flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]`}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/settings-shell-polish.test.ts
```

Expected: `settings-shell-polish.test.ts OK`.

- [ ] **Step 5: Run proportional verification**

Run:

```bash
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all commands exit 0. The test contract applies to both `embedded` and standalone root class branches, so no separate behavior branch can regress the scroll boundary.

- [ ] **Step 6: Record completion evidence and commit when authorized**

Update Bead `cave-e5991` with the focused test and quality-gate results. Do not commit or push without explicit authorization under the repository’s conservative workflow.
