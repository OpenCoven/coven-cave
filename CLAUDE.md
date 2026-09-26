# Coven Cave: Claude Code project notes

Start with [AGENTS.md](AGENTS.md) for the development workflow, design contract,
and contributor attribution. This file adds protected-branch diagnostics and
native-development details rather than another task-tracking protocol.

## Work continuity before starting

Before creating, claiming, planning, resuming, or delegating multi-step work,
load [work-continuity](.agents/skills/work-continuity/SKILL.md). If the skill
dispatcher does not index it, read that exact file directly.

Follow [the living procedure](docs/workflows/work-continuity.md): inspect
authorized GitHub issues, Project items, PRs, and explicit execution references.
Match outcome and target, preserve existing owners and original messages, and
propose a continuation rather than starting competing work. Unknown coverage
is not "no match"; a saved issue comment is not a delivered handoff.
Skip broad discovery for ordinary independent one-turn answers.

## GitHub-first development

[GitHub work tracking](docs/workflows/github-work-tracking.md) owns the issue,
Project, worktree, and handoff procedure. Do not maintain a second queue.

Use `bash scripts/install-git-hooks.sh` to point Git at the secret and
contributor guards.

## Branch protection on `main`

Every agent change lands through a pull request. Never push `main` or
`HEAD:main`, use `gh pr merge --admin`, or change protection to clear a blocker.
`GH006: Protected branch update failed` means use a branch and a PR.
The owner's standing `enforce_admins = false` exemption belongs to the owner,
not the agent. Do not change that setting in either direction.

Inspect current policy instead of diagnosing a generic merge refusal by guess:

```bash
gh api repos/OpenCoven/coven-cave/branches/main/protection
gh pr view <#> --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup
gh pr checks <#> --required
```

The documented policy is:

- Required status checks: **ONE** must pass: `Frontend build`. Routine PR CI
  and release coverage are defined by their current workflow files.
- PRs require zero approving reviews, but agents still read the review.
- Review conversations are **no longer required to be resolved**. Read every
  thread and paginated comment anyway; resolve only with authority and a
  documented disposition.
- Commit signatures are **NOT required** (`required_signatures: false`).
  Sign when possible; do not treat an unsigned commit as a blocker.
- Branches do **not** need to be up to date with `main` (`strict: false`).
  Rebase your own branch only for a real conflict or needed base changes.
- `CodeQL` can run through GitHub default setup but is advisory, not the
  documented required context. A neutral conclusion is not a failure.
- Force-pushes and deletion of `main` are blocked. Ruleset `19123333` is
  disabled; classic branch protection is the active enforcement layer.

When policy changes, update the guide and its contract together. A proposed
replacement check is not permission to remove `Frontend build`.
Preserve native iOS coverage when retiring duplicate lanes.

A PR that is `BLOCKED` with no visible failure may have a missing required
context, signature policy, or changed conversation policy. Check those fields
directly. Local `git log --show-signature` and `%G?` are not reliable in this
checkout without an allowed-signers file; use GitHub's
`commit.verification.verified` when signature evidence matters.

Review requests stay read-only. Pending, missing, stale, cancelled, or failed
checks are incomplete. Do not repair, push, merge, or resolve threads without
separate authority.

## Exact-head PR lifecycle

Use [branch-to-merge](.agents/skills/branch-to-merge/SKILL.md) for the full
authorized sequence. Reuse an existing PR for the branch and link the issue.
Do not commit from the shared primary checkout or stage another session's
changes.

Read all review threads and their comments:

```bash
gh api graphql -f query='{repository(owner:"OpenCoven",name:"coven-cave"){pullRequest(number:<#>){reviewThreads(first:100){pageInfo{hasNextPage endCursor} nodes{id isResolved path comments(first:100){pageInfo{hasNextPage endCursor} nodes{author{login} body}}}}}}}'
```

If `hasNextPage` is true, page with
`reviewThreads(first:100, after:"<endCursor>")` until false. Also page each
thread's comments when its comment connection has another page. A partial
listing does not establish that every comment was reviewed.

Once merging is authorized, bind the final check and merge to the exact head
in the same shell:

```bash
set -euo pipefail
expected_head=$(git rev-parse HEAD)
actual_head=$(gh pr view <#> --json headRefOid --jq .headRefOid)
test "$actual_head" = "$expected_head"
gh pr checks <#> --required
squash_input=$(mktemp)
squash_message=$(mktemp)
trap 'rm -f "$squash_input" "$squash_message"' EXIT
gh pr view <#> --json title,body,commits > "$squash_input"
node scripts/pr-squash-message.mjs < "$squash_input" > "$squash_message"
squash_subject=$(jq -er .subject "$squash_message")
squash_body=$(jq -er .body "$squash_message")
gh pr merge <#> --squash --match-head-commit "$expected_head" --subject "$squash_subject" --body "$squash_body"
```

Do not pass `--delete-branch`. Local retirement requires separate evidence and
authority; remote deletion remains proposal-only. Preserve human numeric
GitHub no-reply trailers. Do not add AI attribution to commits or PRs.

