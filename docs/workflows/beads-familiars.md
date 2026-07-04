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
pnpm beads:doctor
pnpm beads:sync
```

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
