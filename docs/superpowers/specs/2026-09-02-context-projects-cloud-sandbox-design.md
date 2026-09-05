# Context, projects and cloud sandboxes — design

**Status:** proposed — design review 2026-09-02, awaiting owner approval
**Date:** 2026-09-02
**Bead:** to be filed on approval (the Beads store was not reachable from the review session)
**Canvas:** <https://claude.ai/code/artifact/562b8e0f-935b-46b7-8fbd-d3d198265720> — sources in [`docs/design-handoff/context-projects-cloud-sandboxes/`](../../design-handoff/context-projects-cloud-sandboxes/README.md)
**Surfaces:** shell rail and title bar, Home, Chat, Tasks, Queue, Calendar, Code, Projects hub, Settings › General, Settings › Hosts, Summoning Circle, composer host chip, native iOS new-chat sheet
**Builds on:** [`2026-08-18-project-primary-hybrid-navigation-design.md`](2026-08-18-project-primary-hybrid-navigation-design.md) (approved; Stage 1 shipped)

## Goal

Answer three linked product questions with one model, so the next three
delivery lanes do not each invent a different notion of "where work lives":

1. Should the shell carry global context for both the project and the
   familiar, and which one leads?
2. What is a project — any directory, only a repository, a separate thing for
   GitHub — and should the Cave own a default place for them on disk?
3. Should the Cave integrate Daytona cloud sandboxes, how, and can it charge
   for them?

The interaction model this spec keeps throughout:

> **The project is a place. The familiar is an actor. A host is where the
> place is served from.** Never let one of these stand in for another.

## What the repository does today (evidence)

### Context

- The approved 2026-08-18 spec chose project-primary, familiar-retained
  navigation. Stage 1 has shipped: the pure model in
  `src/lib/workspace-context.ts` (`ProjectScope`, `FamiliarScope`,
  `ActingFamiliar`), versioned persistence in
  `src/lib/workspace-context-storage.ts` (project scope plus a crew
  remembered per project), the presentational
  `src/components/workspace-context-switcher.tsx` mounted in the title bar and
  the rail header, `src/components/acting-familiar-gate.tsx`, and Home as the
  pilot consumer in `src/components/home-composer.tsx`.
- The work surfaces still own their own project selection. Chat persists
  `cave:chat:project-selected` in `src/components/chat-router.tsx` and resolves
  a new chat's project through `resolveChatProjectSelection` in
  `src/lib/chat-projects.ts`, a chain (draft → linked task → session cwd →
  worktree → pinned default → recent → first) that never reads the shell
  project. Queue keeps `cave:queue-project-selected`
  (`src/lib/queue-project-selection.ts`). Tasks filter by familiar scope only
  and ask for a project per card.
- The Stage 1 plan required a visible "not project-filtered" marker on
  unmigrated surfaces; `src/components/workspace.tsx` passes
  `contextNotice={null}`, so nothing renders.
- Deep links carry `mode`, `split`, `splitSide` and the `#chat-<id>` hash only
  (`src/lib/workspace-url-state.ts`). Neither project nor familiar is
  addressable.
- Native iOS is familiars-first by current direction
  (`docs/ios-current-direction.md`); the new-chat contract already binds a
  registered project per thread (`docs/specs/ios-new-chat-project-contract.md`).

### Projects

- A `CaveProject` is `{ id, name, root, color?, repoUrl?, access? }`
  (`src/lib/cave-projects-types.ts`), persisted in `<caveHome>/projects.json`,
  one project per normalized root (`src/lib/cave-projects.ts`).
- Registration accepts any existing directory except the home folder itself
  and a volume root (`isAllowedNewProjectRoot` in
  `src/lib/server/project-paths.ts`), and `POST /api/projects` is loopback-only
  (`src/app/api/projects/route.ts`), so a phone can list projects but never
  register one.
- `repoUrl` is optional metadata normalized to `https://github.com/owner/repo`
  (`src/lib/github-repo-link.ts`). Organization grouping derives from that
  owner, else from the parent folder's name (`src/lib/project-organizations.ts`).
- Git is a detected capability: the branch chip, changes and worktree flows
  appear only when the root is a repository. `.worktrees/<branch>` checkouts
  authorize against the parent project and never become projects
  (`src/lib/project-setup-offer.ts`).
- There is no clone flow. `git clone` appears once, on the About page.
- There is no canonical projects location. Familiar workspaces default to
  `~/.coven/workspaces` with a Settings override
  (`src/lib/coven-paths.ts`, `src/lib/server/workspace-root-store.ts`, the
  `WorkspacePathField` in `src/components/settings-shell.tsx`). The folder
  picker badges folders under configured roots (`src/app/api/fs-browse/route.ts`).
