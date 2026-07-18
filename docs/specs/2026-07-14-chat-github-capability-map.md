# Chat ↔ GitHub Capability Map

Date: 2026-07-14
Bead: cave-fpqx.1 (DISCOVER phase of epic cave-fpqx)
Goal: `chat-github-power-integration` — evolve the chat interface into a
fully-integrated GitHub-powered surface, seamless in chat and coding modes,
with visible skill invocation and stage tracking consistent across the chat
UI, GitHub, and Beads.

This is the DISCOVER-phase audit: what exists, what is partial, what is
missing. The PLAN phase turns the gaps into a design doc
(`docs/chat-github-integration.md`) and one-PR implementation beads under
epic cave-fpqx.

## 1. Chat vs coding modes

The chat↔coding seam is largely SOLVED by the shipped "Unified Chat + Code
Workspace" design (`docs/specs/2026-07-03-unified-chat-code-workspace-design.md`):
the separate `code` mode was retired (`src/components/workspace.tsx:1574`
redirects it to chat) and coding is now a **morphing right rail**
(`src/components/workspace-rail.tsx`, `src/lib/use-code-rail.ts` +
`resolveCodeRail` in `src/lib/code-rail.ts`) that smart-reveals
Changes/Files/Terminal when a session is repo-linked and fresh edits appear,
with pin/dismiss control. One surface, zero context loss by construction.

Orthogonal to that, "which brain" is harness/runtime selection:
`modelHarness = modelState?.harness ?? familiar.harness ?? "claude"`
(`src/components/chat-view.tsx:3144`), changed from the composer runtime chip
via `handleSelectRuntime` (defined ~2783, wired ~5820); the transcript is
preserved and a change applies to the next send.

| Capability | Status | Evidence |
| --- | --- | --- |
| One morphing chat+code surface (rail reveal, code mode retired) | EXISTS | workspace-rail.tsx; use-code-rail.ts; workspace.tsx:1574 |
| Runtime/harness switch mid-thread, transcript preserved | EXISTS | chat-view.tsx:3144, ~2783, ~5820 |
| GitHub signals feeding the rail reveal (PR/checks state) | MISSING | resolveCodeRail signals are repo/changes/terminal only (use-code-rail.ts:14-24) |
| Pending GitHub state as first-class workspace context | MISSING | no such concept in rail state or session state |

## 2. GitHub inside the chat surface today

