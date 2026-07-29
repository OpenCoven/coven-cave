# Deletion proof

This procedure is normative. Run it only inside the repository-wide exclusive
deletion gate described by the parent skill. If the gate, a command, a parse, or
a postcondition is unavailable or uncertain, preserve the candidate.

## Required disposition

Delete only when all of these remain true under the gate:

1. The branch is neither protected nor tool-owned.
2. No live worktree, writer, claim, session, non-closed task, PR, or workflow
   owns it.
3. Configuration-independent inspection finds no staged, unstaged, untracked,
   ignored, submodule, assume-unchanged, or skip-worktree state.
4. The local ref is not symbolic.
5. The tip and every recovery record are older than 24 hours.
6. Every local and remote tip is redundant on the freshly fetched default
   branch or exactly matches the recorded head of a merged PR.
7. Every recovery OID is reachable from that default branch or from an
   owner-authorized retained remote archive recorded in Beads.

## Capture and prove exact tips

Treat branch names as data and use full refs. Resolve the remote default branch,
local tip, and exact same-named remote tip without trusting tracking refs:

```bash
unsafe_git_environment=0
while IFS= read -r -d '' environment_entry; do
  environment_name=${environment_entry%%=*}
  case "$environment_name" in
    GIT_DIR|GIT_WORK_TREE|GIT_COMMON_DIR|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|\
    GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_GRAFT_FILE|GIT_SHALLOW_FILE|\
    GIT_REPLACE_REF_BASE|GIT_NAMESPACE|GIT_QUARANTINE_PATH|GIT_EXEC_PATH|\
    GIT_SSH|GIT_SSH_COMMAND|GIT_PROXY_COMMAND|GIT_CEILING_DIRECTORIES|\
    GIT_DISCOVERY_ACROSS_FILESYSTEM|GIT_ENVIRONMENT_READ_FAILED)
      unsafe_git_environment=1; break
      ;;
  esac
done < <(env -0 || printf 'GIT_ENVIRONMENT_READ_FAILED=1\0')
test "$unsafe_git_environment" -eq 0 ||
  { printf 'PRESERVE - unsafe Git environment\n'; continue; }

git_binary=$(type -P git) ||
  { printf 'PRESERVE - Git binary unavailable\n'; continue; }
git_exact() {
  env -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS \
    -u GIT_CONFIG_SYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_NOSYSTEM \
    GIT_NO_REPLACE_OBJECTS=1 "$git_binary" "$@"
}
git() { git_exact "$@"; }
common_git_dir=$(git rev-parse --path-format=absolute --git-common-dir) ||
  { printf 'PRESERVE - common Git dir unavailable\n'; continue; }
test ! -e "$common_git_dir/info/grafts" &&
  test ! -L "$common_git_dir/info/grafts" ||
  { printf 'PRESERVE - legacy graft state present\n'; continue; }
replace_refs=$(git for-each-ref --format='%(refname)' refs/replace) ||
  { printf 'PRESERVE - replacement ref inventory failed\n'; continue; }
test -z "$replace_refs" ||
  { printf 'PRESERVE - replacement refs present\n'; continue; }
audited_fetch_url=$(git remote get-url origin) ||
  { printf 'PRESERVE - fetch URL unavailable\n'; continue; }
audited_push_urls=$(git remote get-url --push --all origin) ||
  { printf 'PRESERVE - push URL unavailable\n'; continue; }
test "$audited_push_urls" = "$audited_fetch_url" ||
  { printf 'PRESERVE - push destination differs\n'; continue; }
case "$audited_fetch_url" in
  https://github.com/*) audited_gh_repo=${audited_fetch_url#https://github.com/} ;;
  *) printf 'PRESERVE - unsupported GitHub origin\n'; continue ;;
esac
audited_gh_repo=${audited_gh_repo%.git}
case "$audited_gh_repo" in
  ''|/*|*/|*/*/*|*[!A-Za-z0-9._/-]*)
    printf 'PRESERVE - invalid GitHub repository\n'; continue ;;
esac
audited_gh_owner=${audited_gh_repo%%/*}
audited_gh_name=${audited_gh_repo#*/}
remote_main_ref='refs/heads/main'
main_line=$(git ls-remote --exit-code origin "$remote_main_ref") ||
  { printf 'PRESERVE - base lookup failed\n'; continue; }
read -r remote_main_oid observed_main_ref <<EOF
$main_line
EOF
test "$observed_main_ref" = "$remote_main_ref" ||
  { printf 'PRESERVE - wrong base ref\n'; continue; }
git fetch --no-prune --no-tags origin "$remote_main_ref" ||
  { printf 'PRESERVE - base fetch failed\n'; continue; }
audited_main_oid=$(git_exact rev-parse --verify 'FETCH_HEAD^{commit}') ||
  { printf 'PRESERVE - fetched base missing\n'; continue; }
test "$audited_main_oid" = "$remote_main_oid" ||
  { printf 'PRESERVE - fetched base mismatch\n'; continue; }

audited_local_oid=$(git_exact rev-parse --verify "$local_ref^{commit}") ||
  { printf 'PRESERVE - local tip missing\n'; continue; }
remote_ref="refs/heads/$branch"
audited_remote_oid=''
if remote_line=$(git ls-remote --exit-code --heads origin "$remote_ref"); then
  read -r audited_remote_oid observed_remote_ref <<EOF
$remote_line
EOF
  test "$observed_remote_ref" = "$remote_ref" ||
    { printf 'PRESERVE - wrong remote ref\n'; continue; }
  git fetch --no-prune --no-tags origin "$remote_ref" ||
    { printf 'PRESERVE - remote fetch failed\n'; continue; }
  fetched_remote_oid=$(git_exact rev-parse --verify 'FETCH_HEAD^{commit}') ||
    { printf 'PRESERVE - fetched remote missing\n'; continue; }
  test "$fetched_remote_oid" = "$audited_remote_oid" ||
    { printf 'PRESERVE - fetched remote mismatch\n'; continue; }
else
  remote_status=$?
  case "$remote_status" in
    2) audited_remote_oid='' ;;
    *) printf 'PRESERVE - remote lookup failed (%s)\n' "$remote_status"; continue ;;
  esac
fi
if test -n "$audited_remote_oid"; then
  # GitHub's refs API exposes the current OID but not the ref's update time.
  # Commit timestamps cannot prove when a branch was created, reset, or pushed.
  printf 'PRESERVE - authoritative remote-ref recency unavailable\n'
  continue
fi
```

