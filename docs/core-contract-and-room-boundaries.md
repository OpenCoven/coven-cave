# Core contract and room boundaries

**Program:** [#6119](https://github.com/OpenCoven/coven-cave/issues/6119).
Inventory delivery: [#6126](https://github.com/OpenCoven/coven-cave/issues/6126).
Source observation: `2e24b794d2fabe8d5749c73bbb048ae10d482250`, 2026-10-20.

This document separates the capabilities Cave must preserve from the rooms that
present them. It records the current boundaries and the evidence required to
change them. It does not establish that every room is optional today or that
the program's performance, recovery, or platform acceptance is complete.
Update the inventory when an entry point, owner, persistence format, or worker
changes. Keep execution status and individual deliveries in the linked issues.

## Essential product contract

| User journey | Invariant to preserve | Implementation and acceptance evidence |
| --- | --- | --- |
| Open Cave | Reach a usable shell, with setup or a concrete recovery action when prerequisites are missing. A successful HTTP response is insufficient evidence of interactivity. | [Workspace](../src/components/workspace.tsx), [onboarding](desktop-onboarding.md), [startup supervision](runtime-startup-supervision.md). Production HTTP timings exist; fresh and migrated packaged-app acceptance remains incomplete. |
| Choose a familiar and project | Resolve the intended identity and current project access before admitting work. A room selection or cached roster is not permission. | [Workspace admission](../src/components/workspace.tsx), [project permission integrity](project-permission-integrity.md), [chat context browser cases](../tests/chat-context-performance.spec.ts). |
| Start, observe, interrupt, resume | Preserve conversation identity, run ownership, transcript history, approvals and interruption semantics across navigation and reconnect. Reconcile an uncertain mutation outcome before replaying it. | [Chat coordinator](../src/components/chat-view.tsx), [Chat router](../src/components/chat-router.tsx), [Chat API](../src/app/api/chat), [task contract](orchestration-ready-tasks.md). Real-daemon and native fault coverage is still required. |
| Recover from service failure | Distinguish missing/incomplete setup, stopped, starting/recovering, ready, unreachable/unknown, unauthorized, incompatible, unhealthy and foreign-owned states. Readiness must identify the intended authenticated instance. Use one lifecycle owner and bounded recovery; a remote target is not a local launch request. | [Daemon routes](../src/app/api/daemon), [connection supervisor](../src/lib/daemon-connection-supervisor.ts), [native shell](../src-tauri/src), [startup supervision](runtime-startup-supervision.md). The original profile's background-start failure remains unresolved. |
| Keep and recover user data | Conversations, projects, identities, grants, approvals and durable work survive restart and optional-room removal. Recovery, export, deletion and privacy maintenance remain available without the authoring room. | [Backup API](../src/app/api/backup), [Cave home migration](../src/lib/server/cave-home-migration.ts), [Research storage boundary](research-core-boundary.md), [knowledge](knowledge-vault.md). All-room removal/reinstallation evidence is missing. |
| Use supported clients | Preserve desktop and mobile access, pairing, revocation, accessible controls and native resource ownership. Evidence on one platform does not establish another. | [Client v1](api/client-v1.md), [device access](device-access.md), [cross-environment contract](cross-environment.md), [iOS audit](performance/ios-performance-audit.md), [design language](coven-design-language.md). Physical-device, sleep/wake and sustained-use gaps remain explicit. |

Core is the minimum implementation needed for these journeys, not everything
reachable from Home. A rich editor, graph or dashboard can be optional while its
data format, permissions, outstanding approvals and recovery operations remain
core. Conversely, moving a worker into a package does not make its persisted
work disposable.

## Entry-point inventory

The authoritative navigation vocabulary is
[workspace-mode.ts](../src/lib/workspace-mode.ts); the rendering authority is
[Workspace.renderSurface](../src/components/workspace.tsx).
[lazy-surfaces.tsx](../src/components/lazy-surfaces.tsx) already splits many UI
graphs. That reduces initial client loading; it does not remove server routes,
installed dependencies or startup workers.

“Candidate” below is a target boundary, not a shipped disable/removal contract.
Home and Chat remain core entry points. For other surfaces, retain the named
core capabilities before making the full interface optional.

| Canonical mode | Current UI and dependent domain | Boundary target and outstanding proof |
| --- | --- | --- |
| `home` | Home composer, launch/setup/recovery and workspace context | Core entry. Secondary feeds and recommendations are candidates; verify usable launch with their implementations absent. |
| `chat` | Lazy Chat surface/router/view; conversation, runtime, project, attachment and voice APIs | Core text/execution journey. Alternate tabs, code rail and voice are separate candidates; preserve histories, send authority and resume/interrupt without them. |
| `agents` | Lazy Familiars view; identity, roster, roles, configuration and project grants | Minimal identity/configuration access stays core. Rich Studio editing and analytics are candidates; no inaccessible identity or grant records after removal. |
| `board` | Lazy Board and work queue; [cave-board.ts](../src/lib/cave-board.ts), queue/task APIs | Optional task presentation; task integrity, dependencies, approval admission and durable execution references stay core. Verify task observation and recovery without the Board UI. |
| `inbox` | Lazy Rituals/inbox/escalations view, Calendar and Automations; inbox and automation APIs | Optional planning/calendar presentation. Outstanding approvals, attention and already-admitted scheduled work need a retained owner and accessible actions. Hiding this view must not silently cancel work. |
| `browser` | Lazy BrowserPane and native browser host | Optional browsing interface; preserve supported link-opening and native permission contracts. Verify close/unmount ownership for browser resources and an explicit unavailable state. |
| `canvas` | Lazy ChatCanvasView; [canvas store](../src/lib/cave-canvas.ts), canvas API and sandbox assets | Optional artifact editor/preview. Keep saved artifacts exportable; prove iframe, observer and editor teardown, then recovery after reinstall. |
| `marketplace` | Lazy Marketplace; catalogs, installation, roles, skills, capabilities, workflows and connectors | Optional discovery UI. Installed capabilities, compatibility validation, permission checks and uninstall/recovery cannot depend on that UI being present. |
| `submissions` | Lazy submission form; [submission adapter](../src/lib/opencoven-submissions.ts), OpenCoven endpoints | Optional publication workflow. Preserve explicit publication authority and any saved drafts; no background submission on activation/recovery. |
| `grimoire` | Lazy Grimoire; memory, Journal, knowledge, stitches, weaves and generated wikis | Optional rich reading/authoring views. Retain data discovery, access control, backup/export/deletion and the data needed by familiar chat. |
| `salem` | Lazy AskSalem/Salem chat; Salem APIs and contextual assistance | Optional assistance interface. Verify no hidden requests when absent and preserve conversation ownership for existing sessions. |

All compatibility aliases remain accounted for:

| Alias | Existing destination |
| --- | --- |
| `groupchat` | `chat`, Group tab |
| `journal` | `grimoire`, Journal view |
| `flow` | `inbox`; the retired standalone Flow view does not imply the Flow engine is removed |
| `calendar` | `inbox`, Calendar tab |
| `familiar-work-queue` | `board`, Queue tab |
| `roles` | `marketplace`, Browse; the former Roles section was removed, while role APIs remain live |
| `capabilities` | `marketplace`, Browse; the former Capabilities section was removed, while capability APIs remain live |
| `code`, `github` | `surface:code`; GitHub also requests Activity |

Persisted mode strings and deep links need an explicit unavailable destination
when a room is absent. Renaming them is not an extraction mechanism.

## Registered role rooms

The six IDs come from [ids.ts](../src/components/role-surfaces/ids.ts).
[register.tsx](../src/components/role-surfaces/register.tsx) defines lazy UI
loaders and contributions; [RoleSurfaceContext](../src/lib/role-surfaces.ts)
exposes the familiar, current thread/runtime, memory/tools/plugins and navigation
callbacks. Review and narrow this existing interface before inventing another
plugin framework.

[room-flags.ts](../src/lib/room-flags.ts) controls build visibility, followed by
role/capability filtering. The production list is Research, Navigator and X
Comms at the observed commit. The other rooms remain registered. These flags
are not server authorization or runtime package lifecycle controls.

| ID and room | Data, dependencies and permission boundary | Current evidence and next boundary proof |
| --- | --- | --- |
| `researcher-desk` — Research Desk | Optional `@opencoven/research` package; mission/ingestion/media/embedding workers; core storage, credentials, execution admission and privacy/recovery adapters | Existing [core boundary](research-core-boundary.md), [host contract](research-host-contract.md) and [historical extraction report](research-extraction-verification.md). [Dispatch](../src/lib/server/research-package.ts) authorizes before loading and checks host contract version. Re-run absent/disabled/reinstall and resource-lifetime evidence on the current build; the host exposes startup, not a general hot-disable teardown contract. |
| `navigator-chart-room` — Chart Room | Board tasks, orchestration dependencies, decisions and execution references; graph/table UI | Lazy UI, not an optional backend. Keep task mutator validation and approvals in core; prove graph/UI teardown and task recovery with the room absent. |
| `code` — Coding Desk | Workbench, editor/diff, GitHub, files, terminal/session resources and project authority | Lazy workbench behind role/build gates. Preserve `surface:code`, `code` and `github` links. Separate optional editor/review presentation from project authorization and run/PTY ownership; verify native teardown and unavailable navigation. |
| `scribe-writing-desk` — Writing Desk | [Role-surface state](../src/lib/role-surface-state.ts), local drafts, source material and Knowledge Vault publication | Lazy UI and existing persistence. Prove drafts and published documents remain discoverable/exportable without the desk, and restore editing after reinstall. |
| `indexer-archive` — Archive | Familiar-scoped memory inventory and file access through the host | Lazy UI. Storage permission and maintenance remain core; prove no scan/polling while absent and retained archive recovery. |
| `x-comms` — X Comms | Local demo planning plus live X publication; `xPublishEnabled`, server permission, confirmation and [X API](../src/app/api/x) | Lazy UI and mirrored capability gates, not a fully removable package. Keep demo approval distinct from real publication. Verify no absent-room network work, no ambiguous publish replay, and continued credential/data privacy operations. |

## Auxiliary surfaces and substantial subsystems

These are part of the inventory even though they are not additional canonical
room IDs. Each needs an absence/lifetime decision; extracting the six role rooms
alone does not establish a minimal core.

| Surface or subsystem | Existing implementation boundary | Capabilities to retain / proof still needed |
| --- | --- | --- |
| Chat Projects, Familiar, Settings and Group tabs; companion/right chat and split panes | [Lazy tab exports](../src/components/lazy-surfaces.tsx), [ChatSurface](../src/components/chat-surface.tsx), [ChatRouter](../src/components/chat-router.tsx) | Project/identity context and independent conversation ownership remain core. Verify close, switch, reconnect and pending-send cleanup across panes. |
| Terminal, code rail, file/diff/document inspectors, native sign-in | [Native shell](../src-tauri/src), [workspace rail](../src/components/workspace-rail.tsx), [lazy terminal/inspector exports](../src/components/lazy-surfaces.tsx) | Own PTYs, subprocesses and filesystem grants independently of a room. Required provider setup must remain reachable; no foreign-process cleanup. |
| Settings, command palette, onboarding, glyph/shortcut/reminder/handoff dialogs and dashboard | [Lazy exports](../src/components/lazy-surfaces.tsx), [Workspace hosts](../src/components/workspace.tsx) | Minimal setup, recovery, access revocation and navigation are core. Optional panels must not import heavy implementations before opening; verify focus return and subscription cleanup. |
| Automation editors, calendar, routine adapters and scheduled chat | [Automation domain](../src/lib/automations), [scheduled-chat scheduler](../src/lib/server/scheduled-chat-scheduler.ts), [program contract](roadmaps/coven-automations-v1.md) | Separate optional authoring from ownership of already-admitted schedules. Disabled presentation does not revoke user intent. Domain disablement needs an explicit drain/pause/recovery policy. |
| Flow engine, webhooks, Threads, proposals and auto mode | [Flow API](../src/app/api/flows), [Threads API](../src/app/api/threads), [proposals](../src/app/api/proposals), [auto mode](auto-mission-mode.md) | Retired UI is not dead engine code. Preserve durable execution, approval and effect authority; prove consumers and in-flight recovery before any engine extraction. |
| GitHub, Asana and other work integrations | [GitHub routes](../src/app/api/github), [Asana routes](../src/app/api/asana), [GitHub watcher](../src/lib/github-watcher.ts) | Optional adapters; shared task/approval integrity and safe credential handling stay core. Verify deadlines, disabled idle cost and cancellation without dropping accepted work. |
| Knowledge, memory, Journal, wiki, stitches, weaves and authoring tools | [Grimoire library](../src/lib/grimoire-library.ts), [knowledge contract](knowledge-vault.md), [authoring contract](authoring-assist.md) | Rich authoring/retrieval can be optional. Persistence compatibility, backup/export/deletion and chat-required reads need a retained implementation. |
| Voice, images, media, travel, RSS and X sources | [Voice](../src/app/api/voice), [images](../src/app/api/images), [travel](../src/app/api/travel), [RSS](../src/app/api/rss), [X](../src/app/api/x), Research boundary | Optional adapters with explicit grants. Track microphone/media/connection/process lifetime and retention cleanup separately from UI visibility. |
| Marketplace payloads, skills, prompts, crafts, roles, workflows, MCP and connectors | [Marketplace contract](marketplace.md), [MCP diagnosis](mcp-doctor.md), [capability routes](../src/app/api/capabilities) | Discovery can be optional; installed capability authority, verification, compatibility and safe removal remain available. Account for installed package and subprocess cost. |
| Runtime/model adapters, remote hosts and daemon client | [Daemon routes](../src/app/api/daemon), [runtime-model routes](../src/app/api/runtime-models), [hosts](../src/app/api/hosts), [local models](local-models.md) | Core needs the selected supported runtime, not eagerly initialized implementations for every provider. Preserve authenticated remote ownership and explicit unavailable/incompatible states. |
| Device pairing, passkeys, mobile/client APIs, tailnet and access control | [Device access](device-access.md), [Client v1](api/client-v1.md), [API security](../src/lib/server/api-security.ts) | Core for supported clients. UI removal must not remove revocation, ingress checks or audit. Current cross-platform evidence remains a separate gate. |
| Backup, sync, migration, Research restore and privacy maintenance | [Backup](../src/app/api/backup), [sync](../src/lib/server/backup-sync.ts), [instrumentation](../src/instrumentation.ts), Research boundary | Core maintenance for existing data, with optional remote-sync transport. Do not require an absent room to recover, export or delete its data. |
| Event plane, polling, file watchers, activity and notification delivery | [Event-plane operations](event-plane-operations.md), [instrumentation](../src/instrumentation.ts), [connection supervisor](../src/lib/daemon-connection-supervisor.ts) | Shared core transport/ownership where required; feature subscriptions must activate deliberately and stop. Measure duplicate reads and retention before consolidating loops. |
| Themes, CSS, icon/catalog assets, sandbox and packaging | [Global facade](../src/app/globals.css), [lazy surfaces](../src/components/lazy-surfaces.tsx), [package manifest](../package.json), [budgets](performance-budgets.md) | Keep shared accessibility/design primitives. Measure actual import/trace graphs and installed bytes; moving source files or CSS does not itself establish a saving. |

## Startup work and lifetime gaps

[instrumentation.ts](../src/instrumentation.ts) runs these on Node startup,
independently of whether their room is visible. “Retain” denotes a required
capability, not approval of its current startup cost.

| Work | Observed gate/lifetime | Boundary implication |
| --- | --- | --- |
| Cave-home migration | Shared readiness promise; shell registration does not await completion | Retain data coordination. Verify interrupted/migrated profiles without private production fixtures. |
| Research interrupted restore | Chained after migration | Retain while Research is absent, including handle/timer cleanup. |
| Research runtime | `startOptionalResearch` checks capability before import; host version checked | Existing optional startup boundary. Hot disable/drain and reactivation need separate proof. |
| Expired X cache and Research runtime privacy sweeps | Detached best-effort startup work | Retain required privacy maintenance for existing data even without authoring/ingestion. Bound work and retries. |
| Inbox reminders | Immediate catch-up and 15-second interval; one pending pass per process, no exported stop handle | A slow transaction does not queue more timer passes; success or failure releases admission for the next interval. Reminders remain active independently of room visibility. Cross-process ownership, hung-store escalation and shutdown/drain remain separate work before optionalizing this domain. |
| Scheduled chat | One process-local owner (#6209): a single unreferenced 15-second timer, one pass in flight, synchronous stop admission, production-build guard. [`startup-worker-shutdown`](../src/lib/server/startup-worker-shutdown.ts) drains it on SIGINT/SIGTERM (three-second observer) and on the packaged parent lease (1,200 ms Unix, 400 ms Windows, beneath the native kill/Job fallback). A drain that outlives its deadline is reported `pending`, never cancelled or replayed, and the worker cannot restart after coordinated shutdown. | Preserves scheduled send admission. Disabled-feature behavior remains separate work; a Windows normal quit now closes the same private stdin pipe as Unix, verified by hosted native tests, not on physical hardware. |
| GitHub watcher | One process-local owner; enabled subscriptions with repositories/events poll every 60 seconds; unavailable settings retain that slow read retry; token gates requests; cancellable eight-second response/JSON deadline | Settings changes cancel obsolete reads, remove the timer and drain admitted persistence before saving. Confirmed disabled/empty/no-event startup owns no timer; repeated enable/disable keeps one timer and preserves cursors/dedupe. Tests cover ignored cancellation, actual HTTP body closure, atomic-store removal races and recovery from unreadable settings without overwriting them. Already-started filesystem writes are drained, not claimed cancellable; cross-process ownership and hung-write escalation remain separate gaps. |
| Backup sync | One owner (#6209): a 15-minute unreferenced tick only while configured enabled, one pass at a time, and a stop that drains the in-flight pass then makes the bounded quit push (three-second budget) when the coordinator asks; configuration changes wait for the retained drain. Same coordinator and packaged-lease deadlines as scheduled chat; a quit push that outlives the lease is reported, not replayed. | Core recovery is separate from optional remote sync. Disabled configuration owns no timer; the quit push is best effort inside the native deadline and must never be read as a completed sync. |
| Event-plane daemon/roster/Board watchers | Started when `COVEN_CAVE_EVENT_PLANE_ENABLED` is `1` or `true` (trimmed and case-insensitive) | Existing feature gate. Measure and verify watcher disposal and fallback polling for each client/platform. |

Do not stop an execution or required privacy task just because its room closes.
UI subscriptions belong to UI lifetime. Durable jobs belong to their explicit
execution owner. An optional domain must define what disabling it does to
admitted jobs, including recovery after restart, before exposing that operation.

### Scheduled-chat and backup worker maintenance

Change backup enablement, destination, retention, and quit-push preferences through the existing backup settings/API. A disabled backup scheduler owns no recurring timer; re-enabling it starts one owner and preserves boot catch-up. Stop Cave through its normal shutdown path before maintenance. Signal shutdown observes HTTP close and worker drains together for up to three seconds; packaged quit uses the shorter native lease (1,200 ms on Unix, 400 ms on Windows). These deadlines do not guarantee completion; the native fallback can end the process while admitted work is still pending.

Inspect startup-worker shutdown warnings before treating quit as a completed backup. `pending` means the deadline expired, `failed` means a stop callback rejected, and `unavailable` means no worker owner registered in time. None proves a completed snapshot or send. Preserve backup state, encrypted credentials, snapshots, and scheduled-chat claims, and use their existing status/reconciliation paths after restart. Do not clear a durable `sending` claim or manually replay an uncertain send to make a shutdown receipt look successful.

The lifecycle change adds no persisted-state migration. Before delivery, rollback means keeping the current main implementation and retaining the candidate for repair. After delivery, revert the complete lifecycle change through a reviewed PR or return to a previously qualified application build; do not partially restore an old signal hook beside the new coordinator. Retain user data and validate backup-state version compatibility before an older build opens it. Malformed, unreadable, or newer backup state must remain untouched. A rollback restores the prior idle timer and quit limitations, so rerun the isolated disabled/enabled/held-archive probes and verify process/port cleanup before claiming recovery.

## Common acceptance for an optional boundary

Use the existing Research interface where its contract fits. Prefer a small
internal module or optional package; require a concrete ownership or release
benefit before adding a repository, service or generic registration layer.

| Scenario | Required observation |
| --- | --- |
| Package absent | Core launch/chat/recovery succeeds; unavailable navigation is actionable; no package implementation, worker or heavy initialization runs. Data maintenance remains usable. |
| Installed but disabled | No feature workers, polling or heavy initialization; measure unavoidable lightweight registration. Explain the distinction from a hidden room. |
| Unauthorized request | Reject before implementation loading or side effects, including direct routes and streaming/media variants. UI role filtering alone cannot satisfy this. |
| Incompatible or failed load | Explicit unavailable state and bounded diagnostics; no retry storm, partial mutation or accidental fallback into weaker authority. |
| Activate | One owner, version/capability checks, bounded startup and verified usable state. Measure first activation and repeated activation. |
| Deactivate during work | Stop UI resources and apply the explicit durable-job policy. Reconcile ambiguous effects; preserve approvals and data; prove owned resource cleanup. |
| Remove/reinstall | Existing data remains discoverable, recoverable, exportable and deletable, then reopens under the compatible implementation. Test interrupted transitions. |
| Repeated cycles and soak | Stable resource counts, bounded memory/disk/request growth and recovery behavior under failures. Include native and supported mobile evidence where applicable. |

Use isolated synthetic homes and representative workloads. Keep the denied,
failed and interrupted samples. A mocked unavailable banner is not an
absence test: run the built core with the optional implementation physically
absent and inspect its dependency trace and background activity.

## Evidence and simplification ledger

The program's current baseline is recorded in
[#6119's measurement receipts](https://github.com/OpenCoven/coven-cave/issues/6119#issuecomment-6297286310).
The production build measured initial Home JavaScript 1,699 KB, root CSS 594 KB
against a 640 KB budget, and a 202,649,611-byte standalone artifact. The five
HTTP launch samples measured server response readiness, not first usable
interaction. The real-daemon lifecycle samples in
[#6120](https://github.com/OpenCoven/coven-cave/issues/6120) use empty synthetic
homes; they do not establish migrated-profile or packaged-native recovery.
Keep each receipt's exact source/binary/probe provenance.

At the inventory source commit, `package.json` declares 54 runtime dependencies,
20 development dependencies and one optional Research dependency. These are
manifest counts, not installed/transitive counts or proof of complexity
reduction. The Research extraction report is historical; moving its code out
of Cave did not establish a current responsiveness improvement.

For every extraction or consolidation, record before/after:

- User journeys and authority preserved, with regression/fault evidence.
- Production startup/interaction, activation and idle/soak costs.
- Client bundles, server traces, installed files/bytes and subprocesses.
- Dependencies, ownership boundaries, state machines and operational steps
  across **all** affected repositories.
- Removed duplicate or dead implementation and the consumers proving removal
  safe; maintenance/rollback cost added by the replacement.

Keep existing performance budgets. Do not count moved lines as removed
complexity, substitute UI visibility for lifecycle control, or remove
diagnostics, accessibility, safety checks or meaningful tests to improve a
size metric.

The next implementation decisions should follow reproduced user failures and
measured costs. The status-read deadline (#6122) and the real lifecycle probe
(#6120, [daemon lifecycle](performance/daemon-lifecycle.md)) merged on
2026-10-20; the unresolved background startup failure still needs
owning-component diagnosis. For modularization, establish a current
all-optional-rooms-absent baseline and resource-lifetime evidence before selecting
the next extraction. This inventory does not complete those obligations.
