# Chat ↔ GitHub Integration — Design

**Status:** Shipped (all waves merged 2026-07-15; VERIFY re-audit below)
· **Goal:** `chat-github-power-integration`
· **Epic:** `cave-fpqx` · **PLAN bead:** `cave-fpqx.2`
· **Evidence base:** [capability map](specs/2026-07-14-chat-github-capability-map.md) (DISCOVER, PR #3160)

## Mission

Make GitHub a first-class power layer inside the chat workspace: issues, PRs,
checks, reviews, commits, and Actions readable **and** actionable inline from
the conversation; skill invocations visible in-thread; work stage consistent
across the chat UI, GitHub, and Beads. The unified chat+code workspace
(2026-07-03 design) already solved the chat↔coding seam — this design adds the
GitHub layer on top of it.

## Decisions (user-approved 2026-07-14)

| Question | Decision |
| --- | --- |
| Write-action confirmation | **Tiered.** Tier-1 (comment, reply, resolve/unresolve, issue create/close/reopen) fires on user tap. Tier-2 (merge, review submit, check re-run, workflow dispatch) renders a confirm card first. |
| Agent-initiated writes | **Agents propose, humans dispose.** Any agent-initiated action renders a proposal card requiring a user tap, regardless of tier. Tiering governs only the user's own gestures on cards. |
| Build order | Read cards → writes → stage header → skill cards → rail badge. |
| Skill visibility depth | **Both:** deterministic cards for `/skill` invocations now, plus a `<coven:skill>` stream-marker contract agents can emit. |
| Stage placement | **Thread header strip** (not the composer chip cluster). |
| Architecture | **A — marker protocol + shared card renderer** (subsumes URL unfurl; leaves tool-call-native open for later). |

## Non-goals

- Rewriting the transcript, composer, or `MessageBubble` internals — cards
  enter through the existing segment dispatch.
- A GitHub tab in the code rail (the header strip owns visibility; the rail
  gets only a failing-checks badge).
- Webhooks or a vendor cloud — polling idioms only, consistent with the
  existing watcher.
- General repo browsing/search UI in chat (github-view mode remains).

## §1 Marker protocol (`src/lib/github-blocks.ts`)

A new extraction lib mirroring `next-paths.ts` (streaming-safe: partial tags
at the stream tail are hidden, never flashed as raw text):

```
<coven:github kind="pr" repo="OpenCoven/coven-cave" number="3160" />
<coven:github kind="issue" repo="o/r" number="42" title="optional fallback" />
kinds: pr | issue | review-thread | commit | run
extra attrs: sha (commit), run (Actions run id), thread (review thread id)
```

`extractGitHubBlocks(text) → { visible, blocks: GitHubBlockDescriptor[] }`,
called where `extractNextPaths` runs today (`chat-view.tsx` turn rendering;
`splitTextForArtifacts` neighborhood). Descriptors become a new
`MessageBubbleSegment` node type so cards interleave at their chronological
offset like tool blocks do.

**Producers:**
1. **Agents** emit markers intentionally (prompt contract, §5/§8).
2. **URL auto-unfurl:** a `github.com` issue/PR/commit/run URL standing on its
   own line in a message unfurls into the same descriptor. Inline mentions
   stay plain links. Same parser, second entry point — no separate card path.

**Action-proposal markers** (agent-initiated writes, §3):

```
<coven:github-action kind="merge" repo="o/r" number="7" method="squash" note="why" />
kinds: comment | reply | resolve | review | merge | rerun | dispatch | issue-create | issue-state
```

Always renders a proposal card; never auto-fires.

## §2 Card family (`src/components/github-card.tsx`)

One component family, compact by default, expandable in place:

- **IssueCard** — state dot, number/title, labels, assignees, comment count.
  Actions: comment (T1), close/reopen (T1), open on GitHub.
- **PRCard** — state (draft/open/merged/closed), branch → base, checks rollup
  strip (per-check dots + counts, reusing the `/api/github/checks` rollup
  shape), review state, mergeable. Actions: comment (T1), approve /
  request-changes (T2), merge (T2), re-run failed checks (T2).
- **ReviewThreadCard** — file/line context, thread excerpt. Actions: reply
  (T1), resolve/unresolve (T1, existing route).
- **CommitCard** — sha, message, author, stats. Read-only.
- **RunCard** — workflow name, status/conclusion, branch, duration. Actions:
  re-run (T2), view logs (external link).

**Hydration:** cards render instantly from marker attrs (repo, number,
optional title), then hydrate client-side from `/api/github/item`, `/checks`,
`/comments`, new `/commit` and `/runs`. Checks re-poll every 30s only while
pending and the tab is visible (github-view idiom). No global polling.

**Degradation:** unauthenticated (`patInvalid`) → card shows a quiet
"Connect GitHub" affordance (existing `/api/github/pat` settings flow);
rate-limited → link-only card with retry-after note (activity-route idiom);
offline/daemon-less → attrs-only card degrades to a plain link. Never an
empty box.

## §3 Write actions

**New routes** (vault PAT `GITHUB_PAT`, existing auth posture, each
registered in `api-contracts.test.ts`, alphabetical):

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/github/commit` | GET | Commit detail (message, author, files, stats) |
| `/api/github/dispatch` | POST | `workflow_dispatch` {repo, workflow, ref, inputs} |
| `/api/github/issue` | POST, PATCH | POST create {repo, title, body, labels}; PATCH state {repo, number, state} |
| `/api/github/merge` | POST | Squash/merge/rebase a PR; surfaces GitHub's own guard errors verbatim |
| `/api/github/rerun` | POST | Re-run a check run / failed jobs of a run |
| `/api/github/review` | POST | Submit review {repo, number, event: APPROVE\|REQUEST_CHANGES\|COMMENT, body} |
| `/api/github/runs` | GET | List recent Actions runs {repo, branch?} or one run {repo, id} |
| `/api/github/labels` | GET | Repo label palette {repo} — the composer's label picker |
| `/api/github/diff` | GET | PR changed files {repo, number}, hard-bounded for prompt use |
| `/api/github/reactions` | GET, POST, DELETE | Reactions on an issue/PR — the card's resting chips |

Existing `comment` and `resolve-thread` routes are reused unchanged.

**Extended for the composer (cave-076kh), all additive:**

- `item` takes an optional `pull=1`, which adds a `pull` block (head/base ref,
  commit count, latest-review-per-author tally). Omitted by default so the
  board and daily-report callers pay no extra rate limit.
- `issue` PATCH takes `assignees` / `labels` alongside `state`, as replace-the-
  whole-list writes, and now passes GitHub's error through verbatim (a 422
  names the offending login).
- `merge` takes an optional `deleteBranch`. It deliberately does NOT take a
  branch name: the route reads `head.ref` back from GitHub's own PR object after
  the merge. A request-supplied ref would both let a caller steer the route at an
  arbitrary ref path (CodeQL `js/request-forgery` — an anchored regex is not a
  sanitiser CodeQL recognises) and let a caller with a stale ref delete a branch
  nobody asked about. A failed branch delete never fails the response — the
  merge already happened and is irreversible.

**Tier classification** lives in one pure function
(`classifyGitHubAction(kind): "fire" | "confirm"` in `github-blocks.ts`) so
tests pin it and UI can't drift:

- **Tier-1 (fire on tap):** comment, reply, resolve, unresolve, issue-create,
  issue-state.
- **Tier-2 (confirm card):** merge, review, rerun, dispatch.

**Confirm/proposal card lifecycle:** `proposed → confirming → firing →
done | error`. The card states exactly what will fire (repo, number, method,
body preview). On success it morphs into the result (e.g. merged state +
squash sha link); on failure it shows the API error with a retry affordance.
Agent-initiated proposals (`<coven:github-action>`) enter at `proposed` and
require a user tap even for Tier-1 kinds. The tier table above governs these
proposals; `classifyGitHubAction` remains their single source of truth.

### §3a The composer cockpit (2026-07-29, cave-076kh)

USER-initiated writes on an issue/PR card no longer come from a flat action row
with a tier-2 confirm strip. They come from one bottom-anchored composer
(`github-card-composer.tsx`), per the Claude Design handoff
`Final Card Components.dc.html`. Two invariants define it:

1. **The card's footprint never changes.** `.ghc-slot` is a constant-height
   reply row in every phase; each expanded phase paints into `.ghc-sheet`, a
   sheet absolutely positioned against the card's bottom edge that grows
   *upward* over the transcript. This is why the card root carries `relative` —
   it is the sheet's containing block, not a cosmetic class. Opening a section
   mid-conversation cannot reflow the chat below the card.
2. **At most one section is open by construction** — a single state slot, not
   cleanup after the fact.

Phases: `rest | open | sending | error | merged`. Rest is a reply pill plus
reaction chips and a gate chip — there is deliberately no bare `Merge` button to
mis-tap.

**Gating replaces confirmation.** The palette (`gh-card-commands.ts`) is built
from live card state, so a command the card cannot fire is never offered: a
merged PR gets no `/merge`, a PR with no open threads no `/thread`, no familiar
no `/draft`. `parseCommand` re-checks the tree before producing an action, so
even a hand-synthesised row cannot fire an ungated write. Merge — the one
irreversible verb — additionally keeps its own arm field: the CTA is inert until
the user types `merge`.

**Only issue and PR kinds get the composer.** Commit, run and review-thread
cards stay read-only; their head has to carry all the state on its own.

**"Draft with `<familiar>`" never sends.** Generation rides the client lane
(`streamFamiliarText`, `permissionMode: "read"`, `origin: "enhance"`) — there is
no server-side LLM route, and a route would lose the familiar's own context. The
draft lands in the textarea and only the user's own submit writes. Every scope
the user opts into (changed files, open threads, failing checks) carries text an
outside party controls, so all of it goes into one fenced untrusted-data block
with the disclaimer ahead of the fence and attacker-supplied fences defused —
see `gh-review-draft.ts` and its tests.

## §4 Stage header strip

> **Removed 2026-07 (cave-ohcj):** the stage header strip and the §6
> failing-checks rail badge were retired when the dedicated **Code surface**
> took ownership of stage/PR context (per-session PR panel). `stage-model.ts`
> lives on as the shared model behind the Code surface's PR panel and the
> Beads work queue. The sections below are kept as historical design record.

**`src/lib/stage-model.ts` (new, extracted):** the bead↔PR↔session join and
lane resolution currently inside `src/lib/beads-work-queue.ts` (lanes:
checks-failing, needs-review, ready-to-merge, waiting, post-merge-cleanup)
moves into a shared pure module; the queue and the header consume the same
model. This is the "one stage model" acceptance criterion made literal.

**`src/components/chat-stage-header.tsx` (new):** a slim strip between the
chat top bar and the transcript rendering the pipeline
`bead → branch/PR → checks → review → merged`. Data sources all exist:
session `project_root`/branch (git-chip source `/api/changes`), PR join
(`/api/beads/prs` bridge), bead status (`/api/beads`). Segments open detail
popovers (PR segment opens the PRCard popover; bead segment shows id/status/
claim). Renders **nothing** when the session has no repo, PR, or bead context
— plain chat stays clean. Checks segment polls on the §2 idiom.

## §5 Skill-invocation visibility

**Marker:** `<coven:skill name="brainstorming" stage="loaded|running|done|error"
note="optional" />` — parsed by the same `github-blocks.ts` extraction pass
(one streaming-safe scanner for all `coven:` card markers) — rendering a
**SkillStageCard**: skill
icon/name, stage progression (loaded → running → done), optional result note,
collapsible. Repeated markers for the same `name` in one turn update the card
in place rather than stacking.

**Deterministic path:** when the user invokes `/skill <name>`, `chat-view`
renders the card immediately (invoked → running → done when the turn settles)
without waiting for any marker — the app already knows.

**Filter interplay:** `AssistantFilter` keeps suppressing raw SKILL.md
leakage; the marker is the sanctioned channel and is extracted before
filtering can touch it (same ordering as next-paths).

## §6 Code-rail GitHub awareness

> **Removed 2026-07 (cave-ohcj):** see the §4 note — the failing-checks badge
> died with its only publisher (the stage header). Checks visibility now lives
> on the Code surface's PR panel.

Minimal by design: the rail strip (and its collapsed `</>` form) shows a
small failing-checks badge fed by `stage-model` when the session's PR has a
red rollup. No new tab, no new signals into `resolveCodeRail`'s reveal logic
— visibility lives in the header; the badge is a peripheral cue.

## §7 Error handling summary

- `patInvalid` → Connect GitHub affordance on every card/header (never a dead
  button).
- Rate limit → degrade to links, honor `x-ratelimit` headers, no poll
  tightening (activity-route precedent).
- Write failure → error state on the card with the GitHub message + retry;
  never silent, never optimistic-committed.
- Merge guards → server passes GitHub's branch-protection errors through
  verbatim; the card shows them (protection semantics stay on GitHub's side).
- Offline/daemon-less e2e → cards render from attrs; actions disabled.

## §8 Testing

- **Behavioral (node --test, wired into `scripts/run-tests.mjs` app suite):**
  `github-blocks` extraction incl. streaming partials and bare-line unfurl
  rules; `classifyGitHubAction` tiers; `stage-model` lane resolution parity
  with the queue's current outputs; skill-marker in-place update logic.
- **Route tests** (pattern: `assigned/route.test.ts`) for each new route:
  auth posture, param validation, GitHub error passthrough.
- **Contracts:** every new route in `api-contracts.test.ts` (Frontend build
  gate).
- **Wiring pins:** source-regex tests for the segment dispatch rendering
  GitHubCard/SkillStageCard and the header mount in the chat surface.
- **E2E (daemon-less, `COVEN_CAVE_E2E=1`):** one spec — paste a PR URL →
  card renders from `page.route` mocks → tier-2 merge shows confirm card →
  confirm fires mocked POST → card morphs to merged.

**Agent adoption (prompt contract):** a short doc section + harness system
line teaches agents the two markers (`coven:github`, `coven:skill`). Repo
skills (SKILL.md files) can add "emit `<coven:skill>` stage markers" lines
incrementally; no app-code dependency on adoption.

## §9 Implementation beads (one-PR units, dep-chained under cave-fpqx)

| Bead | Wave | Scope | Shipped |
| --- | --- | --- | --- |
| W1a | 1 | `github-blocks.ts` (markers + unfurl + tiers) · IssueCard/PRCard read-only · segment dispatch wiring · tests | PR #3166 |
| W1b | 1 | Checks rollup strip · ReviewThreadCard · 30s pending poll · in-place expansion | PR #3167 |
| W2a | 2 | Routes: `issue`, `commit`, `runs` (+contracts/tests) · T1 actions live on cards | PR #3170 |
| W2b | 2 | Routes: `review`, `merge`, `rerun`, `dispatch` · confirm-card lifecycle · agent proposal cards · e2e spec | PR #3183 |
| W3 | 3 | `stage-model.ts` extraction (queue refactored onto it) · `chat-stage-header` · wiring + tests | PR #3173 + #3174 |
| W4 | 4 | `<coven:skill>` marker + SkillStageCard · `/skill` deterministic card · filter-ordering pin | PR #3175 |
| W5 | 5 | Rail failing-checks badge from the stage broadcast | PR #3178 |

Each bead carries: this doc's section anchors, `external-ref` to its PR once
open, and verification evidence at close (MAP phase `cave-fpqx.3` is the
standing discipline of keeping that triangle intact; `cave-fpqx.5` re-audits
the capability map after the waves land).

## Acceptance criteria (from the goal, restated testably)

1. Pasting an issue/PR URL in chat renders a live card; comment/close from it
   without leaving the conversation (W1a/W2a). ✅ (e2e: URL → hydrated card)
2. Merge/review/re-run/dispatch reachable from cards behind tier-2 confirm;
   agent-emitted actions always appear as proposal cards (W2b). ✅ (e2e:
   confirm strip fires the exact payload; proposals never auto-fire)
3. A repo-linked session shows the stage header; its lanes match the familiar
   work queue for the same bead/PR (W3). ✅ (one shared stage-model)
4. `/skill` and agent-emitted `<coven:skill>` markers render stage cards
   (W4). ✅
5. Every wave lands as a green-checks PR with wired tests; capability map
   updated at VERIFY (`cave-fpqx.5`). ✅

## VERIFY re-audit (2026-07-15, cave-fpqx.5)

All five acceptance criteria hold on `main`; the DISCOVER capability map's
seven-gap summary is fully closed (see the postscript in
[the capability map](specs/2026-07-14-chat-github-capability-map.md)).
Residual gaps, filed as follow-up beads rather than blocking the epic:

- **Review-thread reply** — thread cards resolve/unresolve but can't reply in
  place (needs the review-comment reply endpoint); agent `reply` proposals
  fall back to conversation comments.
- ~~**Marker adoption directive**~~ — shipped (cave-kj6j):
  `buildCovenMarkersDirective` (`src/lib/coven-marker-directive.ts`) rides
  every chat turn beside the next-paths directive, teaching
  `<coven:github>` / `<coven:github-action>` / `<coven:skill>`; its test
  keeps the taught examples parseable by the real extractors.
- **Failing-tint consistency** — the stage header's ✕ and the card checks
  strip use `--color-warning`; the W5 rail dot uses `--color-danger`; pick
  one failing tint.
