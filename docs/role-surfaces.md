# Role Surfaces

The Cave is role-aware, not role-hardcoded. Familiars carry one or more roles —
their `role` label plus any active `ROLE.md` manifests — and each role may
expose specialized **Role Surfaces**: rooms within the Cave built for that
vocation (an analyst's desk, an operations center, an archive…).

## Architecture

| Piece | File | Responsibility |
| --- | --- | --- |
| Registry + types | `src/lib/role-surfaces.ts` | `RoleSurface`, `RoleSurfaceContext`, `RoleSurfaceContribution`, registration, role matching, priority sort, the generic `surface:<id>` mode bridge |
| Per-room state | `src/lib/role-surface-state.ts` | UI state keyed `surfaceState[familiarId][surfaceId]`, persisted under `cave:role-surface:*` |
| Session bridge | `src/lib/use-role-surfaces.ts` | Builds the shared context from the live Cave session (memory/tools/plugins adapters over real APIs) and resolves visible surfaces |
| Generic host | `src/components/role-surface-host.tsx` | Looks the surface up, applies contributions (shortcuts, toolbar, status, notifications, commands), renders it inside room chrome |
| Rooms | `src/components/role-surfaces/` | The registered surfaces themselves + `surface-room.tsx` layout primitives |
| Manifest | `src/components/role-surfaces/register.tsx` | The ONE place initial rooms are named; code-split via `next/dynamic` |

The shell (`workspace.tsx`, `sidebar-minimal.tsx`, `shell.tsx`) handles only
the generic `surface:<id>` workspace mode. It never names a role —
`src/components/role-surface-shell.test.ts` enforces this.

## How the Cave uses the registry

1. `workspace.tsx` imports the manifest for its side effect; every module that
   calls `registerRoleSurface` at import time appears identically.
2. `useRoleSurfaceSession` builds one `RoleSurfaceContext` per active familiar
   and resolves `resolveVisibleRoleSurfaces(listRoleSurfaces(), roleIds, ctx)`:
   role match → `shouldDisplay` gate → priority sort.
3. Visible surfaces render as sidebar rows (the "Rooms" cluster) whose mode is
   `surface:<id>`; the detail pane routes that mode to `RoleSurfaceHost`.
4. Room UI state survives switching surfaces and familiars via
   `useRoleSurfaceState(familiarId, surfaceId, initial)`.

## Role assignment

A familiar holds a role when either matches (normalized, e.g. `"Research
Analyst"` → `research-analyst` + `research` + `analyst`):

- its `role` label (whole string or any word token), or
- an **active** role manifest (`/api/roles` entry) with that id or name.

## Adding a new role surface

```tsx
import { registerRoleSurface } from "@/lib/role-surfaces";

registerRoleSurface({
  id: "sentinel-watchtower",
  role: "sentinel",
  title: "Watchtower",
  iconName: "ph:binoculars",       // must be in ICON_NAMES (src/lib/icon.tsx)
  description: "Alerts, monitors, and perimeter state",
  accentHue: 40,                    // the room's glow
  priority: 15,
  shouldDisplay: () => true,
  getContributions: (ctx) => ({ /* commands, shortcuts, status… */ }),
  render: (ctx) => <WatchtowerSurface context={ctx} />,
});
```

Register it from `register.tsx` (or any imported module) — no shell edits.
Honest data only: if a backing API doesn't exist yet, show a real empty state,
never fake production data.

## Initial rooms

- **Research Desk** (`researcher-desk`, role `researcher`) — mission-first
  research intake with explainable Brief/Sweep/Paper/Autoresearch routing,
  real Flow progress, provenance-rich Knowledge artifacts, structured sources,
  checkpoints, and finite linked Codex Automations.
- **Comms Operations** (`messenger-ops`, role `messenger`) — channel-aware
  drafting (email/Discord/Slack/SMS/Teams/social), approval-required states,
  real inbox items, delivery queue drawer. Nothing sends externally — no
  delivery integration exists, and the surface says so.
- **The Archive** (`indexer-archive`, role `indexer`) — real memory inventory
  grouped into collections, semantic tags/clusters, provenance details,
  redacted content preview, indexing-activity drawer.
