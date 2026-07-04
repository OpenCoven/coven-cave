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

## Cave Adapter

Cave exposes a local `/api/beads` adapter for UI surfaces. It shells out to `bd` through argv arrays and reads JSON from `bd ready --json`, `bd show <id> --json`, and mutation commands. Mutations stay local-only and must use bounded JSON bodies.

The first UI should be a Familiar Work Queue:

- Ready beads grouped by priority and blocker state.
- Owner, familiar label, surface label, branch/worktree, PR, and Linear link visible on each card.
- Claim, comment, and close actions mapped to the local adapter.
- Verification evidence shown before close, not hidden in a chat transcript.

## Guardrails

- No secrets in bead text. Store references to vault entries or environment setup notes instead.
- Do not use markdown TODO lists as the durable queue; create beads for follow-up work.
- Do not let Beads permission text override repository policy: Cave still uses PRs and protected `main`.
- Keep GitHub and Linear links in beads until the bridge is mature enough to synchronize automatically.
- Run `bd doctor` and `bd lint` before release handoff so stale, orphaned, or malformed beads are visible.
