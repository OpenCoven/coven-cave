# Roles Page Absorbs Plugins & Skills Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The workspace Roles page shows all four `PluginsView` tabs (roles · workflows · plugins · skills); Settings loses its Plugins section entirely.

**Architecture:** `PluginsView` already supports caller-selected tab sets — the change is tab composition at the workspace call site plus dead-code removal in `settings-shell.tsx`. No component internals, data, or API changes.

**Tech Stack:** Next.js / React / TypeScript. Tests are source-assertion files run with `node --experimental-strip-types <file>` (NOT `tsx --test` — it CJS-wraps and breaks top-level await). Typecheck: `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-06-11-roles-page-skills-plugins-design.md`

**Environment constraint:** Concurrent Claude sessions rewrite the primary checkout's working tree — uncommitted edits there get destroyed. ALL work happens in a dedicated worktree. Every commit uses `-S` (signed); verify with `git log -1 --show-signature` → expect `Good "git" signature`.

---

### Task 0: Worktree setup

**Files:** none (environment)

- [ ] **Step 1: Create the worktree and install deps**

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave fetch origin
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree add -b roles-page-skills-plugins .worktrees/roles-page-skills-plugins origin/main
pnpm --dir /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/roles-page-skills-plugins install
```

Expected: worktree at `.worktrees/roles-page-skills-plugins` on a fresh branch tracking `origin/main`; install completes in ~10s.

All subsequent paths are relative to the worktree root. Use `git -C <worktree>` / `pnpm --dir <worktree>` forms, not `cd`.

---

### Task 1: Update the navigation contract test (red)

**Files:**
- Modify: `src/components/roles-tools-navigation.test.ts`

The test currently locks in the old split (workspace = `["roles", "workflows"]`, settings = `["plugins", "skills"]`). Rewrite both assertions to the new contract.

- [ ] **Step 1: Replace the two tab assertions**

In `src/components/roles-tools-navigation.test.ts`, replace:

```ts
assert.match(
  workspace,
  /mode === "roles"[\s\S]*<PluginsView[\s\S]*tabs=\{\["roles", "workflows"\]\}/,
  "Workspace should render Roles and Workflows as a Tools surface",
);

assert.match(
  settings,
  /<PluginsView[\s\S]*tabs=\{\["plugins", "skills"\]\}/,
  "Settings Plugins should only expose marketplace plugins and skills",
);
```

with:

```ts
assert.match(
  workspace,
  /mode === "roles"[\s\S]*<PluginsView[\s\S]*tabs=\{\["roles", "workflows", "plugins", "skills"\]\}/,
  "The Roles surface should expose roles, workflows, plugins, and skills",
);

assert.doesNotMatch(
  settings,
  /PluginsView/,
  "Settings must not render PluginsView — plugins and skills live on the Roles page",
);

assert.doesNotMatch(
  settings,
  /"plugins"/,
  "Settings must not declare a plugins section",
);
```

Keep every other assertion in the file unchanged (the `settings` source variable stays — it is still read for the doesNotMatch checks).

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --experimental-strip-types src/components/roles-tools-navigation.test.ts
```

Expected: FAIL — first on "The Roles surface should expose roles, workflows, plugins, and skills" (workspace still passes two tabs).

- [ ] **Step 3: Commit the red test**

```bash
git add src/components/roles-tools-navigation.test.ts
git commit -S -m "test: roles surface owns plugins+skills tabs; settings drops PluginsView

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Workspace roles mode gets all four tabs

**Files:**
- Modify: `src/components/workspace.tsx` (roles-mode branch, around line 1038)

- [ ] **Step 1: Change the tabs prop**

In `src/components/workspace.tsx`, replace:

```tsx
    ) : mode === "roles" ? (
      <PluginsView
        tabs={["roles", "workflows"]}
        initialTab="roles"
```

with:

```tsx
    ) : mode === "roles" ? (
      <PluginsView
        tabs={["roles", "workflows", "plugins", "skills"]}
        initialTab="roles"
```

The rest of the props (`familiars={resolvedFamiliars}`, `onOpenChat`, `onCreateSkill`, `onCreatePlugin`) are already correct and unchanged.

- [ ] **Step 2: Run the contract test — workspace assertion now passes, settings assertions still fail**

```bash
node --experimental-strip-types src/components/roles-tools-navigation.test.ts
```

Expected: FAIL on "Settings must not render PluginsView" (settings-shell still has it). The workspace assertion no longer fails.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace.tsx
git commit -S -m "feat(roles): surface plugins and skills tabs on the Roles page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Remove the Plugins section from Settings

**Files:**
- Modify: `src/components/settings-shell.tsx`

- [ ] **Step 1: Remove the import (line 6)**

Delete:

```ts
import { PluginsView } from "@/components/plugins-view";
```

- [ ] **Step 2: Shrink the Section type and SECTIONS list (around line 38)**

Replace:

```ts
type Section = "general" | "daemon" | "familiars" | "addons" | "appearance" | "about" | "plugins";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general",    label: "General",    icon: "ph:sliders-horizontal" },
  { id: "daemon",     label: "Daemon",     icon: "ph:terminal-window" },
  { id: "familiars",  label: "Familiars",  icon: "ph:users-three" },
  { id: "addons",     label: "Add-ons",    icon: "ph:puzzle-piece" },
  { id: "plugins",    label: "Plugins",    icon: "ph:sparkle" },
  { id: "appearance", label: "Appearance", icon: "ph:paint-brush" },
  { id: "about",      label: "About",      icon: "ph:info" },
];
```

with:

```ts
type Section = "general" | "daemon" | "familiars" | "addons" | "appearance" | "about";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general",    label: "General",    icon: "ph:sliders-horizontal" },
  { id: "daemon",     label: "Daemon",     icon: "ph:terminal-window" },
  { id: "familiars",  label: "Familiars",  icon: "ph:users-three" },
  { id: "addons",     label: "Add-ons",    icon: "ph:puzzle-piece" },
  { id: "appearance", label: "Appearance", icon: "ph:paint-brush" },
  { id: "about",      label: "About",      icon: "ph:info" },
];
```

- [ ] **Step 3: Remove the render branch (around line 194)**

Delete the line:

```tsx
          {section === "plugins"  && <PluginsSection />}
