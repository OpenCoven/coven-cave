# Native iOS project workspaces direction

Status: **approved direction for implementation**

Date: 2026-09-04

Program: OpenCoven/coven-cave#5290

Decision issue: OpenCoven/coven-cave#5291

Bead: `cave-pc804`

Target repository path:
`docs/specs/2026-09-04-ios-project-workspaces-direction.md`

## Decision

Native Cave adopts a folder-first workspace model with a global resumable-work
entry point:

1. **Chats opens to global Recent conversations.** A conversation is the
   resumable object. A Familiar remains a first-class identity and operational
   hub, but is not a proxy for one conversation.
2. **Projects are visible, navigable workspaces.** A project workspace groups
   readable chats, tasks, Familiars, and verified attention items already bound
   to that project.
3. **Scope belongs to each surface.** A selected project may be a visible local
   filter or a default for new work; it does not define the identity of the
   whole application shell.
4. **Objects own navigation.** Opening a chat, task, or project resolves that
   exact object and its binding without silently changing unrelated surface
   filters.
5. **Reads and writes use different gates.** Cached history may remain readable
   while authority data is loading or stale. New sends and protected mutations
   fail closed until the exact current binding and grant are resolved.
6. **Unassigned is recovery-only.** It is a readable classification for legacy,
   deleted-project, malformed-root, or otherwise unresolved artifacts. It is
   never a normal writable project.

This supersedes only the conflicting iOS direction that makes the Chats home
familiars-first and treats one selected project as the application-wide
universe. It preserves the existing project-bound chat contract, Familiar
identity, drawer navigation, task/chat links, offline target durability, and
server/daemon authorization boundaries.

### Clause-level supersession of the existing chat project contract

`docs/specs/ios-new-chat-project-contract.md` remains authoritative for
project-bound creation, root/session persistence, roster eligibility, retries,
forwarding, voice, import, offline replay, recovery-only behavior, and
fail-closed sends.

The following ambient-selection clauses are superseded:

- the New Chat language requiring a project change through Chats before
  choosing another launch project;
- global-search Familiar routing that switches the application project before
  opening a conversation;
- the requirement that every thread-open path switch the application project
  before publishing the open intent;
- task launch language that switches application project before opening the
  task.

#5297 owns amending those clauses in the same change that introduces local
scope and object-owned routing. That amendment must preserve explicit project
selection, current Familiar eligibility, authoritative project/session roots,
queued-target immutability, Unassigned recovery-only behavior, and all final
server/daemon authorization checks.

## Why this model

The current shell conflates three separate decisions:

- where an object is displayed;
- which project owns its execution or task binding; and
- whether the operator or Familiar may perform a protected action.

That conflation makes project switching expensive and gives navigation a hidden
side effect: the current resolver changes `projectContext`, remounts the
destination through `.id(app.projectContext?.id)`, and only then publishes the
object-open intent. A global chat or task result therefore changes more state
than the selected object requires.

The target model keeps one disposable Cave read projection for fast grouping
and search, but leaves canonical identity, bindings, grants, tasks, sessions,
and mutations at their existing owners.

## Terms and authority boundaries

### Display placement

Display placement answers where Cave shows an object: global Recent, a project
workspace, a Familiar hub, Search, Needs You, or Unassigned recovery.

Placement is derived and non-authoritative. The same object may appear in more
than one organization without being copied or rebound.

### Execution or project binding

Binding answers which registered project owns a chat, session, task, queued
turn, or other protected work.

Binding comes from the authoritative object contract:

- chats and sessions use their persisted/server-confirmed project root and
  session identity;
- tasks use their canonical project ID;
- queued sends retain the immutable project, Familiar roster, and conversation
  target captured when composed;
- project identity comes from the registered project catalog.

A filter, folder, route parameter, prompt, or visual drag cannot establish or
change this binding.

### Authorization

Authorization answers whether a protected action may occur now.

