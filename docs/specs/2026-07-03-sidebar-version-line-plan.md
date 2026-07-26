# Sidebar version line — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `v{APP_VERSION}` as the bottommost, minimal-height element of the default left sidebar.

**Architecture:** One JSX line in `sidebar-minimal.tsx` (last child of the nav, below `.sidebar-foot`), one CSS block + one rail-hide rule in `sidebar-minimal.css`, assertions appended to the existing `sidebar-minimal.test.ts`. Version comes from the existing `src/lib/app-version.ts`.

**Tech Stack:** Next.js client component, plain CSS, node source-text tests.

**Spec:** `docs/specs/2026-07-03-sidebar-version-line-design.md`
**Where to work:** worktree `.worktrees/sidebar-version-line`, branch `sidebar-version-line`. Worktree-relative paths only; every commit signed (`-S`) and pushed immediately after committing.

---

### Task 1: Failing assertions (TDD)

**Files:** Modify: `src/components/sidebar-minimal.test.ts` (append before the final `console.log`)

- [ ] **Step 1:** Append:

```ts
// The app version renders as the bottommost sidebar element — one
// minimal-height muted line under the footer icon row, hidden in the rail.
assert.match(
  source,
  /import \{ APP_VERSION \} from "@\/lib\/app-version"/,
  "SidebarMinimal should read the version from the shared app-version module",
);
assert.match(
  source,
  /className="sidebar-version"[\s\S]{0,120}?v\{APP_VERSION\}[\s\S]{0,40}?<\/div>\s*<\/nav>/,
  "The version line should be the bottommost element of the sidebar nav",
);
assert.match(
  styles,
  /\.sidebar-version \{[^}]*line-height: 1;[^}]*color: var\(--text-muted\)/,
  "The version line should be minimal-height muted text",
);
assert.match(
  styles,
  /\.shell-nav--rail \.sidebar-version \{[^}]*display: none/,
  "The 56px rail has no room for text — the version line hides there",
);
```

- [ ] **Step 2:** `node --experimental-strip-types src/components/sidebar-minimal.test.ts` → expect FAIL on the APP_VERSION import assertion.

### Task 2: Implement

**Files:** Modify: `src/components/sidebar-minimal.tsx` (import block + after `.sidebar-foot`'s closing `</div>` at ~line 404), `src/styles/sidebar-minimal.css` (after the `.sidebar-foot-bell,.sidebar-foot-btn` region; rail rule next to the other `.shell-nav--rail .sidebar-foot` rules ~1055)

- [ ] **Step 1:** In `sidebar-minimal.tsx`, add to the imports:

```ts
import { APP_VERSION } from "@/lib/app-version";
```

- [ ] **Step 2:** Insert between the footer's closing `</div>` and `</nav>`:

```tsx
      {/* Bottommost: app version — one minimal-height muted line. */}
      <div className="sidebar-version" title={`CovenCave v${APP_VERSION}`}>
        v{APP_VERSION}
      </div>
```

- [ ] **Step 3:** In `sidebar-minimal.css`, after the `.sidebar-foot` button styles:

```css
/* Bottommost element: the app version. One minimal-height line — small,
   muted, unselectable; the footer above keeps its calm hairline boundary. */
.sidebar-version {
  flex-shrink: 0;
  padding: 3px 6px 4px;
  font-size: 10.5px;
  line-height: 1;
  text-align: center;
  color: var(--text-muted);
  user-select: none;
}
```

and with the rail rules:

```css
/* No room for text in the 56px rail — the version returns when expanded. */
.shell-nav--rail .sidebar-version {
  display: none;
}
```

- [ ] **Step 4:** Test → PASS. Commit signed, push.

### Task 3: Gates + visual verify

- [ ] `pnpm typecheck && pnpm check:tests-wired && pnpm test:app` (test file already wired — no run-tests.mjs change), then `pnpm build`.
- [ ] Serve the built app on a unique port; screenshot the sidebar bottom at 1440px (version line visible under the icon row, ≤18px tall) and in rail mode (hidden). Confirm the line is the bottommost element.

### Task 4: Ship

- [ ] Signature sanity check; `gh pr create`; watch ALL SIX required checks; `gh pr merge --squash` (expect the worktree `fatal: 'main' is already used` quirk — verify `state==MERGED`, then delete the remote branch manually); clean up worktree + local branch.
