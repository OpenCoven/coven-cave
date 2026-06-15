# Chat Project Sidebar — Design

**Date:** 2026-06-11
**Status:** Approved

## Purpose

Add a collapsible left sidebar to the chats list page showing projects with their sessions, acting as a scope filter for the main list. Builds directly on the project grouping merged in PR #368 (`src/lib/chat-projects.ts`, `deriveChatProjectGroups`).

## Decisions (from brainstorming)

- **Sidebar role:** filter. Clicking a project scopes the main list to it; clicking a session in the sidebar opens that chat. "All chats" restores today's grouped view.
- **Collapse:** two levels — the whole sidebar toggles closed (slim reopen tab remains), and each project expands/collapses its session list. Both persist, plus the selected project.
- **Scope:** desktop only (`lg+`, 1024px). Below `lg` nothing changes (inline headers stay).

## Layout

In `ChatList` (`src/components/chat-list.tsx`), wrap the existing content in a flex row:

```
<div flex h-full>
  <ChatProjectSidebar/>   ← hidden lg:flex, ~210px fixed, border-r hairline
  <existing dossier header + list, flex-1 min-w-0/>
</div>
```

Fixed width; no `react-resizable-panels` (YAGNI). When collapsed, the aside renders only a slim vertical reopen tab (folder icon button, full height, ~24px wide).

## New component: `ChatProjectSidebar`

`src/components/chat-project-sidebar.tsx` — presentational; props in, events out:

```ts
type Props = {
  groups: ChatProjectGroup[];          // from deriveChatProjectGroups
  selection: ProjectSelection;          // "all" | "none" | <projectRoot>
  expandedKeys: string[];               // selection keys of expanded projects
  open: boolean;                        // sidebar open/collapsed
  activeSessionId?: string | null;
  onSetOpen(open: boolean): void;
  onSelect(selection: ProjectSelection): void;
  onToggleExpanded(key: string): void;
  onOpenSession(session: SessionRow): void;
  onNewChat(projectRoot: string | null): void;  // reuses the inline headers' scoped-launch path
};
```

Rendering:
- Header row: "Projects" kicker + collapse button (`ph:sidebar-simple`, registered in ICON_NAMES). Reopen tab uses `ph:folder`; project rows use `ph:caret-right`/`ph:caret-down` for expand state and `ph:folder` (`ph:folder-open` when selected).
- "All chats" row (selected style when `selection === "all"`).
- One row per group: caret (expand/collapse sessions), repo name (`repoName(projectRoot)` — same derivation chat-list uses; null root renders "No project"), session count badge, hover "+" new-chat button.
- Expanded project: indented session rows — status dot (existing status conventions), truncated title, click → `onOpenSession`. Active session gets the existing left-accent treatment.
- Selected project row also gets the accent treatment.

## Selection helpers: `src/lib/chat-project-selection.ts`

Pure, unit-tested:

```ts
export type ProjectSelection = "all" | "none" | string;  // string = projectRoot
export function selectionKey(root: string | null): string;          // null → "none"
export function applyProjectScope(groups: ChatProjectGroup[], sel: ProjectSelection): ChatProjectGroup[];
  // "all" → groups unchanged; otherwise the single matching group (flat render), [] if missing
export function normalizeSelection(sel: ProjectSelection, groups: ChatProjectGroup[]): ProjectSelection;
  // falls back to "all" when the selected project no longer exists
export function readPersisted<T>(key: string, fallback: T): T;       // JSON.parse with try/catch
```

## ChatList integration

- Sidebar tree data: `deriveChatProjectGroups(mine)` — familiar-scoped visible sessions **before** the search/unreads filters, so the tree is stable while typing.
- Main list: scope composes with the search/unreads filters (set intersection — order immaterial). `"all"` → current grouped rendering, unchanged. Specific project → that project's sessions flat (no project headers); the existing empty-state shows if filters leave nothing.
- State lives in `ChatList`:
  - `sidebarOpen` ⇄ `cave:chat:project-sidebar-open` (default `true`)
  - `expandedKeys` ⇄ `cave:chat:project-sidebar-expanded` (default `[]`)
  - `selection` ⇄ `cave:chat:project-selected` (default `"all"`), passed through `normalizeSelection` against current groups every render so stale selections degrade to "all" silently.
- Persistence via `useEffect` on change, `readPersisted` on init (lazy `useState` initializer; `typeof window` guard for SSR).

## Error handling

- Corrupt localStorage → defaults (safe parse).
- No groups → sidebar shows just "All chats".
- Selected project vanishes (archived/familiar switch) → `normalizeSelection` → "all".

## Out of scope (YAGNI)

- Mobile drawer; resizable width; project renaming/metadata; drag-and-drop; per-familiar persisted selections; changes to ChatRouter/ChatView.

## Testing

- `src/lib/chat-project-selection.test.ts` (registered in `test:app`): selectionKey, applyProjectScope ("all" passthrough, single match flat, missing → []), normalizeSelection fallback, readPersisted corrupt-input fallback.
- Existing `chat-list-delete` / `chat-list-mobile-command-center` tests stay green.
- Manual: collapse/expand/persist across reload; project-scoped new chat from sidebar; open session from sidebar; search composing with a selected project; below-1024px unchanged.

## Coordination

PR #368 (grouping) is merged; the `.wt/feat-project-chat-context` worktree is stale. Work happens in `.worktrees/chat-project-sidebar` per convention; 9 concurrent sessions are live on this machine — primary checkout untouched.
