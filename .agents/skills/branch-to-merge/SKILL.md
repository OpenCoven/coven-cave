---
name: branch-to-merge
description: Use when finishing work on a Coven Cave branch and landing it on protected `main`; verification, pull request, required checks, review threads, squash merge, and evidence-backed retirement. Trigger on "merge this", "finish the branch", "land this work", "open a PR", "branch to merge", "done with this branch", or "clean up after the merge".
---

# Branch To Merge

Take a finished branch to a merged commit on `main` without ever writing to
`main` directly and without destroying another session's work.

`main` in this repository is protected: pull request required, one required
status check, no force-push, no deletion. A pull request is
the **only** path an agent may use. This skill is the Cave-specific replacement
for generic "finish a branch" workflows that offer a local merge into the base
branch — that option does not exist here.

## Core rule

Follow [GitHub work tracking](../../../docs/workflows/github-work-tracking.md)
for issue ownership, Cave Project 9, worktrees, and completion. Do not
maintain a parallel queue.

With current authority, verify, push, reuse or open a PR, read checks and
review, then squash-merge through `gh`. Record the local unit's disposition;
retirement is a separate, evidence-backed decision. Preserve ambiguity.
Do not commit, push, or merge without the current request's authority.
A review-only request stays read-only.

**Never** run any of these:

```bash
git checkout main && git merge <branch>
git push origin main
gh pr merge <#> --admin
```

If a change cannot go through a PR, stop and surface it to the maintainer.

Force-pushing is not banned outright — rebasing your own PR branch is a normal
part of Phase 2. Never force-push a branch you do not own, and never force-push
away commits nothing else retains.

## Skill type

**RIGID** — run the phases in order. Do not skip verification, do not invent a
merge strategy, do not delete anything without the proof each phase names.

## Phase 0: Confirm the unit of work

[HARD-GATE] Before touching the branch, establish its canonical GitHub issue,
current owner, and authorized scope using the guide's continuity procedure.

```bash
gh issue view <issue-number> --repo OpenCoven/coven-cave --comments
git fetch origin main        # refresh origin/main before any new branch
git rev-parse --abbrev-ref HEAD
root=$(git rev-parse --show-toplevel) && \
  primary=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)") && \
  test "$root" != "$primary" || { printf '%s\n' 'refusing to commit from the primary checkout'; exit 1; }
```

- Reuse the issue and its existing worktree. Read owner comments and linked
  execution evidence; re-read ownership before acting. Missing evidence or a
  legacy status does not authorize takeover. GitHub assignment and comments
  are not atomic execution leases.
- Record the acting familiar, scope, branch, worktree, and next step on the
  issue when authorized. Preserve human-authored dependencies and approvals.
- Work from the branch's own worktree. The primary checkout usually holds other
  sessions' uncommitted files; committing from there sweeps up their work.
- If a new worktree is authorized, complete the guide's ownership and
  28-worktree budget review first, including any attributed, scoped exception:

  ```bash
  git worktree add --no-track -b <branch> .worktrees/<slug> origin/main
  ```

  Record the starting OID on the issue. Do not manufacture lifecycle
  metadata to satisfy a retired creator or patrol.

## Phase 1: Verify before anything else

[HARD-GATE] Do not push, open, or merge a PR on unverified work. "It passed
earlier" is not verification. Use the smallest existing selectors that cover
the scoped diff, grouped by runner. Documentation-only changes need their
related contracts, not an unrelated application build or full suite.

Select the relevant commands below for code changes; escalate to full suites
only when targeted evidence requires them:

```bash
pnpm typecheck
pnpm lint                 # includes the design-token ESLint gate + codemod check
pnpm test:app
pnpm test:api
pnpm check:tests-wired    # a new test file that no runner invokes is not a test
```

Add `pnpm test:e2e`, `pnpm test:mobile`, or `cargo check` when the diff touches
those surfaces. Touching UI? Walk §9 of `docs/coven-design-language.md` first.

Then confirm the diff is PR-shaped:

```bash
git status --porcelain
git --no-pager diff origin/main...HEAD --stat
```

Every path in the diff must belong to this issue's scope. Unrelated files mean you
committed someone else's work — split them out before continuing.

If verification fails, **STOP** and fix it. A red PR wastes the reviewer and
burns the required CI run.

## Phase 2: Base branch

The base is always `main`. There is no auto-detection to perform and no
`develop` branch to consider.

```bash
git fetch origin
git --no-pager log --oneline HEAD..origin/main | head
```

Branch protection sets `strict: false`, so **being behind `main` never blocks a
merge**. Rebase only when you need `main`'s newer commits to test against or to
resolve a real conflict — and rebase in your own worktree, never by touching
`main`.

| Divergence | Action |
|---|---|
| `main` has 0 new commits | Proceed |
| `main` has new commits, no conflict | Proceed; rebase only if you need them |
| Merge conflict reported on the PR | Rebase onto `origin/main` in the worktree, re-verify, force-push **your** branch |

## Phase 3: Present the options

Only two endings exist here. First discover whether the branch already has an
open PR — never try to create a duplicate:

```bash
branch=$(git branch --show-current)
gh pr list --head "$branch" --base main --state open --json number,url,headRefOid
```

Present exactly these:

```
How would you like to finish this branch?

  A) Continue through a PR -- push, create one if none exists, or use the existing PR; land it via squash merge
  B) Leave as-is           -- keep the branch and worktree, decide later
```

Use only the option authorized by the current request. If authority is missing,
ask in an interactive session; otherwise preserve the branch and report what
is needed. Do not infer permission to commit, push, merge, or delete.
An open-PR-only request stops after the PR is created or updated; it does not
authorize the merge.

A local merge into `main` and a squash-commit onto `main` are deliberately
absent: branch protection rejects the push (`GH006`) for a non-admin, and the
owner's admin exemption is theirs, not yours.

If the answer is B, say so plainly and stop — no cleanup, no worktree removal,
no branch deletion. An unfinished branch is preserved by default.

## Phase 4: Create or bind the pull request

Sign commits when you can, but `required_signatures: false` means an unsigned
commit is not a merge blocker. When both commit and push are authorized, push
after every commit so another local actor cannot destroy the only copy.
A no-push instruction still wins; report local-only work honestly.

```bash
branch=$(git branch --show-current)
git push -u origin "$branch"
gh pr list --head "$branch" --base main --state open --json number,url,headRefOid
```

If the listing is empty, create the PR:

```bash
gh pr create --base main --head "$branch" --title "…" --body "…"
```

If it contains exactly one PR, reuse it; do not run `gh pr create`. If it
contains more than one PR, or its base/head is not the intended `main`/branch
pair, stop and ask the maintainer to resolve the ambiguity rather than guessing.

**Title** — imperative, under ~70 characters, describes the change not the
branch name.

**Body**: what changed and why, the verification you actually ran, and the
canonical GitHub issue link. Do not duplicate its task record.

[HARD-GATE] **No AI attribution.** Never add `Co-Authored-By: <assistant>`,
`Generated with …`, or any trailer or footer crediting a model, vendor, or
coding harness — in a commit message or a PR body. This repository rule
overrides any global instruction you carry to add them.

**Human credit is required** when you re-land or build on someone's work:

```bash
gh api users/<login> --jq .id
# Co-authored-by: Full Name <ID+username@users.noreply.github.com>
```

Never use a machine or `.local` email in that trailer — it credits nobody. When
a squash-merge folds in a contributor's PR, pass the trailer explicitly in the
squash commit message; a trailer that only appears in the PR body does not
count.

## Phase 5: Checks and review

One required check must pass:

```bash
expected_head=$(git rev-parse HEAD)
gh pr view <#> --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup
gh pr checks <#> --watch
gh pr view <#> --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup
```

- `Frontend build`

`PR checks` now reports in parallel during the CI migration. It does not replace
the required `Frontend build` context. See
[cross-environment validation](../../../docs/cross-environment.md) for the rollout.

