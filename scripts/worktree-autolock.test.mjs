import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  headShaOf,
  parseWorktrees,
  reasonFor,
  remoteTagCommits,
  riskOf,
} from "./worktree-autolock.mjs";

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

// Push a file's mtime past the index entry so git cannot classify a
// same-tick rewrite as unchanged. See the call site for why this matters.
function touchForward(file) {
  const ahead = new Date(Date.now() + 5_000);
  utimesSync(file, ahead, ahead);
}

// --- parsing ----------------------------------------------------------------
// `locked` appears bare or with a reason; both must register as locked.
{
  const records = parseWorktrees(
    [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/a",
      "HEAD def",
      "locked",
      "",
      "worktree /repo/.worktrees/b",
      "HEAD 123",
      "locked active work",
      "",
      "worktree /repo/.worktrees/c",
      "detached",
      "",
    ].join("\n"),
  );
  assert.equal(records.length, 4, "every worktree record is parsed");
  assert.equal(records[0].path, "/repo");
  assert.equal(records[1].locked, true, "a bare 'locked' line counts as locked");
  assert.equal(records[2].locked, true, "'locked <reason>' counts as locked");
  assert.equal(records[3].locked, false, "an unlocked worktree is not misread as locked");
}

// A path containing spaces must survive parsing — .worktrees paths are ours,
// but /private/tmp scratch worktrees are not always.
{
  const records = parseWorktrees("worktree /tmp/my worktree/a\nHEAD abc\n\n");
  assert.equal(records[0].path, "/tmp/my worktree/a", "paths with spaces are preserved");
}

// --- reason text ------------------------------------------------------------
{
  const both = reasonFor({ dirty: 3, unpushed: 2 }, "2026-08-03");
  assert.match(both, /3 uncommitted paths/);
  assert.match(both, /2 commits not on any remote/);
  assert.match(both, /git worktree unlock/, "the reason tells the owner how to clear it");
  const one = reasonFor({ dirty: 1, unpushed: 0 }, "2026-08-03");
  assert.match(one, /1 uncommitted path\b/, "singular is not mis-pluralised");
  assert.doesNotMatch(one, /commits not on any remote/, "zero counts are omitted");
}

// --- risk classification against real git repos ------------------------------
const scratch = mkdtempSync(path.join(tmpdir(), "autolock-"));
const git = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@e",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@e",
      // NUL on Windows — "/dev/null" does not exist there, and the
      // cross-environment CI legs run on windows-latest.
      GIT_CONFIG_GLOBAL: NULL_DEVICE,
      GIT_CONFIG_SYSTEM: NULL_DEVICE,
    },
  });