Query the commit's cross-repository pull-request association connection for
every audited tip. This discovers outbound base repositories and open PRs.
Preserve on any unavailable object, incomplete pagination, or schema error:

```bash
candidate_oids=("$audited_local_oid")
if test -n "$audited_remote_oid" &&
   test "$audited_remote_oid" != "$audited_local_oid"; then
  candidate_oids[${#candidate_oids[@]}]="$audited_remote_oid"
fi
associated_base_repos=()
canonical_origin_repo=''
for candidate_oid in "${candidate_oids[@]}"; do
  associated_pages=$(gh api --hostname github.com graphql --paginate --slurp \
    -F owner="$audited_gh_owner" -F name="$audited_gh_name" \
    -F oid="$candidate_oid" -f query='
      query($owner:String!, $name:String!, $oid:GitObjectID!, $endCursor:String) {
        repository(owner:$owner, name:$name) {
          nameWithOwner
          object(oid:$oid) {
            ... on Commit {
              associatedPullRequests(first:100, after:$endCursor) {
                nodes {
                  state isDraft headRefName headRefOid
                  headRepository { nameWithOwner }
                  baseRepository { nameWithOwner }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      }') ||
    { printf 'PRESERVE - associated PR query failed\n'; continue 2; }
  association_result=$(printf '%s' "$associated_pages" | jq -e \
    --arg branch "$branch" '
      if type == "array" and length > 0 and all(.[];
        (.data.repository.nameWithOwner | type) == "string" and
        (.data.repository.nameWithOwner |
          test("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")) and
        (.data.repository.object.associatedPullRequests.nodes | type) == "array" and
        (.data.repository.object.associatedPullRequests.pageInfo.hasNextPage | type) == "boolean")
      then .[0].data.repository.nameWithOwner as $canonical_repo |
        if all(.[].data.repository.nameWithOwner; . == $canonical_repo) then
        [.[].data.repository.object.associatedPullRequests.nodes[]] as $prs |
        if all($prs[];
          (.state == "OPEN" or .state == "CLOSED" or .state == "MERGED") and
          (.isDraft | type) == "boolean" and
          (.baseRepository.nameWithOwner | type) == "string" and
          (.baseRepository.nameWithOwner |
            test("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")) and
          (if .state == "OPEN" then
             (.headRepository.nameWithOwner | type) == "string" and
             (.headRefName | type) == "string"
           else true end))
        then {
          live: (if any($prs[];
            (.state == "OPEN" or .isDraft == true) and
            (.headRepository.nameWithOwner | ascii_downcase) ==
              ($canonical_repo | ascii_downcase) and
            .headRefName == $branch)
            then "active" else "none" end),
          bases: ([$prs[].baseRepository.nameWithOwner] | unique),
          canonical_repo: $canonical_repo
        }
        else error("malformed associated PR") end
        else error("inconsistent canonical repository") end
      else error("malformed associated PR pages") end
    ') || { printf 'PRESERVE - associated PR parse failed\n'; continue 2; }
  test "$(printf '%s' "$association_result" | jq -er '.live')" = none ||
    { printf 'PRESERVE - outbound PR is live\n'; continue 2; }
  candidate_canonical_repo=$(printf '%s' "$association_result" |
    jq -er '.canonical_repo') ||
    { printf 'PRESERVE - canonical repository parse failed\n'; continue 2; }
  if test -z "$canonical_origin_repo"; then
    canonical_origin_repo=$candidate_canonical_repo
  else
    test "$canonical_origin_repo" = "$candidate_canonical_repo" ||
      { printf 'PRESERVE - canonical repository changed\n'; continue 2; }
  fi
  base_repos=$(printf '%s' "$association_result" | jq -r '.bases[]?') ||
    { printf 'PRESERVE - associated base parse failed\n'; continue 2; }
  if test -n "$base_repos"; then
    while IFS= read -r base_repo; do
      associated_base_repos[${#associated_base_repos[@]}]="$base_repo"
    done <<EOF
$base_repos
EOF
  fi
done
```