- The current project/Familiar membership and capability data supplies a local
  UX gate.
- The existing server or daemon remains the final authority.
- Cached projection data is never sufficient authorization evidence.
- Stale, missing, revoked, mismatched, or Unassigned authority fails closed.
- Optimistic state must reconcile to a server receipt or visibly revert.

### "Move chat"

Chat moves are not part of this program.

The UI may reorganize how a chat is displayed without changing its binding.
Any future binding transition needs a separate R4 contract covering:

- authoritative transition owner;
- participant and session eligibility;
- queued/offline turns;
- task links and notifications;
- server receipts and rollback;
- stale/revoked authority;
- audit/provenance and migration behavior.

Until that contract exists, Cave must not label a display operation "Move chat"
or imply that dropping a row into a folder changed execution authority.

## Information architecture

The drawer remains the sole primary navigation surface.

```text
Chats
Needs You
Tasks

Projects
  bounded recent/favorite projects
  All Projects

Familiars

Search
Settings (profile entry)
```

`Needs You` may land in Phase 3 rather than the first navigation change. Until
it has verifiable signals, omit it rather than ship an empty promise.

### Chats

Default organization: **Recent**

Default scope: **Everywhere**

Chats shows one row per resumable conversation, deduplicating a local thread
and server session that represent the same conversation. Direct and group
conversations remain distinct. Multiple conversations with one Familiar remain
individually resumable.

Each row shows, when known:

- conversation title;
- Familiar or participant identities;
- project;
- latest preview and activity;
- unread, draft, queued, streaming, stale, disconnected, or recovery state;
- runtime/session detail only when it materially helps the operator.

Secondary organizations may be `By project` and `By familiar`, but they are
views of the same canonical projected rows, not separate state machines.

### Projects

Default scope: the complete readable registered-project catalog.

The drawer shows a bounded project set plus `All Projects`. Opening a project
pushes or presents that exact workspace. It does not rescope Chats, Tasks,
Search, or Familiars.

The first project workspace contains only truthful existing data:

1. recent project-bound chats;
2. project-bound tasks;
3. Familiars with current project access or activity;
4. verified Needs You items, when the canonical signal exists;
5. explicit loading, cached, stale, disconnected, unavailable, deleted, or
   recovery state.

Root/path detail is secondary and shown only where it is safe and useful.
Sources, Access, Git, runtime administration, and project mutation controls are
deferred unless an existing authoritative contract is separately assigned.

### Tasks

Default scope: **Everywhere**

Tasks owns an explicit local scope control: `Everywhere` or one registered
project. Status, priority, Familiar, and text filters compose with that scope.
The saved Tasks scope is a presentation preference only.

Opening a task targets its canonical ID and project ID. A task move remains an
existing protected mutation, not a side effect of changing the Tasks filter.

### Search

Default scope: **Everywhere**

Search owns an explicit `Everywhere` / project scope control and remembers its
own last-used scope. It searches the immutable projection with debounce,
cancellation, and latest-query-wins publication.

Search result selection opens the exact result. It does not rewrite the saved
scope of Chats, Tasks, or another surface.

### Familiars

Default scope: **Everywhere**

A Familiar hub shows the Familiar's authoritative identity and cross-project
work. Project is visible per item. An optional project filter belongs to that
hub and does not affect other destinations.

Two records with the same display name, avatar, prompt, or model are never
merged. Familiar ID and the existing Familiar/session binding are required.

### Needs You

Default scope: **Everywhere**

Needs You may include only verifiable operator-attention signals:

- a blocked task with unresolved dependencies, one named primary blocker, and
  one imperative next step;
- explicit approval or principal-decision requests;
- failed or rejected work with a canonical actionable next step;
- queued/offline work that genuinely requires operator action;
- stale, reconciling, or unavailable state that requires intervention.

Unread chat activity, model confidence, generated urgency, or ordinary
background work is not a Needs You signal. Selecting a row routes to the
canonical owning surface; Needs You does not become another task or approval
authority.

