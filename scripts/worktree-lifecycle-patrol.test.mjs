import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(sourceRoot, "scripts", "worktree-lifecycle-patrol.ts");
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "worktree-lifecycle-"));

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
  const repo = path.join(fixtureRoot, "repo");
  const origin = path.join(fixtureRoot, "origin.git");
  const bin = path.join(fixtureRoot, "bin");
  mkdirSync(repo);
  mkdirSync(origin);
  mkdirSync(bin);

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

  executable(
    path.join(bin, "gh"),
    `#!/bin/sh
case "$*" in
  *"pr list"*"--head feat/old"*)
    if [ "\${LIFECYCLE_PR_CAP:-0}" = "1" ]; then
      node -e 'const pr={number:42,url:"https://example.test/42",state:"CLOSED",isDraft:false,mergedAt:null,baseRefName:"main",headRefName:"feat/old",headRefOid:"${oldHead}"}; console.log(JSON.stringify(Array.from({length:101},(_,index)=>({...pr,number:index+1}))))'
    elif [ "\${LIFECYCLE_CLOSED_DRAFT:-0}" = "1" ]; then
      printf '%s\n' '[{"number":42,"url":"https://example.test/42","state":"CLOSED","isDraft":true,"mergedAt":null,"baseRefName":"main","headRefName":"feat/old","headRefOid":"${oldHead}"}]'
    else
      BASE=main
      if [ "\${LIFECYCLE_NON_MAIN_MERGE:-0}" = "1" ]; then BASE=staging; fi
      node -e 'const pr={number:42,url:"https://example.test/42",state:"MERGED",isDraft:false,mergedAt:"2026-07-21T12:00:00Z",baseRefName:process.argv[1],headRefName:"feat/old",headRefOid:"${oldHead}",filler:"x".repeat(2*1024*1024)}; console.log(JSON.stringify([pr]))' "$BASE"
    fi
    ;;
  *"pr list"*"--head feat/recent-merge"*)
    printf '%s\n' '[{"number":43,"url":"https://example.test/43","state":"MERGED","isDraft":false,"mergedAt":"2026-08-10T21:00:00Z","baseRefName":"main","headRefName":"feat/recent-merge","headRefOid":"${recentMergeHead}"}]'
    ;;
  *"pr list"*"--head feat/recent-reflog"*)
    printf '%s\n' '[{"number":44,"url":"https://example.test/44","state":"MERGED","isDraft":false,"mergedAt":"2026-07-21T12:00:00Z","baseRefName":"main","headRefName":"feat/recent-reflog","headRefOid":"${recentReflogHead}"}]'
    ;;
  *"pr list"*)
    printf '%s\n' '[]'
    ;;
  *"/actions/runs"*)
    if [ "\${LIFECYCLE_BAD_WORKFLOW:-0}" = "1" ]; then
      printf '%s\n' '[{"total_count":1,"workflow_runs":[{}]}]'
    elif [ "\${LIFECYCLE_PARTIAL_WORKFLOW:-0}" = "1" ]; then
      printf '%s\n' '[{"total_count":2,"workflow_runs":[{"head_branch":"feat/old","head_sha":"${oldHead}","html_url":"https://example.test/run"}]}]'
    elif [ "\${LIFECYCLE_CAPPED_WORKFLOW:-0}" = "1" ]; then
      printf '%s\n' '[{"total_count":1000,"workflow_runs":[]}]'
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
if [ "\${LIFECYCLE_BAD_TASKS:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-bad","status":"open","title":[]}]'
elif [ "\${LIFECYCLE_EXCEPTION_BUDGETS:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${realpathSync(old)}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Active matched exception","expiresAt":"2026-08-11T00:00:00Z","additionalPaths":["${realpathSync(old)}"]}}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${path.join(repo, ".worktrees", "path-mismatch")}","owner":"Kitty","purpose":"Mismatched fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Expired path mismatch","expiresAt":"2026-08-10T21:00:00Z","additionalPaths":["${recentMerge}"]}}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Expired matched exception","expiresAt":"2026-08-10T21:00:00Z","additionalPaths":["${branchOnlyPath}"]}}}}},{"id":"cave-stale","status":"closed","title":"Stale metadata","metadata":{"coven":{"worktree":{"branch":"feat/stale","path":"${path.join(repo, ".worktrees", "stale")}","owner":"Kitty","purpose":"Stale fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Active stale exception","expiresAt":"2026-08-11T00:00:00Z","additionalPaths":["${path.join(repo, ".worktrees", "stale")}"]}}}}}]'
elif [ "\${LIFECYCLE_LINKED_TASK:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"CAVE-LINK1","status":"open","title":"Unrelated task","description":"","notes":""},{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}}]'
elif [ "\${LIFECYCLE_MISSING_BRANCH_METADATA:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}}]'
elif [ "\${LIFECYCLE_DUPLICATE_METADATA:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"First duplicate exception","expiresAt":"2026-08-11T00:00:00Z","additionalPaths":["${branchOnlyPath}"]}}}}},{"id":"cave-branch-only-copy","status":"closed","title":"Branch only duplicate","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Duplicate fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":{"owner":"Kitty","reason":"Second duplicate exception","expiresAt":"2026-08-11T00:00:00Z","additionalPaths":["${branchOnlyPath}"]}}}}}]'
elif [ "\${LIFECYCLE_OPEN_STRUCTURED_TASK:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"open","title":"Unrelated task","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}}]'
elif [ "\${LIFECYCLE_NULL_EXCEPTION:-0}" = "1" ]; then
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z","exception":null}}}}]'
else
  printf '%s\n' '[{"id":"cave-old","status":"closed","title":"Old work","metadata":{"coven":{"worktree":{"branch":"feat/old","path":"${old}","owner":"Kitty","purpose":"Landed fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-merge","status":"closed","title":"Recent merge","metadata":{"coven":{"worktree":{"branch":"feat/recent-merge","path":"${recentMerge}","owner":"Kitty","purpose":"Recent fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-recent-reflog","status":"closed","title":"Recent reflog","metadata":{"coven":{"worktree":{"branch":"feat/recent-reflog","path":"${recentReflog}","owner":"Kitty","purpose":"Reflog fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}},{"id":"cave-branch-only","status":"closed","title":"Branch only","metadata":{"coven":{"worktree":{"branch":"feat/branch-only","path":"${branchOnlyPath}","owner":"Kitty","purpose":"Removed worktree fixture","disposition":"pr","createdAt":"2026-07-20T12:00:00Z"}}}}]'
fi
`,
  );
  executable(
    path.join(bin, "coven"),
    `#!/bin/sh
if [ "$1" = "sessions" ] && [ "$2" = "--json" ]; then
  if [ "\${LIFECYCLE_BAD_SESSIONS:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":[],"project_root":"${old}","status":"running"}]}'
  elif [ "\${LIFECYCLE_KILLED_SESSION:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-fixture","project_root":"${old}","status":"killed"}]}'
  elif [ "\${LIFECYCLE_ACTIVE_SESSION:-0}" = "1" ]; then
    printf '%s\n' '{"sessions":[{"id":"session-fixture","project_root":"${old}","status":"created"}]}'
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
printf 'p1\ncinit\nfcwd\nn/\n'
exit 0
`,
  );

  const beforeWorktrees = git(["worktree", "list", "--porcelain"], repo);
  const beforeBranches = git(
    ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"],
    repo,
  );
  const patrol = (extraArgs = [], extraEnv = {}) =>
    run(
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
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          ...extraEnv,
        },
      },
    );
  const stdout = patrol(["--json"]);
  const report = JSON.parse(stdout);

  const byBranch = new Map(report.items.map((item) => [item.branch, item]));
  assert.equal(byBranch.get("main").lane, "protected");
  assert.equal(byBranch.get("feat/live").lane, "active");
  assert.deepEqual(
    byBranch.get("feat/live").changes.map((line) => line.replace(/^\?\s+/, "")),
    ["uncommitted.txt"],
    "the report retains dirty paths instead of reducing them to a count",
  );
  assert.equal(byBranch.get("feat/old").lane, "retire-after-gate");
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
    worktrees: { count: 7, warning: 12, exceeded: false },
    branches: { count: 7, warning: 30, exceeded: false },
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
  assert.match(
    exceptionBudgetReport.items
      .find((item) => item.branch === "feat/recent-merge")
      .metadataErrors.join("\n"),
    /path does not match/i,
    "path-mismatched metadata remains invalid and does not affect exception budgets",
  );
  assert.equal(typeof report.inventoryFingerprint, "string");
  assert.ok(report.inventoryFingerprint.length > 0);
  const humanReport = patrol();
  assert.match(humanReport, /uncommitted\.txt/, "the routine report includes exact dirty paths");
  assert.match(
    humanReport,
    /^Worktree budget: 7\/12 \(within budget\)$/m,
    "the routine report uses the lifecycle renderer's exact worktree budget line",
  );
  assert.match(
    humanReport,
    /^Local branch budget: 7\/30 \(within budget\)$/m,
    "the routine report uses the lifecycle renderer's exact local branch budget line",
  );
  assert.doesNotMatch(
    humanReport,
    /^Budgets:/m,
    "the routine report does not append the legacy combined budget block",
  );

  for (const [environment, expectedReason] of [
    ["LIFECYCLE_LSOF_FAIL", /process cwd inventory unavailable/],
    ["LIFECYCLE_LSOF_MALFORMED", /process cwd inventory returned malformed or partial data/],
    ["LIFECYCLE_BAD_CLAIMS", /Coven claims returned malformed data/],
    ["LIFECYCLE_UNKNOWN_CLAIM_STATE", /Coven claims returned malformed data/],
    ["LIFECYCLE_BAD_SESSIONS", /Coven sessions returned malformed data/],
    ["LIFECYCLE_BAD_WORKFLOW", /workflow inventory returned malformed data/],
    ["LIFECYCLE_PARTIAL_WORKFLOW", /workflow inventory returned partial data/],
    ["LIFECYCLE_CAPPED_WORKFLOW", /workflow inventory reached GitHub's 1000-run cap/],
    ["LIFECYCLE_BAD_TASKS", /Beads inventory returned malformed data/],
    ["LIFECYCLE_PR_CAP", /pull request inventory exceeded the safe per-branch limit/],
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
  assert.equal(closedDraftOld.lane, "recovery", "a closed draft PR is not an active owner");
  assert.deepEqual(closedDraftOld.openPrs, []);

  const linkedReport = JSON.parse(patrol(["--json"], { LIFECYCLE_LINKED_TASK: "1" }));
  const linkedItem = linkedReport.items.find(
    (item) => item.branch === "feat/cave-link1-linked",
  );
  assert.equal(linkedItem.lane, "active", "a Bead ID embedded in the branch proves ownership");
  assert.deepEqual(linkedItem.taskIds, ["CAVE-LINK1"]);

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
  assert.equal(readFileSync(path.join(live, "uncommitted.txt"), "utf8"), "live\n");

  assert.throws(
    () => patrol(["--json"], { LIFECYCLE_DRIFT: "1" }),
    /worktree or branch inventory changed during patrol/,
    "a concurrent branch change aborts instead of returning an incomplete success",
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("worktree-lifecycle-patrol.test.mjs: ok");