The commit connection omits closed, unmerged drafts. Search all GitHub PRs by
the canonical head owner and exact branch, then filter every result by canonical
head repository. GitHub search exposes at most 1,000 results; preserve rather
than accepting truncated coverage:

```bash
test -n "$canonical_origin_repo" ||
  { printf 'PRESERVE - canonical repository unavailable\n'; continue; }
canonical_origin_owner=${canonical_origin_repo%%/*}
head_search_query="is:pr head:$canonical_origin_owner:$branch"
head_search_pages=$(gh api --hostname github.com graphql --paginate --slurp \
  -F searchQuery="$head_search_query" -f query='
    query($searchQuery:String!, $endCursor:String) {
      search(query:$searchQuery, type:ISSUE, first:100, after:$endCursor) {
        issueCount
        nodes {
          ... on PullRequest {
            state isDraft headRefName headRefOid
            headRepository { nameWithOwner }
            baseRepository { nameWithOwner }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }') ||
  { printf 'PRESERVE - exact-head PR search failed\n'; continue; }
head_search_result=$(printf '%s' "$head_search_pages" | jq -er \
  --arg repo "$canonical_origin_repo" --arg branch "$branch" '
    if type == "array" and length > 0 then
      .[0].data.search.issueCount as $issue_count |
    if ($issue_count | type) == "number" and
       $issue_count >= 0 and $issue_count <= 1000 and
       all(.[]; .data.search.issueCount == $issue_count and
         (.data.search.nodes | type) == "array" and
         (.data.search.pageInfo.hasNextPage | type) == "boolean") and
       .[-1].data.search.pageInfo.hasNextPage == false and
       ([.[].data.search.nodes[]] | length) == $issue_count
    then [.[].data.search.nodes[]] as $prs |
      if all($prs[];
        (.state == "OPEN" or .state == "CLOSED" or .state == "MERGED") and
        (.isDraft | type) == "boolean" and
        (.headRefName | type) == "string" and
        (.headRepository.nameWithOwner | type) == "string")
      then if any($prs[];
        (.state == "OPEN" or .isDraft == true) and
        (.headRepository.nameWithOwner | ascii_downcase) ==
          ($repo | ascii_downcase) and
        .headRefName == $branch)
        then "active" else "none" end
      else error("malformed exact-head PR") end
    else error("incomplete exact-head PR search") end
    else error("missing exact-head PR pages") end
  ') || { printf 'PRESERVE - exact-head PR parse failed\n'; continue; }
test "$head_search_result" = none ||
  { printf 'PRESERVE - exact outbound PR head is live\n'; continue; }
```

