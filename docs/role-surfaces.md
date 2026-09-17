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
| Build visibility | `src/lib/room-flags.ts` | Which registered rooms a *build* may show (see below) |

The shell (`workspace.tsx`, `sidebar-minimal.tsx`, `shell.tsx`) handles only
the generic `surface:<id>` workspace mode. It never names a role —
`src/components/role-surface-shell.test.ts` enforces this.

## How the Cave uses the registry

1. `workspace.tsx` imports the manifest for its side effect; every module that
   calls `registerRoleSurface` at import time appears identically.
2. `useRoleSurfaceSession` filters the registry through `roomEnabledInBuild`
   (build visibility, below), then resolves
   `resolveVisibleRoleSurfaces(surfaces, roleIds, ctx)`: role match →
   `shouldDisplay` gate → priority sort.
3. Visible surfaces render as sidebar rows (the "Rooms" cluster) whose mode is
   `surface:<id>`; the detail pane routes that mode to `RoleSurfaceHost`.
4. Room UI state survives switching surfaces and familiars via
   `useRoleSurfaceState(familiarId, surfaceId, initial)`.

## Build visibility (which rooms ship)

Registration says a room **exists**; `src/lib/room-flags.ts` says a build may
**show** it. A room has to clear both, and then role matching, before anyone
gets in. The registry stays open — this is a release gate, not an architecture
change.

A production build ships `PRODUCTION_ROOM_IDS`:

| Room | Ships in production |
| --- | --- |
| Research Desk (`researcher-desk`) | ✅ |
| Chart Room (`navigator-chart-room`) | ✅ |
| Coding Desk (`code`) | dev only — under construction |
| Review Deck (`reviewer-review-deck`) | dev only — under construction |
| Writing Desk (`scribe-writing-desk`) | dev only — under construction |
| Watchtower (`sentinel-watchtower`) | dev only — under construction |
| Comms Operations (`messenger-ops`) | dev only — under construction |
| The Archive (`indexer-archive`) | dev only — under construction |

A **dev build shows every room**, so an unfinished room is fully workable; it
joins the table's shipped half by moving its id into `PRODUCTION_ROOM_IDS`.

Override the default for a build with `NEXT_PUBLIC_CAVE_ROOMS`:

```bash
NEXT_PUBLIC_CAVE_ROOMS=all                    # every registered room
NEXT_PUBLIC_CAVE_ROOMS=researcher-desk,code   # exactly these two
```

When set, the variable is the **complete** allowlist — it replaces the default
rather than adding to it, in both directions, so what a build shows is always
readable off one value. Like every `NEXT_PUBLIC_*` flag it is inlined at build
time, not read at runtime.

Two consequences worth knowing:

- The gate is applied once, in `useRoleSurfaceSession`, *before* role matching.
  A room the build doesn't ship therefore has no sidebar row, no command-palette
  entry, and no restorable `surface:<id>` mode — there is no consumer of
  `visibleSurfaces` that can route around it.
- Reaching such a room directly (a stored mode, a `?mode=` link) lands on
  `RoleSurfaceHost`'s **"still under construction and isn't part of this
  build"** panel rather than the role-mismatch one, and the Familiar Studio
  Type picker appends the same sentence to a Type whose room is absent. A build
  gate that reported itself as a role problem would send people to change roles
  that were never the issue.

Adding a room means adding its id to `KNOWN_ROOM_IDS` too;
`src/lib/room-flags.test.ts` fails otherwise, so a new room cannot reach a
production build merely by being registered.

## Role assignment

A familiar holds a role when either matches (normalized, e.g. `"Research
Analyst"` → `research-analyst` + `research` + `analyst`):

- its `role` label (whole string or any word token), or
- an **active** role manifest (`/api/roles` entry) with that id or name.

