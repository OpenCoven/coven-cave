---
name: branch-curator
description: Use whenever asked to audit, clean up, prune, delete, archive, or open pull requests for local Git branches or worktrees, especially in a multi-session repository. Trigger on "clean branches", "remove stale branches", "create PRs from local work", "prune worktrees", "sort out branches", or any request to decide which branches are live. Preserve uncertain work and require evidence before every mutation.
---

# Branch Curator
Curate branches without destroying another session's work. A branch name is only
one signal: files, claims, tasks, PRs, and recovery snapshots can all make it live.

## Core rule
Inventory first, classify every local branch, then act. Use read-only commands
against live or uncertain branches; make audit changes in a fresh worktree.

Never treat age, reachability, a missing worktree, or a missing PR as proof of
staleness. Do not mutate a candidate worktree until ownership is clear.

## What counts as live
Preserve a branch or worktree when any of these signals apply:
- It is checked out in any worktree and the owner has not confirmed it is idle.
- Its worktree has staged, unstaged, untracked, ignored, or dirty submodule state.
- `coven claim status`, a live claim file, or an active session names it.
- Any non-closed Bead names the branch, worktree, surface, or owner.
- It heads an open or draft pull request, or its CI is still running.
- It is a same-day backup, rescue, archive, or WIP snapshot without a disposition.
- Its tip or reflog changed in the last 24 hours. Recency is unconditional;
  known ownership does not override it.
- It contains local or remote commits whose disposition is not proven.
- Its local branch ref is symbolic rather than a direct commit ref.

Treat `main`, the default branch, Beads/Dolt sync refs such as
`__dolt_remote_info__`, and other tool-owned refs as protected infrastructure.

## Prevent accumulation
Managed worktrees require one active Bead, structured
owner/purpose/disposition metadata, and one registered worktree per Bead by
default. Warn at 12 worktrees or 30 local branches. Exceeding a budget never
authorizes deletion; new managed work requires safe retirement or a bounded
owner/reason/expiry exception.

Use `pnpm beads:worktrees:create -- --bead cave-123 --branch
fix/cave-123-example --owner kitty --purpose "Repair example"` for managed
creation. Raw `git worktree add` remains available but is not universally
intercepted; it does not exempt the resulting worktree from lifecycle policy.

Recovery and archive dispositions require an owner, reason, and review date.
An overdue review creates follow-up work and never changes the item into a
deletion candidate.

## Routine lifecycle patrol
Use `pnpm beads:worktrees` for the read-only inventory. It covers registered
worktrees and branch-only refs. Treat `retire-after-gate` as cleanup-ready, not
as deletion authorization.

`pnpm beads:worktrees:apply` may retire local state only when its capability
report proves the full Coven, Beads, GitHub, and local maintenance transaction
is enforced. `gate-incomplete` is a successful safety decision: preserve every
candidate. Automatic apply retires at most three units unless you pass an
explicit `--max-retire` value from 1 through 10. Automatic mode never deletes
remote refs; report proposals only.

## Start with durable coordination
In a Beads repository:
```bash
bd prime || { printf '%s\n' 'PRESERVE - Beads unavailable'; exit 1; }
if ! ready_tasks_json=$(bd ready --json); then
  printf '%s\n' 'PRESERVE - ready-task inventory failed'; exit 1
fi
printf '%s' "$ready_tasks_json" |
  jq -e 'type == "array" and
    all(.[]; (.id | type) == "string" and (.status | type) == "string")' \
    >/dev/null ||
  { printf '%s\n' 'PRESERVE - malformed ready-task inventory'; exit 1; }
if ! all_tasks_json=$(
  bd list --limit 0 --include-gates --include-infra --include-templates --json
); then
  printf '%s\n' 'PRESERVE - task inventory failed'; exit 1
fi
non_closed_tasks=$(printf '%s' "$all_tasks_json" | jq -e '
  if type == "array" and
     all(.[]; (.id | type) == "string" and (.status | type) == "string")
  then [.[] | select(.status != "closed")]
  else error("malformed task inventory") end
') || { printf '%s\n' 'PRESERVE - malformed task inventory'; exit 1; }
```
Claim one curation task before editing; never claim or close candidate-owning
tasks to ease cleanup. Record the curator branch, worktree, owner, and evidence.
Inspect all non-closed tasks because default `bd list` limits can hide ownership.