- Sessions on SSH hosts appear as host-keyed groups in Chat
  (`chatProjectRuntimeHost` in `src/lib/chat-projects.ts`) but cannot be
  registered or granted, because the registry has no host field.

### Remote execution

- A familiar is summoned into a vessel: this host, an SSH host, an OpenClaw
  agent or a Hermes profile (`src/components/familiar-summoning-circle.tsx`).
  `FamiliarRuntime` is `local | ssh` (`src/lib/familiar-runtime.ts`).
- Chats pick a host through the composer host chip
  (`src/components/composer-host-chip.tsx`) against the registry served by
  `src/app/api/hosts/route.ts`; a conversation records `ssh:<host>:<cwd>` and
  fails closed if that host disappears (`resolveRequestedRuntime` in
  `src/lib/chat-hosts.ts`). The chat route builds the remote command with
  `buildSshSpawnArgs` and the runtime-boundary preamble has a remote variant
  (`src/lib/chat-runtime-scope.ts`).
- Omnigent fleet hosts are appended to the same registry behind a Vault
  secret plus a Settings toggle (`isOmnigentFleetActive` in
  `src/lib/omnigent/token.ts`). That is the gating pattern to copy.
- The Daytona plugin is vendored as a skill only
  (`marketplace/plugins/daytona/skills/daytona/SKILL.md`), trust
  `official-remote`, with `daytona_api_key` declared as a sensitive
  `userConfig` that the Vault stores (`marketplace/catalog.json`). Daytona
  provides token-based SSH access, signed preview URLs, API-driven `git`
  operations, snapshots, auto-stop and auto-archive, and pay-as-you-go billing
  on reserved vCPU, RAM and disk with a per-organization usage endpoint.
- The Cave has no account system and no billing. The terminal bridge in
  `server.ts` spawns local shells only. Per-turn cost already lands in the
  execution ledger (`src/lib/familiar-execution-analytics.ts`) and the usage
  windows in `src/lib/chat-usage-plan.ts`.

## Decisions

1. **Context: both axes, project first, familiar retained.** Do not revisit
   the 2026-08-18 decision; finish it. Project wins for browsing scope,
   familiar wins for attribution. This spec is the Stage 2 contract plus four
   amendments listed under §1.
2. **Projects: any directory, one entity, two intakes, a default home.** A
   project stays a local directory, one per root. There is no separate entity
   or route for GitHub repositories. "Clone from GitHub" is a second intake
   into the same registry. A default projects folder exists as a default, not
   a requirement. The registry gains a `host` field.
3. **Cloud sandbox: yes, as a host.** Daytona is a fifth vessel in the
   Summoning Circle and a host in the chat host chip. Bring your own key
   first, behind a Settings toggle. Metered credits are Phase B, a separate
   service and a separate decision, only after Phase A shows use.

### Approaches considered

- **Collapse to one global axis.** Rejected: familiar grants are per project
  (`src/lib/project-permissions.ts`), role rooms derive from familiar roles,
  and the runtime boundary is path-based. Either axis alone loses
  authorization or workspace stability.
- **A separate "GitHub repo" project type with its own route.** Rejected: a
  repository maps to many checkouts, worktree provisioning under
  `.worktrees/` depends on path identity, and the projects hub already
  distinguishes origin with a badge. A repo without a checkout is a source,
  not a project.
- **Sandbox as a project type.** Rejected: it fuses "where" with "what". A
  sandbox project would be unable to move hosts, and the phone story needs
  local and sandbox projects side by side in one list.
- **Cloud as the default runtime.** Rejected: the app is local-first and
  native, and sandboxes bill while running. A silent cloud default contradicts
  the "show the receipt" ethos of `2026-08-31-familiar-presence-design.md`.

## §1 Context — Stage 2 contract

### Surface adapters

Every surface declares one row of this table. A surface never invents its
own selector semantics.

| Surface | Filters by shell project | Filters by crew | Actor required for | Notes |
| --- | --- | --- | --- | --- |
| Home | yes | yes | send, task, voice | shipped (Stage 1) |
| Chat list | yes | yes | — | replaces `cave:chat:project-selected`; the picker's org and project disclosure keys stay |
| New chat | default = shell project | acting familiar | send | replaces the pinned "save as default" project; per-session override stays |
| Historical chat | override, visible | session's familiar | — | see "Override chip" |
| Tasks, Gantt | yes | yes | create, assign, dispatch | per-card project stays the card's truth |
| Queue | yes | yes | claim, dispatch | replaces `cave:queue-project-selected` |
| Calendar | items with project affinity | yes | create | unaffiliated items stay visible |
| Code room, Coding Desk | yes | familiar-derived room | launch | room visibility stays familiar-derived |
| GitHub work | repo of the shell project | yes | tier-2 writes | All projects lists every linked repo |
| Familiar Studio, memory, analytics | no | familiar-keyed | — | familiar-primary |
| Settings, Marketplace, Inbox, Grimoire, dashboards | no | no | — | global; the cluster dims and says so |

