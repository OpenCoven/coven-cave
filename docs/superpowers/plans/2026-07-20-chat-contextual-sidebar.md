# Chat Contextual Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Chat's separate list column with one contextual, collapsible primary left sidepanel on desktop and mobile.

**Architecture:** `Workspace` selects the Shell's `nav` content by mode: `WorkspaceSidebar` in Chat and `SidebarMinimal` elsewhere. `Shell` adds a dedicated `chat-contextual` navigation policy with its own persisted layout, 260px open width, zero-width collapse, and open-on-entry behavior.

**Tech Stack:** React, TypeScript, Next.js, react-resizable-panels, Node source-contract tests.

---

## File Map

- Modify `src/components/workspace.tsx` to select contextual nav content, remove the Chat list slot, and route mobile dismissal through the nav drawer.
- Modify `src/components/shell.tsx` to add the Chat nav policy, isolated layout key, dynamic panel sizes, and open-on-entry behavior.
- Modify `src/components/workspace-sidebar.tsx` to update comments that describe its new primary-nav ownership.
- Modify `src/components/chat-sidebar-wiring.test.ts` to pin the contextual host swap and mobile wiring.
- Modify `src/components/shell-left-panels-fit.test.ts` to pin Chat width, collapse size, and layout isolation.
- Modify `src/components/shell-nav-memory.test.ts` to pin Chat open-on-entry without overwriting normal navigation memory.

### Task 1: Add the Chat-specific Shell navigation policy

**Files:**
- Modify: `src/components/shell.tsx:148-172,337-365,483-562,694-724,793-812`
- Modify: `src/components/shell-left-panels-fit.test.ts`
- Modify: `src/components/shell-nav-memory.test.ts`

- [ ] **Step 1: Write failing Shell contract tests**

In `shell-left-panels-fit.test.ts`, update the nav-policy assertion and add:

```ts
assert.match(
  shell,
  /export type ShellNavPolicy = "remembered" \| "visit-collapsed" \| "chat-contextual";/,
  "Shell should expose the contextual Chat nav policy",
);
assert.match(
  shell,
  /const chatContextual = navPolicy === "chat-contextual";/,
  "Shell should derive Chat-specific panel behavior from the nav policy",
);
assert.match(
  shell,
  /defaultSize=\{chatContextual \? "260px" : "240px"\}/,
  "Chat's contextual panel should default to the former list width",
);
assert.match(
  shell,
  /minSize=\{chatContextual \? "220px" : "200px"\}/,
  "Chat's contextual panel should retain the list panel's usable minimum",
);
assert.match(
  shell,
  /collapsedSize=\{isMobile \|\| chatContextual \? 0 : NAV_RAIL_PX\}/,
  "Chat should collapse fully while normal navigation keeps its icon rail",
);
assert.match(
  shell,
  /chatContextual \? `\$\{SHELL_GROUP_ID\}\.chat-contextual`/,
  "Chat should persist a layout separate from normal two-pane navigation",
);
```

In `shell-nav-memory.test.ts`, update the type assertion and replace the
`visitCollapseEffect` extraction/assertion with:

```ts
const routePolicyEffect =
  shell.match(/const previousNavPolicyRef = useRef<ShellNavPolicy>\("remembered"\);[\s\S]*?\}, \[mounted, groupId, isMobile, navPolicy\]\);/)?.[0] ?? "";
assert.ok(routePolicyEffect.length > 0, "the route nav policy effect exists");
assert.match(
  routePolicyEffect,
  /if \(navPolicy === "chat-contextual"\) \{[\s\S]*?navRef\.current\?\.expand\(\);[\s\S]*?setNavOpen\(true\);/,
  "entering Chat expands its contextual panel",
);
assert.match(
  routePolicyEffect,
  /chatContextualGroupRef\.current !== groupId/,
  "Chat expands once for each contextual layout group entry",
);
assert.match(
  routePolicyEffect,
  /navPrefArmedGroupRef\.current = null;/,
  "Chat does not arm writes to normal navigation memory",
);
assert.match(
  shell,
  /const navPeekEnabled = navPolicy === "remembered" && !isMobile && !navOpen;/,
  "hover-to-peek remains exclusive to normal remembered navigation",
);
```

- [ ] **Step 2: Run the Shell tests and verify they fail**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/shell-left-panels-fit.test.ts \
  src/components/shell-nav-memory.test.ts
