# Shell Left Panels Pixel Widths — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the app shell's left nav and list panels from percentage widths (which balloon on wide monitors) to pixel widths matching the declared `--shell-nav-width`/`--shell-list-width` intents, so the main content gets the reclaimed width.

**Architecture:** Three-line prop change on the two `<Panel>`s in `src/components/shell.tsx` (react-resizable-panels v4 supports px units natively — same pattern as the `right-sidebar` panel in `chat-surface.tsx:474`), plus a persisted-layout key bump (`cave.shell.widths.v1` → `v2`) so stale percent layouts don't override the new defaults. A source-text test pins the new props, modeled on `right-sidebar-fit.test.ts`.

**Tech Stack:** Next.js app, react-resizable-panels 4.12.0, node source-text tests run via `scripts/run-tests.mjs`.

**Spec:** `docs/specs/2026-07-03-shell-left-panels-px-widths-design.md`

**Where to work:** worktree `.worktrees/shell-left-panels-px-widths`, branch `shell-left-panels-px-widths`. ⚠️ Use ONLY paths under the worktree for every Edit/Write — absolute paths into the primary checkout (`/Users/buns/Documents/GitHub/OpenCoven/coven-cave/src/...`) silently land edits in the primary tree, and 7 other Claude sessions are live on this machine. ⚠️ Every commit must be signed: `git commit -S`.

---

## File structure

- **Modify** `src/components/shell.tsx` — the only behavior change: nav/list `<Panel>` size props + `SHELL_GROUP_ID` bump. (Line numbers below are as of `5f93cde8`.)
- **Modify** `src/app/globals.css` — comment-only: mark the `--shell-nav-width`/`--shell-list-width` vars as mirrors of the panel props.
- **Create** `src/components/shell-left-panels-fit.test.ts` — source-text test pinning the px props, the v2 key, the rail collapse, and the CSS-var sync.
- **Modify** `scripts/run-tests.mjs` — one line wiring the new test into `SUITES.app`.

---

### Task 0: Prepare the worktree

- [ ] **Step 1: Install dependencies** (fresh worktree has no `node_modules`)

Run (from `.worktrees/shell-left-panels-px-widths`):
```bash
pnpm install
```
Expected: completes in ~10s (pnpm CAS store), no errors.

- [ ] **Step 2: Confirm you are on the right branch**

Run:
```bash
git branch --show-current && git log -1 --format='%h %s'
```
Expected: `shell-left-panels-px-widths` and the spec commit `361efee7 docs(specs): shell left panels px-widths design`. If the branch differs, STOP — another session may have hijacked the worktree HEAD (this has happened before; see `docs/multi-session-coordination.md`).

---

### Task 1: Failing source-text test

**Files:**
- Create: `src/components/shell-left-panels-fit.test.ts`
- Modify: `scripts/run-tests.mjs` (SUITES.app list, next to `shell-edge-rails.test.ts` at ~line 189)

- [ ] **Step 1: Write the test**

Create `src/components/shell-left-panels-fit.test.ts` with exactly:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

// The left panels are PIXEL-sized so they stop scaling with monitor width —
// a 24%-wide nav is 826px on a 3440px ultrawide for a ~240px rail of labels.
// The detail panel has no size props and absorbs everything the left releases.
assert.match(
  shell,
  /id="nav"[\s\S]{0,200}?defaultSize="240px"[\s\S]{0,60}?minSize="200px"[\s\S]{0,60}?maxSize="420px"/,
  "Shell nav panel should default to 240px, drag-resizable within a 200–420px band",
);

assert.match(
  shell,
  /id="list"[\s\S]{0,200}?defaultSize="260px"[\s\S]{0,60}?minSize="220px"[\s\S]{0,60}?maxSize="420px"/,
  "Shell list panel should default to 260px, drag-resizable within a 220–420px band",
);

// Percent layouts saved under v1 predate the px constraints; the key bump
// resets everyone to the new compact defaults exactly once.
assert.match(
  shell,
  /const SHELL_GROUP_ID = "cave\.shell\.widths\.v2"/,
  "Shell layout persistence should use the v2 key (v1 holds stale percent layouts)",
);

// Collapse-to-rail must survive the px conversion.
assert.match(
  shell,
  /collapsedSize=\{isMobile \? 0 : NAV_RAIL_PX\}/,
  "Nav should still collapse to the icons-only rail on desktop (0 on mobile)",
);

// The CSS vars mirror the panel props (React props can't read CSS vars) —
// if one side changes, this keeps the other honest.
assert.match(globals, /--shell-nav-width:\s*240px/, "--shell-nav-width should match the nav panel default");
assert.match(globals, /--shell-list-width:\s*260px/, "--shell-list-width should match the list panel default");

