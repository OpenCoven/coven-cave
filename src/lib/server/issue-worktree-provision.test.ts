import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const exec = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "cave-repo-root-"));
const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
process.env.WORKSPACE_ROOT = root;

const { resolveRepoRoot } = await import("./issue-worktree-provision.ts");

after(async () => {
  if (originalWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
  else process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
  await rm(root, { recursive: true, force: true });
});

async function makeRepo() {
  const repo = path.join(root, "repo");
  await mkdir(repo, { recursive: true });
  await exec("git", ["init"], { cwd: repo });
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
