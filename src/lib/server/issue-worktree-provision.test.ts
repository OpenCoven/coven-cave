import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const exec = promisify(execFile);
// Canonicalize the scratch root up front: macOS tmpdir() lives behind the
// /var → /private/var symlink, and the allow-list check compares realpath'd
// WORKSPACE_ROOT against candidates canonicalized via nearest-existing-ancestor
// walks. Seeding an already-canonical root keeps both sides identical even if
// a realpath call degrades (observed once locally as 403 path-not-allowed
// where the 404 branch was expected — cave-01mq). Same convention as
// project-paths.test.ts.
const root = await realpath(await mkdtemp(path.join(tmpdir(), "cave-repo-root-")));
const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
process.env.WORKSPACE_ROOT = root;

const { provisionBranchWorktree, resolveRepoRoot } = await import("./issue-worktree-provision.ts");

after(async () => {
  if (originalWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
  else process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
  await rm(root, { recursive: true, force: true });
});

async function makeRepo(name = "repo") {
  const repo = path.join(root, name);
  await mkdir(repo, { recursive: true });
  await exec("git", ["init", "-b", "main"], { cwd: repo });
  await writeFile(path.join(repo, "README.md"), "fixture\n");
  await exec("git", ["add", "README.md"], { cwd: repo });
  await exec("git", ["-c", "user.name=Cave Tests", "-c", "user.email=cave@example.invalid", "commit", "-m", "fixture"], { cwd: repo });
  return repo;
}

test("valid native repo and worktree roots resolve on every platform", async () => {
  const repo = await makeRepo();
  const worktree = path.join(repo, ".worktrees", "valid");
  await mkdir(path.dirname(worktree), { recursive: true });
  await exec("git", ["worktree", "add", "-b", "test/valid-root", worktree], { cwd: repo });

  assert.deepEqual(await resolveRepoRoot(repo), { ok: true, repoRoot: await realpath(repo) });
  assert.deepEqual(await resolveRepoRoot(worktree), { ok: true, repoRoot: await realpath(worktree) });
});

test("missing, non-repository, and relative roots return stable actionable 4xx results", async () => {
  const nonRepo = path.join(root, "not-a-repo");
  await mkdir(nonRepo, { recursive: true });
  assert.deepEqual(await resolveRepoRoot("relative/path"), {
    ok: false,
    status: 400,
    error: "projectRoot must be an absolute path",
  });
  assert.deepEqual(await resolveRepoRoot(path.join(root, "missing")), {
    ok: false,
    status: 404,
    error: "projectRoot does not exist",
  });
  assert.deepEqual(await resolveRepoRoot(nonRepo), {
    ok: false,
    status: 422,
    error: "not a git repository",
  });
});

test("provisionBranchWorktree creates once and reuses only on the SAME branch", async () => {
  const repo = await realpath(await makeRepo("provision-reuse"));

  const first = await provisionBranchWorktree(repo, "feat/chat-x");
  assert.ok(first.ok, `create failed: ${first.ok ? "" : first.error}`);
  assert.equal(first.created, true);
  assert.equal(first.branch, "feat/chat-x");
  const { stdout: head } = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: first.worktree });
  assert.equal(head.trim(), "feat/chat-x", "worktree HEAD is the requested branch");

  const again = await provisionBranchWorktree(repo, "feat/chat-x");
  assert.ok(again.ok);
  assert.equal(again.created, false, "same branch reuses the existing worktree");
  assert.equal(again.worktree, first.worktree);
});

// REGRESSION (cave-tmst): distinct branch names flatten to the same directory
// (`feat/chat-x` and `feat-chat-x` both live at `.worktrees/feat-chat-x`).
// Reuse keyed on path existence alone returned ok with the REQUESTED branch
// name while the worktree sat on the other branch — the chat opened claiming a
// branch it never checked out. Conflicts must be explicit.
test("provisionBranchWorktree rejects a directory collision with the actual branch named", async () => {
  const repo = await realpath(await makeRepo("provision-collide"));

  const first = await provisionBranchWorktree(repo, "feat/chat-y");
  assert.ok(first.ok);

  const collided = await provisionBranchWorktree(repo, "feat-chat-y");
  assert.ok(!collided.ok, "a different branch flattening to the same dir must not reuse");
  assert.equal(collided.status, 409);
  assert.match(collided.error, /feat\/chat-y/, "the conflict names the branch actually checked out");
});

// REGRESSION (cave-tmst): a worktree dir deleted with `rm -rf` stays
// registered in git until pruned. Path-presence reuse returned ok with a path
// that no longer existed, so the chat's first send failed with a dead cwd.
test("provisionBranchWorktree prunes a stale registration and recreates the worktree", async () => {
  const repo = await realpath(await makeRepo("provision-stale"));

  const first = await provisionBranchWorktree(repo, "feat/stale");
  assert.ok(first.ok);
  await rm(first.worktree, { recursive: true, force: true });

  const revived = await provisionBranchWorktree(repo, "feat/stale");
  assert.ok(revived.ok, `recreate failed: ${revived.ok ? "" : revived.error}`);
  assert.equal(revived.created, true, "a husk (git-listed, gone on disk) is pruned and recreated");
  assert.equal(revived.worktree, first.worktree);
  const { stdout: head } = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: revived.worktree });
  assert.equal(head.trim(), "feat/stale");
});

// REGRESSION (cave-tmst): new branches were cut from whatever origin/main the
// local clone last fetched — hours or days stale. Creation now does a bounded
// best-effort `git fetch origin main` first (silently skipped when offline or
// remote-less, as in the fixtures above).
test("provisionBranchWorktree branches new worktrees from a freshly fetched origin/main", async () => {
  const upstream = await makeRepo("provision-upstream");
  const clone = path.join(root, "provision-clone");
  await exec("git", ["clone", upstream, clone]);
  // Advance upstream AFTER the clone so the clone's origin/main snapshot is stale.
  await writeFile(path.join(upstream, "NEW.md"), "fresh\n");
  await exec("git", ["add", "NEW.md"], { cwd: upstream });
  await exec("git", ["-c", "user.name=Cave Tests", "-c", "user.email=cave@example.invalid", "commit", "-m", "fresh"], { cwd: upstream });
  const { stdout: upstreamTip } = await exec("git", ["rev-parse", "main"], { cwd: upstream });

  const created = await provisionBranchWorktree(await realpath(clone), "feat/from-fresh-main");
  assert.ok(created.ok, `create failed: ${created.ok ? "" : created.error}`);
  assert.equal(created.baseRef, "origin/main");
  const { stdout: worktreeTip } = await exec("git", ["rev-parse", "HEAD"], { cwd: created.worktree });
  assert.equal(worktreeTip.trim(), upstreamTip.trim(), "the new worktree starts at upstream's CURRENT tip");
});
