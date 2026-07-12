# OpenTrust Sidepanel Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose both Coven Cave left sidepanel hosts around OpenTrust's 256px/48px hierarchy, interaction states, and responsive presentation while preserving every Cave navigation and familiar workflow.

**Architecture:** Retain Cave's `react-resizable-panels` shell and introduce presentation-only shared sidebar chrome for brand, primary actions, section labels, lower utilities, and familiar identity. `SidebarMinimal` continues to own application destinations and split-page behavior; `WorkspaceSidebar` continues to own project/thread navigation; both consume the same chrome and CSS state contract.

**Tech Stack:** React 19, TypeScript 6, Next.js 16, `react-resizable-panels`, source-level `node:assert` tests, Playwright, existing Cave CSS/theme tokens.

**Spec:** `docs/superpowers/specs/2026-07-09-opentrust-sidebar-parity-design.md`

**Bead:** `cave-9q0v`

**Reference:** `/Users/buns/Documents/GitHub/OpenKnots/OpenTrust` at `11a4ac9`

**Worktree:** `.worktrees/feat-opentrust-sidebar-parity`

**Policy:** Beads is the authoritative task state. The checkboxes below are the implementation sequence required by the planning skill. Under the repo's conservative profile, stage coherent checkpoints but do not commit or push without explicit authority.

---

## File map

- Create `src/components/sidebar-chrome.tsx`: shared presentation-only brand, primary action/search, section label, utility rows, and familiar identity footer.
- Create `src/components/sidebar-opentrust-parity.test.ts`: narrow reference-contract guard spanning shared chrome, both hosts, shell sizes, and CSS states.
- Modify `src/components/sidebar-minimal.tsx`: group daily and tool destinations and consume shared chrome.
- Modify `src/components/workspace-sidebar.tsx`: consume shared chrome around unchanged project/thread behavior.
- Modify `src/components/workspace.tsx`: pass the multi-familiar scope into the Chat host.
- Modify `src/components/sidebar-footer.tsx`: remove the superseded two-link footer after both hosts migrate.
- Modify `src/components/sidebar-minimal.test.ts`, `src/components/sidebar-footer.test.ts`, and `src/components/workspace-sidebar-wiring.test.ts`: pin intentional structure and preservation requirements.
- Modify `src/components/shell.tsx`, `src/app/globals.css`, `src/components/shell-left-panels-fit.test.ts`, `src/components/sidepanel-nav-peek.test.ts`, `src/components/shell-drawer-smoke.test.ts`, and `src/components/mobile-shell-smoke.test.ts`: 256px expanded, 48px rail, 288px drawer, new persisted layout generation.
- Modify `src/styles/sidebar-minimal.css`: OpenTrust geometry and states for both standard and Chat hosts; delete obsolete top-switcher, vertical Chat rail, and old footer overrides once replacement tests pass.
- Modify `scripts/run-tests.mjs`: wire the new test.
- Create `tests/sidepanel-opentrust-parity.spec.ts`: rendered desktop/rail/mobile interaction assertions.

## Task 1: Add the shared OpenTrust-shaped chrome

**Files:**

- Create: `src/components/sidebar-opentrust-parity.test.ts`
- Create: `src/components/sidebar-chrome.tsx`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing shared-chrome contract test**

Create `src/components/sidebar-opentrust-parity.test.ts` with this initial content:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(url: URL): Promise<string> {
  return readFile(url, "utf8").catch(() => "");
}

const chrome = await readSource(new URL("./sidebar-chrome.tsx", import.meta.url));

for (const exportName of [
  "SidebarBrand",
  "SidebarPrimaryActions",
  "SidebarSectionLabel",
  "SidebarUtilityNav",
  "SidebarIdentityFooter",
  "openSidebarSearch",
]) {
  assert.match(chrome, new RegExp(`export function ${exportName}`), `${exportName} is shared chrome`);
}
assert.match(chrome, /src="\/icons\/favicon-32\.png"/, "brand uses the local Cave icon");
assert.match(chrome, />Coven Cave</, "brand names Coven Cave");
assert.match(chrome, />OpenCoven</, "brand attribution names OpenCoven");
assert.match(chrome, /new KeyboardEvent\("keydown", \{[\s\S]*?key: "k"[\s\S]*?metaKey: true/, "search uses the Command-K path");
assert.match(chrome, /className="sidebar-primary-actions"[\s\S]*?>New chat</, "primary row contains New chat");
assert.match(chrome, /aria-label="Search"/, "icon search has an accessible name");
assert.match(chrome, /href="\/dashboard"/, "utility navigation keeps Dashboard as a link");
assert.match(chrome, /<FamiliarQuickSwitch[\s\S]*?placement="top-start"[\s\S]*?labeled/, "identity footer reuses the familiar switcher and opens upward");
assert.doesNotMatch(chrome, /OpenTrust|E53935|openclaw\.ai/, "Cave chrome does not copy OpenTrust product identity");

console.log("sidebar-opentrust-parity.test.ts: shared chrome OK");
```

- [ ] **Step 2: Wire and run the test to verify RED**

Insert `"src/components/sidebar-opentrust-parity.test.ts",` immediately before `sidebar-minimal.test.ts` in `scripts/run-tests.mjs`.

Run:

```bash
node --experimental-strip-types src/components/sidebar-opentrust-parity.test.ts
```

Expected: assertion FAIL stating that `SidebarBrand` is missing. The test process itself loads successfully; this is a feature failure, not a file-read error.

- [ ] **Step 3: Implement the shared chrome**

Create `src/components/sidebar-chrome.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { FamiliarQuickSwitch } from "@/components/familiar-quick-switch";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { APP_VERSION } from "@/lib/app-version";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

export type SidebarFamiliarScopeProps = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  selectedFamiliarIds?: ReadonlySet<string>;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  onFamiliarScopeChange: (id: string | null, opts?: { multi?: boolean }) => void;
};

export function openSidebarSearch(): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "k",
    metaKey: true,
    bubbles: true,
  }));
}

