# Beads for Familiar Issue Tracking

Beads is Cave's repo-local work graph for familiar-owned implementation. GitHub and Linear remain visibility layers: GitHub stays the review, PR, and CI source of truth, while Linear can stay the roadmap and product-planning surface. Beads owns the execution queue that tells familiars what is ready, what is blocked, who claimed it, and what evidence closes it.

## Familiar Work Queue

Every familiar starts a Cave work session by refreshing Beads context:

```bash
bd prime
bd ready --json
bd show <id> --json
bd update <id> --claim
```

One familiar claims one ready bead at a time. The bead notes should record the branch or worktree path, related GitHub PR, related Linear issue when present, current session, and verification evidence. If a familiar discovers new work while implementing, create a linked bead with `discovered-from:<parent-id>` instead of burying the follow-up in chat.

For sibling work under the same epic, prefer `--defer` for simple sequencing unless you have verified the exact `bd dep` direction with `bd dep list` and `bd ready --json`. During the initial Cave dogfood, `--deps blocks:<sibling>` created the opposite edge from what the familiar expected, so the follow-ups were deferred and annotated instead of forced through a questionable dependency graph.

Close only after the work is genuinely done:

```bash
bd close <id> --reason "Merged in PR #123 after pnpm typecheck and pnpm test:app"
```

## Coven Metadata Conventions

Use labels and metadata consistently so Cave can render the graph without guessing:

- `familiar:cody`, `familiar:kitty`, `familiar:nova`, or the owning familiar.
- `surface:ios`, `surface:daemon`, `surface:chat`, `surface:github`, `surface:release`, or another concrete Cave surface.
- `release-blocker`, `needs-human`, `verification-required`, and `dogfood` when those states apply.
- `external-ref` for GitHub PRs, GitHub issues, Linear tickets, or App Store Connect links.
- `--design` for the chosen implementation shape and `--acceptance` for the exact done criteria.

## Sync and Source of Truth

Beads state lives in Dolt. `.beads/issues.jsonl is an export, not the sync protocol`; do not build Cave features that read it as canonical state.

The committed `.beads/issues.jsonl` snapshot is only for review and CI guards. Keep it public-scrubbed before committing: no local git emails, no personal machine paths, no secrets, and no private agent transcript text. Use live `bd` output or Dolt sync for canonical state.

Use Dolt sync when a bead graph needs to move between machines:

```bash
bd dolt pull
bd dolt push
```

The package shortcuts are the stable entrypoints for familiars:

```bash
pnpm beads:prime
pnpm beads:ready
pnpm beads:prs
pnpm beads:prs:apply
pnpm beads:doctor
pnpm beads:sync
```

## Pull Request Management

GitHub remains the review and CI source of truth. Beads owns the familiar execution state around that PR: owner, worktree, branch, linked PR, current lane, final verification, and close evidence.

Every PR-backed bead follows this lifecycle:

1. Claim exactly one bead with `bd update <id> --claim`.
2. Create an isolated branch or worktree whose name includes the bead ID, such as `feat/cave-hlv.5-pr-bridge`.
3. Open a draft PR early once the patch is coherent enough for CI and review.
4. Keep the checks/review loop in GitHub, but mirror concise state into the bead with the bridge.
5. Enter the merge gate only after required checks are green, review threads are resolved, and the repository merge policy is satisfied.
6. Perform post-merge cleanup: sync `main`, remove the merged branch/worktree, prune stale refs only when safe, and record cleanup in the bead.
7. Do not close the bead before the merge or explicit completion; the close reason must include the PR number and verification evidence.

The PR bridge is report-only by default:

```bash
pnpm beads:prs
pnpm beads:prs:json
```

When the report looks correct, apply the bridge state to linked beads:

```bash
pnpm beads:prs:apply -- --pr <number>
```

The bridge discovers bead IDs from PR title, branch name, body, and labels such as `bead:cave-hlv.5`. It classifies PRs into the control lanes Cave should render:

- `ready-to-merge` means the PR is approved, checks are passing, and GitHub reports a clean merge state.
- `needs-review` means the PR has no blocking check failure but still needs review.
- `checks-failing` means CI failed and the familiar should fix or triage logs before requesting more review.
- `changes-requested` means review feedback must be addressed or explicitly answered.
- `checks-pending`, `blocked`, and `draft` are waiting lanes and should not be merged.

