#!/usr/bin/env node
// Fail a CI job when the checked-out tree does not match the CURRENT content
// of refs/pull/<n>/merge for the PR this run belongs to (cave-d9xfq).
//
// WHY THIS EXISTS
// After close/reopen forces a fresh pull_request event, a job can check out a
// merge commit that PREDATES the current refs/pull/<n>/merge value. Three
// measured occurrences (cave-d9xfq):
//   #4922 — two jobs in one run took different trees; the later job got the
//           older one (false RED).
//   #4940 — a reopened PR's app tests ran the old buggy tree and failed
//           (false RED).
//   #4934 — a job passed on a tree roughly nineteen merges behind main, so the
//           hydration test that should have run was not even present (false
//           GREEN, the dangerous direction: a green is exactly when nobody
//           looks).
// Both surfaces that "verify" the checkout afterwards lie: the ref endpoint
// and the job log's Commit: header describe the current ref, not the tree the
// job actually ran. The only sound detection is CONTENT-BASED.
//
// WHAT THIS CHECKS (two independent content signals)
//   1. TREE HASH — the checked-out HEAD tree must equal the tree of
//      refs/pull/<n>/merge fetched FRESH at job time. A tree hash is
//      content-addressed, so equality is content equality.
//   2. CONTENT PROBE — every file present in the current merge tree must also
//      be present in the checked-out tree (reported first for test files, the
//      "code under test"). This is the false-green guard: a stale tree that
//      predates the code under test trivially lacks its files, and an absent
//      file is exactly what that looks like (cave-d9xfq #4934). The file
//      count is the same corroborating metric the bead measured by hand
//      (1292 -> 1285 test files).
//
// The head sha from the event payload is used as a diagnostic cross-check
// against the live refs/pull/<n>/head (via ls-remote, no object download):
// if the PR was pushed while the run was in flight, the merge ref was
// refreshed and that explains any mismatch below. The verdict is content, not
// the event header.
//
// Usage:
//   node scripts/check-merge-tree-freshness.mjs --pr <n> --head <40-hex> [--repo <path>] [--remote <name>]
//
// Exit codes: 0 = checked-out tree matches the current merge ref content
//             1 = stale checkout or unusable environment (job must fail)
//             2 = usage error
//
// Runs on the CI checkout itself: node builtins and git only, no deps. The
// fetch targets refs/pull/<n>/merge exactly as actions/checkout does, which
// works unauthenticated on this public repository (and the job's checkout
// already proves the ref is readable).
//
// Design notes:
//  - --depth=1 keeps the fetch tiny: in the healthy case the current merge
//    commit is already the checked-out HEAD, so nothing is downloaded; in the
//    stale case the run is going to fail anyway.
//  - ls-tree -r needs only tree objects, which the fetch provides, so the
//    content probe never materializes the fetched tree into the worktree.
//  - GIT_TERMINAL_PROMPT=0 makes any credential failure loud and immediate
//    instead of a hang.

import { spawnSync } from "node:child_process";

const USAGE = `Usage:
  node scripts/check-merge-tree-freshness.mjs --pr <pull-request-number> --head <40-hex-sha> [--repo <repo-path>] [--remote <remote-name>]`;

const TEST_FILE_RE = /\.test\.(tsx?|mjs)$/;

function parseArgs(argv) {
  const args = { pr: null, head: null, repo: process.cwd(), remote: "origin" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--pr") args.pr = value;
    else if (flag === "--head") args.head = value;
    else if (flag === "--repo") args.repo = value;
    else if (flag === "--remote") args.remote = value;
    else if (flag === "--help" || flag === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`unknown argument: ${flag}`);
      console.error(USAGE);
      process.exit(2);
    }
    i += 1;
  }
  if (!args.pr || !/^\d+$/.test(String(args.pr))) {
    console.error("missing or invalid --pr <pull-request-number>");
    console.error(USAGE);
    process.exit(2);
  }
  if (!args.head || !/^[0-9a-f]{40}$/i.test(String(args.head))) {
    console.error("missing or invalid --head <40-hex sha>");
    console.error(USAGE);
    process.exit(2);
  }
  return args;
}

function git(repo, args) {
  const res = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (res.error) {
    throw new Error(`cannot run git ${args.join(" ")}: ${res.error.message}`);
  }
  return {
    status: res.status,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim(),
  };
}

function requireGit(repo, args, what) {
  const res = git(repo, args);
  if (res.status !== 0) {
    console.error(`::error::cannot ${what} in ${repo}`);
    console.error(res.stderr || res.stdout);
    process.exit(1);
  }
  return res;
}

function testFileCount(files) {
  return files.filter((file) => TEST_FILE_RE.test(file)).length;
}