export function SidebarBrand() {
  return (
    <div className="sidebar-brand" aria-label="Coven Cave by OpenCoven">
      <span className="sidebar-brand__mark" aria-hidden="true">
        <img src="/icons/favicon-32.png" alt="" width={20} height={20} />
      </span>
      <span className="sidebar-brand__copy">
        <span className="sidebar-brand__name">Coven Cave</span>
        <span className="sidebar-brand__byline">OpenCoven</span>
      </span>
    </div>
  );
}

export function SidebarPrimaryActions({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="sidebar-primary-actions">
      <button type="button" className="sidebar-primary-action focus-ring" onClick={onNewChat} title="New chat">
        <Icon name="ph:plus-bold" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
        <span>New chat</span>
      </button>
      <button type="button" className="sidebar-search-action focus-ring" onClick={openSidebarSearch} aria-label="Search" title="Search (⌘K)">
        <Icon name="ph:magnifying-glass" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
      </button>
    </div>
  );
}

export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return <div className="sidebar-section-label">{children}</div>;
}

export function SidebarUtilityNav({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="sidebar-utility" role="group" aria-label="Sidebar utilities">
      <a className="sidebar-utility-row focus-ring" href="/dashboard" aria-label="Dashboard" title="Dashboard">
        <Icon name="ph:squares-four" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
        <span>Dashboard</span>
      </a>
      <button type="button" className="sidebar-utility-row focus-ring" onClick={onOpenSettings} aria-label="Settings" title="Settings">
        <Icon name="ph:gear-six" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
        <span>Settings</span>
      </button>
      <button type="button" className="sidebar-utility-row focus-ring" onClick={openSidebarSearch} aria-label="Search" title="Search (⌘K)">
        <Icon name="ph:magnifying-glass" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
        <span>Search</span>
      </button>
    </div>
  );
}

