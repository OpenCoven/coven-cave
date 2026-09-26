# GitHub work tracking

Use GitHub Issues for durable development work and the
[Cave Project](https://github.com/orgs/OpenCoven/projects/9) for planning.
Keep one issue per outcome, not one task per conversation or agent.

```bash
gh issue list --repo OpenCoven/coven-cave --state open --limit 20
gh issue view 5399 --repo OpenCoven/coven-cave --comments
gh project view 9 --owner OpenCoven
```

`pnpm work:issues` and `pnpm work:project` are read-only shortcuts for these
entrypoints. A bounded list is a starting point, not proof that no work matches.

Issue #5399 moved development tracking to GitHub on 2026-09-14. Issue #5566
removes Beads from the repository in stages: its data, tooling, and guidance
first, then the worktree lifecycle tooling and the product surfaces.

## Find and own the work

Load [work continuity](work-continuity.md) before starting multi-step work.
Prefer an explicit issue, PR, or artifact reference. Otherwise, search
distinctive outcome and target terms in this repository:

```bash
gh issue list --repo OpenCoven/coven-cave --state all \
  --search 'work tracking in:title,body' --limit 20
gh pr list --repo OpenCoven/coven-cave --state all \
  --search 'work tracking in:title,body' --limit 20
```

Read candidate issues, owner comments, linked PRs, and completion evidence,
including closed issues and PRs before declaring that no matching work exists.
A result at its limit is potentially truncated; narrow or paginate the search.
An empty result is not proof that an inaccessible execution source has no
matching work.

Reuse the canonical issue. Create a new issue only for a distinct authorized
outcome. Preserve existing owners, dependencies, approval requirements, and
original messages. An old status or a missing process does not authorize
takeover.

Record the acting familiar, exact scope, branch, worktree, and next step in an
issue comment before editing. Use assignees only for real GitHub accounts.
Re-read ownership before proceeding. GitHub assignment and comments are
coordination records, not atomic execution leases.

Keep implementation decisions and evidence in the issue or linked approved
documents. Do not maintain a parallel queue or a permanent local
Markdown task list.

## Use the existing Project

Add the issue to Cave rather than creating another board:

```bash
gh project item-add 9 --owner OpenCoven \
  --url https://github.com/OpenCoven/coven-cave/issues/5399
gh project field-list 9 --owner OpenCoven --format json
```

The current `Status` options are `Todo`, `Started`, and `Done`. Resolve field
and option IDs from `field-list` before scripting updates; do not assume IDs
from another Project.

| Situation | Project status | Issue record |
| --- | --- | --- |
| Ready, deferred, or awaiting pickup | `Todo` | Scope and imperative next step |
| Being worked on now | `Started` | Current owner, branch/worktree, and scope |
| Blocked or waiting on approval | `Todo` | Named primary blocker, unresolved dependencies, next step, and responsible actor |
| Merged or explicit completion criteria met | `Done` | Completion evidence and local worktree disposition |

Use the existing `Blocked by` and `Surface` fields when helpful. A blocked
item must name what clears the blocker; a model's confidence is not approval.
Do not leave a stopped session marked `Started`.

Old Project items may carry `Bead ID`, `Bead status`, and `Bead owner`
fields. They are historical notes; do not delete them as part of ordinary work.

## Git hooks

Keep the existing secret-scanning and contributor-attribution hooks:

```bash
bash scripts/install-git-hooks.sh
git config --get core.hooksPath
```

The installer points `core.hooksPath` at `scripts/git-hooks`. It preserves a
different, existing hook directory and warns about any guard missing from it.
A configured directory that no longer exists, such as the removed
`.beads/hooks`, is replaced. It also drops a stale `merge.beads-jsonl` driver
section left in older clones. Do not use `--no-verify` or an empty hook path.

The automatic `SessionEnd` cleanup hook and `wt:retire-on-exit` shortcut are
removed. Stale calls to `scripts/worktree-session-exit-retirement.mjs` exit 2
before any status probe or Git operation. A local `SAFE-RETIRE` verdict cannot
authorize unlocking another session's checkout or deleting its worktree/branch.

The old `worktree-sweep.sh` exits with an explicit retirement refusal before
running any tracker or Git operation. Remove machine-specific schedules that
still invoke it; repository changes do not uninstall external scheduler entries.
The read-only hygiene report does not run a lifecycle inventory. Its `park`
and `unpark --apply` paths are unavailable; they must refuse before mutation,
not skip a safety gate.

## Worktrees

Start from current `origin/main` and isolate changes from the shared checkout:

```bash
git fetch origin main
pnpm wt:status
git worktree list --porcelain
git worktree add --no-track -b <branch> .worktrees/<slug> origin/main
```

Use an issue-based name such as `fix/issue-123-example`. Record its path,
purpose, owner, and starting commit on the issue. `--no-track` prevents a
feature branch from inheriting `origin/main` as its upstream.

The working budget remains 28 registered worktrees. Count the whole checkout,
including its primary worktree. At the limit, preserve existing units and
obtain an attributed, scoped exception on the issue before creating another;
do not remove somebody else's unit to make room.

The managed worktree creator and lifecycle patrol were removed with Beads
(#5566). Do not manufacture `metadata.coven.worktree` records. An `uncertain`
classification in older patrol output is not permission to delete a worktree.

`pnpm wt:status` is local evidence, not an ownership or deletion receipt.
A paused merge/rebase can look like ordinary dirtiness. Preserve every dirty
path, other owners' work, foreign locks, and uncertain units.

## Pull requests and completion

`main` stays canonical and protected. Do not push directly to it, use
`gh pr merge --admin`, alter protection, or assume the maintainer's exemption.
Do not commit, push, or merge without the current request's authority.

Use [branch-to-merge](../../.agents/skills/branch-to-merge/SKILL.md) when
authorized to land work. Reuse an existing PR for the branch, link the issue,
and review the exact current head. Read all review threads and paginated
comments. Required checks must pass on that head; pending, missing, stale,
cancelled, or failed results are incomplete.

A review-only request stays read-only. Do not repair, push, merge, resolve
threads, or change PR state unless separately authorized.

At handoff, record changed paths, relevant evidence, branch/worktree, owner,
remaining blocker, and one imperative next step. If work is only prepared
locally, say so. A plan or an unmerged implementation does not close the issue.
Close after merge or the issue's explicit completion criteria, not after
writing a proposal.

## Preserve before retirement

Issue completion and local deletion are separate decisions. Record the
worktree as removed and verified, or intentionally preserved with an owner
and reason.

Use [branch-curator](../../.agents/skills/branch-curator/SKILL.md) for any
removal. It must require explicit scope, exact current OIDs, clean state,
retention on a verified remote ref, and evidence that no live owner needs the
unit. A merged squash PR does not retain the branch's own commits.

When needed, preserve the exact head with a pushed `archive/` or `retention/`
tag before authorized local retirement. A local-only tag does not count.
Never remove a dirty tree, override another owner's lock, or infer that a
remote branch is retained from a stale tracking ref. Remote deletion remains
proposal-only.

The missing legacy maintenance planes are not made safe by changing trackers.
No GitHub issue comment replaces a runtime exclusion lock. Preserve a unit
whenever the required evidence or authority is unavailable.

## Legacy references

Historical plans, specs, and CHANGELOG entries cite old `cave-*` Bead IDs.
They are evidence, not the current operating guide. When legacy work is
intentionally resumed, create one scoped issue for the outcome and cite the
old ID; do not bulk-import old records or reopen completed work.
