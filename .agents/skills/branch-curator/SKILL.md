---
name: branch-curator
description: Use whenever asked to audit, clean up, prune, delete, archive, or open pull requests for local Git branches or worktrees, especially in a multi-session repository. Trigger on "clean branches", "remove stale branches", "create PRs from local work", "prune worktrees", "sort out branches", or any request to decide which branches are live. Preserve uncertain work and require evidence before every mutation.
---

# Branch Curator

Curate branches without destroying another session's work. A branch name is
only one signal: uncommitted files, claims, task ownership, pull requests, and
recovery snapshots can all make a branch live even when Git calls it merged.

## Core rule

Inventory first, classify every local branch, then act. Use read-only commands
against live or uncertain branches. Make any skill or audit changes in a fresh
worktree from current `origin/main`.

Never treat age, merge reachability, a missing worktree, or a missing open PR as
proof that a branch is stale. Never switch, reset, rebase, merge, cherry-pick,
stage, commit, or clean inside a candidate worktree until ownership is clear.

## What counts as live

Preserve a branch or worktree when any of these signals apply:

- It is checked out in any worktree and the owner has not confirmed it is idle.
- Its worktree has staged, unstaged, untracked, ignored, or dirty submodule
  state that repository policy does not explicitly declare disposable.
- `coven claim status`, a live claim file, or an active session names it.
- Any non-closed Bead, including blocked or deferred work, names the branch,
  worktree, surface, or owner.
- It heads an open or draft pull request, or its CI is still running.
- It is a same-day backup, rescue, archive, or WIP snapshot without an explicit
  retention decision.
- Its branch tip or reflog changed in the last 24 hours and the owner has not
  explicitly authorized its disposition. Recency is unconditional evidence;
  knowing the owner does not make recent work disposable.
- It contains local or remote commits whose disposition is not proven.
- Its local branch ref is symbolic rather than a direct commit ref.

Treat `main`, the repository's default branch, Beads/Dolt sync refs such as
`__dolt_remote_info__`, and other tool-owned refs as protected infrastructure.
Do not curate them as feature branches.

## Start with durable coordination

In a Beads repository:

```bash
bd prime
bd ready --json
bd list --limit 0 --include-gates --include-infra --include-templates --json |
  jq '[.[] | select(.status != "closed")]'
```

Claim exactly one branch-curation task before editing. Do not claim or close the
tasks that own candidate branches merely to make cleanup easier. Record the
curator branch, worktree, session or familiar owner, and final evidence in the
curation task. Inspect every non-closed task, including blocked and deferred
work; the default `bd list` limit can hide branch ownership.

## Build the read-only inventory

Refresh remote-tracking refs, then collect all signals before deciding:

```bash
git fetch --no-prune origin
git status --short --branch
git worktree list --porcelain
git branch --merged origin/main --format='%(refname:short)'
git branch --no-merged origin/main --format='%(refname:short)'
```

Acquire branch names as data, not as shell source. Git refnames cannot contain a
newline, so removing `for-each-ref`'s record newlines leaves an unambiguous NUL
stream:

```bash
while IFS= read -r -d '' branch; do
  local_ref="refs/heads/$branch"
  printf 'branch=%q\n' "$branch"
  if symbolic_target=$(git symbolic-ref -q "$local_ref"); then
    printf 'PRESERVE - symbolic ref -> %s\n' "$symbolic_target"
    continue
  fi
  git show-ref --verify "$local_ref"
  git log -1 --format='committed=%cI%nsubject=%s' "$local_ref" --
  git reflog show -1 --date=iso-strict --format='reflog=%gd' "$local_ref"
  git for-each-ref \
    --format='upstream=%(upstream:short)%ntrack=%(upstream:track)' \
    "$local_ref"
done < <(
  git for-each-ref --sort=-committerdate \
    --format='%(refname:lstrip=2)%00' refs/heads | tr -d '\n'
)
```

Do not parse `printf %q` or the human-readable metadata back into commands. The
loop variable is the authoritative branch name.

For every listed worktree, run:

```bash
git -C <worktree-path> \
  -c status.showUntrackedFiles=all \
  -c core.fileMode=true \
  -c core.fsmonitor=false \
  status --porcelain=v2 --branch --untracked-files=all \
  --ignored=matching --ignore-submodules=none
git -C <worktree-path> ls-files -v |
  awk '$1 ~ /^[a-z]/ || $1 == "S"'
```