For every associated base repository and audited OID, repeat the parent skill's
active-status Actions queries with explicit `--hostname github.com` and
`"repos/$base_repo/actions/runs"`. Preserve on an active run, query failure, or
malformed count. This supplements the exact-origin branch and OID queries.

For ancestry-based deletion, every tip must pass an explicitly guarded check:

```bash
git_exact merge-base --is-ancestor "$audited_local_oid" "$audited_main_oid" ||
  { printf 'PRESERVE - local ancestry\n'; continue; }
if test -n "$audited_remote_oid"; then
  git_exact merge-base --is-ancestor "$audited_remote_oid" "$audited_main_oid" ||
    { printf 'PRESERVE - remote ancestry\n'; continue; }
fi
```

For the merged-PR route, query the exact PR with `gh pr view --repo
"github.com/$canonical_origin_repo" --json state,headRefOid`, parse it with `jq -e`,
require `.state == "MERGED"`, and require each existing tip to equal
`.headRefOid`. Do not apply GraphQL state semantics to the REST pulls inventory,
where a merged PR reports `closed`. Independently require every exact current
local and remote tip to pass `oid_is_retained`; reflog presence is not a
substitute. Any query, parse, OID, or retention failure preserves.

## Prove archives and recovery logs

Populate `authorized_archive_refs` only with full owner-approved remote refs
whose retention is recorded. Fetch each exact ref, verify `FETCH_HEAD` against
`ls-remote`, and build `authorized_archive_oids`:

```bash
candidate_is_planned=0
test -z "$audited_remote_oid" && candidate_is_planned=1
for deletion_ref in "${planned_deletion_remote_refs[@]}"; do
  test "$deletion_ref" = "$remote_ref" && candidate_is_planned=1
done
test "$candidate_is_planned" -eq 1 ||
  { printf 'PRESERVE - deletion plan incomplete\n'; continue; }
archives_safe=1
authorized_archive_oids=()
for archive_ref in "${authorized_archive_refs[@]}"; do
  case "$archive_ref" in refs/heads/*) ;; *) archives_safe=0; break ;; esac
  for deletion_ref in "${planned_deletion_remote_refs[@]}"; do
    test "$archive_ref" != "$deletion_ref" ||
      { archives_safe=0; break; }
  done
  test "$archives_safe" -eq 1 || break
  if ! remote_line=$(git ls-remote --exit-code origin "$archive_ref"); then
    archives_safe=0; break
  fi
  read -r remote_archive_oid observed_archive_ref <<EOF
$remote_line
EOF
  test "$observed_archive_ref" = "$archive_ref" ||
    { archives_safe=0; break; }
  git fetch --no-prune --no-tags origin "$archive_ref" ||
    { archives_safe=0; break; }
  fetched_archive_oid=$(git_exact rev-parse --verify 'FETCH_HEAD^{commit}') ||
    { archives_safe=0; break; }
  test "$fetched_archive_oid" = "$remote_archive_oid" ||
    { archives_safe=0; break; }
  authorized_archive_oids[${#authorized_archive_oids[@]}]="$fetched_archive_oid"
done
test "$archives_safe" -eq 1 ||
  { printf 'PRESERVE - archive refresh failed\n'; continue; }
```

Use the repository's object format, a numeric cutoff, and raw reflog records.
The raw parser must prove both old and new nonzero OIDs, including the old OID
of the oldest retained record:

```bash
now_epoch=$(date +%s) ||
  { printf 'PRESERVE - clock failed\n'; continue; }
case "$now_epoch" in ''|*[!0-9]*) printf 'PRESERVE - clock invalid\n'; continue ;; esac
recency_cutoff_epoch=$((now_epoch - 86400))
object_format=$(git rev-parse --show-object-format) ||
  { printf 'PRESERVE - object format failed\n'; continue; }
case "$object_format" in
  sha1) oid_width=40 ;;
  sha256) oid_width=64 ;;
  *) printf 'PRESERVE - unknown object format\n'; continue ;;
esac

oid_is_retained() {
  local oid=$1 archive_oid object_type
  object_type=$(git_exact cat-file -t "$oid") || return 1
  # An annotated tag's peeled commit does not retain the tag object itself.
  # Preserve non-commit recovery objects until an exact-object archive is proven.
  test "$object_type" = commit || return 1
  git_exact merge-base --is-ancestor "$oid" "$audited_main_oid" && return 0
  for archive_oid in "${authorized_archive_oids[@]}"; do
    git_exact merge-base --is-ancestor "$oid" "$archive_oid" && return 0
  done
  return 1
}
oid_is_retained "$audited_local_oid" ||
  { printf 'PRESERVE - current local tip is not retained\n'; continue; }
if test -n "$audited_remote_oid"; then
  oid_is_retained "$audited_remote_oid" ||
    { printf 'PRESERVE - current remote tip is not retained\n'; continue; }
fi

emit_reflog_records() {
  awk -v width="$oid_width" '
    function valid(o) { return length(o) == width && o ~ /^[0-9a-f]+$/ }
    function zero(o) { return o ~ /^0+$/ }
    {
      tab=index($0, "\t"); if (!tab) { bad=1; next }
      n=split(substr($0, 1, tab-1), parts, " ")
      if (n < 6 || !valid(parts[1]) || !valid(parts[2]) ||
          parts[n-2] !~ /^<[^<>[:space:]]+>$/ ||
          parts[n-1] !~ /^[0-9]+$/ ||
          parts[n] !~ /^[+-][0-9][0-9][0-9][0-9]$/) { bad=1; next }
      if (!zero(parts[1])) print parts[n-1], parts[1]
      if (!zero(parts[2])) print parts[n-1], parts[2]
    }
    END { if (bad || NR == 0) exit 1 }
  ' "$1"
}

prove_reflog() {
  local reflog_records epoch oid
  reflog_records=$(emit_reflog_records "$1") || return 1
  test -n "$reflog_records" || return 1
  while IFS=' ' read -r epoch oid; do
    case "$epoch" in ''|*[!0-9]*) return 1 ;; esac
    test "$epoch" -lt "$recency_cutoff_epoch" || return 1
    oid_is_retained "$oid" || return 1
  done <<EOF
$reflog_records
EOF
}
```

Require the branch tip and raw branch reflog to be old and retained:

```bash
tip_epoch=$(git_exact log -1 --format='%ct' "$local_ref") ||
  { printf 'PRESERVE - tip timestamp failed\n'; continue; }
case "$tip_epoch" in ''|*[!0-9]*) printf 'PRESERVE - tip timestamp invalid\n'; continue ;; esac
test "$tip_epoch" -lt "$recency_cutoff_epoch" ||
  { printf 'PRESERVE - recent tip\n'; continue; }
branch_reflog=$(git rev-parse --path-format=absolute --git-path "logs/$local_ref") ||
  { printf 'PRESERVE - branch reflog path failed\n'; continue; }
case "$branch_reflog" in
  "$common_git_dir"/logs/refs/heads/*) ;;
  *) printf 'PRESERVE - branch reflog escaped Git dir\n'; continue ;;
esac
reflog_component=${branch_reflog%/*}
while test "$reflog_component" != "$common_git_dir/logs"; do
  test -d "$reflog_component" && test ! -L "$reflog_component" ||
    { printf 'PRESERVE - unsafe branch reflog parent\n'; continue 2; }
  next_reflog_component=${reflog_component%/*}
  test "$next_reflog_component" != "$reflog_component" ||
    { printf 'PRESERVE - branch reflog parent loop\n'; continue 2; }
  reflog_component=$next_reflog_component
done
test -d "$common_git_dir/logs" && test ! -L "$common_git_dir/logs" &&
  test -f "$branch_reflog" && test ! -L "$branch_reflog" ||
  { printf 'PRESERVE - unsafe branch reflog\n'; continue; }
prove_reflog "$branch_reflog" ||
  { printf 'PRESERVE - branch reflog proof failed\n'; continue; }
```