```

Expected: failures because `chat-contextual` and its panel behavior do not
exist.

- [ ] **Step 3: Add the policy and isolated layout**

In `shell.tsx`, extend the type:

```ts
export type ShellNavPolicy = "remembered" | "visit-collapsed" | "chat-contextual";
```

Derive the policy before panel-group selection:

```ts
const chatContextual = navPolicy === "chat-contextual";
const groupId = chatContextual
  ? `${SHELL_GROUP_ID}.chat-contextual`
  : twoPane
    ? `${SHELL_GROUP_ID}.two-pane`
    : listPolicy === "persistent"
      ? `${SHELL_GROUP_ID}.persistent-list`
      : SHELL_GROUP_ID;
```

Skip the default icon-rail minimization for Chat:

```ts
if (!settled || isMobile || chatContextual) return;
```

Add `chatContextual` to that effect's dependency list.

- [ ] **Step 4: Open the contextual panel on Chat entry**

Replace the existing route-policy layout effect with:

```ts
const navPrefArmedGroupRef = useRef<string | null>(null);
const previousNavPolicyRef = useRef<ShellNavPolicy>("remembered");
const visitCollapsedGroupRef = useRef<string | null>(null);
const chatContextualGroupRef = useRef<string | null>(null);

useLayoutEffect(() => {
  if (!mounted) return;

  if (navPolicy === "chat-contextual") {
    visitCollapsedGroupRef.current = null;
    navPrefArmedGroupRef.current = null;
    if (
      previousNavPolicyRef.current !== navPolicy ||
      chatContextualGroupRef.current !== groupId
    ) {
      chatContextualGroupRef.current = groupId;
      navRef.current?.expand();
      setNavOpen(true);
    }
    previousNavPolicyRef.current = navPolicy;
    return;
  }

  chatContextualGroupRef.current = null;
  if (navPolicy !== "visit-collapsed") {
    visitCollapsedGroupRef.current = null;
    previousNavPolicyRef.current = navPolicy;
    return;
  }
  if (isMobile) {
    previousNavPolicyRef.current = navPolicy;
    return;
  }
  if (
    previousNavPolicyRef.current !== navPolicy ||
    visitCollapsedGroupRef.current !== groupId
  ) {
    navPrefArmedGroupRef.current = null;
    visitCollapsedGroupRef.current = groupId;
    navRef.current?.collapse();
    setNavOpen(false);
  }
  previousNavPolicyRef.current = navPolicy;
}, [mounted, groupId, isMobile, navPolicy]);
```

The existing preference apply/write effects should continue to operate only
when `navPolicy === "remembered"`.

- [ ] **Step 5: Apply Chat-specific panel sizing and labels**

Change the nav `Panel` props:

```tsx
defaultSize={chatContextual ? "260px" : "240px"}
minSize={chatContextual ? "220px" : "200px"}
maxSize="420px"
collapsible
collapsedSize={isMobile || chatContextual ? 0 : NAV_RAIL_PX}
```

Use contextual toggle labels:

```tsx
aria-label={
  chatContextual
    ? navOpen
      ? "Collapse Chat sidebar"
      : "Expand Chat sidebar"
    : navOpen
      ? "Collapse navigation to icons"
      : "Expand navigation"
}
title={
  chatContextual
    ? `${navOpen ? "Collapse" : "Expand"} Chat sidebar (${leftPanelShortcutLabel})`
    : navOpen
      ? `Collapse navigation (${leftPanelShortcutLabel})`
      : `Expand navigation (${leftPanelShortcutLabel})`
}
```

- [ ] **Step 6: Run Shell tests and commit**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/shell-left-panels-fit.test.ts \
  src/components/shell-nav-memory.test.ts
```

Expected: both pass.

Commit:

```bash
git add src/components/shell.tsx \
  src/components/shell-left-panels-fit.test.ts \
  src/components/shell-nav-memory.test.ts
git commit -m "feat(shell): add contextual Chat sidebar policy" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Move Chat from the list slot into the primary nav slot

**Files:**
- Modify: `src/components/workspace.tsx:2541-2643,2960-3056`
- Modify: `src/components/workspace-sidebar.tsx:453-459,515-517`
- Modify: `src/components/chat-sidebar-wiring.test.ts`

- [ ] **Step 1: Rewrite the Chat wiring test to fail on the old three-pane host**

Replace the opening Chat-mode assertions in `chat-sidebar-wiring.test.ts` with:

```ts
assert.match(
  workspace,
  /const contextualNav = mode === "chat" \? chatSidebar : sidebar;/,
  "Chat should replace the primary nav content with WorkspaceSidebar",
);
assert.doesNotMatch(
  workspace,
  /const list = mode === "chat" \? chatSidebar : undefined;/,
  "Chat should not allocate a separate list pane",
);
assert.match(
  workspace,
  /navPolicy=\{mode === "chat" \? "chat-contextual" : "remembered"\}/,
  "Chat should use the open-on-entry contextual nav policy",
);
assert.match(
  workspace,
  /nav=\{contextualNav\}\s*list=\{undefined\}/,
  "Shell should receive one left panel in every mode",
);
assert.match(
  workspace,
  /onToggleList=\{undefined\}/,
  "the top bar should not expose a separate list drawer toggle",
);
```

Add:

```ts
const chatSidebarBlock =
  workspace.match(/const chatSidebar =[\s\S]*?const contextualNav =/)?.[0] ?? "";