try {
  // An "origin" to push to, so "not on any remote" is a real distinction.
  const origin = path.join(scratch, "origin.git");
  git(["init", "--quiet", "--bare", "-b", "main", origin], scratch);

  const repo = path.join(scratch, "repo");
  git(["init", "--quiet", "-b", "main", repo], scratch);
  writeFileSync(path.join(repo, "seed.txt"), "seed\n");
  git(["add", "."], repo);
  git(["commit", "--quiet", "--no-gpg-sign", "-m", "seed"], repo);
  git(["remote", "add", "origin", origin], repo);
  git(["push", "--quiet", "origin", "main"], repo);

  // 1. clean and fully pushed → NOT at risk, so it is never locked.
  assert.equal(riskOf(repo), null, "a clean, fully pushed worktree is not locked");

  // 2. uncommitted edit → at risk (nothing else holds that content).
  //
  // Bump the mtime clear of the index entry. A file rewritten inside the same
  // filesystem-timestamp tick as the commit can be read as "racily clean", and
  // `riskOf` runs git with GIT_OPTIONAL_LOCKS=0 so the index is never refreshed
  // to settle it. Observed failing 1 run in 4 before this line existed.
  writeFileSync(path.join(repo, "seed.txt"), "edited\n");
  touchForward(path.join(repo, "seed.txt"));
  const dirty = riskOf(repo);
  assert.ok(dirty, "an uncommitted edit is at risk");
  assert.equal(dirty.dirty, 1);
  assert.equal(dirty.unpushed, 0);

  // 3. untracked file counts too — that is the unrecoverable case.
  git(["checkout", "--quiet", "--", "seed.txt"], repo);
  writeFileSync(path.join(repo, "brand-new.txt"), "never committed\n");
  const untracked = riskOf(repo);
  assert.ok(untracked, "an untracked file is at risk");
  assert.equal(untracked.dirty, 1);
  rmSync(path.join(repo, "brand-new.txt"));

  // 4. committed but unpushed → at risk until a remote holds it.
  writeFileSync(path.join(repo, "seed.txt"), "committed locally\n");
  git(["commit", "--quiet", "--no-gpg-sign", "-am", "local only"], repo);
  const unpushed = riskOf(repo);
  assert.ok(unpushed, "a commit absent from every remote is at risk");
  assert.equal(unpushed.dirty, 0);
  assert.equal(unpushed.unpushed, 1);

  // 5. once pushed, the same worktree stops being at risk — the branch and its
  //    commits outlive a removal, so locking it would be pure friction.
  git(["push", "--quiet", "origin", "main"], repo);
  assert.equal(riskOf(repo), null, "pushing clears the risk");

  // 6. an unreadable path yields null rather than throwing into the hook.
  assert.equal(riskOf(path.join(scratch, "does-not-exist")), null, "missing paths are skipped");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// --- the hook actually FIRES when invoked the way a hook is invoked ----------
// Regression for the naive `import.meta.url === \`file://${process.argv[1]}\``
// direct-run check. It fails on percent-encoding (a path with a space) and on
// symlinks (macOS /tmp -> /private/tmp), and the symptom is silence: the hook
// exits 0 having locked nothing, so worktrees look protected while they are
// not. Both cases are exercised here at once.
{
  const box = mkdtempSync(path.join(tmpdir(), "autolock-run-"));
  try {
    const spaced = path.join(box, "dir with space");
    mkdirSync(spaced);
    const script = path.join(spaced, "worktree-autolock.mjs");
    copyFileSync(fileURLToPath(new URL("./worktree-autolock.mjs", import.meta.url)), script);

    // Reach the script through a symlink so argv[1] and import.meta.url differ.
    const linked = path.join(box, "link");
    symlinkSync(spaced, linked);
    const viaSymlink = path.join(linked, "worktree-autolock.mjs");

    const repo = path.join(box, "repo");
    execFileSync("git", ["init", "--quiet", "-b", "main", repo], { cwd: box });
    execFileSync("git", ["commit", "--quiet", "--allow-empty", "--no-gpg-sign", "-m", "seed"], {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@e",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@e",
        GIT_CONFIG_GLOBAL: NULL_DEVICE,
        GIT_CONFIG_SYSTEM: NULL_DEVICE,
      },
    });
    execFileSync("git", ["worktree", "add", "--quiet", "-b", "risky", path.join(repo, "wt")], {
      cwd: repo,
    });
    writeFileSync(path.join(repo, "wt", "unsaved.txt"), "would be lost\n");

    execFileSync(process.execPath, [viaSymlink], {
      cwd: repo,
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });

    const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repo,
      encoding: "utf8",
    });
    const wt = parseWorktrees(porcelain).find((w) => w.path.endsWith("wt"));
    assert.ok(wt, "the worktree is still registered");
    assert.equal(
      wt.locked,
      true,
      "the hook must fire and lock when run through a symlinked path containing a space",
    );
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
}