## Prove every removable-worktree recovery root

Resolve the linked worktree's private Git directory. Prove its current `HEAD`
commit and every raw reflog file under its private `logs/` directory:

```bash
worktree_git_dir=$(git -C "$worktree_path" rev-parse --absolute-git-dir) ||
  { printf 'PRESERVE - worktree git dir missing\n'; continue; }
worktree_head_oid=$(git_exact -C "$worktree_path" rev-parse \
  --verify 'HEAD^{commit}') ||
  { printf 'PRESERVE - worktree HEAD missing\n'; continue; }
oid_is_retained "$worktree_head_oid" ||
  { printf 'PRESERVE - worktree HEAD unique\n'; continue; }
test -d "$worktree_git_dir/logs" && test ! -L "$worktree_git_dir/logs" ||
  { printf 'PRESERVE - unsafe worktree logs path\n'; continue; }
test -f "$worktree_git_dir/logs/HEAD" &&
  test ! -L "$worktree_git_dir/logs/HEAD" ||
  { printf 'PRESERVE - worktree HEAD reflog missing\n'; continue; }

worktree_recovery_safe=1
worktree_head_reflog_seen=0
while IFS= read -r -d '' worktree_log_entry; do
  if test -L "$worktree_log_entry"; then
    worktree_recovery_safe=0; break
  elif test -d "$worktree_log_entry"; then
    continue
  elif test -f "$worktree_log_entry"; then
    prove_reflog "$worktree_log_entry" ||
      { worktree_recovery_safe=0; break; }
    test "$worktree_log_entry" = "$worktree_git_dir/logs/HEAD" &&
      worktree_head_reflog_seen=1
  else
    worktree_recovery_safe=0; break
  fi
done < <(
  find "$worktree_git_dir/logs" -mindepth 1 -print0 ||
    printf '%s\0' "$worktree_git_dir/.reflog-find-failed"
)
test "$worktree_recovery_safe" -eq 1 &&
  test "$worktree_head_reflog_seen" -eq 1 ||
  { printf 'PRESERVE - worktree reflog proof failed\n'; continue; }
```

Enumerate every recognized per-worktree ref, prove its commit, and reject raw
private refs outside the documented namespaces:

```bash
if ! worktree_ref_errors=$(git -C "$worktree_path" for-each-ref \
  --format='%(objectname) %(refname)' \
  refs/bisect refs/rewritten refs/worktree 2>&1 >/dev/null); then
  printf 'PRESERVE - worktree ref inventory failed\n'; continue
fi
test -z "$worktree_ref_errors" ||
  { printf 'PRESERVE - worktree ref warnings\n'; continue; }
worktree_refs=$(git -C "$worktree_path" for-each-ref \
  --format='%(objectname) %(refname)' \
  refs/bisect refs/rewritten refs/worktree 2>/dev/null) ||
  { printf 'PRESERVE - worktree ref inventory failed\n'; continue; }
if ! worktree_ref_errors=$(git -C "$worktree_path" for-each-ref \
  --format='%(objectname) %(refname)' \
  refs/bisect refs/rewritten refs/worktree 2>&1 >/dev/null); then
  printf 'PRESERVE - worktree ref recheck failed\n'; continue
fi
test -z "$worktree_ref_errors" ||
  { printf 'PRESERVE - worktree ref recheck warnings\n'; continue; }
worktree_recovery_safe=1
parsed_worktree_refs=()
if test -n "$worktree_refs"; then
  while IFS=' ' read -r ref_oid ref_name extra; do
    test -n "$ref_oid" && test -n "$ref_name" && test -z "$extra" ||
      { worktree_recovery_safe=0; break; }
    case "$ref_name" in
      refs/bisect/*|refs/rewritten/*|refs/worktree/*) ;;
      *) worktree_recovery_safe=0; break ;;
    esac
    resolved_ref_oid=$(git_exact -C "$worktree_path" rev-parse \
      --verify "$ref_name") ||
      { worktree_recovery_safe=0; break; }
    oid_is_retained "$resolved_ref_oid" ||
      { worktree_recovery_safe=0; break; }
    parsed_worktree_refs[${#parsed_worktree_refs[@]}]="$ref_name"
  done <<EOF
$worktree_refs
EOF
fi
test "$worktree_recovery_safe" -eq 1 ||
  { printf 'PRESERVE - worktree ref proof failed\n'; continue; }

if test -L "$worktree_git_dir/refs"; then
  printf 'PRESERVE - symbolic worktree refs\n'; continue
elif test -d "$worktree_git_dir/refs"; then
  while IFS= read -r -d '' raw_ref; do
    if test -L "$raw_ref"; then
      worktree_recovery_safe=0; break
    elif test -d "$raw_ref"; then
      continue
    elif ! test -f "$raw_ref"; then
      worktree_recovery_safe=0; break
    fi
    raw_ref_name=${raw_ref#"$worktree_git_dir/"}
    case "$raw_ref_name" in
      refs/bisect/*|refs/rewritten/*|refs/worktree/*) ;;
      *) worktree_recovery_safe=0; break ;;
    esac
    raw_ref_is_parsed=0
    for parsed_ref_name in "${parsed_worktree_refs[@]}"; do
      test "$parsed_ref_name" = "$raw_ref_name" &&
        { raw_ref_is_parsed=1; break; }
    done
    test "$raw_ref_is_parsed" -eq 1 ||
      { worktree_recovery_safe=0; break; }
  done < <(
    find "$worktree_git_dir/refs" -mindepth 1 -print0 ||
      printf '%s\0' "$worktree_git_dir/.ref-find-failed"
  )
fi
test "$worktree_recovery_safe" -eq 1 ||
  { printf 'PRESERVE - unknown worktree ref\n'; continue; }
```

