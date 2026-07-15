# Golden paths

The eight journeys Coven Cave must make effortless, written as user stories
with the *current* path grounded in code, the exact places it breaks, and a
conservative enablement plan — each phase a PR-sized change that reuses what
exists rather than rebuilding it. Companion to
[`coven-design-language.md`](coven-design-language.md) (how surfaces look and
speak); this doc is about how journeys *flow*.

**Ground rules for every plan:** no new architecture, no surface rewrites, no
breaking API changes. Phases land independently behind the existing test-pin
conventions, and each path names its "done means" so a session picking up the
bead can verify completion. One bead per path, referenced inline — this doc is
the map; the beads are the work.

---

## 1 · First run → first conversation

**Story:** As a new user, I want to go from opening the app to a familiar
answering me in minutes, so the product proves itself before my patience runs
out.

**The path today:** Onboarding wizard, infra only (CLI → `~/.coven` → runtime
→ daemon; `onboarding-overlay.tsx`) → dismissal lands a familiar-less user on
the Familiars surface (`workspace.tsx` `closeOnboarding`) → the Summoning
Circle creates the first familiar (`familiar-summoning-circle.tsx`; vessels:
local runtime, SSH, OpenClaw) → its success stage offers **Begin the first
conversation** → chat-first boot lands in the composer thereafter.

**Where it breaks:**
- The daemon step is still a manual click — the one infra step that could
  simply happen when the CLI is healthy.
- A failed daemon start shows CLI stderr; retrying is on the user.
- Abandoning the circle mid-rite (accidental Escape) loses the draft — state
  resets on unmount by design.

**Enablement plan** (bead `cave-fy1q`):
1. Auto-attempt `POST /api/daemon/start` once when the wizard reaches the
   daemon step with the CLI step healthy; the existing button becomes the
   retry affordance. Guided-steps pin added; failure path unchanged.
2. The circle keeps a per-window `sessionStorage` draft (vessel + name
   choices), cleared on summon, so Escape doesn't restart the rite.
3. Measure it: stamp `cave:first-reply-at` once and surface time-to-first-
   reply in the existing `session-pulse` analytics. Measurement only.

**Done means:** a fresh machine reaches a streamed reply with exactly one
manual infra action (installing tools), and the funnel is measurable.

## 2 · Capture → task → done

**Story:** As someone mid-conversation, I want an idea to become a tracked
task my familiar actually works, so nothing lives only in scrollback.

**The path today:** Create-task-from-chat exists (`chat-task-handoff.ts`
builds a card with a transcript excerpt + audit trail; the ⌘K palette has a
`create-task` row → `POST /api/board`). The board (`board-view.tsx`) holds
cards with `familiarId` assignment. And there the loop stops: the familiar
work queue (`familiar-work-queue-view.tsx`) is PR/beads-centric, not
board-task-centric — **no surface executes a board task, and finished
familiar work never flips the card**.

**Where it breaks:** assignment is a field, not a hand-off. The familiar
never *receives* the task in a place it acts on, and "done" requires the
user to remember the card exists.

**Enablement plan** (bead `cave-32ks`):
1. Board card overflow gains **Send to familiar**: the inverse of
   `chat-task-handoff` — opens a chat seeded with the card's title/excerpt
   and writes the resulting `sessionId` back onto the card. Reuses the
   existing handoff context and linked-context plumbing; no new store.
2. The card detail shows a linked-session status chip (running/idle/done)
   from the same session roster the workspace already polls.
3. A done session with a card backlink offers one-click **Mark card done**
   in chat (`PATCH /api/board` + an audit note on the card).

**Done means:** chat → task → familiar works it → review in chat → card done,
without the user re-finding anything.

## 3 · Morning triage

**Story:** As a returning user opening Cave with coffee, I want one glance to
tell me what needs me, so triage is a moment and not a tour.

**The path today:** four separate places. Home's feed (tweets/repos +
digest carousel), the notification bell popover (`notification-bell.tsx`,
`inboxBadgeCount`), the Inbox mode (`cave-inbox.ts` items:
reminder/agent/response-needed/daily-summary, grouped by
`inbox-feed.groupInboxFeed`), and the `/daily-report/[date]` route. Nothing
composes them into an answer.

