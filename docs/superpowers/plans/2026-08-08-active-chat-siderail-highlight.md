# Active Chat Siderail Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight the full horizontal row of the active chat in every expanded Chats siderail view without reducing the session content width.

**Architecture:** The live `WorkspaceSidebar` already routes Recent, search, project-folder, and pinned chats through `.cnav__thread.is-active`. A CSS pseudo-element extends the active background through the `.cnav__scroll` gutter while the existing row box, padding, controls, accent bar, attention cues, focus behavior, and accessibility state remain unchanged.

**Tech Stack:** React, TypeScript, Tailwind utility classes, tokenized CSS, Node assertion tests

---

### Task 1: Extend the live active-row backdrop through the siderail gutters

**Files:**
- Modify: `src/styles/globals/shell-navigation.css:690-719`
- Test: `src/components/workspace-sidebar-attention.test.ts:172-193`

- [x] **Step 1: Write the failing source-contract test**

Add assertions proving the shared active-row selector owns a full-width backdrop,
retains the separate accent marker, and carries semantic attention fills:

```ts
assert.match(
  css,
  /\.cnav__thread\.is-active::after\s*\{[\s\S]*?inset-inline:\s*calc\(var\(--rail-pad\) \* -1\);[\s\S]*?background:\s*var\(--cnav-active-background\);/,
  "the active backdrop should span through both siderail gutters",
);
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm exec vitest run src/components/workspace-sidebar-attention.test.ts
```

Expected: FAIL because `--cnav-active-background` and the active `::after`
backdrop do not exist.

- [x] **Step 3: Implement the gutter-spanning backdrop**

Define the active background variable on the shared selector, override it for
attention states, and render it through a layout-neutral pseudo-element:

```css
.cnav__thread.is-active {
  --cnav-active-background: var(--bg-raised);
  isolation: isolate;
}

.cnav__thread.is-active::after {
  content: "";
  position: absolute;
  z-index: -1;
  inset-block: 0;
  inset-inline: calc(var(--rail-pad) * -1);
  background: var(--cnav-active-background);
  pointer-events: none;
}
```

The negative inline inset consumes only the rail's existing `--rail-pad` gutter;
it does not alter the row's width or content layout.

- [x] **Step 4: Run focused verification**

Run:

```bash
pnpm exec vitest run src/components/workspace-sidebar-attention.test.ts
pnpm typecheck
pnpm build
```

Expected: the focused suite passes, typecheck exits successfully, and the
production build stays within its budgets.

- [x] **Step 5: Verify live geometry and review without committing**

Drive the real Chats siderail and measure `.cnav__thread.is-active::after` in
Recent, search, Projects, and Pinned. Its left/right edges must equal the
`.cnav__scroll` edges, and the row width must match its pre-activation width.
Then run:

```bash
git diff --check
git status --short
git diff -- src/styles/globals/shell-navigation.css src/components/workspace-sidebar-attention.test.ts
```

Expected: only the approved active-row implementation, regression test, and
approved design/plan documentation are changed. Leave the branch uncommitted
until Val explicitly authorizes a commit.