assert.ok(chatSidebarBlock.length > 0, "the contextual Chat sidebar block exists");
assert.doesNotMatch(
  chatSidebarBlock,
  /dismissListMobile/,
  "Chat actions should not target the removed list drawer",
);
assert.ok(
  (chatSidebarBlock.match(/dismissNavMobile/g) ?? []).length >= 6,
  "Chat actions should dismiss the contextual nav drawer on mobile",
);
```

- [ ] **Step 2: Run the wiring test and verify it fails**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/chat-sidebar-wiring.test.ts
```

Expected: failures because Chat still uses `list` and list-drawer dismissal.

- [ ] **Step 3: Select the contextual nav in Workspace**

After `chatSidebar`, replace the list derivation with:

```ts
const contextualNav = mode === "chat" ? chatSidebar : sidebar;
```

Change every callback inside `chatSidebar` that currently calls
`dismissListMobile()` to:

```ts
shellRef.current?.dismissNavMobile();
```

This includes session open, split open, new chat, navigation, URL open, and
Settings.

- [ ] **Step 4: Pass one left panel to Shell**

Change the Shell props:

```tsx
navPolicy={mode === "chat" ? "chat-contextual" : "remembered"}
```

Remove the Chat-specific `listPolicy` prop. Destructure only `navDrawerOpen`
from the top-bar callback and remove the list toggle wiring:

```tsx
topBar={({ navDrawerOpen }) => (
```

Replace the corresponding `TopBar` props with:

```tsx
onToggleList={undefined}
navDrawerOpen={navDrawerOpen}
listDrawerOpen={false}
```

This leaves the intervening menu-bar content unchanged.

Pass:

```tsx
nav={contextualNav}
list={undefined}
detail={detail}
```

Keep `hideThreadRail` on `ChatSurface`.

- [ ] **Step 5: Update WorkspaceSidebar ownership comments**

Change comments that say the global nav stays mounted beside Chats. Describe
`WorkspaceSidebar` as the primary Shell nav content while Chat is active, and
the Home button as the transition back to normal app navigation.

- [ ] **Step 6: Run the wiring tests and commit**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/chat-sidebar-wiring.test.ts \
  src/components/workspace-sidebar-wiring.test.ts \
  src/components/shell-left-panels-fit.test.ts \
  src/components/shell-nav-memory.test.ts
```

Expected: all pass.

Commit:

```bash
git add src/components/workspace.tsx \
  src/components/workspace-sidebar.tsx \
  src/components/chat-sidebar-wiring.test.ts
git commit -m "feat(chat): merge threads into the primary sidebar" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Validate the merged sidebar

**Files:**
- Verify all changed files.
- Update Bead `cave-wy3x`.

- [ ] **Step 1: Install worktree dependencies**

Run:

```bash
pnpm install
```

Expected: dependencies restore using the existing lockfile without manifest
changes.

- [ ] **Step 2: Run targeted and repository checks**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/chat-sidebar-wiring.test.ts \
  src/components/workspace-sidebar-wiring.test.ts \
  src/components/shell-left-panels-fit.test.ts \
  src/components/shell-nav-memory.test.ts
pnpm typecheck
pnpm check:tests-wired
```

Expected: all commands pass.

- [ ] **Step 3: Run the app suite if targeted checks pass**

Run:

```bash
pnpm test:app
```

Expected: the app suite passes.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff origin/main...HEAD --check
git diff origin/main...HEAD --stat
git status --short --branch
```

Expected changed files:

- `docs/superpowers/specs/2026-07-20-chat-contextual-sidebar-design.md`
- `docs/superpowers/plans/2026-07-20-chat-contextual-sidebar.md`
- `src/components/shell.tsx`
- `src/components/workspace.tsx`
- `src/components/workspace-sidebar.tsx`
- `src/components/chat-sidebar-wiring.test.ts`
- `src/components/shell-left-panels-fit.test.ts`
- `src/components/shell-nav-memory.test.ts`

- [ ] **Step 5: Record verification in Beads**

Update `cave-wy3x` with the branch, worktree, commit SHAs, targeted tests,
typecheck, test-wiring check, and app-suite result. Keep the Bead open until the
PR merges or explicit completion criteria are met.