### Unassigned

Unassigned is separated visually from registered Projects and normal scope
pickers. It supports inspect, export, delete, relink/replace where already
authorized, and actionable recovery guidance.

Unassigned does not support:

- starting a new chat;
- sending into a projectless existing session;
- task/project mutation based on the recovery classification;
- use as a last-used default for new work.

## Scope state model

Each surface owns a scope value independent of shell navigation:

```text
SurfaceScope =
  everywhere
  | project(projectID)

NewWorkDefault =
  project(projectID)
  | none
```

`Unassigned` is a recovery collection, not `SurfaceScope.project`.

The existing persisted `projectContext` is migrated into
`NewWorkDefault.project` when the project still exists. It may seed a local
surface scope only on that surface's first launch and only when the target
design calls for a project default. In this decision:

- Chats first launches as Everywhere;
- Tasks first launches as Everywhere;
- Search first launches as Everywhere;
- Familiars first launches as Everywhere;
- a Project workspace is intrinsically scoped to its route project;
- New Chat may use `NewWorkDefault` only when the default is current,
  registered, visible, and unambiguous.

Changing one `SurfaceScope` never writes another surface's scope.

## Read-state and mutation-state matrix

| State | Read behavior | New send / protected mutation |
| --- | --- | --- |
| Loading, no cached rows | Keep stable shell; show bounded loading state | Disabled until exact target and grant resolve |
| Loading, cached rows | Show cached rows with loading/freshness disclosure | Disabled unless current authority is independently confirmed |
| Fresh | Show current projected rows | Allowed only after local target/grant checks; server/daemon remains final authority |
| Stale or degraded | Keep readable rows and label the state | Fail closed; offer refresh/reconnect or canonical recovery |
| Disconnected | Keep durable cached rows where available | Queue only through an existing contract that captures immutable exact targets; otherwise disabled |
| Unavailable | Preserve unaffected surfaces; show actionable error locally | Disabled |
| Revoked or mismatched | Preserve only content the client is still allowed to retain/read | Disabled; surface authoritative denial |
| Deleted project | Route bound artifacts to explicit recovery presentation | Disabled pending an approved recovery transition |
| Unassigned | Show recovery-only artifacts | Disabled |
| Pending/proposed binding | Show the committed binding plus a visibly pending proposal | Never render the proposal as committed before receipt |

The projection carries freshness and eligibility inputs for presentation, but a
projection row cannot grant authority.

## Object-owned navigation

Navigation is a request to open an identity, not a request to select a global
project.

### Chat open

Input: conversation/thread/session ID plus authoritative project metadata when
available.

1. Resolve or hydrate the exact conversation.
2. Resolve its current project binding or explicit recovery state.
3. Open the conversation in Chats.
4. Display its project context in the destination.
5. Leave Chats organization, Tasks scope, Search scope, and Familiar filters
   unchanged.

Reopening the visible conversation is a no-op that preserves scroll, selection,
draft, and streaming state.

### Task open

Input: task ID and canonical task project ID.

1. Resolve or hydrate the exact task.
2. Open task detail in Tasks.
3. Display its project context even if the saved Tasks filter excludes it.
4. Use a temporary reveal/route context rather than silently rewriting the
   saved Tasks filter.

Back returns to the initiating global/project/Familiar/Needs You surface when
the navigation container can preserve that origin.

### Project open

Input: project ID.

Open that project workspace. Do not change another surface's local scope or the
default for new work merely because the page is visible.

### Familiar open

Input: Familiar ID.

Open the cross-project Familiar hub. Do not guess a landing conversation by
changing the shell project. A "resume conversation" action chooses an exact
project-bound conversation; "new chat" separately resolves an explicit
project.

### Cold and deep-link opens

Deep links, notifications, widgets, and cold launches retain generation
fencing and stale-result suppression:

- keep the unresolved intent while required catalogs load;
- resolve the exact object before publishing the destination;
- suppress older hydration results after a newer request;
- fail with actionable copy for unknown, malformed, deleted, archived, denied,
  or Unassigned targets;
- never fall back to a same-named Familiar, current filter, or ambient project.

Supported existing links remain accepted during migration. Their old
"switch-project-then-open" implementation changes internally; the observable
target identity does not.

## New work

### From a project workspace

New Chat carries that explicit project as a proposed launch target and still
checks the current Familiar roster/grants before creation and send.

### From global Chats, Search, or a Familiar hub

Use the last-used default only when:

- it names one currently registered project;
- the project is readable and launch eligibility is current;
- every selected Familiar is eligible;
- the choice is visible before creation.

Otherwise require an explicit project selection.

Selecting a project for new work does not rescope the surface the user came
from. Unassigned is never offered as a writable target.

## Persisted-state migration

Migration is additive and reversible for at least one shipped compatibility
window.

1. Read the existing endpoint-scoped `cave.project-context.v2` value only as a
   legacy presentation hint.
2. Do not promote that value into a writable `NewWorkDefault`. The current
   store does not persist whether the project was operator-selected or chosen
   automatically from local thread, server session, task history, or
   alphabetical fallback.
3. On the first post-upgrade New Chat, require the operator to confirm or choose
   the visible project before creation. Persist a new endpoint-scoped default
   only from that explicit confirmation.
4. If the legacy hint is missing, malformed, deleted, or Unassigned, discard
   the hint and write no new-work default.
5. Initialize Chats, Tasks, Search, and Familiar scope stores independently
   using the defaults above.
6. Keep the old key readable during the compatibility window. Do not delete it
   until upgrade and rollback evidence passes #5299.
7. Make migration idempotent; a second launch must not overwrite newer
   per-surface choices.
8. A rollback may restore old presentation from the retained key, but it must
   not rewrite object bindings, queued targets, snapshots, task links, or
   session provenance.

The exact new key names belong to #5297 implementation review. They must remain
connection/endpoint-scoped to avoid carrying one Cave's project default into
another Cave.

## Current-to-target map

| Surface or contract | Current | Target | Owner |
| --- | --- | --- | --- |
| `projectContext` | Application-wide selected universe; drives filtered collections and shell identity | Legacy presentation hint only; an explicitly confirmed replacement may become the new-work default | #5297 |
| `projectContextGateState` / `ProjectContextGateView` | Membership/project selection can replace the whole Chats/Tasks destination | Read readiness becomes per-surface so cached/global rows stay mounted; mutation readiness remains fail-closed at the write path | #5293 for read mounting; #5297 contributes write-gate separation |
| Root destination identity | `.id(app.projectContext?.id)` remounts Chats/Tasks on switch | Stable destination identity; reconcile only invalid local state | #5293 |
| Chats | Familiars-first rows within ambient project | Global Recent conversations; optional organizations from one projected data set | #5295 |
| Tasks projected input | Reads `app.projectTasks` from ambient context | Stable projected task rows | #5294 |
| Tasks scope | Inherits ambient project | Everywhere default with explicit local project filter | #5297 |
| Search execution | Rebuilds/scans mutable collections while querying | Cancellable projected search with latest-query-wins publication | #5294 |
| Search scope | Defaults to current ambient project | Everywhere default with explicit Search-owned project scope | #5297 |
| Drawer row data | Derives ambient-project recents and project counts from mutable collections | Stable projected rows and bounded counts | #5294 |
| Drawer Projects UI | One Project context button | Bounded Projects section, All Projects, and separate Unassigned recovery | #5296 |
| Project switcher derivation | Selects shell-wide context and derives counts by scanning collections | Retired as a duplicate derivation path | #5294 |
| Canonical project browser | Project switcher doubles as shell-wide selector | All Projects plus project workspace routing | #5296 |
| New-work project selection | Shell-wide project switcher supplies an implicit launch project | Explicit, visible, local project confirmation/default | #5297 |
| Project workspace | No canonical native workspace page | Exact project route with truthful chats/tasks/Familiars/verified attention | #5296 |
| Familiars | Ambient-project roster/landing behavior plus separate dashboard | Cross-project hub with project shown per object; authoritative IDs only | #5298 |
| Needs You | No canonical global view | Derived verifiable attention view routing to owning surfaces | #5298 |
| Deep links/object opens | Resolver switches global context before publishing open intent | Exact object resolution with temporary reveal and no unrelated rescope | #5297 |
| New Chat binding policy | Uses active registered project; Unassigned blocked | Explicit project from caller or operator-confirmed default/selection; Unassigned blocked | #5297 |
| Global Chats New Chat entry | Uses the active ambient project | Supplies no hidden project; invokes canonical explicit binding flow | #5295 |
| Project workspace New Chat entry | No workspace entry exists | Supplies that visible project to the canonical binding flow | #5296 |
| Offline queue/replay | Project-bound contract exists | Preserve immutable target across all filter/default changes | #5297 |
| Unassigned presentation | Ambient recovery context can become selected shell state | Separate recovery collection, never a normal writable scope | #5296 |
| Unassigned mutation gates | Ambient selection participates in routing | Recovery-only and fail-closed at every write boundary | #5297 |
| Read projection contract | Views repeatedly derive from mutable app collections | One immutable, disposable, generation-fenced Cave read model | #5293 |
| Projection adoption | No shared projected row source | Existing surfaces consume the single projection | #5294 |