## Build the read-only inventory
Refresh remote-tracking refs, then collect all signals before deciding:
```bash
git fetch --no-prune origin ||
  { printf '%s\n' 'PRESERVE - fetch failed'; exit 1; }
git status --short --branch ||
  { printf '%s\n' 'PRESERVE - repository status failed'; exit 1; }
git worktree list --porcelain ||
  { printf '%s\n' 'PRESERVE - worktree inventory failed'; exit 1; }
git branch --merged origin/main --format='%(refname:short)' ||
  { printf '%s\n' 'PRESERVE - merged inventory failed'; exit 1; }
git branch --no-merged origin/main --format='%(refname:short)' ||
  { printf '%s\n' 'PRESERVE - unmerged inventory failed'; exit 1; }
```
Acquire branch names as data, not shell source. Refname rules make this an
unambiguous NUL stream after removing record newlines:
```bash
while IFS= read -r -d '' branch; do
  test "$branch" != 'branch curator inventory failed' ||
    { printf '%s\n' 'PRESERVE - branch inventory failed'; exit 1; }
  local_ref="refs/heads/$branch"
  printf 'branch=%q\n' "$branch"
  case "$local_ref" in
    refs/heads/main|refs/heads/__dolt_remote_info__)
      printf '%s\n' 'PRESERVE - protected or tool-owned ref'
      continue
      ;;
    refs/heads/*) ;;
    *) printf '%s\n' 'PRESERVE - invalid local branch ref'; continue ;;
  esac
  if symbolic_target=$(git symbolic-ref -q "$local_ref"); then
    printf 'PRESERVE - symbolic ref -> %s\n' "$symbolic_target"
    continue
  fi
  git show-ref --verify "$local_ref" ||
    { printf '%s\n' 'PRESERVE - branch ref unreadable'; continue; }
  git log -1 --format='committed=%cI%nsubject=%s' "$local_ref" -- ||
    { printf '%s\n' 'PRESERVE - branch log unreadable'; continue; }
  git reflog show --date=iso-strict --format='oid=%H selector=%gd' "$local_ref" ||
    { printf '%s\n' 'PRESERVE - branch reflog unreadable'; continue; }
  git for-each-ref \
    --format='upstream=%(upstream:short)%ntrack=%(upstream:track)' \
    "$local_ref" ||
    { printf '%s\n' 'PRESERVE - upstream unreadable'; continue; }
done < <(
  { git for-each-ref --sort=-committerdate \
      --format='%(refname:lstrip=2)%00' refs/heads ||
      printf 'branch curator inventory failed\0'; } | tr -d '\n'
)
```
Do not parse displays back into commands; the loop variable is authoritative.
This early structural filter is not deletion authority. The normative deletion
proof resolves the live remote default branch and reruns its executable
protected/tool-owned ref guard immediately before every destructive
transaction.
For every listed worktree, bind its literal path as `worktree_path`, then run:
```bash
worktree_status=$(git -C "$worktree_path" \
  -c status.showUntrackedFiles=all \
  -c core.fileMode=true \
  -c core.fsmonitor=false \
  status --porcelain=v2 --branch --untracked-files=all \
  --ignored=matching --ignore-submodules=none) ||
  { printf '%s\n' 'PRESERVE - worktree status failed'; continue; }
index_state=$(git -C "$worktree_path" ls-files -v) ||
  { printf '%s\n' 'PRESERVE - index state failed'; continue; }
index_flags=$(printf '%s\n' "$index_state" |
  awk '$1 ~ /^[a-z]/ || $1 == "S"') ||
  { printf '%s\n' 'PRESERVE - index parse failed'; continue; }
clean_preview=$(git -C "$worktree_path" clean -ndx -d -- .) ||
  { printf '%s\n' 'PRESERVE - ignored-state preview failed'; continue; }
```
Inspect every captured output. Preserve any staged, unstaged, untracked,
ignored, dirty submodule,
assume-unchanged, or skip-worktree state unless policy explicitly declares an
ignored path disposable. Never let status, file-mode, or fsmonitor configuration
suppress this check.