// --- a pushed tag is retention, exactly as the guard counts it ---------------
// cave-qbr34. `--remotes` is remote-tracking BRANCHES; git keeps no
// remote-tracking refs for tags. So a branch retired the RECOMMENDED way —
// archived as a pushed tag, then deleted — read as unretained and was re-locked
// on every tool call, which is what defeated two `beads:worktrees:apply` runs.
{
  const scratch = mkdtempSync(path.join(tmpdir(), "autolock-tag-"));
  try {
    const origin = path.join(scratch, "origin.git");
    git(["init", "--quiet", "--bare", "-b", "main", origin], scratch);

    const repo = path.join(scratch, "repo");
    git(["init", "--quiet", "-b", "main", repo], scratch);
    writeFileSync(path.join(repo, "seed.txt"), "seed\n");
    git(["add", "."], repo);
    git(["commit", "--quiet", "--no-gpg-sign", "-m", "seed"], repo);
    git(["remote", "add", "origin", origin], repo);
    git(["push", "--quiet", "origin", "main"], repo);

    git(["checkout", "--quiet", "-b", "fix/archived"], repo);
    writeFileSync(path.join(repo, "work.txt"), "shipped\n");
    git(["add", "."], repo);
    git(["commit", "--quiet", "--no-gpg-sign", "-m", "work"], repo);
    git(["push", "--quiet", "origin", "fix/archived"], repo);
    const head = git(["rev-parse", "HEAD"], repo).trim();

    // Retire it the way the docs prescribe: archive tag pushed, branch deleted.
    git(["tag", "-a", "archive/fix-archived-2026-08-12", "-m", "archive", head], repo);
    git(["push", "--quiet", "origin", "archive/fix-archived-2026-08-12"], repo);
    git(["push", "--quiet", "origin", "--delete", "fix/archived"], repo);
    git(["fetch", "--quiet", "--prune", "origin"], repo);

    // Precondition: the branch-only test still calls this unretained. If this
    // ever stops holding, the bug is gone for another reason and the assertion
    // below would be passing vacuously.
    const branchOnly = riskOf(repo);
    assert.ok(branchOnly, "precondition: --remotes alone calls a tag-archived head unretained");
    assert.equal(branchOnly.unpushed, 1);

    // The real lookup, against real `ls-remote` output — the parsing is where
    // this class of bug lives, so a stub alone would not prove much.
    const live = remoteTagCommits(repo);
    assert.ok(live instanceof Set, "the remote answered");
    assert.equal(headShaOf(repo), head);
    assert.ok(live.has(head), "ls-remote's peeled ^{} line puts the commit oid in the set");
    assert.equal(
      riskOf(repo, (p) => {
        const oids = remoteTagCommits(p);
        const h = headShaOf(p);
        return Boolean(oids && h && oids.has(h));
      }),
      null,
      "wired end to end, a tag-archived head is not locked",
    );

    // The fix: a tag the REMOTE actually has counts as retention.
    const remoteTags = new Set([head]);
    assert.equal(
      riskOf(repo, () => remoteTags.has(head)),
      null,
      "a head held by a pushed tag is retained, so the hook must not lock it",
    );

    // A LOCAL-only tag must NOT count — it dies with the checkout, which is the
    // hole the guard exists to close, and is why `--tags` is the wrong fix.
    git(["tag", "-a", "archive/local-only", "-m", "local", head], repo);
    const localOnly = riskOf(repo, () => false);
    assert.ok(localOnly, "a local-only tag is not retention");
    assert.equal(localOnly.unpushed, 1);

    // An unreachable remote must fail CLOSED: still locked. A lock is
    // reversible; "retained" is the verdict that permits destruction.
    rmSync(origin, { recursive: true, force: true });
    assert.ok(
      riskOf(repo, (p) => {
        const oids = remoteTagCommits(p);
        const h = headShaOf(p);
        return Boolean(oids && h && oids.has(h));
      }),
      "an unanswerable remote leaves the tree locked rather than declaring it safe",
    );

    // Dirtiness is still decisive even when the head is tag-retained: the
    // uncommitted content exists nowhere else.
    writeFileSync(path.join(repo, "seed.txt"), "edited\n");
    touchForward(path.join(repo, "seed.txt"));
    const dirtyButRetained = riskOf(repo, () => remoteTags.has(head));
    assert.ok(dirtyButRetained, "uncommitted work is at risk regardless of tag retention");
    assert.equal(dirtyButRetained.dirty, 1);
    assert.equal(dirtyButRetained.unpushed, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log("worktree-autolock.test.mjs: ok");