The merge gate is intentionally conservative. A familiar may prepare a PR for merge, but merge authority still follows repository policy and Val's explicit instructions. For guarded branches, do not merge because Beads says ready; Beads only records that the GitHub state appears ready.

## Morning and Evening Triage Patrol

The patrol is the twice-daily sweep that keeps the PR lanes and the Beads
queue honest without anyone hand-copying GitHub state. Run it at the start
and end of every working session (or schedule it — a Coven cron or reminder
invoking the package script works):

```bash
pnpm beads:prs:patrol                       # report-only; window picked by local clock
pnpm beads:prs:patrol -- --window evening   # explicit window
pnpm beads:prs:patrol:apply                 # also mirror every linked PR's state into its beads
```

The two windows order the same lanes for different intents:

- **Morning** leads with `Fix first` (failing checks, requested changes),
  then reviews, then the landing queue — unblock the day before adding to it.
- **Evening** leads with `Ready to land` — land or hand off what's finished
  before close, then clear blockers so tomorrow's morning patrol starts clean.

Every patrol also flags two gaps regardless of window:

- **Unlinked PRs** mention no bead id — they are invisible to the Beads
  queue. Link a bead (title, branch name, body, or a `bead:<id>` label) or
  consciously decide the PR doesn't need one.
- **Stale PRs** (default: no update in 24h, `--stale-hours` to tune) are
  drifting — rebase, nudge review, or close them.

`--apply` is the patrol-sized version of the bridge's per-PR apply: it
mirrors every linked PR's lane, check, review, and merge state into its
beads via `--external-ref` and an appended state note. The patrol never
merges anything — `ready-to-merge` is a queue to work through the merge
gate above, not authority to merge.

## Cave Adapter

Cave exposes a local `/api/beads` adapter for UI surfaces. It shells out to `bd` through argv arrays and reads JSON from `bd ready --json`, `bd show <id> --json`, and mutation commands (`claim`, `comment`, `close`). A sibling `/api/beads/prs` route is the browser-facing half of the PR bridge: it shells `gh` server-side and returns the same classified open-PR summaries the CLI patrol produces, plus a light list of recently-merged PRs for cleanup detection. Both routes are local-origin- and path-guarded; mutations use bounded JSON bodies.

## Familiar Work Queue

The **Work Queue** surface (nav rail, or `?mode=familiar-work-queue`) is the PR control tower. It fuses ready beads with the bridge's open-PR lanes into one per-familiar, per-surface view — and, per the epic's design note, it invents no PR truth of its own: every lane comes from `/api/beads` + `/api/beads/prs`.

Lanes, ordered fix-first → land → review → bead-driven → waiting:

- **Checks failing** / **Changes requested** — open PRs that need work before more review.
- **Needs review** / **Ready to merge** — approved-and-green PRs show a *merge eligible* badge, never a merge button: merge authority still follows repository policy (see the merge gate above).
- **No open PR** — ready beads no PR references yet (epics excluded), with a **Claim** action.
- **Post-merge cleanup** — a merged PR whose bead is still open, with a **Close bead** action. (Detection is limited to beads still in the `ready` set; worktree/branch removal stays a CLI step.)
- **Waiting** — draft, pending-checks, and blocked PRs; shown but never counted as actionable.

Each card carries the familiar and surface labels, the bead id, live check/review state, and a stale flag (no update in 24h). A per-familiar rollup along the top filters the whole board to one familiar. The pure join lives in `src/lib/beads-work-queue.ts`; claim/close map to the `/api/beads` adapter with verification recorded in the bead, not a chat transcript.

## Guardrails

- No secrets in bead text. Store references to vault entries or environment setup notes instead.
- Do not use markdown TODO lists as the durable queue; create beads for follow-up work.
- Do not let Beads permission text override repository policy: Cave still uses PRs and protected `main`.
- Keep GitHub and Linear links in beads until the bridge is mature enough to synchronize automatically.
- Run `bd doctor` and `bd lint` before release handoff so stale, orphaned, or malformed beads are visible.