export function SidebarIdentityFooter(props: SidebarFamiliarScopeProps) {
  return (
    <footer className="sidebar-identity-footer">
      <div className="sidebar-attribution">Coven Cave v{APP_VERSION}</div>
      <div className="sidebar-identity-control">
        <FamiliarQuickSwitch
          familiars={props.familiars}
          activeFamiliarId={props.activeFamiliarId ?? null}
          selectedFamiliarIds={props.selectedFamiliarIds}
          sessions={props.sessions}
          responseNeeded={props.responseNeeded}
          onSelectFamiliar={props.onFamiliarScopeChange}
          placement="top-start"
          labeled
        />
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Run GREEN and wiring checks**

```bash
node --experimental-strip-types src/components/sidebar-opentrust-parity.test.ts
pnpm check:tests-wired
```

Expected: both commands exit 0.

- [ ] **Step 5: Stage the checkpoint**

```bash
git add src/components/sidebar-chrome.tsx src/components/sidebar-opentrust-parity.test.ts scripts/run-tests.mjs
git diff --cached --check
```

Expected: no whitespace errors. Do not commit under the conservative profile.

## Task 2: Recompose the standard sidepanel hierarchy

**Files:**

- Modify: `src/components/sidebar-minimal.tsx`
- Modify: `src/components/sidebar-minimal.test.ts`
- Modify: `src/components/sidebar-footer.tsx`
- Modify: `src/components/sidebar-footer.test.ts`
- Test: `src/components/sidebar-opentrust-parity.test.ts`

- [ ] **Step 1: Extend the tests for standard-host parity**

Append these source assertions to `sidebar-opentrust-parity.test.ts`:

```ts
const standard = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
assert.match(standard, /<SidebarBrand\s*\/>/, "standard host begins with the shared brand");
assert.match(standard, /<SidebarPrimaryActions onNewChat=\{onNewChat\}\s*\/>/, "standard host uses the shared action row");
assert.match(standard, /const PRIMARY_MODES = VISIBLE_MODES\.filter\(\(mode\) => mode\.section === "primary"\)/, "daily destinations are a primary group");
assert.match(standard, /const TOOL_MODES = VISIBLE_MODES\.filter\(\(mode\) => mode\.section === "tools"\)/, "secondary destinations are a labeled tools group");
assert.match(standard, /<SidebarSectionLabel>Cave tools<\/SidebarSectionLabel>/, "tools group is named");
assert.match(standard, /<SidebarUtilityNav onOpenSettings=\{onOpenSettings\}\s*\/>/, "utilities sit below contextual content");
assert.match(standard, /<SidebarIdentityFooter[\s\S]*?selectedFamiliarIds=\{selectedFamiliarIds\}/, "familiar scope moved to the shared identity footer");
assert.doesNotMatch(standard, /className="sidebar-familiar-switch"/, "legacy top familiar switcher is retired");
assert.match(standard, /<RecentActivityRollup/, "Recent Activity remains available");
assert.match(standard, /draggable=\{draggable \|\| undefined\}/, "page drag-to-split remains wired");
```

Update `sidebar-minimal.test.ts` and `sidebar-footer.test.ts` to remove assertions that require the familiar switcher at the top or Dashboard/Settings in the old `SidebarFooter`. Replace them with assertions for the shared chrome imports and footer placement.

- [ ] **Step 2: Run the tests to verify RED**

```bash
node --experimental-strip-types src/components/sidebar-opentrust-parity.test.ts
node --experimental-strip-types src/components/sidebar-minimal.test.ts
node --experimental-strip-types src/components/sidebar-footer.test.ts
```

Expected: FAIL on missing shared-chrome composition and old footer expectations.

- [ ] **Step 3: Split the destination model into primary and tools groups**

Add `section: "primary" | "tools"` to the `FOLDER_MODES` item type. Assign `primary` to Home, Chat, Tasks, and Schedules; assign `tools` to Journal, Grimoire, Marketplace, and GitHub. Hidden Browser remains `tools` so command-palette ordering stays stable.

After `VISIBLE_MODES`, add:

```ts
const PRIMARY_MODES = VISIBLE_MODES.filter((mode) => mode.section === "primary");
const TOOL_MODES = VISIBLE_MODES.filter((mode) => mode.section === "tools");
```

Do not change IDs, labels, callbacks, badges, descriptions, `quiet`, `navHidden`, or `FOLDER_MODES` export behavior.

- [ ] **Step 4: Replace `SidebarMinimal` composition**

Replace imports of `FamiliarQuickSwitch` and `SidebarFooter` with:

```ts
import {
  SidebarBrand,
  SidebarIdentityFooter,
  SidebarPrimaryActions,
  SidebarSectionLabel,
  SidebarUtilityNav,
} from "@/components/sidebar-chrome";
```

Use this region ordering inside `<nav className="sidebar-minimal" aria-label="Workspace navigation">`:

```tsx
<SidebarBrand />
<SidebarPrimaryActions onNewChat={onNewChat} />
<div className="sidebar-nav-scroll" ref={navScrollRef}>
  <div className="sidebar-menu-group" role="group" aria-label="Primary destinations">
    {PRIMARY_MODES.map((fm, i) => (
      <FolderRow
        key={fm.id}
        id={fm.id}
        label={fm.label}
        iconName={fm.iconName}
        state={sidebarRowState(fm.id, mode, props.splitPageModes, { grimoireView: props.grimoireView })}
        badge={fm.badge?.(props)}
        kbd={fm.kbd}
        description={fm.description}
        quiet={fm.quiet}
        quietLead={Boolean(fm.quiet) && !PRIMARY_MODES[i - 1]?.quiet}
        onClick={() => handleModeSelect(fm.id)}
      />
    ))}
  </div>
  <section className="sidebar-tools" aria-label="Cave tools">
    <SidebarSectionLabel>Cave tools</SidebarSectionLabel>
    <div className="sidebar-menu-group">
      {TOOL_MODES.map((fm, i) => (
        <FolderRow
          key={fm.id}
          id={fm.id}
          label={fm.label}
          iconName={fm.iconName}
          state={sidebarRowState(fm.id, mode, props.splitPageModes, { grimoireView: props.grimoireView })}
          badge={fm.badge?.(props)}
          kbd={fm.kbd}
          description={fm.description}
          quiet={fm.quiet}
          quietLead={Boolean(fm.quiet) && !TOOL_MODES[i - 1]?.quiet}
          onClick={() => handleModeSelect(fm.id)}
        />
      ))}
    </div>
    {(props.roleSurfaces?.length ?? 0) > 0 ? (
      <div className="sidebar-rooms">
        <SidebarSectionLabel>Rooms</SidebarSectionLabel>
        <div className="sidebar-menu-group">
          {props.roleSurfaces!.map((room) => (
            <FolderRow
              key={room.mode}
              id={room.mode}
              label={room.label}
              iconName={room.iconName}
              state={sidebarRowState(room.mode, mode, props.splitPageModes)}
              description={room.description}
              onClick={() => onModeChange(room.mode)}
            />
          ))}
        </div>
      </div>
    ) : null}
  </section>
  <RecentActivityRollup activeSessionId={activeSessionId} onOpenSession={onOpenSession} />
  <SidebarUtilityNav onOpenSettings={onOpenSettings} />
</div>
<SidebarIdentityFooter
  familiars={familiars}
  activeFamiliarId={activeFamiliarId}
  selectedFamiliarIds={selectedFamiliarIds}
  sessions={sessions}
  responseNeeded={responseNeeded}
  onFamiliarScopeChange={onFamiliarScopeChange}
/>
```

Preserve the current `sidebarRowState`, badge functions, and `FolderRow` drag handlers exactly. `quietLead` is calculated within each visible group, not across hidden items.

- [ ] **Step 5: Retire the old footer implementation**

Delete `src/components/sidebar-footer.tsx` only after `rg -n "SidebarFooter" src` returns no production consumers. Replace `sidebar-footer.test.ts` with a guard that imports `sidebar-chrome.tsx` as text and asserts Dashboard, Settings, Search, attribution, and familiar footer exist there. Keep the test filename wired to avoid an unnecessary runner-list deletion conflict.

- [ ] **Step 6: Run GREEN and preservation tests**

```bash
node --experimental-strip-types src/components/sidebar-opentrust-parity.test.ts
node --experimental-strip-types src/components/sidebar-minimal.test.ts
node --experimental-strip-types src/components/sidebar-footer.test.ts
node --experimental-strip-types src/components/sidepanel-badges.test.ts
node --experimental-strip-types src/components/sidepanel-badge-dots.test.ts
node --experimental-strip-types src/components/sidepanel-keyboard-nav.test.ts
node --experimental-strip-types src/components/recent-activity-rollup.test.ts
node --experimental-strip-types src/lib/sidebar-nav-state.test.ts
```

Expected: all exit 0.

- [ ] **Step 7: Stage the standard-host checkpoint**

```bash
git add src/components/sidebar-minimal.tsx src/components/sidebar-minimal.test.ts src/components/sidebar-footer.tsx src/components/sidebar-footer.test.ts src/components/sidebar-opentrust-parity.test.ts
git diff --cached --check
```

If `sidebar-footer.tsx` was deleted, stage it with `git add -u`.

## Task 3: Recompose the Chat sidepanel without losing thread workflows

**Files:**

- Modify: `src/components/workspace-sidebar.tsx`
- Modify: `src/components/workspace-sidebar-wiring.test.ts`
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/sidebar-opentrust-parity.test.ts`

- [ ] **Step 1: Write failing Chat-host parity assertions**

Append:

```ts
const chat = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
assert.match(chat, /<SidebarBrand\s*\/>/, "Chat host uses the shared product header");
assert.match(chat, /<SidebarPrimaryActions onNewChat=\{\(\) => onNewChat\(null\)\}\s*\/>/, "Chat host uses the shared primary row");
assert.match(chat, /<SidebarUtilityNav onOpenSettings=\{onOpenSettings\}\s*\/>/, "Chat host keeps lower utilities");
assert.match(chat, /<SidebarIdentityFooter[\s\S]*?selectedFamiliarIds=\{selectedFamiliarIds\}/, "Chat host keeps multi-familiar scope in the footer");
assert.doesNotMatch(chat, /workspace-sidebar__rail chat-sidebar__rail/, "legacy vertical Chats rail is retired");
assert.match(chat, /<nav aria-label="Chat threads" className="cnav__scroll">/, "project/thread navigator remains");
assert.match(chat, /aria-label="Sidebar options"/, "organizer remains accessible");
assert.match(workspace, /<WorkspaceSidebar[\s\S]*?selectedFamiliarIds=\{scopeIds\}/, "Workspace supplies multi-familiar scope to Chat");
```

Update `workspace-sidebar-wiring.test.ts` to expect the shared brand/actions/footer while retaining every assertion for project grouping, recency buckets, organizer persistence, project avatars, scheduled shortcut, pinned rows, and thread navigation.

- [ ] **Step 2: Run the tests to verify RED**

```bash
node --experimental-strip-types src/components/sidebar-opentrust-parity.test.ts
node --experimental-strip-types src/components/workspace-sidebar-wiring.test.ts
```

Expected: FAIL because Chat still owns a familiar header and vertical collapsed rail.

- [ ] **Step 3: Thread multi-scope data into Chat**

Change `WorkspaceSidebar` props to include:

```ts
selectedFamiliarIds?: ReadonlySet<string>;
onSelectFamiliar: (id: string | null, opts?: { multi?: boolean }) => void;
```

Destructure `selectedFamiliarIds`, and pass `selectedFamiliarIds={scopeIds}` from the `WorkspaceSidebar` call in `workspace.tsx`. Do not change the active-familiar filtering rules: the active ID continues to determine the visible thread list; multi-scope remains a selector state, matching the standard host's existing behavior.

- [ ] **Step 4: Replace the Chat host's outer chrome**

Import the shared components from `sidebar-chrome.tsx`. Delete the standalone `workspace-sidebar__rail` button. Inside `.workspace-sidebar__full`, use this ordering:

```tsx
<SidebarBrand />
<SidebarPrimaryActions onNewChat={() => onNewChat(null)} />
<div className="cnav__toolbar" aria-label="Chat sidebar shortcuts">
  <button
    type="button"
    aria-label="Go to Home"
    title="Home"
    onClick={() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "home" } }))}
    className="cnav__back focus-ring"
  >
    <Icon name="ph:house-bold" width={15} aria-hidden />
  </button>
  <button
    type="button"
    title="Scheduled"
    aria-label={scheduledCount ? `Scheduled (${scheduledCount})` : "Scheduled"}
    onClick={() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "inbox" } }))}
    className="cnav__back focus-ring"
  >
    <Icon name="ph:clock" width={14} aria-hidden />
    {typeof scheduledCount === "number" && scheduledCount > 0 ? (
      <span className="cnav__mini-count">{scheduledCount}</span>
    ) : null}
  </button>
  <button
    type="button"
    title="Plugins"
    aria-label="Plugins"
    onClick={() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "marketplace" } }))}
    className="cnav__back focus-ring"
  >
    <Icon name="ph:plugs" width={14} aria-hidden />
  </button>
  <button
    ref={menuAnchorRef}
    type="button"
    aria-label="Sidebar options"
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    title="Sidebar options"
    onClick={() => setMenuOpen((cur) => !cur)}
    className="cnav__back focus-ring"
  >
    <Icon name="ph:dots-three-bold" width={15} aria-hidden />
  </button>
  <Popover
    open={menuOpen}
    onOpenChange={setMenuOpen}
    anchorRef={menuAnchorRef}
    placement="bottom-end"
    minWidth={190}
    ariaLabel="Sidebar options"
  >
    <div ref={menuBodyRef} tabIndex={-1}>
      <PopoverBody role="menu" ariaLabel="Organize sidebar">
        <PopoverLabel>Organize sidebar</PopoverLabel>
        <PopoverItem icon="ph:clock" checked={view === "recent"} onSelect={() => selectView("recent")}>
          Recent chats
        </PopoverItem>
        <PopoverItem icon="ph:folder" checked={view === "projects"} onSelect={() => selectView("projects")}>
          By project
        </PopoverItem>
      </PopoverBody>
    </div>
  </Popover>