This output deliberately includes ignored paths. Before removing a worktree,
also inspect `git -C <worktree-path> clean -ndx -d -- .`. Preserve when any
staged, unstaged, untracked, ignored, or dirty submodule state exists. A
repository may explicitly document disposable ignored paths such as dependency
caches; absent that policy, ignored means local state, not safe-to-delete
clutter. Never let user or repository
status, file-mode, or filesystem-monitor configuration suppress this check.
Preserve any worktree whose `ls-files -v` check emits assume-unchanged or
skip-worktree entries.

Check runtime and task ownership:

```bash
coven claim status
coven sessions --json
bd list --limit 0 --include-gates --include-infra --include-templates --json |
  jq '[.[] | select(.status != "closed")]'
```

Map active session project roots and working directories to worktrees. If the
runtime does not expose enough metadata, inspect live harness process working
directories using the repository's documented coordination procedure. If the
repository has another claim mechanism, inspect it too. Absence of a claim
means "no claim found", not "no owner exists"; an unclaimed active session is
still live.

Fetch every pull request once. Filtering the exhaustive result by audited head
OID finds origin and fork PRs even when their source and local branch names
differ:

```bash
pr_inventory_ok=1
if ! all_prs_json=$(
  gh api --paginate --slurp -X GET 'repos/{owner}/{repo}/pulls' \
    -f state=all -f per_page=100
); then
  printf '%s\n' 'PRESERVE - PR inventory failed'
  pr_inventory_ok=0
fi
```

For every deletion or PR candidate, use the branch variable from the NUL loop,
capture both tips without converting lookup failures into absence, and filter
the PR inventory:

```bash
if test "$pr_inventory_ok" -ne 1; then
  printf '%s\n' 'PRESERVE - PR inventory unavailable'
  continue
fi

local_oid=$(git rev-parse --verify "$local_ref^{commit}")
remote_ref="refs/heads/$branch"
remote_oid=''
if remote_line=$(git ls-remote --exit-code --heads origin "$remote_ref"); then
  read -r remote_oid observed_remote_ref <<EOF
$remote_line
EOF
  test "$observed_remote_ref" = "$remote_ref"
else
  remote_status=$?
  case "$remote_status" in
    2) remote_oid='' ;;
    *) printf 'PRESERVE - remote lookup failed (%s)\n' "$remote_status"; continue ;;
  esac
fi

matching_prs=$(
  printf '%s' "$all_prs_json" |
    jq --arg local_oid "$local_oid" \
       --arg remote_oid "$remote_oid" \
       '[.[][] | select(
          .head.sha == $local_oid or
          ($remote_oid != "" and .head.sha == $remote_oid)
        )]'
)
```

The workflow-runs API caps history at 1,000 results, so do not paginate its
unfiltered history. Query each active status server-side for every distinct
audited local or remote OID; only existence matters, and OIDs survive branch
aliases:

```bash
active_run_found=0
candidate_oids=("$local_oid")
if test -n "$remote_oid" && test "$remote_oid" != "$local_oid"; then
  candidate_oids+=("$remote_oid")
fi
for candidate_oid in "${candidate_oids[@]}"; do
  for run_status in queued in_progress requested waiting pending; do
    if ! run_json=$(
      gh api -X GET 'repos/{owner}/{repo}/actions/runs' \
        -f per_page=1 -f "head_sha=$candidate_oid" -f "status=$run_status"
    ); then
      printf 'PRESERVE - Actions lookup failed for %s at %s\n' \
        "$run_status" "$candidate_oid"
      active_run_found=2
      break 2
    fi
    if test "$(printf '%s' "$run_json" | jq '.total_count')" -gt 0; then
      active_run_found=1
    fi
  done
done
```

Any matching PR whose state is `open`, or any active workflow status, makes the
branch live. If the PR inventory or any Actions query fails, classify the branch
as uncertain.

For candidates without a live signal, inspect unique work using fully qualified
refs:

```bash
local_ref="refs/heads/$branch"
main_ref='refs/remotes/origin/main'
git log --oneline --decorate --no-merges "$main_ref..$local_ref"
git diff --stat "$main_ref...$local_ref" --
git diff --name-status "$main_ref...$local_ref" --
git cherry -v "$main_ref" "$local_ref"
```

Do not use `eval`, parse branch names from delimited display text, embed branch
names into shell source, or use unquoted ref interpolation. Git permits shell
metacharacters, quotes, pipes, and leading dashes in valid branch names. Keep
branch names in quoted variables, use fully qualified refs for revision
arguments, and use `--` before path or branch operands where the Git subcommand
supports it. Preserve the branch if it cannot be handled safely.

## Classify every branch

Use exactly one decision for each local branch:

| Decision | Meaning | Allowed action |
| --- | --- | --- |
| `PRESERVE - live` | A worktree, claim, task, PR, CI run, or recent owner is active | Read-only inspection |
| `PRESERVE - recovery` | Backup, rescue, archive, or WIP snapshot still protects work | Keep and assign disposition follow-up |
| `PRESERVE - uncertain` | Ownership or unique-work evidence is incomplete | Keep and report missing evidence |
| `PR` | Scoped, complete, verified work has no current PR and is authorized for review | Open one PR |
| `DELETE` | Redundant work is proven safe to remove and cleanup is authorized | Remove only the proven refs |

No-op is a valid outcome. If all branches are live, recovery snapshots, or
uncertain, delete nothing and say so plainly.

## Require an exclusive deletion gate

Read-only inventory and PR creation may run alongside other sessions. Ref or
worktree deletion may not. Final checks and deletion otherwise form a
check-then-act race: a new session, claim, task, PR, CI run, or dirty file can
appear without changing the audited branch OID.

Before classifying anything as `DELETE`, require a documented repository-wide
cleanup gate that:

1. quiesces every existing repository writer, including harnesses, worktrees,
   hooks, automation, and external clients;
2. prevents new sessions, claims, worktree writes, task ownership/status
   changes, PR creation/reopening, workflow dispatches, and other ownership or
   liveness transitions;
3. is respected by every supported harness, launcher, task system, Git host
   client, and workflow trigger;
4. has one auditable owner and bounded lifetime; and
5. remains held from the final ownership/state checks through all local and
   remote mutations and post-action verification.

A branch claim, Bead assignment, PID snapshot, advisory claim file, or verbal
"nobody is using it" does not provide exclusion. If the repository has no
enforced gate, preserve deletion candidates and report that cleanup is blocked
on an exclusive maintenance window. Do not invent a lock file that other tools
do not honor.

## Open a PR only for PR-shaped work

A branch is PR-shaped only when all of these are true:

1. Its purpose and owner are known, and opening a PR is authorized.
2. Its diff is scoped and coherent rather than a mixed backup or WIP snapshot.
3. The owning task's acceptance criteria are complete.
4. Relevant tests, lint, type checks, and repository gates pass.
5. It contains no secrets or local runtime state.
6. It is based on current `origin/main`, or any update was performed in its own
   isolated worktree with the owner's authority.
7. No existing open PR already uses the branch.
8. The owning writer is quiesced and an owner-held branch gate prevents local
   or remote tip changes and concurrent PR lifecycle changes through creation
   and head verification.

Do not open speculative PRs for backup branches, unowned work, incomplete task
branches, or branches that are still being edited. Link the PR in the owning
Bead and include verification evidence in the PR body.

Bind the PR to the commit that passed verification. While holding the branch
gate, capture `verified_oid` from the fully qualified local ref, query the exact
remote ref with the same failure handling used by the inventory, and require
the remote to be absent or already equal to `verified_oid`. Push a missing
remote only with an empty expected-value lease:

```bash
verified_oid=$(git rev-parse --verify "$local_ref^{commit}")
git push \
  --force-with-lease="$remote_ref:" \
  origin "$local_ref:$remote_ref"
```

Immediately re-read both OIDs and require exact equality before `gh pr create`.
Keep the gate held while creating the PR, then query the created PR and require
`.head.sha == verified_oid` before reporting success. If any OID advances,
lookup fails, or the gate cannot exclude concurrent writers, preserve the branch
and do not open or describe a PR as verified.

## Delete only after proof

Local deletion requires all of the following:

1. The branch is not protected or tool-owned.
2. No worktree is using it, or the known owner explicitly declared the clean
   worktree inactive.
3. Configuration-independent porcelain inspection shows no staged, unstaged,
   untracked, ignored, or dirty submodule state, except ignored paths that
   repository policy explicitly declares disposable.
4. `git symbolic-ref -q "$local_ref"` confirms it is not symbolic.
5. No live claim, active session, non-closed task, open PR, draft PR, or running
   CI owns it.
6. It is not an unresolved recovery snapshot.
7. Its tip and reflog are older than 24 hours, or the known owner explicitly
   authorized disposition after reviewing the current audited OIDs.
8. Cleanup is authorized and the repository-wide exclusive deletion gate is
   held.
9. Redundancy is proven by one of these routes:
   - every local and remote tip being deleted is an ancestor of `main_ref`; or
   - its PR is `MERGED`, every tip being deleted equals that PR's recorded head
     OID, and neither ref has advanced since merge.

Capture local and remote tips before proving redundancy:

```bash
remote_ref="refs/heads/$branch"
audited_main_oid=$(git rev-parse --verify "$main_ref^{commit}")
audited_local_oid=$(git rev-parse --verify "$local_ref^{commit}")
audited_remote_oid=''
if remote_line=$(git ls-remote --exit-code --heads origin "$remote_ref"); then
  read -r audited_remote_oid observed_remote_ref <<EOF
$remote_line
EOF
  test "$observed_remote_ref" = "$remote_ref"
else
  remote_status=$?
  case "$remote_status" in
    2) audited_remote_oid='' ;;
    *) printf 'PRESERVE - remote lookup failed (%s)\n' "$remote_status"; continue ;;
  esac
fi
```

For a merged PR, compare both captured OIDs to the API's `.head.sha`. For an
ancestry-based deletion, fetch the remote ref without moving the local branch,
then prove each captured OID is an ancestor:

```bash
git merge-base --is-ancestor "$audited_local_oid" "$audited_main_oid"
if test -n "$audited_remote_oid"; then
  git fetch --no-prune --no-tags origin "$remote_ref"
  git cat-file -e "$audited_remote_oid^{commit}"
  git merge-base --is-ancestor "$audited_remote_oid" "$audited_main_oid"
fi
```

If any OID differs, is unavailable locally, or fails the chosen proof, preserve
the branch and inspect the divergence.

After acquiring the exclusive gate and immediately before mutation, repeat the
symbolic-ref, configuration-independent worktree state, claim, session,
non-closed Beads, exhaustive PR, and exhaustive Actions checks. Then re-read the
base, local, and remote OIDs and require exact equality with the captured
values. Hold the gate through worktree removal, local and remote ref deletion,
and final verification.

Remove only a clean, known-inactive worktree:

```bash
git worktree remove -- "$worktree_path"
```

Delete the local ref with Git's atomic compare-and-delete operation. It fails
instead of deleting if the branch advanced after the audit:

```bash
git update-ref --no-deref -d "$local_ref" "$audited_local_oid"
```

If a remote ref exists, delete it with an explicit lease bound to the captured
remote OID:

```bash
git push \
  --force-with-lease="$remote_ref:$audited_remote_oid" \
  origin ":$remote_ref"
```

Do not bypass `worktree-guard` merely to finish a sweep. A blocked deletion is
new evidence; return to classification unless the operator explicitly
authorizes the bypass after reviewing the recorded risk. Likewise, never use
`git update-ref -d` or a deletion refspec until every proof and immediate
recheck above has passed.

## Preserve at-risk work without touching its source

When unowned work needs a safety copy, leave the source worktree unchanged.
Create the snapshot from the source HEAD in a separate worktree, reproduce only
the observed diff, and verify file hashes before pushing a clearly named backup
branch. Do not open a PR for that snapshot. Record its source branch, base OID,
file list, verification, and intended owner or expiry in Beads.

Recovery branches are temporary safety artifacts, not a permanent coordination
system. Keep them until the owner accepts, lands, archives, or explicitly
discards the work.

## Verify the final state

After every action, re-run:

```bash
git worktree list --porcelain
git branch -vv --no-abbrev
```

Repeat the exhaustive per-branch PR and Actions API queries for every acted-on
branch. Also check `git status --short --branch` in every touched worktree.
Confirm each deleted local ref is absent and each deleted remote ref is absent
with:

```bash
if git show-ref --verify --quiet "$local_ref"; then
  printf '%s\n' 'verification failed: local ref still exists'
else
  local_status=$?
  test "$local_status" -eq 1 ||
    printf 'PRESERVE - local verification failed (%s)\n' "$local_status"
fi

if git ls-remote --exit-code --heads origin "$remote_ref"; then
  printf '%s\n' 'verification failed: remote ref still exists'
else
  remote_status=$?
  test "$remote_status" -eq 2 ||
    printf 'PRESERVE - remote verification failed (%s)\n' "$remote_status"
fi
```

Only status 1 from `show-ref` and status 2 from `ls-remote` prove absence.
Authentication, transport, server, and other failures are uncertainty, not
successful deletion. Confirm each created PR points at the expected head and
base.

## Report

Report every local branch; do not omit protected or preserved entries:

| Branch | Live or recovery signals | Unique-work evidence | Decision | Action |
| --- | --- | --- | --- | --- |

Then state:

- PRs created, with links.
- Local and remote refs removed.
- Branches preserved and the exact reason for each.
- Worktrees left untouched.
- The curation Bead and whether it remains open pending merge.

Do not describe a branch as stale or useless unless the evidence above proves
that conclusion.