Check runtime and task ownership:
```bash
if ! coven_claims_json=$(coven claim status --json); then
  printf '%s\n' 'PRESERVE - Coven claims unavailable'; continue
fi
printf '%s' "$coven_claims_json" | jq -e '
  type == "object" and (.claims | type) == "array" and
  all(.claims[]; (.branch | type) == "string" and
    (.agent_id | type) == "string" and
    (.state == "active" or .state == "expired") and
    (.acquired_at | type) == "number" and
    (.expires_at | type) == "number" and
    (.head == null or (.head | type) == "string"))
' >/dev/null ||
  { printf '%s\n' 'PRESERVE - malformed Coven claims'; continue; }
claim_presence=$(printf '%s' "$coven_claims_json" | jq -er --arg branch "$branch" '
  if any(.claims[]; .branch == $branch and .state == "active")
  then "active" else "none" end
') || { printf '%s\n' 'PRESERVE - Coven claim parse failed'; continue; }
test "$claim_presence" = none ||
  { printf '%s\n' 'PRESERVE - active Coven claim'; continue; }
if ! coven_sessions_json=$(coven sessions --json); then
  printf '%s\n' 'PRESERVE - Coven sessions unavailable'; continue
fi
printf '%s' "$coven_sessions_json" |
  jq -e 'type == "object" and (.sessions | type) == "array" and
    all(.sessions[]; type == "object" and
      (.id | type) == "string" and
      (.project_root | type) == "string" and
      (.status | type) == "string")' >/dev/null ||
  { printf '%s\n' 'PRESERVE - malformed Coven sessions'; continue; }
      if test -n "${worktree_path:-}"; then
        session_presence=$(printf '%s' "$coven_sessions_json" |
          jq -er --arg root "$worktree_path" '
            if any(.sessions[]; .project_root == $root and
              (.status != "completed" and .status != "failed" and .status != "killed"))
            then "active" else "none" end
          ') || { printf '%s\n' 'PRESERVE - session parse failed'; continue; }
        test "$session_presence" = none ||
          { printf '%s\n' 'PRESERVE - active Coven session'; continue; }
      fi
common_git_dir=$(git rev-parse --path-format=absolute --git-common-dir) ||
  { printf '%s\n' 'PRESERVE - common Git dir unavailable'; continue; }
primary_checkout=$(dirname "$common_git_dir") ||
  { printf '%s\n' 'PRESERVE - primary checkout unavailable'; continue; }
claims_file="$primary_checkout/.claude/claims.json"
if test -L "$claims_file"; then
  printf '%s\n' 'PRESERVE - claims file is symbolic'; continue
elif test -e "$claims_file" && ! test -f "$claims_file"; then
  printf '%s\n' 'PRESERVE - claims path is not regular'; continue
elif test -f "$claims_file"; then
  claims_json=$(jq -e '.' "$claims_file") ||
    { printf '%s\n' 'PRESERVE - unreadable claims inventory'; continue; }
  printf '%s' "$claims_json" | jq -e '
    type == "object" and all(to_entries[];
      if (.key | startswith("_")) then (.value | type) == "string"
      else (.value | type) == "object" and
        (.value.surfaces | type) == "array" and
        all(.value.surfaces[]; type == "string") and
        ((.value.updated | type) == "string" or
         (.value.started | type) == "string")
      end)
  ' >/dev/null ||
    { printf '%s\n' 'PRESERVE - malformed claims inventory'; continue; }
  surface_claims=$(printf '%s' "$claims_json" |
    jq -er 'if any(to_entries[]; (.key | startswith("_") | not))
      then "active" else "none" end') ||
    { printf '%s\n' 'PRESERVE - claims parse failed'; continue; }
  test "$surface_claims" = none ||
    { printf '%s\n' 'PRESERVE - active surface claim'; continue; }
fi
if ! all_tasks_json=$(
  bd list --limit 0 --include-gates --include-infra --include-templates --json
); then
  printf '%s\n' 'PRESERVE - task inventory failed'; continue
fi
non_closed_tasks=$(printf '%s' "$all_tasks_json" | jq -e '
  if type == "array" and
     all(.[]; (.id | type) == "string" and (.status | type) == "string")
  then [.[] | select(.status != "closed")]
  else error("malformed task inventory") end
') || { printf '%s\n' 'PRESERVE - malformed task inventory'; continue; }
```
Run the documented live harness process/CWD check and map roots to worktrees.
Coven output supplements rather than replaces claims or process ownership.
Absence of a claim means "no claim found", not "no owner exists."