## Compact-width acceptance scenarios

1. Launch with 20 projects and 2,000 combined local/server conversations.
   Chats opens to global Recent without choosing a project first.
2. Open the drawer while one chat streams. The stream and visible destination
   stay mounted; the drawer shows a bounded Projects section and global recent
   entries from stable rows.
3. Open a chat from global Recent whose project differs from the last-used
   new-work default. The chat opens and shows its project; Tasks and Search
   scopes do not change.
4. Open a task from Search while Tasks is filtered to another project. The
   exact task opens through a temporary reveal. Returning restores the prior
   Search query/scope and does not rewrite the saved Tasks filter.
5. Open a project, then a child chat, then Back. Back returns to the project
   workspace with its valid scroll position.
6. Begin New Chat globally with no unambiguous default. The app requests a
   project before creation. Choosing one does not change global Chats scope.
7. Disconnect with cached global rows. Rows remain readable and marked stale;
   a new send is disabled unless an existing offline contract captured current
   exact targets.
8. Open an Unassigned legacy chat. It is inspectable/exportable/deletable with
   recovery guidance, and Send is unavailable.
9. Follow a deleted-project deep link. The app shows an actionable recovery
   state and does not open a similarly named project.
10. Increase Dynamic Type through accessibility sizes. Project and Familiar
    context remains available without clipping the primary open/recovery
    action.
11. On first New Chat after upgrading, an old automatically selected
    `projectContext` may appear only as a legacy hint. The operator must confirm
    or choose the project before creation; no pre-upgrade value silently becomes
    writable authority.

## Regular-width acceptance scenarios

1. Global Chats uses a stable list/detail split. Projection refresh does not
   auto-select another conversation or replace the current detail.
2. Opening a project presents its workspace in the appropriate column. Opening
   a child chat/task preserves a navigable project origin.
3. Changing the Tasks project filter updates task rows without destroying the
   selected Chats detail, a draft, or active stream.
4. Opening Search over the split view and selecting an object dismisses Search
   before routing; focus returns to the opened object's meaningful control.
5. Rotate or cross compact/regular size classes while a project child is open.
   The exact object, valid navigation origin, draft, and scroll state survive.
6. With VoiceOver, traversal names object, Familiar, project, freshness/state,
   and required recovery action without relying on color.
7. A background projection refresh that removes the visible project does not
   silently select another project. The workspace becomes an explicit
   deleted/unavailable recovery state.