console.log("shell-left-panels-fit.test.ts OK");
```

- [ ] **Step 2: Wire it into the app suite**

In `scripts/run-tests.mjs`, inside the `SUITES.app` array (4-space-indented entries), add one line directly after `"src/components/shell-edge-rails.test.ts",` (~line 189):

```js
    "src/components/shell-left-panels-fit.test.ts",
```

⚠️ Do NOT add it to the `ALIAS_LOADER` Set (~line 742) — that's only for tests importing `@/` aliases; this test uses relative `readFile` URLs. Known failure mode: an entry indented 2 spaces substring-matches the `ALIAS_LOADER` anchor during rebases and the test silently runs loaderless in the wrong list — keep the 4-space indent inside `SUITES.app`.

- [ ] **Step 3: Run the test — expect FAIL**

Run:
```bash
node --experimental-strip-types src/components/shell-left-panels-fit.test.ts
```
Expected: `AssertionError` on the FIRST assertion ("Shell nav panel should default to 240px…") because `shell.tsx` still has `defaultSize="24%"`.

---

### Task 2: Implement the shell changes

**Files:**
- Modify: `src/components/shell.tsx:35` (key bump), `:447-449` (nav), `:476-478` (list)
- Modify: `src/app/globals.css:109-111` (comment only)

- [ ] **Step 1: Bump the persisted-layout key**

In `src/components/shell.tsx`, replace:
```ts
const SHELL_GROUP_ID = "cave.shell.widths.v1";
```
with:
```ts
// v2: panels went percent → pixel (see shell-left-panels-fit.test.ts); v1
// layouts hold percent widths chosen under the old monitor-scaled defaults.
const SHELL_GROUP_ID = "cave.shell.widths.v2";
```
(The `.two-pane` variant at line 296 derives from this constant — one bump covers both. The `shellStorage.getItem` corrupt-layout guard needs no change: v4 still persists percent maps.)

- [ ] **Step 2: Pixel-size the nav panel**

In the nav `<Panel id="nav" …>` (~line 447), replace:
```tsx
        defaultSize="24%"
        minSize="14%"
        maxSize="28%"
```
with:
```tsx
        defaultSize="240px"
        minSize="200px"
        maxSize="420px"
```

- [ ] **Step 3: Pixel-size the list panel**

In the list `<Panel id="list" …>` (~line 476), replace:
```tsx
            defaultSize="18%"
            minSize="15%"
            maxSize="33%"
```
with:
```tsx
            defaultSize="260px"
            minSize="220px"
            maxSize="420px"
```

- [ ] **Step 4: Mark the CSS vars as mirrors**

In `src/app/globals.css`, replace:
```css
  /* ---- Shell pane widths ---- */
  --shell-nav-width: 240px;
  --shell-list-width: 260px;
```
with:
```css
  /* ---- Shell pane widths ----
     Mirrors of the nav/list Panel px props in components/shell.tsx (the
     authoritative values — React props can't read CSS vars). Kept in sync
     by shell-left-panels-fit.test.ts. */
  --shell-nav-width: 240px;
  --shell-list-width: 260px;
```

- [ ] **Step 5: Run the new test — expect PASS**

Run:
```bash
node --experimental-strip-types src/components/shell-left-panels-fit.test.ts
```
Expected: `shell-left-panels-fit.test.ts OK`

- [ ] **Step 6: Commit (signed)**

```bash
git add src/components/shell.tsx src/app/globals.css src/components/shell-left-panels-fit.test.ts scripts/run-tests.mjs
git commit -S -m "$(cat <<'EOF'
feat(shell): pixel-size the left nav/list panels for full-width content