```

- [ ] **Step 4: Delete the PluginsSection component (around lines 481-505)**

Delete the whole block from the `// ─── Section: Plugins ───` banner comment through the closing brace of `PluginsSection`:

```tsx
// ─── Section: Plugins ─────────────────────────────────────────────────────────

function PluginsSection() {
  // Settings doesn't yet have familiar context — familiars are stubbed as []
  // until a follow-up spec threads real familiars through SettingsShell.
  // onOpenChat navigates back to the workspace home where the user can start a
  // chat; the workspace's full startAgentChat binding is not available here.
  return (
    <PluginsView
      familiars={[]}
      tabs={["plugins", "skills"]}
      initialTab="plugins"
      onOpenChat={() => {
        // Navigate to workspace home; user can select a familiar and start a chat
        window.location.href = "/";
      }}
      onCreateSkill={() => {
        window.location.href = "/";
      }}
      onCreatePlugin={() => {
        window.location.href = "/";
      }}
    />
  );
}
```

- [ ] **Step 5: Update the two deep-link example comments (around lines 56 and 68)**

Replace `e.g. /settings#plugins` with `e.g. /settings#familiars` in the comment above `initialSection`, and `Hash-deep-link (`/settings#plugins`) skips the` with `Hash-deep-link (`/settings#familiars`) skips the` in the `pickerView` comment. (Stale `/settings#plugins` URLs fall through `initialSection()`'s existing unknown-hash fallback to `"general"` — no code change needed.)

- [ ] **Step 6: Run the contract test — all green**

```bash
node --experimental-strip-types src/components/roles-tools-navigation.test.ts
```

Expected: PASS (exit 0, no assertion output).

- [ ] **Step 7: Typecheck and sweep adjacent tests**

```bash
npm run typecheck
for t in src/components/settings-*.test.ts src/components/plugins-*.test.ts src/components/capabilities-*.test.ts src/components/workspace*.test.ts; do
  [ -f "$t" ] || continue
  printf "%-55s " "$(basename "$t")"
  node --experimental-strip-types "$t" >/dev/null 2>&1 && echo PASS || echo FAIL
done
```

Expected: typecheck silent; all listed tests PASS. If a settings test fails because it asserted the Plugins section existed, update that assertion to the new contract (Settings has six sections, no plugins) — do not delete the test file.

- [ ] **Step 8: Commit**

```bash
git add src/components/settings-shell.tsx
git commit -S -m "feat(settings): remove Plugins section — plugins and skills live on the Roles page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Runtime verification and PR

**Files:** none (verification + delivery)

- [ ] **Step 1: Runtime-verify against the dev server**

The user's dev server on `localhost:3000` serves the PRIMARY checkout, not this worktree — it cannot verify this branch. Two options, in preference order: (a) if the primary checkout has pulled the merged change later, drive it with the Playwright pattern from `/tmp/verify-home-chat/drive7.mjs` (auth via `?coven_access_token=` from `.env.local`); (b) pre-merge, verify by source inspection + the contract test only, and note in the PR that GUI verification happens post-merge. Do NOT start a second dev server for the same repo directory — Next 16 refuses (`Another next dev server is already running`).

Checks when driving the GUI: Roles page shows four tabs (Roles, Workflows, Plugins, Skills) with content rendering under each; Settings nav shows six sections with no Plugins entry; `/settings#plugins` lands on General.

- [ ] **Step 2: Verify signatures, push, open PR**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'   # must print nothing
git push -u origin roles-page-skills-plugins
gh pr create --title "feat: move plugins and skills tabs from Settings to the Roles page" --body "..."
```

PR body should cite the spec, the three commits, and the verification evidence. End with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: After merge (when the user says to merge): cleanup**

```bash
gh pr merge <PR#> --squash        # NOT --delete-branch (fails: main is checked out in the primary worktree)
git -C <worktree> status --short  # confirm clean
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree remove .worktrees/roles-page-skills-plugins
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave branch -D roles-page-skills-plugins
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave push origin --delete roles-page-skills-plugins
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree list
```

Do NOT pull or otherwise touch the primary checkout's git state — a concurrent session owns it.
