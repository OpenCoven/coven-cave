import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(sourceRoot, "scripts", "worktree-lifecycle-patrol.ts");
const fixtureRoot = mkdtempSync(path.join(sourceRoot, ".worktree-lifecycle-fixture-"));
const repo = path.join(fixtureRoot, "repo");
const origin = path.join(fixtureRoot, "origin.git");
const bin = path.join(fixtureRoot, "bin");
const gitBin = path.join(fixtureRoot, "git-bin");
const registeredDrift = path.join(fixtureRoot, "registered-drift");
const duplicateRegisteredPath = path.join(fixtureRoot, "duplicate-registered");
const duplicateWorktreeInventory = path.join(fixtureRoot, "duplicate-worktree-inventory");

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function git(args, cwd, options) {
  return run("git", args, cwd, options);
}

function executable(file, contents) {
  writeFileSync(file, contents);
  chmodSync(file, 0o755);
}

try {
  mkdirSync(repo);
  mkdirSync(origin);
  mkdirSync(bin);
  mkdirSync(gitBin);

  git(["init", "-q", "-b", "main"], repo);
  git(["init", "-q", "--bare"], origin);
  git(["config", "user.name", "Cave Test"], repo);
  git(["config", "user.email", "cave@example.invalid"], repo);
  git(["config", "commit.gpgsign", "false"], repo);
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(["add", "README.md"], repo);
  git(["commit", "-q", "-m", "initial"], repo);
  git(["remote", "add", "origin", origin], repo);
  git(["push", "-q", "-u", "origin", "main"], repo);
  git(["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"], fixtureRoot);

  const old = path.join(repo, ".worktrees", "old");
  git(["worktree", "add", "-q", "-b", "feat/old", old], repo);
  writeFileSync(path.join(old, "old.txt"), "landed\n");
  git(["add", "old.txt"], old);
  git(["commit", "-q", "-m", "old merged work"], old, {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-20T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-20T12:00:00Z",
    },
  });
  const oldHead = git(["rev-parse", "HEAD"], old).trim();
  git(["push", "-q", "-u", "origin", "feat/old"], old);

  const recentMerge = path.join(repo, ".worktrees", "recent-merge");
  git(["worktree", "add", "-q", "-b", "feat/recent-merge", recentMerge, "origin/main"], repo);
  writeFileSync(path.join(recentMerge, "recent.txt"), "recent merge\n");
  git(["add", "recent.txt"], recentMerge);
  git(["commit", "-q", "-m", "recently merged work"], recentMerge, {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-20T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-20T12:00:00Z",
    },
  });
  const recentMergeHead = git(["rev-parse", "HEAD"], recentMerge).trim();
  git(["push", "-q", "-u", "origin", "feat/recent-merge"], recentMerge);

  const recentReflog = path.join(repo, ".worktrees", "recent-reflog");
  git(["worktree", "add", "-q", "-b", "feat/recent-reflog", recentReflog, "origin/main"], repo);
  writeFileSync(path.join(recentReflog, "reflog.txt"), "recent reflog\n");
  git(["add", "reflog.txt"], recentReflog);
  git(["commit", "-q", "-m", "old work with recent activity"], recentReflog, {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-20T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-20T12:00:00Z",
    },
  });
  git(["reset", "-q", "--hard", "HEAD"], recentReflog, {
    env: {
      ...process.env,
      GIT_COMMITTER_DATE: "2026-08-10T21:00:00Z",
    },
  });
  const recentReflogHead = git(["rev-parse", "HEAD"], recentReflog).trim();
  git(["push", "-q", "-u", "origin", "feat/recent-reflog"], recentReflog);

  const live = path.join(repo, ".worktrees", "live");
  git(["worktree", "add", "-q", "-b", "feat/live", live, "origin/main"], repo);
  writeFileSync(path.join(live, "uncommitted.txt"), "live\n");

  const linked = path.join(repo, ".worktrees", "linked");
  git(["worktree", "add", "-q", "-b", "feat/cave-link1-linked", linked, "origin/main"], repo);

  const spaced = path.join(repo, ".worktrees", "spaced ");
  git(["worktree", "add", "-q", "-b", "feat/spaced", spaced, "origin/main"], repo);
  writeFileSync(path.join(spaced, "significant-space.txt"), "dirty\n");

  const branchOnlyPath = path.join(repo, ".worktrees", "branch-only");
  git(["worktree", "add", "-q", "-b", "feat/branch-only", branchOnlyPath, "origin/main"], repo);
  writeFileSync(path.join(branchOnlyPath, "branch-only.txt"), "landed branch-only work\n");
  git(["add", "branch-only.txt"], branchOnlyPath);
  git(["commit", "-q", "-m", "old branch-only work"], branchOnlyPath, {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-20T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-20T12:00:00Z",
    },
  });
  const branchOnlyHead = git(["rev-parse", "HEAD"], branchOnlyPath).trim();
  git(["push", "-q", "-u", "origin", "feat/branch-only"], branchOnlyPath);
  git(["worktree", "remove", branchOnlyPath], repo);
  git(["merge", "-q", "--no-ff", "feat/branch-only", "-m", "land branch-only work"], repo, {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-21T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-21T12:00:00Z",
    },
  });
  git(["push", "-q", "origin", "main"], repo);

  const detached = path.join(repo, ".worktrees", "detached");
  git(["worktree", "add", "-q", "--detach", detached, "origin/main"], repo);
  const defaultHead = git(["rev-parse", "refs/remotes/origin/main"], repo).trim();
  const workflowHead = "d".repeat(defaultHead.length);
  git(["update-ref", "refs/remotes/origin/trunk", defaultHead], repo);
  const worktreeInventory = git(["worktree", "list", "--porcelain", "-z"], repo);
  writeFileSync(
    duplicateWorktreeInventory,
    `${worktreeInventory}worktree ${duplicateRegisteredPath}\0HEAD ${oldHead}\0branch refs/heads/feat/old\0\0`,
  );

  const validMetadata = {
    branch: "feat/old",
    path: old,
    owner: "Kitty",
    purpose: "Malformed date fixture",
    disposition: "pr",
    createdAt: "2026-07-20T12:00:00Z",
  };
  for (const [name, worktree] of Object.entries({
    "created-at-informal": {
      ...validMetadata,
      createdAt: "July 20, 2026 12:00 UTC",
    },
    "created-at-rolled": {
      ...validMetadata,
      createdAt: "2026-02-30T12:00:00Z",
    },
    "review-after-timestamp": {
      ...validMetadata,
      disposition: "archive",
      reason: "Review fixture",
      reviewAfter: "2026-08-11T00:00:00Z",
    },
    "review-after-invalid": {
      ...validMetadata,
      disposition: "archive",
      reason: "Review fixture",
      reviewAfter: "2026-02-30",
    },
    "expires-at-informal": {
      ...validMetadata,
      exception: {
        owner: "Kitty",
        reason: "Exception fixture",
        expiresAt: "August 11, 2026 UTC",
        additionalPaths: [old],
      },
    },
    "expires-at-rolled": {
      ...validMetadata,
      exception: {
        owner: "Kitty",
        reason: "Exception fixture",
        expiresAt: "2026-02-30T00:00:00Z",
        additionalPaths: [old],
      },
    },
  })) {
    writeFileSync(
      path.join(fixtureRoot, `metadata-${name}.json`),
      JSON.stringify([
        {
          id: "cave-old",
          status: "closed",
          title: "Malformed metadata date",
          metadata: { coven: { worktree } },
        },
      ]),
    );
  }
  const branchOnlyMetadataTask = {
    id: "cave-branch-only",
    status: "closed",
    title: "Branch only",
    metadata: {
      coven: {
        worktree: {
          branch: "feat/branch-only",
          path: branchOnlyPath,
          owner: "Kitty",
          purpose: "Removed worktree fixture",
          disposition: "pr",
          createdAt: "2026-07-20T12:00:00Z",
        },
      },
    },
  };
  writeFileSync(
    path.join(fixtureRoot, "tasks-oid-only.json"),
    JSON.stringify([
      branchOnlyMetadataTask,
      {
        id: "cave-oid-owner",
        status: "open",
        title: "Investigate captured commit",
        description: "",
        notes: "",
        external_ref: `commit:${branchOnlyHead}`,
      },
    ]),
  );
  writeFileSync(
    path.join(fixtureRoot, "tasks-short-oid.json"),
    JSON.stringify([
      branchOnlyMetadataTask,
      {
        id: "cave-short-oid",
        status: "open",
        title: "Investigate abbreviated commit",
        description: "",
        notes: branchOnlyHead.slice(0, 12),
        external_ref: null,
      },
    ]),
  );
  writeFileSync(
    path.join(fixtureRoot, "tasks-nul-metadata-path.json"),
    JSON.stringify([
      {
        id: "cave-old",
        status: "closed",
        title: "Impossible metadata path",
        metadata: {
          coven: {
            worktree: {
              branch: "feat/old",
              path: `${old}\0suffix`,
              owner: "Kitty",
              purpose: "Reject impossible fixture path",
              disposition: "pr",
              createdAt: "2026-07-20T12:00:00Z",
            },
          },
        },
      },
    ]),
  );
  writeFileSync(
    path.join(fixtureRoot, "tasks-nul-exception-path.json"),
    JSON.stringify([
      {
        id: "cave-old",
        status: "closed",
        title: "Impossible exception path",
        metadata: {
          coven: {
            worktree: {
              branch: "feat/old",
              path: old,
              owner: "Kitty",
              purpose: "Reject impossible exception path",
              disposition: "pr",
              createdAt: "2026-07-20T12:00:00Z",
              exception: {
                owner: "Kitty",
                reason: "Impossible path fixture",
                expiresAt: "2026-08-11T00:00:00Z",
                additionalPaths: [`${old}\0suffix`],
              },
            },
          },
        },
      },
    ]),
  );

  executable(
    path.join(gitBin, "git"),
    `#!/bin/sh
DEFAULT_OID=${JSON.stringify(defaultHead)}
STALE_OID=${JSON.stringify("a".repeat(defaultHead.length))}
OTHER_OID=${JSON.stringify("b".repeat(defaultHead.length))}
MARKER_PREFIX=${JSON.stringify(path.join(fixtureRoot, "invalid-default-merge-base-"))}

if [ "\${LIFECYCLE_REQUIRE_SAFE_GIT:-0}" = "1" ]; then
  case " $* " in
    *" --no-optional-locks --no-replace-objects -C "*) ;;
    *)
      printf '%s\n' 'inventory git omitted read-only global options' >&2
      exit 92
      ;;
  esac
  for VARIABLE in GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE Git_Index_File GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_OPTIONAL_LOCKS GIT_REPLACE_REF_BASE GIT_NO_REPLACE_OBJECTS GIT_GRAFT_FILE GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GIT_CONFIG_PARAMETERS GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM; do
    eval "VALUE_SET=\\\${$VARIABLE+x}"
    if [ -n "$VALUE_SET" ]; then
      printf 'unsafe git environment retained: %s\n' "$VARIABLE" >&2
      exit 93
    fi
  done
  if [ -n "\${LIFECYCLE_EXPECT_GIT_SSH_COMMAND:-}" ] &&
     [ "\${GIT_SSH_COMMAND:-}" != "$LIFECYCLE_EXPECT_GIT_SSH_COMMAND" ]; then
    printf '%s\n' 'git authentication environment was stripped' >&2
    exit 94
  fi
  case " $* " in
    *" status "*)
      for REQUIRED in "-c status.relativePaths=false" "-c core.fileMode=true" "-c core.fsmonitor=false" "-c core.untrackedCache=false" "-c core.ignoreStat=false" "--porcelain=v2" "-z" "--untracked-files=all" "--ignored=matching" "--ignore-submodules=none" "--no-renames"; do
        case " $* " in
          *" $REQUIRED "*) ;;
          *)
            printf '%s\n' 'git status omitted configuration-independent safety flags' >&2
            exit 95
            ;;
        esac
      done
      ;;
  esac
fi

case " $* " in
  *" worktree list --porcelain -z "*)
    if [ "\${LIFECYCLE_DUPLICATE_REGISTERED_REF:-0}" = "1" ]; then
      cat ${JSON.stringify(duplicateWorktreeInventory)}
      exit 0
    fi
    ;;
esac

case " $* " in
  *" ls-remote --symref origin HEAD "*)
    if [ "\${LIFECYCLE_MALFORMED_DEFAULT:-0}" = "1" ]; then
      printf 'ref: refs/heads/main\\tHEAD\\nref: refs/heads/trunk\\tHEAD\\n%s\\tHEAD\\n' "$DEFAULT_OID"
      exit 0
    elif [ "\${LIFECYCLE_STALE_DEFAULT:-0}" = "1" ]; then
      printf 'ref: refs/heads/main\\tHEAD\\n%s\\tHEAD\\n' "$STALE_OID"
      exit 0
    elif [ "\${LIFECYCLE_MISMATCHED_DEFAULT_TARGET:-0}" = "1" ]; then
      printf 'ref: refs/heads/main\\tHEAD\\n%s\\tHEAD\\n' "$DEFAULT_OID"
      exit 0
    elif [ "\${LIFECYCLE_DEFAULT_TRUNK:-0}" = "1" ]; then
      printf 'ref: refs/heads/trunk\\tHEAD\\n%s\\tHEAD\\n' "$DEFAULT_OID"
      exit 0
    fi
    ;;
esac

case " $* " in
  *" ls-remote --exit-code origin refs/heads/main "*|*" ls-remote --exit-code --heads origin refs/heads/main "*)
    if [ -n "\${LIFECYCLE_MALFORMED_LIVE_MAIN_CASE:-}" ]; then
      case "\${LIFECYCLE_MALFORMED_LIVE_MAIN_CASE}" in
        malformed)
          printf '%s\\n' 'not-a-ls-remote-record'
          exit 0
          ;;
        wrong-ref)
          printf '%s\\trefs/heads/not-main\\n' "$DEFAULT_OID"
          exit 0
          ;;
        multi-record)
          printf '%s\\trefs/heads/main\\n%s\\trefs/heads/other\\n' "$DEFAULT_OID" "$OTHER_OID"
          exit 0
          ;;
        *)
          printf '%s\\n' 'unknown LIFECYCLE_MALFORMED_LIVE_MAIN_CASE' >&2
          exit 95
          ;;
      esac
    elif [ "\${LIFECYCLE_STALE_DEFAULT:-0}" = "1" ]; then
      printf '%s\\trefs/heads/main\\n' "$STALE_OID"
      exit 0
    elif [ "\${LIFECYCLE_MISMATCHED_DEFAULT_TARGET:-0}" = "1" ]; then
      printf '%s\\trefs/heads/main\\n' "$OTHER_OID"
      exit 0
    fi
    ;;
  *" ls-remote --exit-code origin refs/heads/trunk "*|*" ls-remote --exit-code --heads origin refs/heads/trunk "*)
    if [ "\${LIFECYCLE_DEFAULT_TRUNK:-0}" = "1" ]; then
      printf '%s\\trefs/heads/trunk\\n' "$DEFAULT_OID"
      exit 0
    fi
    ;;
esac

if [ "\${LIFECYCLE_MISSING_DEFAULT_TRACKING:-0}" = "1" ]; then
  case " $* " in
    *" rev-parse --verify refs/remotes/origin/main^{commit} "*)
      printf '%s\\n' 'missing default tracking ref' >&2
      exit 1
      ;;
  esac
fi

if [ "\${LIFECYCLE_MALFORMED_DEFAULT_TRACKING:-0}" = "1" ]; then
  case " $* " in
    *" rev-parse --verify refs/remotes/origin/main^{commit} "*)
      printf '%s\\n' 'refs/remotes/origin/main'
      exit 0
      ;;
  esac
fi

if [ "\${LIFECYCLE_DEFAULT_TRACKING_MUTATION:-0}" = "1" ]; then
  case " $* " in
    *" merge-base --is-ancestor "*)
      PATH=\${PATH#${gitBin}:}
      export PATH
      git -C ${JSON.stringify(repo)} update-ref refs/remotes/origin/main ${JSON.stringify(oldHead)}
      git "$@"
      STATUS=$?
      git -C ${JSON.stringify(repo)} update-ref refs/remotes/origin/main "$DEFAULT_OID"
      exit "$STATUS"
      ;;
  esac
fi

case "\${LIFECYCLE_STALE_DEFAULT:-0}\${LIFECYCLE_MALFORMED_DEFAULT:-0}\${LIFECYCLE_MISSING_DEFAULT_TRACKING:-0}\${LIFECYCLE_MISMATCHED_DEFAULT_TARGET:-0}\${LIFECYCLE_MALFORMED_DEFAULT_TRACKING:-0}\${LIFECYCLE_MALFORMED_LIVE_MAIN_CASE:-}" in
  *1*)
    case " $* " in
      *" merge-base --is-ancestor "*)
        printf '%s\\n' "$*" > "$MARKER_PREFIX\${LIFECYCLE_TEST_INVOCATION:-unknown}"
        ;;
    esac
    ;;
  *[!0]*)
    case " $* " in
      *" merge-base --is-ancestor "*)
        printf '%s\\n' "$*" > "$MARKER_PREFIX\${LIFECYCLE_TEST_INVOCATION:-unknown}"
        ;;
    esac
    ;;
esac

if [ "\${LIFECYCLE_DEFAULT_TRUNK:-0}" = "1" ]; then
  case " $* " in
    *" merge-base --is-ancestor "*" refs/remotes/origin/main "*)
      printf '%s\\n' 'hard-coded origin/main ancestry probe' >&2
      exit 91
      ;;
  esac
fi

PATH=\${PATH#${gitBin}:}
export PATH
exec git "$@"
`,
  );

  executable(
    path.join(bin, "gh"),
    `#!/bin/sh
fail() {
  printf '%s\\n' "$1" >&2
  exit 2
}
require_query() {
  case "$QUERY" in
    *"$1"*) ;;
    *) fail "GraphQL query missing required field: $1" ;;
  esac
}

if [ "$1" = "api" ] &&
   [ "$2" = "--hostname" ] &&
   [ "$3" = "github.com" ] &&
   [ "$4" = "graphql" ] &&
   [ "$5" = "--paginate" ] &&
   [ "$6" = "--slurp" ]; then
  shift 6
  OWNER=
  NAME=
  OID_ARG=
  SEARCH_QUERY=
  QUERY=
  FIELD_COUNT=0
  QUERY_COUNT=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -F)
        [ "$#" -ge 2 ] || fail "GraphQL -F is missing a value"
        FIELD_COUNT=$((FIELD_COUNT + 1))
        case "$2" in
          owner=*) OWNER=\${2#owner=} ;;
          name=*) NAME=\${2#name=} ;;
          oid=*) OID_ARG=\${2#oid=} ;;
          searchQuery=*) SEARCH_QUERY=\${2#searchQuery=} ;;
          *) fail "unexpected GraphQL variable: $2" ;;
        esac
        shift 2
        ;;
      -f)
        [ "$#" -ge 2 ] || fail "GraphQL -f is missing a value"
        QUERY_COUNT=$((QUERY_COUNT + 1))
        case "$2" in
          query=*) QUERY=\${2#query=} ;;
          *) fail "unexpected GraphQL field: $2" ;;
        esac
        shift 2
        ;;
      *) fail "unexpected GraphQL argument: $1" ;;
    esac
  done
  [ "$QUERY_COUNT" -eq 1 ] || fail "GraphQL requires exactly one query"

  if [ -n "$OID_ARG" ]; then
    [ "$FIELD_COUNT" -eq 3 ] || fail "associated PR query has the wrong variable count"
    [ "$OWNER" = "OpenCoven" ] || fail "associated PR query has the wrong owner"
    [ "$NAME" = "coven-cave" ] || fail "associated PR query has the wrong repository"
    [ -z "$SEARCH_QUERY" ] || fail "associated PR query included search variables"
    require_query 'repository(owner: $owner, name: $name)'
    require_query 'object(oid: $oid)'
    require_query 'associatedPullRequests(first: 100, after: $endCursor)'
    for field in totalCount number url state isDraft mergedAt headRefName headRefOid headRepository baseRefName baseRepository pageInfo hasNextPage endCursor; do
      require_query "$field"
    done
    ASSOCIATION_MARKER=${JSON.stringify(
      path.join(fixtureRoot, "associated-query-"),
    )}"\${LIFECYCLE_TEST_INVOCATION:-unknown}-$OID_ARG"
    [ ! -e "$ASSOCIATION_MARKER" ] ||
      fail "associated PR query repeated for duplicate OID $OID_ARG"
    : > "$ASSOCIATION_MARKER"

    REPOSITORY="OpenCoven/coven-cave"
    if [ "\${LIFECYCLE_BAD_CANONICAL_REPO:-0}" = "1" ] &&
       [ "$OID_ARG" = "${oldHead}" ]; then
      REPOSITORY="Wrong/repository"
    fi
    BASE_REF=main
    if [ "\${LIFECYCLE_DEFAULT_TRUNK:-0}" = "1" ]; then BASE_REF=trunk; fi

    if [ "$OID_ARG" = "${oldHead}" ]; then
      if [ "\${LIFECYCLE_INCOMPLETE_ASSOCIATED_PAGINATION:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"assoc-1"}}}}}}]'
      elif [ "\${LIFECYCLE_MALFORMED_ASSOCIATED_PAGINATION:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"repeat"}}}}}},{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"repeat"}}}}}},{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}]'
      elif [ "\${LIFECYCLE_DUPLICATE_ASSOCIATED_NODE:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":2,"nodes":[{"number":77,"url":"https://github.com/OpenCoven/coven-cave/pull/77","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":true,"endCursor":"assoc-duplicate"}}}}}},{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":2,"nodes":[{"number":77,"url":"https://github.com/OpenCoven/coven-cave/pull/77","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}]'
      elif [ "\${LIFECYCLE_OMITTED_ASSOCIATED_NODE:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":2,"nodes":[{"number":77,"url":"https://github.com/OpenCoven/coven-cave/pull/77","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}]'
      elif [ "\${LIFECYCLE_UNSTABLE_ASSOCIATED_TOTAL:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":2,"nodes":[{"number":77,"url":"https://github.com/OpenCoven/coven-cave/pull/77","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":true,"endCursor":"assoc-total"}}}}}},{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":78,"url":"https://github.com/OpenCoven/coven-cave/pull/78","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"assoc-total-end"}}}}}}]'
      elif [ "\${LIFECYCLE_MISMATCHED_ASSOCIATED_OID:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":42,"url":"https://github.com/OpenCoven/coven-cave/pull/42","state":"MERGED","isDraft":false,"mergedAt":"2026-07-21T12:00:00Z","headRefName":"feat/old","headRefOid":"${"c".repeat(oldHead.length)}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"bad-oid"}}}}}}]'
      elif [ "\${LIFECYCLE_OUTBOUND_OPEN:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":2,"nodes":[{"number":142,"url":"https://github.com/ArchiveOrg/archive/pull/142","state":"CLOSED","isDraft":false,"mergedAt":null,"headRefName":"archived-name","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"ForkOwner/fork"},"baseRefName":"archive","baseRepository":{"nameWithOwner":"ArchiveOrg/archive"}}],"pageInfo":{"hasNextPage":true,"endCursor":"assoc-1"}}}}}},{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":2,"nodes":[{"number":99,"url":"https://github.com/OtherOrg/other-repo/pull/99","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"different-head-name","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"ForkOwner/fork"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OtherOrg/other-repo"}}],"pageInfo":{"hasNextPage":false,"endCursor":"assoc-2"}}}}}}]'
      elif [ "\${LIFECYCLE_EXACT_MERGED_DIFFERENT_HEAD:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":98,"url":"https://github.com/OpenCoven/coven-cave/pull/98","state":"MERGED","isDraft":false,"mergedAt":"2026-08-10T21:30:00Z","headRefName":"different-merged-head","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"ForkOwner/fork"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"merged-different"}}}}}}]'
      elif [ "\${LIFECYCLE_CLOSED_UNMERGED:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":97,"url":"https://github.com/OpenCoven/coven-cave/pull/97","state":"CLOSED","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"closed"}}}}}}]'
      elif [ "\${LIFECYCLE_CLOSED_DRAFT:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":96,"url":"https://github.com/OpenCoven/coven-cave/pull/96","state":"CLOSED","isDraft":true,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"draft"}}}}}}]'
      elif [ "\${LIFECYCLE_DUPLICATE_PR:-0}" = "1" ]; then
        printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":77,"url":"https://github.com/OpenCoven/coven-cave/pull/77","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"duplicate"}}}}}}]'
      else
        if [ "\${LIFECYCLE_NON_MAIN_MERGE:-0}" = "1" ]; then BASE_REF=staging; fi
        printf '[{"data":{"repository":{"nameWithOwner":"%s","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":42,"url":"https://github.com/OpenCoven/coven-cave/pull/42","state":"MERGED","isDraft":false,"mergedAt":"2026-07-21T12:00:00Z","headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"%s","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"old"}}}}}}]\\n' "$REPOSITORY" "$BASE_REF"
      fi
    elif [ "$OID_ARG" = "${recentMergeHead}" ]; then
      printf '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":43,"url":"https://github.com/OpenCoven/coven-cave/pull/43","state":"MERGED","isDraft":false,"mergedAt":"2026-08-10T21:00:00Z","headRefName":"feat/recent-merge","headRefOid":"${recentMergeHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"%s","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"recent"}}}}}}]\\n' "$BASE_REF"
    elif [ "$OID_ARG" = "${recentReflogHead}" ]; then
      printf '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":44,"url":"https://github.com/OpenCoven/coven-cave/pull/44","state":"MERGED","isDraft":false,"mergedAt":"2026-07-21T12:00:00Z","headRefName":"feat/recent-reflog","headRefOid":"${recentReflogHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"%s","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"reflog"}}}}}}]\\n' "$BASE_REF"
    else
      printf '[{"data":{"repository":{"nameWithOwner":"%s","object":{"associatedPullRequests":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}]\\n' "$REPOSITORY"
    fi
    exit 0
  fi

  if [ -n "$SEARCH_QUERY" ]; then
    [ "$FIELD_COUNT" -eq 1 ] || fail "exact-head search has the wrong variable count"
    [ -z "$OWNER$NAME$OID_ARG" ] || fail "exact-head search included repository variables"
    case "$SEARCH_QUERY" in
      is:pr\\ head:*:*) fail "exact-head search used an owner-prefixed head qualifier" ;;
      is:pr\\ head:feat/old|is:pr\\ head:feat/recent-merge|is:pr\\ head:feat/recent-reflog|is:pr\\ head:feat/live|is:pr\\ head:feat/cave-link1-linked|is:pr\\ head:feat/spaced|is:pr\\ head:feat/branch-only) ;;
      *) fail "exact-head search used an unexpected query: $SEARCH_QUERY" ;;
    esac
    require_query 'search(query: $searchQuery, type: ISSUE, first: 100, after: $endCursor)'
    for field in issueCount number url state isDraft mergedAt headRefName headRefOid headRepository baseRefName baseRepository pageInfo hasNextPage endCursor; do
      require_query "$field"
    done
    if [ "$SEARCH_QUERY" = "is:pr head:feat/old" ] &&
       [ "\${LIFECYCLE_PR_CAP:-0}" = "1" ]; then
      printf '%s\\n' '[{"data":{"search":{"issueCount":1001,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}]'
    elif [ "$SEARCH_QUERY" = "is:pr head:feat/old" ] &&
         [ "\${LIFECYCLE_MALFORMED_HEAD_SEARCH:-0}" = "1" ]; then
      printf '%s\\n' '[{"data":{"search":{"issueCount":1,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}]'
    elif [ "$SEARCH_QUERY" = "is:pr head:feat/old" ] &&
         [ "\${LIFECYCLE_DUPLICATE_SEARCH_NODE:-0}" = "1" ]; then
      printf '%s\\n' '[{"data":{"search":{"issueCount":2,"nodes":[{"number":77,"url":"https://github.com/OpenCoven/coven-cave/pull/77","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":true,"endCursor":"search-duplicate"}}}},{"data":{"search":{"issueCount":2,"nodes":[{"number":77,"url":"https://github.com/OpenCoven/coven-cave/pull/77","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}]'
    elif [ "$SEARCH_QUERY" = "is:pr head:feat/old" ] &&
         [ "\${LIFECYCLE_HEAD_ONLY_DRAFT:-0}" = "1" ]; then
      printf '%s\\n' '[{"data":{"search":{"issueCount":1,"nodes":[{"number":78,"url":"https://github.com/OpenCoven/coven-cave/pull/78","state":"OPEN","isDraft":true,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}]'
    elif [ "$SEARCH_QUERY" = "is:pr head:feat/old" ] &&
         { [ "\${LIFECYCLE_SAME_NAME_OPEN_SEARCH:-0}" = "1" ] ||
           [ "\${LIFECYCLE_DUPLICATE_PR:-0}" = "1" ]; }; then
      printf '%s\\n' '[{"data":{"search":{"issueCount":1,"nodes":[{"number":77,"url":"https://github.com/OpenCoven/coven-cave/pull/77","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"feat/old","headRefOid":"${oldHead}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":"search-old"}}}}]'
    else
      printf '%s\\n' '[{"data":{"search":{"issueCount":0,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}]'
    fi
    exit 0
  fi
  fail "GraphQL request did not select associated PRs or exact-head search"
fi

case "$*" in
  *"/actions/runs"*)
    WORKFLOW_COUNT_FILE=${JSON.stringify(
      path.join(fixtureRoot, "workflow-count-"),
    )}"\${LIFECYCLE_TEST_INVOCATION:-unknown}"
    WORKFLOW_COUNT=0
    if [ -e "$WORKFLOW_COUNT_FILE" ]; then
      WORKFLOW_COUNT=$(cat "$WORKFLOW_COUNT_FILE")
    fi
    WORKFLOW_COUNT=$((WORKFLOW_COUNT + 1))
    printf '%s' "$WORKFLOW_COUNT" > "$WORKFLOW_COUNT_FILE"
    WORKFLOW_STATUS=
    case " $* " in
      *" status=queued "*) WORKFLOW_STATUS=queued ;;
      *" status=in_progress "*) WORKFLOW_STATUS=in_progress ;;
      *" status=requested "*) WORKFLOW_STATUS=requested ;;
      *" status=waiting "*) WORKFLOW_STATUS=waiting ;;
      *" status=pending "*) WORKFLOW_STATUS=pending ;;
    esac
    [ -n "$WORKFLOW_STATUS" ] || fail "workflow inventory omitted an exact status"
    if [ "\${LIFECYCLE_BAD_WORKFLOW:-0}" = "1" ]; then
      printf '%s\n' '[{"total_count":1,"workflow_runs":[{"status":"queued","head_branch":"feat/live","head_sha":"${workflowHead}","html_url":"https://example.test/run/missing-id"}]}]'
    elif [ "\${LIFECYCLE_PARTIAL_WORKFLOW:-0}" = "1" ]; then
      printf '%s\n' '[{"total_count":2,"workflow_runs":[{"id":9001,"status":"'"$WORKFLOW_STATUS"'","head_branch":"feat/old","head_sha":"${oldHead}","html_url":"https://example.test/run"}]}]'
    elif [ "\${LIFECYCLE_CAPPED_WORKFLOW:-0}" = "1" ]; then
      printf '%s\n' '[{"total_count":1000,"workflow_runs":[]}]'
    elif [ "\${LIFECYCLE_DUPLICATE_WORKFLOW_ID:-0}" = "1" ] &&
         [ "$WORKFLOW_STATUS" = "queued" ]; then
      printf '%s\n' '[{"total_count":2,"workflow_runs":[{"id":9001,"status":"queued","head_branch":"feat/old","head_sha":"${oldHead}","html_url":"https://example.test/run/9001"},{"id":9001,"status":"queued","head_branch":"feat/old","head_sha":"${oldHead}","html_url":"https://example.test/run/9001"}]}]'
    elif [ "\${LIFECYCLE_MALFORMED_WORKFLOW_ID:-0}" = "1" ] &&
         [ "$WORKFLOW_STATUS" = "queued" ]; then
      printf '%s\n' '[{"total_count":1,"workflow_runs":[{"id":0,"status":"queued","head_branch":"feat/old","head_sha":"${oldHead}","html_url":"https://example.test/run/invalid"}]}]'
    elif [ "\${LIFECYCLE_MISMATCHED_WORKFLOW_STATUS:-0}" = "1" ] &&
         [ "$WORKFLOW_STATUS" = "queued" ]; then
      printf '%s\n' '[{"total_count":1,"workflow_runs":[{"id":9002,"status":"in_progress","head_branch":"feat/old","head_sha":"${oldHead}","html_url":"https://example.test/run/9002"}]}]'
    elif [ "\${LIFECYCLE_CONFLICTING_WORKFLOW_STATUS:-0}" = "1" ] &&
         { [ "$WORKFLOW_STATUS" = "queued" ] || [ "$WORKFLOW_STATUS" = "in_progress" ]; }; then
      printf '%s\n' '[{"total_count":1,"workflow_runs":[{"id":9003,"status":"'"$WORKFLOW_STATUS"'","head_branch":"feat/old","head_sha":"${oldHead}","html_url":"https://example.test/run/9003"}]}]'
    elif [ "\${LIFECYCLE_UNSTABLE_WORKFLOW:-0}" = "1" ] &&
         [ "$WORKFLOW_STATUS" = "queued" ]; then
      WORKFLOW_MARKER=${JSON.stringify(
        path.join(fixtureRoot, "workflow-sweep-"),
      )}"\${LIFECYCLE_TEST_INVOCATION:-unknown}"
      if [ -e "$WORKFLOW_MARKER" ]; then
        printf '%s\n' '[{"total_count":1,"workflow_runs":[{"id":9004,"status":"queued","head_branch":"feat/old","head_sha":"${oldHead}","html_url":"https://example.test/run/9004"}]}]'
      else
        : > "$WORKFLOW_MARKER"
        printf '%s\n' '[{"total_count":0,"workflow_runs":[]}]'
      fi
    elif [ "$WORKFLOW_STATUS" = "queued" ]; then
      printf '%s\n' '[{"total_count":1,"workflow_runs":[{"id":1000,"status":"queued","head_branch":"feat/live","head_sha":"${workflowHead}","html_url":"https://example.test/run/1000"}]}]'
    else
      printf '%s\n' '[{"total_count":0,"workflow_runs":[]}]'
    fi
    ;;
  *)
    printf '%s\n' 'unexpected gh command' >&2
    exit 2
    ;;
esac
`,
  );
  executable(
    path.join(bin, "bd"),
    `#!/bin/sh
case " $* " in
  *" --all "*) ;;
  *)
    printf '%s\n' 'bd list must include --all' >&2
    exit 2
    ;;
esac
if [ "\${LIFECYCLE_DRIFT:-0}" = "1" ] && [ ! -e "${path.join(fixtureRoot, "drift-once")}" ]; then
  touch "${path.join(fixtureRoot, "drift-once")}"
  git -C "${repo}" branch feat/drift origin/main
fi
if [ "\${LIFECYCLE_GRAFT_DRIFT:-0}" = "1" ]; then
  printf '%s %s\n' ${JSON.stringify(defaultHead)} ${JSON.stringify(oldHead)} > ${JSON.stringify(path.join(repo, ".git", "info", "grafts"))}
fi
if [ "\${LIFECYCLE_REPLACEMENT_DRIFT:-0}" = "1" ]; then
  git -C "${repo}" update-ref ${JSON.stringify(`refs/replace/${defaultHead}`)} ${JSON.stringify(oldHead)}
fi
if [ "\${LIFECYCLE_OID_ONLY_TASK:-0}" = "1" ]; then
  cat ${JSON.stringify(path.join(fixtureRoot, "tasks-oid-only.json"))}
elif [ "\${LIFECYCLE_SHORT_OID_TASK:-0}" = "1" ]; then
  cat ${JSON.stringify(path.join(fixtureRoot, "tasks-short-oid.json"))}
elif [ "\${LIFECYCLE_NUL_METADATA_PATH:-0}" = "1" ]; then
  cat ${JSON.stringify(path.join(fixtureRoot, "tasks-nul-metadata-path.json"))}
elif [ "\${LIFECYCLE_NUL_EXCEPTION_PATH:-0}" = "1" ]; then
  cat ${JSON.stringify(path.join(fixtureRoot, "tasks-nul-exception-path.json"))}
elif [ "\${LIFECYCLE_BAD_TASKS:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-bad","status":"open","title":[]}]'
elif [ -n "\${LIFECYCLE_BAD_METADATA_DATE_CASE:-}" ]; then
  cat "${path.join(fixtureRoot, "metadata-")}\${LIFECYCLE_BAD_METADATA_DATE_CASE}.json"
elif [ "\${LIFECYCLE_MULTI_WORKTREE_METADATA:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-multi","status":"closed","title":"Multi-worktree fixture","metadata":{"unrelated":"preserved","coven":{"sibling":"preserved","worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Primary fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Shared split","expiresAt":"2026-08-11T00:00:00.1Z","additionalPaths":["${old}","${live}"]}},"worktrees":[{"branch":"feat/live","path":"${live}","owner":"Kitty","purpose":"Additional fixture","disposition":"active","createdAt":"2026-07-20T13:00:00Z","exception":{"owner":"Kitty","reason":"Shared split","expiresAt":"2026-08-11T00:00:00.1Z","additionalPaths":["${live}","${old}"]}}]}}}]'
elif [ "\${LIFECYCLE_MALFORMED_WORKTREES:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-multi","status":"closed","title":"Malformed array","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Primary fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"},"worktrees":{}}}}]'
elif [ "\${LIFECYCLE_DUPLICATE_WORKTREE_BRANCH:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-multi","status":"closed","title":"Duplicate branch","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Primary fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"},"worktrees":[{"branch":"feat/old","path":"${live}","owner":"Kitty","purpose":"Duplicate fixture","disposition":"active","createdAt":"2026-07-20T13:00:00Z"}]}}}]'
elif [ "\${LIFECYCLE_DUPLICATE_WORKTREE_PATH:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-multi","status":"closed","title":"Duplicate path","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Primary fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"},"worktrees":[{"branch":"feat/live","path":"${path.join(old, "..", "old")}","owner":"Kitty","purpose":"Duplicate fixture","disposition":"active","createdAt":"2026-07-20T13:00:00Z"}]}}}]'
elif [ "\${LIFECYCLE_UNUSABLE_ADDITIONAL_BRANCH:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-multi","status":"closed","title":"Unusable branch","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Primary fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"},"worktrees":[{"branch":"feat/bad..name","path":"${live}","owner":"Kitty","purpose":"Invalid fixture","disposition":"active","createdAt":"2026-07-20T13:00:00Z"}]}}}]'
elif [ "\${LIFECYCLE_EXCEPTION_BUDGETS:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${realpathSync(old)}/","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Active matched exception","expiresAt":"2026-08-11T00:00:00Z","additionalPaths":["${realpathSync(old)}/./"]}}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${path.join(repo, ".worktrees", "path-mismatch")}","owner":"Kitty","purpose":"Mismatched fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Expired path mismatch","expiresAt":"2026-08-10T21:00:00Z","additionalPaths":["${recentMerge}"]}}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Expired matched exception","expiresAt":"2026-08-10T21:00:00Z","additionalPaths":["${branchOnlyPath}"]}}}}},{"id":"cave-stale","status":"closed","title":"Stale metadata","metadata":{"coven":{"worktree":{"branch":"feat/stale","path":"${path.join(repo, ".worktrees", "stale")}","owner":"Kitty","purpose":"Stale fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Active stale exception","expiresAt":"2026-08-11T00:00:00Z","additionalPaths":["${path.join(repo, ".worktrees", "stale")}"]}}}}}]'
elif [ "\${LIFECYCLE_LINKED_TASK:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"CAVE-LINK1","status":"open","title":"Unrelated task","description":"","notes":""},{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}}]'
elif [ "\${LIFECYCLE_MISSING_BRANCH_METADATA:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}}]'
elif [ "\${LIFECYCLE_DUPLICATE_METADATA:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"First duplicate exception","expiresAt":"2026-08-11T00:00:00Z","additionalPaths":["${branchOnlyPath}"]}}}}},{"id":"cave-branch-only-copy","status":"closed","title":"Branch only duplicate","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Duplicate fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Second duplicate exception","expiresAt":"2026-08-11T00:00:00Z","additionalPaths":["${branchOnlyPath}"]}}}}}]'
elif [ "\${LIFECYCLE_OPEN_STRUCTURED_TASK:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"open","title":"Unrelated task","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}}]'
elif [ "\${LIFECYCLE_OPEN_CONFLICTING_STRUCTURED_PATH:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-other-owner","status":"open","title":"Other branch owner","metadata":{"coven":{"worktree":{"branch":"feat/other-owner","path":"${old}","owner":"Kitty","purpose":"Conflicting fixture","disposition":"active","createdAt":"2026-07-20T12:00:00Z"}}}}]'
elif [ "\${LIFECYCLE_CLOSED_CONFLICTING_STRUCTURED_PATH:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-other-owner","status":"closed","title":"Other branch owner","metadata":{"coven":{"worktree":{"branch":"feat/other-owner","path":"${old}","owner":"Kitty","purpose":"Conflicting fixture","disposition":"archive","createdAt":"2026-07-20T12:00:00Z","reason":"Closed conflict fixture","reviewAfter":"2026-08-11"}}}}]'
elif [ "\${LIFECYCLE_SIBLING_STRUCTURED_PATH:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-sibling","status":"open","title":"Open sibling path","metadata":{"coven":{"worktree":{"branch":"feat/sibling","path":"${old}-sibling","owner":"Kitty","purpose":"Sibling fixture","disposition":"active","createdAt":"2026-07-20T12:00:00Z"}}}}]'
elif [ "\${LIFECYCLE_NULL_EXCEPTION:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":null}}}}]'
elif [ "\${LIFECYCLE_SPACED_PATH:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-spaced","status":"open","title":"Spaced path","metadata":{"coven":{"worktree":{"branch":"feat/spaced","path":${JSON.stringify(spaced)},"owner":"Kitty","purpose":"Exact path fixture","disposition":"active","createdAt":"2026-07-20T12:00:00Z"}}}}]'
else
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}}]'
fi
`,
  );
  executable(
    path.join(bin, "coven"),
    `#!/bin/sh
if [ "$1" = "sessions" ] && [ "$2" = "--json" ]; then
  if [ "\${LIFECYCLE_WORKTREE_DRIFT:-0}" = "1" ] && [ ! -e "${path.join(fixtureRoot, "worktree-drift-once")}" ]; then
    touch "${path.join(fixtureRoot, "worktree-drift-once")}"
    git -C "${repo}" worktree add -q --detach "${registeredDrift}" origin/main
  fi
  if [ "\${LIFECYCLE_SESSIONS_UNAVAILABLE:-0}" = "1" ]; then
    printf '%s\n' 'Coven sessions unavailable' >&2
    exit 23
  elif [ "\${LIFECYCLE_BAD_SESSIONS:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":[],"project_root":"${old}","status":"running"}]}'
  elif [ "\${LIFECYCLE_NUL_SESSION_ROOT:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-impossible","project_root":"${old}\\u0000suffix","status":"running"}]}'
  elif [ "\${LIFECYCLE_KILLED_SESSION:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-fixture","project_root":"${old}","status":"killed"}]}'
  elif [ "\${LIFECYCLE_STOPPED_SESSION:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-fixture","project_root":"${old}","status":"stopped"}]}'
  elif [ "\${LIFECYCLE_ACTIVE_SESSION:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-fixture","project_root":"${old}","status":"created"}]}'
  elif [ "\${LIFECYCLE_DESCENDANT_SESSION:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-descendant","project_root":"${path.join(old, "subdir")}","status":"running"}]}'
  elif [ "\${LIFECYCLE_LINKED_DESCENDANT_SESSION:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-linked","project_root":"${path.join(linked, "subdir")}","status":"running"}]}'
  elif [ "\${LIFECYCLE_SPACED_PATH:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-spaced","project_root":${JSON.stringify(spaced)},"status":"running"}]}'
  elif [ "\${LIFECYCLE_SIBLING_PREFIX_SESSION:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-sibling","project_root":"${old}-sibling","status":"running"}]}'
  else
    printf '%s\n' '{"sessions":[]}'
  fi
elif [ "\${LIFECYCLE_BAD_CLAIMS:-0}" = "1" ]; then
  printf '%s\n' '{"claims":[{}]}'
elif [ "\${LIFECYCLE_UNKNOWN_CLAIM_STATE:-0}" = "1" ]; then
  printf '%s\n' '{"claims":[{"branch":"feat/old","agent_id":"fixture","state":"actve"}]}'
else
  printf '%s\n' '{"claims":[]}'
fi
`,
  );
  executable(
    path.join(bin, "lsof"),
    `#!/bin/sh
if [ "\${LIFECYCLE_LSOF_FAIL:-0}" = "1" ]; then
  exit 1
fi
if [ "\${LIFECYCLE_LSOF_PARTIAL:-0}" = "1" ]; then
  printf 'p999\ncnode\nfcwd\nn${old}\np1000\ncnode\nfcwd\n'
  exit 0
fi
if [ "\${LIFECYCLE_LSOF_MALFORMED:-0}" = "1" ]; then
  printf 'p999junk\ncnode\nfcwd\nnrelative/path\n'
  exit 0
fi
if [ "\${LIFECYCLE_LSOF_WARN:-0}" = "1" ]; then
  printf 'p999\ncnode\nfcwd\nn${old}\n'
  printf '%s\n' 'some processes could not be inspected' >&2
  exit 0
fi
if [ "\${LIFECYCLE_SPACED_PATH:-0}" = "1" ]; then
  printf 'p1001\ncnode\nfcwd\nn%s\n' ${JSON.stringify(spaced)}
  exit 0
fi
printf 'p1\ncinit\nfcwd\nn/\n'
exit 0
`,
  );

  const beforeWorktrees = git(["worktree", "list", "--porcelain"], repo);
  const beforeBranches = git(
    ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"],
    repo,
  );
  const beforeRemoteRefs = git(
    ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"],
    repo,
  );
  let patrolInvocation = 0;
  let lastPatrolInvocation = "";
  const patrol = (extraArgs = [], extraEnv = {}) => {
    lastPatrolInvocation = String(++patrolInvocation);
    const needsGitFixture = [
      "LIFECYCLE_DEFAULT_TRUNK",
      "LIFECYCLE_STALE_DEFAULT",
      "LIFECYCLE_MALFORMED_DEFAULT",
      "LIFECYCLE_MISSING_DEFAULT_TRACKING",
      "LIFECYCLE_MISMATCHED_DEFAULT_TARGET",
      "LIFECYCLE_MALFORMED_DEFAULT_TRACKING",
      "LIFECYCLE_MALFORMED_LIVE_MAIN_CASE",
      "LIFECYCLE_DEFAULT_TRACKING_MUTATION",
      "LIFECYCLE_DUPLICATE_REGISTERED_REF",
      "LIFECYCLE_REQUIRE_SAFE_GIT",
    ].some(
      (name) =>
        extraEnv[name] === "1" ||
        (name === "LIFECYCLE_MALFORMED_LIVE_MAIN_CASE" &&
          typeof extraEnv[name] === "string"),
    );
    return run(
      process.execPath,
      [
        "--experimental-strip-types",
        script,
        "--repo",
        "OpenCoven/coven-cave",
        "--root",
        repo,
        "--now",
        "2026-08-10T22:00:00Z",
        ...extraArgs,
      ],
      repo,
      {
        env: {
          ...process.env,
          PATH: `${needsGitFixture ? `${gitBin}${path.delimiter}` : ""}${bin}${path.delimiter}${process.env.PATH}`,
          LIFECYCLE_TEST_INVOCATION: lastPatrolInvocation,
          ...extraEnv,
        },
      },
    );
  };
  const stdout = patrol(["--json"]);
  const report = JSON.parse(stdout);

  const byBranch = new Map(report.items.map((item) => [item.branch, item]));
  assert.equal(
    readFileSync(path.join(fixtureRoot, "workflow-count-1"), "utf8"),
    "10",
    "normal patrol captures two complete active workflow snapshots",
  );
  assert.equal(byBranch.get("main").lane, "protected");
  assert.equal(byBranch.get("feat/live").lane, "active");
  assert.deepEqual(
    byBranch.get("feat/live").activeWorkflowUrls,
    ["https://example.test/run/1000"],
    "identical workflow snapshots retain one canonical run",
  );
  assert.deepEqual(
    byBranch.get("feat/live").changes.map((line) => line.replace(/^\?\s+/, "")),
    ["uncommitted.txt"],
    "the report retains dirty paths instead of reducing them to a count",
  );
  assert.equal(
    byBranch.get("feat/old").lane,
    "retire-after-gate",
    JSON.stringify({
      probeErrors: byBranch.get("feat/old").probeErrors,
      metadataErrors: byBranch.get("feat/old").metadataErrors,
      reasons: byBranch.get("feat/old").reasons,
      mergedPr: byBranch.get("feat/old").mergedPr,
    }),
  );
  assert.equal(byBranch.get("feat/old").mergedPr.number, 42);
  assert.match(
    byBranch.get("feat/old").reasons.join("\n"),
    /maintenance gate/,
    "retirement remains gated rather than automatic",
  );
  assert.equal(
    byBranch.get("feat/recent-merge").lane,
    "cooldown",
    "a recent merge keeps an old commit inside the cooldown",
  );
  assert.equal(
    byBranch.get("feat/recent-reflog").lane,
    "cooldown",
    "recent worktree-local HEAD activity keeps an old landed commit inside the cooldown",
  );
  const detachedItem = report.items.find(
    (item) => item.kind === "worktree" && item.branch === null,
  );
  assert.equal(detachedItem.kind, "worktree");
  assert.equal(detachedItem.branch, null);
  assert.equal(detachedItem.ref, null);
  assert.equal(detachedItem.lane, "recovery", "detached worktrees remain recovery units");
  const branchOnly = byBranch.get("feat/branch-only");
  assert.equal(branchOnly.kind, "branch-only");
  assert.equal(branchOnly.path, null);
  assert.equal(branchOnly.ref, "refs/heads/feat/branch-only");
  assert.equal(branchOnly.head, branchOnlyHead);
  assert.deepEqual(branchOnly.remoteRef, {
    ref: "refs/heads/feat/branch-only",
    oid: branchOnlyHead,
  });
  assert.deepEqual(
    branchOnly.metadata,
    {
      beadId: "cave-branch-only",
      owner: "Kitty",
      purpose: "Removed worktree fixture",
      disposition: "pr",
      createdAt: "2026-07-20T12:00:00Z",
    },
    "exact structured metadata survives patrol JSON serialization",
  );
  assert.equal(branchOnly.lane, "retire-after-gate");
  assert.deepEqual(report.budgets, {
    worktrees: { count: 8, warning: 12, exceeded: false },
    branches: { count: 8, warning: 30, exceeded: false },
    exceptions: { active: 0, expired: 0 },
  }, "the exact budget object survives patrol JSON serialization");
  const nullExceptionReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_NULL_EXCEPTION: "1" }),
  );
  const nullExceptionBranch = nullExceptionReport.items.find(
    (item) => item.branch === "feat/branch-only",
  );
  assert.deepEqual(
    nullExceptionBranch.metadataErrors,
    [],
    "an explicit null exception remains valid structured metadata",
  );
  assert.equal(
    nullExceptionBranch.lane,
    branchOnly.lane,
    "an explicit null exception reaches the same lane as an omitted exception",
  );
  assert.deepEqual(
    nullExceptionReport.budgets.exceptions,
    { active: 0, expired: 0 },
    "an explicit null exception does not count toward exception budgets",
  );
  const exceptionBudgetReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_EXCEPTION_BUDGETS: "1" }),
  );
  assert.deepEqual(exceptionBudgetReport.budgets.exceptions, { active: 1, expired: 1 });
  const trailingSlashExceptionItem = exceptionBudgetReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.deepEqual(
    trailingSlashExceptionItem.metadataErrors,
    [],
    "trailing-slash metadata remains valid for its registered worktree",
  );
  assert.equal(
    trailingSlashExceptionItem.lane,
    "active",
    "a trailing-slash metadata path keeps its valid exception active",
  );
  assert.match(
    exceptionBudgetReport.items
      .find((item) => item.branch === "feat/recent-merge")
      .metadataErrors.join("\n"),
    /path does not match/i,
    "genuinely different path metadata remains invalid and does not affect exception budgets",
  );
  const multiMetadataReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_MULTI_WORKTREE_METADATA: "1" }),
  );
  const multiOld = multiMetadataReport.items.find((item) => item.branch === "feat/old");
  const multiLive = multiMetadataReport.items.find((item) => item.branch === "feat/live");
  assert.equal(multiOld.metadata.beadId, "cave-multi");
  assert.equal(multiOld.metadata.purpose, "Primary fixture");
  assert.equal(multiLive.metadata.beadId, "cave-multi");
  assert.equal(multiLive.metadata.purpose, "Additional fixture");
  assert.equal(multiLive.metadata.disposition, "active");
  assert.notEqual(multiLive.lane, "uncertain");
  assert.deepEqual(
    multiMetadataReport.budgets.exceptions,
    { active: 1, expired: 0 },
    "semantically shared exceptions across flattened records count once",
  );
  for (const [environment, expectedError] of [
    ["LIFECYCLE_MALFORMED_WORKTREES", /worktrees must be an array/i],
    ["LIFECYCLE_DUPLICATE_WORKTREE_BRANCH", /duplicate.*(?:branch|records)/i],
    ["LIFECYCLE_DUPLICATE_WORKTREE_PATH", /conflicting structured path ownership/i],
    ["LIFECYCLE_UNUSABLE_ADDITIONAL_BRANCH", /branch/i],
  ]) {
    const malformedMultiReport = JSON.parse(
      patrol(["--json"], { [environment]: "1" }),
    );
    const malformedMultiOld = malformedMultiReport.items.find(
      (item) => item.branch === "feat/old",
    );
    assert.equal(malformedMultiOld.lane, "uncertain", `${environment} fails closed`);
    assert.match(
      [...malformedMultiOld.metadataErrors, ...malformedMultiOld.probeErrors].join("\n"),
      expectedError,
    );
  }
  assert.equal(typeof report.inventoryFingerprint, "string");
  assert.ok(report.inventoryFingerprint.length > 0);
  const humanReport = patrol();
  assert.match(humanReport, /uncommitted\.txt/, "the routine report includes exact dirty paths");
  assert.match(
    humanReport,
    /^Worktree budget: 8\/12 \(within budget\)$/m,
    "the routine report uses the lifecycle renderer's exact worktree budget line",
  );
  assert.match(
    humanReport,
    /^Local branch budget: 8\/30 \(within budget\)$/m,
    "the routine report uses the lifecycle renderer's exact local branch budget line",
  );
  assert.doesNotMatch(
    humanReport,
    /^Budgets:/m,
    "the routine report does not append the legacy combined budget block",
  );

  const safetyRegressionFailures = [];
  const verifySafetyRegression = (name, check) => {
    try {
      check();
    } catch (error) {
      safetyRegressionFailures.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  verifySafetyRegression("exact OID Bead ownership", () => {
    const oidOwnerReport = JSON.parse(
      patrol(["--json"], { LIFECYCLE_OID_ONLY_TASK: "1" }),
    );
    const oidOwnedBranch = oidOwnerReport.items.find(
      (item) => item.branch === "feat/branch-only",
    );
    assert.equal(oidOwnedBranch.lane, "active");
    assert.deepEqual(oidOwnedBranch.taskIds, ["cave-oid-owner"]);
  });

  verifySafetyRegression("abbreviated OID is not Bead ownership", () => {
    const shortOidReport = JSON.parse(
      patrol(["--json"], { LIFECYCLE_SHORT_OID_TASK: "1" }),
    );
    const shortOidBranch = shortOidReport.items.find(
      (item) => item.branch === "feat/branch-only",
    );
    assert.equal(shortOidBranch.lane, "retire-after-gate");
    assert.deepEqual(shortOidBranch.taskIds, []);
  });

  verifySafetyRegression("duplicate registered local branch ref", () => {
    const duplicateRefReport = JSON.parse(
      patrol(["--json"], { LIFECYCLE_DUPLICATE_REGISTERED_REF: "1" }),
    );
    const duplicateRefItems = duplicateRefReport.items.filter(
      (item) => item.ref === "refs/heads/feat/old",
    );
    assert.equal(duplicateRefItems.length, 2);
    for (const item of duplicateRefItems) {
      assert.equal(item.lane, "uncertain");
      assert.match(
        item.probeErrors.join("\n"),
        /registered local branch ref.*more than one worktree/i,
      );
    }
  });

  verifySafetyRegression("sanitized read-only Git probes", () => {
    const authSentinel = "ssh -o BatchMode=yes";
    const safeGitReport = JSON.parse(
      patrol(["--json"], {
        LIFECYCLE_REQUIRE_SAFE_GIT: "1",
        LIFECYCLE_EXPECT_GIT_SSH_COMMAND: authSentinel,
        GIT_SSH_COMMAND: authSentinel,
        GIT_DIR: origin,
        GIT_WORK_TREE: live,
        GIT_COMMON_DIR: path.join(fixtureRoot, "hostile-common"),
        GIT_INDEX_FILE: path.join(fixtureRoot, "hostile-index"),
        Git_Index_File: path.join(fixtureRoot, "hostile-mixed-case-index"),
        GIT_OBJECT_DIRECTORY: path.join(fixtureRoot, "hostile-objects"),
        GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(fixtureRoot, "hostile-alternates"),
        GIT_OPTIONAL_LOCKS: "1",
        GIT_REPLACE_REF_BASE: "refs/hostile-replace",
        GIT_NO_REPLACE_OBJECTS: "0",
        GIT_GRAFT_FILE: path.join(fixtureRoot, "hostile-grafts"),
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.repositoryFormatVersion",
        GIT_CONFIG_VALUE_0: "999",
        GIT_CONFIG_PARAMETERS: "'status.showUntrackedFiles'='no'",
        GIT_CONFIG_GLOBAL: path.join(fixtureRoot, "hostile-global-config"),
        GIT_CONFIG_SYSTEM: path.join(fixtureRoot, "hostile-system-config"),
        GIT_CONFIG_NOSYSTEM: "1",
      }),
    );
    const safeGitOld = safeGitReport.items.find((item) => item.branch === "feat/old");
    assert.equal(
      safeGitOld.lane,
      "retire-after-gate",
      JSON.stringify({
        probeErrors: safeGitOld.probeErrors,
        metadataErrors: safeGitOld.metadataErrors,
        reasons: safeGitOld.reasons,
      }),
    );
    assert.deepEqual(
      safeGitReport.items
        .find((item) => item.branch === "feat/live")
        .changes.map((line) => line.replace(/^\?\s+/, "")),
      ["uncommitted.txt"],
    );
  });

  verifySafetyRegression("exact worktree path bytes remain authoritative", () => {
    const spacedReport = JSON.parse(
      patrol(["--json"], { LIFECYCLE_SPACED_PATH: "1" }),
    );
    const spacedItem = spacedReport.items.find((item) => item.branch === "feat/spaced");
    assert.equal(spacedItem.path, spaced);
    assert.equal(spacedItem.path.endsWith(" "), true);
    assert.deepEqual(
      spacedItem.changes.map((line) => line.replace(/^\?\s+/, "")),
      ["significant-space.txt"],
    );
    assert.deepEqual(spacedItem.sessionIds, ["session-spaced"]);
    assert.deepEqual(spacedItem.processOwners, [{ pid: 1001, command: "node" }]);
    assert.equal(spacedItem.metadata.beadId, "cave-spaced");
    assert.deepEqual(spacedItem.metadataErrors, []);
    assert.deepEqual(spacedItem.taskIds, ["cave-spaced"]);
    assert.notEqual(spacedItem.lane, "retire-after-gate");
  });

  verifySafetyRegression("NUL Coven session root", () => {
    const nulSessionReport = JSON.parse(
      patrol(["--json"], { LIFECYCLE_NUL_SESSION_ROOT: "1" }),
    );
    const nulSessionOld = nulSessionReport.items.find(
      (item) => item.branch === "feat/old",
    );
    assert.equal(nulSessionOld.lane, "uncertain");
    assert.match(
      nulSessionOld.probeErrors.join("\n"),
      /Coven sessions returned malformed data/,
    );
  });

  verifySafetyRegression("NUL structured metadata path", () => {
    const nulMetadataReport = JSON.parse(
      patrol(["--json"], { LIFECYCLE_NUL_METADATA_PATH: "1" }),
    );
    const nulMetadataOld = nulMetadataReport.items.find(
      (item) => item.branch === "feat/old",
    );
    assert.equal(nulMetadataOld.lane, "uncertain");
    assert.match(
      nulMetadataOld.metadataErrors.join("\n"),
      /path must be absolute/i,
    );
  });

  verifySafetyRegression("NUL exception path", () => {
    const nulExceptionReport = JSON.parse(
      patrol(["--json"], { LIFECYCLE_NUL_EXCEPTION_PATH: "1" }),
    );
    const nulExceptionOld = nulExceptionReport.items.find(
      (item) => item.branch === "feat/old",
    );
    assert.equal(nulExceptionOld.lane, "uncertain");
    assert.match(
      nulExceptionOld.metadataErrors.join("\n"),
      /exception additionalPaths must contain absolute paths/i,
    );
  });

  verifySafetyRegression("replacement refs cannot prove ancestry", () => {
    const replacementTree = git(["show", "-s", "--format=%T", defaultHead], repo).trim();
    const replacementCommit = git(
      ["commit-tree", replacementTree, "-p", oldHead, "-m", "replacement ancestry lie"],
      repo,
      {
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2026-07-22T12:00:00Z",
          GIT_COMMITTER_DATE: "2026-07-22T12:00:00Z",
        },
      },
    ).trim();
    git(["replace", "-f", defaultHead, replacementCommit], repo);
    try {
      git(["merge-base", "--is-ancestor", oldHead, defaultHead], repo);
      assert.throws(
        () =>
          git(
            ["--no-replace-objects", "merge-base", "--is-ancestor", oldHead, defaultHead],
            repo,
          ),
        "the fixture must lie only when replacement refs are honored",
      );
      const replacementReport = JSON.parse(
        patrol(["--json"], { LIFECYCLE_CLOSED_UNMERGED: "1" }),
      );
      assert.equal(
        replacementReport.items.find((item) => item.branch === "feat/old").lane,
        "recovery",
      );
    } finally {
      git(["replace", "-d", defaultHead], repo);
    }
  });

  verifySafetyRegression("nonempty legacy grafts fail closed globally", () => {
    const graftPath = path.join(repo, ".git", "info", "grafts");
    writeFileSync(graftPath, `${defaultHead} ${oldHead}\n`);
    try {
      const graftReport = JSON.parse(patrol(["--json"]));
      for (const item of graftReport.items) {
        assert.notEqual(item.lane, "retire-after-gate");
        assert.ok(
          item.probeErrors.includes(
            "Git history override inventory is unsafe: shared git common dir info/grafts is nonempty",
          ),
        );
      }
      assert.equal(
        graftReport.items.find((item) => item.branch === "feat/old").lane,
        "uncertain",
      );
    } finally {
      rmSync(graftPath, { force: true });
    }
  });

  if (safetyRegressionFailures.length > 0) {
    assert.fail(`Task 2 safety regressions:\n${safetyRegressionFailures.join("\n")}`);
  }

  for (const [environment, expectedReason] of [
    ["LIFECYCLE_LSOF_FAIL", /process cwd inventory unavailable/],
    ["LIFECYCLE_LSOF_MALFORMED", /process cwd inventory returned malformed or partial data/],
    ["LIFECYCLE_BAD_CLAIMS", /Coven claims returned malformed data/],
    ["LIFECYCLE_UNKNOWN_CLAIM_STATE", /Coven claims returned malformed data/],
    ["LIFECYCLE_BAD_SESSIONS", /Coven sessions returned malformed data/],
    ["LIFECYCLE_BAD_WORKFLOW", /workflow inventory returned malformed data/],
    ["LIFECYCLE_PARTIAL_WORKFLOW", /workflow inventory returned partial data/],
    ["LIFECYCLE_CAPPED_WORKFLOW", /workflow inventory reached GitHub's 1000-run cap/],
    ["LIFECYCLE_DUPLICATE_WORKFLOW_ID", /workflow inventory.*duplicate.*ID/i],
    ["LIFECYCLE_MALFORMED_WORKFLOW_ID", /workflow inventory returned malformed data/i],
    ["LIFECYCLE_MISMATCHED_WORKFLOW_STATUS", /workflow inventory returned malformed data/i],
    ["LIFECYCLE_CONFLICTING_WORKFLOW_STATUS", /workflow inventory.*conflicting.*status/i],
    ["LIFECYCLE_UNSTABLE_WORKFLOW", /workflow inventory changed between verification sweeps/i],
    ["LIFECYCLE_BAD_TASKS", /Beads inventory returned malformed data/],
    ["LIFECYCLE_PR_CAP", /exact-head PR search.*(?:cap|1000)/i],
    [
      "LIFECYCLE_INCOMPLETE_ASSOCIATED_PAGINATION",
      /associated PR inventory.*(?:incomplete|pagination)/i,
    ],
    [
      "LIFECYCLE_MALFORMED_ASSOCIATED_PAGINATION",
      /associated PR inventory.*(?:cursor|pagination|malformed)/i,
    ],
    [
      "LIFECYCLE_MISMATCHED_ASSOCIATED_OID",
      /associated PR inventory.*(?:OID|malformed)/i,
    ],
    [
      "LIFECYCLE_DUPLICATE_ASSOCIATED_NODE",
      /associated PR inventory.*duplicate pull request/i,
    ],
    [
      "LIFECYCLE_OMITTED_ASSOCIATED_NODE",
      /associated PR inventory.*(?:incomplete|total)/i,
    ],
    [
      "LIFECYCLE_UNSTABLE_ASSOCIATED_TOTAL",
      /associated PR inventory.*totals.*inconsistent/i,
    ],
    ["LIFECYCLE_DUPLICATE_SEARCH_NODE", /exact-head PR search.*duplicate pull request/i],
    ["LIFECYCLE_MALFORMED_HEAD_SEARCH", /exact-head PR search.*(?:incomplete|malformed)/i],
  ]) {
    const failedReport = JSON.parse(patrol(["--json"], { [environment]: "1" }));
    const failedOld = failedReport.items.find((item) => item.branch === "feat/old");
    assert.equal(failedOld.lane, "uncertain", `${environment} fails closed`);
    assert.match(failedOld.probeErrors.join("\n"), expectedReason);
  }

  const activeSessionReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_ACTIVE_SESSION: "1" }),
  );
  const sessionOwnedOld = activeSessionReport.items.find((item) => item.branch === "feat/old");
  assert.equal(sessionOwnedOld.lane, "active", "a nonterminal Coven session owns its path");
  assert.deepEqual(sessionOwnedOld.sessionIds, ["session-fixture"]);

  const descendantSessionReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_DESCENDANT_SESSION: "1" }),
  );
  const descendantSessionOld = descendantSessionReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(
    descendantSessionOld.lane,
    "active",
    "a nonterminal Coven session below a worktree owns it",
  );
  assert.deepEqual(descendantSessionOld.sessionIds, ["session-descendant"]);

  const linkedDescendantSessionReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_LINKED_DESCENDANT_SESSION: "1" }),
  );
  const linkedDescendantSession = linkedDescendantSessionReport.items.find(
    (item) => item.branch === "feat/cave-link1-linked",
  );
  const primaryWithLinkedSession = linkedDescendantSessionReport.items.find(
    (item) => item.branch === "main",
  );
  assert.equal(linkedDescendantSession.lane, "active");
  assert.deepEqual(linkedDescendantSession.sessionIds, ["session-linked"]);
  assert.deepEqual(
    primaryWithLinkedSession.sessionIds,
    [],
    "a linked worktree's descendant session belongs only to the deepest match",
  );

  const siblingPrefixSessionReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_SIBLING_PREFIX_SESSION: "1" }),
  );
  const siblingPrefixSessionOld = siblingPrefixSessionReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(siblingPrefixSessionOld.lane, "retire-after-gate");
  assert.deepEqual(
    siblingPrefixSessionOld.sessionIds,
    [],
    "a sibling-prefix session path is not inside the worktree",
  );

  const killedSessionReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_KILLED_SESSION: "1" }),
  );
  const killedSessionOld = killedSessionReport.items.find((item) => item.branch === "feat/old");
  assert.equal(
    killedSessionOld.lane,
    "retire-after-gate",
    "a killed Coven session does not keep the worktree active",
  );
  assert.deepEqual(killedSessionOld.sessionIds, []);

  const stoppedSessionReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_STOPPED_SESSION: "1" }),
  );
  const stoppedSessionOld = stoppedSessionReport.items.find((item) => item.branch === "feat/old");
  assert.equal(
    stoppedSessionOld.lane,
    "retire-after-gate",
    "a stopped Coven session does not keep the path-matched worktree active",
  );
  assert.deepEqual(stoppedSessionOld.sessionIds, []);

  const unavailableSessionReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_SESSIONS_UNAVAILABLE: "1" }),
  );
  const unavailableSessionOld = unavailableSessionReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(unavailableSessionOld.lane, "uncertain", "unavailable sessions fail closed");
  assert.match(unavailableSessionOld.probeErrors.join("\n"), /Coven sessions unavailable/);
  assert.deepEqual(unavailableSessionOld.sessionIds, []);
  const unavailableSessionBranchOnly = unavailableSessionReport.items.find(
    (item) => item.branch === "feat/branch-only",
  );
  assert.doesNotMatch(
    unavailableSessionBranchOnly.probeErrors.join("\n"),
    /Coven sessions unavailable/,
    "branch-only units do not gain the path-only sessions probe error",
  );

  for (const [dateCase, expectedError] of [
    ["created-at-informal", /createdAt must be an RFC3339 timestamp/],
    ["created-at-rolled", /createdAt must be an RFC3339 timestamp/],
    ["review-after-timestamp", /reviewAfter must be an ISO calendar date/],
    ["review-after-invalid", /reviewAfter must be an ISO calendar date/],
    ["expires-at-informal", /exception expiresAt must be an RFC3339 timestamp/],
    ["expires-at-rolled", /exception expiresAt must be an RFC3339 timestamp/],
  ]) {
    const malformedDateReport = JSON.parse(
      patrol(["--json"], { LIFECYCLE_BAD_METADATA_DATE_CASE: dateCase }),
    );
    const malformedDateOld = malformedDateReport.items.find(
      (item) => item.branch === "feat/old",
    );
    assert.equal(malformedDateOld.lane, "uncertain", `${dateCase} fails closed`);
    assert.equal(malformedDateOld.metadata, null);
    assert.match(malformedDateOld.metadataErrors.join("\n"), expectedError);
  }

  const missingMetadataReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_MISSING_BRANCH_METADATA: "1" }),
  );
  const missingMetadataBranch = missingMetadataReport.items.find(
    (item) => item.branch === "feat/branch-only",
  );
  assert.equal(
    missingMetadataBranch.lane,
    "uncertain",
    "branch-only cleanup requires valid structured metadata",
  );
  assert.notEqual(
    missingMetadataBranch.lane,
    "retire-after-gate",
    "missing structured metadata is never cleanup-ready",
  );
  assert.match(missingMetadataBranch.reasons.join("\n"), /metadata backfill/i);

  const duplicateMetadataReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_DUPLICATE_METADATA: "1" }),
  );
  const duplicateMetadataBranch = duplicateMetadataReport.items.find(
    (item) => item.branch === "feat/branch-only",
  );
  assert.equal(duplicateMetadataBranch.lane, "uncertain");
  assert.match(duplicateMetadataBranch.metadataErrors.join("\n"), /duplicate/i);
  assert.deepEqual(
    duplicateMetadataReport.budgets.exceptions,
    { active: 0, expired: 0 },
    "duplicate metadata exceptions are not counted",
  );

  const structuredOwnerReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_OPEN_STRUCTURED_TASK: "1" }),
  );
  const structuredOwnerBranch = structuredOwnerReport.items.find(
    (item) => item.branch === "feat/branch-only",
  );
  assert.equal(structuredOwnerBranch.lane, "active");
  assert.deepEqual(structuredOwnerBranch.taskIds, ["cave-branch-only"]);

  const openConflictingPathReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_OPEN_CONFLICTING_STRUCTURED_PATH: "1" }),
  );
  const openConflictingPathOld = openConflictingPathReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(
    openConflictingPathOld.lane,
    "active",
    "an open Bead owns the exact structured path even when its branch differs",
  );
  assert.deepEqual(openConflictingPathOld.taskIds, ["cave-other-owner"]);
  assert.equal(openConflictingPathOld.metadata, null);
  assert.match(
    openConflictingPathOld.metadataErrors.join("\n"),
    /conflicting structured path ownership/i,
  );

  const closedConflictingPathReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_CLOSED_CONFLICTING_STRUCTURED_PATH: "1" }),
  );
  const closedConflictingPathOld = closedConflictingPathReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(
    closedConflictingPathOld.lane,
    "uncertain",
    "a closed conflicting structured path still blocks metadata authorization",
  );
  assert.deepEqual(closedConflictingPathOld.taskIds, []);
  assert.equal(closedConflictingPathOld.metadata, null);
  assert.match(
    closedConflictingPathOld.metadataErrors.join("\n"),
    /conflicting structured path ownership/i,
  );

  const siblingStructuredPathReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_SIBLING_STRUCTURED_PATH: "1" }),
  );
  const siblingStructuredPathOld = siblingStructuredPathReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(siblingStructuredPathOld.lane, "retire-after-gate");
  assert.equal(siblingStructuredPathOld.metadata.beadId, "cave-old");
  assert.deepEqual(
    siblingStructuredPathOld.metadataErrors,
    [],
    "a sibling-prefix structured path is not an ownership conflict",
  );
  assert.deepEqual(
    siblingStructuredPathOld.taskIds,
    [],
    "structured metadata for an unrelated path is not an active task blocker",
  );

  const partialReport = JSON.parse(patrol(["--json"], { LIFECYCLE_LSOF_PARTIAL: "1" }));
  const partialOld = partialReport.items.find((item) => item.branch === "feat/old");
  assert.equal(partialOld.lane, "active", "a discovered owner keeps partial process data active");
  assert.deepEqual(partialOld.processOwners, [{ pid: 999, command: "node" }]);
  assert.match(
    partialOld.probeErrors.join("\n"),
    /process cwd inventory returned malformed or partial data/,
  );

  const warnedReport = JSON.parse(patrol(["--json"], { LIFECYCLE_LSOF_WARN: "1" }));
  const warnedOld = warnedReport.items.find((item) => item.branch === "feat/old");
  assert.equal(warnedOld.lane, "active", "owners survive a successful but warned process scan");
  assert.deepEqual(warnedOld.processOwners, [{ pid: 999, command: "node" }]);
  assert.match(warnedOld.probeErrors.join("\n"), /process cwd inventory reported incomplete data/);

  const nonMainReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_NON_MAIN_MERGE: "1" }),
  );
  const nonMainOld = nonMainReport.items.find((item) => item.branch === "feat/old");
  assert.equal(
    nonMainOld.lane,
    "recovery",
    "an exact merge into a non-default branch does not prove landing",
  );
  assert.equal(nonMainOld.mergedPr, null);

  const closedDraftReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_CLOSED_DRAFT: "1" }),
  );
  const closedDraftOld = closedDraftReport.items.find((item) => item.branch === "feat/old");
  assert.equal(closedDraftOld.lane, "active", "an exact-OID draft PR remains an active owner");
  assert.deepEqual(closedDraftOld.openPrs, [
    { number: 96, url: "https://github.com/OpenCoven/coven-cave/pull/96" },
  ]);

  const outboundOpenReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_OUTBOUND_OPEN: "1" }),
  );
  const outboundOpenOld = outboundOpenReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(
    outboundOpenOld.lane,
    "active",
    "an outbound exact-OID PR owns the branch despite a different head repository and name",
  );
  assert.deepEqual(outboundOpenOld.openPrs, [
    { number: 99, url: "https://github.com/OtherOrg/other-repo/pull/99" },
  ]);

  const exactMergedReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_EXACT_MERGED_DIFFERENT_HEAD: "1" }),
  );
  const exactMergedOld = exactMergedReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(
    exactMergedOld.lane,
    "cooldown",
    "an exact OID merged into the authoritative default branch supplies cooldown evidence",
  );
  assert.deepEqual(exactMergedOld.mergedPr, {
    number: 98,
    url: "https://github.com/OpenCoven/coven-cave/pull/98",
    headOid: oldHead,
  });

  const closedUnmergedReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_CLOSED_UNMERGED: "1" }),
  );
  const closedUnmergedOld = closedUnmergedReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(
    closedUnmergedOld.lane,
    "recovery",
    "a closed unmerged non-draft PR is neither an owner nor landing proof",
  );
  assert.deepEqual(closedUnmergedOld.openPrs, []);
  assert.equal(closedUnmergedOld.mergedPr, null);

  const sameNameSearchReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_SAME_NAME_OPEN_SEARCH: "1" }),
  );
  const sameNameSearchOld = sameNameSearchReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(
    sameNameSearchOld.lane,
    "active",
    "the exhaustive exact-head search retains same-name open PR ownership",
  );

  const headOnlyDraftReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_HEAD_ONLY_DRAFT: "1" }),
  );
  const headOnlyDraftOld = headOnlyDraftReport.items.find(
    (item) => item.branch === "feat/old",
  );
  assert.equal(
    headOnlyDraftOld.lane,
    "active",
    "an exact-head draft omitted from associated OID results still blocks retirement",
  );
  assert.deepEqual(headOnlyDraftOld.openPrs, [
    { number: 78, url: "https://github.com/OpenCoven/coven-cave/pull/78" },
  ]);

  const duplicatePrReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_DUPLICATE_PR: "1" }),
  );
  assert.deepEqual(
    duplicatePrReport.items.find((item) => item.branch === "feat/old").openPrs,
    [{ number: 77, url: "https://github.com/OpenCoven/coven-cave/pull/77" }],
    "associated and exact-head PR records deduplicate stably",
  );

  const badCanonicalReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_BAD_CANONICAL_REPO: "1" }),
  );
  for (const branch of ["feat/old", "feat/branch-only"]) {
    const item = badCanonicalReport.items.find((candidate) => candidate.branch === branch);
    assert.equal(item.lane, "uncertain", "canonical repository failure is global");
    assert.match(item.probeErrors.join("\n"), /canonical.*repository/i);
  }

  const linkedReport = JSON.parse(patrol(["--json"], { LIFECYCLE_LINKED_TASK: "1" }));
  const linkedItem = linkedReport.items.find(
    (item) => item.branch === "feat/cave-link1-linked",
  );
  assert.equal(linkedItem.lane, "active", "a Bead ID embedded in the branch proves ownership");
  assert.deepEqual(linkedItem.taskIds, ["CAVE-LINK1"]);

  const trunkDefaultReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_DEFAULT_TRUNK: "1" }),
  );
  assert.equal(
    trunkDefaultReport.items.find((item) => item.branch === "feat/branch-only").lane,
    "retire-after-gate",
    "the authoritative remote default branch is discovered instead of hard-coding main",
  );
  assert.equal(
    trunkDefaultReport.items.find((item) => item.branch === "main").lane,
    "protected",
    "main remains protected when the remote default branch has another name",
  );

  const mutatedTrackingReport = JSON.parse(
    patrol(["--json"], { LIFECYCLE_DEFAULT_TRACKING_MUTATION: "1" }),
  );
  assert.equal(
    mutatedTrackingReport.items.find((item) => item.branch === "feat/branch-only").lane,
    "retire-after-gate",
    "ancestry uses the captured authoritative default OID after the tracking ref mutates",
  );

  for (const [environment, expectedError] of [
    ["LIFECYCLE_STALE_DEFAULT", /default branch inventory.*(?:stale|mismatch)/i],
    ["LIFECYCLE_MALFORMED_DEFAULT", /default branch inventory.*malformed/i],
    ["LIFECYCLE_MISSING_DEFAULT_TRACKING", /default branch inventory.*tracking/i],
    ["LIFECYCLE_MISMATCHED_DEFAULT_TARGET", /default branch inventory.*target.*mismatch/i],
    ["LIFECYCLE_MALFORMED_DEFAULT_TRACKING", /default branch inventory.*tracking.*malformed/i],
  ]) {
    const invalidDefaultReport = JSON.parse(
      patrol(["--json"], { [environment]: "1" }),
    );
    const invalidDefaultOld = invalidDefaultReport.items.find(
      (item) => item.branch === "feat/old",
    );
    assert.equal(invalidDefaultOld.lane, "uncertain", `${environment} fails closed`);
    assert.notEqual(
      invalidDefaultOld.lane,
      "retire-after-gate",
      `${environment} is never cleanup-ready`,
    );
    assert.match(invalidDefaultOld.probeErrors.join("\n"), expectedError);
    assert.equal(
      existsSync(
        path.join(fixtureRoot, `invalid-default-merge-base-${lastPatrolInvocation}`),
      ),
      false,
      `${environment} does not run ancestry before default OID equality proof`,
    );
  }
  for (const liveMainCase of ["malformed", "wrong-ref", "multi-record"]) {
    const malformedLiveMainReport = JSON.parse(
      patrol(["--json"], { LIFECYCLE_MALFORMED_LIVE_MAIN_CASE: liveMainCase }),
    );
    const malformedLiveMainOld = malformedLiveMainReport.items.find(
      (item) => item.branch === "feat/old",
    );
    assert.equal(malformedLiveMainOld.lane, "uncertain", `${liveMainCase} live main fails closed`);
    assert.notEqual(
      malformedLiveMainOld.lane,
      "retire-after-gate",
      `${liveMainCase} live main is never cleanup-ready`,
    );
    assert.match(
      malformedLiveMainOld.probeErrors.join("\n"),
      /default branch inventory.*target ref.*malformed/i,
    );
    assert.equal(
      existsSync(
        path.join(fixtureRoot, `invalid-default-merge-base-${lastPatrolInvocation}`),
      ),
      false,
      `${liveMainCase} live main does not run ancestry before default OID equality proof`,
    );
  }

  assert.equal(
    git(["worktree", "list", "--porcelain"], repo),
    beforeWorktrees,
    "the patrol never changes worktree registrations",
  );
  assert.equal(
    git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"], repo),
    beforeBranches,
    "the patrol never changes branch refs",
  );
  assert.equal(
    git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"], repo),
    beforeRemoteRefs,
    "the patrol never changes remote-tracking refs",
  );
  assert.equal(readFileSync(path.join(live, "uncommitted.txt"), "utf8"), "live\n");

  assert.throws(
    () => patrol(["--json"], { LIFECYCLE_DRIFT: "1" }),
    /worktree or branch inventory changed during patrol/,
    "a concurrent branch change aborts instead of returning an incomplete success",
  );

  let graftDriftError;
  try {
    patrol(["--json"], { LIFECYCLE_GRAFT_DRIFT: "1", NODE_NO_WARNINGS: "1" });
  } catch (error) {
    graftDriftError = error;
  }
  assert.ok(graftDriftError, "a graft appearing during patrol must abort");
  assert.equal(
    graftDriftError.stderr.trim(),
    "worktree-lifecycle-patrol: history override inventory changed during patrol",
  );
  rmSync(path.join(repo, ".git", "info", "grafts"), { force: true });

  let replacementDriftError;
  try {
    patrol(["--json"], { LIFECYCLE_REPLACEMENT_DRIFT: "1", NODE_NO_WARNINGS: "1" });
  } catch (error) {
    replacementDriftError = error;
  } finally {
    git(["update-ref", "-d", `refs/replace/${defaultHead}`], repo);
  }
  assert.ok(replacementDriftError, "replacement-ref drift must abort");
  assert.equal(
    replacementDriftError.stderr.trim(),
    "worktree-lifecycle-patrol: history override inventory changed during patrol",
  );

  let registrationDriftError;
  try {
    patrol(["--json"], { LIFECYCLE_WORKTREE_DRIFT: "1", NODE_NO_WARNINGS: "1" });
  } catch (error) {
    registrationDriftError = error;
  }
  assert.ok(registrationDriftError, "a concurrent worktree registration must abort patrol");
  assert.equal(
    registrationDriftError.stderr.trim(),
    "worktree-lifecycle-patrol: worktree or branch inventory changed during patrol",
  );
} finally {
  if (existsSync(registeredDrift)) {
    git(["worktree", "remove", registeredDrift], repo);
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("worktree-lifecycle-patrol.test.mjs: ok");