Prove `ORIG_HEAD` and every first-field OID in `FETCH_HEAD`. Treat operation
state, locked worktrees, and unknown top-level admin entries as live or
uncertain:

```bash
emit_plain_oids() {
  awk -v width="$oid_width" '
    length($0) == width && $0 ~ /^[0-9a-f]+$/ { print; next }
    { bad=1 }
    END { if (bad || NR == 0) exit 1 }
  ' "$1"
}
emit_fetch_oids() {
  awk -v width="$oid_width" '
    {
      tab=index($0, "\t")
      oid=tab ? substr($0, 1, tab-1) : ""
      if (length(oid) != width || oid !~ /^[0-9a-f]+$/) { bad=1; next }
      print oid
    }
    END { if (bad || NR == 0) exit 1 }
  ' "$1"
}
prove_oid_lines() {
  local oid_lines=$1 recovery_oid
  test -n "$oid_lines" || return 1
  while IFS= read -r recovery_oid; do
    oid_is_retained "$recovery_oid" || return 1
  done <<EOF
$oid_lines
EOF
}

worktree_admin_safe=1
while IFS= read -r -d '' admin_entry; do
  admin_name=${admin_entry##*/}
  test ! -L "$admin_entry" ||
    { worktree_admin_safe=0; break; }
  case "$admin_name" in
    HEAD|commondir|gitdir|index|config.worktree|COMMIT_EDITMSG|sharedindex.*)
      test -f "$admin_entry" || { worktree_admin_safe=0; break; }
      ;;
    logs|refs)
      test -d "$admin_entry" || { worktree_admin_safe=0; break; }
      ;;
    ORIG_HEAD)
      test -f "$admin_entry" || { worktree_admin_safe=0; break; }
      admin_oids=$(emit_plain_oids "$admin_entry") &&
        prove_oid_lines "$admin_oids" || { worktree_admin_safe=0; break; }
      ;;
    FETCH_HEAD)
      test -f "$admin_entry" || { worktree_admin_safe=0; break; }
      admin_oids=$(emit_fetch_oids "$admin_entry") &&
        prove_oid_lines "$admin_oids" || { worktree_admin_safe=0; break; }
      ;;
    locked|MERGE_HEAD|REBASE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|BISECT_HEAD|AUTO_MERGE|sequencer|rebase-*)
      worktree_admin_safe=0; break
      ;;
    *) worktree_admin_safe=0; break ;;
  esac
done < <(
  find "$worktree_git_dir" -mindepth 1 -maxdepth 1 -print0 ||
    printf '%s\0' "$worktree_git_dir/.admin-find-failed"
)
test "$worktree_admin_safe" -eq 1 ||
  { printf 'PRESERVE - worktree admin recovery state\n'; continue; }
```

