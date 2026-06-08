# Agents page — design

**Date:** 2026-06-08
**Status:** Approved for planning
**Owner:** @bunsthedev

## 1. Summary

Add a dedicated **Agents** surface as the new default landing tab. The page is a roster overview of every familiar (cards on a grid) with in-place drill-in to a per-familiar detail panel that exposes Memory, Files, and Sessions. A header-level action opens a global "memory across all agents" overlay.

The page reuses the existing memory primitives (`/api/coven-memory`, `/api/memory`, `AgentsMemoryView`, `MemoryGraph3D`) rather than re-implementing them. No new API routes.

## 2. Goals & non-goals

### Goals
- A single surface where the user can see all familiars at a glance instead of one selected familiar at a time.
- Quick visual triage: identity + live status + recent activity + memory snapshot per card.
- One click into a per-familiar detail view with Memory / Files / Sessions, without leaving the Agents surface.
- Cross-agent memory view accessible from the same page (overlay, not a separate workspace mode).
- Becomes the first-run landing tab (replaces Home as the initial workspace mode).

### Non-goals (v1)
- No new file-browser surface (workspace tree, project files, vault). "Files" means the memory `.md` files already returned by `/api/memory`.
- No failure-distillation integration (the `MemoryInspectorPanel` data stays where it is).
- No edit/delete of memory entries from this page (read-only).
- No multi-select across cards.
- No real-time SSE updates for memory (the existing 30s poll is fine for v1).
- No per-familiar scoping of `/api/memory` files (today the endpoint is global; the Files tab inherits that limitation — flagged below).

## 3. Workspace integration

### 3.1 New workspace mode
Add `"agents"` to the `WorkspaceMode` union in `src/lib/workspace-mode.ts`. Add it to `SURFACE_LABELS` in `src/components/workspace.tsx`. Add `"agents"` to `FolderMode` and to `FOLDER_MODES` in `src/components/sidebar-minimal.tsx` under the **Work** group, positioned first (above Home). Icon: `ph:users-three`.

### 3.2 Keyboard shortcut shift
The current `SURFACE_ORDER` array (workspace.tsx ~line 549) maps `⌘1..⌘8`. Prepending Agents shifts everything one slot:

| Shortcut | Before | After |
| --- | --- | --- |
| ⌘1 | Home | **Agents** |
| ⌘2 | Chat | Home |
| ⌘3 | Board | Chat |
| ⌘4 | Calendar | Board |
| ⌘5 | Inbox | Calendar |
| ⌘6 | Library | Inbox |
| ⌘7 | Browser | Library |
| ⌘8 | Terminal | Browser |
| (none) | — | Terminal (palette-only) |

Update `kbd` strings in `FOLDER_MODES` accordingly. Terminal stays in the sidebar but loses its shortcut hint.

### 3.3 Default landing
`workspace.tsx` line 75 changes from `useState<WorkspaceMode>("home")` to `useState<WorkspaceMode>("agents")`. The `getLastSurface(activeId)` mechanism is preserved unchanged — returning users who left off elsewhere still resume there; only first-run sessions (no `lastSurface` recorded) land on Agents.

### 3.4 Companion rail
When `mode === "agents"`, the right-side `CompanionRail` is hidden — same pattern as `mode === "browser"` at `workspace.tsx:1036`. Agents is a full-width surface and would conflict with a per-familiar rail.

## 4. Component architecture

One new file: `src/components/agents-view.tsx`. One sibling pure-derivation module: `src/components/agents-view-stats.ts`. Both colocated tests.

### 4.1 `AgentsView` — container

```ts
type AgentsViewProps = {
  familiars: Familiar[];
  sessions: SessionRow[];
  daemonRunning: boolean;
  responseNeeded: Set<string>;
  onStartChat: (familiarId: string) => void;
  onOpenSession: (sessionId: string, familiarId?: string | null) => void;
  onOpenMemoryFile: (path: string) => void;
  onOpenOnboarding: () => void;
};
```

Owns state:
- `selectedFamiliarId: string | null` — persisted to `localStorage` under `cave:agents.lastSelected`.
- `viewMode: "roster" | "detail" | "global-memory"` — not persisted.
- `query: string` — roster search input.
- `roleFilter: string | null` — optional chip filter (deferred; v1 = search only).
- `covenEntries: CovenMemoryEntry[]`, `fileEntries: FileMemoryEntry[]` — fetched on mount + 30s interval.
- `memoryError: string | null`, `memoryLoaded: boolean`.