</div>
{/* Keep the current cnav__search-wrap, cnav__error, and Chat threads nav here without changing their data flow. */}
<SidebarUtilityNav onOpenSettings={onOpenSettings} />
<SidebarIdentityFooter
  familiars={familiars}
  activeFamiliarId={activeFamiliarId}
  selectedFamiliarIds={selectedFamiliarIds}
  sessions={sessions}
  responseNeeded={responseNeeded}
  onFamiliarScopeChange={onSelectFamiliar}
/>
```

Move existing Home, Scheduled, Plugins, and Sidebar options controls into `cnav__toolbar`; do not rewrite their callbacks, badges, popover focus trap, or preferences. Keep the search input and all content below it byte-for-byte where possible.

- [ ] **Step 5: Run GREEN and Chat preservation tests**

```bash
node --experimental-strip-types src/components/sidebar-opentrust-parity.test.ts
node --experimental-strip-types src/components/workspace-sidebar-wiring.test.ts
node --experimental-strip-types src/components/chat-sidebar-wiring.test.ts
node --experimental-strip-types src/components/chat-all-familiars-project-list.test.ts
node --experimental-strip-types src/components/chat-thread-rail.test.ts
node --experimental-strip-types src/components/chat-rail-modern-redesign.test.ts
```

Expected: all exit 0. If an older source guard pins the superseded vertical rail markup, update it to assert the OpenTrust-style icon rail while retaining the behavior it was protecting.

- [ ] **Step 6: Stage the Chat-host checkpoint**

```bash
git add src/components/workspace-sidebar.tsx src/components/workspace-sidebar-wiring.test.ts src/components/workspace.tsx src/components/sidebar-opentrust-parity.test.ts
git diff --cached --check
```

## Task 4: Align shell dimensions and responsive drawer geometry

**Files:**

- Modify: `src/components/shell.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/shell-left-panels-fit.test.ts`
- Modify: `src/components/sidepanel-nav-peek.test.ts`
- Modify: `src/components/shell-drawer-smoke.test.ts`
- Modify: `src/components/mobile-shell-smoke.test.ts`
- Modify: `src/components/sidebar-opentrust-parity.test.ts`

- [ ] **Step 1: Change tests to the new width contract before production code**

Update `shell-left-panels-fit.test.ts` to assert:

```ts
assert.match(shell, /const SHELL_GROUP_ID = "cave\.shell\.widths\.v4"/);
assert.match(shell, /const NAV_RAIL_PX = 48/);
assert.match(shell, /const NAV_OPEN_PX = 256/);
assert.match(shell, /id="nav"[\s\S]{0,600}?defaultSize="256px"[\s\S]{0,90}?minSize="200px"[\s\S]{0,60}?maxSize="420px"/);
assert.match(globals, /--shell-nav-width:\s*256px/);
```

Update `sidepanel-nav-peek.test.ts` to describe a 48px rail and assert the peek width is 256px. Update mobile shell/drawer guards to assert `width: min(86vw, 288px)`.

Append to the parity test:

```ts
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(shell, /const NAV_OPEN_PX = 256/);
assert.match(shell, /const NAV_RAIL_PX = 48/);
assert.match(shell, /cave\.shell\.widths\.v4/);
assert.match(globals, /width:\s*min\(86vw,\s*288px\)/);
```

- [ ] **Step 2: Run shell tests to verify RED**

```bash
node --experimental-strip-types src/components/shell-left-panels-fit.test.ts
node --experimental-strip-types src/components/sidepanel-nav-peek.test.ts
node --experimental-strip-types src/components/shell-drawer-smoke.test.ts
node --experimental-strip-types src/components/mobile-shell-smoke.test.ts
```

Expected: FAIL on v3, 240px, 56px, 232px peek, and 320px drawer values.

- [ ] **Step 3: Update shell constants and persisted generation**

In `shell.tsx`:

```ts
const SHELL_GROUP_ID = "cave.shell.widths.v4";
const NAV_RAIL_PX = 48;
const NAV_OPEN_PX = 256;
const NAV_OPEN_THRESHOLD_PX = NAV_RAIL_PX + 16;
```

Change the nav `Panel` to `defaultSize="256px"`. Keep `minSize="200px"`, `maxSize="420px"`, `collapsedSize`, group-level minimize calculation, persisted-layout validation, mobile behavior, and code-rail coupling unchanged. Update adjacent comments so they no longer claim 240/56/v3.

- [ ] **Step 4: Update CSS geometry**

In `globals.css`:

```css
--shell-nav-width: 256px;
```

Set `.shell-nav-panel > .shell-nav--peek` to `width: 256px`. In the `max-width: 1023px` drawer rule, use:

```css
width: min(86vw, 288px) !important;
max-width: min(86vw, 288px) !important;
```

Keep the existing drawer backdrop, safe-area padding, focus behavior, overscroll containment, and reduced-motion override.

- [ ] **Step 5: Run shell tests GREEN**

Run the four tests from Step 2 plus:

```bash
node --experimental-strip-types src/components/shell-edge-rails.test.ts
node --experimental-strip-types src/components/mobile-code-rail.test.ts
node --experimental-strip-types src/components/nav-rail-coupling.test.ts
```

Expected: all exit 0.

- [ ] **Step 6: Stage the shell checkpoint**

```bash
git add src/components/shell.tsx src/app/globals.css src/components/shell-left-panels-fit.test.ts src/components/sidepanel-nav-peek.test.ts src/components/shell-drawer-smoke.test.ts src/components/mobile-shell-smoke.test.ts src/components/sidebar-opentrust-parity.test.ts
git diff --cached --check
```

## Task 5: Implement OpenTrust visual states for both hosts

**Files:**

- Modify: `src/styles/sidebar-minimal.css`
- Modify: `src/components/sidebar-minimal.test.ts`
- Modify: `src/components/workspace-sidebar-wiring.test.ts`
- Modify: `src/components/sidebar-opentrust-parity.test.ts`

- [ ] **Step 1: Add failing CSS contract assertions**

Append:

```ts
const sidebarCss = await readFile(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8");
assert.match(sidebarCss, /\.sidebar-brand\s*\{[^}]*min-height:\s*48px/s, "brand row is 48px");
assert.match(sidebarCss, /\.sidebar-primary-action\s*\{[^}]*height:\s*32px/s, "primary action is 32px");
assert.match(sidebarCss, /\.sidebar-folder-row--active\s*\{[^}]*border-left:\s*3px solid var\(--accent-presence\)/s, "active destination has the leading accent");
assert.match(sidebarCss, /\.sidebar-folder-row--active\s*\{[^}]*box-shadow:\s*inset 3px 0/s, "active destination has the inset glow");
assert.match(sidebarCss, /\.shell-nav--rail \.sidebar-brand__copy[\s\S]*?display:\s*none/s, "rail hides brand copy");
assert.match(sidebarCss, /\.shell-nav--rail \.sidebar-section-label[\s\S]*?display:\s*none/s, "rail hides group headings");
assert.match(sidebarCss, /\.shell-nav--rail \.sidebar-identity-footer[\s\S]*?width:\s*32px/s, "rail keeps a centered identity target");
assert.match(sidebarCss, /@media \(max-width: 1023px\)[\s\S]*?\.sidebar-primary-action[\s\S]*?min-height:\s*var\(--touch-target\)/s, "drawer controls retain touch targets");
assert.doesNotMatch(sidebarCss, /#E53935|openclaw\.ai/i, "sidebar styling uses Cave tokens only");
```

- [ ] **Step 2: Run parity and host tests to verify RED**

```bash
node --experimental-strip-types src/components/sidebar-opentrust-parity.test.ts
node --experimental-strip-types src/components/sidebar-minimal.test.ts
node --experimental-strip-types src/components/workspace-sidebar-wiring.test.ts
```

Expected: FAIL on the missing OpenTrust geometry/state rules.

- [ ] **Step 3: Add the shared region rules**

Add a final `OpenTrust parity` section to `sidebar-minimal.css` so it intentionally wins over legacy selectors while migration is in progress:

```css
.sidebar-minimal,
.workspace-sidebar__full {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-brand {
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  flex: 0 0 auto;
}
.sidebar-brand__mark {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-control);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 32px;
  background: color-mix(in oklch, var(--accent-presence) 28%, var(--bg-raised));
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent-presence) 45%, transparent);
}
.sidebar-brand__copy { min-width: 0; display: grid; gap: 2px; line-height: 1; }
.sidebar-brand__name { color: var(--text-primary); font-size: 14px; font-weight: 650; letter-spacing: -0.01em; }
.sidebar-brand__byline { color: var(--text-muted); font-size: 10px; font-weight: 550; letter-spacing: 0.04em; }

