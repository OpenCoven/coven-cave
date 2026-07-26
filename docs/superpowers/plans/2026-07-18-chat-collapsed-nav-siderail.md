# Chat Collapsed Navigation and Persistent Siderail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open desktop Chat with the global navigation collapsed, keep a separate Chats siderail visible, and replace hover-only Chat actions with persistent overflow and context menus.

**Architecture:** `Shell` gains an explicit visit-scoped navigation policy and a persistent desktop-list policy. `Workspace` uses the normal global sidebar as `nav` and mounts `WorkspaceSidebar` as Chat's `list`, while mobile continues to open that list as a drawer. A small action-menu adapter renders one action definition through both the persistent overflow trigger and the right-click context menu.

**Tech Stack:** React 19, TypeScript, Next.js, `react-resizable-panels`, existing `OverflowMenu` / `ContextMenu` / `PopoverItem` primitives, Node source-contract tests, CSS design tokens.

---

## File structure

- Modify `src/components/shell.tsx`
  - Add `ShellNavPolicy` and `ShellListPolicy`.
  - Apply Chat's visit-scoped collapsed state without overwriting the remembered
    non-Chat preference.
  - Disable hover-to-peek under the Chat policy.
  - Keep a persistent desktop list panel from being collapsed by shortcuts or
    imperative calls.
- Modify `src/components/workspace.tsx`
  - Keep `SidebarMinimal` in the global nav slot.
  - Put `WorkspaceSidebar` in the list slot only for Chat.
  - Route mobile dismissal to the list drawer.
- Modify `src/components/workspace-sidebar.tsx`
  - Remove the obsolete collapsed Chats reopen rail.
  - Define one action array per row/header and connect it to both menu paths.
  - Render pinned chats through the same stable row component.
- Create `src/components/workspace-sidebar-action-menu.tsx`
  - Adapt shared sidebar actions to `OverflowMenu` and `ContextMenu`.
- Modify `src/app/globals.css`
  - Remove Chats-rail and hover-reveal rules.
  - Reserve stable room for one persistent ellipsis.
- Modify `src/components/shell-nav-memory.test.ts`
  - Pin visit-scoped collapse, remembered-state isolation, and no Chat hover-peek.
- Modify `src/components/shell-left-panels-fit.test.ts`
  - Pin the persistent-list layout key and non-collapsible desktop panel.
- Modify `src/components/workspace-sidebar-wiring.test.ts`
  - Pin independent nav/list composition and mobile drawer callbacks.
- Rename `src/components/workspace-sidebar-pinned.test.ts` to
  `src/components/workspace-sidebar-actions.test.ts`
  - Pin the shared overflow/context action contract and stable row chrome.
- Modify `scripts/run-tests.mjs`
  - Register the renamed action-menu test.

### Task 1: Add route-scoped shell navigation policy

**Files:**
- Modify: `src/components/shell-nav-memory.test.ts`
- Modify: `src/components/shell.tsx:148-212`
- Modify: `src/components/shell.tsx:491-517`
- Modify: `src/components/shell.tsx:660-683`

- [ ] **Step 1: Write the failing shell policy assertions**

Add these assertions to `src/components/shell-nav-memory.test.ts` after the
existing global-preference assertions:

```ts
assert.match(
  shell,
  /export type ShellNavPolicy = "remembered" \| "visit-collapsed";/,
  "Shell exposes an explicit visit-collapsed navigation policy",
);
assert.match(
  shell,
  /navPolicy = "remembered"/,
  "remembered navigation remains the default outside Chat",
);
assert.match(
  shell,
  /const enteringVisitCollapsed =[\s\S]*?navPolicy === "visit-collapsed"[\s\S]*?navRef\.current\?\.collapse\(\);[\s\S]*?setNavOpen\(false\);/,
  "entering a visit-collapsed surface collapses before paint",
);
assert.match(
  shell,
  /if \(navPolicy === "visit-collapsed"\) \{\s*navPrefArmedGroupRef\.current = null;\s*return;/,
  "visit-scoped state does not arm global preference writes",
);
assert.match(
  shell,
  /navPolicy === "remembered" &&\s*navPrefArmedGroupRef\.current === groupId/,
  "only remembered navigation writes cave:shell:nav-open",
);
assert.match(
  shell,
  /const navPeekEnabled = navPolicy === "remembered" && !isMobile && !navOpen;/,
  "visit-collapsed navigation disables hover-to-peek",
);
assert.match(
  shell,
  /onMouseEnter=\{navPeekEnabled \? \(\) => setNavPeeking\(true\) : undefined\}/,
  "the nav hover handler is gated by the remembered policy",
);
```