Renders:
- Page header (title + search + "Memory across all agents" button + refresh).
- Body: `viewMode === "roster"` → grid of `AgentRosterCard`. `viewMode === "detail"` → `<AgentDetailRail />` + `<AgentDetailPanel />`. Independent of `viewMode`: when `"global-memory"`, render the active body underneath and stack the modal overlay on top.

### 4.2 `AgentRosterCard`

```ts
type AgentRosterCardProps = {
  familiar: Familiar;
  stats: AgentCardStats;
  responseNeeded: boolean;
  daemonRunning: boolean;
  memoryAvailable: boolean;
  onSelect: () => void;
};
```

Layout (top to bottom, ~180px tall, min ~280px wide):
1. **Identity row** — glyph + display name + small role/harness badge.
2. **Status row** — daemon dot (online/offline), `response-needed` chip, "active session" pill if `stats.hasActiveSession`.
3. **Activity line** — `"Last session 2h ago · 14 sessions this week"` (uses `stats.lastSessionAt`, `stats.sessionsLast7d`). Hidden if zero sessions.
4. **Memory snapshot** — `"23 memories · last write 5m ago"` and second line truncated `stats.latestMemory.title`. If `!memoryAvailable`, single muted line "Memory unavailable". If zero memories, "No memories yet".
5. **Footer** — the whole card is clickable (`onSelect`); footer just contains a chevron `→` icon.

Responsive grid: `grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.

### 4.3 `AgentDetailPanel`

```ts
type AgentDetailPanelProps = {
  familiar: Familiar;
  familiars: Familiar[];
  sessions: SessionRow[];
  covenEntries: CovenMemoryEntry[];
  fileEntries: FileMemoryEntry[];
  memoryError: string | null;
  onClose: () => void;
  onStartChat: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenMemoryFile: (path: string) => void;
};
```

Header: glyph + name + role/harness + "Back to roster" + actions ("Start chat", "Open in chat tab").

Tabs (default = Memory):
- **Memory** — `<AgentsMemoryView familiars={familiars} activeFamiliar={familiar} mode="list" lockToFamiliar />`. The familiar `<select>` inside `AgentsMemoryView` is suppressed by the new `lockToFamiliar` prop because the surrounding detail context has already chosen.
- **Files** — `<MemoryFilesList entries={fileEntries} onOpen={onOpenMemoryFile} />` (extracted in §4.5).
- **Sessions** — `sessions.filter(s => s.familiarId === familiar.id)` rendered as a click-through list (click → `onOpenSession(id)`).

### 4.4 `AgentDetailRail`

A thin (~64px) left column shown when `viewMode === "detail"`. Renders:
- "Back to grid" button at the top.
- Vertical stack of familiar avatars (clickable to switch detail without going back to the grid).

Built fresh in `agents-view.tsx`. `FamiliarAvatarRail` is coupled to workspace-level state (selectFamiliar, sessions, responseNeeded for the whole app) and reuse would mean threading props that don't apply here. The rail is small enough that a fresh implementation is cleaner.

### 4.5 Minor refactor in `AgentsMemoryView`

- Add prop `lockToFamiliar?: boolean`. When true, render the familiar `<select>` as a static read-only chip (`{familiar.display_name}`) instead of a dropdown.
- Extract the file-list `<section>` (lines 345-378 of `agents-memory-view.tsx`) into a new exported `MemoryFilesList` component (props: `entries: FileMemoryEntry[]`, `onOpen?: (path: string) => void`, `loaded: boolean`, `error: string | null`). The existing single-view layout keeps using it inline — no visual change to that surface. `AgentDetailPanel`'s Files tab consumes it directly.

### 4.6 `GlobalMemoryOverlay`

Modal-style overlay (full-screen dim backdrop, content panel ~90vw × 85vh). Renders `<AgentsMemoryView familiars={familiars} activeFamiliar={null} />` — both list and graph modes available via its built-in toggle, defaulting to graph for the "all agents at once" feel. Dismisses on Esc, backdrop click, or the close button. `selectedFamiliarId` and `viewMode === "detail"` are preserved when the overlay opens and closes.

## 5. Data flow

### 5.1 API consumption (all existing)
- `GET /api/coven-memory` → `CovenMemoryEntry[]` (familiar-scoped memory rows).
- `GET /api/memory` → `FileMemoryEntry[]` (memory `.md` files; global, not familiar-scoped).
- `GET /api/sessions/list` → `SessionRow[]` (already polled by workspace.tsx every 4s — passed in as props).
- `GET /api/familiars` → `Familiar[]` (already fetched by workspace.tsx — passed in as props).

`AgentsView` fetches `/api/coven-memory` and `/api/memory` on mount and on a 30s interval (mirrors the existing cadence in `agents-memory-view.tsx:115`). Plus a manual "Refresh" button in the header.

### 5.2 Derived per-card stats

Pure function exported from `src/components/agents-view-stats.ts`:

```ts
export type AgentCardStats = {
  memoryCount: number;
  latestMemory: { title: string; updatedAt: string } | null;
  lastSessionAt: string | null;
  sessionsLast7d: number;
  hasActiveSession: boolean; // session.updated_at within last 5 minutes
};