The separate current-`HEAD` proof above covers detached HEAD. Do not assume the
branch ref or `logs/HEAD` alone covers it.

## Recheck, mutate, and verify in order

Still under the gate, rerun every ownership, worktree-state, PR, workflow,
recency, archive, and recovery check. Requery and refetch the exact default and
candidate remote refs, recapture the local tip, require all OIDs to equal the
audited OIDs, and rerun the selected guarded redundancy proof immediately
before mutation.

Each mutation is a transaction boundary. A failure or uncertain postcondition
stops the sequence; never continue to the next deletion:

```bash
if test -n "$worktree_path"; then
  git worktree remove -- "$worktree_path" ||
    { printf 'PRESERVE - worktree removal failed\n'; continue; }
  test ! -e "$worktree_path" && test ! -L "$worktree_path" ||
    { printf 'PRESERVE - worktree path remains\n'; continue; }
  worktree_list_ok=1
  worktree_still_registered=0
  while IFS= read -r -d '' worktree_field; do
    case "$worktree_field" in
      "worktree $worktree_path") worktree_still_registered=1 ;;
      branch-curator-worktree-list-failed) worktree_list_ok=0 ;;
    esac
  done < <(
    git worktree list --porcelain -z ||
      printf 'branch-curator-worktree-list-failed\0'
  )
  test "$worktree_list_ok" -eq 1 &&
    test "$worktree_still_registered" -eq 0 ||
    { printf 'PRESERVE - worktree registry remains uncertain\n'; continue; }
fi

git update-ref --no-deref -d "$local_ref" "$audited_local_oid" ||
  { printf 'PRESERVE - local compare-and-delete failed\n'; continue; }
if git show-ref --verify --quiet "$local_ref"; then
  printf 'PRESERVE - local ref remains\n'; continue
else
  local_absence_status=$?
  test "$local_absence_status" -eq 1 ||
    { printf 'PRESERVE - local verification failed\n'; continue; }
fi

if test -n "$audited_remote_oid"; then
  current_fetch_url=$(git remote get-url origin) ||
    { printf 'PRESERVE - fetch URL recheck failed\n'; continue; }
  current_push_urls=$(git remote get-url --push --all origin) ||
    { printf 'PRESERVE - push URL recheck failed\n'; continue; }
  test "$current_fetch_url" = "$audited_fetch_url" &&
    test "$current_push_urls" = "$audited_push_urls" &&
    test "$current_push_urls" = "$current_fetch_url" ||
    { printf 'PRESERVE - remote destination changed\n'; continue; }
  git push --force-with-lease="$remote_ref:$audited_remote_oid" \
    origin ":$remote_ref" ||
    { printf 'PRESERVE - remote lease delete failed\n'; continue; }
  if git ls-remote --exit-code --heads origin "$remote_ref" >/dev/null; then
    printf 'PRESERVE - remote ref remains\n'; continue
  else
    remote_absence_status=$?
    test "$remote_absence_status" -eq 2 ||
      { printf 'PRESERVE - remote verification failed\n'; continue; }
  fi
fi

archive_index=0
while test "$archive_index" -lt "${#authorized_archive_refs[@]}"; do
  archive_ref=${authorized_archive_refs[$archive_index]}
  archive_oid=${authorized_archive_oids[$archive_index]}
  archive_line=$(git ls-remote --exit-code origin "$archive_ref") ||
    { printf 'PRESERVE - retained archive missing\n'; continue 2; }
  read -r verified_archive_oid verified_archive_ref <<EOF
$archive_line
EOF
  test "$verified_archive_ref" = "$archive_ref" &&
    test "$verified_archive_oid" = "$archive_oid" ||
    { printf 'PRESERVE - retained archive changed\n'; continue 2; }
  archive_index=$((archive_index + 1))
done
```

Re-inventory refs and worktrees before reporting. Record partial success
truthfully if a later transaction stopped after an earlier verified deletion.
Never bypass `worktree-guard` merely to complete a sweep.