Update the existing `applyEffect` extraction so it accepts the new dependency:

```ts
const applyEffect =
  shell.match(
    /const navPrefArmedGroupRef[\s\S]*?\}, \[settled, isMobile, groupId, navPolicy\]\);/,
  )?.[0] ?? "";
```

Replace the existing write-gate assertion with:

```ts
assert.match(
  shell,
  /navPolicy === "remembered" &&\s*\n\s*navPrefArmedGroupRef\.current === groupId &&\s*\n\s*!railAutoCollapsedNavRef\.current/,
  "onResize persists only remembered, user-driven navigation changes",
);
```

- [ ] **Step 2: Run the shell policy test and verify failure**

Run:

```bash
node --experimental-strip-types --no-warnings --test src/components/shell-nav-memory.test.ts
```

Expected: FAIL because `ShellNavPolicy`, `navPolicy`, and `navPeekEnabled` do
not exist.

- [ ] **Step 3: Add the policy types and prop**

In `src/components/shell.tsx`, add the exported policy type near `ShellHandle`:

```ts
export type ShellNavPolicy = "remembered" | "visit-collapsed";
```

Add the prop with a safe default:

```ts
function ShellInner({
  nav,
  list,
  detail,
  navPolicy = "remembered",
  // existing props
}: {
  nav: ReactNode;
  list?: ReactNode;
  detail: ReactNode;
  navPolicy?: ShellNavPolicy;
  // existing props
}, ref: ForwardedRef<ShellHandle>) {
```

- [ ] **Step 4: Collapse only when entering a Chat visit**

Immediately after `navPrefArmedGroupRef`, add a layout effect that runs on the
initial Chat mount and on later remembered-to-Chat transitions, but not after a
manual reopen within the same visit:

```ts
const previousNavPolicyRef = useRef<ShellNavPolicy>("remembered");
useLayoutEffect(() => {
  if (isMobile) {
    previousNavPolicyRef.current = navPolicy;
    return;
  }
  const enteringVisitCollapsed =
    navPolicy === "visit-collapsed" &&
    (previousNavPolicyRef.current !== "visit-collapsed" ||
      navPrefArmedGroupRef.current !== groupId);
  previousNavPolicyRef.current = navPolicy;
  if (!enteringVisitCollapsed) return;
  navPrefArmedGroupRef.current = null;
  navRef.current?.collapse();
  setNavOpen(false);
}, [groupId, isMobile, navPolicy]);
```

At the start of the remembered-preference effect, keep Chat from reading or
arming the global preference:

```ts
useEffect(() => {
  if (!settled || isMobile) return;
  if (navPolicy === "visit-collapsed") {
    navPrefArmedGroupRef.current = null;
    return;
  }
  const pref = readNavOpenPref();
  // existing expand/collapse logic
  navPrefArmedGroupRef.current = groupId;
}, [settled, isMobile, groupId, navPolicy]);
```

Gate the `onResize` persistence block:

```ts
if (
  !isMobile &&
  navPolicy === "remembered" &&
  navPrefArmedGroupRef.current === groupId &&
  !railAutoCollapsedNavRef.current
) {
  writeNavOpenPref(open);
}
```

- [ ] **Step 5: Disable hover-peek for the Chat policy**

Update the peek reset and aside handlers:

```ts
useEffect(() => {
  if (navOpen || isMobile || navPolicy === "visit-collapsed") {
    setNavPeeking(false);
  }
}, [navOpen, isMobile, navPolicy]);

const navPeekEnabled =
  navPolicy === "remembered" && !isMobile && !navOpen;
```