### Override chip

A historical chat rooted outside the shell project shows one chip in its
session context row: warning tint, `Runs in <project> · workspace is
<shell project>`, and a secondary `Switch workspace` action. Opening such a
chat never moves the shell project. Switching the workspace is an explicit
act, announced through `useAnnouncer()`.

### Dimmed cluster on global surfaces

Until a surface adopts the table above, and permanently for global surfaces,
the title-bar cluster renders at `--opacity-disabled` with a `role="note"`
line: `<Surface> isn't filtered by project.` This is the marker the Stage 1
plan asked for and `contextNotice={null}` dropped.

### One gate for every launch

Chat's new chat, task creation, Queue dispatch and the palette route through
the same `requestActingFamiliarResult` path Home uses. There is no
first-member fallback anywhere.

### Deep links

`?project=<id>&familiar=<id>` join `mode` and `split` in
`src/lib/workspace-url-state.ts`. Resolution order is project, then familiar,
and the familiar is accepted only when eligible for that project. A missing
project lands on All projects; an ineligible familiar lands on Project crew.
`#chat-<id>` keeps precedence for opening a conversation.

### Mobile

Native iOS keeps its familiars-first Chats list. The project is a per-thread
setting on the new-chat sheet, which the existing contract already enforces,
never a global filter. The sheet adds a `Runs on` row so a phone-only operator
can reach a sandbox host (§3). This satisfies the 2026-08-18 spec's Stage 4
intent without porting the desktop two-row control into narrow chrome.

### Amendment for the owner: a sole project

The 2026-08-18 spec forbids a first-project fallback. Most new installs have
exactly one registered project. Proposal: when exactly one project is
registered and nothing is persisted, select it and announce the selection.
This is the one place this spec asks to amend the approved model.

## §2 Projects — one entity, two intakes, a default home

### Add project

"Add project…" in the project picker and the hub opens a chooser with three
cards: **Choose a folder** (existing flow), **Clone from GitHub** (new), and
**Try the sample project** (new; a small read-only project for onboarding,
removable). The chooser reuses `ui-template-card`.

### Clone from GitHub

A modal, breadcrumb `Add project › Clone from GitHub`, with:

- **Repository** — text field accepting `owner/repo` or any accepted link
  form; suggestions come from `GET /api/github/repos`; validation is
  `normalizeGitHubRepoUrl`. Private repositories authenticate with the Vault's
  GitHub token.
- **Destination** — read-only path prefilled to
  `<projects folder>/<owner>/<repo>` with a `Change…` action that opens the
  existing folder picker.
- **Name** — prefilled by `titleCaseProjectName(repo)`.
- **Color** — the six `PROJECT_SETUP_COLOR_CHOICES` swatches, optional.
- **<Acting familiar>'s access** — No access / Read / Write, default Write,
  hidden for the supreme familiar. Same submit ordering as the setup modal:
  create, then grant, then one registry mutation.

Server: `POST /api/projects/clone` `{ repoUrl, destination?, name?, color? }`,
loopback-only, runs `git clone` with `execFile` and no shell, refuses a
destination outside the projects folder unless the user changed it through
the picker, then calls `createProject` with `repoUrl` set. The route streams
progress so the modal can show `Cloning…` on the primary button and a
per-step error with retry that never creates a duplicate.

A folder whose `origin` remote differs from the linked `repoUrl` gets a
warning in the setup and settings modals; the existing `remote=1` probe
already returns the value.

### Projects folder

- Default `~/Coven/projects`, created lazily on the first clone, sample or
  "new empty project" action, never at install.
- Settings › General gains a **Projects folder** row beside **Familiar
  workspaces**, using the same `WorkspacePathField` pattern; stored in
  `<caveHome>/projects-root.json`; pinnable with `COVEN_PROJECTS_ROOT`, in
  which case the row reads the value and hides the picker.
- The folder is a **picker place** (`listPlaceGroups` in
  `src/lib/server/home-browse.ts`) and the clone target. It is deliberately
  **not** added to `builtInProjectRoots()`, so registering a project stays an
  explicit act and the file-serving allow-list does not widen.
