// @ts-nocheck
/**
 * The editor's save and the changes route share one lock key (#5781): the
 * git toplevel. The save used the allow-listed project root, which differs
 * for a project inside a larger repository, and a save could land mid-restore.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repositoryLockKey } from "./repository-lock-key.ts";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "repo-lock-key-")));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

const repo = path.join(scratch, "repo");
mkdirSync(path.join(repo, "packages", "app", "src"), { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
writeFileSync(path.join(repo, "packages", "app", "src", "a.ts"), "a\n");
const project = path.join(repo, "packages", "app");

// A file in a project folder inside the repo: the toplevel, not the project.
assert.equal(await repositoryLockKey(path.join(project, "src", "a.ts"), project), repo);
// A file that doesn't exist yet, in folders that don't either.
assert.equal(await repositoryLockKey(path.join(project, "src", "new", "deep", "b.ts"), project), repo);
// A linked worktree is its own toplevel, as the changes route sees it.
execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@e.x", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
const linked = path.join(scratch, "linked");
execFileSync("git", ["worktree", "add", "-q", linked], { cwd: repo });
assert.equal(await repositoryLockKey(path.join(linked, "x.ts"), linked), linked);
// Outside any repository: the fallback.
const loose = path.join(scratch, "loose");
mkdirSync(loose);
assert.equal(await repositoryLockKey(path.join(loose, "c.ts"), loose), loose);

console.log("repository-lock-key: ok");