A surface may also declare `aliases` — synonym roles matched exactly like its
primary `role`. The Chart Room serves `navigator` + `planner`/`planning`; the
Writing Desk serves `scribe` + `editor`/`writer`/`writing`; the Review Deck
serves `reviewer` + `review`; The Archive serves `indexer` +
`archivist`/`indexing`; the Watchtower serves `sentinel` + `watch`/`guardian`.

Familiars can also carry an explicit **Type** (Familiar Studio → Identity;
`FAMILIAR_TYPES` in `src/lib/familiar-types.ts`) that grants its room's role
token on top of the role label. The Type vocabulary is a deliberately small
core — General, Coding, Research, Review, Comms. Four earlier types (`watch`,
`planning`, `writing`, `indexing`) were retired in the 2026-07-24 vocabulary
reduction (cave-lgcb): stored values still resolve safely through
`RETIRED_FAMILIAR_TYPE_SUCCESSORS`, and their rooms stay reachable because
the registry carries the retired words as aliases (above).

When the familiar selector is in **All familiars** or another multi-familiar
scope, Cave renders the union of the registered rooms for that scope. A room
row with one matching owner narrows to that familiar before the room opens, so
the room still receives its familiar-bound context; shared ownership remains
in the aggregate scope. Project grants authorize project-backed actions inside
the room, but they are not room-visibility or unlock records.

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
  checkpoints, and finite linked Codex Automations. Contextual next-topic
  recommendations are grounded in current missions, saved links (including
  durable X Article snapshots), and bounded relevant Vault evidence. They remain
  ephemeral proposals: starting or refining a mission always requires an
  explicit action. The read-only evidence route returns a context fingerprint
  plus a lightweight revision projection; a changed mission, saved/X source, or
  Vault revision makes a displayed proposal stale before an action can use it.
  Resources accepts mixed
  ordinary, Hugging Face paper, and X Article URLs (up to 10 X Articles per
  submission). X Article ingestion uses the third-party Sorsa provider
  (`COVEN_CAVE_X_ARTICLE_PROVIDER=sorsa`) because the official X API does not
  expose full Article bodies; keep `SORSA_API_KEY` in Cave Vault, never a
  client environment. It retains durable normalized snapshots and
  mission-local provenance Markdown copies.
- **Comms Operations** (`messenger-ops`, role `messenger`) — channel-aware
  drafting (email/Discord/Slack/SMS/Teams/social), approval-required states,
  real inbox items, delivery queue drawer. Nothing sends externally — no
  delivery integration exists, and the surface says so.
- **The Archive** (`indexer-archive`, role `indexer`) — real memory inventory
  grouped into collections, semantic tags/clusters, provenance details,
  redacted content preview, indexing-activity drawer.
- **Watchtower** (`sentinel-watchtower`, role `sentinel`) — the Cave's real
  escalations as a triageable alert board (acknowledge/snooze/resolve/dismiss
  through the shared Inbox store), session watch over running/failed sessions,
  perimeter reachability from live ssh-host probes, watch-log drawer.
- **Writing Desk** (`scribe-writing-desk`, role `scribe`) — local drafts with
  live word counts, source material from the familiar's real memory and recent
  journal days, real publishing into the Knowledge Vault (republish-in-place,
  Grimoire deep links), published-works drawer.