function main() {
  const { pr, head, repo, remote } = parseArgs(process.argv.slice(2));

  // 1. Sanity: the repo is a work tree with a checked-out HEAD.
  const inside = git(repo, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0) {
    console.error(`::error::${repo} is not a git work tree (cave-d9xfq guard cannot verify the checkout)`);
    process.exit(1);
  }
  const headSha = requireGit(repo, ["rev-parse", "HEAD"], "resolve HEAD");
  const checkedOutTree = requireGit(repo, ["rev-parse", "HEAD^{tree}"], "resolve the checked-out tree");
  const checkedOutTreeHash = checkedOutTree.stdout;

  // 2. Fetch the CURRENT merge ref fresh, at job time. A fetch that fails
  //    (ref gone, PR closed mid-run, credentials) means the tree cannot be
  //    verified — refuse to trust it.
  const mergeRef = `refs/pull/${pr}/merge`;
  const freshRef = "refs/ci/merge-freshness/merge";
  // Force refspec: the local freshness ref must be able to move from an
  // older merge commit to the current one (the stale case) — the same `+`
  // prefix actions/checkout uses for its own refs/pull fetch.
  const fetchRes = git(repo, ["fetch", "--depth=1", "--no-tags", remote, `+${mergeRef}:${freshRef}`]);
  if (fetchRes.status !== 0) {
    console.error(
      `::error::cannot fetch the CURRENT ${mergeRef} (fetched at job time) — the checked-out tree cannot be verified against it (cave-d9xfq). The PR may have been closed or the ref removed mid-run. Refusing to trust the checkout.`,
    );
    console.error(fetchRes.stderr || fetchRes.stdout);
    process.exit(1);
  }

  // 3. Resolve the fresh merge tree.
  const freshTree = requireGit(repo, ["rev-parse", `${freshRef}^{tree}`], `resolve the tree of ${mergeRef}`);
  const freshTreeHash = freshTree.stdout;

  // 4. Content probe: file sets of both trees.
  const checkedOutFiles = requireGit(repo, ["ls-tree", "-r", "--name-only", "HEAD"], "list the checked-out tree");
  const freshFiles = requireGit(repo, ["ls-tree", "-r", "--name-only", freshRef], `list the ${mergeRef} tree`);
  const checkedOutList = checkedOutFiles.stdout.split("\n").filter(Boolean);
  const freshList = freshFiles.stdout.split("\n").filter(Boolean);
  const checkedOutSet = new Set(checkedOutList);
  const missing = freshList.filter((file) => !checkedOutSet.has(file));
  const missingTests = missing.filter((file) => TEST_FILE_RE.test(file));

  // 5. Diagnostic: does the live head ref still match the event's head sha?
  //    Informational only — the verdict is content. If the PR was pushed while
  //    this run was in flight, the merge ref moved and any mismatch below is
  //    explained by that.
  let headNote = "head ref check skipped";
  const lsRemote = git(repo, ["ls-remote", remote, `refs/pull/${pr}/head`]);
  if (lsRemote.status === 0 && lsRemote.stdout) {
    const [refSha] = lsRemote.stdout.split(/\s+/);
    if (refSha) {
      headNote =
        refSha.toLowerCase() === head.toLowerCase()
          ? `refs/pull/${pr}/head is the event head (${head.slice(0, 12)})`
          : `refs/pull/${pr}/head moved during the run: event head ${head.slice(0, 12)} vs current ${refSha.slice(0, 12)} — the merge ref was refreshed, which is the likely cause of any mismatch below`;
    }
  }

  const treeMatches = checkedOutTreeHash === freshTreeHash;
  const probePasses = missing.length === 0;

  console.log(`Checked-out HEAD:  ${headSha.stdout.slice(0, 12)}  tree ${checkedOutTreeHash}`);
  console.log(`Current ${mergeRef}: tree ${freshTreeHash} (fetched at job time)`);
  console.log(`Files: checked-out ${checkedOutList.length} (${testFileCount(checkedOutList)} test), current merge tree ${freshList.length} (${testFileCount(freshList)} test)`);
  console.log(`${headNote}.`);

  if (!treeMatches || !probePasses) {
    if (!treeMatches) {
      console.error(
        `::error::STALE MERGE-TREE CHECKOUT (cave-d9xfq): the checked-out tree ${checkedOutTreeHash} does not match the current ${mergeRef} tree ${freshTreeHash} fetched at job time. This run is testing code that is not the PR's current merge — its verdict must not be trusted.`,
      );
    }
    if (!probePasses) {
      const missingSource = missingTests.length ? missingTests : missing;
      const examples = missingSource.slice(0, 5);
      console.error(
        `::error::STALE MERGE-TREE CHECKOUT (cave-d9xfq): the checked-out tree is missing ${missing.length} file(s) present in the current ${mergeRef} tree (${missingTests.length} of them test files). A tree that predates the code under test trivially lacks its files, which is exactly what a stale checkout looks like. Missing, e.g.: ${examples.join(", ")}${missingSource.length > 5 ? ", ..." : ""}`,
      );
    }
    process.exit(1);
  }

  console.log(
    `OK: the checked-out tree matches the current ${mergeRef} content — ${freshList.length} files, ${testFileCount(freshList)} test files.`,
  );
  process.exit(0);
}

main();
