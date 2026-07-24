# Code as a Coding-familiar room + explicit familiar Types

- **Date:** 2026-07-23
- **Bead:** cave-cc5r
- **Status:** approved (design review in session; owner approved all flagged behavior changes)

## Problem

The Code surface (cave-k0ua/cave-m6ys) is a top-level destination visible to
every familiar. Research, by contrast, is a *Role Surface*: a room the Cave
opens only for familiars whose vocation matches. The owner wants Code gated
the same way — visible only via a **Coding** familiar type — and wants the
type assignment to be **explicit and modifiable**, not inferred-only from
free-text role labels.

## Decisions (owner-approved)

1. **Architecture:** convert Code into a registered Role Surface room (not a
   familiar-gated top-level mode).
2. **Non-coding familiars** see the standalone **GitHub** row again
   (pre-absorption behavior, assigned-work badge kept).
3. **"All familiars" scope:** strict — no active familiar means no Code room
   (GitHub row shows).
4. **Type assignment:** an explicit **Type** picker in Familiar Studio →
   Identity, stored as an override; the free-text Role label keeps granting
   rooms as before (types add, never subtract).

## Design

### 1. Code room (Role Surface)

- `register.tsx` registers `id: "code"` (`CODE_SURFACE_ID` in ids.ts),
  `role: "coder"`, aliases `["coding", "developer", "engineer", "programmer",
  "software-engineer", "code"]` — the "Code reviewer" summoning preset
  (token `code`) qualifies.
- A thin adapter (`code-room.tsx`) renders the existing `CodeView` inside the
  room. No CodeView internals change.
- `RoleSurfaceContext` gains two generic shell services (same posture as
  `openUrl`/`openSession`): `focusCard(cardId)` and `refreshTasks()`; wired
  through `use-role-surfaces` from Workspace.
- `pending-code-open.ts` becomes a small module store
  (`useSyncExternalStore`): Workspace's `cave:open-project-file` /
  `cave:open-file-diff` / `cave:browse-project-files` handlers write it and
  `setMode("code")`; the room adapter consumes it. Workspace's local
  `pendingCodeOpen` state is removed.
- **Behavior changes:** (a) the room's session rail scopes to the active
  familiar's sessions plus unattributed ones (context's native shape);
  (b) the room's sidebar row carries no numeric badge (the GitHub row keeps
  the assigned count for non-coding familiars); (c) non-coding deep links hit
  RoleSurfaceHost's explicit "room stays closed" door.

### 2. Modes & deep links

- `github` returns to `CanonicalWorkspaceMode`, rendering the standalone
  `GitHubView` (dynamic wrapper restored in lazy-surfaces). GitHub-item URL
  opens (`openGitHubTarget`) land there for everyone.
- `code` moves to `AliasWorkspaceMode`; `MODE_ALIASES.code = "surface:code"`
  (the table's value type widens to `CanonicalWorkspaceMode |
  RoleSurfaceMode`). `setMode` rewrites `code` → `surface:code` (the
  `journal`/`flow` idiom), so `?mode=code`, palette intents, and
  `cave:navigate-mode` all land in the room; `sidebar-nav-state` lights the
  room row for code-mode splits via the same table.
- Familiar-switch fallback: the existing generic effect (role-surface mode +
  familiar can't see it → Home) already covers Code.

### 3. Sidebar & palette

- FOLDER_MODES: the static Code row is replaced by the restored GitHub row
  (quiet, assigned-count badge). SidebarMinimal hides the GitHub row while
  the Code room is visible for the active familiar
  (`hideGithubRow` prop computed in Workspace from `visibleSurfaces`).
- The Code room row rides the existing role-surfaces "Rooms" cluster.
- CommandPalette gains an optional `roleSurfaces` prop so "Go to Code
  Workshop" (and other rooms) keep ⌘K parity with sidebar rows.

### 4. Explicit familiar Type

- New `src/lib/familiar-types.ts`: a static `FAMILIAR_TYPES` table —
  General (default, grants nothing), Coding → `coder`, Research →
  `researcher`, Review → `reviewer`, Writing → `scribe`, Comms →
  `messenger`, Watch → `sentinel`, Planning → `navigator`, Indexing →
  `indexer` — each with label, unlock description, and icon.
- `familiarType` field added to: `Familiar` (types.ts), `FamiliarBinding`
  (cave-config.ts — PATCH `/api/config` merge is generic, no route change),
  `/api/familiars` enrichment, `FamiliarOverride` +
  `familiar-resolve.ts` resolution.
- `familiarRoleIds()` accepts the optional `familiarType` and adds the
  type's id + role token to the granted set — so the picker also unlocks
  research/review/… rooms. Role-label tokens keep granting exactly as
  before.
- Familiar Studio → Identity gets a "Type" chip radio-row above the text
  fields with per-type unlock descriptions.

## Testing

- Rewrite `code-surface-mode.test.ts` pins to the new shape (room
  registration, alias funnel, standalone GitHub branch, adapter wiring).
- Update `workspace-alias-modes.test.ts`, `canonical-nav-names.test.ts`,
  `palette-canonical-names.test.ts`, sidebar pins.
- New `familiar-types.test.ts` (table ↔ role tokens, familiarRoleIds
  integration); identity-tab pin for the Type picker.
- `tests/code-surface.spec.ts`: the mocked familiar becomes Coding-type.
- Remove the dead `NEXT_PUBLIC_CAVE_CODE_SURFACE` env from
  playwright.config.ts if still present.