.sidebar-primary-actions { display: flex; gap: 8px; padding: 8px; }
.sidebar-primary-action,
.sidebar-search-action {
  height: 32px;
  border-radius: var(--radius-control);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-hairline);
}
.sidebar-primary-action {
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-start;
  gap: 8px;
  padding: 0 8px;
  color: var(--accent-presence-foreground);
  background: var(--accent-presence);
  border-color: color-mix(in oklch, var(--accent-presence) 75%, var(--border-hairline));
  font-size: 13px;
  font-weight: 600;
}
.sidebar-search-action { flex: 0 0 32px; width: 32px; color: var(--text-secondary); background: transparent; }
.sidebar-primary-action:hover { filter: brightness(1.06); }
.sidebar-search-action:hover { color: var(--text-primary); background: var(--bg-hover); }

.sidebar-nav-scroll { gap: 0; padding: 0; }
.sidebar-menu-group { display: flex; flex-direction: column; gap: 0; padding: 0 8px; }
.sidebar-tools { padding-top: 8px; }
.sidebar-section-label { min-height: 32px; padding: 0 16px; display: flex; align-items: center; color: var(--text-muted); font-size: 12px; font-weight: 550; }
.sidebar-folder-row,
.sidebar-utility-row {
  position: relative;
  min-height: 32px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-left: 3px solid transparent;
  border-radius: var(--radius-control);
  color: var(--text-secondary);
  background: transparent;
  font-size: 13px;
  text-align: left;
}
.sidebar-folder-row:hover,
.sidebar-utility-row:hover { color: var(--text-primary); background: var(--bg-hover); }
.sidebar-folder-row--active {
  border-left: 3px solid var(--accent-presence);
  color: var(--text-primary);
  background: color-mix(in oklch, var(--accent-presence) 12%, transparent);
  box-shadow: inset 3px 0 12px color-mix(in oklch, var(--accent-presence) 14%, transparent);
  font-weight: 600;
}
.sidebar-folder-row--split { background: color-mix(in oklch, var(--accent-presence) 7%, transparent); }
.sidebar-badge { margin-left: auto; min-width: 20px; height: 20px; border-radius: 6px; }