**Where it breaks:** the information exists; the *summary* doesn't. First
open requires visiting Home → bell → Inbox → daily report to know the state
of your world.

**Enablement plan** (bead `cave-925w`):
1. Home gains a compact **Needs you** strip fed by the existing inbox feed
   grouping — response-needed count, fired reminders, pending items — each
   linking into Inbox pre-filtered. Reuses `groupInboxFeed`; no new API.
2. The strip's header carries "Today's report →" linking the current
   `/daily-report` date.
3. The bell badge and the strip read the same `inboxBadgeCount` source so
   the two never disagree.

**Done means:** the first screen answers "what needs me" in one glance, and
every element of the answer is one click from acting on it.

## 4 · Delegate a coding change

**Story:** As a developer, I want to hand my familiar a change, review the
diff, and keep the result — without leaving the app for git plumbing.

**The path today** (corrected 2026-07-09 — the original assessment here was
written against a stale snapshot and understated the codebase): chat binds a
project (`chat-projects.ts`, `activeProjectRoot`; per-familiar grants in the
Studio); the code rail's **Changes** tab renders the working-tree diff per
project root (`session-changes-panel.tsx` over `GET /api/changes`,
double-allowlisted to registered project roots + daemon session roots);
per-file **revert** with auto-checkpoint, patch-based **checkpoints**, a
signed **Commit** action (`git add -A` + feature-branch-on-default +
`git commit -S`) and **Create PR** all live on the same route; chat edit
cards carry per-file Review/Undo wired through `cave:open-file-diff` /
`cave:changes-refresh`.

**Where it broke** (the remaining sliver): a turn that edited *several*
files offered only per-card Review buttons — no single aggregate entry into
the review at the turn level.

**Enablement** (bead `cave-qva4`, delivered): phases 1–2 of the original
plan pre-existed as `/api/changes`, richer than specced (commit *and* PR —
note the existing Create PR affordance does push, deliberately, on click).
Phase 3 shipped as an aggregate chip: a settled turn whose edit cards
touched more than one distinct file renders "N files changed · Review all",
opening the Changes tab through the cards' existing event contract.

**Done means:** delegate → review the actual diff → checkpoint/commit, all
in-app; nothing is pushed without a deliberate click.

## 5 · Take Cave with you

**Story:** As a desktop user heading out, I want my phone already paired and
my *current conversation* reachable there, so mobility costs nothing.

**The path today:** Settings → Phone is the one-scan pairing card: the
Mobile mode switch auto-reconciles Tailscale Serve every 60s, the QR pairs
via the iPhone camera (Safari or the native app — `CaveInvite` parses the
same link), manual setup is a collapsed disclosure, and tokens refresh on a
30-day roll (`/api/mobile-token/refresh`).

**Where it breaks:** *(items 1–2 shipped via cave-i74f/#2827; item 3 was
stale — the in-app scan shipped in #2320. The remaining mobile journey work
now lives in [`ios-connection-cloud-plan.md`](ios-connection-cloud-plan.md).)*
- ~~Pairing connects the *app*, not the *moment*~~ — "Continue on phone"
  carries `#chat-<id>` (though the native scanner still drops fragments; O4).
- ~~The desktop never learns the phone actually connected~~ — "Paired · last
  seen" ships, but only fires on token-refresh, which the current app-start
  flow never triggers (O1).
- ~~No in-app scan~~ — VisionKit scanner shipped in #2320.

**Enablement plan** (bead `cave-i74f`):
1. Session hand-off: append `#chat-<id>` to the invite URL when opened from
   a chat (the deep-link route already resolves it); chat overflow gains
   **Continue on phone**, reusing the pairing card in a modal. No new API.
2. Paired signal: `app-start` responses expose `lastSeenAt` from the
   token-refresh hits the server already receives; the card shows
   "Paired · last seen <t>". Additive field.
3. iOS (Swift lane, `test:mobile` pins): the connect screen scans QR inline
   via `AVCaptureMetadataOutput`; pasting stays.

**Done means:** from an open chat, one action shows a code; one scan opens
that same conversation on the phone; the desktop confirms the pairing took.

## 6 · Grow a familiar