```tsx
<aside
  className={`shell-nav${!isMobile && !navOpen ? (navPeeking ? " shell-nav--peek" : " shell-nav--rail") : ""}`}
  aria-label="Sidebar"
  onMouseEnter={navPeekEnabled ? () => setNavPeeking(true) : undefined}
  onMouseLeave={navPeekEnabled ? () => setNavPeeking(false) : undefined}
>
  {nav}
</aside>
```

- [ ] **Step 6: Run the shell tests**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/shell-nav-memory.test.ts \
  src/components/shell-edge-rails.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the shell policy**

```bash
git add src/components/shell.tsx src/components/shell-nav-memory.test.ts
git commit -m "feat(shell): add visit-scoped nav policy" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Mount Chats as a persistent independent list panel

**Files:**
- Modify: `src/components/shell-left-panels-fit.test.ts`
- Modify: `src/components/workspace-sidebar-wiring.test.ts`
- Modify: `src/components/shell.tsx:157-212`
- Modify: `src/components/shell.tsx:278-326`
- Modify: `src/components/shell.tsx:519-561`
- Modify: `src/components/shell.tsx:688-703`
- Modify: `src/components/workspace.tsx:2583-2626`
- Modify: `src/components/workspace.tsx:2889-2964`
- Modify: `src/components/workspace-sidebar.tsx:447-463`
- Modify: `src/app/globals.css:736-769`

- [ ] **Step 1: Write failing layout-composition assertions**

Add to `src/components/workspace-sidebar-wiring.test.ts`:

```ts
assert.match(
  workspace,
  /const list = mode === "chat" \? chatSidebar : undefined;/,
  "Chat mounts its Chats siderail in the independent list slot",
);
assert.match(
  workspace,
  /nav=\{sidebar\}[\s\S]*?list=\{list\}/,
  "the global sidebar remains in nav while Chats uses list",
);
assert.doesNotMatch(
  workspace,
  /nav=\{mode === "chat" \? chatSidebar : sidebar\}/,
  "Chat no longer replaces global navigation",
);
assert.match(
  workspace,
  /navPolicy=\{mode === "chat" \? "visit-collapsed" : "remembered"\}/,
  "Chat asks Shell for visit-scoped collapsed navigation",
);
assert.match(
  workspace,
  /listPolicy=\{mode === "chat" \? "persistent" : "collapsible"\}/,
  "the desktop Chats siderail cannot be collapsed",
);
assert.match(
  workspace,
  /openFamiliarSession\(session\.id, session\.familiarId\);[\s\S]*?dismissListMobile\(\)/,
  "opening a mobile chat dismisses the Chats list drawer",
);
assert.doesNotMatch(
  workspaceSidebar,
  /workspace-sidebar__rail|chat-sidebar__rail/,
  "the obsolete collapsed Chats reopen rail is removed",
);
```

Delete the stale `cave:code-select-project` assertion from the same test. Its
only source match is a comment beside the project plus button that this task
removes; there is no live dispatch to preserve.

Add to `src/components/shell-left-panels-fit.test.ts`:

```ts
assert.match(
  shell,
  /export type ShellListPolicy = "collapsible" \| "persistent";/,
  "Shell exposes an explicit persistent desktop-list policy",
);
assert.match(
  shell,
  /const groupId = twoPane[\s\S]*?listPolicy === "persistent"[\s\S]*?persistent-list/,
  "persistent-list layouts use a fresh storage group",
);
assert.match(
  shell,
  /collapsible=\{isMobile \|\| listPolicy === "collapsible"\}/,
  "the desktop persistent list panel cannot collapse",
);
```

- [ ] **Step 2: Run the layout tests and verify failure**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/workspace-sidebar-wiring.test.ts \
  src/components/shell-left-panels-fit.test.ts
```

Expected: FAIL because Chat still swaps `nav`, `list` is undefined, and Shell
does not have a list policy.

- [ ] **Step 3: Add persistent-list behavior to Shell**

In `src/components/shell.tsx`, define and accept the policy:

```ts
export type ShellListPolicy = "collapsible" | "persistent";
```

```ts
listPolicy = "collapsible",
```

```ts
listPolicy?: ShellListPolicy;
```

Use a fresh group id so an old collapsed three-pane layout cannot hide Chats:

```ts
const groupId = twoPane
  ? `${SHELL_GROUP_ID}.two-pane`
  : listPolicy === "persistent"
    ? `${SHELL_GROUP_ID}.persistent-list`
    : SHELL_GROUP_ID;
```

Make desktop imperative methods honor persistence while preserving the mobile
drawer:

```ts
closeList: () => {
  if (isMobile) {
    setMobileDrawer((c) => (c === "list" ? null : c));
    return;
  }
  if (listPolicy === "persistent") return;
  listRef.current?.collapse();
},
toggleList: () => {
  if (isMobile) {
    toggleDrawer("list");
    return;
  }
  if (listPolicy === "persistent") return;
  togglePanel(listRef.current);
},
```

Include `listPolicy` in the `useImperativeHandle` dependency array.

Gate the keyboard shortcut:

```ts
if (meta && key === "\\" && !twoPane) {
  e.preventDefault();
  if (isMobile) toggleDrawerSlot("list");
  else if (listPolicy === "collapsible") togglePanel(listRef.current);
}
```

Include `listPolicy` in that effect's dependencies, and set the list panel:

```tsx
<Panel
  id="list"
  className="shell-list-panel"
  defaultSize="260px"
  minSize="220px"
  maxSize="420px"
  collapsible={isMobile || listPolicy === "collapsible"}
  collapsedSize={0}
  panelRef={listRef}
>
```

- [ ] **Step 4: Move `WorkspaceSidebar` into Chat's list slot**

In `src/components/workspace.tsx`, replace the undefined list:

```ts
const list = mode === "chat" ? chatSidebar : undefined;
```

Change every Chat-sidebar callback that currently closes the nav drawer to
close the list drawer:

```ts
onOpenSession={(session) => {
  openFamiliarSession(session.id, session.familiarId);
  shellRef.current?.dismissListMobile();
}}
```

Apply the same `dismissListMobile()` replacement in `onOpenSessionInSplit`,
`onNewChat`, `onOpenSettings`, and other callbacks owned by `chatSidebar`.

Pass the independent panels and policies:

```tsx
<Shell
  ref={shellRef}
  navPolicy={mode === "chat" ? "visit-collapsed" : "remembered"}
  listPolicy={mode === "chat" ? "persistent" : "collapsible"}
  // existing props
  nav={sidebar}
  list={list}
  detail={detail}
/>
```

Keep `hideThreadRail` on `ChatSurface`; the new list panel is the authoritative
Chats rail.

- [ ] **Step 5: Remove the obsolete collapsed Chats rail**

Delete the `workspace-sidebar__rail chat-sidebar__rail` button from
`src/components/workspace-sidebar.tsx`, leaving the full sidebar as the only
child:

```tsx
return (
  <div className="workspace-sidebar chat-sidebar flex h-full min-h-0 flex-col">
    <div className="workspace-sidebar__full chat-sidebar__full cnav">
      {/* existing full sidebar */}
    </div>
  </div>
);
```

Delete the `.chat-sidebar__rail`, `.shell-nav--rail .chat-sidebar__full`,
`.shell-nav--rail .chat-sidebar__rail`, and `.chat-sidebar__rail-label` rules
from `src/app/globals.css`.

- [ ] **Step 6: Run the layout regression tests**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/workspace-sidebar-wiring.test.ts \
  src/components/shell-left-panels-fit.test.ts \
  src/components/shell-drawer-smoke.test.ts \
  src/components/mobile-shell-smoke.test.ts \
  src/components/code-rail-fit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the independent Chats siderail**

```bash
git add \
  src/components/shell.tsx \
  src/components/workspace.tsx \
  src/components/workspace-sidebar.tsx \
  src/app/globals.css \
  src/components/shell-left-panels-fit.test.ts \
  src/components/workspace-sidebar-wiring.test.ts
git commit -m "feat(chat): keep chats rail beside global navigation" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Replace hover-only actions with shared overflow/context menus

**Files:**
- Create: `src/components/workspace-sidebar-action-menu.tsx`
- Modify: `src/components/workspace-sidebar.tsx:1-30`
- Modify: `src/components/workspace-sidebar.tsx:152-284`
- Modify: `src/components/workspace-sidebar.tsx:594-805`
- Modify: `src/app/globals.css:1098-1185`
- Move: `src/components/workspace-sidebar-pinned.test.ts` to `src/components/workspace-sidebar-actions.test.ts`
- Modify: `scripts/run-tests.mjs:164-169`

- [ ] **Step 1: Rename and rewrite the failing action-menu test**

Run:

```bash
git mv \
  src/components/workspace-sidebar-pinned.test.ts \
  src/components/workspace-sidebar-actions.test.ts