Fetch every PR once. Filter the exhaustive result by audited head OID to find
origin and fork PRs even when branch names differ:
```bash
audited_origin_url=$(git remote get-url origin) ||
  { printf '%s\n' 'PRESERVE - origin URL unavailable'; exit 1; }
case "$audited_origin_url" in
  https://github.com/*) audited_gh_repo=${audited_origin_url#https://github.com/} ;;
  *) printf '%s\n' 'PRESERVE - unsupported GitHub origin'; exit 1 ;;
esac
audited_gh_repo=${audited_gh_repo%.git}
case "$audited_gh_repo" in
  ''|/*|*/|*/*/*|*[!A-Za-z0-9._/-]*)
    printf '%s\n' 'PRESERVE - invalid GitHub repository'; exit 1 ;;
esac
pr_inventory_ok=1
if ! all_prs_json=$(
  gh api --hostname github.com --paginate --slurp -X GET \
    "repos/$audited_gh_repo/pulls" \
    -f state=all -f per_page=100
); then
  printf '%s\n' 'PRESERVE - PR inventory failed'
  pr_inventory_ok=0
elif ! printf '%s' "$all_prs_json" | jq -e '
  type == "array" and length > 0 and all(.[]; type == "array") and
  all(.[][];
    (.head.sha | type) == "string" and
    (try (.head.sha | test("^([0-9a-f]{40}|[0-9a-f]{64})$")) catch false) and
    (.state == "open" or .state == "closed") and
    (.draft | type) == "boolean")
' >/dev/null; then
  printf '%s\n' 'PRESERVE - malformed PR inventory'
  pr_inventory_ok=0
fi
```
For each candidate, use the NUL-loop variable, capture both tips without
converting lookup failures into absence, and filter the PR inventory:
```bash
if test "$pr_inventory_ok" -ne 1; then
  printf '%s\n' 'PRESERVE - PR inventory unavailable'
  continue
fi

local_oid=$(git rev-parse --verify "$local_ref^{commit}") ||
  { printf '%s\n' 'PRESERVE - local tip missing'; continue; }
remote_ref="refs/heads/$branch"
remote_oid=''
if remote_line=$(git ls-remote --exit-code --heads origin "$remote_ref"); then
  read -r remote_oid observed_remote_ref <<EOF
$remote_line
EOF
  test "$observed_remote_ref" = "$remote_ref" ||
    { printf 'PRESERVE - wrong remote ref\n'; continue; }
else
  remote_status=$?
  case "$remote_status" in
    2) remote_oid='' ;;
    *) printf 'PRESERVE - remote lookup failed (%s)\n' "$remote_status"; continue ;;
  esac
fi

if ! matching_prs=$(
  printf '%s' "$all_prs_json" |
    jq -e --arg local_oid "$local_oid" \
       --arg remote_oid "$remote_oid" \
       '[.[][] | select(
          .head.sha == $local_oid or
          ($remote_oid != "" and .head.sha == $remote_oid)
        )]'
); then
  printf '%s\n' 'PRESERVE - PR parse failed'; continue
fi
if ! live_pr_count=$(printf '%s' "$matching_prs" |
  jq -er '[.[] | select(.state == "open" or .draft == true)] | length'); then
  printf '%s\n' 'PRESERVE - matching PR parse failed'; continue
fi
test "$live_pr_count" -eq 0 ||
  { printf '%s\n' 'PRESERVE - live PR'; continue; }
```
The workflow-runs API caps history at 1,000. Query each active status server-side
by exact branch name to catch earlier-tip runs and by every distinct audited OID
to catch aliases:
```bash
active_run_found=0
candidate_oids=("$local_oid")
if test -n "$remote_oid" && test "$remote_oid" != "$local_oid"; then
  candidate_oids+=("$remote_oid")
fi
run_filter_names=(branch)
run_filter_values=("$branch")
for candidate_oid in "${candidate_oids[@]}"; do
  run_filter_names[${#run_filter_names[@]}]=head_sha
  run_filter_values[${#run_filter_values[@]}]="$candidate_oid"
done
filter_index=0
while test "$filter_index" -lt "${#run_filter_names[@]}"; do
  run_filter_name=${run_filter_names[$filter_index]}
  run_filter_value=${run_filter_values[$filter_index]}
  for run_status in queued in_progress requested waiting pending; do
    if ! run_json=$(
      gh api --hostname github.com -X GET \
        "repos/$audited_gh_repo/actions/runs" \
        -f per_page=1 -f "$run_filter_name=$run_filter_value" \
        -f "status=$run_status"
    ); then
      printf 'PRESERVE - Actions lookup failed for %s=%s at %s\n' \
        "$run_filter_name" "$run_filter_value" "$run_status"
      active_run_found=2
      break 2
    fi
    if ! run_presence=$(printf '%s' "$run_json" | jq -er '
      if type == "object" and (.total_count | type) == "number" and
         .total_count >= 0
      then if .total_count == 0 then "none" else "active" end
      else error("invalid total_count") end
    '); then
      printf 'PRESERVE - malformed Actions response for %s=%s at %s\n' \
        "$run_filter_name" "$run_filter_value" "$run_status"
      active_run_found=2
      break 2
    fi
    case "$run_presence" in
      none) ;;
      active) active_run_found=1; break 2 ;;
      *) active_run_found=2; break 2 ;;
    esac
  done
  filter_index=$((filter_index + 1))
done
case "$active_run_found" in
  0) ;;
  1) printf '%s\n' 'PRESERVE - active workflow'; continue ;;
  2) printf '%s\n' 'PRESERVE - workflow inventory uncertain'; continue ;;
  *) printf '%s\n' 'PRESERVE - invalid workflow state'; continue ;;
esac
```
An open matching PR or active workflow makes the branch live. Query failure
makes it uncertain.

