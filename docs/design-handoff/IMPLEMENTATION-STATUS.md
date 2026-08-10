# Claude Design — implementation ledger

Every surface in this app that came from a [Claude Design](https://claude.ai/design)
handoff, what landed it, and what is still outstanding.

**Why this file exists.** Answering "which design frames have we built?" used to
mean re-deriving the answer from `git log` and a folder of downloaded zips —
which is both slow and wrong, for two reasons found on 2026-08-03 (`cave-pqi7n`):

1. **The zips in `~/Downloads` are stale snapshots.** The live projects hold
   frames that appear in **no** exported zip — `Writer Workspace.dc.html`,
   `AnswerFlow.dc.html`, `Memories - Rethought.dc.html`, and the 514 KB
   `Thread Signals.dc.html`. An audit driven off the download folder
   under-reports the corpus.
2. **52 zips are ~17 projects.** Five separate `chat-page-*` zips carry the same
   five frames. Counting files overstates the work by roughly 3×.

So the source of truth is the **live project list** (via the `claude_design`
MCP: `list_projects`, then `list_files` per project), reconciled against `main`.

Regenerate the live side with:

```bash
# in a Claude Code session with the claude-design MCP connected (/design-login)
#   mcp__claude-design__list_projects
#   mcp__claude-design__list_files  { project_id, depth: 1 }   # per project
```

`design-handoff-ledger.test.ts` keeps the **repo** side honest: every source
path cited below must exist. It cannot check the live side (no network in
tests), so when a project gains or loses a frame, update this table by hand.

---

## Landed

| Frame | Surface | Landed by |
|---|---|---|
| `Familiar Analytics.dc.html` | `src/components/familiar-analytics-content.tsx` | `7316804273` (#4277) — dock + stage workbench |
| `Chat.dc.html` (session, list) | chat session chrome | `59527634e7` (#3983) |
| `Chat.dc.html` 2a (spine, minimap) | thread instruments | `6cc5fcb913` (#4046) |
| `Chat.dc.html` 2b (bands) | new-session launcher | `3e5b9c450d` (`cave-iwopz`) |
| `Chat Session - Prototype.dc.html` | Sessions list (`src/components/chat-list.tsx`, `src/lib/chat-session-status.ts`, `src/lib/chat-session-activity.ts`, `src/lib/chat-session-sort.ts`, `src/styles/chat-list.css`), the new-session hero (`src/styles/home-dashboard.css`) and the transcript gap divider (`src/lib/chat-turn-gap.ts`). The frame's session chrome — serif title row, slim mono context row, spine, reader — had already landed through `Chat.dc.html` (session/2a) and `Reader.dc.html` 3a, so this import is the list, the hero treatment and the gap rule. **Not adopted:** the frame's per-row step counts, tool-call counts and last-message previews — the daemon's `SessionRow` carries none of them, and inventing them would be a row that lies. **Outstanding:** the "N earlier turns" fold above the transcript. | `cave-n3jg2` |
| `Reader.dc.html` frame 3a | chat Expand reader | `ecd8c52f6a` (#4255) |
| `Canvas.dc.html` | Canvas page | `d6b14b3e53` (#3988) |
| `Projects.dc.html` | Project access page | `3ffeea6be6` (#3994) |
| `Familiar.dc.html` | Familiar tab + `SurfaceRail` | `fe70ac2846` (#3593) |
| `Group.dc.html` | Covens surface | `ec00d524d4` (#3594) |
| `Sessions.dc.html` | Sessions surface | `dc6e61e2ea` (#3600) |
| `Chart Room - Astra v2.dc.html` | Chart Room (`src/components/role-surfaces/chart-room-graph.tsx`, `src/components/role-surfaces/chart-room-chain.tsx`) | `01874924dc` (`cave-iuc8h`) |
| `Weaves and Proposals.dc.html` | Weaves decision surface | `9d43c00a28` (#4108) |
| `Review Deck.dc.html` | tri-pane change review | `779030fc0d` (#3767) |
| `Daily Report - Redesign.dc.html` | the chaptered day | `f0aaeced14` (#3981) |
| `Marketplace.dc.html` | Explore (Browse + Skills merged) | `32d7d309fd` (#3775) |
| `Memories Prototype.dc.html` | Memories / Knowledge launcher | `e62f2fd421` (#3756), `17386746a9` (#3445) |
| `Launcher.dc.html` | Home work-led dashboard | `e87b7b448a` (#3758) |
| `Research Desk.dc.html` | Research Desk chrome | `26efa6a1e2` (`cave-mxqz`) |
| `Research Desk App.dc.html` | The whole researcher-desk surface, second pass (project *Research Desk interface redesign*). Prompt: five-element strength meter, prompt builder dialog, assembled-brief strip, ⚡ recommendations, Quick saves as a grouped bottom drawer (`src/lib/research-prompt-brief.ts`, `src/components/role-surfaces/research-prompt-builder.tsx`, `src/components/role-surfaces/research-prompt-strength.tsx`, `src/components/role-surfaces/research-quick-saves.ts`). Desk: drag-resizable, collapse-to-spine rails (`src/components/role-surfaces/use-research-pane.ts`), per-phase stepper meta + progress wash (`researchPhaseMeta`), bound meter bars (`ResearchBoundReading.progress`), pass dots, scope dots. Library: search, sort, pager (`src/components/role-surfaces/research-library-view.ts`). Studio: provider readiness strip (`src/components/role-surfaces/research-studio-providers.ts`) + media mosaic. Resources: kind-banded cards. Shell: engine/live/review status cluster. **Not adopted** — each would need a backend that does not exist, and would otherwise be a surface that lies: inline run rename (no rename action), the report's per-section approve/comment flow and inline citation chips (artifacts are files, not sectioned documents), per-question evidence coverage, and the version-compare dialog. The frame's five invented media providers and four invented recommendation cards are re-derived from the readiness endpoint and the live mission list instead. | `cave-na7oc` |
| `Research Reader.dc.html` | research reader (`src/components/role-surfaces/research-reader.tsx`) | see `offScaleFontSizePx` baseline note |
| `Thread Signal Card.dc.html` | thread-signal triage card (`src/components/thread-signals-section.tsx`) | `5c5e78f322` (#4256), `cave-vkegj` |
| `Final Card Components.dc.html` / `GitHub Card Composer.dc.html` | `src/components/github-card-composer.tsx` | `cave-076kh` |
| `Cody Github.dc.html` | GitHub triage stream + detail (`src/components/github-stream.tsx`) | see `offScaleSpacingPx` baseline note |
| `Rituals Home.dc.html` | Rituals sidepanel | `26390d361b` (#3485) |
| `New Reminder.dc.html` | new-reminder modal | `024dd99676` (#3569) |
| `Project Folder Modal.dc.html` | folder picker | `08becc377a` (`cave-tv71`) |
| `Queue.dc.html` / `Tasks.dc.html` | Queue + Tasks toolbars | `52d043cd1c` (#3746), `8c4c7cfde9` (#3748) |
| Settings `About` / `Familiars` / `Profile` / `Phone` | settings control sheets | `3e1c5125f2`, `24b702fc8a`, `4c168973c7`, `196b222f4d` |
| `SourceCard.dc.html` | `src/components/ui/citation.tsx` — both variants (web card carries its marker; worktree card shows path, line range and a numbered peek) | `cave-mdu1n` |
| `Memory.dc.html` | `src/components/canonical-memory-reader.tsx` — the privacy gate is already fail-closed (content shows only when `classification === "public" && revealRequired === false`); `src/components/familiars-memory-reader.tsx` carries the frame's own "Select a memory to read" empty state | `cave-5u8l4` |
| `Activity Details Panel.dc.html` | `src/components/automations/reminder-detail-panel.tsx` — the frame's exact "Reminder details" / "Activity details" heading split, pinned by `automations-view.test.ts` | `cave-5u8l4` |
| `Coven Podcast.dc.html` | `src/components/role-surfaces/podcast-transcript.tsx` — the screenplay transcript (cast, cold open, speaker runs) in the studio review sheet and viewer. The frame's public-microsite chrome (own fonts, own palette, fixed nav, hero) is **not** adopted: like `OpenCoven Landing`, that half is a marketing site, not an app surface. | `cave-q00l6` |
| `Cody Code Reading v2.dc.html` + `Coven Tui v2.dc.html` (and their v1s) | The Coding Room. Landed in two passes, and the second one **reversed the first's central layout choice** — read both before touching it. **Pass 1 (`cave-98o51`)** built a three-zone room: session rail \| persistent splittable terminal centre (`src/components/code-terminal-workspace.tsx`, split model in `src/lib/code-terminal-tree.ts`) \| resizable context dock. The terminal was the centre because both frames treat it as the room's constant, not a tab — the earlier tabbed shape (Diff \| Files \| Terminal \| PR) was rejected for hiding it. **Pass 2 (`cave-0rcku`)** rebuilt the room to the frame's actual `isSessionsTab` layout, which the first pass had not implemented: a header session picker (`src/components/code-session-picker.tsx`, `src/lib/code-session-picker.ts`) over three columns — worktree-aware file tree (`src/components/code-workbench-tree.tsx`, feeding `ProjectTree`'s new `decorate` prop) \| source viewer with a symbol outline (`src/lib/code-outline.ts`, `variant="workbench"` on `src/components/rail-file-preview.tsx`) \| drag-resizable review rail that collapses to a diffstat spine (`src/components/code-review-rail.tsx`, `src/lib/code-side-rail.ts`) — with the terminal as a permanently-visible bottom drawer (`src/components/code-terminal-drawer.tsx`) and a rebindable shortcuts dialog (`src/components/code-shortcuts-dialog.tsx`, `src/lib/code-shortcuts.ts`). Composed by `src/components/code-workbench.tsx`, styled by `src/styles/globals/surface-code-room.css`. **Why the reversal**: the frame keeps the same commitment (the shell is never a tab) but pays for it in HEIGHT, so all three columns go to reading. Pass 1 gave two of three columns to a shell and a dock and left the source without a column at all, on a surface whose name is *reading*. The drawer never unmounts, so the `cave.rail.<id>` PTY reuse survives — the same shell still follows you between surfaces; extra panes get `cave.code.<id>.<pane>`, capped at four. The context dock and its Files tab were deleted rather than left unreachable: Inspector became the header popover, GitHub and Browser were already top-level surfaces. **Not adopted**: the frame's per-extension file-type hue palette (the design language reserves colour and forbids a second hue — the extension label is already the channel) and its prototype window chrome / nav rail (the app has its own shell). | `cave-98o51`, `cave-0rcku` |
| `Coven Pr.dc.html` | The full pull-request reader (`src/components/github-pr-reader.tsx`, model in `src/lib/github-pr-reader.ts`, shared hooks in `src/lib/use-github-pr.ts`, styled by `src/styles/globals/surface-pr-reader.css`): header bar, serif hero with the base←head lineage, Conversation \| Commits \| Checks \| Files, the checks card with its landing gates, review threads, a commit list and the capped unified diff. Reached from the Coding Room's review rail as the frame's "Full PR view", which is the whole point — the rail is a sidebar and none of those are sidebar shapes. `/api/github/commit` gained a `?number=` mode because no endpoint listed a PR's commits. **Not adopted**: the frame's "N required blocked" count and its comment composer / close-PR actions. GitHub's check-run payload does not say which contexts are required — that lives in branch protection — so the reader reports failing/passing/pending and marks the checks gate `unknown` rather than inventing a requirement. Composing and closing already live in the rail's PR panel; duplicating those mutations in a second surface is how two views start disagreeing about what was sent. Every gate can return `unknown` (GitHub answers `mergeable` with null while it computes), and `prMergeVerdict` refuses to merge on anything short of a pass — "we could not tell" is not permission. | `cave-l82dm` |
| `Coven - Redesign.dc.html` (project *Multi-agent conversation redesign*, with `Design Proposal.dc.html` as the behavior spec and `Material System.dc.html` as the material spec) | The coven surface, reorganized around one idea: **a user message starts a run, and everything that message causes is grouped under it**. Model first, in pure modules so the vocabulary is testable without a DOM — `src/lib/coven-run.ts` widens a reply's four wire states into the eight a reader distinguishes (thinking / using tool / streaming, and stopped / skipped apart from failed), groups the transcript into runs and answers which familiars have earned a section; `src/lib/coven-composer-routing.ts` derives the placeholder, recipient preview and enter-note from the same inputs the send path uses; `src/lib/coven-stop-scope.ts` names each Stop scope and its consequence; `src/lib/coven-raw-output.ts` surfaces unrecognized `<coven:…>` markup instead of discarding it silently. `src/lib/group-chat.ts` gained the discriminators those need (`activityKind`, `toolCalls`, an explicit stopped/skipped `outcome`, a round-robin turn gate so Pause is real, and a sit-out list that keeps membership, order and session intact). Surface: `src/components/coven-run-header.tsx` (sticky mode glyph + agent stepper + progress + elapsed + Pause + scoped Stop menu), `src/components/coven-agent-section.tsx`, `src/components/coven-composer-bar.tsx`, `src/components/coven-inspector.tsx`, `src/components/coven-roster-popover.tsx`, all composed by `src/components/group-chat-view.tsx` and restyled by `src/styles/coven-tab.css`. **The load-bearing change**: a familiar enters the transcript only once it produces output — queued familiars live in the stepper, so three "replying" rows can no longer mean one active agent. **Deliberate behavior changes**: Enter during a run now queues instead of being dropped, and the mode selector stays live during a run (it sets the *next* message's mode, and says so) rather than being a dead control until Stop. **Not adopted** — each would be a surface that lies: the frame's **approval card** for side-effecting proposals (there is no approval protocol; nothing would execute the command it shows), the tool row's **expandable output pane** (the SSE carries `tool_use` *names* only — no output — so the disclosure would open onto nothing; the row reports what ran, how many calls and how long), per-reply **replay / read-aloud / vote** controls, and the frame's **`action`-kind suggestion chips** with risk tags (group chat has no action router, so only `reply` suggestions render — a click sends an ordinary message, never a side effect). **Not adopted, on the merits**: the frame's **hold-on-failure** rotation (scenario E). Holding is the better contract, but the frame pairs it with an inline "Retry Echo" and retry runs in its own scope behind a `busy` guard — a held run whose Retry cannot fire is worse than today's recovery, so a failed turn still advances and the run summary reports "with failures". **Outstanding**: the status-bar run pill (§11's second half) — `StatusBar` is a workspace-level footer with a fixed prop contract, so it needs plumbing through `chat-surface` and `workspace`; the rail's per-coven status line (§11's first half) did land. | `cave-95urm` |
| `Coven Cave App.dc.html` (iOS) | `apps/ios/CovenCave` | `157dee8d5d` (#3736), `d4f619b6c8` (`cave-4bsu`), `01a3d91bc8` (`cave-32fp`), `cave-122mp` — gated by `scripts/ios-claude-design-fidelity.test.mjs`. The supplied July archive's familiar rail + unified recents and persistent bottom tab bar were intentionally superseded by the approved `docs/superpowers/specs/2026-08-03-ios-chat-familiars-first-design.md` and drawer shell. The compatible app-wide search and truthful project activity metadata cover both local and server-only conversations; validated linked PR/issue context remains readable through accessibility text sizes. |

## Outstanding

Ordered by size of the unbuilt frame, which is a decent proxy for how much
surface it describes.

| Frame | KB | Project | Note |
|---|---:|---|---|
| `Thread Signals.dc.html` | 514 | (WIP) Thread signal UI mockups | The largest frame in the corpus and in **no** exported zip. The smaller `Thread Signal Card` landed; this superset did not. Tracked by `cave-yd3qu`. |
| `Coven Grimoire.dc.html` | 241 | (Started) Modern AI Blog Reader UI | **Name collision — read this before scoping.** This is a *publication*: "In this issue", "Written by a familiar", "Continue reading", "Eight voices. One Coven.", a contents rail and long-form essays. The repo's `src/components/grimoire-view.tsx` is the *memory* grimoire (a knowledge store) and shares only the word. Unbuilt. Tracked by `cave-wc0j7`. |
| `OpenCoven Landing - Reforged.dc.html` | 150 | Interactive Landing Page Redesign | **Out of scope for this repo** — marketing site, no `coven-cave` surface. |
| `Cody Code Reading v2.dc.html` — the `isWork` half | — | (Started) Coven Cave Code | The scheduler surface: lane capacity, rank-ordered queue, gates, audit history, bead detail, and an explicitly-not-connected PSYCHE slot. The room half of this frame landed (`cave-0rcku`); this half did not. Queue rows, reassign and the "why it sits here" gate card map onto `/api/beads` and the orchestration-ready-task contract; the hand-ranked queue, gate *approval*, lane load % and audit undo have no backend and must not be rendered until they do. Scoped in `cave-7c329`. |
| `Memories - Rethought.dc.html` | 59 | Form feedback requested | Newer than the landed Memories redesign; in no exported zip. Tracked by `cave-tj24b`. |

### Not deliverables

These are specs, baselines and explorations — read them, don't build them:

- `Agentic Core Spec.dc.html`, `Code Reading Spec Board.dc.html` — specs.
- `* - Current.dc.html` (Cave Chat, Daily Report, Coven Podcast, OpenCoven
  Landing, Memories - Current and Critique) — before-pictures.
- `Chart Room - Astra / Proposal / Today`, `Dependencies - Directions`,
  `Route Graph - Astra` — explorations that fed Astra v2, which landed whole.
- `Familiar Analytics Redesign.dc.html` (1a/1b/1c), `Chat Revamp.dc.html`
  (1a–1d), `Minimalist Explorations.dc.html` — direction sets; one direction
  each was chosen and shipped.
- `Nocturne` — a design-system project (foundations/components/templates), not
  a screen.
- **`Writer Workspace.dc.html` + `AnswerFlow.dc.html`** (Shells and hero flow
  planning) — a **different product**. The Writer shell is branded
  "CompleteTech Writer" over a project called "Offline Sync Rewrite", and both
  frames import the Nocturne design system (`_ds/nocturne-…/styles.css`,
  `var(--color-accent)`) rather than this app's tokens. AnswerFlow is that
  product's decision-capture card, which is why nothing here produces the
  questions it renders. Not coven-cave work — same call as `OpenCoven Landing`.

---

## Working notes for the next import

- **The prototype palette is already our token set.** `#9386d0` is
  byte-identical to `--accent-presence`; the three `oklch` tones in every
  handoff are literally `--color-success` / `--color-warning` / `--color-danger`.
  Translate to tokens and the surface survives all 12 palettes × 2 modes for
  free. Never hand-copy a hex — `pnpm lint` fails on it anyway.
- **Snap the mock's spacing before measuring drift.** Handoffs paint
  5/6/7/9/10/11/13/14/15/18/22/26px paddings; snapping them to `--space-1..-6`
  turned a ratchet failure into a −65 improvement on the analytics import.
  Keep only 1/2/3px micro-marks.
- **Grep for every test that *reads* the file you are rewriting**, not just its
  own suite — the analytics rebuild had five (`profile-card`, `authed-image`,
  `thread-signals-section`, `evals-removal`, `first-run-stamps`).
- **Drive the result in a browser.** On the analytics import, source-text tests
  passed while a real browser showed a collapse breakpoint that was a ceiling
  instead of a band, a panel pooling a third of its height as dead space, and a
  duplicated count in a header.