## Existing contracts to preserve

- The server's project registration and access check remains final.
- `ChatThread` and snapshots preserve the project root and session binding.
- First send, retry, forwarding, voice, import, duplication, `/new`, and
  offline replay retain explicit project targets.
- Queued work is never retargeted by a later scope or default change.
- Task/chat links continue to use canonical task/session/thread identities.
- Project membership and Familiar identity are not inferred from display text.
- Pending or proposed state is not rendered as committed.
- Drawer remains the sole primary navigation surface; no bottom tab bar returns.
- Dynamic Type, VoiceOver, Reduce Motion, Reduce Transparency, and 44-point
  targets remain release gates.

## Source-contract migration

Later implementation must inventory and intentionally replace these known
source contracts where their assertions pin the old behavior:

- `scripts/ios-chat-familiars-home.test.mjs` - familiars-first Chats,
  ambient-project recents, and project-switch selection resets;
- `scripts/ios-chat-project-contract.test.mjs` - object-open behavior that
  switches project context before routing and active-project fallback creation;
- `scripts/ios-surface-load-discipline.test.mjs` - current shell/project load
  assumptions;
- `scripts/ios-task-search-familiar-scope.test.mjs` - ambient Tasks/Search/
  Familiar scope;
- `apps/ios/CovenCave/CovenCaveTests/AppModelProjectContextTests.swift` -
  project-filtered collections, open-intent rescope, fallback selection, and
  project-context gate state;
- `apps/ios/CovenCave/CovenCaveUITests/DrawerNavigationUITests.swift` - current
  project-context gate and drawer open behavior.

Implementation must also add or update a source contract for removing
`.id(app.projectContext?.id)` and inventory any additional assertion that pins
the project switcher as shell-wide selection or drawer recents as
ambient-project-only.

Those assertions are not simply deleted. They move to behavioral coverage for:

- stable destination identity;
- exact object routing without unrelated rescope;
- per-surface scope persistence;
- projection generation and deduplication;
- cached-read/fail-closed-write behavior;
- compact and regular-width navigation;
- upgrade, rollback, offline replay, and authority boundaries.

## Phase ownership

| Approved behavior | Implementation owner |
| --- | --- |
| Immutable, generation-fenced, non-authoritative read projection | #5293 |
| Stable Chats/Tasks destination identity and per-surface read mounting | #5293 |
| Projection-backed current rows/counts and cancellable Search | #5294 |
| Global Recent Chats and secondary organizations | #5295 |
| Drawer Projects section, All Projects, and project workspace | #5296 |
| Per-surface scope, object-owned routes, explicit New Chat default, migration, and exact write gates | #5297 |
| Cross-project Familiar hub and verifiable Needs You | #5298 |
| Physical-device, accessibility, upgrade, rollback, and R4 closeout | #5299 |

## Non-goals

- No desktop or web redesign.
- No new project, session, task, Familiar, or attention database.
- No replacement for Coven, Threads, Psyche, SPAR, or the Familiar Contract.
- No chat project-binding move.
- No project creation, deletion, re-rooting, access administration, or Git
  management surface.
- No new backend endpoint unless a later issue proves the existing contract is
  insufficient and separately approves the API work.
- No inferred attention, urgency, progress, identity, membership, or authority.
- No simulator timings represented as physical-device percentiles.
- No release or TestFlight publication authority.

## Acceptance

This decision is complete when:

- `docs/ios-current-direction.md` names this document as the canonical
  supporting direction;
- the old familiars-first default is clearly historical where it conflicts;
- every surface has an explicit default scope;
- display placement, execution binding, and authorization are separate;
- loading/stale/degraded/unavailable/Unassigned read and write behavior is
  explicit;
- deep links and object opens have no undocumented global-rescope dependency;
- migration and rollback preserve object data and queued targets;
- every approved behavior has one later issue owner;
- no new canonical authority or unsupported capability is proposed.