export function buildAgentCardStats(args: {
  familiars: Familiar[];
  sessions: SessionRow[];
  covenEntries: CovenMemoryEntry[];
  now?: number; // injected for testing
}): Map<string, AgentCardStats>;
```

Single `useMemo` keyed on `(familiars, sessions, covenEntries)`. O(n + m), no per-card filtering at render time.

### 5.3 viewMode state machine

```
roster ──click card──▶ detail (selectedFamiliarId set)
detail ──Back / Esc──▶ roster
roster ──"All memory"─▶ global-memory (modal; roster stays mounted underneath)
detail ──"All memory"─▶ global-memory (modal; detail stays mounted)
global-memory ──Esc/close──▶ previous viewMode
```

`selectedFamiliarId` is read from `localStorage` on mount. If present and the familiar still exists, the page boots into `viewMode === "detail"`. Otherwise it boots into `roster`.

### 5.4 Cross-component navigation

Card "Start chat" and detail "Open in chat tab" call workspace-supplied callbacks (`onStartChat`, `onOpenSession`) which already do `setActiveId + setMode("chat")`. No new plumbing.

## 6. Empty / loading / error states

| Condition | Behavior |
| --- | --- |
| No familiars (first run) | Centered empty state replaces the grid: glyph + "No familiars yet" + "Set up your first familiar" button → `onOpenOnboarding()`. |
| `daemonRunning === false` | Cards render with cached data; status row shows offline dot. The existing global `useShellBanners` daemon-offline banner covers the page-level signal — no duplicate banner. |
| `/api/familiars` failed (`familiarsError`) | Workspace already falls back to demo familiars or empty list. Empty state same as "no familiars". Error is surfaced via the existing shell banner mechanism, not duplicated here. |
| `/api/coven-memory` or `/api/memory` failed | Per-card snapshot shows "Memory unavailable" (muted, single line). Page header shows one inline error chip with a Refresh button. Roster stays fully interactive. |
| Loading (first paint) | Skeleton cards (same shape as `AgentRosterCard`, shimmer placeholders). Shown until either both fetches resolve OR `>2s` elapsed, whichever comes first. After 2s, cards render without snapshot rather than blocking. |
| Familiar has zero memories | Snapshot row reads "No memories yet" (muted). Detail Memory tab shows existing `AgentsMemoryView` empty state. |

## 7. Known v1 limitations

- **`/api/memory` is global.** It returns all memory `.md` files indexed by root, not scoped to a familiar. The Files tab inside `AgentDetailPanel` therefore shows the same global list regardless of which familiar is open. Flagged as a follow-up; would need an API change (`?familiarId=` filter) to fix.
- **No real-time updates.** Memory data refreshes on 30s poll or manual refresh. No SSE.
- **No edit/delete.** Read-only surface in v1.
- **`viewMode` not persisted.** Only `selectedFamiliarId` is. Refreshing while inside `global-memory` overlay returns to roster or detail (whichever the selection implies).
- **Demo mode.** When `DEMO_MODE` is on and familiars come from `DEMO_FAMILIARS`, memory APIs may return empty — cards still render with "No memories yet" snapshot.

## 8. Testing

Following the existing repo convention (colocated `*.test.ts`, vitest).

### 8.1 `agents-view-stats.test.ts` (pure)
- Empty inputs → empty map.
- Familiar with no sessions → `lastSessionAt: null`, `sessionsLast7d: 0`, `hasActiveSession: false`.
- Familiar with no memories → `memoryCount: 0`, `latestMemory: null`.
- 7-day window edge cases: session at exactly 7d ago → excluded; at 6d 23h → included.
- `hasActiveSession` edge: session updated at exactly 5min ago → false; at 4m 59s → true.
- Latest memory is the one with the max `updated_at`.

### 8.2 `agents-view.test.ts` (component)
- Renders one `AgentRosterCard` per familiar.
- Clicking a card sets `viewMode === "detail"` and `selectedFamiliarId`.
- "Back to roster" returns to `viewMode === "roster"`; `selectedFamiliarId` persists in localStorage.
- Reading `cave:agents.lastSelected` on mount boots into detail for that familiar (when it still exists).
- "Memory across all agents" button opens the overlay; Esc closes it; previous `viewMode` and `selectedFamiliarId` preserved.
- Empty state (zero familiars) renders the onboarding CTA and calls `onOpenOnboarding` on click.
- `memoryError` set → page-header error chip rendered; cards still respond to clicks.

### 8.3 `agent-roster-card.test.ts` (component)
- Identity row shows display name and harness badge.
- Status row shows daemon offline dot when `daemonRunning === false`.
- `responseNeeded` true → chip rendered.
- `stats.hasActiveSession` true → "active session" pill rendered.
- `stats.latestMemory.title` truncated past N characters.
- Card root has `role="button"` and fires `onSelect` on click and Enter/Space.

### 8.4 Workspace landing test
Either extend an existing workspace test or add `workspace-agents-landing.test.ts`:
- Fresh mount (no `lastSurface` in localStorage) → `mode === "agents"`.
- Returning user with `getLastSurface(activeId) === "board"` → resumes Board, not Agents.

### 8.5 Manual UI verification
Per the verification-before-completion skill — run the dev server and verify in a browser:
- `⌘1` selects Agents; `⌘2..⌘8` map to the shifted surfaces correctly.
- Click card → detail; "Back to roster" returns; selection persists across reload.
- Daemon-offline banner still renders above the Agents header (not duplicated inside).
- Companion rail is hidden on Agents (parity with Browser).
- Empty state appears when no familiars and the CTA opens onboarding.

## 9. Files touched

| File | Change |
| --- | --- |
| `src/lib/workspace-mode.ts` | Add `"agents"` to `WorkspaceMode`. |
| `src/components/workspace.tsx` | Add `"agents"` to `SURFACE_LABELS`; change initial `mode` to `"agents"`; route `mode === "agents"` to `<AgentsView />`; hide companion rail when `mode === "agents"`; update `SURFACE_ORDER` in the shortcut handler. |
| `src/components/sidebar-minimal.tsx` | Add `"agents"` to `FolderMode`; add entry to `FOLDER_MODES` first in Work; shift `kbd` values. |
| `src/components/agents-view.tsx` | **New.** Container + `AgentRosterCard` + `AgentDetailRail` + `AgentDetailPanel` + `GlobalMemoryOverlay`. |
| `src/components/agents-view-stats.ts` | **New.** Pure `buildAgentCardStats`. |
| `src/components/agents-memory-view.tsx` | Add `lockToFamiliar?: boolean` prop; extract `MemoryFilesList` as exported sibling. |
| `src/components/agents-view.test.ts` | **New.** |
| `src/components/agents-view-stats.test.ts` | **New.** |
| `src/components/agent-roster-card.test.ts` | **New.** |
| `src/components/workspace-agents-landing.test.ts` | **New.** |

## 10. Open questions (none blocking)

- Icon choice: `ph:users-three` vs. `ph:sparkle` vs. `ph:graph` — defer to visual pass during implementation.
- Should the detail rail (§4.4) show all familiars or only "active" ones (any session in last 24h)? V1 = all.
- Should "Memory across all agents" overlay default to graph or list mode? Spec says graph for the "feel"; revisit after manual verification.
