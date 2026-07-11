# Changelog

All notable changes to CovenCave land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). CovenCave uses
[SemVer](https://semver.org/) while still in 0.x — minor releases may carry
breaking config changes; patch releases stay additive.

## [Unreleased]

### Features
- **Quick chat: drag-and-drop/paste attachments, message queueing, and companion composer upgrades** — the tray/overlay composer stages files via drag-and-drop or paste as chips (attachment-only sends allowed, bridge composes natively), send-while-streaming queues the message and drains it in order on a natural done (Stop/error keeps it parked), plus slash-dispatch send path, project-root picker plumbing, Tab-accept reply recommendations, and Enhance sparkle/caret segments that stay inside their rectangle on mobile (#2937).

## [0.0.174] - 2026-07-11

> 💬 **Copilot chats natively, cleaner Windows packaging, and the Grimoire becomes Memories.** Copilot (and other manifest adapters) now render their replies correctly in chat, the packaged Windows sidecar runtime is pruned and MSI publication is gated, and the knowledge surface is renamed Memories.

Rolls up on top of v0.0.172 — this release also carries the v0.0.173-stamped work below (board/palette project-scoping, chat/board polish, rollout-audit hardening, and the MSI sidecar collapse), which was stamped but never cut as its own release. **Windows note:** the v0.0.172 → v0.0.174 upgrade is the one-time legacy bridge that removes v0.0.172's expanded sidecar tree; archive-to-archive upgrades after this are the fast path.

### Features
- **Analytics: thread signals become a scrollable, task-promoting data table** spanning both columns (#2920, cave-bhh2).

### Fixes
- **Chat: Copilot (and other manifest adapters) render replies natively** — external adapters pipe raw CLI stdout without codex/claude output shapes, so the assistant filter was eating whole replies; they now pass through verbatim (with CRLF/backspace handling). Plus the code rail fills wide panels and the sidenav "Grimoire" is renamed **Memories** (#2927, cave-ns35).
- **Projects: drop stale scope on refetch; gate the palette project fetch until open** — prevents a mid-refetch pick from reaching a project the new familiar can't access (board chat-launch 403) (#2918).
- **Board: Tasks|Queue segment tabs standardized to the group-toggle footprint** (#2921).

### Windows runtime
- **Prune the packaged sidecar runtime closure** — traced dep closure instead of the whole tree, with file/size budgets (#2922, by @romgenie).
- **Gate MSI publication + upgrade diagnostics** — an MSI can't publish before its budget passes (#2923, by @romgenie).

### Internal
- **Runtimes: one label authority** — consolidated runtime label resolution, alias + merge-label fixes (#2919).


## [0.0.173] - 2026-07-10

> Board & palette project-scoping correctness, chat/board polish, and rollout-audit hardening.

Patch release on top of v0.0.172.

> **Windows upgrade note:** v0.0.172 → v0.0.173 is the one-time legacy bridge. Windows Installer must still remove v0.0.172's expanded sidecar tree; archive-to-archive upgrades after v0.0.173 are the representative fast path.

### Changes
- fix(windows): collapse the MSI sidecar payload into one verified runtime archive, reducing per-file upgrade work (#2911)
- fix(projects): drop stale scope on refetch; gate palette project fetch on open (#2908)
- docs: iOS onboarding + constant connection + cloud persistence — review & plan (cave-rku9) (#2909)
- fix(rollout): five P3s from the evening re-audit (#2907)
- feat(cave): chat/board polish batch — palette, pickers, header row, review fixes (#2906)
- fix(rollout): three P2s from the evening re-audit (#2904)


## [0.0.172] - 2026-07-10

> Analytics & daily-report polish, marketplace Crafts and Grimoire Stitches, plus cross-platform production hardening.

Patch release on top of v0.0.171.

### Changes
- fix(prod): short-circuit the POSIX login-shell PATH probe on Windows (#2902)
- fix(stitches): review hardening — connect-time SSRF guard, sandboxed sew, fence-safe output parse (cave-746p) (#2900)
- chore: delete retired ComuxView + FlowView sources; settle rail PTY lifecycle (cave-c3yt) (#2901)
- fix(prod): cross-platform path bug, silent quick-add failure, app error boundaries (#2899)
- feat(marketplace): add audited research Crafts (#2898)
- style(daily-report): full-bleed stats row + ultra-minimal Apple-style cards (#2896)
- fix(marketplace): preserve Craft dialog focus fallback (#2895)
- fix(board): reconcile bulk patch failures once, after the batch settles (cave-381s) (#2897)
- fix(rollout): seven P3 papercuts and dead-ends from the 100k-ft audit (#2894)
- feat(marketplace): equip Roles with Crafts (#2893)
- feat(grimoire): Stitches — KB intake via pins & threads, sewn agentically or by hand (cave-v7zs) (#2891)
- style(chrome): frost the opaque floating overlay chrome (cave-il65) (#2890)
- fix(inspector): open memory files via the server-resolved path, not a hardcoded dev home (#2889)
- fix(rollout): eight P2 dead-ends and papercuts from the 100k-ft audit (#2888)
- fix(marketplace): preserve Craft transaction diagnostics (#2887)
- feat(marketplace): verify Craft installs with Codex (#2886)
- fix(shell): keep headers adaptive across screen sizes (#2885)
- fix(rollout): six P1 UX dead-ends from the 100k-ft audit (#2884)
- feat(analytics): weight-honest confidence breakdown + clearly-labeled metrics (#2883)
- feat(chat): closed right panel leaves a rail — the reflection of the left sidebar (cave-zn19) (#2879)
- feat(marketplace): add Craft schema and Seeker's Lens (#2881)
- feat(analytics): give the standalone analytics route the left sidepanel (#2882)
- feat(analytics): thread signals span both columns with a scrollable, task-promoting data table (cave-bhh2) (#2880)
- refactor(runtimes): one label authority, alias + merge-label fixes, hoisted rank map (#2878)
- fix(chat): right sidebar mirrors the left panel's glass — flush fit, no far-right gap, whole tab labels (cave-wc78) (#2877)


## [0.0.171] - 2026-07-09

> 🧹 **Tidier familiars, leaner chat header** — removing a familiar is now undo-safe (a distinct track from Archive), and the chat header slims to Find + a kebab with compact project selection.

Patch release on top of v0.0.170.

### Features
- **Familiars: undo-safe Remove beside Archive** (#2873, cave-ykwk) — a dual-track lifecycle so Remove and Archive are distinct, and Remove can be undone.

### Improvements
- **Chat: the header slims to Find + a kebab menu** with compact project selection (#2874).


## [0.0.170] - 2026-07-09

> 🧑‍🤝‍🧑 **Asana, assignable per familiar** — connect Asana once, then decide per agent whether (and in which workspace) it works with your tasks, right in Familiar Studio → Brain. The board and Queue show each agent only their scoped tasks.

Patch release on top of v0.0.169.

### Features
- **Asana: seamless connect + per-agent assignment** (#2871, cave-vn19). One app-wide connection, then a per-familiar "Work with Asana tasks" toggle + optional workspace scope in the Brain tab. `/api/asana/assigned` honors each agent's assignment; the board inspector scopes to the card's familiar and the Queue strip to the active one (hidden for opted-out agents).

### Improvements
- **Asana: the Queue strip refreshes on the 30s poll** (#2870, cave-m4h9) with an equality guard against re-render churn.


## [0.0.169] - 2026-07-09

> Mobile Cave reconnects cleanly over Tailscale when a stale dev server is in the way, Queue gains Asana-linked task context, and runtime sync gets its second review hardening pass.

Patch release on top of v0.0.168.

### Changes
- fix(runtimes): second review pass — build-metadata precedence, un-persisted checkout token (#2868)
- feat(asana): integrate Asana tasks into the board, beads, and Queue (#2865)
- fix(mobile): recover stale Cave app server (#2867)


## [0.0.168] - 2026-07-09

> In-app updates work again on macOS — the updater tarball no longer breaks the app's code seal — plus a comprehensive title-bar fit and subtle titlebar glass.

Patch release on top of v0.0.167.

### Changes
- fix(release): updater tarball ships no AppleDouble entries — kills the macOS 'app is damaged' update error (cave-csl8) (#2864)
- fix(shell): comprehensive title-bar fit + subtle titlebar glass (cave-y894) (#2862)
- feat(cave): analytics model-performance votes, settings polish, composer/home refinements (#2860)


## [0.0.167] - 2026-07-09

> 🪄 **Polish + hardening pass** — the marketplace's prompt-pack "Try it" becomes an unmissable bordered pill with a hand-off arrow instead of near-invisible ghost text, and the desktop title-bar controls stop hiding under the macOS traffic lights. Under the hood: a ReDoS-prone path regex is replaced with a plain `trimEnd`, and the runtime-sync tooling gets spec-correct prerelease semver plus CI-triggering bot PRs.

Patch release on top of v0.0.166.

### Improvements
- **Marketplace: "Try it" is finally visible** (#2857) — the prompt-pack hand-off is now a bordered secondary pill with an arrow instead of ghost text that blended into the card.
- **Shell: title-bar controls never sit under the traffic lights** (#2856, cave-i7wf) — window controls reflow clear of the macOS traffic-light cluster.

### Fixes
- **Security: no more ReDoS-prone path regex** (#2845, CodeQL #99) — `next-paths.ts` uses `trimEnd` instead of a catastrophically-backtracking regex.
- **Runtimes: review follow-ups** (#2858) — spec-correct prerelease semver handling and CI-triggering bot PRs in the runtime-sync workflow.
- **Runtimes: drop a no-op identity newline replacement** in `sync-runtimes.mjs` (#2844).


## [0.0.166] - 2026-07-09

> 📓 **Journal moves into the Grimoire** — daily reflections are now a tab beside Docs and Graph, so the whole knowledge surface lives in one room. Plus registry-driven runtime adapter scaffolds and an analytics contract-compliance pass.

Patch release on top of v0.0.165.

### Features
- **Grimoire: Journal is now a tab** (#2854). The Docs/Graph switcher grows a third tab — Docs · Journal · Graph — rendering the full daily-reflection surface (day rail, generate, edit/delete with undo) in place. The Journal nav item opens it directly instead of routing to Settings; per-familiar journals still live in Settings → Familiars → Journal.

### Improvements
- **Runtimes: adapter scaffolds come straight from the registry** (#2853, cave-laxg).
- **Analytics: contract compliance shown beside confidence, with one-click enable for self-reporting** (#2852, cave-ydv5).


## [0.0.165] - 2026-07-09

> 🏛️ **Rooms for every vocation** — the Cave becomes role-aware: a registry-driven Role Surface system gives Familiars specialized workspaces (a Research Desk, a Comms operations center, an Archive) instead of generic tabs. Plus the Coven adopts its canonical typography, an "ultimate Enhance" streaming rewrite across every composer, and a full prompt-template + marketplace-pack workflow.

A feature release on top of v0.0.164.

### Features
- **Role Surface system — registry-driven rooms for Familiar vocations** (#2849, cave-htyp). A role-aware Cave with no role-specific branching in the shell: register a surface and it becomes a first-class room. Ships three — Research Desk (researcher), Comms Operations (messenger), The Archive (indexer) — with per-Familiar × per-surface state. See `docs/role-surfaces.md`.
- **Typography: adopt the Coven canon** — EB Garamond display, Inter body, JetBrains Mono (#2850).
- **Composer: ultimate Enhance** — model-backed streaming rewrite, race-safe, with an intent menu, across all three composers (#2842, cave-b6c2).
- **Prompts: template power** — placeholder Tab flow, favorites/recents/tags, save/edit/delete (#2847, cave-jg6k).
- **Marketplace: browsable prompt packs** — real previews, one-click Try it, prompt-pack shipping + docs (#2848, cave-1f9h).
- **Runtimes: sync accepted runtimes from the coven-runtimes registry** (#2841) — one command (or an automated PR) brings a newly-accepted runtime into Cave.
- **Chat: project group headers gain an activity meta line + explicit project colors** (#2846).
- **Cron: a prompt bar + analytics UX polish**, alongside a static Coven font preview (#2843).


## [0.0.164] - 2026-07-09

> 🚦 **Chrome that knows when to leave** — the macOS traffic lights hide with the side panel and glide back when it opens, Dia-style. iOS gets real split layouts on wide windows and a decluttered chat header, cron details fit every screen, and releases now stamp themselves with one command.

Patch release on top of v0.0.163.

### Features
- **Shell: traffic lights follow the side panel, Dia-style** (#2837, cave-9ja2). Closed panel → the native buttons hide and the title bar reclaims their inset; open or hover-peek → they glide back.
- **iOS: wide windows engage the split layouts** — no more sparse full-width columns (#2838, cave-bgmg).
- **Marketplace: skills-leaderboard detail** — click-to-copy CLI, minimalist stats, tidy actions (#2834).
- **Release tooling: one-command stamp script + partial updater-manifest resilience** (#2833, cave-ef6f).

### Fixes
- **Crons: cron detail fits every screen** — balanced expanded columns, adaptive list rows, honest mobile chrome (#2839).
- **Grimoire: editor batch** — dirty-tab dot + close confirm, next-paths stripped from journal (#2836, cave-vv2h/cave-onp8).
- **iOS: chat header sheds the Commands and Share toolbar buttons** (#2835, cave-yey7).
- **Release tooling: stamp script survives the gitignored-but-tracked generated iOS plist** (`git add -f`; found on this stamp's first real run).


## [0.0.163] - 2026-07-09

> 📱 **Hand off THIS chat to your phone** — the QR pairing carries the current conversation across and finally confirms it took. The Work Queue rides the Tasks page as a tab, the familiar switcher reads as a clean dropdown with a prominent Summon button, multi-file turns collapse into one "Review all" entry, and the chat header slims down for narrow panels. Plus a readable transcript over custom backdrops, mid-save file-switch no longer bleeds content, and Grimoire graph nodes are keyboard-traversable.

Patch release on top of v0.0.162.

### Features
- **Mobile: Continue on phone hands off the current chat** (#2827, cave-i74f). The QR code carries THIS conversation to the phone, and pairing now reports success instead of leaving you guessing.
- **Tasks: the Work Queue rides the Tasks page as a tab** (#2830, cave-oa1z) — queue and task views live together instead of split across surfaces.
- **Familiars: the switcher reads as a clean dropdown with a prominent Summon button** (#2825, cave-6p5l).
- **Chat: multi-file turns get one "Review all" entry into the Changes tab** (#2823, cave-qva4) instead of a row per file.
- **Chat: slim header + narrow-panel-aware sidebar rows** (#2831, cave-bmv0) — the header trims down and sidebar rows adapt when the panel is narrow.
- **Inbox: toast vibe pass** (#2828, cave-18nk) — glass surface, kind-tinted chip, and pill actions.

### Fixes
- **Chat: readable transcript over a custom backdrop** (#2829, cave-5oeu) — a frosted reading column plus quiet-text lift keeps the transcript legible over any wallpaper.
- **Grimoire: shell/nav batch** (#2820, cave-quct, cave-eg6f, cave-v1j0) — the graph reaches mobile layouts, the rail supports keyboard nav, and memory groups by source root.
- **Grimoire: quick wins** (#2822) — preference-aware journal dates, eviction announce, an editor skeleton, tappable chips, and search screen-reader counts.
- **Code: mid-save file switch no longer paints the saved file's content over the file you moved to** (#2824, cave-uv0t).

### Accessibility
- **Grimoire: keyboard traversal for graph nodes** (#2821, cave-2cx8) — Tab cycles nodes, Enter opens.

## [0.0.162] - 2026-07-09

> 🖼️ **Your wallpapers, straight from the camera roll** — the backdrop picker now takes HEIC photos directly, no conversion detour. Plus the side-panel footer stays put on chat pages, familiar switching can't flash another familiar's sessions, Grimoire's graph reaches narrow screens, and daily narratives drop their stowaway next-paths block.

Patch release on top of v0.0.161.

### Fixes
- **Backdrop: HEIC/HEIF wallpapers work in the picker** (#2815, cave-cjpb). The desktop app decodes iPhone photos natively; where a plain browser can't, the error now says what to do instead of a generic failure.
- **Shell: the side-panel footer (Dashboard + Settings) stays on chat pages** (#2811).
- **Workspace: switching familiars can't briefly show the previous familiar's sessions** (#2812, cave-jibj) — session loads are sequence-guarded.
- **Daily report: narratives no longer carry a piggybacked next-paths block** (#2813).
- **Grimoire: Graph mode is reachable on narrow/mobile layouts** (#2814, cave-quct).

## [0.0.161] - 2026-07-09

> 📱 **Threads that stay yours** — the iOS app stops flooding its Threads list with journal-generated runs, matching the web. The task loop closes on the board with live status chips and one-click Mark done, harness failures grow inline fix actions, and Claude Fable 5 joins the Copilot model menu.

Patch release on top of v0.0.160.

### Fixes
- **iOS: journal/generated runs stay out of familiar thread lists** (#2806, cave-48aa). The Swift session model now carries `origin`/`generated` and filters with the same rule as the web (#2798) — generated flag, hidden origins including `journal`, and the legacy truncated-title fallback.
- **Settings: typography controls pin to one standard 28px height** (#2809).

### Features
- **Board + chat: the task loop closes** — live session status on card chips and one-click Mark done from a settled chat (#2805, cave-32ks).
- **Chat + board: inline fix actions for harness/runtime failures** (#2807, cave-noox).
- **Models: Claude Fable 5 joins the Copilot model menu** (#2808, cave-ufvy).

## [0.0.160] - 2026-07-08

> 📖 **Responses worth reading** — the chat's Expand view becomes a real reading surface, tables read as rows instead of spreadsheets, inline code stops shouting, and mermaid diagrams finally wear the theme — on a drawing canvas, inline and fullscreen. Plus a backdrop vibe for Home + Chat and journal-run chats that tidy themselves away.

Feature release on top of v0.0.159.

### Features
- **Chat: modern reading polish** (#2801, cave-po4f). The Expand reader gets a centered 72ch book measure on a larger reading scale; inline code chips go quiet-neutral; tables move to row separators with sticky headers, zebra + hover tints, and a roomier expanded lightbox; mermaid diagrams render token-native across all 19 themes on a dot-grid drawing canvas, with a glassy zoom/pan toolbar fullscreen; user bubbles and thinking blocks soften.
- **Appearance: backdrop vibe** — an image behind Home + Chat with the accent derived from it (#2799, cave-bq7s).
- **Calendar: the agenda is a scannable timeline** (#2803, cave-cal-agenda) — date badges with sticky day headers, a connecting spine, relative cues ("in 2h", "now"), and cron cadence chips; today wears the presence accent.
- **Onboarding: first-run golden path** (#2802, cave-fy1q) — daemon auto-start, summoning-circle draft survival, and a time-to-first-reply funnel.

### Fixes
- **Chat: journal-run chats auto-hide** — `origin:journal` provenance with a truncated-title legacy fallback (#2798, cave-buih).
- **Journal: delete announces once** — UndoToast already speaks it (#2800, cave-6rhk).

## [0.0.159] - 2026-07-08

> 🪟 **Frosted glass and a Copilot in the cave** — overlay chrome goes translucent with real backdrop depth, GitHub Copilot CLI joins as a first-class runtime, the Changes panel reviews your diff in one click, and mornings start with a "Needs you" triage strip.

Patch release on top of v0.0.158.

### Features
- **Harness: GitHub Copilot CLI is a first-class runtime** (#2791) — bundled `copilot` adapter with install hints and aliases, a `github/`-provider model menu (Auto, GPT-5.5, Claude Opus 4.8 / Sonnet 5 / Haiku 4.5, Gemini 3.1 Pro), onboarding, logos, and analytics awareness.
- **Chrome: glassmorphic overlays** (#2790, cave-6u0j) — popovers, modals, the ⌘K palette, and the notification bell pair translucent theme-derived fills with backdrop blur, with opaque fallbacks for `prefers-reduced-transparency` and no-`backdrop-filter` environments.
- **Code: a Review button in the Changes panel** (#2785, cave-nqoy) starts a new session that reviews the uncommitted working-tree changes like a commit review — verdict first, then bugs, security, test gaps, nits.
- **Home: a "Needs you" morning-triage strip** (#2793, cave-925w) — one glance, one source, with today's report a click away.
- **Projects: hub round 2** (#2789, cave-dn9w) — task deep-links, Reveal in Finder, and the color row demoted to the overflow.
- **Settings: the summon chip rides the familiar roster** — picker wraps, project filter, capped decisions (#2782).
- **Dashboard: the recent daily-reports list scrolls** (#2794).

### Fixes
- **Appearance: theme-token edits layer on the selected theme** and the redundant color editor is gone (#2792, cave-qz3m).
- **Composer: visible input text and icons** — icons take the primary tier, placeholders 85% foreground (#2778, cave-tjcx).

### Accessibility
- **Journal: audible mutations, real headings, visible focus, and a spoken disabled reason** (#2780, cave-t1ou).

### Performance
- **Journal: day reads no longer block on the memory-inventory scan** (#2784, cave-tgx9).
- **Sidebar: the recent-activity poll is guarded** with content equality + a sequence id (#2779, cave-lb4e).

### Polish
- **Chrome: the title bar slims to the traffic-light height** (#2781, cave-p78p).
- **Marketplace: the skill-browser rail slims from five labeled groups to three** (#2786, cave-99k1).
- **Home: the news lane drops its newspaper chrome marker** (#2788, cave-e2zx).

### Docs
- **Golden paths** — eight journeys with grounded current state and conservative enablement plans (#2787, cave-60fu).

## [0.0.158] - 2026-07-08

> 🗂️ **Nothing hides the folder browser** — the project directory picker escapes its host's stacking context and always renders on top. Stale polls stop clobbering fresh state on schedules and the board, the sidenav familiar switcher settles into its final chrome, and the inbox goes quieter over SSE.

Patch release on top of v0.0.157.

### Fixes
- **Projects: the directory-picker modal portals to `<body>`** (#2773, cave-lj6j). A transformed/backdrop-filtered host (the home composer card) trapped the fixed scrim in its stacking context, letting composer chrome paint over the open folder browser. It now renders above everything from every mount.
- **Schedules: sequence-guarded loads** — a stale poll can no longer revert a just-toggled or just-saved cron (#2771, cave-1303). **Board: same guard** for stale poll/focus GETs vs fresher optimistic moves (#2766, cave-vdvy).
- **Chat: the sidebar's familiar switcher is restored** — the chat page's only familiar control (#2768, cave-l3ay); **runtime + host chips share the round icon buttons' pill radius** (#2769).

### Features
- **Sidenav: the familiar switcher is a full-width multiselector wearing the New-chat chrome** (#2761), aligned edge-to-edge with New chat, caret on the right edge (#2772).

### Performance
- **Inbox: SSE stays quiet when nothing changed** — content-equal updates drop, reconnect snapshots keep array identity, and ActionInbox follows the cockpit repoll (#2762, #2770, cave-bzch).

### Internal
- CI: the release workflow's Intel leg retries its network-dependent steps (#2767, cave-1hha).

## [0.0.157] - 2026-07-08

> 🔔 **Heard, not just seen** — inbox triage speaks to assistive tech: one snooze menu with real menu semantics everywhere, actions that announce what they did, urgency-aware toasts, and capabilities that narrate their refreshes. Plus the familiar switcher in every page's sidenav and split tiles that fit every screen.

Patch release on top of v0.0.156.

### Features
- **Shell: the familiar switcher lives in the sidenav header on every page** (#2750, cave-vtk9).

### Fixes
- **Inbox: prefs writes are serialized** — concurrent PATCHes can no longer drop each other's changes (#2758, cave-g6ew).
- **Shell: split tiles fit every screen** — pixel floor, even remounts, container-keyed grids (#2743, cave-hivd).

### Accessibility
- **One SnoozeMenu, real menu semantics** (#2760, cave-1y0d). The shared snooze menu (inbox toast, inspector, calendar, dashboard) declares `aria-haspopup`/`aria-expanded`, renders a named `role=menu` with `menuitem` options, traps focus with Escape-to-trigger, and the dashboard's hand-rolled copy is gone. Inbox actions announce their outcomes — item titles for single actions, counts for bulk — and the icon-only dismiss names its item.
- **Toasts: urgency-aware politeness, pausable auto-hide, one titled dismiss** (#2757, cave-bj68).
- **Capabilities: refresh lifecycle and copy outcomes are announced** (#2755, cave-vmj8).

## [0.0.156] - 2026-07-08

> 🎛️ **A palette worthy of the slash** — the chat composer's slash view becomes a sectioned palette: Commands and Skills headers, icon-led rows with inline descriptions, and a roomy elevated panel. The shell picks up a familiar dropdown atop the chat sidebar with a Codex-style title bar.

Patch release on top of v0.0.155.

### Features
- **Chat: slash menus become a sectioned palette** (#2752, cave-nl9n). Sentence-case Commands/Skills headers, leading icons with medium names and unified muted inline descriptions, inset rounded row highlights, and an elevated rounded panel — across the slash menu, /model, /skill, /prompt, and @-file pickers. Keyboard contract unchanged.
- **Shell: familiar dropdown heads the chat sidebar** · Codex-style title bar · one-row sidepanel chrome (#2747).

### Fixes
- **Models: the GPT-5.1 generation retires from the codex model menu** (#2751).
- **Settings: On/Off switches match the shared button shape** (#2741, cave-9yll).
- **Calendar: week view falls back to day rendering in narrow split panes** (#2748, cave-87zv).

## [0.0.155] - 2026-07-08

> 🔍 **Review means the one you picked** — a chat edit card's Review no longer keeps snapping the Changes panel back to its own file while an agent is mid-edit; whichever diff you expand stays expanded. Plus a roomier reading measure and a friendlier crons detail panel.

Patch release on top of v0.0.154.

### Fixes
- **Chat: Review jump-to-diff applies exactly once** (#2742, cave-bvbw). The Changes panel's focus effect re-asserted the original Review target on every 5-second poll while an agent was editing, clobbering whichever diff you had manually selected. Each Review click now consumes its focus once (still retrying until a just-edited file appears in the list), and path matching aligns on `/` boundaries so look-alike filenames can't cross-match.

### Features
- **Crons: sleek beginner-friendly detail panel**, expandable to full page width (#2740, cave-4p6k).
- **Chat: the shared reading/composer measure widens one step** (46rem → 52rem) for roomier transcripts (#2739, cave-cy8o).

## [0.0.154] - 2026-07-08

> ⚗️ **One family of controls** — the composer's runtime chip lands everywhere (logo + model, one-click switching, now on Home too) and every icon button rounds up to match it. The daemon's control-plane catalog gets a proxy route, the projects hub takes five upgrades, and an a11y sweep makes bells, schedules, calendars, and pickers honest to assistive tech.

Feature release on top of v0.0.153.

### Features
- **Composer: always-on runtime chip** (#2711, cave-yq5l) — the active runtime's logo + effective model live in the composer, one click to switch either; **on Home too, with instant roster refresh after runtime switches** (#2718, cave-v25g).
- **Composer: icon buttons match the chip** (#2735, cave-8jp4). Attach/voice/options/stop/send become 30px capsules like the runtime and host chips — one control family at every breakpoint.
- **Daemon: control-plane capability catalog proxy** (#2695/#2724). `GET /api/daemon/capabilities` normalizes the daemon's catalog with three feature-detectable states (offline / no catalog / ok).
- **Projects: five hub updates** (#2730, cave-ihox) — task quick-add, honest git chip, Recent sort, meta titles, grants clarity; **one project per root enforced in the store** (#2732, cave-729h).
- **Home: Chat/Task tabs above the composer card**, project chip width fit, wordless News lane (#2725).
- **Chat: externally-generated sessions stay out of the chat lists** (#2719, cave-73fr); **file links render only when the click can actually open them** (#2698).
- **Chrome: seamless ultra-minimalist title bar** (#2714, cave-r1f5).

### Fixes
- **Quick chat: the thread fills the window height** — the dropdown-era 46vh cap is gone (#2729, cave-8f9h); **intent-based follow release for quick-chat + group chat** (#2696, cave-o8si).
- **Home/palette: IME composition no longer sends half-composed drafts** (#2720, #2705); **palette Enter opens the top local match** with Ask-Salem as the fallback row (#2706).
- **GitHub: detail fetches abort on switch, optimistic resolves protected, PAT modal guarded mid-save** (#2726, cave-b8ba); **review familiar backfills once the list loads** (#2723).
- **Automations: stable in-flight run poll** (no interval churn, no N+1 fan-out — #2716), stale-response guard on the run log (#2702), status-shaped run icons + associated labels (#2703).
- **Settings: abort/ordering guards on daemon-status + config fetches** (#2701); the undefined `var(--danger)` becomes the real `--color-danger` token (#2700).
- **Board: a card's cwd derives server-side from its project, never the client body** (#2708, cave-pw83).
- **Browser: closing the active tab fully activates its replacement** (#2707); **popovers close on focus-out** per their non-modal role (#2712).
- **UX: confusion-helpers sweep** — jargon defined at decision points, states labeled, verbs made honest (#2699).

### Accessibility
- **Bell**: trigger names its dialog, chips are real toggles, times stay live, pointer-wide dismiss (#2728); failed notification mutations are announced (#2727).
- **Schedules**: both detail panels are real dialogs (#2717). **Calendar**: month gridcells keep a single tab stop (#2710) with a committed e2e keyboard model (#2722). **Projects**: the directory picker traps focus (#2733).

### Internal
- CI: `timeout-minutes` on every job — hung steps no longer stall required checks for the 6-hour default (#2715). Shared inline slash-menus hook (#2697). Committed e2e spec for the runtime-chip switch flow (#2721). Canvas sandbox postMessage invariant pinned (#2704).

## [0.0.153] - 2026-07-08

> 🕸️ **The grimoire grows a graph** — every doc's [[wiki-links]] and semantic kinships spread across a force-directed canvas you can wander. Chat learns the Codex model catalog, the browser pane finally leaves the boot bundle, and suggestion chips close out their 2-or-4 arc with the dead CSS swept.

Feature release on top of v0.0.152.

### Features
- **Grimoire: Obsidian-class doc graph** (#2676, cave-hand). Semantic edge generation plus a force-directed canvas viewer, with a surface UX pass to match.
- **Chat: Codex model catalog + anonymous-calm landing** (#2677). Model picking covers the Codex catalog; the landing calms down when no familiar is signed in; skill scans dedupe by realpath.
- **Marketplace: "Explain code" starter prompt in the Essentials pack** (#2690).

### Accessibility
- **Flow** (#2680, cave-sky3; #2685, cave-6pp8). React Flow controls and viewport pan/zoom honor `prefers-reduced-motion`; graph nodes open from the keyboard, not just double-click.
- **Dashboard** (#2687, cave-0k5b). Drag announcements speak panel titles and positions; grips name their panel.
- **Grimoire** (#2686, cave-mglw). Deletes and saves are announced; the document strip is a full tabs pattern.
- **Notifications + board** (#2684, cave-6fqb). The notification popover traps focus; the selected board card stays in view across view switches.

### Performance
- **Browser pane lazy-loads** (#2683, cave-masj) — the last surface out of the boot bundle.
- **Familiars: single 30s memory poll** (#2679, cave-5dnw) — the embedded memory view mirrors the parent feed instead of double-fetching.

### Changed
- **Settings and Capabilities action buttons standardize on the shared Button primitive** (#2675, #2678, cave-0k3z).
- **Dead code swept**: the unused /api/youtube chain and RailMemoryList (#2682, cave-kdkg), the zones-era dashboard model surface and test-only `dashboardLayout()` (#2688, #2689, cave-pbk4), hidden-Roles marketplace remnants (#2692, cave-vp4h), and the unreachable 3-column suggestion-pill breakpoint (#2693, cave-98bs) — closing out the chips 2-or-4 arc.
- **Terminal docs pin the keepalive visibility invariant** (#2681, cave-hnn5).

## [0.0.152] - 2026-07-08

> 🪟 **Quick chat, multiplied** — the tray window holds several conversations at once behind a glassy new face: tabs that inherit your familiar, ⌘N to open another, and vibrancy shining through on macOS. The summoning circle learns to hold a full OpenClaw roster, and the calendar gets a proper accessibility pass.

Feature release on top of v0.0.151.

### Features
- **Quick chat: multi-chat tabs + glassmorphic tray window** (#2666, cave-m80j). A tab strip holds several quick chats; the add button or ⌘/Ctrl+N opens a new chat on the familiar you're already talking to; ⌘/Ctrl+W or the pill's × closes one, and closing the last chat closes the quick chat itself. Background tabs keep streaming. On macOS the window goes transparent with OS vibrancy behind translucent, blurred surfaces (with a reduced-transparency fallback), and the window is resizable now.
- **Chat: instant compose boot + board-aware starter pills on the landing** (#2664, cave-qvwu).

### Fixes
- **Summoning circle: long vessel lists scroll inside the panel** (#2669, cave-hpsz). A full OpenClaw roster no longer blows past the dialog or paints under the Cancel/Continue footer.
- **Calendar accessibility pass** (#2663, #2665, #2668, #2670). The open event panel reconciles with live items, reschedules are announced with the owning familiar named on every chip, the now-line ticks on the wall-clock minute, and the month view is a real ARIA grid with 2-D roving day cells.
- **Group chat** (#2662, #2667). IME-composition Enter is ignored in the composer, mention picker, and rename; a11y labels, keyboard-visible focus, and per-coven composer drafts.
- **Chat: /skill picker renders one row per skill id** — no duplicate React keys (#2671, cave-rru2).
- **Terminal: find-bar match counter is non-live** (#2655, cave-eatw).

### Performance
- **Group chat: throttled transcript persistence, capped stored tail, single-pass thread grouping** (#2661, cave-lh78).

## [0.0.151] - 2026-07-08

> 🔁 **Updates that update themselves** — the native in-app updater finally works in packaged builds: check, download with progress, install, and relaunch without ever leaving the cave. Plus a rounder terminal: tabs you can drive from the keyboard, an SR mirror that follows visibility, and shells that end when their tab does.

Patch release on top of v0.0.150.

### Fixes
- **Desktop: the native in-app updater is no longer ACL-denied** (#2654, cave-51yk). The updater/relaunch permissions only existed in the local-only capability, but the main window runs from the loopback origin — a remote ACL context — so every native check silently failed and update prompts fell back to browser downloads. A remote-scoped `loopback-updater` capability (trusted main webview only) restores one-click *Install & restart*, and the update banner now re-checks every 6 hours so long-running caves hear about new releases. Users on ≤ v0.0.150 make one final browser-download update to this release; every update after is fully in-app.
- **Terminal: keyboard-operable tab strip + per-pane AT labels + reduced-motion cursor** (#2652, cave-p767).
- **Terminal: the screen-reader mirror follows pane visibility instead of focus, and `pty_resize` is throttled** (#2651, cave-2956).
- **Terminal: WS-transport shells are reaped on tab close** instead of lingering for a 5-minute grace (#2649, cave-wujw).

### Internal
- `src-tauri` test files (capability ACL pins, release-runtime pins) are now wired into the CI app suite — they previously ran nowhere, which is how the updater denial and a drifted terminal pin went unnoticed (#2654, #2653).

## [0.0.150] - 2026-07-08

> 🔮 **The Summoning Circle** — familiar creation leaves the setup wizard for a gamified in-app rite: choose a vessel (this machine, SSH, or an OpenClaw agent), name it, give it form, and summon — then return to the circle to enhance. Chat becomes the front door, seven surfaces adopt the shared compact chrome, and Windows launching gets sturdier.

Feature release on top of v0.0.149.

### Features
- **Familiars: the Summoning Circle** (#2635, cave-xxy8). Creation is a staged rite around an animated circle — vessel (local runtime, remote over SSH with a pre-summon connection test, or an OpenClaw agent bridge), name (with suggestions and a live id preview), form (sigil, portrait, aura), summoning (with celebration). An Enhancement Rite alters existing familiars — identity, form, and mind batched behind one act, with honest vitality signals.
- **Onboarding ends at infrastructure** (#2637, cave-ej9r). The wizard stops at tools → Coven home → runtime → daemon; familiar creation lives exclusively in the Summoning Circle, and a familiar-less dismissal lands on the circle's invitation.
- **Chat-first IA** (#2632, #2633, cave-hsa6). Cave boots into a ChatGPT-style compose landing — the conversation is the front door.
- **Chat: quieter shell** (#2628 cave-xsq.7, #2629 cave-xsq.8, #2606 cave-xsq.5, #2608 cave-xsq.6). Code rail closed by default, Journal + Grimoire join the quiet nav cluster, Group demotes to an icon, and the quick-chat overlay retires for a thin chat launcher.
- **Shared compact chrome across seven surfaces** (#2627, #2631, #2634, #2636, #2638, #2639, #2644). Schedules, Marketplace, Tasks, Grimoire, Work queue, the browser toolbar, and Settings adopt the one slim GitHub-style header band.
- **Chat: adaptive suggestion chips** (#2642, #2648). Next-path and artifact-refine chips come as 2 or 4, never a fixed 3.
- **Home: Continue/News digest carousel restored** (#2630, cave-ican) and the orphaned column components removed (#2645, cave-he9d).
- **Familiars: drag-to-reorder the Lifecycle roster** (#2609, cave-f2vo).
- **Work queue: world-class pass** (#2638, #2641, cave-d3pg). Truthful degradation, freshness, poll performance, cleanup dedup, composer focus.

### Fixes
- **Chat: stale-state fixes on rapid thread/root switch + /clear teardown** (#2607, cave-b63); **system echoes survive mid-stream** (#2646, cave-7ft); **the Reflect header button gets its own sparkle** — no more twin brains (#2643, cave-gdth); **quieter code-block header** (#2640, cave-8bfz).
- **Windows: sturdier launching** (#2621, #2625). Spawn PATH rebuilds from the registry instead of a login shell, and `coven` resolves through PATH before the literal-name fallback. The onboarding Smart App Control notice now explains itself and links Microsoft's doc (#2622).
- **Browser: close inactive native webviews** (#2626) and a WAAPI mode-fade replacing the localhost probe (#2620).
- **Board: simpler new-task modal** without workspace-specific defaults (#2647).
- **Desktop: folder picker no longer says "Choose a folder for Graphify"** (#2623); **platform-aware search shortcut badge** instead of a hard-coded ⌘K (#2624).

## [0.0.149] - 2026-07-07

> 🩹 **Chat polish** — prompt snippets fold into the composer's Options menu, and group chat gains a race-safe session recorder that aborts an in-flight broadcast when you switch covens.

Release on top of v0.0.148.

### Features
- **Chat: prompt snippets in the Options menu** (#2602, cave-xsq.4). The snippet picker moves into the composer's Options menu.

### Fixes
- **Group chat: race-safe session recording** (#2603, cave-z4s). `recordSession` is race-safe and aborts an in-flight broadcast on a coven switch.

## [0.0.148] - 2026-07-07

> 🔗 **Grimoire grows up** — the markdown editor gains a full `[[wiki-link]]` system (parser, outgoing chips, and a graph viewer), multi-tab editing, Open-in-Grimoire cross-links, live-follow of agent writes, and a diff-based 409 conflict resolver. Chat picks up a centered reading column, leaner per-message metadata, and create-task-from-chat. Plus more cave-4op button standardization and the legacy avatar store's retirement.

Feature release on top of v0.0.147.

### Features
- **Grimoire: `[[wiki-links]]`** (#2587, #2588, #2597, cave-xr0). A wiki-link parser + resolver, outgoing-link chips below the editor, and a cross-document graph viewer.
- **Grimoire: multi-tab editing** (#2582, cave-90u). Open several documents at once, persisted across reloads.
- **Grimoire: Open-in-Grimoire cross-links + delete/trash actions** (#2580, cave-kv3).
- **Markdown editor: live-follow agent writes** (#2583, cave-e3b). Open memory docs update as agents write them.
- **Markdown editor: 409 conflict resolver** (#2577, cave-utl). A diff view with keep-mine / take-theirs / merge, replacing cancel-and-reopen.
- **Chat: centered reading column + leaner metadata** (#2589, #2596, cave-xsq). A focused reading width, and name-plus-time per message with extras on hover.
- **Chat: create task from chat** (#2595, cave-px7). Turn a chat turn into a board task with a source audit trail.

### Refactors
- **Control standardization** (#2591, #2584, #2581, cave-4op). Board banner actions, the GitHub profile card, and the onboarding CTAs move onto the shared `Button`.
- **Marketplace: ultra-minimal Recommended cards** (#2586). Flat cards, chrome on hover.
- **Retire the legacy browser-local avatar store** (#2590, cave-154). The operator avatar is server-backed now.

### Fixes
- **Chat: thread-switch isolation** (#2594). Composer state and stream teardown scope per thread, with IME-safe Enter.
- **Popovers stack above the board task drawer** (#2579).

## [0.0.147] - 2026-07-07

> ⚡ **Faster and steadier** — memory inventory gets a 130x speedup, the markdown editor picks up debounced autosave for knowledge & journal docs, and the Work Queue surfaces a "Needs attention" strip for stale and unlinked PRs. Plus a round of session-changes and automations button refactors onto shared primitives.

Feature release on top of v0.0.146.

### Features
- **Work Queue: "Needs attention" strip** (#2568, cave-x1j). Surfaces stale and unlinked PRs at a glance.
- **Markdown editor: debounced autosave** (#2574, cave-b2v). Knowledge and journal docs now save automatically as you type.

### Performance
- **Memory inventory: 130x faster** (#2570, cave-od4). Head reads, pooled I/O, and an mtime cache slash inventory time.

### Refactors
- **Session changes: shared button primitives** (#2571, #2572, cave-4op). Commit/PR footer buttons standardize on the shared `Button`, and icon-only buttons normalize to the borderless `IconButton`.
- **Automations: shared row actions** (#2573, cave-4op). The remaining Schedules row actions route through the shared `RowActionButton`.

## [0.0.146] - 2026-07-07

> 📝 **Write where you think** — a new OpenKnowledge-style markdown editor lands across memory, knowledge, and journal, and the marketplace folds its Skills filter rail and leaderboard into one panel. Plus a Gantt scroll fix, cleaner GitHub comments, and a calendar controls refactor onto shared primitives.

Feature release on top of v0.0.145.

### Features
- **Grimoire: OpenKnowledge-style markdown editor** (#2562). A unified markdown editing surface for memory, knowledge, and journal entries.
- **Marketplace: unified Skills panel** (#2563, cave-8hn). The Skills filter rail and leaderboard merge into a single panel.

### Fixes
- **tasks: Gantt timeline scrolls on one bounded viewport** (#2559, cave-hsh). The Gantt timeline now scrolls within a single bounded viewport instead of overflowing.
- **github: remove @familiar tagging from the comment composer** (#2560, cave-803). The GitHub comment composer no longer injects @familiar tags.

### Refactors & chores
- **calendar: standardize toolbar, action, and jump-to-date mini-month controls on shared Button/IconButton primitives** (#2565, #2566, #2567, cave-4op).
- **marketplace: hide the Roles section for now** (#2564, cave-8vy).

## [0.0.145] - 2026-07-07

> 🛠️ **The work queue grows up** — the Familiar Work Queue lands as a beads + PR control tower with handoff notes and evidence-gated close, iOS finally reads your operator profile (name/avatar instead of "You"), and Projects gets a Files drill-through into the code rail. Plus a solid batch of daemon-resilience, dashboard, proxy, and nav fixes.

Feature release on top of v0.0.144.

### Features
- **Familiar Work Queue — beads + PR control tower** (#2547, cave-hlv.4). The epic's control-tower slice: a unified view over beads and open PRs.
- **Work queue: handoff notes + evidence-gated close** (#2553, cave-hlv.2). Cards carry handoff notes, and closing requires evidence — no silent completions.
- **iOS reads the operator profile** (#2550, cave-8xb). The iOS surface shows your name and avatar from the operator profile instead of a hard-coded "You".
- **Projects: Files drill-through into the code rail** (#2548, cave-z44). Jump from a project in the hub straight into its files in the code rail.

### Fixes
- **Daemon: bound and settle every call; retry transient GETs** (#2551, cave-4po). Every daemon call is now bounded and settled, with automatic retry on transient GET failures.
- **nav: honest Schedules top-bar button + split-open sidebar state** (#2555, re-land #2501). The Schedules button reflects real state and the sidebar opens split correctly.
- **browser: close native webviews on surface leave** (#2545, re-land #2500). Native webviews are torn down on leave instead of parked 1×1 offscreen.
- **dashboard: dedupe stalled-PR signals by URL + cap the Signals panel** (#2543, cave-2it). Stalled-PR signals de-dupe by URL and the panel is length-capped.
- **proxy: accept the real listen port in the CSRF origin gate on port fallback** (#2544, cave-5sg). The CSRF origin gate honors the actual listen port when the dev server falls back.
- **settings: show only section labels in the left nav** (#2549, cave-iwb). The settings left nav drops the description row for a cleaner label-only list.

### Tests & docs
- **e2e: dashboard cockpit interaction contracts** (#2554, cave-1if).
- **docs: clarify Tauri dev startup** (#2546).

## [0.0.144] - 2026-07-06

> ✨ **A home that feels like yours** — the cold-start surface gets a world-class visual pass (presence eyebrow, breathing hearth glow, resume affordance), and a new **server-side operator profile** lets you set your name, pronouns, bio, timezone, links, and avatar once — surfaced across chat and handed to your familiars as startup context.

Feature release on top of v0.0.143. Ships the redesigned home surface and the operator profile system.

### Features
- **Home world-class visual pass** (#2540). A distinctive cold-start surface: a time-aware presence eyebrow with a glowing accent dot, an accent-tinted project name in the headline, a signature breathing "hearth glow" behind the composer that brightens on focus, informational pills for board continuations, an always-visible `Resume →` affordance on the newest Continue card, and staggered entrance choreography — all collapsed under `prefers-reduced-motion` and honoring every pinned composer/centering/column contract.
- **Server-side operator profile** (#2541). Set your name, pronouns, bio, timezone, links, and avatar from a new **Settings → Profile** section. Text fields persist under a `profile` key in `cave-config.json`; the avatar is a single atomic file (SVG rejected as a stored-XSS vector). `GET/PATCH /api/profile` + `GET/POST/DELETE /api/profile/avatar` (field validation, 2 MB cap, ETag/304). The hard-coded "You" across chat, group chat, reply quotes, and grant labels now routes through your display name, and new sessions receive an `operator-profile` startup-context block — zero overhead when unset.

## [0.0.143] - 2026-07-06

> 🧹 **A tighter, more honest cockpit** — the dashboard's Familiar Insights table becomes sortable and filterable, a new space-usage panel gives you an honest read on where `~/.coven` disk is going (with cleanup drill-throughs), and the quick-chat box gets a hardening pass. Behind the scenes, a twice-daily PR triage patrol lands to keep the review queue from rotting.

Patch release on top of v0.0.142. Ships dashboard analytics polish, local space-usage analytics, a quick-chat hardening pass, and the morning/evening PR triage patrol.

### Features
- **Sortable + filterable dashboard insights, plus local space-usage analytics** (#2538). The Familiar Insights table gets real `aria-sort` column headers (click cycles sorted ↔ reversed ↔ curated default) and a live-count filter; a new space-usage panel does a bounded, symlink-safe scan of `~/.coven` and reports honest lower bounds (`1.3 GB+` when capped) with per-area cleanup drill-throughs. Donut/heatmap diagrams gain hover detail and accessible `role=img` summaries.
- **Morning/evening PR triage patrol** (#2536). `pnpm beads:prs:patrol` sweeps every open PR into a window-ordered digest — mornings lead with *Fix first*, evenings with *Ready to land* — and flags stale + unlinked PRs. `--apply` mirrors linked PR state into beads; the patrol itself never merges.

### Fixes
- **Quick-chat hardening** (#2537). Hardened the quick-chat box and de-duplicated the overlay/tray internals.

## [0.0.142] - 2026-07-06

> 📊 **Analytics you can actually steer by** — familiar analytics and growth pages get pulse trends, drill-through KPIs, and a triage roster, while the marketplace gets an ultraminimal header and a full functionality pass. On iPad, **The Diary** arrives: an experimental Apple Pencil handwriting surface.

Feature release on top of v0.0.141. Ships a revamped analytics/growth surface, a marketplace overhaul, the new experimental iOS Diary, Projects-table polish, and a batch of connection/desktop/onboarding/GitHub fixes.

### Features
- **Familiar analytics + growth revamp** (#2469). Pulse trend lines, drill-through KPIs, and a triage roster across the familiar analytics and growth pages, with dashboard cockpit analytics accuracy fixed so the numbers match reality.
- **Marketplace ultraminimal header + UX pass** (#2463). A comprehensive functionality and UX pass on the marketplace with a stripped-down header.
- **The Diary — experimental Apple Pencil handwriting page (iPad)** (#2457, #2458, #2471). A new experimental handwriting surface for iPad: longer replies, no option menus, sentence-length pen-lift detection, and presented from RootView so connection flaps can't dismiss it mid-session.
- **Projects table polish** (#2459). UI/UX cleanup on the Projects table, including de-duped project listings.

### Fixes
- **Seamless, stable iOS ↔ desktop connection** (#2465, cave-30b). Hardens the mobile/desktop connection path so it stays stable instead of flapping.
- **Titlebar drag** (#2464). Grants `start_dragging` to the loopback webview so the desktop titlebar actually drags.
- **Onboarding focus trap** (#2466). Keeps the wizard's focus trap airtight and stops it relaunching on already-set-up machines.
- **mobile:tailscale port squatting** (#2468, cave-gbo). Stops `mobile:tailscale` dead-ending when the port is squatted by an untracked server.
- **GitHub review-conversation regressions** (#2467). Addresses regressions surfaced in PR #2450 review conversations.

### Polish
- **GitHub surface** (#2456). Profile cache, live checks refresh, and thread-comment reactions.

### Tests
- **Inline file editing + Diary UI tests** (#2470). Adds coverage for inline file editing and the new Diary UI.

## [0.0.141] - 2026-07-06

> ⚡ **Quick chat is now a real conversation** — the menubar / ⌘J dropdown holds a full multi-turn thread: streaming replies, context that carries across turns, copy & regenerate, all without leaving what you were doing.

Feature release on top of v0.0.140. Remakes the quick-chat menubar dropdown
into a genuine multi-turn conversational surface.

### Features
- **Multi-turn quick chat** (#2451). The menubar / ⌘J quick-chat dropdown is now a real conversation instead of a one-shot ask: threaded user + familiar turns that resume the same session so follow-ups keep their context, streaming with a caret and a "thinking" pulse then full markdown once the reply lands, per-reply copy and regenerate, Stop mid-stream, an avatar familiar picker, empty-state starter chips, and Enter-to-send (Shift+Enter for a newline, ⌘/Ctrl+Enter still sends). The draft clears the instant a turn is sent, switching familiar starts a fresh thread, and the dropdown now traps focus (Tab cycles, Escape closes, focus returns to the trigger). The Tauri tray quick-chat window shares the same upgrade.

### Docs
- **Add `CONTRIBUTORS.md`** to credit community contributions. Records the fixes and improvements from Chris Thomas ([@Aimplemented](https://github.com/Aimplemented)) whose original PRs were re-landed through internal branches during merge — group-chat parallel first-pass replies (#2206), tokenless native iOS Serve route (#2404), installer links via the system handler (#2381, #2414), and the current-session-id flag (#1989).

## [0.0.140] - 2026-07-05

Docs release on top of v0.0.139. Adds the approved design spec for the
upcoming **contextual-only browser surface** — the plan to retire the in-app
browser as a standalone navigation destination and make it a companion split
pane on wide viewports / bottom-sheet overlay on mobile, while keeping every
existing URL-open entry point working unchanged.

### Docs
- **Browser contextual-only surface design spec** (`docs/superpowers/specs/2026-07-04-browser-contextual-design.md`). Documents the navigation removal, the `openBrowserAdaptive` behaviour for wide vs narrow viewports, and the deep-link paths that stay functional via `?mode=browser` / `#browser`.

## [0.0.139] - 2026-07-05

Security-hardening release on top of v0.0.138. A coordinated batch of fixes
tightens the trust boundaries around the mobile/tailnet listener, task-chat
project scoping, webhook CSRF, npm-install elevation, and loopback event
listeners — alongside the unified-workspace code rail, a marketplace category
browse, curated automation templates, WCAG-compliant theming, and a styled
macOS DMG.

### Security
- **Task-chat project root is now server-authoritative.** The board task-chat
  launch resolves the project root from the card's `projectId` server-side,
  rejects a client-supplied root that disagrees with the assignment (403), and
  authorizes the familiar via `assertProjectAccess` before starting a session
  — a forged `projectRoot` can no longer root a familiar in an arbitrary
  directory (#2419).
- **Tokenless GET webhooks are CSRF-guarded.** In tailnet-trusted, tokenless
  mode, state-changing webhook GETs now require a same-origin `Origin`/`Referer`
  header, closing the `Referrer-Policy: no-referrer` cross-site bypass (#2417).
- **npm installs no longer auto-elevate.** The onboarding installer drops silent
  `sudo -n`; system-owned prefixes now require the operator to run with sudo
  themselves, while user-owned prefixes (nvm/fnm/brew) stay one-click (#2418).
- **Loopback event listeners are scoped to the trusted webview.** The
  `core:event:allow-listen/unlisten` capability is removed from the broad
  loopback-browser context and restricted to the main webview (#2421).
- **Native mobile Serve requires a token at startup**, and the native iOS Serve
  route stays tokenless only over the tailnet interface (#2415, plus follow-up).
- **Agent chat attachments are scoped to granted roots** (#2411), **travel chat
  replay is project-access guarded** (#2413), **marketplace status checks no
  longer resolve secrets** (#2416), and **GitHub familiar-review prompts are
  hardened** against injection (#2412).

### Added
- **Unified workspace + code rail.** A consolidated workspace sidebar with a
  code rail: Changes foundation, a lazy-pty Terminal tab, a Files tab preview,
  and nav coupling with rail motion + a mobile sheet (#2359, #2374, #2375, and
  workspace unification follow-ups). Legacy code mode is retired.
- **Marketplace: category browse + installed surfaces.** Browse catalog grouped
  by category (#2399-adjacent), surfaced installed APIs and MCPs, plus new
  directory-backed skills entries and the Pretext layout skill (#2399, #2358).
- **Automations: Templates tab** with 18 curated cron templates (#2398).
- **Evals: export familiar runs** to Hermes Flight Recorder JSONL (#2402), with
  an HFR observer-hook JSONL export fix.
- **WCAG-compliant theming** across all appearances plus three a11y-first
  presets, and broad light-mode / dashboard / marketplace / familiars a11y
  passes (focus traps, AT announcements, reduced-motion) (#2353, #2355, #2350,
  #2346, #2357, #2377).
- **Project identity everywhere** — project avatars (uploaded image or monogram
  tile), identity tiles on Recent sidebar rows, board-lane avatars, comux header
  (#2354, #2360, #2365).
- **Workflow: Beads PR bridge + familiar tracking** (#2367), and prompt drafts
  enhanced without an API roundtrip.
- **Styled macOS DMG** installer window (#2400).

### Changed
- Composer moves to a `StandardSelect` primitive; evals + terminal composer
  modes removed (#2401). Home composer uses custom dropdowns and a polished
  command bar.
- Settings sidebar options flattened (#2401-adjacent); familiar-strip restyled
  (pill avatars, spring-scale hover, matched sidetrigger radius, dropped overlay
  badges) (#2392, #2393).
- Runtime vocabulary cleanup finished across copy; project scoping/ordering
  stabilized; host runtime selection scoped.
- External-PR freeze lifted for the Independence Day PR event (#2394, #2397).
- Consolidated Coven design-language reference + OpenCoven IP protection records
  added to docs (#2356, #2390).

### Fixed
- **Updater:** avoid running the direct installer after a native update failure;
  native updater installer fallback corrected (#2414, #2381).
- **Mobile/iOS:** trust the sidecar port for handoff serve (#2410); reset stale
  state and clear the bearer token when changing/reconfiguring hosts.
- **Chat streaming:** drop late/cancelled OpenClaw stream enqueues after
  close/abort (#2361, #2362); hydration-safe deep-link takeover with an
  "Opening chat…" state (#2364, #2351).
- **Home:** close/dismiss the news carousel (hover + dismiss control).
- **Familiars:** cancel stale daily-notes loads and stop the poll resurrecting a
  deleted memory row (#2352).
- **Layout:** use Next `Script` for inline boot scripts (#2366); project-picker
  and avatar sizing fixes (#2378).
- **Marketplace perf:** memoize the card and stop stale catalog loads clobbering
  the list (#2349).

## [0.0.138] - 2026-07-04

Patch release on top of v0.0.137. The dashboard cockpit becomes truthful and
navigable — the freshness pill reflects real data arrivals and doubles as a
manual refresh, and every KPI, panel, agent row, and signal drills into the
surface that owns it. Chat gains the **Host chip** arc for running sessions on
registered remote servers, the composer's control pills get a compact pass with
a warm gold accent, and browser/terminal/evals pick up fix + a11y hardening.

### Added

- **Chat** - Host chip: run chat sessions on registered remote servers, with a
  live-status popover and a shared chip module on the home composer (#2337,
  #2340, #2345).

### Changed

- **Dashboard** - the "Updated…" pill is stamped when fetched data actually
  lands (it was pinned to render time) and doubles as a manual refresh; KPI
  tiles, panel headers, agent/confidence rows, signals, and quick links all
  deep-link to the surface that owns the number; KPI deltas are colored by
  meaning (#2347).
- **Composer** - compact, content-sized control pills with a warm gold icon
  accent (#2341, #2343); the sidebar header gives the options button breathing
  room (#2332).

### Fixed

- **Home** - new tasks credit the familiar shown on the composer, and sent
  drafts no longer resurrect (#2344).
- **Browser** - forward history survives navigation, the iframe fallback
  sandbox is hardened, a listener race is fixed, and the reposition loop is
  throttled (#2335).
- **Evals** - the judge's pass/fail verdict is honored, stopped runs are not
  recorded, runs are capped per-suite, and the poll is guarded (#2333).
- **Terminal** - the screen-reader mirror stops re-rendering on hidden panes
  and the decoder resets on reconnect (#2338).
- **Mobile** - the Cave connection handoff is polished (#2342).

### Accessibility

- **Browser** - the tab strip is a real tablist with named controls, the
  collapsed toolbar is inert, and quick-open traps focus (#2336).
- **Evals** - the trend chart carries a text alternative, run lifecycle is
  announced, grader outcomes are named, and suite/progress state is marked
  (#2334).
- **Terminal** - connection-status transitions are announced to the assertive
  live region (#2339).

## [0.0.137] - 2026-07-03

Patch release on top of v0.0.136. A big **Flow** and **mobile** slice: Flow gets
a multi-pass world-class overhaul (config summaries, empty-canvas coaching,
keyboard shortcuts, working multi-select, branch labels on fan-out edges, plus
lifecycle accessibility and a ~1,600-line dead-code purge), the native iOS app
gains iPad/macOS adaptive layouts and a self-healing connection with seamless
QR/deep-link pairing, and the Library surface is faster and more accessible.
The desktop Chat and Code sidebars also land their world-class redesign.

### Added

- **Flow** - world-class overhaul across two passes: config summaries, an
  empty-canvas coach, keyboard shortcuts, memoized rails (#2327), plus working
  multi-select and branch labels on fan-out edges (#2329).
- **iOS** - iPad and macOS adaptive layouts across all tabs (#2317).
- **Mobile** - seamless pairing: QR / deep-link invites, Bearer auth, and
  rolling token renewal (#2320).
- **Board** - nudge to set a project on projectless task cards (#2319).

### Changed

- **Chat / Code** - world-class redesign of the Chat and Code sidebars (#2313).
- **Sidebar** - thread rows go full-width when not hovered (#2321).
- **Flow** - sessions launch in non-interactive mode (#2324).

### Fixed

- **iOS** - the cave connection is now self-healing (#2328).
- **Library** - fix reading-status rollback (#2325).

### Performance

- **Library** - lazy-load the surface (CodeMirror out of boot), memoize
  read-time, drop a dead type (#2325).
- **Flow** - index branch-label sources (#2330).

### Accessibility

- **Flow** - announce lifecycle events, name the nodes, and focus-trap the
  add-node & template dialogs (#2316).
- **Library** - name zoomable reader images, focus-trap the lightbox, mark
  reading progress, and `aria-current` the doc list (#2326).

### Removed

- **Flow** - purge ~1,600 lines of dead superseded workflow libs and dead
  flow-doc / workflow-graph exports (#2318).

## [0.0.136] - 2026-07-03

Patch release on top of v0.0.135. Headlined by the desktop browser fix — the
embedded native webview no longer paints over onboarding, modals, or the
command palette — plus avatar storage moving to IndexedDB (freeing the shared
localStorage quota), a unified project picker across surfaces, a
time-bucketed chat sidebar, and calendar/canvas hardening.

### Added

- **Chat** - the sidebar gains an Organize menu with a default time-bucketed
  Recent view (#2310).
- **Projects** - unified project picker: one selection UI and a one-step add
  flow across surfaces (#2307).
- **Sidebar** - the app version shows as the bottommost minimal-height line
  (#2312).

### Changed

- **Avatars** - avatar images move from localStorage to IndexedDB with a
  one-time migration, handing the shared ~5MB origin quota back to the rest of
  the app (#2306).

### Fixed

- **Browser (desktop)** - the embedded native webview yields to DOM overlays:
  it no longer paints over onboarding, modals, or the command palette, and
  navigating while covered loads offscreen and re-seats when the overlay
  closes (#2309).
- **Familiars** - avatar saves report the friendly "storage full" message
  instead of the raw browser quota error, and a refused write no longer leaves
  a phantom avatar that vanishes on reload (#2302).
- **Chat** - a task-linked chat opens in the task's project, not the first
  project (#2308).
- **Calendar** - timed events stay out of the all-day bucket, the add-day pin
  holds, and the minute tick no longer re-packs every column (#2304).
- **Canvas** - failed generations no longer leave blank tiles, sketch deletes
  ask for confirmation, and the dead canvas.css/ArtifactNode pair is removed
  (#2311).
- **Shell** - the titlebar drag lane spans the full height again (#2301).

### Accessibility

- **Calendar** - view, date, and mutation changes are announced; times and
  deadlines carry accessible names; the date popover traps focus (#2305).

## [0.0.135] - 2026-07-03

Patch release on top of v0.0.134. Continues the surface-hardening and
accessibility sweep: the **Code** surface stops showing stale file responses and
announces its save/revert/commit/PR actions, **Roles** folds into the
Marketplace as one hub, the shell's left nav/list panels are now pixel-sized for
full-width content, chat/board surfaces render at any pane or screen width, and
**Automations** audit batch C brings a kind-aware detail panel with uniform run
confirmation and action parity.

### Added

- **Shell** - the left nav and list panels are pixel-sized so content can use
  the full available width (#2299).

### Changed

- **Marketplace** - Roles merged into the Marketplace as a single hub surface
  instead of a separate view (#2295).
- **Automations** - audit batch C: the detail panel is now kind-aware, run
  confirmation is uniform across kinds, action parity across the list, and the
  surface lazy-loads (#2294).

### Fixed

- **Code** - drop stale file responses, reset the preview on project switch, and
  guard the changes poll so it can't race (#2296).
- **Responsive** - chat and board surfaces stay viewable at any pane or screen
  width (#2298).

### Accessibility

- **Settings** - announce async results, label the daemon inputs, and make the
  search jump move focus (#2293).
- **Code** - announce save/revert/commit/PR, focus-trap quick-open, and
  `aria-pressed` the toggles (#2297).

## [0.0.134] - 2026-07-03

Patch release on top of v0.0.133. A broad UI/UX + accessibility sweep: the
detail split now fills and re-fits its full width reliably, the split divider
gets a seamless magnetic even-split (no more ratio buttons), chat stops crossing
wires when you switch threads mid-stream, and Board/Automations/GitHub get
large accessibility batches. Also: the message action row swaps its redundant
Share button for privacy-safe local thumbs analytics, and the Automations
surface is lazy-loaded out of the boot shell.

### Added

- **Chat** - message action row mirrors 👍/👎 votes to a new local
  `/api/feedback/message` store so votes can seed later quality analytics.
  Whitelist-only fields, atomic writes, no message content ever egresses
  (mirrors the Salem pathfinder-feedback privacy model) (#2289).
- **Split view** - dragging a pane past the far edge collapses and promotes it;
  the divider snaps magnetically to an even split (#2280, #2283).

### Changed

- **Chat** - removed the redundant Share button from the assistant action row
  (it only copied text — the dedicated Copy button already does that) (#2289).
- **Split divider** - dropped the ⅓·½·⅔ ratio buttons in favor of the magnetic
  even-split gesture (#2283).
- **Dashboard** - removed the "Copy link" button from report pages (#2281).
- **Flow** - flow sessions launch in `nonInteractive` mode (#2287).

### Fixed

- **Shell** - the detail split now always fills the full width and re-fits when
  its width changes, closing the desktop far-right gap (#2277, #2284).
- **Chat** - switching threads mid-stream no longer crosses wires between
  sessions (#2282).
- **GitHub** - guarded the activity poll, stopped a manual refresh from eating
  drafts, and surfaced CI passing/pending state (#2286).
- **Board** - intent operations stop clobbering the full array on PATCH (#2275).
- **Automations** - audit batch A: poll guards, edit-wipe fix, run-history
  purge, and route hardening (#2278).

### Performance

- **Automations** - `AutomationsView` (~2500 lines) is now lazy-loaded like
  `BoardView` instead of shipping in the boot shell; also dropped the dead
  `workflow` automation kind (#2290).
- **Chat** - killed per-row sibling scans and an O(n²) stream buffer, gated the
  log, and made the artifact overlay a proper dialog (#2285).

### Accessibility

- **Board** - accessible names, focus restoration, scoped grab keys, and dated
  reschedule announcements (#2276).
- **Automations** - audit batch B: announcer, status labels, tab/menu
  semantics, and focus handling (#2279).
- **GitHub** - announce CRUD, label the composer, and focus-trap the action
  popover (#2288).

## [0.0.133] - 2026-07-03

Patch release on top of v0.0.132. Headline: the macOS overlay titlebar drags the
window again on external-URL webviews, and the build now fails fast on `sharp`
version skew with Next's pinned copy instead of only tripping the Windows-only
sidecar CI leg.

### Added

- **Marketplace** - ten hand-authored UI/UX skill packs under the "Design & UI"
  category: shadcn/ui + Radix, Tailwind design tokens & theming, Motion (Framer
  Motion) patterns, WCAG 2.2 AA accessibility audit, data-viz dashboard UX,
  design-system landscape, form UX patterns, empty/loading/error states,
  mobile touch UX, and command-palette keyboard UX. Each ships a long-form,
  source-referenced `SKILL.md`. `sync-marketplace.py` now honors a
  `skill.managed: "manual"` flag so these authored skill bodies stay the source
  of truth while their manifests and exports are still generated from
  `catalog.json`.

- **Supply chain** - guard against `sharp` version skew with Next's pinned copy
  in the dependency-policy test: the build now fails fast if `pnpm-lock.yaml`
  resolves more than one `sharp` version, if `sharp` diverges from `package.json`,
  or if any `@img/sharp-<native>` package drifts off it. This catches the skew
  that silently breaks the Windows sidecar bundle on every OS, instead of only in
  the Windows-only sidecar CI leg.

### Fixed

- **macOS titlebar drag** - the seamless overlay titlebar now actually drags the
  window. The webview loads from an external `http://127.0.0.1` URL, and WebKit
  only honors the `-webkit-app-region: drag` CSS hint on the native `tauri://`
  scheme — so the CSS-only approach (four prior attempts) was silently inert.
  The shell now calls the Tauri window API's `startDragging()` on pointer-down
  over empty titlebar chrome, which drives AppKit directly regardless of URL
  scheme, while interactive controls still fall through as no-drag. Also fixed
  the platform check that gated the whole titlebar mode: `navigator.platform` is
  deprecated and empty on newer WebKit, so it now prefers
  `navigator.userAgentData.platform` before falling back to the UA string.

## [0.0.132] - 2026-07-02

Patch release on top of v0.0.131. Headline: GitHub README images can be
inspected without leaving Cave, the board UI gets a focused audit pass, and the
desktop TypeScript toolchain is aligned with the Node 24 runtime.

### Changed

- **Library** - zoom GitHub README images in Cave instead of following GitHub's
  image link.
- **Toolchain** - aligned TypeScript and `@types/node` with the Node 24 runtime.

### Fixed

- **Board** - tightened card inspector remount behavior, polling guards, hoisted
  resolution state, undo snapshots, chips, and dead board UI paths.

## [0.0.131] - 2026-07-02

Patch release on top of v0.0.130. Headline: eval analysis is easier to scan,
board attachments are clearer from table to dispatch, quick chat opens on the
workspace's active familiar, and no-project chat sessions stay rooted in their
own workspace.

### Added

- **Quick-chat** - default the popover to the active familiar for the current
  workspace, so `⌘J` lands on the familiar already in focus.
- **Board attachments** - show attachment counts in board table rows and carry
  attachment names into follow-up task-chat context without inlining file
  bodies.
- **Board attachments** - drop files directly onto the inspector's Attachments
  section to stage them on a card.
- **Library** - show language and license icons in GitHub repository rows.
- **Library** - render GitHub README images, repo-relative links, owner avatars,
  homepage chips, social previews, and image lightboxes in the inline repo
  reader.

### Changed

- **Evals** - replaced the failures-by-case SVG block with labeled horizontal
  rows, untruncated stat cards, and readable failure counts.
- **Evals runs** - added pass-rate delta chips to run rows and quieted the
  attention queue styling so regressions and improvements are easier to scan.
- **Evals compare** - added verdict chips, guided empty states, and an
  only-changes empty hint to the compare tab.
- **Marketplace** - defaulted non-sensitive Netdata and Nuxt MCP URL fields in
  the setup modal while keeping sensitive API keys unset.
- **Shell** - made Marketplace and Evals split-pane layouts respond to their
  pane width instead of the full viewport.
- **Board attachments** - mark dispatched image attachments as metadata-only
  when the body is intentionally not inlined.

### Fixed

- **Evals** - keyed failure rows by stable case id and preserved non-zero
  proportional bar widths for small failure ratios; moved the new failure bars
  onto the shared eval CSS path.
- **Chat** - stopped `project access denied` 403s when a familiar continues
  chatting from its own workspace in a no-project thread.
- **Chat** - keep unregistered-cwd sessions and explicit **No project**
  selections rootless instead of falling back to the first registered project
  or the opener root.
- **Chat bridge** - preserve richer daemon error details in chat failures.
- **Quick-chat** - show loading placeholders while the familiar roster loads,
  including the tray picker.
- **Board attachments** - prevent browser file-drop navigation even when the
  inspector drop target is disabled or already at its attachment cap.

## [0.0.130] - 2026-07-01

Patch release on top of v0.0.129. Headline: the Changes panel can now commit
your working tree and open a GitHub PR, Kanban cards carry attachments through
the whole dispatch flow, and split panes are resizable.

### Added

- **Changes panel** - commit the working tree and create a GitHub PR straight
  from Cave; a server-generated, shell-safe `cave/<slug>-<stamp>` feature
  branch is derived from the commit message when on a protected/detached HEAD.
- **Board attachments** - carry composer attachments onto Task cards, forward
  them into the dispatched task chat, and add/remove attachments on an existing
  card.
- **Resizable panes** - drag to resize split pages when two or more are opened
  beside the primary page.
- **Quick-chat** - `⌘J` toggles the quick-chat dropdown.
- **Marketplace** - OpenClaw Skills are split into individual cards with
  per-skill config defaults.
- **Projects** - browse for a project folder when creating a new project.
- **Home composer** - attachment count indicator with a clear-all control.
- **Chat** - forward the composer permission mode to `coven run --permission`.

### Fixed

- **Dark theme** - model/familiar picker dropdown options were invisible in the
  dark theme; restored contrast.
- **Changes route (security)** - replaced the polynomial-ReDoS-prone
  `/^-+|-+$/g` trim in the feature-branch slug with anchored linear-time
  trims (CodeQL `js/polynomial-redos`).
- **Automations** - accessible label on the managed Run button; removed dead
  group/subrow markup.

## [0.0.129] - 2026-07-01

Patch release on top of v0.0.128. Headline: Cave clarifies Hermes mode as the
installed Hermes Agent runtime, not a bundled Hermes model selection.

### Fixed

- **Hermes runtime** - treated Hermes as a runtime-managed adapter in the model
  catalog, keeping its picker label in runtime-managed mode and defaulting new
  Hermes familiars to the synthetic `hermes-local` marker instead of a
  Nous/Hermes model id.

## [0.0.128] - 2026-07-01

Patch release on top of v0.0.127. Headline: Cave adds the first-party
OpenClaw Skills marketplace card and changes full-coven group chat to a
parallel roundtable first pass.

### Added

- **Marketplace** - added the OpenClaw Skills card to Cave's Coven collection,
  with regenerated marketplace, Codex, and role-affinity exports so the card is
  visible from the first-party plugin catalog.

### Changed

- **Group chat** - full-coven sends now fan out in parallel with shared roster
  context, so every familiar answers the same human request from its own
  identity and judgment instead of seeing earlier peer replies by default.

## [0.0.127] - 2026-06-30

Patch release on top of v0.0.126. Headline: Cave now has release-ready
travel/mobile resilience, safer group chat relay context, richer review and
automation surfaces, and stronger release CI coverage.

### Added

- **Travel mode** - added travel client state, offline chat/work queues, replay
  on reconnect, local daemon wakeup, hub daemon routing config, and hub executor
  availability so Cave can keep useful work queued across network changes.
- **Group chat** - full-coven sends can now relay sequentially with coven roster
  context so later familiars can see earlier replies in the same round.
- **GitHub review artifacts** - PR reviews and diffs can render/export as
  colored HTML artifacts, including familiar-review output.
- **Dashboard, Evals, Research, and Code** - added the dashboard cockpit and
  predictive signals, eval insights/groups management, the redesigned Research
  composer, and the latest Code surface layout passes.
- **Desktop and automations** - added tray quick chat, the header operational
  summary, all-list automation run actions, cron working-directory picking, and
  a release compatibility banner.

### Fixed

- **Mobile typing** - paused expensive shell polls while composing in inputs,
  debounced composer draft writes, and ignored late stream pushes after
  abort/close so cancelled sends no longer churn `Controller is already closed`
  errors.
- **Group chat safety** - escaped relay transcript text before embedding it in
  prompt context so user/reply text cannot break out of the coven transcript.
- **Navigation and polish** - fixed Evals deep links, desktop automation
  interaction/a11y details, and several release-line UI polish issues.

### Internal

- **Release readiness** - added secret preflight coverage, Tailscale host
  discovery proof, sidecar runtime smoke matrix coverage, and the
  cross-environment aggregate CI check.

## [0.0.126] - 2026-06-28

Patch release on top of v0.0.125. Headline: Cave now ships inline
agent-produced chat attachments, Cave-native eval templates, the latest Code
surface rebuild, and settings/home polish from the release-ready main line.

### Added

- **Chat attachments** - familiar replies can now surface files they produced as
  inline assistant-turn attachments, with allowlist-guarded file reads,
  sanitized names, bounded previews, live streaming, and reload persistence
  (#2035).
- **Evals** - added Cave-native starter eval templates for review risks, tool
  reliability, project context, merge readiness, permission blockers, memory
  hygiene, thread freshness, response confidence, eval-loop recovery, fast
  status updates, and familiar voice (#2049).
- **Code surface** - rebuilt the Code workspace around a Codex-style
  conversation and environment split, following the tab/order cleanup that
  landed on the same release line (#2077, #2081, #2084).
- **Settings** - section pages now include a compact overview header with icons
  and highlights so long settings areas are easier to scan (#2088).
- **Design specs** - added analysis-grade Evals and world-class Dashboard design
  specs for the next polish pass (#2087).

### Fixed

- **Home digest** - touch and coarse-pointer devices now use manual momentum
  scrolling instead of an unpausable auto-marquee (#2086).

## [0.0.124] - 2026-06-28

Patch release on top of v0.0.123. Headline: flow executions now show real
startup movement instead of appearing stuck at Start.

### Fixed

- **Flows** - new manual runs now mark local trigger/input steps complete
  immediately and show the first executable node as running while the daemon
  session starts producing step markers.
- **Flows** - live run polling now falls back to the daemon event stream when
  Cave/OpenClaw transcripts have not been persisted yet, so canvas and sidebar
  progress can advance during the startup window.

### Changed

- **Polling** - always-on API polls use the visibility gate path from the latest
  mainline performance work.

## [0.0.123] - 2026-06-28

Patch release on top of v0.0.122. Headline: desktop updates and the app header
are easier to use across macOS, Windows, and Linux.

### Fixed

- **Updates** - when the native desktop updater cannot finish installing, the
  Download action now resolves the direct platform installer through release
  metadata instead of dropping users on the generic releases page.
- **Desktop header** - the app header stays contained on one row and keeps
  controls clickable in macOS titlebar mode while shrinking cleanly on
  macOS, Windows, and Linux.

## [0.0.122] - 2026-06-28

Patch release on top of v0.0.121. Headline: chat generation state now survives
leaving and returning to an in-flight conversation.

### Fixed

- **Chat** - navigating away from a chat while a response is streaming no
  longer loses the live generation UI. Returning to the session restores the
  pending assistant turn, active branch, busy state, and cancel controller while
  continuing to follow stream updates through completion.

## [0.0.121] - 2026-06-28

Patch release on top of v0.0.120. Headline: flow required-input handling,
familiar eval loops, Windows runtime discovery, chat, onboarding, and
group-chat follow-ups on the mobile-mode release line.

### Added

- **Flow** - added explicit required flow inputs, a reusable required-input
  dialog, server-side required-input rejection, required badges, Deep Research
  topic prompting, vertical layout / port-flip controls, and a labelled
  Active/Inactive toolbar toggle (#1983, #1994, #1997, #1998).
- **Familiar evals** - added eval-loop control-plane wiring plus a dedicated
  eval surface for running and reviewing familiar evals (#1999, #2000).
- **Vault** - added encrypted local secrets support for Cave-managed secret
  storage (#1987).
- **Chat / Code** - added the two-way Chat / Code toggle and merged projects
  into the Chat surface (#1980).
- **Group chat** - added next-path suggestion chips for click-to-send follow-up
  prompts (#1979).

### Fixed

- **Windows runtime discovery** - Windows now launches `coven.cmd` npm shims
  through Node for prompt-bearing spawn paths, fixing `spawn EINVAL` failures in
  `/api/harnesses` and onboarding runtime discovery (#1992, closes #1993).
- **Flow** - missing required inputs now prompt from the run path, onboarding
  prompt actions align with the textarea, and Tidy / orientation re-layout
  applies in place on the canvas (#1986, #1995, #1996).
- **Onboarding** - Option A and runtime install lists now show honest empty
  states and re-probe PATH when adapter discovery misses locally installed
  runtimes (#1985, #1988).
- **Chat** - newer local session status wins over stale status, mermaid syntax
  errors no longer render as hard failures, and lightbox / expand overlays mount
  through `document.body` (#1978, #1981, #1984).
- **Group chat** - next-paths metadata is stripped from Coven replies before
  display (#1976).
- **OpenClaw integration** - launch paths now use the current session id flag
  when forwarding into OpenClaw (#1989).

### Changed

- **Cave follow-ups** - bundled small follow-up fixes on the v0.0.120 line so
  the release matches the current mainline UI and flow behavior (#1982).

## [0.0.120] - 2026-06-27

Patch release on top of v0.0.119. Headline: native mobile mode can keep the
desktop Cave reachable from phone clients without requiring terminal commands.

### Added

- **Mobile handoff** - added a default-on mobile mode toggle that reconciles the
  native Tailscale Serve host, persists the workspace preference, surfaces
  non-fatal setup warnings, and lets users copy the native host or reset Serve
  from the connect modal.

## [0.0.119] - 2026-06-25

Patch release on top of v0.0.118. Headline: the macOS desktop shell's topmost
bar is draggable again while keeping all toolbar controls clickable.

### Fixed

- **Desktop shell** - macOS Tauri titlebar mode now marks the rendered top-bar
  wrappers as drag regions, not only the outer shell row, so users can drag the
  window from the topmost Cave bar while buttons, inputs, links, and other
  controls remain `no-drag` (#1972).

## [0.0.118] - 2026-06-25

Patch release on top of v0.0.117. Headline: the current production line now
matches the `main` and `kitty/main-mirror` tree while shipping the latest chat,
flow, Feed, board-chat, screenshot, and home-composer polish.

### Added

- **Chat** - the Convo / Projects / Code mode switch now persists across reloads
  and its control is slimmed down to text-only for a quieter production surface
  (#1961, #1964).
- **Chat / Mobile** - Code mode is hidden from the compact mobile chat switch
  while staying available on larger desktop/tablet layouts (#1968).
- **Flow** - added the latest flow layout-direction controls and iOS Feed wiring
  from the production main line (#1962).
- **Docs screenshots** - added familiar Feed tab captures for desktop and iOS
  so release documentation reflects the shipped interface (#1966).

### Fixed

- **Tauri permissions** - allowed loopback browser event listeners in the
  desktop permission set so the native shell can receive local browser events.
- **Board chat** - task chats now start in the assigned project context instead
  of drifting into the wrong workspace.
- **Home composer** - removed the keyboard-hint UI and CSS from the home
  composer to keep the mobile production surface tighter.

## [0.0.117] - 2026-06-25

Patch release on top of v0.0.116. Headline: Cave no longer ships a built-in
familiar roster. Runtime familiar discovery, library routing, workflows, and
chat/document helpers now resolve familiar identities from user configuration
instead of hard-coded OpenCoven names (#1957).

### Changed

- **Familiar roster** - removed built-in familiar ids from runtime fallbacks and
  moved library workspace resolution to `~/.coven/familiars.toml`, preserving
  per-familiar research roots without assuming any default names (#1957).
- **Library** - document lookup, document chat, and rename/move paths now choose
  the configured familiar workspace by request, absolute path, or first
  configured workspace instead of a static research root (#1957).
- **Workflows** - bundled workflow templates use role-oriented ids and metadata
  rather than OpenCoven familiar names (#1957).

### Fixed

- **Regression coverage** - added source guards and API contract coverage so
  hard-coded runtime familiar rosters do not quietly return (#1957).

## [0.0.116] - 2026-06-25

Patch release on top of v0.0.115. Headline: flows get a proper production-publish
lane plus n8n-parity polish (per-node settings, duplicate node, display-note
toggle, tidy layout, expression-vs-fixed param descriptions) (#1947). Familiar
analytics finished wiring up across the stack (#1944, #1945, #1946).

### Added

- **Flow / Publish** - the flow toolbar now has a Publish action that snapshots
  the current draft into the production version, so webhook and schedule runs
  no longer pick up unsaved edits. Republish to roll the production snapshot
  forward; Unpublish to clear it (#1947).
- **Flow / Node settings** - n8n-style per-node options: `alwaysOutputData`,
  `executeOnce`, `retryOnFail` with `maxTries`, and `onError`
  (`stop` | `continue` | `continueErrorOutput`) (#1947).
- **Flow / Duplicate node** - one-click duplicate in the node detail view
  (positions, name, params, settings all cloned) (#1947).
- **Flow / Display note in flow** - per-node toggle that surfaces the node's
  notes as a subtitle on the canvas (#1947).
- **Flow / Tidy layout** - column-based auto-layout helper that respects
  sticky-note nodes (#1947).
- **Familiar analytics** - end-to-end wiring for the self-report backend,
  thread-signal card, chat-reflect trigger, and the analytics surface itself
  (#1944, #1945, #1946).

### Changed

- **Flow / Compile descriptions** - parameter logs now split expression-bound
  and fixed values so on-the-fly substitutions are easier to read at a glance
  (#1947).
- **Flow store** - `coerceFlowNodes` normalizes legacy node payloads and the
  new `disabled` / `displayNote` / `settings` / `published` fields on every
  write, so older flows upgrade cleanly without manual migration (#1947).

## [0.0.115] - 2026-06-25

Patch release on top of v0.0.114: a harness-identity fix that unblocks native
chat for aliased runtimes, onboarding/installer clarity, and reliability polish
for the terminal and chat surfaces.

### Added

- **Browser** - the tab rail opens (pinned) by default and remembers an
  explicit auto-hide choice across sessions (#1916).
- **Chat** - an inline debug/error strip below the chat surfaces the latest
  failure (#1920).

### Fixed

- **Harness identity** - canonicalize harness ids (e.g. `hermes-agent` →
  `hermes`) so an aliased familiar no longer triggers a spurious chat-bridge
  403, and dedup duplicate/aliased runtime rows in the capabilities view
  (#1921).
- **Terminal** - no longer hangs on "Starting terminal…"; added a watchdog,
  retry, and fail-visible state (#1919).
- **Onboarding** - require Coven Code at startup and make "install both" work
  (#1924); clarify the "Create your familiar" step and re-indent its config
  form (#1915, #1922).
- **Updater** - the About-page Download fetches a direct installer instead of
  the release page (#1923).
- **Familiar Studio** - "Open Brain Studio" now actually opens the Brain
  surface (#1917).
- **Home** - clear the daemon-offline banner immediately after the user starts
  the daemon (#1914).

### Changed

- Hide the add-a-new-harness/runtime panel in the capabilities view for now
  (#1918).

## [0.0.114] - 2026-06-25

Patch release on top of v0.0.113 with the next iOS utility sweep, a broader
marketplace catalog, and desktop polish for Home, Tasks, GitHub, and Flow.

### Added

- **iOS controls and notifications** - Control Center controls for reminders
  and running tasks (#1906), on-device notifications for upcoming reminders
  (#1892), and Lock Screen / StandBy widgets for the next reminder (#1897).
- **Marketplace catalog expansion** - 44 MCP plugins across 13 categories
  (#1902).
- **Home surface** - Codex-style composer + connector cards (#1907) and a
  "Jump back in" recent-chats strip (#1910).
- **Board table** - spreadsheet-grade task table striping, reorder, resize, and
  autofit (#1905).
- **GitHub view** - free-text search over the activity list (#1900).
- **Group chat targeting** - @-tag familiars to target a message at a subset of
  the coven (#1896).
- **Flow** - template gallery (#1893).

### Changed

- Removed the legacy Workflows page (#1898).
- Added `usePausablePoll` and adopted the canonical reduced-motion hook
  (#1909).

### Fixed

- **iOS navigation** - remove the empty nav-bar band atop Developer GitHub and
  Library (#1912).
- **Shell and sidebar** - align top sidepanel toggles to nav-rail button width
  (#1904) and size the New-chat icon to match the collapsed rail (#1911).
- **Chat progress** - make truncated progress-step details expandable (#1903).
- **Canvas accessibility** - fullscreen dialog, tab arrow navigation, and
  selected `aria-current` (#1895).
- **Journal accessibility** - save with Cmd/Ctrl+Enter and restore focus on exit
  (#1891).
- **Schedules** - per-row quick actions for run-now and pause/resume (#1894).
- **Eval loop panel** - guard undefined iterations (#1908).

## [0.0.113] - 2026-06-24

Another huge release: **120 PRs** building on the v0.0.112 push. The iOS app gains a real **Calendar tab**, **Library/Bookmarks**, **Journal**, **Live Activities**, **Siri Shortcuts / App Intents**, **iPad split-view** across Chats/Tasks/Developer, a **Board (kanban) view**, and an actionable **home-screen widget**. The desktop gets a new visual **Flow editor** (n8n-style), a **Marketplace** surface with credential & config collection, a redesigned **Code Projects explorer**, broad **undo** support, and a wide **accessibility sweep**. Group Chat (broadcast one prompt to many familiars) ships as the foundation for the v1 group-chat work tracked in opencoven/coven#258.

### Added

#### iOS — new surfaces
- **Calendar tab** — agenda of reminders + task due dates with per-familiar colour coding and a legend (#1844, #1885), and a calendar event-detail backdrop + outside-click dismiss with friendly errors (#1883).
- **Library** — saved reading + bookmarks (read-only) (#1863).
- **Journal** — daily reflections, read-only (#1857).
- **Board** — kanban view for Tasks with status / priority / familiar filters (#1854).
- **Live Activity** — running task surfaces on Lock Screen + Dynamic Island (#1877).
- **Siri Shortcuts / App Intents** — new reminder, "what's running" (#1880).
- **Home-screen widget** — "Up Next" widget with next reminder + task counts (#1884), then interactive buttons + deep links so widget Complete / Snooze taps roundtrip to the inbox endpoints (#1887).

#### iOS — chat, tasks, navigation
- **Quick actions on the Chats familiar rows** (#1782).
- **@-mention familiars in group chats** (#1785).
- **Group Chat ("coven")** — broadcast one prompt to many familiars (#1860).
- **Subtle haptic when a familiar's reply finishes** (#1789).
- **Failed chat replies get a visible Retry button** (#1783).
- **Rich link previews in chat** (#1798).
- **Delete confirmation, haptics, and revert feedback** in destructive actions (#1848).
- **Leading swipe to complete tasks** (#1882).
- **Accessibility pass** — VoiceOver, Dynamic Type, reduce-motion across the iOS app (#1851).
- **Removed** the Read tab in favor of the new Library surface (#1797).

#### iOS — connection & developer
- **Auto-recover the desktop connection** with launch backoff + foreground refresh (#1808).
- **Surface silent failures in the Developer surface** (#1809).
- **Paste + cleanup** on the connection setup screen (#1813).
- **iPad split-view** for Tasks (#1796), Chats (#1802), and Developer → GitHub (#1805).

#### Desktop — Flow (visual workflow editor)
- **n8n-style visual workflow automation editor** (#018ada5b — direct push, no PR number).
- **Drag-to-connect a new node + mid-edge "+" insertion** (#1861).
- **Live per-node execution overlay** (#1850).
- **Inline-edit and resize sticky notes on the canvas** (#1869).
- **Input/output data panels in the node detail view** (#1875).

#### Desktop — Code
- **Fluid-glass Projects explorer** with frosted active pill, identity tiles, sticky-header fix (#1832, #1838).
- **Projects explorer navigation** — filter, keyboard roving, monogram tiles (#1841); **right-click context menu** (#1847); **drag-to-reorder + pin favorites** (#1852).
- **Skeleton for the session changes list** instead of bare text (#1812).
- **Retry on file-preview error state** (#1826).

#### Desktop — Marketplace, Roles, Settings
- **Marketplace tab in the Roles hub** (#1823).
- **Credential & config collection** for needs-setup plugins (#1839).
- **Remote MCP endpoint validation** — Test connection button (#1867).
- **Live GitHub token validation** (#1849).
- **Permissions tab** for per-familiar project visibility; hide Submissions (#1828).
- **Searchable settings** — jump to any control across sections (#1830).
- **Skip-to-content link in the app shell** (#1780).

#### Desktop — Board & Calls
- **Per-column WIP limits** (#1864) and **overdue card highlighting + per-column quick-add composer** (#1859).
- **Extend bulk-edit** with set-priority and add-label (#1879).
- **Guard board-inspector loaders, step checkbox a11y, reduced motion** (#1876); **re-sync on window focus** so the desktop app isn't stale after external actions (#1873).
- **Undo for task delete** (deferred, no native confirm) (#1804).
- **Skeleton for the coven floor** instead of bare "Loading…" text (#1819); then the **Calls surface (floor + delegations) was removed entirely** (#1858).

#### Desktop — Chat, Command Palette, Command Center
- **Fuzzy search + score ranking** in the command palette (#1833).
- **Familiar growth & performance page** — derive signals (#99f283de), components (#e3672a3c), route (#f1809c97), styles (#ee844e8c), page composition (#dcc9c0f2), CI wiring (#850f59b1) — merged via PR #1787.
- **Skeleton-first restores** of chat history with message-shaped placeholders (#1831).
- **In-app ConfirmDialog primitive** replaces native `window.confirm` (#1810).
- **Kanban-shaped loading skeleton** instead of a spinner (#1811).
- **No-matches state** in the familiar switcher (#1837).
- **Surface usage plan consumption** in chat (#e6fb8b9e).
- **Coven workspace tabs** — rename DocsPane to CovenPane, add Coven tabs (#51c945c9).
- **YouTube collapsed-state polish** — mini bar + peek strip (#1821).

#### Calendar (web)
- **Keyboard reschedule for time-grid events** (Alt+↑/↓) (#1794).

#### Undo
- **Deferred undo for journal, vault & automations deletes** (#1814).
- **⌘Z undoes the last delete** across all undo surfaces (#1827).

#### Marketplace catalog
- **Restore catalog.json source-of-truth** (#1818).
- **OpenCoven runtime + harness submissions** (#a32fb286).

### Changed

- **Calls surface removed.** The floor + delegations surface was deleted (#1858) after the v0.0.112 introduction; the v1 server-side group-chat primitive replaces the use case it tried to address (see opencoven/coven#258).
- **Read tab removed on iOS** in favor of the new Library surface (#1797).
- **Project API** — allow human browse of familiar workspaces with id attached (#1824).

### Fixed

#### Accessibility
- **WCAG contrast** — accent-filled buttons paired with semantic foregrounds (#1793); priority pill text darkened in light mode (#1799); solid nav count-badge fill (#1791); bulk-select checkmark glyph paired with accent foreground (#1801).
- **Combobox & tablist ARIA** — /model picker combobox (#1842, #1845); calls view tablist + hidden-pause polling + honest trace counts (#1853); Roles tab bar as accessible tablist + labeled search (#1817); command-palette combobox + guard corpus loader + scroll active row (#1881); inbox feed section headings + selected-row aria-current (#1866); active conversation row aria-current (#1840); board card-stack row actions keyboard-accessible (#1878).
- **Voice + status** — announce voice-call status with friendly error messages (#1862); announce the /model picker (#1845).
- **Coven floor** — hidden-pause polling, load guard, reduced motion (#1856).
- **Reduced motion** honored for JS-driven smooth scrolling (#1784).
- **Icon-only buttons** — accessible names on close buttons (#1846).
- **Docs surface** — don't iframe un-embeddable tabs + complete the tablist a11y (#1829).
- **Title tooltips for truncated text** — calendar chips (#1786), library doc filenames (#1792), dashboard cockpit rows (#1795), workflow & step labels (#1800), code-block filenames (#1803), journal labels (#1806).

#### Stability & races
- **Stable DndContext ids** to stop dashboard hydration mismatch (#1790).
- **Day-fetch race guard** + keyboard/chronological day nav in Journal (#1788).
- **Guard async setState** after Canvas tab unmounts (#1825); workflows runs/layout fetch races + setState-after-unmount (#1820); schedules polling paused while hidden + guard async fetches (#1834); inspector memory loaders guarded against stale/post-unmount responses (#1870).
- **Daemon offline banner** stays sticky against a flapping daemon (#1874).
- **Onboarding** — Maintenance prune Check now offers Delete on daemon-native prune (#1865); detect `coven` CLI / `coven-code` install + version status (#1868).

#### Chat & familiars
- **Chat prefers opened-session familiar** (#661d85ab).
- **Empty-state hover affordance polish** (#c0fb3a1e).

#### GitHub & misc UI
- **GitHub compact header controls aligned + standardized heights** (#a2e3e734, #1781).
- **RelativeTime for PR comment timestamps** (#1807).
- **Suppress the native search-cancel glyph** on the shared SearchInput (#1835).

### Documentation

- **Project README** added (#1886).
- **Marketplace docs** — document configuration/validation + deferred work (#1872).
- **OpenMeow references scrubbed** (#1855) — aligns with opencoven/coven#256.

### Testing

- **Vitest** — ignore generated build artifacts (#358fe2f3); align local test discovery (#94728dd7); drop TSX-only render tests (#f38c5656).
- **Sessions/prune** — regression guard for dry-run wouldPrune contract (#1871).


A huge release across the board: 168 PRs that bring the **iOS app to feature parity** with the desktop on chat, tasks, library, reminders, GitHub, and theming; promote the **Gantt** to a real planning surface; layer **bulk actions + undo toasts** across every list-driven view; and add a **familiar `Calls` surface** that visualizes delegation activity.

_Note: this entry also folds in roughly two dozen UI/automations/permissions PRs that shipped in v0.0.109–0.0.111 without their own CHANGELOG entries (#1574–#1592 range). Future releases should keep `[Unreleased]` up to date as work lands._

### Added

#### iOS — chat
- **Liquid-glass theming arc** — theme-tinted glass chrome across chats first (#1770), then sheets/cards/connection surface (#1776), overlays/menus/tab chrome (#1772), sheets (#1757), inset-grouped lists (#1752), detail & settings screens (#1771), and a second depth pass that replaces remaining system fills (#1777).
- **Desktop theme follow-through** — the iOS app consumes `/api/theme` so the chrome matches the desktop (#1720); the desktop theme background shows behind the chat transcript (#1760) and through browse lists (#1746); inline-code in chat picks up the desktop theme colour (#1769).
- **Appearance controls** — "System" option that follows the device (#1756), independent light/dark override (#1747), and per-token theme overrides with a manual Resync to phone button (#1754).
- **Chat thread management** — pin (#1665), archive (#1663), mute notifications (#1673), rename (#1655), duplicate (#1682), browse by familiar (#1636), reorder familiars in the Chats tab (#1662), search threads from the Chats tab (#1669), search messages within a thread (#1715), persist unsent drafts per thread (#1697), bulk-delete threads in a familiar's chat list, bulk-select to archive or delete many (#1694), and date dividers between messages from different days (#1721).
- **Chat composer & display** — swipe-to-reply quotes a message into the composer (#1775); chat empty state + surface pull-to-refresh errors (#1736); chat message timestamps and editable task title & dates (#1708); expand & copy code blocks (#1640); attach multiple images plus hardware-keyboard shortcuts (#1699); landscape support in chat with tap-to-enlarge tables/diagrams/images (#1615); live streaming markdown, user-message markdown, native image zoom, and Reader upgrades (#1658); full-screen Reader for assistant replies and task notes (#1641, #1633); thread-list swipe parity, delete confirmation, return-to-send (#1660); native `/model` slash command to switch the chat model on the phone (#1744); per-chat model control — see and change a chat's model (#1730); familiar presence dots on the chat list & header (#1773); unread activity badges on the chat list (#1779).
- **Chat import/export** — export a thread as Markdown (#1678), export all chats as a `.zip` (#1685), export selected threads as a `.zip` from bulk-select (#1695), and import a thread from Markdown (#1680).

#### iOS — tasks, reminders, library, GitHub
- **Reminders** — Reminders view with bulk-select delete (#1728), reminder actions (done, snooze, dismiss) (#1737), bulk actions on selected reminders (#1740), select reminders by status in bulk-select (#1743).
- **Tasks** — manage status, priority, steps, and delete from the Tasks tab (#1635); group Tasks by Status/Project/Familiar/Priority (#1630); edit task notes from the detail view (#1651) with markdown rendering and full-screen Reader (#1638); add, remove & reorder checklist steps in a task (#1714); search tasks within their familiar scope (#1661); search the GitHub tab and sort tasks within groups (#1677).
- **Library** — Read sort, chat pull-to-refresh, terminal/icon a11y labels (#1679); add a "Chat with this doc" tab to the library viewer; bulk-select for the Bookmarks & GitHub lists (#1723); bulk-select to remove many reading items at once (#1705).
- **GitHub on iOS** — drop familiar-tagging from GitHub comments and add file attachments (#1648).
- **Settings & navigation** — restore Settings as a tab with About/version, disconnect confirm, and step haptics (#1687); Dynamic Type for toast/menu text plus Reduce Motion gating (#1774); remove the Canvas bottom tab and open on Chats (#1644); polish code browser file tree.

#### Desktop — board & gantt
- **Gantt evolution** — Day/Week/Month zoom plus Jump to Today (#1631); "group by Task" with step bars and click-to-focus groups (#1626); Familiar grouping in the All-familiars scope (#1628); show owner in task-grouped Gantt and colour bars by familiar (#1666); flush-left timeline plus drop redundant Owner column in by-familiar view (#1664); remove the Owner column from Gantt views (#1671); familiar colour legend in the by-familiar Gantt (#1670); make unscheduled tasks an expandable, schedulable tray (#1632); widen the task column so titles aren't truncated (#1675); drag bar edges to resize task start/end dates (#1624); clearer, narrower timeline-zoom control (#1683); auto-center on today, quick-schedule presets, status filter (#1690); month band, weekend shading & today-column highlight (#1702); overdue bar markers plus drag a tray task onto the timeline (#1719); re-center on zoom change plus keyboard reschedule (#1732); pinch / ⌘-scroll to zoom the timeline continuously (#1778); undo a gantt drag-reschedule (#1727).
- **Board** — bulk-select cards to move/assign/delete many at once (#1659).

#### Desktop — chat, projects, library, workflows
- **Bulk actions + undo toasts** — bulk-select to delete chats in a project card (#1602); bulk-select to delete/archive many chats (#1694); make chat & project bulk-delete undoable (#1759); make library bulk-delete undoable (#1735); bulk triage in the dashboard action inbox (#1742); a delete button on the chat session header (#1603).
- **Projects** — right-click context menus on projects and sessions (#1706); type-ahead jump in the keyboard navigation (#1724); "Move to project" submenu in the session context menu (#1729); rich session rows + project stat line (#1696); keyboard navigation + touch-visible row actions (#1700); motion polish + cross-project-move undo toast (#1712); persist expand/collapse and add a list-density toggle (#1689); virtualize session rows via `content-visibility` (#1718).
- **Chat — model & branching** — move model selection into the `/model` slash command (#1739); inline conversation branching on web (#1645); rename the Familiars tab to Chat, and scope sessions/projects by familiar grants (#1657).
- **Library** — "Chat with this doc" tab in the library viewer.
- **Workflows** — attach skills, MCP servers & API calls with inherited permissions (#1681); live per-step run progress with per-step debug detail (#1684).
- **Automations** — familiar scope (persisted field, row avatars, multi-select filter) (#1577); create + delete + skill picker (#1580); run-now plus run history (#1583); expandable run logs plus outcome-colored last-run badge (#1584); live-poll runs while in flight, with a visible cmd-click filter hint (#1590).

#### Desktop — calls, calendar, palette, dashboard, docs
- **Familiar Calls surface** — wire the Calls (familiar activity + delegation traces) surface into navigation (#1711); ⌘⇧C shortcut and active-call badge for the Calls surface (#1716); 3D trace-graph and coven calls visualization (#1701); render-virtualize for performance.
- **Calendar** — click an empty month day to pre-fill the add form (#1764); bug-fixes + polish for all-day overflow, month sorting, live now-line (#1751).
- **Palette** — switch board view + recency-sort tasks (#1710).
- **Familiars scope** — multiselect familiar scope in the top-bar avatar strip (#1625); extend multiselect scope to Calendar + Journal (#1627).
- **Docs** — add an in-app Docs surface embedding `docs.opencoven.ai` (#1595).
- **Schedules** — bulk-select reminders.

#### Cross-cutting UI
- **Time & density** — compact/verbose timestamp density preference (#1586); subscribe timestamp surfaces to density pref so the toggle applies live (#1591, #1596, #1597, #1599); unify category-B bare-compact timestamps onto canonical `relativeTime` (#1601); exact-time hover tooltips on bare relative timestamps (#1607, #1608).
- **Empty states & skeletons** — actionable empty states for GitHub + Workflows surfaces (#1604); skeleton loading states on 5 more surfaces (#1610); adopt skeleton/empty/relative-time conventions in 3 stragglers (#1672).
- **Shortcuts** — complete the keyboard-shortcut catalog (Terminal + Browser groups) (#1605); cover the keyboard-shortcuts sheet (⌘/ and ?) in e2e tests (#1619).
- **Menu-bar** — show all familiars in the top bar, not just 6 (#1588); standardize top-bar icons + buttons smaller/on-token (#1592); "Avatars shown" appearance setting; default to pinned-only (#1598).
- **Reports** — shared hover-able sparkline on cockpit + daily-report metrics (#1585).
- **Tooltips** — hover tooltips on truncated names/titles so full text is recoverable (#1612).

### Changed
- **OpenClaw bridge** — defined the bridge contract (#1693) and extracted bridge helpers (#1614) to firm up the boundary between Cave and OpenClaw.
- **Projects view** — split the monolith into a component tree (#1734).
- **Terminal** — dedup xterm setup + touch Find + a11y label (#1763).
- **Stores** — DRY four hand-rolled atomic writes onto `writeJsonAtomic` (#1621).
- **Security guard** — centralize the duplicated `isLocalOrigin` route guard (#1618).

### Fixed
- **Accessibility** — keyboard + screen-reader semantics across library, browser, calendar, workflows (#1767); arrow-key navigation for library list rows (browse mode) and drop `as any` casts (#1768); VoiceOver labels for status icons in chat / reading / tasks (#1753); GitHub keyboard row nav + memoization + polling pause (#1765); file-tree a11y + resilient loading on project-tree (#1761); markdown renders inline formatting inside table cells (#1629).
- **Theme** — make the theme-store path env-overridable (`COVEN_THEME_PATH`) (#1758); publish `/api/theme` tokens as resolved sRGB hex (#1733); rasterise theme tokens to sRGB hex (fixes ineffective #1733) (#1738).
- **iOS** — readable chat markdown in light mode (#1741); centre content on iPad instead of stretching edge-to-edge (#1762); render assistant replies — never blank when markdown bundle missing (#1639); hide desktop slash commands; drop the non-interactive GitHub user chip from the Developer tab (#1766); remove duplicate `notesHeight`/`notesReader` `@State` in `TaskDetailView` (#1643); streamline mobile chat and maintenance.
- **Chat** — order chat list by last message, not last viewed (#1642); branch the first exchange and validate switch target (#1647); remove the redundant delete from the overflow menu (#1606); allow familiars to roam granted projects; style voice call overlay.
- **Calendar/Gantt/Board** — gantt cleanup: dead CSS, coalesced keyboard reschedule, task-mode steps, memo (#1748); standardize tasks toolbar control heights to 30px (#1755); gantt legend labels match the board's actual statuses (#1668); standardize gantt toolbar control styling (#1709); enlarge the gantt status legend dots (#1713).
- **Permissions** — let the local human browse projects without a familiar (#1676); let the human browse familiar workspaces (project-tree 403) (#1698); bootstrap legacy familiar project grants (#1589); add project permission checks and grant APIs; guard mobile project API access; guard library chat document reads.
- **Stores** — atomic JSON writes for the inbox/config/runs/prefs file stores (#1617).
- **Familiar Studio** — clarify inherited runtimes; stop truncating the section-tab labels (#1703).
- **Capabilities** — backfill harnesses the daemon aggregate omits (#1616).
- **API** — add API contract entry for `/library/chat` (un-red main) (#1692).
- **Cave-projects** — eliminate ReDoS in `normalizeRoot` (CodeQL #65) (#1686).
- **Copy** — route GitHub copy buttons through context-safe `copyText` and add `useCopy` hook (#1611).
- **Menu-bar** — size top-bar action icons to the text (1.15em, not 22px) (#1578); bump top-bar action + search icons to 1.35em (#1579); match top-bar icons to the sidepanel toggle size (#1581); standardize top-chrome icons to the avatar size (16px) (#1582); shrink top-bar avatar tiles to match the compact chrome (#1594); size avatar tiles to match the action-button height (28px) (#1600).
- **Settings** — remove duplicate timestamp-density toggle (#1587).
- **Projects** — context-menu focus-return + dedup the undo toast (#1745).

### Performance
- **Calls** — remove the Three.js 3D delegation graph (drop the `three` dep) (#1722).
- **Projects** — render-virtualize session rows via `content-visibility` (#1718).

### Refactor / Chore
- **Dead code removal** — 8 dead component files (#1620); orphaned `CovenFloor` + `FamiliarStatusCard` (#1609); the dead `ShellNav*` cluster + unused `SkeletonGrid` export (#1622); the dead pre-cockpit dashboard cluster (#1623); rip out dormant Canvas feature on iOS.
- **UI underline tabs** — migrate Familiar Studio drawer + Inspector tab rows onto shared underline Tabs (#1574).
- **UI focus-return + CSS-driven undo toast** — deeper context-menu focus-return (#1750).
- **Docs** — define workflow-first branch hygiene (#1646).
- **Tests** — guard desktop theme adoption on iOS (#1725); allow notes task updates on iOS.

## [0.0.108] - 2026-06-20

Patch release: onboarding daemon readiness, Library loading polish, and GitHub detail-panel scroll containment.

### Changed
- **Onboarding** — Cave now starts the daemon before familiar creation, keeps the familiar creation actions disabled until daemon health is ready, and surfaces daemon start diagnostics such as exit code, stderr, and stdout.
- **Library** — the Library rail can load collection metadata without reading document bodies, defers full document loading until the Docs section is active, and avoids stale async updates when closing quick-open or switching previews.

### Fixed
- **Library** — the right list panel now expands only from the pinned/toggled state instead of hover timers.
- **GitHub** — the issue/PR detail panel is contained to the workspace height so hover/async content does not make the parent scroll.

## [0.0.107] - 2026-06-19

Patch release: a desktop UX pass on the left sidebar and the top menu bar, plus an in-panel YouTube viewer.

### Added
- **Companion-rail video tab** — a "Video" toggle in the right companion panel splits it into a resizable bottom pane with a YouTube viewer; the editable bar accepts any YouTube link, video ID, or playlist (#1025).

### Changed
- **Left sidebar declutter** — the familiar scope switcher and "New session" button moved out of the left panel (they already live in the desktop top menu bar and the mobile top bar), so the nav flows directly under the wordmark and sits flush against the panel edge (#1029). The panel now opens at the same width as the right companion panel, and the WORK/KNOWLEDGE/TOOLS section labels are widened (#1032).

### Fixed
- **Top search bar** — the desktop menu-bar search no longer clips or strands its icon under screen magnification: the bar grows to fit and the search icon scales with the text and stays centered (#1034).

## [0.0.105] - 2026-06-18

A coding-experience arc: turning the Projects/Code surfaces into a Codex/Cursor-class workspace where familiars (the coding agents) sit beside the files, editor, terminal, and change review.

### Added
- **Code workspace** — a top-level Code surface (⌘0) that places a familiar chat beside the project's file tree, editable preview, terminal, search, and git change review in one resizable IDE-like layout, with a Chat/Code switcher on mobile (#939, #944).
- **Project search** — ripgrep-backed search across the open project with a regex toggle and results grouped by file; clicking a match opens the file, scrolled to and briefly highlighting the matched line (#932, #934).
- **In-app editing** — files can be edited in place and saved through a CodeMirror editor with syntax highlighting and line numbers themed to the app palette; `Cmd/Ctrl+S` saves, `Esc` cancels (#937, #942, #943). `.mjs`/`.cjs` files are previewable and editable (#950).
- **Change review** — a Files/Changes toggle surfaces the project's git diff, per-file revert, and checkpoints right beside the files (#940).
- **Chat ↔ editor links** — file paths in a familiar's tool calls (#941) and in its prose, e.g. `src/foo.ts:42` (#946), are clickable and open the file in the Code workspace at the referenced line.

### Fixed
- **Code workspace** — the unified surface now shows the coding panes (file tree, editor, search, change review), not just a terminal (#949).

## [0.0.104] - 2026-06-18

Patch release: the Workflow Studio's **Play** now actually runs a workflow, plus terminal-split survival, a fullscreen diagram viewer, and assorted UI polish.

### Added
- **Workflows** — pressing Play now executes the workflow: when the daemon has no native engine, Cave compiles the manifest into an orchestration prompt and spawns a real agent session that carries out the plan, recorded in run history with an "Open in Chat" jump to the live thread. Only a fully offline daemon falls back to the honest plan preview (#923).
- **Workflows** — the spawned run session is now attributed to its familiar on the daemon, not just in Cave's local state (#928).
- **Chat** — fullscreen zoom/pan viewer for Mermaid diagrams (#922).
- **Theme** — Ember retheme into Vintage Paper (tweakcn port) (#929).

### Fixed
- **Terminal** — splitting a pane no longer tears down the shell into a dead/blank pane; panes can also be dragged by their title bar to reorganize the layout (#925).
- **Sidebar** — Recent Activity items now navigate to their session (#924); familiars fall back to their glyph when an avatar image fails to load (#921).
- **Chat & roles** — full-width role rows and a tighter session rail (#926), with the stray left whitespace removed from the session list (#927).
- **Mobile** — the handoff flow produces a working invite link/QR even when Tailscale Serve fails to start (#931).

## [0.0.103] - 2026-06-18

Patch release: respect persisted home navigation state after the v0.0.102 chat-width release.

### Fixed
- **Shell** — reverted the forced home-screen nav reopen so fresh desktop launches still default open, but a deliberate collapsed nav stays collapsed across reloads and app launches (#920).
- **Windows OpenClaw bridge** — Cave now resolves and launches npm `openclaw.cmd` shims safely, so OpenClaw-backed familiars such as TARS do not require a hand-built `openclaw.exe`.
- **OpenCoven tools update** — updating the coven CLI from Cave now best-effort stops the running daemon first and surfaces clearer guidance if Windows still has `coven.exe` locked.

## [0.0.102] - 2026-06-18

Patch release: full-width chat composition polish and a desktop launch affordance after 0.0.101.

### Fixed
- **Chat** — conversation threads now span the full chat pane, and user message bubbles use the wider desktop pane while preserving right-aligned turn ownership (#917, #918).
- **Shell** — desktop launches on the home screen now reopen the left nav even if a previous session persisted it collapsed (#919).

## [0.0.101] - 2026-06-18

Patch release: mobile handoff diagnostics, model catalog cleanup, context-meter wiring, board and role polish, and the pending familiar-avatar/git-hooks/workflow WIP after 0.0.100.

### Added
- **Chat** — context meter in the header is wired to model selection at send time (#911).
- **Board** — added a Clear done action for completed cards (#910).
- **Familiars** — landed the pending familiar-avatar route/test work alongside git hook coverage and workflow updates (#912).
- **Mobile handoff** — invite links are shown directly in the modal, and dev-mode failures now explain that plain `pnpm dev` lacks the signed access token and point developers to `pnpm mobile:tailscale` or the packaged app (#907, #916).

### Fixed
- **Mobile handoff** — Tailscale Serve parsing is more tolerant, and the handoff control uses the mobile-phone icon (#905).
- **Models** — cleaned up the Claude Fable 5 / Opus 4.8 catalog sequence so unsupported Fable 5 is removed and Opus 4.8 remains available (#908, #913, #915).
- **Home** — model selector styling now matches the familiar dropdown pill, and the selector uses a native select so the menu is not clipped (#903, #904).
- **Studio** — inline tab-strip height matches familiar-list rows (#902).
- **Roles** — widened the role-card capability-label column so "Workflows" is not clipped (#914).

### Polished
- **Roles** — density pass on the role and capability map (#906).

## [0.0.100] - 2026-06-17

Patch release: Salem perch proximity polish, companion rail alignment fixes, next-path chat suggestions, and mobile handoff quality-of-life updates after 0.0.99.

### Added
- **Chat** — assistant responses can surface model-generated next-path suggestion chips to keep follow-up work moving (#898).
- **Mobile** — handoff now auto-copies invite details and includes small UI refinements for the mobile bridge.

### Fixed
- **Shell** — companion rail tab strip aligns cleanly with the corner side-panel trigger (#899).

### Polished
- **Salem** — the perch starts smaller and translucent, grows on cursor approach, and uses a brighter approach glow (#896, #897).

## [0.0.99] - 2026-06-16

Patch release: Windows first-run daemon startup fix and a Salem typecheck guard after 0.0.98.

### Fixed
- **Windows setup** — Cave now resolves npm-installed `coven.cmd` shims from `%APPDATA%\npm` / `npm_config_prefix`, preserves Windows PATH delimiters, and starts the daemon through shell mode for the fixed `coven daemon start` command. This fixes the welcome screen reporting `covenCli.ok: true` while the daemon button still surfaced "coven CLI not found on PATH."
- **Salem** — restored the floating Salem perch `retreat` prop and right-edge retreat behavior so the workspace typecheck stays green.

## [0.0.98] - 2026-06-16

Patch release: capability inspector text-size polish, a more dramatic shell sparkle, and saved workflow node-position updates after 0.0.97.

### Fixed
- **Capabilities** — mono Path/Command text now applies only the compact `9.5px` class instead of losing to the base `11px` class in the cascade (#892).

### Polished
- **Shell** — corner-trigger sparkle now casts with a brighter, more dramatic pass (#893).
- **Workflows** — refreshed saved node positions for `curate-reading-list` and `research-brief`.

## [0.0.97] - 2026-06-16

Patch release: per-session branch-diff in the new recent-activity roll-up, magic corner sidepanel triggers (now click-to-open), Salem perch polish, and a sweep of capability-inspector polish after 0.0.96.

### Added
- **Activity** — recent-activity roll-up in the left panel + a top-right inbox toast (#880).
- **Activity** — per-session branch diff in the roll-up: each session's own branch vs the repo's default base, cached per `(root, branch)` (#883).
- **Shell** — corner sidepanel triggers cast from a distance (proximity-glow magic triggers) (#881).
- **Salem** — icon perch label; always hide the perch when the side panel is open (#888).
- **Workflows** — saved node positions for the `prepare-social-post` workflow (#886).

### Fixed
- **Chat** — session-row meta no longer overlaps in the narrow Companion Rail (#874).
- **Capabilities** — skill description now renders in the inspector Detail row (#875).
- **Shell** — tightened panel-toggle proximity-glow range (250→160px) (#884).
- **Shell** — corner triggers are click-to-open; drop the proximity auto-open behavior (#890).
- **CSS** — dropped orphaned `.chat-scope-tabs__new` styles (#877).

### Polished
- **Capabilities** — Detail/Warning clamps to 3 lines with Show more/less (#876).
- **Capabilities** — Show more/less toggle uses accent-color (#879) and tighter type (#882).
- **Capabilities** — Detail/Warning value text and mono Path/Command text use compact reference sizing (#885, #887).

## [0.0.96] - 2026-06-16

Patch release: GitHub org/repo filtering improvements, Codex-style floating panel toggles, an expanding chat right-panel, Agent Completion Reports, and theme/header fixes after 0.0.95.

### Added
- **GitHub** — selecting a repo now locks the Org filter to that repo's org, and grouping is a `None · Org · Repo` segmented toggle (#831).
- **Shell** — Codex-style floating panel toggles in the top corners.
- **Chat** — the right side panel can expand to cover the chat surface (#829).
- **Reports** — an Agent Completion Report schema + markdown generator.

### Fixed
- **Appearance** — imported tweakcn themes map onto Cave's semantic tokens.
- **Headers** — per-familiar role group headers use the shared clear-header treatment.

## [0.0.95] - 2026-06-16

Patch release: reminders gain links and editing, the Companion panel gets an in-panel collapse trigger, a new Familiar Studio Contract tab, workspace-sourced avatars, and more header/polish fixes after 0.0.94.

### Added
- **Reminders** — a `link` parameter (URL / board card / chat session) on reminders, shown as a routing chip in the detail panel, plus full **edit** of an existing reminder (title / when / recurrence / link) via the reused reminder modal (#826).
- **Companion panel** — an in-panel collapse trigger in the panel header, mirroring the left sessions rail's Hide button (#822).
- **Familiar Studio** — a Contract tab that tests a familiar's adherence to the Familiar Contract.
- **Familiars** — source avatars from the workspace `avatars/` dir, with the workspace avatar taking precedence (#821).

### Fixed
- **Changes** — allow the git Changes panel for daemon-known session roots (#d9a67288).
- **Headers** — consistent "clear header" treatment for library timeline groups, schedules sections, and workflow library group headings.

## [0.0.94] - 2026-06-16

Patch release: a chat composer and projects/sessions overhaul, configurable panel shortcuts, inline Familiar Studio in Settings, new research workflow templates, a markdown-rendering refactor, and a broad sweep of header/theme polish and accessibility fixes after 0.0.93.

### Added
- **Chat** — composer **thinking-effort** and **response-speed** controls (persisted), **quote replies**, and chat-project inference that groups the session rail by project (#798-equivalent composer/projects work in #801, #808).
- **Chat** — render assistant prose in Inter, and render ` ```mermaid ` diagrams via `@create-markdown/preview-mermaid` (#778, #786).
- **Sessions** — session git/PR context (branch / worktree / linked PR) surfaced in the rail (#801).
- **Shortcuts** — configurable panel-toggle keyboard shortcuts (#798).
- **Settings** — full Familiar Studio inline in Settings → Familiars (#802); per-runtime model picker with gated `--model` passthrough (model parity) (#791-era, #0399a089).
- **Board** — task-chat project selector / project-assignment picker in the card inspector and new-card flow (#801, #40ad738e).
- **Workflows** — new `research-brief` and `synthesize-sources` templates (#799).
- **Tasks** — nudge completed chats toward archive (#810).
- **Library** — a `/` quick-open palette across library content (#790).
- **Appearance** — a 4-level UI corner-radius control (#791).
- **Rail** — restored the "Open full memory →" button and folded the magnifier Inspector into the brain Memory tab (#785, #788).

### Changed
- **Markdown** — message-bubble now renders via `renderAsync` custom renderers instead of positional regex substitution (#800).
- **Performance** — ship only the Phosphor icons the app actually uses (~3.5 MB lighter) and reduce packaged sidecar size (#793).
- **UI polish** — uniform background across all themes (incl. custom), standardized "clear header" treatment across board / calendar / GitHub / rail section headers, sidebar spacing/rhythm, and new-chat start screen layout (#791, #803, #805–#807, #812, #813, #816).
- **Schedules** — split into Reminders and Automations.

### Fixed
- **Rail** — suppress the bare default-branch (`main`/`master`) suffix in session titles when it carries no signal (#809).
- **Honesty** — calls show the real trace count instead of capping at 30; chat reports model-application state from the run outcome, not echo alone (#795, #796).
- **Clipboard** — copy buttons work off-localhost (Tauri webview / Tailscale) (#772).
- **Accessibility** — focus-trap/Escape in workflow dialogs, accessible Connect-GitHub modal, board inspector row actions reachable by hover and keyboard (#58d80641, #6ab94b8b, #f97bba0a).
- **Misc** — keep the desktop left panel open on selection, surface bookmark-save failures, preserve familiar model-id casing, cap Pill-level card radius at 20px, and release-pipeline fixes (FUSE-less AppImage, foreign-sidecar pruning) (#776, #777, #784, #794, and others).

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