- **Chart Room** (`navigator-chart-room`, role `navigator`) — the real board as
  a plotted course, read four ways: **Flow** (the board's lanes as columns, with
  dependency edges drawn over them), **Graph** (laid out by dependency depth, so
  column one is what can start today), **Orchestration** (steps against their
  familiar, the capability their labels name, and what is owed by you), and
  **Table** (sortable and editable, with gantt and board shapes of the same
  rows). A fifth tab, **Decisions**, is not another reading of the chart: it is
  the cards flagged `needsHuman`, most-blocking first. A briefing band carries
  the decision owed, project stats, and the structural repairs the room would
  make; the voyage-log drawer carries completed cards, this session's chart
  edits, and what was answered.

  Lanes, titles, owners, projects and the needs-a-human flag are real writes to
  `/api/board`. Which card *waits on* which is, today, the one thing the board
  cannot store, so it lives as the operator's chart overlay in the room's own
  surface state (`chart-room-model.ts`) and is drawn over the real cards —
  never written back as if the board knew about it. Dangling edges are pruned
  on every read. That overlay is per-familiar and per-browser, which is
  precisely why it is being retired: the server and every other familiar are
  blind to it. Dependencies become canonical board fields under
  [`orchestration-ready-tasks.md`](./orchestration-ready-tasks.md), and the
  overlay is imported once and removed. Until that lands, the overlay remains
  the only dependency store and is still not authoritative.

  Agentic Enhance uses the canonical Board task graph and persists its proposal
  audit with the task. It may normalize only mechanically verified references;
  prose, dependencies, blockers, next steps, lifecycle transitions, and
  approval-bound work remain review proposals and never dispatch automatically.
  Generation and verified normalizations pass through `cave-board` mutators in
  one lock-checked atomic batch, so a stale or failed apply leaves the proposal
  reviewable and preserves the explicit error.
- **Coding Desk** (`code`, role `coder`) — the Coding familiar's review-first
  room. It opens in **Reviewable**, showing only active human-created sessions
  that are outside configured familiar workspaces, verified inside a Git work
  tree, and enriched with a canonical GitHub `repositoryUrl`; linked worktrees
  remain eligible when that proof points back to their `repositoryRoot`.
  **All local** is the explicit escape hatch back to the older generic Code
  visibility, so familiar workspaces, non-GitHub or unverified repositories,
  rootless sessions, and missing familiar-workspace classification stay
  reachable there. Missing Git or workspace classification therefore fails
  closed for Reviewable only, and the rail and header picker read from the same
  queue model so their eligibility, ordering, and repository headings stay in
  sync.
- **Review Deck** (`reviewer-review-deck`, role `reviewer`) — a three-column
  cockpit built from sessions carrying PRs, working changes, or branches. Each
  column answers exactly one question, so a control's position tells you what
  it acts on: the **queue** says what is waiting, the **centre** says what
  changed, the **inspector** says whether it can land and what to do about it.
  Deck-scoped chrome — attention filters, item navigation, help, refresh —
  lives in the one top bar and nowhere else. Both rails drag to resize and
  collapse with `f` / `e`; the diff keeps the centre column and every pixel of
  height the rails do not need.

  The queue leads with a proportional **mix bar** (what the queue is made of,
  before any row is read), orders blocked-first-then-oldest, and groups under
  sticky headings that stay drawn while empty when nothing is filtered —
  "Nothing blocked" is the answer a reviewer opens the pane hoping for. Each
  row's reason is derived from the single `item?pull=1` read the queue can
  afford, so it names GitHub's own `mergeable_state` and never a failing-check
  count it has not fetched.

  A file rail replaces the file column: chips window around the open file, the
  overflow chip opens the full navigator (search, tree, keyboard traversal),
  and the reviewed-file progress persists against the exact PR head SHA (or an
  honest local working-tree revision), resetting when that identity changes.
  Unresolved review threads render inline at the line they were left on; one
  the deck cannot place — folded away, or past the route's per-file patch
  budget — is listed rather than dropped or pinned to the wrong line.

  The inspector leads with **one decision sentence** (headline, sub, and the
  single next action) and the blockers behind it, each carrying a derived
  severity and owner: an unresolved thread is only ever "yours" when the token
  can actually resolve it. Checks, threads, the merge checklist and session
  context sit behind disclosures underneath, and a blocker's own reveal control
  opens the one holding its evidence. The review note is always reachable
  there, and again inside the approve / request-changes composer. A sticky
  verdict dock carries one primary action chosen by state; an unavailable Merge
  keeps its place and names its blockers rather than disappearing.

  PR sessions always read GitHub; only sessions without a linked PR read the
  local working tree. Unknown readiness stays non-actionable, and approve /
  request-changes / squash-merge continue to dispatch through the real GitHub
  routes. The deck never edits the working tree.