The nav panel sized by percentage (24% default) so it ballooned on wide
monitors — 826px on a 3440px ultrawide for a ~240px rail. Both left
panels now use the pixel widths globals.css already declared
(nav 240px, clamp 200-420; list 260px, clamp 220-420); the detail panel
absorbs the reclaimed width. Layout key bumped to v2 so stale percent
layouts reset once. Rail collapse, hover-peek, shortcuts unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature --format='%h %s' | head -3
```
Expected: commit output shows `[shell-left-panels-px-widths …]` (verify the branch name in the brackets — wrong branch means another session moved HEAD) and `Good "git" signature`.

---

### Task 3: Local gates (mirrors the `Frontend build` required check)

- [ ] **Step 1: Typecheck**

```bash
pnpm typecheck
```
Expected: exits 0, no output errors.

- [ ] **Step 2: Tests-wired guard**

```bash
pnpm check:tests-wired
```
Expected: exits 0 (confirms the new test file is listed in a suite).

- [ ] **Step 3: App test suite**

```bash
pnpm test:app
```
Expected: ends with `✓ N test file(s) passed [app]` — the new file plus all existing shell tests (`shell-drawer-smoke`, `mobile-shell-smoke`, `sidepanel-nav-peek` pin CSS/drawer behavior only and must pass unchanged).

- [ ] **Step 4: Production build**

```bash
pnpm build
```
Expected: `next build` completes without errors (~1-2 min). This is part of the `Frontend build` required check, so catching a failure locally is cheaper.

---

### Task 4: Visual verification (run-cave-app)

Use the `run-cave-app` skill from the worktree (demo mode, no daemon). Verify at two viewport widths:

- [ ] **Step 1: Wide viewport (2560×1440)**
  - Nav panel renders ≈240px wide (measure `.shell-nav-panel` bounding box; was ~614px at 24%).
  - The `.shell-detail` main content fills the remainder — no dead gap between nav and content.
  - Drag the nav separator: it stops at 200px (min) and 420px (max).
  - ⌘B (or the top-bar toggle) collapses the nav to the 56px icon rail; hover shows the peek overlay; ⌘B re-expands.

- [ ] **Step 2: Narrow desktop viewport (1000×800)**
  - Shell renders sanely: nav 240px, content usable, no overflow or 0-width detail. (RRP v4 clamp behavior on narrow groups is the one open verification item from the spec — if the group over-constrains, the fallback lever is lowering `minSize` values.)
  - On a 3-pane surface (one with a list pane), confirm nav + list + detail all render.

- [ ] **Step 3: Fresh-profile check** — in a new browser context (empty localStorage), confirm the defaults apply (nav 240px) and that dragging then reloading persists the dragged width (now under `cave.shell.widths.v2`).

If anything fails here, fix before pushing; screenshot evidence goes in the PR body.

---

### Task 5: Push, PR, merge

- [ ] **Step 1: Pre-push signature sanity check**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```
Expected: no output. If anything prints, sign those commits before pushing.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin shell-left-panels-px-widths
gh pr create --base main --head shell-left-panels-px-widths \
  --title "feat(shell): pixel-size the left nav/list panels for full-width content usage" \
  --body "$(cat <<'EOF'
The shell's left nav panel sized by percentage of the window (default 24%, min 14%, max 28%), so it ballooned on wide monitors — 461px at 1920px, 826px on a 3440px ultrawide — for a rail that needs ~240px. The list pane likewise (18%/15%/33%).

Both left panels now use pixel widths, which `globals.css` already declared as the intent (`--shell-nav-width: 240px`, `--shell-list-width: 260px`) and which react-resizable-panels v4 supports natively (same pattern as the chat surface's `right-sidebar` panel):

- Nav: `240px` default, drag-clamped 200–420px (was 24% / 14–28%)
- List: `260px` default, drag-clamped 220–420px (was 18% / 15–33%)
- Persisted-layout key bumped `cave.shell.widths.v1` → `v2` so saved percent layouts from the old constraints reset once; drags re-persist under v2
- Unchanged: 56px rail collapse, hover-peek, ⌘B/⌘\ shortcuts, mobile drawers, the corrupt-layout storage guard
- New source-text test `shell-left-panels-fit.test.ts` pins the props, the v2 key, the rail collapse, and the CSS-var sync

Design: docs/specs/2026-07-03-shell-left-panels-px-widths-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for ALL SIX required checks**

Required: `Frontend build`, `Rust check`, `CodeQL`, `E2E (Playwright)`, `Cross-environment required`, `Sidecar runtime required`. The last two aggregates report LATE — poll until all six are green, not just the first four:

```bash
gh pr checks <PR#> --watch
gh pr checks <PR#> --required   # re-confirm: watch can exit 0 early
```

- [ ] **Step 4: Merge — and only merge**

```bash
gh pr merge <PR#> --squash --delete-branch
gh pr view <PR#> --json state --jq .state
```
Expected: `MERGED`. ⚠️ Do NOT chain branch-deletion cleanup onto the merge command — if the merge is rejected (a late aggregate check), a chained branch delete closes the PR and orphans the work. Verify `state == MERGED` BEFORE any cleanup.

- [ ] **Step 5: Local cleanup (only after MERGED is confirmed)**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git worktree remove .worktrees/shell-left-panels-px-widths
git branch -D shell-left-panels-px-widths
git worktree list
```

---

## Self-review notes

- Spec coverage: panel props (Task 2 steps 2-3), key bump + `.two-pane` variant (step 1), CSS var alignment (step 4), source-text test + wiring (Task 1), narrow-window and fresh-profile verification (Task 4), rollout (Task 5). The spec's "verify RRP v4 degrades sanely on narrow groups" item is Task 4 step 2.
- The test's bounded lazy quantifiers (`[\s\S]{0,200}?`) keep each match inside its own `<Panel>` block — `id="nav"` cannot skip ahead and match the list panel's props.
- No placeholders; every step has exact code, commands, and expected output.