.sidebar-utility { margin-top: auto; display: flex; flex-direction: column; padding: 8px; }
.sidebar-utility-row { min-height: 28px; font-size: 12px; text-decoration: none; }
.sidebar-identity-footer { flex: 0 0 auto; padding: 8px; border-top: 1px solid var(--border-hairline); }
.sidebar-attribution { padding: 0 8px 8px; color: var(--text-muted); font-size: 10px; font-weight: 550; letter-spacing: 0.05em; text-transform: uppercase; }
.sidebar-identity-control .familiar-switcher__trigger--labeled { width: 100%; min-height: 48px; padding: 8px; justify-content: flex-start; border-radius: var(--radius-control); }
.sidebar-identity-control .familiar-switcher__trigger-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-identity-control .familiar-switcher__trigger-caret { margin-left: auto; }
```

- [ ] **Step 4: Add designed rail and Chat-host rules**

Add:

```css
.shell-nav--rail { padding-inline: 0; overflow: hidden; }
.shell-nav--rail .sidebar-minimal,
.shell-nav--rail .workspace-sidebar__full { width: 48px; align-items: center; }
.shell-nav--rail .sidebar-brand { padding: 8px; }
.shell-nav--rail .sidebar-brand__copy,
.shell-nav--rail .sidebar-section-label,
.shell-nav--rail .sidebar-folder-label,
.shell-nav--rail .sidebar-badge,
.shell-nav--rail .sidebar-primary-action > span,
.shell-nav--rail .sidebar-search-action,
.shell-nav--rail .sidebar-utility-row > span,
.shell-nav--rail .sidebar-attribution,
.shell-nav--rail .cnav__search-wrap,
.shell-nav--rail .cnav__scroll,
.shell-nav--rail .cnav__error { display: none; }
.shell-nav--rail .sidebar-primary-actions,
.shell-nav--rail .sidebar-menu-group,
.shell-nav--rail .sidebar-utility { width: 48px; padding-inline: 8px; }
.shell-nav--rail .sidebar-primary-action,
.shell-nav--rail .sidebar-folder-row,
.shell-nav--rail .sidebar-utility-row { width: 32px; min-width: 32px; padding: 0; justify-content: center; }
.shell-nav--rail .sidebar-identity-footer { width: 32px; padding: 8px 0; margin-inline: 8px; }
.shell-nav--rail .sidebar-identity-control .familiar-switcher__trigger--labeled { width: 32px; min-width: 32px; min-height: 32px; height: 32px; padding: 0; justify-content: center; }
.shell-nav--rail .sidebar-identity-control .familiar-switcher__trigger-label,
.shell-nav--rail .sidebar-identity-control .familiar-switcher__trigger-caret { display: none; }