```

Replace its contents with:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const actionMenu = readFileSync(
  new URL("./workspace-sidebar-action-menu.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(actionMenu, /<OverflowMenu[\s\S]*?<SidebarActionItems/, "overflow uses shared actions");
assert.match(actionMenu, /<ContextMenu[\s\S]*?<SidebarActionItems/, "context menu uses shared actions");
assert.match(sidebar, /ariaLabel=\{`Chat actions for \$\{title\}`\}/, "chat overflow has a stable name");
assert.match(sidebar, /onContextMenu=\{confirming \? undefined : openContextMenuAt\(setContextMenu\)\}/, "chat rows open the same menu on right-click");
assert.match(sidebar, /label: pinned \? "Unpin chat" : "Pin chat"/, "pin action remains available");
assert.match(sidebar, /label: "Open in split"/, "split action is available without Alt or drag");
assert.match(sidebar, /label: "Delete chat"/, "delete remains available");
assert.match(sidebar, /ariaLabel=\{`Project actions for \$\{label\}`\}/, "project overflow has a stable name");
assert.match(sidebar, /label: `New chat in \$\{label\}`/, "project new-chat remains available");
assert.match(sidebar, /label: `Register \$\{label\} as a project`/, "project registration remains available");
assert.doesNotMatch(sidebar, /cnav__row-actions|cnav__icon-btn/, "hover-only action controls are removed");
assert.doesNotMatch(css, /\.cnav__thread:hover \.cnav__time/, "hover no longer hides timestamps");
assert.doesNotMatch(css, /\.cnav__thread:hover \.cnav__thread-main/, "hover no longer changes row geometry");
assert.doesNotMatch(css, /\.cnav__row-actions|\.cnav__icon-btn/, "hover-reveal CSS is removed");
assert.match(css, /\.cnav__overflow \{[\s\S]*?opacity: 0\.72;/, "one quiet overflow stays visible");

console.log("workspace-sidebar-actions: ok");
```

Update `scripts/run-tests.mjs`:

```js
"src/components/workspace-sidebar-actions.test.ts",
```

and remove the old `workspace-sidebar-pinned.test.ts` entry.

- [ ] **Step 2: Run the action test and verify failure**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/workspace-sidebar-actions.test.ts
```

Expected: FAIL because the adapter file and persistent menus do not exist.

- [ ] **Step 3: Create the shared action-menu adapter**

Create `src/components/workspace-sidebar-action-menu.tsx`:

```tsx
"use client";

import type { IconName } from "@/lib/icon";
import {
  ContextMenu,
  type ContextMenuState,
} from "@/components/ui/context-menu";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem } from "@/components/ui/popover";

