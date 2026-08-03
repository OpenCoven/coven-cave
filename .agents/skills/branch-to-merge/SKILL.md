---
name: branch-to-merge
description: Use when finishing work on a Coven Cave branch and landing it on protected `main` — verification, pull request, required checks, review threads, squash merge, and lifecycle retirement. Trigger on "merge this", "finish the branch", "land this work", "open a PR", "branch to merge", "done with this branch", or "clean up after the merge".
---

# Branch To Merge

Take a finished branch to a merged commit on `main` without ever writing to
`main` directly and without destroying another session's work.

`main` in this repository is protected: pull request required, nine required
status checks, signed commits, no force-push, no deletion. A pull request is
the **only** path an agent may use. This skill is the Cave-specific replacement
for generic "finish a branch" workflows that offer a local merge into the base
branch — that option does not exist here.

## Core rule

Verify, push, open a PR, get the checks green, read the review, squash-merge
through `gh`, then retire the local unit through the lifecycle patrol. Every
destructive step needs evidence, and anything ambiguous is preserved rather
than cleaned up.

**Never** run `git checkout main && git merge <branch>`, `git push origin
main`, or `gh pr merge --admin`. If a change cannot go through a PR, stop and
surface it to the maintainer.

Force-pushing is not banned outright — rebasing your own PR branch is a normal
part of Phase 2. Never force-push a branch you do not own, and never force-push
away commits nothing else retains.

## Skill type

**RIGID** — run the phases in order. Do not skip verification, do not invent a
merge strategy, do not delete anything without the proof each phase names.

## Phase 0: Confirm the unit of work

[HARD-GATE] Before touching the branch, know which Bead owns it.

```bash
bd show <id>                 # the Bead this branch implements
git rev-parse --abbrev-ref HEAD
git -C . rev-parse --show-toplevel   # confirm you are in the worktree, not the primary checkout
```

- The branch must be claimed: `bd update <id> --claim` if it is not.
- Work from the branch's own worktree. The primary checkout usually holds other
  sessions' uncommitted files; committing from there sweeps up their work.
- Managed worktrees come from `pnpm beads:worktrees:create --bead <id> --branch
  <branch> --owner <you> --purpose "…"` (no `--` before the flags). If that
  command refused on budget, the sanctioned rerun adds `--exception-owner`,
  `--exception-reason`, `--exception-expires-at` and `--exception-path`; a bare
  `git worktree add` produces a unit the patrol can never retire.

## Phase 1: Verify before anything else

[HARD-GATE] Do not push, open, or merge a PR on unverified work. "It passed
earlier" is not verification.

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

Every path in the diff must belong to this Bead. Unrelated files mean you
committed someone else's work — split them out before continuing.

If verification fails, **STOP** and fix it. A red PR wastes the reviewer and
burns nine CI legs.

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

Only two endings exist here. Present exactly these:

```
How would you like to finish this branch?

  A) Open a PR   -- push, open a pull request, land it via squash merge
  B) Leave as-is -- keep the branch and worktree, decide later
```

**STOP — wait for the choice.** Do not assume a default.

A local merge into `main` and a squash-commit onto `main` are deliberately
absent: branch protection rejects the push (`GH006`) for a non-admin, and the
owner's admin exemption is theirs, not yours.

If the answer is B, say so plainly and stop — no cleanup, no worktree removal,
no branch deletion. An unfinished branch is preserved by default.

## Phase 4: Open the pull request

Commits must be signed (`required_signatures` is on; the server rejects
unsigned commits). Push after **every** commit — the remote is the only store a
local actor cannot destroy.

```bash
git push -u origin <branch>
gh pr create --base main --head <branch> --title "…" --body "…"
```

**Title** — imperative, under ~70 characters, describes the change not the
branch name.

**Body** — what changed and why, the verification you actually ran, and the
Bead id. Link the Bead rather than restating its contents.

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

Nine required checks must pass:

```bash
gh pr checks <#> --watch
```

- `Frontend build`
- `Rust check`
- `E2E (Playwright)`
- `Cross-environment (ubuntu-latest)`
- `Cross-environment (windows-latest)`
- `Cross-environment required`
- `Sidecar runtime (ubuntu-latest)`
- `Sidecar runtime (windows-latest)`
- `Sidecar runtime required`

CodeQL is retired, and code scanning is fully off — nothing scans in its place.
If a required context never reports, the PR sits `BLOCKED` with nothing failing.

The `E2E (Playwright)` leg runs daemon-less (`COVEN_CAVE_E2E=1`), so e2e specs
must dismiss onboarding and mock APIs via `page.route(...)` rather than expect a
live daemon.

Then read the review threads. Conversation resolution is **no longer** a merge
gate, which makes reading them a discipline rather than a requirement — and the
gate blocked three real defects in a single day while it was on, each one past a
fully green suite.

```bash
gh api graphql -f query='{repository(owner:"OpenCoven",name:"coven-cave"){pullRequest(number:<#>){reviewThreads(first:100){pageInfo{hasNextPage endCursor} nodes{id isResolved path comments(first:1){nodes{author{login} body}}}}}}}'
```

Page with `reviewThreads(first:100, after:"<endCursor>")` until `hasNextPage` is
false — a partial listing is worse than none. Fix what is real, reply naming the
fixing commit, then optionally resolve:

```bash
gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t=<PRRT_…>
```

## Phase 6: Merge

**Confirmation required.** Then:

```bash
gh pr merge <#> --squash --delete-branch
```

The squash message summarizes the whole branch, not the last commit, and
carries any human `Co-authored-by:` trailers.

`gh` will dangle `--admin` at you on a blocked PR. **Do not use it** — it
bypasses the protection this skill exists to respect. Fix the actual blocker.

## Phase 7: Close out and retire the local unit

```bash
bd close <id> --reason="Merged in PR #<#>"
```

Close only after the merge lands, and record the branch, worktree, session,
owner, and verification evidence on the Bead first.

Then run the lifecycle patrol — it is the only sanctioned retirement route:

```bash
pnpm beads:worktrees                 # report only; changes nothing
pnpm beads:worktrees:apply           # only when it reports a complete maintenance transaction
```

If the patrol reports the unit as `active`, `recovery`, `cooldown`,
`uncertain`, or the gate as incomplete, **preserve it** and record the owner and
reason. `retire-after-gate` is a classification, not deletion authority. A
worktree created by bare `git worktree add` reports `uncertain` forever; retire
it by hand through the archive-tag route and never hand-write the missing
lifecycle metadata onto the Bead — that record is the evidence the gate checks.

Destruction is guarded (`scripts/worktree-guard.mjs`, exit 2) for a dirty
worktree, a HEAD on no remote ref, an unpushed branch tip, or a branch still
heading an open PR. To retire a branch whose commits must survive, archive it —
a pushed tag outlives the branch a merge deletes:

```bash
git tag -s archive/<branch-with-slashes-flattened>-<date> <oid>
git push origin archive/<branch-with-slashes-flattened>-<date>
```

Flatten slashes: `fix/foo` → `archive/fix-foo-<date>`. Git cannot hold both a
tag `archive/fix` and `archive/fix/foo`. A local-only tag does not count.

For anything broader than this one branch — auditing, pruning, or deleting a
set of branches or worktrees — hand off to **branch-curator**. Do not
improvise cleanup here.

## Confirmation requirements

[HARD-GATE] Ask before each of these. Never proceed on assumption.

| Operation | Why |
|---|---|
| Merging the PR | Lands on protected `main` |
| `bd close` | Others rely on the Bead's status |
| Removing a worktree | May discard another session's uncommitted work |
| Deleting a local or remote branch | Unrecoverable if nothing retains the commits |
| Rebasing / force-pushing the PR branch | Rewrites history the review is anchored to |
| Any `WT_GUARD_BYPASS=1` rerun | Overrides the guard protecting live work |

## Anti-patterns

| Anti-pattern | Why it is wrong | Instead |
|---|---|---|
| `git checkout main && git merge <branch>` | Bypasses every required check | Open a PR |
| `gh pr merge --admin` | Defeats branch protection | Fix the blocker |
| Committing from the primary checkout | Sweeps up other sessions' uncommitted work | Commit from the branch's worktree |
| `git add -A` on a shared checkout | Same failure, at scale (see #585) | Stage explicit paths |
| Removing the worktree at PR creation | Destroys live work; the PR is not merged yet | Retire only after merge, via the patrol |
| Bare `git worktree add` to dodge a budget refusal | Produces a permanently unretirable unit | Rerun with the attributed `--exception-*` flags |
| AI attribution trailers | Repository rule forbids them | Credit humans only |
| Machine-email `Co-authored-by` | Credits nobody | Numeric-id no-reply form |
| Committing only locally | A local actor can destroy it | Push after every commit |
| Treating a stale branch as dead | Age is not proof | Preserve; use branch-curator's evidence gates |
| Leaving a merged Bead open | Sweeps have to re-derive state by hand | Close with evidence |
| `in_progress` on work nobody is doing now | Four states wearing one status | `open`, `blocked`, or `deferred` |

## Error handling

| Symptom | Action |
|---|---|
| `GH006: Protected branch update failed` | You pushed to `main`. Use a branch and a PR. |
| PR `BLOCKED`, `MERGEABLE`, nothing failing | Suspect a required context that no longer reports; diff `gh api repos/OpenCoven/coven-cave/branches/main/protection --jq .required_status_checks.contexts` against the PR's checks. |
| "the base branch policy prohibits the merge" | Generic. Check required contexts, then whether `required_conversation_resolution` was re-enabled. |
| Push rejected — unsigned commit | Signatures are required; sign with `-S` and re-push. |
| Worktree guard exits 2 | Live work. Investigate; bypass only with explicit maintainer authorization. |
| `worktree-lifecycle-create` budget refusal | Rerun with the printed `--exception-*` flags. Never fall back to `git worktree add`. |
| `unknown option: --` | Drop the `--` before the flags; pnpm forwards it. |
| Patrol reports `uncertain` | Preserve the unit and record owner + reason. |
| Merge conflict | Resolve in the worktree, re-verify, force-push your own branch only. |

## Integration points

| Skill | Integration |
|---|---|
| `beads` | Claim in Phase 0, close in Phase 7 |
| `branch-curator` | Owns multi-branch audit, pruning, and deletion proofs |
| `run-cave-app` | Verifying a native-only surface before Phase 1 passes |
| `requesting-code-review` | Optional between Phase 4 and Phase 5 |