For other candidates, inspect unique work using fully qualified refs:
```bash
local_ref="refs/heads/$branch"
main_ref='refs/remotes/origin/main'
git log --oneline --decorate --no-merges "$main_ref..$local_ref"
git diff --stat "$main_ref...$local_ref" --
git diff --name-status "$main_ref...$local_ref" --
git cherry -v "$main_ref" "$local_ref"
```
Do not use `eval`, parse names from displays, embed names in shell source, or use
unquoted interpolation. Git permits shell metacharacters in refnames. Use quoted
variables, fully qualified refs, and `--` before operands when supported.
Preserve a branch that cannot be handled safely.

## Classify every branch
Use exactly one decision for each local branch:
| Decision | Meaning | Allowed action |
| --- | --- | --- |
| `PRESERVE - live` | A worktree, claim, task, PR, CI run, or recent owner is active | Read-only inspection |
| `PRESERVE - recovery` | Backup, rescue, archive, or WIP snapshot still protects work | Keep and assign disposition follow-up |
| `PRESERVE - uncertain` | Ownership or unique-work evidence is incomplete | Keep and report missing evidence |
| `PR` | Scoped, complete, verified work has no current PR and is authorized for review | Open one PR |
| `DELETE` | Redundant work is proven safe to remove and cleanup is authorized | Remove only the proven refs |

If every branch is live, recovery, or uncertain, delete nothing and say so.

## Choose the deletion profile

Read-only inventory and PR creation may run alongside other sessions. Before
classifying anything as `DELETE`, choose exactly one profile and record it in
the owning Bead. Never silently fall from the automatic profile into the manual
profile.

### Automatic retirement

Unattended retirement requires the full repository-wide maintenance gate. It
must quiesce and exclude every supported local and remote writer, have one
auditable owner and bounded lifetime, and remain held from final checks through
postcondition verification. If any enforcement plane is absent, automatic
retirement remains proposal-only. Automatic retirement never deletes remote
refs.

### Maintainer-authorized manual cleanup

A current maintainer may explicitly authorize a bounded manual cleanup in the
current task. Record the instruction, repository, exact candidate set,
local-only or local-and-remote scope, Bead, session, branch, worktree, and
audited default-branch OID before mutation. Historical, standing, inferred, or
unbounded permission is insufficient, and local cleanup authority does not
imply remote deletion.

The manual profile substitutes current authorization plus exact fail-closed
proof for the unavailable cross-system transaction. It still must acquire and
retain the local maintenance lease, rerun every Beads, GitHub, process,
worktree, ref, recency, archive, and recovery check immediately before each
mutation, and stop on any query failure, new or changed candidate-owning owner
or activity, drift, or uncertainty. It must run and never bypass
`worktree-guard`.

Authorization expires when the batch ends, the local lease is lost, an audited
OID or owner changes, or task context changes. It never permits direct pushes
to `main`, protected-ref mutation, forced worktree removal, deletion of unique
work, or continuation after a failed or uncertain postcondition.

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
the remote to be absent or already equal to `verified_oid`. Resolve fetch and
all push URLs and require one exact destination before pushing a missing remote
with an empty expected-value lease:

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
Before any worktree or ref deletion, read and follow
[Deletion proof](references/deletion-proof.md) in full. It is normative and
must run under the recorded automatic or manual profile. If the profile,
authorization, local lease, worktree guard, a proof, a parse, or a postcondition
is unavailable or uncertain, preserve. Never bypass `worktree-guard` merely to
finish a sweep.

If a strict worktree-guard refusal appears to be a false positive, stop the
cleanup. Fix the guard in a separate task with a regression test, verify both
strict and legacy behavior, then begin a new cleanup batch with fresh inventory
and authorization; never retry the refused removal in the current batch.
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
Report every local branch, including protected and preserved entries:
| Branch | Live or recovery signals | Unique-work evidence | Decision | Action |
| --- | --- | --- | --- | --- |
State PR links, refs removed, exact preservation reasons, untouched worktrees,
and curation Bead state. Call nothing stale or useless without the proof above.