The only GitHub presence in the thread surface is the composer git chip
(`ComposerGitChip`, chat-view.tsx:5826):
branch · dirty count · worktree · PR context, a branch menu backed by
`/api/changes?branches=1`, `switch-branch` action, and "New worktree…"
provisioning (PR #3134, goal `chat-git-ergonomics`).

The transcript renderer has no GitHub awareness: `MessageBubble` renders
generic links through `onOpenUrl` (`src/components/message-bubble.tsx`
~1176-1218) — no issue cards, PR cards, check status, review threads, or
commit references. `github-action-popover.tsx` exists but serves other
surfaces, not the thread.

| Capability | Status | Evidence |
| --- | --- | --- |
| Composer git context chip (branch/dirty/worktree/PR) | EXISTS | chat-view.tsx:5826; PR #3134 |
| Branch switch + worktree creation from chat | EXISTS | /api/changes actions; PR #3134 |
| Inline issue/PR cards in transcript | MISSING | message-bubble.tsx ~1176-1218 renders links only |
| Inline check/CI status in transcript | MISSING | — |
| Review threads readable/actionable in transcript | MISSING | — |

## 3. Structured thread blocks (extension points)

The renderer already supports rich structured content — this is where inline
GitHub cards plug in:

- `MessageBubbleSegment` block dispatch (message-bubble.tsx ~1172-1207;
  segments assembled in chat-view.tsx ~6263-6304).
- Tool cards: `ToolBlock` router (chat-view.tsx:6820) + settled-turn
  `ToolGroup` rollup (:6672), with per-tool status, args summary, duration.
- `ProgressGroup`/`ProgressRow` step display (:6588).
- Artifacts via `splitTextForArtifacts` + `ChatArtifactViewer` (~5904, ~6290).
- Next-paths suggestion chips via `extractNextPaths`
  (`src/lib/next-paths.ts:44`; chat-view.tsx:6253, :6504-6508).
- Diff/edit cards: `ToolBlock` + `EditCardActions` + `SyntaxBlock` (6820+).

Best-fit integration: grow the `segments`/`ToolBlock` dispatch with GitHub
card types (issue, PR-with-checks, review thread), passing callbacks through
`MessageBubbleProps` the same way `onOpenUrl`/`branchNav` flow today.

## 4. GitHub API layer (`/api/github/*`, 15 routes)

Read-heavy and solid; write actions are the gap. PAT lives in the encrypted
vault (`GITHUB_PAT`, `GITHUB_USERNAME`) via `/api/github/pat`
(`src/app/api/github/pat/route.ts:1-167`). REST-first; GraphQL only for
review threads/resolve and the curated star list.

| Domain | EXISTS | PARTIAL | MISSING |
| --- | --- | --- | --- |
| Issues | list assigned (`assigned`, `activity`), detail (`item`), comment (`comment`) | labels (read-only) | create, close/reopen, label edit |
| PRs | list, detail, comment, review threads view (`comments`) + resolve (`resolve-thread`), checks (`checks` + `activity` rollup) | — | create, merge, review submit (approve/request-changes) |
| Checks/CI | per-PR check runs + statuses + rollup; 30s polling while pending (github-view.tsx ~1705) | logs (URL passthrough only) | re-run |
| Commits | — | PR-scoped diffs via review comments | commit view/diff route |
| Actions | — | watcher polls completed runs (`src/lib/github-watcher.ts:101-123`) | runs list, workflow_dispatch, log view |
| Repos | org list + starred (`repos`, 15-min cache), subscribe/watch (`subscriptions` + 60s watcher → inbox) | general search | — |
| Activity | assigned/review-requested/authored feed with rate-limit awareness (`activity/route.ts:77-87`) | — | — |
| Account | PAT setup/verify, user identity (`pat`, `user`) | — | — |
| Worktrees | provision from issue/PR/notification (`worktree/route.ts:1-69`) | — | — |

Consumers today: `github-view.tsx` (the GitHub mode), `home-feed`,
`dashboard-cockpit`, `board-inspector`, `gh-review-actions`,
`github-subscriptions-modal`, `automations-view` — everything except the
composer chip lives outside the chat thread.

## 5. Skill invocation visibility

Skills are browsable (marketplace: `skill-browser.tsx`, `skill-card.tsx`)
and buildable (`/api/skills/build|draft|dry-run|local`;
`src/lib/server/skill-build.ts:17-107`), and chat can invoke one via the
`/skill` slash directive (slash menu + `skillCommandRows`, chat-view.tsx
~3138-3423). But nothing surfaces runtime
skill state in-thread: `AssistantFilter` actively suppresses leaked SKILL.md
headers (`src/lib/chat-assistant-filter.ts:90-145`), and `chat/send` handles
generic harness/tool events with no skill-specific artifact
(`src/app/api/chat/send/route.ts:1515-1615`).

| Capability | Status |
| --- | --- |
| Browse/install/build skills | EXISTS |
| Invoke skill from chat (`/skill`) | EXISTS |
| In-thread "skill X running / stage / result" | MISSING |
| Generic tool-call visibility (name, status, duration) | EXISTS (ToolBlock/ToolGroup) |

## 6. Stage tracking (chat / GitHub / Beads)

Stage exists in silos, none rendered inside the chat thread:

- Beads: `/api/beads` (ready/prime/show; create/claim/comment/close —
  `src/app/api/beads/route.ts:77-197`) + PR bridge
  (`src/app/api/beads/prs/route.ts:13-97`); the Familiar Work Queue joins
  ready beads with PRs into lanes — checks-failing / needs-review /
  ready-to-merge / waiting / post-merge-cleanup
  (`src/lib/beads-work-queue.ts:47-149`,
  `familiar-work-queue-view.tsx:302-585`).
- Board: `status` + `lifecycle` (queued → dispatched → running → review →
  completed/failed/cancelled; `src/lib/cave-board-types.ts:3-12,67-116`)
  with structured GitHub/Asana task links (`task-github.ts`, `task-asana.ts`).
- Sessions: running/done dots in chat-list (~123-131), live status in
  chat-surface (~155-178) and chat-view progress statuses (~6579-6687).
- GitHub: checks display + polling in github-view (~1632-1735).

| Capability | Status |
| --- | --- |
| Bead status via API + queue lanes | EXISTS |
| PR lifecycle lanes (queue) | EXISTS |
| Board lifecycle badges | EXISTS |
| Unified cross-surface stage model | MISSING |
| Any stage rendering inside the chat thread | MISSING |

## 7. Gap summary → PLAN inputs

1. Inline GitHub cards in the transcript (issue / PR-with-checks / review
   thread), plugged into the `segments`/`ToolBlock` dispatch, reusing
   `/api/github/item|checks|comments` and the queue's check-rollup idioms.
2. GitHub write actions: issue create/close, PR create/merge, review submit,
   check re-run, workflow dispatch — new API routes (each registered in
   `api-contracts.test.ts`) with an explicit in-chat confirmation UX
   (product decision to surface to the user).
3. Chat↔coding gesture is SHIPPED (unified workspace, morphing code rail) —
   the remaining work is GitHub-awareness: PR/checks signals as rail inputs
   and/or a GitHub tab in the rail, plus pending-GitHub-state continuity.
4. Skill-stage surfacing: emit a structured in-thread block when a skill
   loads/progresses/completes instead of filtering all traces out.
5. Unified stage chip: one stage model (bead ↔ PR ↔ session) rendered
   in-thread, fed by `/api/beads/prs` + `beads-work-queue` lanes.

Required checks (live-verified 2026-07-14): Frontend build, Rust check,
E2E (Playwright), Cross-environment required, Sidecar runtime required.

---

## Postscript: VERIFY re-audit (2026-07-15, cave-fpqx.5)

Every gap in §7 closed across seven merged waves (all required checks green;
design: [chat-github-integration.md](../chat-github-integration.md)):

| §7 gap | Shipped by |
| --- | --- |
| 1. Inline GitHub cards in the transcript | W1a #3166 (markers + bare-line unfurl + Issue/PR cards) · W1b #3167 (checks strip, review threads, in-place expansion) |
| 2. GitHub write actions | W2a #3170 (issue create/state, commit, runs + tier-1 card actions) · W2b #3183 (review/merge/rerun/dispatch, tier-2 confirm strip, agent proposal cards that never auto-fire, daemon-less e2e) |
| 3. Rail GitHub-awareness | W5 #3178 (failing-checks badge on the rail strip + collapsed reopen, fed by the stage broadcast — reveal resolver untouched) |
| 4. Skill-stage surfacing | W4 #3175 (`<coven:skill>` markers → SkillStageCard on streaming+settled turns; deterministic `/skill` invoked card; AssistantFilter passthrough pinned) |
| 5. Unified stage chip | W3 #3173+#3174 (`stage-model.ts` shared by queue + new chat stage header: bead → PR → checks → review → merged) |

Updated capability verdicts: §1 rail GitHub signals EXISTS (badge);
§2 inline issue/PR/check/review cards EXISTS; §4 write side EXISTS
(issue create/close, PR create remains out of scope by design, review
submit, merge, re-run, dispatch); §5 in-thread skill stage EXISTS;
§6 unified stage model + in-thread stage EXISTS.

Residual follow-ups (non-blocking, filed as beads): commit/run card
hydration, review-thread in-place reply, marker adoption prompt directive,
failing-tint consistency.