- Layout `<owner>/<repo>` means the parent-folder fallback in
  `projectOrganization` groups clones correctly before any link is set.
- Not `~/Documents` (iCloud and OneDrive sync checkouts) and not `~/.coven`
  (hidden state the onboarding doc says users cannot find).

### Host on the registry

```ts
type ProjectHost =
  | { kind: "local" }
  | { kind: "ssh"; host: string }
  | { kind: "daytona"; sandboxId: string };

type CaveProject = { /* existing fields */; host?: ProjectHost };
```

- Absent means local; every existing record keeps its meaning.
- `validateCaveProjectRoot` branches by host: local roots `stat`; remote roots
  are verified through the host (an `ls` over SSH, `fs.list_files` on
  Daytona) with a bounded timeout and a cached result.
- Grants, access levels and the launch gate stay keyed by project id and are
  unchanged.
- Chat groups already key by `runtimeHost`; the registry lookup extends
  `projectForRoot` with a host argument so an SSH session finally maps to a
  registered, grantable project.
- The hub row and the picker show a host chip after the name: `This Mac`,
  `<alias> · offline`, or `Sandbox · running`.

## §3 Cloud sandbox — a host, not a project type

### Model

- `FamiliarRuntime` gains `{ kind: "daytona"; sandboxId: string; cwd: string }`.
- `ChatHostOption.kind` gains `"daytona"`; the registry in
  `src/app/api/hosts/route.ts` lists sandboxes the Cave created, with live
  state from the Daytona API instead of an SSH probe.
- A conversation records `daytona:<sandboxId>:<cwd>` and fails closed when the
  sandbox is gone, exactly like the SSH case.
- One sandbox per project by default, named after the project, created from
  the default snapshot with the project cloned into
  `/home/daytona/workspace/<repo>`. Worktrees inside the sandbox keep parallel
  familiars apart, as they do locally.

### Transport

Mint a short-lived SSH access token through the Daytona API, then run the
existing remote command builder against `ssh.app.daytona.io` with the token as
the user. `buildSshSpawnArgs` and the remote runtime-boundary preamble are
reused unchanged; the only new code is token minting and refresh. The
terminal pane gains an SSH-backed PTY for sandbox hosts; the browser pane
opens signed preview URLs with an explicit expiry.

### Snapshot and runtimes

Ship `opencoven/cave-sandbox` with the Coven CLI and harness CLIs
preinstalled. Runtimes that need an interactive sign-in cannot run inside a
sandbox; the vessel's runtime stage lists only runtimes with an API-key
inference route (`inferenceRouteId` on the familiar binding). Secrets reach
the sandbox as environment values at creation and never include the Daytona
key.

### Lifecycle and cost

- `auto_stop_interval` 15 minutes idle, `auto_archive_interval` 7 days.
- A stopped sandbox wakes on send with a visible phase line
  (`starting sandbox · <name> · 6s`).
- Every turn in a sandbox ends with a receipt chip
  (`sandbox 42 min · 2 vCPU · $0.31`), fed by the execution ledger.
- Settings › Hosts carries a daily budget; new sandboxes do not start above
  it, running turns finish. Delete always confirms and names what it removes.
- The Daytona key is a Vault reference scoped per familiar through the existing
  `PATCH /api/vault` grant.

### Gating

Copy the Omnigent pattern: the vessel and the host option exist only when the
Vault holds `DAYTONA_API_KEY` **and** Settings › Hosts › Cloud sandboxes is on.

### Phase B — metered credits

Only after Phase A shows use. Requires an OpenCoven account and a broker
service that holds the master Daytona organization, issues the Cave
short-lived scoped tokens, meters reserved vCPU, RAM and disk per customer,
reconciles against the organization usage endpoint, and sells prepaid credits
with auto top-up. Wall-clock caps end any sandbox. Bring your own key stays a
permanent option. The `CreditsSketch` frame is a low-fi sketch of the
operator-facing half and is marked out of scope on the canvas.

## Data model changes

| Store | Change |
| --- | --- |
| `<caveHome>/projects.json` | optional `host` per project |
| `<caveHome>/projects-root.json` | new; the projects folder override |
| `<caveHome>/config.json` | `remoteHosts` gains `kind: "daytona"` entries; familiar bindings gain the daytona runtime |
| conversation runtime string | `daytona:<sandboxId>:<cwd>` |
| `localStorage` | `cave:chat:project-selected` and `cave:queue-project-selected` retire once their surfaces adopt shell context; the Stage 1 keys stay |
| URL | `project`, `familiar` query params |

## File map

New:

- `src/app/api/projects/clone/route.ts`, `src/lib/server/project-clone.ts`
- `src/lib/server/projects-root-store.ts`, `src/app/api/config/projects-root/route.ts`
- `src/lib/project-host.ts` (pure host types and validation)
- `src/lib/server/daytona/` (client, token mint, lifecycle), `src/lib/daytona-host.ts`
- `src/components/add-project-chooser.tsx`, `src/components/clone-repo-modal.tsx`
- `src/components/settings-cloud-hosts.tsx`
- `src/styles/globals/…` sheets for the chooser and settings section, component-imported per the globals rule in `CLAUDE.md`

Modified (all exist today):

- `src/lib/workspace-url-state.ts`, `src/components/workspace.tsx`,
  `src/components/chat-router.tsx`, `src/components/chat-view.tsx`,
  `src/lib/chat-projects.ts`, `src/lib/queue-project-selection.ts`,
  `src/components/board-view.tsx`
- `src/lib/cave-projects-types.ts`, `src/lib/cave-projects.ts`,
  `src/lib/server/project-paths.ts`, `src/lib/server/home-browse.ts`,
  `src/lib/coven-paths.ts`, `src/components/settings-shell.tsx`,
  `src/components/project-picker.tsx`, `src/components/projects-view.tsx`
- `src/lib/familiar-runtime.ts`, `src/lib/chat-hosts.ts`,
  `src/app/api/hosts/route.ts`, `src/components/composer-host-chip.tsx`,
  `src/components/familiar-summoning-circle.tsx`,
  `src/app/api/chat/send/route.ts`, `src/lib/chat-runtime-scope.ts`,
  `server.ts` (SSH-backed PTY)

## Error handling

- A clone failure keeps the modal open with the failing step named and a retry
  that passes `existingProjectId` when registration already succeeded.
- A missing projects folder is created on demand; a folder that cannot be
  created surfaces the same `Couldn't save the workspace path.` shape the
  workspace row uses.
- A sandbox that fails to start shows `Couldn't start sandbox <name>` with the
  Daytona error verbatim and a `Run on this Mac instead` action; the chat is
  never silently relocated.
- Budget reached: `Daily sandbox budget reached` on the host chip, with the
  Settings link; running turns finish.
- Lost host: the conversation fails closed with the existing re-pick error.

## Accessibility and copy

- Every new control keeps a persistent visible label; placeholders follow the
  grammar in `docs/coven-design-language.md` §10 (`Filter projects…`,
  `e.g., owner/repository`).
- Host and sandbox state never rely on color alone: the dot pairs with the
  uppercase status word, the receipt is text.
- The override chip and the dimmed cluster are announced once on change.
- Verbs are the real verbs: `Clone and register`, `Switch workspace`,
  `Stop`, `Archive`, `Delete…`.

## Testing

- Pure tests: host validation branches, URL param resolution order, the sole
  project amendment, the per-surface adapter table as a data-driven pin.
- Route tests: clone route containment and no-shell spawn, projects-root
  store, hosts route listing daytona entries, chat send fail-closed on a gone
  sandbox.
- Source-text pins: the dimmed cluster note, the override chip, chat and
  queue no longer persisting their own project keys.
- Daemon-less Playwright: switch project in the title bar and watch Chat and
  Tasks follow; open a historical chat and confirm the shell does not move;
  clone modal happy path with `page.route` mocks.
- Every new test file registered in `scripts/run-tests.mjs`.

## Staging

1. Context Stage 2 (this spec §1), one surface per PR: Chat list and new
   chat, Tasks, Queue, Calendar, Code and GitHub, then deep links.
2. Projects folder and Clone from GitHub, then the `host` field with SSH
   projects as the first non-local host.
3. Cloud sandbox Phase A behind the toggle: vessel, host chip, Settings ›
   Hosts, terminal, preview URLs, receipts.
4. Phase B in its own repository and its own spec.

## Non-goals

- Removing familiar identity, Familiar Studio, or familiar-derived rooms.
- A global "No project" scope.
- Repository-only projects or a separate GitHub project entity.
- Making the projects folder mandatory or moving existing projects into it.
- Cloud as the default runtime, or any sandbox that starts without a chat
  asking for one.
- Accounts, wallets or billing inside the Cave.

## Open questions for the owner

1. Approve the sole-project amendment in §1, or keep the strict rule.
2. Confirm the default projects folder name (`~/Coven/projects`) and the
   environment pin (`COVEN_PROJECTS_ROOT`).
3. Confirm one sandbox per project as the default, with per-familiar sandboxes
   as an explicit choice later.
4. Whether Phase B is worth its own service at all before Phase A has a month
   of use.