.cnav__toolbar { display: flex; gap: 4px; padding: 0 8px 8px; }
.cnav__toolbar > button { width: 32px; height: 32px; border-radius: var(--radius-control); }
.workspace-sidebar__rail { display: none; }
```

Update the rail rules only as needed after inspecting actual rendering; the invariants are a 48px host, centered 32px targets, hidden contextual thread content, visible product/new-chat/utility/identity targets, and no horizontal overflow.

- [ ] **Step 5: Preserve mobile touch targets and reduced motion**

Inside the existing `max-width: 1023px` block, add the new shared controls to the 44px minimum target rule:

```css
.sidebar-primary-action,
.sidebar-search-action,
.sidebar-folder-row,
.sidebar-utility-row,
.sidebar-identity-control .familiar-switcher__trigger--labeled {
  min-height: var(--touch-target);
}
```

Keep existing `prefers-reduced-motion` coverage. Do not add new always-on animation beyond the shell's existing width/peek transition.

- [ ] **Step 6: Remove obsolete CSS after GREEN**

Delete rules whose only consumers are removed markup:

- `.sidebar-familiar-switch` top-header placement overrides;
- `.workspace-sidebar__rail` / `.chat-sidebar__rail` vertical-label presentation;
- old `.sidebar-foot*` and `.sidebar-version` rules after `SidebarFooter` is removed;
- duplicate late overrides that contradict 32px rows, 48px rail, active leading indicator, or footer identity placement.

Use:

```bash
rg -n 'sidebar-familiar-switch|workspace-sidebar__rail|chat-sidebar__rail|sidebar-foot|sidebar-version' src --glob '!*.test.ts'
```

Expected after cleanup: no production markup consumers; any remaining matches are explanatory migration comments that should be updated or removed.

- [ ] **Step 7: Run CSS and host tests GREEN**

```bash
node --experimental-strip-types src/components/sidebar-opentrust-parity.test.ts
node --experimental-strip-types src/components/sidebar-minimal.test.ts
node --experimental-strip-types src/components/workspace-sidebar-wiring.test.ts
node --experimental-strip-types src/components/sidepanel-nav-peek.test.ts
node --experimental-strip-types src/components/mobile-shell-smoke.test.ts
```

Expected: all exit 0.

- [ ] **Step 8: Stage the visual checkpoint**

```bash
git add src/styles/sidebar-minimal.css src/components/sidebar-minimal.test.ts src/components/workspace-sidebar-wiring.test.ts src/components/sidebar-opentrust-parity.test.ts
git diff --cached --check
```

## Task 6: Add rendered desktop, rail, Chat, and mobile verification

**Files:**

- Create: `tests/sidepanel-opentrust-parity.spec.ts`
- Modify: Playwright config only if the existing projects cannot run the new test unchanged.

- [ ] **Step 1: Write the Playwright test before any runtime-only fixes**

Create:

```ts
import { expect, test } from "@playwright/test";