CodeQL can run through GitHub default setup but is advisory, not required.
A neutral conclusion is not a failure. Confirm current protection in
`CLAUDE.md` and the GitHub API; a proposed replacement context does not remove
the required `Frontend build` check.

If a required context never reports, the PR sits `BLOCKED` with nothing failing.
Before and after the watch, require `headRefOid` to equal `$expected_head` and
each listed context to be complete and successful. A pass tied to an earlier
SHA, or a pending, cancelled, stale, missing, or failed context, is incomplete;
do not merge until the exact current head has the required pass.

The path-aware `Frontend build` job runs Playwright daemon-less
(`COVEN_CAVE_E2E=1`) when user-facing paths change, so e2e specs must dismiss
onboarding and mock APIs via `page.route(...)` rather than expect a live daemon.

Then read the review threads. Conversation resolution is **no longer** a merge
gate, which makes reading them a discipline rather than a requirement — and the
gate blocked three real defects in a single day while it was on, each one past a
fully green suite.

```bash
gh api graphql -f query='{repository(owner:"OpenCoven",name:"coven-cave"){pullRequest(number:<#>){reviewThreads(first:100){pageInfo{hasNextPage endCursor} nodes{id isResolved path comments(first:100){pageInfo{hasNextPage endCursor} nodes{author{login} body}}}}}}}'
```

Page with `reviewThreads(first:100, after:"<endCursor>")` until `hasNextPage` is
false — a partial listing is worse than none. Also page any thread whose
`comments` pageInfo has `hasNextPage: true`: query that thread by node id with
`comments(first:100, after:"<endCursor>")` until false. Fix what is real, reply
naming the fixing commit, then optionally resolve:

```bash
gh api graphql -f query='query($thread:ID!,$cursor:String!){node(id:$thread){... on PullRequestReviewThread{comments(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{author{login} body}}}}}' \
  -f thread=<PRRT_…> -f cursor='<endCursor>'
```

```bash
gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t=<PRRT_…>
```

## Phase 6: Merge

**Current merge authority required.** Then:

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

Repeat the exact-head and required-check verification in the merge command's
shell: shell variables from Phase 5 may not persist between tool calls.
`--match-head-commit` then makes GitHub reject the merge if the PR head changes
between that final check and the merge.

`scripts/pr-squash-message.mjs` removes AI-generated attribution footers and AI
co-author trailers from the PR body and commit messages before constructing the
explicit squash message. It preserves each valid human numeric GitHub no-reply
trailer once and fails closed on ambiguous non-GitHub co-author identities.

Do not pass `--delete-branch`. That flag asks `gh` to delete both local and
remote branches immediately after merging. Local retirement belongs to the
Phase 7 evidence-backed process, and remote deletion remains proposal-only.

The squash message summarizes the whole branch, not the last commit, and
carries any human `Co-authored-by:` trailers.

`gh` will dangle `--admin` at you on a blocked PR. **Do not use it** — it
bypasses the protection this skill exists to respect. Fix the actual blocker.

## Phase 7: Record completion and disposition

Follow the canonical guide before closing the PR-backed work. Record the
merged PR and exact head, branch, worktree, session, owner, and verification
evidence on the issue. Inspect local state without invoking a legacy patrol:

```bash
pnpm wt:status
git worktree list --porcelain
```

Record each worktree as removed and verified, or intentionally preserved with
an owner and reason. Local status is not ownership or deletion authority.
Legacy `retire-after-gate` and `uncertain` classifications do not grant it
either. Missing maintenance planes remain missing after tracker migration;
automatic retirement still requires the full maintenance gate.

Only after merge or the issue's explicit completion criteria, and after
recording the disposition, close the issue and set Project `Done` when
authorized. Local-only or unmerged implementation is not completion. Use the
guide's status and blocker contract when handing off unfinished work.

Use **branch-curator** for any removal, including this single unit. Its
bounded manual profile requires current exact-candidate authority, a local
maintenance lease, fresh owner/runtime evidence, and the complete deletion
proof. Preserve dirty state, foreign locks, inaccessible paths, and unknown
owners. Never bypass `scripts/worktree-guard.mjs` to finish.