**Story:** As a returning user, I want my familiar to visibly improve from
our work together, so investing in it feels like progress, not configuration.

**The path today:** the Enhancement Rite (identity/form/mind edits with
vitality embers), Familiar Studio tabs, memory + daily notes with a
Reflection section, the chat header's Reflect (✦) posting self-reports, and
growth signals (`familiar-growth-signals.ts`) rendering in a dashboard page.

**Where it breaks:** the loop is scattered — "your familiar is stalled"
(growth) never connects to "here's what would help" (chat/notes/rite), and
computed hints have no surface that acts on them.

**Enablement plan** (bead `cave-mo4q`):
1. Vitality hints become actions: the rite's vitality strip links each hint
   to its verb ("begin a conversation" → Start chat; "no memories yet" →
   open daily notes). Pure wiring of existing callbacks.
2. Roster cards show the growth `healthLabel` with the status-dot + word
   pattern (design language §3), replacing the duplicated online/offline dot.
3. A completed Reflect announces where it landed, with an "Open daily note"
   action.

**Done means:** a stalled familiar tells you so where you already look, and
every growth hint is one click from its remedy.

## 7 · Find anything

**Story:** As any user, I want one place to type what I'm thinking of and
get to it, so finding never depends on remembering where something lives.

**The path today:** five entry points with disjoint coverage. The ⌘K palette
is the most complete (familiars, sessions, board cards, memory, slash
commands, conversation-content search via `/api/chat/search`, and an
ask-Salem fallback; `command-palette.tsx`). Beside it: the top-bar "Search or
ask Salem…" input with surface-specific routing, the settings-pane search
(`settings-search.tsx`), and the in-chat find bar.

**Where it breaks:** coverage is an implementation detail the user must
know. The top bar looks like the front door but isn't the palette.

**Enablement plan** (bead `cave-q8oo`):
1. The top-bar search becomes the palette's front door: focusing it opens ⌘K
   pre-filled, one engine behind both affordances.
2. The palette registers settings panes as rows (reusing the
   settings-search index) — per design language §8, anything relocated off a
   surface must stay one keystroke away.
3. The palette's empty state states its coverage plainly, so "what can I
   find here" stops being folklore.

**Done means:** one search behavior everywhere, and the palette provably
covers sessions, tasks, familiars, memory, settings, and commands.

## 8 · Ship a release

**Story:** As the maintainer, I want a release to be one intentional action
with honest progress, so shipping doesn't consume an evening of babysitting
flaky CI.

**The path today:** manual six-location version stamp + CHANGELOG → PR →
merge → signed `v*` tag → `release.yml` builds four platforms + notarization
+ updater manifest → `scripts/verify-release-updater.mjs` verifies the chain.
Observed on 2026-07-08 (four cuts): the macOS Intel leg flaked on three of
four runs (Google Fonts fetch, Apple timestamp service, notarization), each
time publishing an incomplete "latest" release whose missing `latest.json`
404s the in-app updater for every installed app until someone runs
`gh run rerun --failed`. Three stamp-PR collisions between concurrent
sessions the same day.

**Where it breaks:** no retries around the Intel leg's network dependencies;
the manifest job skips entirely on any platform failure; the stamp is
hand-rolled and race-prone.

**Enablement plan** (beads `cave-1hha` + `cave-ef6f`):
1. (`cave-1hha`) Retry wrappers in `release.yml` around the font fetch (or
   vendor the font), codesign timestamping, and notarytool submission.
2. (`cave-ef6f`) Manifest resilience: `updater-manifest` runs on
   `!cancelled()` and publishes entries for the platforms that built, with a
   warning in the release body; `verify-release-updater.mjs` gains
   `--allow-partial` for CI use only.
3. (`cave-ef6f`) `scripts/stamp-release.mjs`: bumps the six version
   locations, drafts the changelog section from `git log <last-tag>..`,
   opens the PR — and refuses when another stamp PR is already open.

**Done means:** a cut is one script + one merge + one tag; a single-platform
flake never breaks the updater; stamps stop colliding.

---

*Written 2026-07-09 from the shipped code (session 04873d94). When a plan and
the code disagree, the code is right — then update this map.*