export type WorkspaceSidebarAction = {
  id: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

function SidebarActionItems({
  actions,
  onContextClose,
}: {
  actions: readonly WorkspaceSidebarAction[];
  onContextClose?: () => void;
}) {
  return actions.map((action) => (
    <PopoverItem
      key={action.id}
      icon={action.icon}
      danger={action.danger}
      disabled={action.disabled}
      onSelect={() => {
        onContextClose?.();
        action.onSelect();
      }}
    >
      {action.label}
    </PopoverItem>
  ));
}

export function SidebarOverflowMenu({
  ariaLabel,
  actions,
}: {
  ariaLabel: string;
  actions: readonly WorkspaceSidebarAction[];
}) {
  return (
    <OverflowMenu
      ariaLabel={ariaLabel}
      className="cnav__overflow"
      placement="bottom-end"
      minWidth={180}
    >
      <SidebarActionItems actions={actions} />
    </OverflowMenu>
  );
}

export function SidebarContextMenu({
  state,
  onClose,
  ariaLabel,
  actions,
}: {
  state: ContextMenuState;
  onClose: () => void;
  ariaLabel: string;
  actions: readonly WorkspaceSidebarAction[];
}) {
  return (
    <ContextMenu state={state} onClose={onClose} ariaLabel={ariaLabel}>
      <SidebarActionItems actions={actions} onContextClose={onClose} />
    </ContextMenu>
  );
}
```

- [ ] **Step 4: Convert `ThreadRow` to one stable overflow**

Import the adapter and context helper in `workspace-sidebar.tsx`:

```ts
import {
  openContextMenuAt,
  type ContextMenuState,
} from "@/components/ui/context-menu";
import {
  SidebarContextMenu,
  SidebarOverflowMenu,
  type WorkspaceSidebarAction,
} from "@/components/workspace-sidebar-action-menu";
```

Inside `ThreadRow`, define the context state and the single action list:

```ts
const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
const actions: WorkspaceSidebarAction[] = [
  ...(onOpenInSplit
    ? [{
        id: "open-split",
        label: "Open in split",
        icon: "ph:sidebar-simple" as const,
        onSelect: onOpenInSplit,
      }]
    : []),
  {
    id: "pin",
    label: pinned ? "Unpin chat" : "Pin chat",
    icon: pinned ? "ph:bookmark-simple-fill" : "ph:bookmark-simple",
    onSelect: onTogglePin,
  },
  {
    id: "delete",
    label: "Delete chat",
    icon: "ph:x-bold",
    danger: true,
    disabled: deleting,
    onSelect: onRequestDelete,
  },
];
```

Attach right-click to the stable row container and replace
`cnav__row-actions`:

```tsx
<div
  className={`cnav__thread${indent === "flat" ? " cnav__thread--flat" : ""}${active ? " is-active" : ""}`}
  onContextMenu={confirming ? undefined : openContextMenuAt(setContextMenu)}
>
  {/* existing PR badge and main button */}
  {confirming ? (
    <span className="cnav__confirm">
      {/* existing Cancel/Delete confirmation */}
    </span>
  ) : (
    <SidebarOverflowMenu
      ariaLabel={`Chat actions for ${title}`}
      actions={actions}
    />
  )}
  <SidebarContextMenu
    state={confirming ? null : contextMenu}
    onClose={() => setContextMenu(null)}
    ariaLabel={`Chat actions for ${title}`}
    actions={actions}
  />
</div>
```

Keep the existing row click, Alt-click, Alt-Enter, and drag-to-split behavior;
the new menu adds a durable touch/keyboard path without removing existing
direct manipulation.

- [ ] **Step 5: Render pinned chats through `ThreadRow`**

Replace the pinned rail's custom row and bookmark button with the shared row:

```tsx
{pinnedSessions.map((session) => (
  <li key={`pin-${session.id}`}>
    <ThreadRow
      session={session}
      active={activeSessionId === session.id}
      pinned
      confirming={confirmingSessionId === session.id}
      deleting={deletingSessionId === session.id}
      indent="flat"
      onOpenUrl={onOpenUrl}
      onOpen={() => onOpenSession(session)}
      onOpenInSplit={
        onOpenSessionInSplit ? () => onOpenSessionInSplit(session) : undefined
      }
      onTogglePin={() => togglePin(session.id)}
      onRequestDelete={() => setConfirmingSessionId(session.id)}
      onCancelDelete={() => setConfirmingSessionId(null)}
      onConfirmDelete={() => void handleDeleteSession(session)}
    />
  </li>
))}
```

- [ ] **Step 6: Convert project headers to the same menu contract**

Add parent state near the other sidebar state:

```ts
const [projectContextMenu, setProjectContextMenu] = useState<{
  key: string;
  state: Exclude<ContextMenuState, null>;
} | null>(null);
```

Inside the project-group map, define:

```ts
const projectActions: WorkspaceSidebarAction[] = [
  ...(unregistered
    ? [{
        id: "register-project",
        label: `Register ${label} as a project`,
        icon: "ph:folders-bold" as const,
        disabled: registering,
        onSelect: () => void handleRegister(group),
      }]
    : []),
  {
    id: "new-chat",
    label: `New chat in ${label}`,
    icon: "ph:plus",
    onSelect: () => onNewChat(group.projectRoot),
  },
];
```

Attach the shared context menu to `.cnav__group-head`:

```tsx
<div
  className="cnav__group-head"
  onContextMenu={(event) => {
    event.preventDefault();
    setProjectContextMenu({
      key,
      state: { x: event.clientX, y: event.clientY },
    });
  }}
>
  {/* existing collapse toggle */}
  <SidebarOverflowMenu
    ariaLabel={`Project actions for ${label}`}
    actions={projectActions}
  />
  <SidebarContextMenu
    state={projectContextMenu?.key === key ? projectContextMenu.state : null}
    onClose={() => setProjectContextMenu(null)}
    ariaLabel={`Project actions for ${label}`}
    actions={projectActions}
  />
</div>
```

Delete the separate register and plus buttons.

- [ ] **Step 7: Remove hover-reveal CSS and add stable overflow styling**

Delete the complete `.cnav__icon-btn` and `.cnav__row-actions` rule blocks,
plus:

```css
.cnav__thread:hover .cnav__thread-main { ... }
.cnav__thread:hover .cnav__time { ... }
```

Add:

```css
.cnav__overflow {
  flex: 0 0 auto;
  margin-right: 2px;
  opacity: 0.72;
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.cnav__overflow:hover,
.cnav__overflow:focus-visible,
.cnav__overflow.ui-icon-btn--active {
  opacity: 1;
}
```

Keep `.cnav__thread:hover` as ordinary row feedback; it changes color only and
does not reveal controls, hide timestamps, or change padding.

- [ ] **Step 8: Run the action and sidebar tests**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/workspace-sidebar-actions.test.ts \
  src/components/workspace-sidebar-wiring.test.ts \
  src/components/workspace-sidebar-pr-badge.test.ts
```

Expected: PASS.

- [ ] **Step 9: Verify test registration**

Run:

```bash
pnpm check:tests-wired
```

Expected: `All test files are wired`.

- [ ] **Step 10: Commit persistent action menus**

```bash
git add \
  src/components/workspace-sidebar-action-menu.tsx \
  src/components/workspace-sidebar.tsx \
  src/components/workspace-sidebar-actions.test.ts \
  src/components/workspace-sidebar-pinned.test.ts \
  src/app/globals.css \
  scripts/run-tests.mjs
git commit -m "feat(chat): replace hover actions with overflow menus" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

`git add` may report the old pinned-test path as absent after the rename; that
is acceptable because Git stages the deletion through the renamed destination.

### Task 4: Run integrated verification and record the handoff

**Files:**
- Modify only if verification finds a regression in files already changed.
- Update Bead: `cave-0oqu`

- [ ] **Step 1: Run the complete focused regression set**

Run:

```bash
node --experimental-strip-types --no-warnings --test \
  src/components/shell-nav-memory.test.ts \
  src/components/shell-left-panels-fit.test.ts \
  src/components/shell-edge-rails.test.ts \
  src/components/shell-drawer-smoke.test.ts \
  src/components/mobile-shell-smoke.test.ts \
  src/components/workspace-sidebar-wiring.test.ts \
  src/components/workspace-sidebar-actions.test.ts \
  src/components/workspace-sidebar-pr-badge.test.ts \
  src/components/code-rail-fit.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run the app test suite**

Run:

```bash
pnpm test:app
```

Expected: all app test files PASS.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git --no-pager diff origin/main...HEAD --check
git --no-pager diff origin/main...HEAD --stat
git --no-pager status --short --branch
```

Expected: no whitespace errors; only the approved shell, Chat layout, sidebar,
CSS, tests, runner registration, spec, and plan are changed.

- [ ] **Step 5: Record verification in Beads**

Run:

```bash
bd update cave-0oqu --append-notes "Implementation complete on feat/chat-collapsed-nav-siderail. Verified focused shell/sidebar/code-rail tests, pnpm check:tests-wired, pnpm typecheck, and pnpm test:app. Awaiting PR/merge before closure."
```

Expected: Bead remains `in_progress`; do not close it before merge or explicit
completion approval.
