# Changelog

All notable changes to CovenCave land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). CovenCave uses
[SemVer](https://semver.org/) while still in 0.x — minor releases may carry
breaking config changes; patch releases stay additive.

## [Unreleased]

## [0.0.93] - 2026-06-15

Patch release: ships the familiar sessions polish, board project grouping, Delegations trace recovery, and chat runtime-scope hardening work after 0.0.92.

### Added
- **Familiars** — redesigns the familiar sessions surface around the Familiars header, moves familiar switching into the chat top bar, and restores uploaded avatar images across Cave (#746, #749).
- **Board** — groups task cards by Project in Kanban swimlanes and table sections (#755).
- **Chat** — injects familiar daily memory startup context into local familiar chat prompts and enlarges familiar avatars in assistant turns (#750, #752).
- **Delegations** — infers familiar-to-familiar traces from session initiator provenance, so Cave-visible sessions started by another familiar appear in the Delegations graph even without an explicit call ledger entry.
- **Chat** — routes Markdown links in assistant turns into the companion browser sidepanel while preserving right-panel collapse behavior (#763).

### Fixed
- **Release workflow** — installs platform runner dependencies needed by release builds (#747).
- **Familiars** — downsizes large uploaded avatar images before storage (#751).
- **Capabilities** — restores Markdown/Codex automation descriptor previews after the #742 regression (#753).
- **Layout** — tightens Cave sidepanel spacing (#748).
- **Runtime scope** — refuses invalid local project roots instead of silently falling back to the home directory, and injects a runtime filesystem boundary into Cave-launched harness prompts so sessions know to stay inside their declared local or SSH root (#763; OpenCoven/coven#230).

## [0.0.92] - 2026-06-15

Patch release: ships the post-0.0.91 hardening and Cave polish sweep.

### Added
- **Salem Pathfinder** — adds the Home entry point, deterministic pathfinder cards, Save-to-Board flow, local feedback capture, and eval fixtures (#703, #724, #727, #730).
- **Familiars** — replaces the scope dropdown with the horizontal dock, adds the sleeker Studio/dock surfaces, moves the switcher into the top bar, and gives the sidebar switcher a legible labeled trigger (#701, #722, #723, #729, #741, #744).
- **Capabilities** — expands rows with inline inspector details and previews supported Markdown/Codex automation descriptors safely (#732, #737, #742).
- **Calls** — surfaces delegation attention summaries in the calls graph (#740).

### Fixed
- **Security** — hardens daemon session APIs, launch cwd handling, local PDF serving, memory and skill file reads, checkpoint diff hooks, and sidecar dependency integrity (#705, #711, #715, #718, #719, #720, #721).
- **Terminal** — locks down PTY websocket auth while restoring credential-less loopback and verifying peer address for the local desktop path (#708, #714, #735, #738).
- **Mobile/Tailscale** — requires signed native access, avoids leaking handoff tokens, keeps proxy source checks same-origin, and fixes sidecar-token requests through Tailscale Serve (#706, #709, #710, #712, #713, #716, #739).
- **Library** — dedupes table-of-contents heading IDs so duplicate React keys do not break the reader (#731).
- **Memory** — blocks symlink escapes while preserving valid reads under a symlinked root (#717, #736).
- **Workflows** — pins the collapsed right-panel toggle to the top (#734).

## [0.0.91] - 2026-06-15

Patch release: tidies the GitHub PAT button.

### Changed
- **GitHub** — when a PAT is connected, the toolbar button is now icon-only (key icon, no "PAT connected" text), with an aria-label for accessibility; the disconnected state keeps the "Add PAT" text (#688).

## [0.0.89] - 2026-06-15

Patch release: the top-bar familiar switcher is always available.

### Fixed
- **Top bar** — the familiar switcher box now shows even before a familiar is active (e.g. on Home), falling back to the first familiar, so it's always reachable to make a selection (#684).

## [0.0.88] - 2026-06-15

Patch release: a familiar switcher in the top bar.

### Added
- **Top bar** — a familiar switcher box showing the active familiar; click it to open a picker and switch familiars, on desktop and mobile (#679).

## [0.0.87] - 2026-06-15

Patch release: positions the mobile scroll-to-bottom button correctly.

### Fixed
- **Chat** — the mobile scroll-to-bottom button now hugs just above the composer instead of floating high in the transcript (its `bottom` offset was tuned to the composer's actual height) (#674).

## [0.0.86] - 2026-06-15

Patch release: finishes repairing the auto-updater (the GitHub PAT no longer writes inside the signed bundle) and fixes the mobile scroll-to-bottom button.

### Fixed
- **Updater** — the in-app GitHub PAT form no longer writes `.env.local` inside the read-only, code-signed `.app` bundle (it resolves to a writable per-user path, read back via the vault resolver). This was the last of the runtime writes that broke the bundle's signature seal and the in-place auto-updater (#657).
- **Chat** — the mobile scroll-to-bottom button now renders correctly. It used `float: right` with `position: sticky`, which broke sticky positioning in the iOS WKWebView so the button landed too high or not at all; it now right-aligns with `ml-auto` and sits above the composer (#662).

## [0.0.85] - 2026-06-15

Patch release: a recoverable update flow, a mobile task-page fix, and the chat rail redesign on top of 0.0.84.

### Fixed
- **Updater** — a failed native install no longer dead-ends. The settings row and banner now surface the real failure reason and offer a working manual Download (release page) plus Retry, so the update is always reachable (#642).
- **Mobile** — the board card "task page" drawer header now clears the iOS status bar / Dynamic Island, so the title and close button are no longer occluded (#640).

### Changed
- **Chat rail** — modern redesign with a nav block, counted sections, and a familiar strip (#644).
- **OpenCoven tools** — added tool update controls.

## [0.0.84] - 2026-06-15

Patch release with capabilities, library, and iOS fixes on top of 0.0.83.

### Fixed
- **Capabilities** — the skill markdown preview now renders for real skills. The daemon reports a skill's folder path, so the preview resolves `<folder>/SKILL.md`, strips YAML frontmatter, and falls back to the description when no `SKILL.md` exists.
- **Library** — reading list sections now order Want to Read → Reading → Done.
- **iOS** — fixed the terminal reconnect hang and capability scoping (TestFlight).

## [0.0.83] - 2026-06-15

Patch release carrying the latest `main` polish on top of the refreshed
OpenCoven app icon (shipped in 0.0.82).

### Changed
- **Navigation** — Projects moved out of the left sidebar; it now lives solely as the Chat Projects tab.
- **Capabilities** — skill markdown renders as a styled preview in the inspector.

### Fixed
- **Mobile** — composer/library rendering polish, notification popover fit, and larger touch targets.
- **iOS** — capability scoping fix.

## [0.0.82] - 2026-06-14

This patch release ships the Tailscale/proxy fixes needed for the new Cave release, plus the latest Projects and mobile handoff polish from `main`.

### Added
- **Nested project chats** — the Projects view now renders nested chats and supports dragging chats across projects.

### Fixed
- **Tailscale Serve origin handling** — daemon proxy requests over a non-default Tailscale Serve HTTPS port are accepted only when the forwarded `.ts.net` host and port match, clearing the forbidden-origin banner on the 8443 Cave route.
- **Token-bearing proxy calls** — authenticated Cave requests now bypass the browser-origin gate correctly.
- **iOS handoff invites** — mobile handoff links open in the iOS shell again.

## [0.0.81] - 2026-06-14

This patch release completes the Agent Memory redesign, adds local-change checkpoints and an in-app update button, and tidies the bookmarks table.

### Added
- **Update available button** — the app now surfaces a button when a newer release has been published.
- **Agent memory grouping & full content** — the unified memory list can group by type, source, or date, and agent (familiar) memories now open their full file in the reader instead of just an excerpt.
- **Change checkpoints** — the Changes view gained checkpoints with recoverable reverts.

### Changed
- **Bookmarks** — removed the Tags column from bookmark rows for a cleaner, more legible table.

### Fixed
- **Agent memory reader** — agent memories no longer fail with "path not allowed"; their content renders correctly.
- **Changes** — fixed stale diffs and `.env` file mangling.

## [0.0.80] - 2026-06-13

This patch release ships the next macOS desktop build and a fresh iOS/TestFlight build after the App Store Connect bootstrap work, carrying the latest mobile, chat, workflow, and memory polish from `main`.

### Added
- **Native iOS release path** — CovenCave now declares exempt encryption usage, skips desktop sidecar resources for iOS, and shows a mobile release bootstrap screen in the native shell.
- **Projects in chat** — chat gains a first-class Projects tab and project selection improvements for routing work into the right local repo.
- **Memory master-detail view** — the Agent Memory tab now uses a denser master-detail reader with reusable row/read hooks and better source handling.

### Changed
- **Workflow Studio** — workflow canvases gained a vertical layout mode and tighter canvas controls.
- **Chat and reading polish** — chat lists, mobile command-center spacing, and Library reading styles were tightened for daily use.
- **Library scope** — the old knowledge graph section was removed to keep the current Library surface focused.

### Fixed
- **iOS/TestFlight metadata** — bundle and generated iOS plist versions now advance with the app release, and export-compliance metadata is included for App Store Connect processing.
- **Mobile shell bootstrap** — the iOS shell falls back to a clearer release bootstrap experience when the desktop daemon is not available.

## [0.0.79] - 2026-06-13

This patch release follows v0.0.78 with mobile shell hardening: native browser IPC now stays desktop-only, and the mobile chat command center gets tighter composer geometry.

### Fixed
- **Mobile browser fallback** — BrowserPane and embedded Library link previews now call native `browser_*` IPC only on Tauri desktop, so mobile/iOS shells fall back cleanly instead of touching desktop-only commands.
- **Mobile chat composer geometry** — the mobile composer controls now expose a dedicated overlay hook and tighter spacing so the command center stays usable on phone viewports.
- **Mobile tab spacing** — shell detail panes no longer double-reserve bottom-tab height after the tabs moved into normal shell flow.

### Tests
- Added mobile coverage for the native-browser fallback path and the chat command-center composer overlay.

## [0.0.78] - 2026-06-13

This patch release carries the latest tailnet/mobile dev auth hardening after v0.0.77, including Tailscale Serve host support and native iOS webview sidecar authentication.

### Added
- **Tailscale Serve host support** — mobile/dev access now recognizes Tailscale Serve hostnames alongside localhost-style development hosts.
- **Tauri desktop check coverage** — proxy behavior coverage now verifies the desktop/webview host path stays wired while remote tailnet access remains gated.

### Fixed
- **Native iOS dev webview auth** — the Tailscale native launch path now writes and passes the sidecar mobile token so the iOS Tauri shell can authenticate against the local dev server.
- **Host-gate test drift** — middleware ordering assertions now match the shared `requestHost` path used by the proxy host gate.

## [0.0.77] - 2026-06-13

A large reading-experience release: a full suite of long-form typography controls, board touch dragging and reliability fixes, real calendar actions, memory management, and continued CodeQL security hardening.

### Added
- **Reading typography suite** — new long-form reading controls: drop cap (library reader), hyphenation, font weight, text alignment, letter spacing, line spacing, maximum reading width, and a reframed Text size control.
- **JetBrains Mono** is now the default monospace/code font.
- **Board touch dragging** — cards can be dragged on touch devices, with a long-press ghost and reliable drop handling.
- **Calendar item actions** — real Done/Dismiss/Snooze actions, an overlap-aware day grid, and an accessible, keyboard-navigable dialog.
- **Memory management** — delete with undo, stale-memory suggestions, and grouping/sorting/filtering of memories.
- **Library navigation** — Back and Refresh controls in the Library nav.
- **Roles** — role workflows resolve against Workflow Studio manifests, with scaffold/open support.
- **Projects** — richer project list with readable file previews.

### Changed
- **Chat surface polish** — honest header metadata, task chips navigate to the board, the transcript column centers on wide screens, the right session panel mirrors the left rail width, and message hover tint was dropped (copy moved to its own row).
- **Chat list** — unified row pill chrome and uniform action buttons.
- **Workflows** — enlarged manifest preview, left-aligned Boards/Projects attachment toggles, and saved builder node positions.
- **iOS / mobile** — larger touch targets and Info.plist newline syncing.

### Fixed
- **Board reliability** — honest loading-vs-empty state, surfaced (and dismissible) move failures, a card crash guard, accessibility fixes, and a portaled task drawer so fixed positioning escapes the mode-fade transform.
- **Library** — bookmark titles no longer collapse to "DeepWi…".
- **Chat** — folder icon follows expand state rather than selection, and the native select chevron was removed from the project chip.
- **Changes panel** — reverts against HEAD and handles staged files correctly.
- **Security hardening** — additional CodeQL-driven path-injection fixes across workflow source file handling (alerts 42–45).

## [0.0.76] - 2026-06-12

Cave gets a security-hardening sweep, safer dependency intake, production workflow starters, and more durable chat tool history.

### Added
- **Production workflow starter manifests** — default workflow manifests now ship with repository coverage so the Workflow view has real starting points to build from.
- **Supply-chain policy test** — dependencies must stay exact-pinned, the pnpm manager version is pinned, and pnpm's 3-day `minimumReleaseAge` gate is enforced in CI.

### Changed
- **Dependency intake hardening** — package ranges are pinned exactly, future saves default to exact versions, and too-fresh package releases are delayed for three days before install eligibility.
- **Chat layout polish** — the chat surface uses the available width more fully and settled tool activity can collapse behind a compact meta row.
- **Role/workflow internals** — role-file scanning is shared through one source library, reducing drift between workflow and role surfaces.

### Fixed
- **Persisted tool-use rows** — assistant tool rows now survive refreshes and chat switches instead of existing only in live client state.
- **CSV import stability** — CSV mapping no longer falls into a render loop.
- **Security hardening** — CodeQL-driven fixes tightened browser-pane URL handling, GitHub enrichment URL validation, graph/project/chat path constraints, chat mention paths, CI workflow permissions, regex tag stripping, slug generation, and GitHub library host checks.

## [0.0.75] - 2026-06-12

Cave gets safer library/workflow file handling, live onboarding jobs, and clearer session provenance.

### Added
- **Background onboarding install jobs** — setup actions now run as resumable jobs with live progress, reducing stuck setup states and making install status visible (#484, #486).
- **Session initiator provenance** — chat sessions and Coven Floor traces now show who started a session, such as `Started by Valentina / Telegram`, `Started by Kitty`, or automation like cron/heartbeat, without exposing raw IDs or paths (#478).
- **Palette link saves** — `/save <url>` now offers a destination choice for saved links (#480).
- **Security policy** — the repository now includes `SECURITY.md`.

### Changed
- **Workflow Studio polish** — compact engine-consistent selects and tighter panel trigger alignment make workflow editing denser and steadier (#476, #485).
- **Onboarding copy** — familiar creation confirmation drops the extra OpenClaw wording and setup buttons provide clearer live feedback (#479, #483).

### Fixed
- **Terminal stability** — shell-owned keyboard chords, PTY survival, and reconnect handling stop terminal input from being lost (#481).
- **Workflow canvas arrows** — edge arrows render correctly under screen magnification (#482).
- **Onboarding retry behavior** — harness fetch retries while empty so runtime setup does not strand (#477).
- **Library and workflow path hardening** — CodeQL path alerts are fixed by constraining saved graph IDs and role/workflow path segments before file reads/writes (#487, #488).

## [0.0.74] - 2026-06-12

The terminal works again in the packaged app.

### Fixed
- **Terminal in the desktop app** — v0.0.72's mobile-access token gated the terminal websocket and locked out the app's own webview ("Terminal connection failed: [object Event]"). Credential-less loopback upgrades are the local app and connect again; supplied credentials are still verified, remote tailnet hosts still require the token, and cross-site origins stay rejected. Connection failures now report the websocket close code and a recovery hint instead of `[object Event]`.

### Added
- **Guided onboarding** — step-by-step setup with one-click installs and SSH (#474).

### Changed
- **Workflow attachments** — Familiars/Roles/Boards/Projects sections collapse independently with count badges; section bodies span the panel's full width; side-panel collapse tabs align.
- **Dark scrollbars** comprehensively across dark mode (#475).

## [0.0.73] - 2026-06-12

Chats that persist and a workflow canvas you can rearrange by hand.

### Added
- **Draggable workflow nodes** — drag any step on the studio canvas and the arrangement sticks, persisted to a cave-only `workflows/<id>.cave.json` sidecar; the canonical manifest stays byte-identical. Unmoved steps keep their dependency-layered defaults.
- **Library translate handoff** completed with icon whitelist and spec coverage.

### Fixed
- **Chat conversations no longer fork on resumed turns** — continued turns now resume in the conversation's original working directory (harness session stores are cwd-scoped) and keep a stable cave-owned conversation id while the harness's per-resume session id is tracked internally. Previously each continued turn could lose project context and spawn a new sidebar session.
- **Workflow canvas edges render** — step nodes gained explicit connection handles (React Flow error #008), with a toggleable themed minimap.
- **Machines without Node or Git are covered** — Node ships inside the app bundle (the release now refuses to build without it); Git became an advisory setup check with platform-aware install hints, missing-git API errors are actionable, and the README gains a dependency table.
- **Friendly error when the coven CLI is missing**, and mobile-access token checks no longer trust spoofable `Host` headers.

### Changed
- **Workflow studio polish** — role attach rows align as fixed columns with right-pinned familiar tags; all studio scroll regions use thin dark scrollbars.
- **Library metadata block** spans full width as a collapsible tab; mobile search bar spans the top-bar middle column.

## [0.0.72] - 2026-06-11

The Workflow Studio release: the Cave goes from *viewing* workflows to **building, running, and staffing** them — plus first-class Projects, an embedded Browser pane, a deep chat-transcript overhaul, and a Tailscale-secure native iOS app.

**Workflow Studio at a glance**

| Capability | v0.0.71 | v0.0.72 |
| --- | --- | --- |
| Library | read-only manifest list | search, **create from 8 CWF-01 pattern templates**, duplicate, delete |
| Canvas | static step preview | full visual builder — palette steps, drag dependency edges (cycle-guarded), delete, **undo/redo**, layered DAG layout with directional edges |
| Manifest | summary fields | **live canonical YAML**, key-ordered saves back to `workflows/*.yaml` |
| Validation | saved workflows only | unsaved drafts validate **and dry-run** before they ever touch disk |
| Runs | — | run-history panel: dry-run plan snapshots + daemon executions; Play stays honestly guarded until the engine exists |
| Assignments | — | familiars persist into the manifest; **roles gain workflows via ROLE.md** |
| Automation | — | schedule a workflow as an Automations reminder that deep-links back |

### Added
- **Workflow Studio v2** — visual builder with step palette, editable inspector, requires-edge drawing with cycle rejection, undo/redo, save back to canonical CWF-01 YAML, create-from-pattern, duplicate/delete/search, run history, role assignment into ROLE.md, and schedule-as-automation (#458, #466, #470, #472, #473).
- **Projects, first-class** — a dedicated Projects page and registry, with the chat composer using the configured project selector (#461).
- **Browser pane** — an embedded browser surface with a collapsible toolbar and click-to-pin rail (#460, #463).
- **Native iOS app over Tailscale** — Tailscale-secured native iOS Tauri build with persistent handoff invites.
- **Chat, deeper transcript tooling** — in-transcript find with turn-level jump (#434), conversation content search, @-mention repo files from the composer (#437), per-turn token usage and cost, working-tree changes panel with per-file diff and revert (#422), patch checkpoints, and response metadata on replies.
- **Terminal split panes** — run multiple shells side by side with stabilized pane layout.
- **Library provenance timeline** — graphify moved into a 3D timeline view (#456, #457).
- **Capabilities operator map** — inspector with URL-persistent filters that survive reloads.

### Changed
- **Chat shell** — the right panel splits vertically (#459); the chat list gains a side-panel optimization and compact mode (#465); empty-state project selector and prompt buttons are more compact (#468); sidebar header rows are fully clickable.
- **Transcript rendering** — tool calls interleave at their chronological position in the turn (#440); collapsed tool rows summarize their arguments; mutation tool inputs render as diffs; sticky code headers with height clamps (#433).

### Fixed
- **Chat correctness** — cancelled turns persist as cancelled instead of fabricated errors (#416); failed turns show a visible retry (#420); concurrent tool events are preserved; chat hash navigation hardened; slash menus get combobox/listbox ARIA (#423); overlays trap focus; mention-picker index is clamped.
- **Chat performance and readability** — 1000-turn transcripts render with indexed caches and turn maps (#444); muted-ink contrast, table overflow, and tool clamping pass (#442); linear line length capped with dark code chrome fixed in light mode (#425).
- **Sessions** — sessions without a valid cwd are filtered from the chat list (#455).
- **Build safety** — CaveProject types extracted to a client-safe module so `node:fs` stays out of the browser bundle (#462).
- **Release pipeline** — macOS DMG packaging retries transient failures.
- **Workflow Studio polish** — layered dependency layout, legible directional edges, dark-themed canvas chrome, and viewport containment so run controls stay on screen.

## [0.0.71] - 2026-06-11

### Added
- **Chat attachments** — paste or drag-drop files straight into the composer (#412); image attachments reach the harness via temp files instead of being dropped (#407).
- **Edit and resend** — edit-and-resend user turns and regenerate assistant turns (#409).
- **Workflow manifest surface** — Cave workflows gain a manifest view (#399).

### Changed
- **Kanban board** — kanban always uses status columns; the group toggle is hidden there (#393).
- **Shell chrome** — left-edge reopen tab for collapsed nav, pressable edge-rail chips (#392), and side-panel edge-trigger polish.
- **Salem panel** — the Docs/Tools/Skills/Context count pills under the header are gone; the panel opens straight into the chat (#408).

### Fixed
- **Terminal works in the packaged desktop app** — the sidecar now ships the custom PTY-bridge server, so terminal websockets (browser localhost access against the installed app, mobile handoff) reach a real shell instead of hanging on the upgrade; `pnpm dev:app` boots against the live dev server without requiring a prebuilt sidecar bundle; Tauri-mobile rides the same WebSocket bridge instead of rendering a "not available" placeholder. (#401)
- **Terminal shell environment** — spawned shells no longer inherit pnpm's `npm_config_*` leakage. (#403)
- **Dev server hardening** — dev binds loopback by default and the PTY websocket rejects cross-site browser origins. (#391)
- **Chat streaming stability** — markdown renders progressively while streaming (#405), scroll pins instantly with intent-based release and respects reduced motion (#404), composer input typed while streaming survives (#397), code-block copy buttons work (#398), message actions are keyboard- and touch-reachable (#400), and the highlighted slash-menu command runs on Enter.
- **Home reminders** — reminders can be scheduled from the composer, with timezone-independent draft expectations in tests (#396).
- **Memory rail** — the inspector failure browser collapses when no entries exist (#394).

## [0.0.70] - 2026-06-11

### Fixed
- **Apple Silicon DMG release packaging** - retries transient `hdiutil create` `Resource busy` failures and detaches stale CovenCave DMG mounts before rebuilding the container, restoring the missing Apple Silicon macOS artifact after `v0.0.69` partially uploaded only the Intel DMG.

## [0.0.69] - 2026-06-11

### Fixed
- **macOS notarized DMGs** - restores the macOS release lane after the packaged `node-pty` sidecar added unsigned `spawn-helper` Mach-O files. The sidecar bundle now restores executable mode for those helpers, the release signing sweep signs them explicitly, and invalid Apple notarization responses print the notary log instead of falling through to a vague stapler Error 65.

### Notes
- This is the replacement desktop release for `v0.0.68`; it includes the `v0.0.68` project-aware chat, library reader, dev-server, and terminal bridge changes with the macOS packaging fix applied.

## [0.0.68] — 2026-06-11

### Added
- **Project-aware new chats** — new chat launches can carry an explicit working directory from the home composer, task chat actions, terminal/Comux project lists, and project-scoped chat navigation.
- **Library reader controls** — document reading gains a deduped title treatment, document navigation affordances, themed scroll styling, and reader width controls. (#380, #383)

### Changed
- **Chat and project surfaces** — the selected-familiar chat list drops redundant dossier chrome, project rows toggle/select as a full row, the project sidebar stays visible, and chat titles use an explicit rename button. (#379, #382)
- **Library Projects view** — Projects now owns the full Library canvas, with deduped/disambiguated project rail entries instead of cramped nested content. (#381)
- **Toolbar consistency** — Calendar uses one Add-event entry point with a uniform compact toolbar row. (#384)

### Fixed
- **Dev-server HMR and stale PWA state** — the custom dev server forwards non-PTY websocket upgrades to Next.js again, while development unregisters stale service workers and clears old CovenCave PWA caches. (#385)
- **Terminal bridge recovery** — browser PTY bridge support is restored on main after the release polish wave.
- **Capabilities and skills restoration** — harness manifests and user Claude skills are visible again in Roles → Skills.

## [0.0.67] — 2026-06-11

### Added
- **Chat deletion** — chats can be deleted from the Chats page behind an inline Cancel/Delete confirmation; deletion goes through `DELETE /api/chat/conversation/[id]`, removing the transcript file and sacrificing the session. (#373, follow-up unification)
- **Session debug panel** — bug button, right-panel Debug tab, and a live event tail for diagnosing a session in place. (#370)
- **Project-context chat grouping** — the chat list groups conversations by project, with local Coven Cave branch collapsing. (#368, #377)
- **Memory graph source hubs** — graph mode now renders source-level memories (Coven native, OpenClaw workspace/index, Codex runtime) as standalone hubs instead of silently dropping them; `includeSources: false` preserves the agent-only view. (#369)
- **Library workflows** — search, URL field, inline status, and error states for the list sections, plus an undo-delete toast. (MF-1/2/3/6, DF-4)

### Changed
- **First-fetch loading skeletons** — Chat list, Inbox, and Settings Add-ons show row-shaped skeletons until their first fetch settles instead of flashing empty states. (#375)
- **Send on Enter** — home and dock-chat composers send on plain Enter, matching the chat composer.
- **Quieter row actions** — Board/GitHub/Agents/Plugins row CTAs shortened to `Start` / `Open`; library timeline sidebar polished; right-panel content scrolls properly.

### Fixed
- **Inspector tab flicker** — selecting any non-Memory tab oscillated between tabs every frame (bidirectional roving-tabindex sync); the pane is now stable with selection-follows-focus keyboard navigation. (#374)
- **Identity canon leaking into session titles** — canon-binding text no longer appears as chat titles, legacy variants are sanitized, and prompt-derived titles are dropped from the send route. (#371, #372)
- **Home-screen chat handoff** — no longer kills the harness and 404s; auto-send deferred past React strict-mode effect replay.
- **e2e suite repair** — un-nested a Playwright test that silently never ran (15→21 passing across the three device projects). (#376)

### Added
- **Runtime demo mode** — demo data for screenshots and simple testing can now be activated with `?demo=1`, from onboarding, or from Settings → General → Startup without editing environment files.

### Changed
- **Demo reset** — clearing demo mode removes the local toggle and strips the launch URL flag so testers can return to a normal Cave session quickly.

## [0.0.65] — 2026-06-10

### Added
- **Library PDF papers** — Library reading items can point at local PDF files, with an inline PDF viewer and a guarded `/api/library/pdf` route for files in `~/.coven/library/papers`.
- **Understand-Anything graph loading** — Library graph now prefers `.understand-anything/knowledge-graph.json` output, preserving typed node/edge metadata while falling back to the older Graphify output path when needed.

### Changed
- **Library storage root** — Library data now lives under `~/.coven/library` alongside other Cave state, with `CAVE_LIBRARY_DIR` still available as an override.
- **Desktop chrome** — desktop Cave runs without the global top header while keeping the mobile/tablet top bar available for drawer controls. (#360)

### Fixed
- **Browser toolbar visibility** — the desktop browser pane now keeps its back/forward/address toolbar in flow and aligns the native Tauri child webview bounds with the visible pane.
- **First-message chat continuity** — new chats keep their optimistic in-flight transcript visible while the daemon session id is promoted, instead of briefly replacing it with an unavailable-history state. (#361)
- **Desktop window scroll** — the desktop shell regression now asserts the hidden top bar does not reintroduce window-level vertical scrolling. (#360)

## [0.0.64] — 2026-06-10

### Changed
- **Chat history recovery states** — missing/error transcript notices now offer Retry and Back to sessions actions, with retry reloading history without a page refresh. (#356)
- **Knowledge graph readability** — dense graphs now use a faster large-graph layout, suppress noisy labels until hover/selection, and render the graph on the full Library canvas. (#356)
- **Empty companion rail behavior** — when no familiar is selected, Cave collapses the right companion panel instead of reserving space for an empty rail. (#357)

### Fixed
- **Packaged mobile handoff QR** — the mobile handoff API now resolves the Tailscale CLI from macOS app/Homebrew/common install paths or `TAILSCALE_BIN`, preventing packaged app `spawn tailscale ENOENT` failures. (#354)
- **Window-level shell scroll** — the app shell now anchors `100dvh` on the outer frame so the document/body do not become globally scrollable. (#358)

## [0.0.63] — 2026-06-10

### Changed
- **Chat surface streamline** — the chat header collapses into a single MetaLine (editable title + `harness · model · repo · duration` meta); streaming/failed/daemon-offline states recolor the line instead of emitting separate pills; task/GitHub chips move to a conditional linked-context row. (#350)
- **Quiet top bar** — brand mark, Home button, breadcrumb, and gear icon removed; ⌘K search is centered with bell + account button on the right. Sidebar carries identity and nav. (#350)
- **Thread declutter** — turn numbers, "You" labels, per-turn duration, and tool-count meta removed; the Tool activity disclosure summary and header meta carry those signals. Composer drops its model pill and gains a `↵ to send` placeholder hint. (#350, #351)
- **Cross-surface error/empty consistency** — Board, Inbox, Chat list, and Library load failures share one banner idiom (icon + message + Retry/dismiss); Library's empty doc list gains icon + title + hint. (#351)

### Fixed
- **Transcript debug-log leak** — upstream harness lines like `[model-fallback/decision] …` are stripped from assistant messages without touching line-leading markdown links. (#350)
- **Empty-state send hint** — the chat empty state advertised `⌘↵ to send` while plain Enter sends; it now reads `↵ to send · shift↵ for newline`. (#351)
- **Onboarding offline attribution** — with the daemon stopped, the binding step now says familiars load once the daemon starts instead of blaming the user's bindings. (#351)

## [0.0.62] — 2026-06-10

### Fixed
- **Packaged desktop terminal** — loopback sidecar app origins now receive the PTY command permissions needed by the main desktop webview, while Rust still rejects PTY calls from embedded browser child webviews at runtime.

## [0.0.61] — 2026-06-10

### Added
- **Open on phone handoff** — desktop Cave now has an "Open on phone" action that starts or reuses Tailscale Serve, creates a short-lived signed mobile invite, renders a QR code, and includes copy/refresh/reset controls.
- **Expiring mobile access tokens** — mobile access can now use signed HMAC invites with enforced expiry while preserving the existing per-run CLI token fallback.
- **Library graph + CSV import** — Library gains the Graphify knowledge graph viewer and CSV chat import flow, backed by a graph API contract test.
- **Board link workflows** — bookmarks can be added to Board, Board links can be saved back to Library, task creation is available from the command palette, and bookmark titles prefill the add-to-board modal.

### Changed
- **Tailscale mobile dev flow** — `pnpm mobile:tailscale` now prints a ready-to-open expiring invite URL instead of asking users to manually append the raw access token.
- **Inspector polish** — the inspector tab strip, empty states, and inbox cards have been tightened.
- **Mobile command center layouts** — Chat, Chat list, Chat detail, and Library now use phone-width layouts with bottom-tab-safe scrolling, stable headers/tabs, and full-width Library list behavior.

### Fixed
- **Tailscale API gate** — valid mobile access now satisfies the host/origin/referer checks while keeping loopback-bound development protected from LAN exposure.
- **Library mobile squeeze** — the desktop rail/preview/list layout no longer compresses into phone width; the section rail becomes horizontal and preview hides on mobile.

## [0.0.60] — 2026-06-09

### Added
- **Coven identity canon** — Cave now injects the binding court hierarchy into every familiar chat prompt before harness execution: Valentina is sovereign/source of the Coven and Mother of AGI; Nova is Queen/Orchestrator of the familiar layer; every Coven and Coven Cave familiar must preserve that hierarchy.
- **Salem court protocol** — Salem's preload context and quick replies now use the same shared canon, so the docs familiar can answer queen/court questions directly even before retrieval runs.

### Fixed
- Added a guard test so future Cave changes cannot silently remove the identity canon from the chat route or Salem context.

## [0.0.59] — 2026-06-09

### Added
- **Voice chat** — WebRTC realtime overlay using OpenAI Realtime API; `VoiceCallButton` in chat header, `VoiceCallOverlay` state machine, ephemeral token endpoint (`POST /api/voice/session`), transcript append (`POST /api/voice/transcript`), voice turns grouped under a call header, Familiar Studio Brain tab now exposes voice provider/model/voice settings
- **Home composer** — slash command autocomplete
- **Calendar** — TimeGrid parity, today indicator, AM/PM labels, `+ New event`, Agenda show-past toggle, date jumper
- **Inbox** — followup polish: state pill, resolved count, hover affordance, name truncation
- **Library** — `[` shortcut, Timeline rename, section-aware empty state, `localeCompare` crash fix, narrow-rail placeholder

### Changed
- **Sidebar** — duplicate "New Chat" ActionRow hidden on desktop; `kbd` hint contrast improved so ⌘1–8 shortcuts are legible
- **Chat header** — status/title confusion resolved; cleaner single-row layout
- **Notifications bell** — minimalist pass
- **Library reader** — header actions folded into the meta row; Lora font, airy padding
- **Board** — cards hard-scoped to the active familiar; CWD and Links columns dropped
- **Home** — destination-aware placeholder, visible Send label, keyboard hint

### Fixed
- Board table duplicate `HomeComposer` mount removed
- Unused `SessionsView` component and dedicated test deleted

---

## [0.0.58] — 2026-06-09

Accessibility sweep across the main interactive surfaces (kanban,
calendar, board, library, terminal mirror, glyph picker, avatar rail,
familiar studio, browser quick-open), two new themes to broaden the
default palette, and a couple of recovery fixes.

### Added

- **Two new default themes.** Hex (true red, hue 25°) — *"Bloodletter's
  brand. The mark that doesn't wash off."* — fills the red slot Bloom's
  rose-pink didn't cover; deeper base and ~3× higher background chroma
  than Bloom keep them visibly distinct. Bane (lime green, hue 125°) —
  *"Wolfsbane bloom. Bright; deeply unwise."* — fills the lime slot
  Grove's mossy 150° forest didn't cover. `THEME_IDS` count bumps
  from 8 → 10. (#295)
- **Keyboard drag on kanban cards.** Cards can be picked up, moved,
  and dropped without a pointer: Space to grab, arrow keys to move,
  Space or Esc to commit or cancel.
- **Calendar TimeGrid event roving.** Arrow-key navigation across
  event blocks in the calendar time grid, with Enter to open.
- **Board table vertical roving + Enter/Esc.** Arrow keys traverse
  the board cells; Enter opens, Esc dismisses.
- **Library reader heading navigation.** `j` / `k` and arrow keys
  walk between headings inside the reader pane.
- **XTerm screen-reader mirror.** The embedded terminal now exposes
  a parallel screen-reader-accessible mirror of its scrollback so
  AT users can read terminal output line by line.
- **Familiar studio tablist + vertical roving tabindex.** Keyboard
  traversal across the studio's tab strip and the vertical sections
  inside each tab.
- **Avatar rail vertical roving tabindex.** Up/down arrow navigation
  through the leftmost familiar avatar rail.
- **Glyph picker horizontal roving + scrollIntoView.** Left/right
  arrows through the glyph grid; selected glyph scrolls into view.
- **Browser quick-open listbox semantics.** Quick-open results are
  now a proper `role=listbox` so screen readers announce position
  and total.

### Fixed

- **Conversation history writes are validated.** Chat now guards
  against writing malformed history entries to the local conversation
  store, preventing corruption that previously surfaced as missing or
  reordered messages on reload.
- **Onboarding stays open after completion.** Setup no longer
  auto-dismisses the moment its final step succeeds — users see the
  confirmation state and close it themselves.

### Changed

- **CHANGELOG accuracy.** The v0.0.57 CHANGELOG entry was corrected
  to list the actual eight theme names (Coven, Tide, Grove, Ember,
  Bloom, Dusk, Mist, Slate) and to record PR #290's Ember-light
  contrast fix in the Fixed section. The shipped v0.0.57 tag and
  artifacts are unchanged; only the CHANGELOG file on main was
  updated. (#292)
- **Repo hygiene.** `.superpowers/` contents are no longer tracked —
  they're per-user agent specs and don't belong in the working tree
  on main. (#293)

## [0.0.57] — 2026-06-09

Theme personality, recovered local chats with familiar-scoped memory,
and a small PTY guard.

### Added

- **Expanded memory reader.** Memory inspector exposes a fuller
  per-file reader so longer entries stay legible inside the panel
  instead of clipping at the rail. (#287)

### Changed

- **Distinct theme personalities.** The eight default palettes
  (Coven, Tide, Grove, Ember, Bloom, Dusk, Mist, Slate) now carry
  their hue in the chrome — background chroma is pushed 2–4× and
  base lightness is staggered, so each theme reads as a different
  mood (lavender grimoire, moontide blue, hexenwald moss, brazier
  parchment, bewitching rose, witching-hour magenta, scrying-pool
  teal, ink-and-bone) instead of the previous flat dark/light gray
  with only a tinted accent button. (#285)

### Fixed

- **Local chat recovery + familiar-scoped memory.** Chats stored in
  the Cave-local conversation store are now recovered into the
  session list when the daemon is offline, and the familiar memory
  view is scoped to the active familiar so other familiars' files no
  longer bleed into the surface. (#287)
- **Ember light contrast.** Pulls Ember light background chroma back
  and darkens the burnt-orange accent so body text reads cleanly on
  the parchment surface; foreground and muted-foreground lightness
  tightened to match. Ember dark untouched. (#290)
- **PTY zero-size guard.** Clamps PTY dimensions to a safe minimum
  when the host terminal pane reports a zero-pixel area, preventing
  the desktop from crashing when chat or terminal panes are collapsed
  to nothing.

## [0.0.56] — 2026-06-09

Cross-surface polish, memory provenance + a11y groundwork, and a
standardized release-notes pipeline. No public-API breaks.

### Added

- **Memory file source metadata.** `/api/memory` now exposes per-file
  `source` and `context` provenance so the inspector and the 3D graph
  can surface where a memory entry originated. (#278)
- **API contract test suite.** Sanity-checks the surface area of the
  workspace-driving routes so future refactors can't silently break
  callers. (#277)
- **Accessibility quickwins.** Focus rings, ARIA labels, and keyboard
  traversal repaired across the agents, inspector, capabilities, and
  command-palette surfaces. (#280)

### Fixed

- **Inspector pane surface.** Inspector now matches the compact rail
  surface tokens instead of drifting on its own palette. (#273)
- **Familiar memory file reads.** The packaged sidecar can now read the
  per-familiar memory tree it was previously refusing. (#274)
- **Agents hover caret + memory tab scroll.** Roster card name + the
  agents-detail memory tab no longer show a hover caret, and the memory
  tab scrolls within its detail panel instead of pushing siblings
  off-screen. (#275, #276)
- **Salem surface tokens.** Salem perch and chat panel inherit shared
  Cave tokens (`--bg-panel`, `--accent-presence`, `--text-*`) instead of
  hardcoded purple literals — theme tuning now reaches the rail and
  perch consistently. (#279)
- **Settings reported app version.** About / settings now reports the
  version embedded in the bundle metadata instead of a stale literal.
- **Chat header context row.** Chat keeps its context row inside the
  header instead of letting it reflow below on tighter viewports.

### Changed

- **Standardized release notes.** New `scripts/release-notes.sh` renders
  a consistent GitHub Release body (CHANGELOG section + arch-aware
  install block + checksum verify snippet + compare link), wired into
  `release.yml`'s checksums job. Backfilled all 24 historically-empty
  release pages (`v0.0.23`–`v0.0.55`) with the standardized template.
  (#282)

## [0.0.55] — 2026-06-08

Release repair for the packaged macOS sidecar after 0.0.54.

### Fixed

- **Loopback-tolerant referer check.** The sidecar's CSRF guard now treats
  `127.0.0.1`, `localhost`, and `[::1]` as the same origin when scheme and
  port match. Tauri's WKWebView on macOS sends a referer whose loopback
  hostname can differ from the one the sidecar bound to (e.g. webview
  loaded at `http://127.0.0.1:<port>/`, request comes in with
  `Referer: http://localhost:<port>/…`), which made every `/api/…` call
  fail with `forbidden referer` once the sidecar successfully booted on
  Apple Silicon. The loopback host gate and token check still run first,
  so the relaxation only widens what counts as "same origin" inside the
  already-loopback envelope.

## [0.0.54] — 2026-06-08

Release repair for macOS sidecar startup after 0.0.53.

### Fixed

- **Signed macOS sidecar Node startup.** Re-signs the bundled Node runtime with
  the hardened-runtime executable-memory entitlements V8 needs, so the packaged
  sidecar can bind its local port instead of crashing before producing server
  output. Thanks @BunsDev
- **Native Apple Silicon DMG.** Adds an `macos-15` (aarch64) leg to the release
  matrix alongside the existing `macos-15-intel` (x86_64) leg and tags each
  produced DMG with its arch suffix (`-x86_64.dmg`, `-aarch64.dmg`). M-series
  Macs no longer run the bundled Node through Rosetta, where V8 baseline-JIT
  tier-up could crash the sidecar before it bound its port.

## [0.0.53] — 2026-06-08

Release repair for clean CI packaging after 0.0.52.

### Fixed

- **Clean release resource staging.** Tracks minimal placeholder files for the
  generated server and bundled Node resource trees so Tauri validates resource
  globs on clean Linux and Windows release runners before the sidecar bundler
  replaces them with real packaged contents.

## [0.0.52] — 2026-06-08

Release repair for 0.0.51.

### Fixed

- **Packaged sidecar startup.** Bundles the Node runtime into release artifacts
  and generates the standalone Next.js sidecar immediately before Tauri
  packaging, so fresh installs no longer depend on a user-installed Node binary
  or ship placeholder-only sidecar resources.
- **Packaged workspace/daemon status.** Stops overriding Cave's Coven workspace
  with the OpenClaw workspace in packaged mode, and prefers the npm-installed
  `coven` CLI over stale Rust-installed binaries when resolving daemon helpers.

## [0.0.51] — 2026-06-08

Small stopping-point release for the CovenCave polish wave after 0.0.50.

### Added

- **Salem docs familiar.** Adds Salem as a bottom-right 3D black-cat docs
  familiar with a quiet perch, expandable docs chat, preloaded docs/tool/skill
  context, Cave route awareness, and he/him Sabrina-style sassy persona
  guardrails.
- **Collapsed transcript internals.** Thinking and tool activity now stay
  collapsed by default, including individual tool input/output payloads, so
  the assistant reply remains the first thing users read.

### Changed

- **Linear chat polish.** Chat layout now runs full width with denser turn
  numbering, cleaner metadata, themed ThinkingIndicator colors, send-button
  hover repair, and stronger focus rings.
- **Dark Cave visibility.** Lifts the default dark background slightly and
  tunes Salem's material/rim light so his black-cat silhouette remains visible
  without turning into a glow blob.

### Fixed

- **UI contrast and focus pass.** Repairs focus rings, hover states, and
  eyebrow/label contrast across Settings, Familiar Studio, Plugins,
  Onboarding, Calendar, Capabilities, and chat surfaces.
- **Salem chat surface.** Removes emoji glyphs from the open chat panel while
  keeping the 3D Salem presence in the perch and header.

## [0.0.50] — 2026-06-08

Agents page, light/dark themes, full UI polish pass, memory constellation
with per-familiar file coverage, reader improvements, chat surface controls
cleanup, and a handful of chat rendering fixes.

### Added

- **Agents page.** New default landing surface with a roster grid of all
  familiars, in-place drill-in with Memory / Files / Sessions tabs, and a
  "Memory across all agents" overlay. Sidebar gains an Agents folder;
  ⌘1–⌘8 shortcuts shift accordingly.
- **Light / dark mode + 8 themes.** Full `prefers-color-scheme` aware
  theme system with curated Midnight, Dusk, Slate, Moss, Sky, Dawn, Latte,
  and Storm presets. All hardcoded `rgba(255,…)` color literals replaced
  with `var(--text-*)` / `var(--bg-*)` / `var(--border-*)` tokens.
- **Memory constellation — per-familiar file coverage.** `/api/memory`
  now scans `~/.openclaw/workspace/<familiarId>/memory/` for every agent
  and tags each entry with `familiarId`. The 3-D graph model renders them
  as a files sub-hub connected to each familiar's hub node (~1 200 entries
  across all familiars vs 1 before).
- **Research Library reader polish.** Lora font imported, modal widened
  from 780 → 820 px, airy header and body padding, Lora prose at 16 px /
  1.85 line-height.
- **Cave marketplace (tier 0).** Preserve tier-0 marketplace surface.
- **Familiar Studio drawer.** Per-familiar Cave-local customization with four
  tabs: Identity (display name, role, pronouns, description), Look (glyph
  picker, accent color, uploaded image avatar), Brain (harness / model / note
  via `PATCH /api/config`), and Lifecycle (archive, reset, list view).
- **FamiliarAvatar.** Unified avatar component that picks between an
  uploaded image, a Cave-local glyph override, the daemon-supplied icon, a
  role-inferred glyph, or `ph:sparkle-fill`. Replaces direct `<FamiliarGlyph>`
  usage at 13 consumer sites.
- **Cave-local stores.** `cave-familiar-overrides`, `cave-familiar-images`,
  `cave-familiar-archive`, and `familiar-resolve` provide layered resolution
  of daemon + cave state, all persisted in localStorage with
  `useSyncExternalStore` re-renders and cross-tab `storage` events.
- **Rail polish.** Per-familiar accent ring, hover edit affordance,
  right-click → Studio, drag-to-reorder via the existing order store.
- **Settings · Familiars panel** now surfaces an Edit button that opens
  Studio for the selected familiar.

### Changed

- **Chat surface controls.** Session toggle renamed Open/Closed → Active/Done
  with status icons; group-by option renamed None → Flat; rows icon prefixed
  to the group-by segment for visual context.
- **Chat workbench.** `cave-chat-workbench`, `cave-chat-workbench-header`,
  `cave-chat-thread`, `cave-chat-empty` CSS classes replace inline style
  attributes. ToolGroup summary label changed "Tool use" → "Tool activity".
- **UI polish sweep.** Sidebar, header, banner, rail, board, inbox, and
  library all received focus-ring corrections, light-mode theming, and
  contrast improvements.
- **Library timeline.** Stable `timelineEntryKey()` prevents `key=undefined`
  React warnings on legacy entries missing `.id`.
- **Session list controls.** Session filter tab and group-by toggle visual
  improvements; `.gitignore` updated to exclude `.playwright-cli/` dumps.
- **`callDaemon`** normalizes socket errors. ENOENT/ECONNREFUSED →
  `"daemon offline"`, EACCES/EPERM → `"socket exists but not readable"`,
  timeouts → `"daemon timeout"`. Other errors have absolute paths redacted
  so the UI never leaks `/Users/<name>/.coven/...` in offline polls.
- **`callDaemon`** now rejects a non-empty body that fails `JSON.parse` with
  `{ok: false, error: "malformed response"}` instead of silently returning
  `data: null`. Daemon misbehavior is observable to callers again.
- **`socketPath()`** is now evaluated per call. Mid-session `COVEN_SOCKET`
  env changes take effect without an app restart.
- **`familiar-glyph` precedence** gains a role-keyword inference step
  (`code`, `chat`, `music`, `research`, `art`, `data`, `ops`, `writer`,
  `designer`) between the daemon emoji and the default `ph:sparkle-fill`.
  Matched via word-boundary regex so "Chart analyst" doesn't accidentally
  pick the art-palette glyph.
- **Inbox & Board** demo-mode seeding now only fires when the API returned
  `ok: true` with an empty list. Real API failures render the error and
  empty state instead of being silently masked by `DEMO_*` fixtures.
- **Phone-class viewport (<768px)** collapses the shell to a single
  pane. Avatar rail becomes a horizontal top strip with overflow
  scroll, sidebar nav / list / companion rail hide (⌘B / ⌘\\ / ⌘J
  still flip the React state for keyboard recall), detail panel
  takes the full width, Studio drawer height switches to 100dvh so
  the iOS keyboard doesn't clip its tabs.

### Fixed

- **Chat markdown rendering.** Re-attached `lang:filename` label, corrected
  multi-block render, stripped lang suffix before parse, surfaced render
  errors with aligned HTML escape.
- **Chat history.** Preserved history and context across session transitions.
- **Superpowers skill bodies.** Hidden leaked skill body content from chat;
  plugin row padding deduplicated.
- **Title enricher.** Stopped arbitrary server-side URL fetches that could
  leak internal paths.
- **Agents memory routes.** Wired memory routes correctly to the Agents
  surface.
- **CSRF gate ordering.** `src/proxy.ts` previously short-circuited to
  `NextResponse.next()` the moment `COVEN_CAVE_AUTH_TOKEN` was unset
  (the typical `pnpm dev` state). That early return ran *before* the
  loopback / same-origin / referer / content-type checks, so anything
  reachable on the dev server's port could call workspace-driving routes
  unauthenticated. Reordered so the CSRF guards always apply to `/api/`
  requests; only the token equality check is skippable in browser-dev
  mode. Pinned by an ordering assertion in `middleware.test.ts`.
- **Onboarding silent failure.** `/api/onboarding/status` poll failures
  used to be caught and discarded — six step cards stayed on
  "checking…" forever for a fresh user without the `coven` CLI. After
  three consecutive failures the overlay now renders a `role="alert"`
  banner with a Retry button while the step cards remain visible.
- **Familiar glyph input.** The first-run "Glyph" field accepted any
  free text, so typing "robot" wrote an unrenderable value into
  `familiars.toml`. Now validates `ph:`-prefix inline with red border,
  `aria-invalid`, and a hint to phosphoricons.com; both create buttons
  refuse to submit until the value is valid.
- **Library load failures.** `LibraryView` swallowed every error in the
  docs fetch path, so empty / API-errored / network-blip all rendered
  identical "No documents found." `LibraryDocList` now exposes
  `error` + `onRetry` props and renders a `role="alert"` block with a
  retry affordance when the load fails.
- **Board empty state.** A board with zero cards used to show empty
  kanban columns with no CTA — the "+ New task" button at the top was
  the only hint. Added a centered "Queue your first task" hero that
  appears only while `cards.length === 0 && !error`.
- **Memory empty copy.** When `/api/coven-memory` failed,
  `AgentsMemoryView` showed the error in a header banner but the body
  empty-states still read "No memories match this view," contradicting
  the warning. Body copy now mirrors the error state.

### Removed

- **Dead code.** `src/lib/mobile-access-token.ts` and its test referenced
  `COVEN_MOBILE_ACCESS_TOKEN` and helpers that nothing imported — the
  actual mobile gate in `src/proxy.ts` uses `COVEN_CAVE_ACCESS_TOKEN`
  and re-implements its helpers inline. Both files deleted.
- **Stale tests.** Five tests that asserted behaviors removed by the
  shell IA redesign (group-by-Familiar dropdown, "Chats as separate
  top-level destination", old sidebar IDs, glyph imports in the
  text-only switcher) were repaired or deleted in `5be5e6b` so the
  baseline is green again.

### Security

- **Loopback / same-origin / referer / content-type** checks now run for
  every `/api/*` request, including when no sidecar auth token is
  configured. Plain `pnpm dev` browser tabs still work (they naturally
  satisfy every guard); LAN-reachable callers and cross-origin requests
  are blocked even in dev mode. See the *Fixed → CSRF gate ordering*
  entry above.

### Internal

- **Cargo version sync.** `src-tauri/Cargo.toml` shipped `0.1.0` while
  `package.json` and `tauri.conf.json` were `0.0.49`. Bumped Cargo (and
  the matching `Cargo.lock` entry for the `app` crate) so the native
  binary's version metadata matches the user-visible build version.
- **Screenshots refreshed** against the new shell IA + Familiar Studio
  via `node scripts/capture-screenshots.mjs`. The capture script also
  picked up the Chat / Board renames and a more robust sidebar selector
  (matches the visible label rather than the full `Board ⌘3` accessible
  name). 3D canvas non-blank verification (`scripts/verify-trace-graph-3d.mjs`)
  passed for desktop and mobile viewports.
- **`scripts/release.sh` writes `release/SHA256SUMS`** automatically
  after each successful build, replacing any prior entry for the
  same artifact in place. README's "Release standard" promise is now
  enforced by the script rather than the operator's memory.
- **`Copy diagnostics`** payload extended with `capturedAt`,
  `statusFailures`, `setupError`, and `agentsError` so support traces
  can answer "daemon unreachable vs setup itself failed?" without a
  follow-up round trip.
- **Proxy helpers extracted** into `src/proxy-helpers.ts` so the
  CSRF / loopback / same-origin / bearer-token / timing-safe-compare
  primitives can be unit-tested directly (`proxy-behavior.test.ts`)
  without paying the `next/server` ESM resolution cost. Pure
  refactor; proxy.ts re-exports the helpers and middleware behavior
  is unchanged.
- **README + docs/mobile-tailscale.md** brought in line with the new
  IA (avatar rail, Familiar Studio, Chat/Board renames) and the
  always-on CSRF guards. Keybinds table expanded for the new
  surface / familiar / chat shortcuts; screenshots section
  references all eight current PNGs.

### Known limitations

- The currently published GitHub Release is still v0.0.48; the next
  tag push will trigger `.github/workflows/release.yml` to build all
  three OS artifacts and publish a `SHA256SUMS` asset alongside them.
  The script + workflow plumbing for that is done; the actual rebuild
  needs a tag push by someone with repo-secret access for the Apple
  signing/notarization credentials.

### Pre-existing artifact checksum

For verifiability while v0.0.49 is in flight, the SHA-256 of the
currently shipped macOS DMG (`CovenCave-v0.0.48.dmg`) is:

```
70bea2f0f0f81a655f356bf4502c19c573449393d1d8653c58be677a6f2f568a  CovenCave-v0.0.48.dmg
```

Verify with `shasum -a 256 -c` against a one-line file containing that
entry. Future releases will ship this aggregated in `SHA256SUMS` via
the workflow.

---

Earlier releases are tracked only by tag on
[GitHub Releases](https://github.com/OpenCoven/coven-cave/releases).
This file starts at the Familiar Studio cut.