test.describe("OpenTrust sidepanel parity", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".shell-nav-panel");
  });

  test("expanded standard host follows the reference composition", async ({ page }) => {
    const panel = page.locator(".shell-nav-panel");
    if ((await panel.boundingBox())!.width < 200) {
      await page.getByRole("button", { name: /collapse navigation|expand navigation/i }).click();
    }
    await expect(panel).toHaveCSS("width", "256px");
    const nav = page.getByRole("navigation", { name: "Workspace navigation" });
    await expect(nav.locator(".sidebar-brand")).toBeVisible();
    await expect(nav.getByRole("button", { name: "New chat" })).toBeVisible();
    await expect(nav.getByText("Cave tools", { exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: /switch familiar/i })).toBeVisible();
  });

  test("collapsed host is a 48px icon rail", async ({ page }) => {
    const panel = page.locator(".shell-nav-panel");
    if ((await panel.boundingBox())!.width >= 200) {
      await page.getByRole("button", { name: /collapse navigation|expand navigation/i }).click();
    }
    await expect(panel).toHaveCSS("width", "48px");
    await expect(page.locator(".sidebar-brand__mark")).toBeVisible();
    await expect(page.locator(".sidebar-brand__copy")).toBeHidden();
    await expect(page.locator(".sidebar-identity-control .familiar-switcher__trigger")).toBeVisible();
  });

  test("Chat uses the same chrome around thread navigation", async ({ page }) => {
    await page.getByRole("button", { name: /^Chat/ }).click();
    await expect(page.locator(".workspace-sidebar__full .sidebar-brand")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Chat threads" })).toBeVisible();
    await expect(page.locator(".workspace-sidebar__full .sidebar-identity-footer")).toBeVisible();
  });
});
```

For the phone project, add a test that opens the top-bar sidebar button and asserts the drawer panel width is 288px or `86vw` when the viewport is narrower than 335px, every row has at least 44px height, and Escape closes the drawer.

- [ ] **Step 2: Run the test to identify runtime gaps**

```bash
pnpm exec playwright test tests/sidepanel-opentrust-parity.spec.ts --project=chromium
pnpm exec playwright test tests/sidepanel-opentrust-parity.spec.ts --project=pixel-5
```

Expected before runtime fixes: at least one assertion fails on selector, measured width, rail visibility, or mobile target geometry. A missing browser binary is an environment setup error; run `pnpm e2e:install` once and rerun.

- [ ] **Step 3: Fix only evidenced runtime gaps**

Adjust shared chrome/CSS/host markup to resolve the observed mismatch. Do not weaken measurements or remove coverage. Preserve the source-contract tests while fixing runtime behavior.

- [ ] **Step 4: Run rendered tests GREEN**

Repeat both commands from Step 2. Expected: all parity tests pass on desktop and phone projects.

- [ ] **Step 5: Stage the runtime checkpoint**

```bash
git add tests/sidepanel-opentrust-parity.spec.ts src/components src/styles/sidebar-minimal.css src/app/globals.css
git diff --cached --check
```

## Task 7: Real-app comparison and completion audit

**Files:**

- Modify only files implicated by observed comparison gaps.
- Update: Bead `cave-9q0v` notes with verification evidence.

- [ ] **Step 1: Run focused and wiring gates**

```bash
pnpm check:tests-wired
node --experimental-strip-types src/components/sidebar-opentrust-parity.test.ts
node --experimental-strip-types src/components/sidebar-minimal.test.ts
node --experimental-strip-types src/components/workspace-sidebar-wiring.test.ts
node --experimental-strip-types src/components/shell-left-panels-fit.test.ts
node --experimental-strip-types src/components/sidepanel-nav-peek.test.ts
node --experimental-strip-types src/components/shell-drawer-smoke.test.ts
node --experimental-strip-types src/components/mobile-shell-smoke.test.ts
```

Expected: all exit 0.

- [ ] **Step 2: Run full static and application gates**

```bash
pnpm test:app
pnpm typecheck
pnpm build
```

Expected: 0 failures and exit 0 for every command. Record exact counts/output summaries in the bead.

- [ ] **Step 3: Launch and compare the real apps**

Launch Coven Cave through the repo-supported app/browser verification workflow and OpenTrust through its documented dev command. Capture and compare:

1. standard expanded Home;
2. standard 48px rail;
3. Chat expanded with projects/threads;
4. Chat rail;
5. phone drawer;
6. familiar menu from expanded and rail states.

For each state verify region order, 256/48/288 geometry, 32px row density, 48px brand/identity rows, active leading accent, label hiding/centering in the rail, footer placement, focus visibility, and absence of horizontal scrolling.

- [ ] **Step 4: Exercise keyboard and preservation paths**

Manually verify:

- Command-K opens Search from both sidebar affordances.
- Command-B toggles expanded/rail.
- Arrow Up/Down/Home/End navigate the standard rows.
- New Chat works from both hosts and the rail.
- familiar single/all/multi selection still updates scope.
- role rooms, badges, and split-drag remain visible/functional when applicable.
- Chat organizer, search, pinned rows, project expansion, session open/delete, Scheduled, and Plugins still work.
- mobile navigation dismisses the drawer and Escape/tap-outside closes it.

- [ ] **Step 5: Perform the requirement-by-requirement audit**

Read the design's `Completion Evidence` section and classify each requirement from current evidence as proven, contradicted, incomplete, or missing. Continue implementation for any item not proven. Do not treat green tests alone as proof of visual parity.

- [ ] **Step 6: Record the handoff without committing or pushing**

```bash
git status --short
git diff --cached --stat
git diff --check
bd update cave-9q0v --notes '<append branch, worktree, changed files, exact test/build results, rendered comparison states, and any remaining gap>'
```

Do not close the bead until merge or explicit completion criteria are satisfied. Report the proposed commit/PR commands and wait for authority under the conservative profile.

---

## Execution record

- Implemented on `feat/opentrust-sidebar-parity`, rebased/fast-forwarded to
  `origin/main` at `0c00c069`; reference remained OpenTrust `11a4ac9`.
- GitHub Desktop created implementation commit `8f91b688` while the session was
  active. Follow-up runtime findings remain as an explicit working-tree handoff
  under the repository's conservative no-commit/no-push policy.
- The temporary Playwright measurement script was intentionally removed after
  verifying expanded Home, rail, Chat, familiar menu, and settled phone drawer.
  Measurements: 255px rendered expanded panel (256px including divider), 47px
  rendered rail (48px including divider), 32px desktop controls, 288px phone
  drawer, 44px phone controls, and zero horizontal document overflow.
- Verification evidence: all 799 tests wired; all 593 app test files passed;
  `pnpm typecheck` passed; `pnpm build` and bundle budgets passed. The build
  retained the two pre-existing dynamic file-tracing warnings.
- Bead `cave-9q0v` remains open until merge or explicit completion criteria are
  satisfied, per the Coven Familiar Beads Protocol.