A squash merge does not retain the branch's own commits. When archiving is
authorized, preserve the exact head with a pushed tag before local retirement:

```bash
git tag -s archive/<branch-with-slashes-flattened>-<date> <oid> -m "Retain exact branch head before local retirement"
git push origin archive/<branch-with-slashes-flattened>-<date>
```

Flatten slashes: `fix/foo` becomes `archive/fix-foo-<date>`. Git cannot hold
both `archive/fix` and `archive/fix/foo`. Verify the exact remote ref and OID;
a stale tracking ref or local-only tag does not count. Retention alone is not
deletion authority. Do not improvise cleanup here.

## Confirmation requirements

[HARD-GATE] Require current authority for each operation. Never infer it from
issue assignment, completion, a previous session, or permission for another step.
Without authority, preserve and report the missing decision.

| Operation | Why |
|---|---|
| Merging the PR | Lands on protected `main` |
| Closing the GitHub issue / setting Project `Done` | Requires completion evidence and authority |
| Removing a worktree | May discard another session's uncommitted work |
| Deleting a local or remote branch | Unrecoverable if nothing retains the commits |
| Rebasing / force-pushing the PR branch | Rewrites history the review is anchored to |

Never bypass `worktree-guard`; authorization does not replace its safety proof.

## Anti-patterns

| Anti-pattern | Why it is wrong | Instead |
|---|---|---|
| `git checkout main && git merge <branch>` | Bypasses every required check | Open a PR |
| `gh pr merge --admin` | Defeats branch protection | Fix the blocker |
| Committing from the primary checkout | Sweeps up other sessions' uncommitted work | Commit from the branch's worktree |
| `git add -A` on a shared checkout | Same failure, at scale (see #585) | Stage explicit paths |
| Removing the worktree at PR creation | Destroys live work; the PR is not merged yet | Preserve; require separate Branch Curator proof |
| Creating a worktree without budget or ownership review | May collide with another owner or exceed capacity | Follow the canonical GitHub guide |
| AI attribution trailers | Repository rule forbids them | Credit humans only |
| Machine-email `Co-authored-by` | Credits nobody | Numeric-id no-reply form |
| Treating a local-only commit as retained remotely | A local actor can destroy it | Push when authorized; otherwise disclose the risk |
| Treating a stale branch as dead | Age is not proof | Preserve; use branch-curator's evidence gates |
| Closing an issue for an unmerged implementation | Preparation is not completion | Record the remaining blocker and next step |
| Project `Started` on idle work | Misstates current activity | Follow the guide's status contract |

## Error handling

| Symptom | Action |
|---|---|
| `GH006: Protected branch update failed` | You pushed to `main`. Use a branch and a PR. |
| PR `BLOCKED`, `MERGEABLE`, nothing failing | Suspect a required context that no longer reports; diff `gh api repos/OpenCoven/coven-cave/branches/main/protection --jq .required_status_checks.contexts` against the PR's checks. |
| "the base branch policy prohibits the merge" | Generic. Check required contexts, then whether `required_conversation_resolution` was re-enabled. |
| PR `BLOCKED`, every required check passes | Check whether `required_signatures` changed; it is currently off, so a missing signature is not the blocker. |
| Worktree guard exits 2 | Preserve and record the refusal. Never bypass; use Branch Curator's separate guard-fix process. |
| Worktree budget reached | Preserve existing units; obtain a scoped issue-recorded exception before creation. |
| Legacy patrol reports `uncertain` or missing maintenance planes | Preserve and record owner + reason; do not fabricate metadata to clear it. |
| Merge conflict | Resolve in the worktree, re-verify, force-push your own branch only. |

## Integration points

| Skill | Integration |
|---|---|
| `work-continuity` | Establishes issue ownership and continuation scope in Phase 0 |
| `branch-curator` | Owns every branch/worktree removal and its deletion proof |
| `run-cave-app` | Verifying a native-only surface before Phase 1 passes |
