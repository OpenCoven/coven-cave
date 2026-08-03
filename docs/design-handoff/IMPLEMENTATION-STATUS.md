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
| `Coven Cave App.dc.html` (iOS) | `apps/ios/CovenCave` | `157dee8d5d` (#3736), `d4f619b6c8` (`cave-4bsu`), `01a3d91bc8` (`cave-32fp`) — gated by `scripts/ios-claude-design-fidelity.test.mjs` |

## Outstanding

Ordered by size of the unbuilt frame, which is a decent proxy for how much
surface it describes.

| Frame | KB | Project | Note |
|---|---:|---|---|
| `Thread Signals.dc.html` | 514 | (WIP) Thread signal UI mockups | The largest frame in the corpus and in **no** exported zip. The smaller `Thread Signal Card` landed; this superset did not. Tracked by `cave-yd3qu`. |
| `Cody Code Reading v2.dc.html` | 262 | # Coven Cave code reading experience | Tracked by `cave-98o51` (Coding Room). Only `Cody Github` from this project landed. |
| `Coven Grimoire.dc.html` | 241 | (Started) Modern AI Blog Reader UI | **Name collision — read this before scoping.** This is a *publication*: "In this issue", "Written by a familiar", "Continue reading", "Eight voices. One Coven.", a contents rail and long-form essays. The repo's `src/components/grimoire-view.tsx` is the *memory* grimoire (a knowledge store) and shares only the word. Unbuilt. Tracked by `cave-wc0j7`. |
| `Cody Code Reading.dc.html` | 183 | # Coven Cave code reading experience | v1 of the above. |
| `Coven Tui v2.dc.html` | 153 | # Coven Cave code reading experience | Terminal workbench; also `cave-98o51`. |
| `OpenCoven Landing - Reforged.dc.html` | 150 | Interactive Landing Page Redesign | **Out of scope for this repo** — marketing site, no `coven-cave` surface. |
| `Writer Workspace.dc.html` | 147 | Shells and hero flow planning | In no exported zip. No corresponding surface. Tracked by `cave-c7zgz`. |
| `Coven Tui.dc.html` | 108 | # Coven Cave code reading experience | v1 of the above. |
| `Coven Podcast.dc.html` | 86 | (Started) Podcast Page Redesign | Research studio has podcast *generation* (`c6987fe200`, `c483d94a15`) but no podcast **page**. Tracked by `cave-q00l6`. |
| `Coven Pr.dc.html` | 75 | # Coven Cave code reading experience | |
| `Memories - Rethought.dc.html` | 59 | Form feedback requested | Newer than the landed Memories redesign; in no exported zip. Tracked by `cave-tj24b`. |
| `AnswerFlow.dc.html` | 15 | Shells and hero flow planning | In no exported zip. Tracked by `cave-c7zgz`. |

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