## Worktree convention

Use issue-owned worktrees under `.worktrees/`, created from current
`origin/main` with `--no-track`. Record owner, purpose, branch, path, and
starting OID on the GitHub issue. See the canonical guide's worktree budget
and creation procedure.

Do not symlink `node_modules`, force-remove a dirty tree, clear a foreign lock,
or manufacture old lifecycle metadata. A missing legacy maintenance plane or
unknown owner does not authorize cleanup. If gate-incomplete, preserve the unit.

Read local state with `pnpm wt:status`. `WEDGED` means a merge, rebase, or
another Git operation is paused. Inspect touched paths and ownership before
finishing or aborting; unreadable state fails closed. A `SAFE-RETIRE` label is
not a live-owner or remote-retention receipt.

Use [branch-curator](.agents/skills/branch-curator/SKILL.md) for bounded removal.
Prove the exact branch head retained on the remote before deletion; a squash
merge alone does not retain it. A local-only archive tag does not count.
Preserve inaccessible worktrees unless the authorized de-registration proof
is complete, and describe de-registration honestly: the directory remains.

## CI and main-health diagnostics

Playwright's CI path is daemon-less (`COVEN_CAVE_E2E=1`). Dismiss onboarding
with `cave:onboarding:dismissed=1` and use scoped API mocks instead of expecting
a live daemon.

For missing CI delivery, use `pnpm ci:recovery` in read-only mode with the
documented repository/token environment. Apply mode requires operator
authorization and exact-head revalidation. A legacy workflow dispatch can
resolve a newer branch head; it does not promise exact-SHA coverage.

Use `pnpm main:health` to identify the oldest known failing commit after the
last green commit. Cancelled runs and unavailable associations are not proof
of blame or health. Recovery never repairs or bypasses branch protection.
Repeated cancelled runs can reflect concurrent pushes rather than a CI defect.

### Base movement versus stale evidence

The non-strict policy allows `main` to advance during a PR run. The selector
records its base snapshot for path selection, and the final gate reports that
snapshot and the live base without treating their difference as failure.
This does not waive exact-head validation: successful evidence must belong to
the same workflow run and attempt, with timestamps no earlier than that
attempt's start. Every selected prerequisite must still succeed, including
each matrix family; cancelled, skipped, or failed required work cannot pass.
PR checkouts retain their content-based merge-tree freshness guards.

Retry the whole workflow for stale head/attempt evidence, not only failed jobs:
GitHub can relabel carried-forward successes with a new attempt number while
retaining their original timestamps. A fresh pass on an earlier PR head is
still not authority to merge the current head.

## Starting the Tauri desktop app

Use `bash scripts/dev-app.sh` for native-only surfaces and keep its terminal
attached. `COVEN_CAVE_PORT` takes precedence over `PORT`, then the fixed
default `3000`. The wrapper does not scan ports, attaches only to an identified
Cave server, and owns the child processes it starts.

First-launch Rust compilation can take several minutes. Stop with `Ctrl-C`.
The watchdog closes the shell after a sustained origin outage; the dev-only
recovery overlay handles short outages and reloads stale chunks.
Use the default browser for web-only work, not a Codex browser preview.

### Long-running dev-server memory

Turbopack HMR generations, React dev debug capture, and Flight registries can
retain memory during extended edit churn. The existing investigation found no
Cave constructor among the leading retainers (issue #3803).

Restart the dev server when `[heap-monitor]` reports pressure. A larger
`COVEN_CAVE_HEAP_LIMIT_MB` delays the same unbounded dev retention; it is not
a fix. The monitor warns at 85% and captures one snapshot per episode at 95%.
Read large captures with `scripts/analyze-heapsnapshot.mjs`, not a browser
that cannot load them.

Use a production build for sustained verification. Keep heap policy in
`scripts/heap-limits.mjs` and its Rust counterpart, not another per-launch copy.

## Local remote hygiene and concurrent sessions

Use `pnpm remotes:audit` for the local, read-only report. Repair only with
authority. It does not justify remote branch deletion.
Preserve `fetch.pruneTags = false`: archive and retention tags are recovery
evidence. Clear a bogus upstream, not a correct self-tracking upstream that
also records prior publication.

Read `docs/multi-session-coordination.md` before structural changes.
The surface-claim hook is advisory. Worktree guards block destructive
operations; auto-locks protect at-risk work; retention pushes preserve heads.
None of them grants ownership or permission to bypass a current no-push rule.
Record dirty paths, never just a count. Leave unknown owners and foreign locks
alone.

## New surface CSS

Import a gated surface's own stylesheet from its component. Do not add it to
`src/app/globals.css` or append it to a globally imported unrelated sheet.
The root CSS budget has little headroom, and every route otherwise pays for
styles used by one dialog or mode.

Keep the token, cascade, accessibility, and copy contracts in `AGENTS.md` and
`docs/coven-design-language.md`. Reuse existing primitives rather than creating
another local wrapper or token palette.
