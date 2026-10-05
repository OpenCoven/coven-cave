// @ts-nocheck
/**
 * The project-file route's read and save against real files (#5795):
 *  - a `.env` file is redacted, and refused for saving, by any spelling of its
 *    name; `.ENV` opened the same file on APFS and returned its secrets;
 *  - a save whose content is already on disk succeeds whatever version it
 *    names, so a save that timed out but landed can settle;
 *  - a save drops the desk's kept change list, so the refresh after it is new.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "project-file-behaviour-")));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const workspace = path.join(scratch, "workspace");
mkdirSync(workspace);
process.env.WORKSPACE_ROOT = workspace;
process.env.COVEN_HOME = path.join(scratch, "coven-home");
process.env.COVEN_CAVE_HOME = path.join(scratch, "coven-home", "cave");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(scratch, "no-projects.json");
process.env.GIT_CONFIG_GLOBAL = path.join(scratch, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
writeFileSync(process.env.GIT_CONFIG_GLOBAL, "[user]\n\tname = Test\n\temail = test@example.com\n");

const { projectFileResult, projectFileVersion, projectFileWrite } = await import("./route.ts");

// ── 1. `.env` by any spelling of its name ──────────────────────────────────
{
  const dir = path.join(workspace, "env-names");
  mkdirSync(dir);
  for (const name of [".ENV", ".Env", ".ENV.txt"]) {
    writeFileSync(path.join(dir, name), "API_KEY=supersecret\n");
    const read = projectFileResult(path.join(dir, name));
    assert.equal(read.status, 200, `${name}: ${JSON.stringify(read.body)}`);
    assert.doesNotMatch(read.body.content, /supersecret/, `${name}: redacted`);
    const save = await projectFileWrite(path.join(dir, name), "API_KEY=overwritten\n");
    assert.equal(save.status, 403, `${name}: ${JSON.stringify(save.body)}`);
    assert.equal(readFileSync(path.join(dir, name), "utf8"), "API_KEY=supersecret\n", `${name}: not written`);
    rmSync(path.join(dir, name));
  }
  writeFileSync(path.join(dir, "env.txt"), "not a dotenv\n");
  assert.equal(projectFileResult(path.join(dir, "env.txt")).body.content, "not a dotenv\n", "other names read as they are");
}

// ── 2. A save that's already on disk settles (#5795) ───────────────────────
// The client's save timed out but landed; resending it, or settling it, named
// the version from before it, and got "file changed on disk".
{
  const dir = path.join(workspace, "saves");
  mkdirSync(dir);
  const file = path.join(dir, "notes.md");
  writeFileSync(file, "one\n");
  const before = projectFileVersion("one\n");
  const first = await projectFileWrite(file, "two\n", before);
  assert.equal(first.status, 200);
  const mtime = statSync(file).mtimeMs;
  const resent = await projectFileWrite(file, "two\n", before);
  assert.equal(resent.status, 200, JSON.stringify(resent.body));
  assert.equal(resent.body.version, projectFileVersion("two\n"));
  assert.equal(statSync(file).mtimeMs, mtime, "nothing was written");
  const conflicting = await projectFileWrite(file, "three\n", before);
  assert.equal(conflicting.status, 409, "different content from an old version is still a conflict");
  assert.equal(conflicting.body.conflict, true);
  assert.equal(readFileSync(file, "utf8"), "two\n");
}

// ── 3. A save drops the desk's kept change list (#5795) ────────────────────
{
  const { GET } = await import("../changes/route.ts");
  const { NextRequest } = await import("next/server");
  const dir = path.join(workspace, "repo");
  mkdirSync(dir);
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "a.txt"), "base\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const listed = async () =>
    (await (await GET(new NextRequest(`http://127.0.0.1/api/changes?${new URLSearchParams({ projectRoot: dir })}`))).json()).files.map((f) => f.path);
  assert.deepEqual(await listed(), []);
  const save = await projectFileWrite(path.join(dir, "a.txt"), "saved from the desk\n");
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.deepEqual(await listed(), ["a.txt"], "the refresh after the save lists it");
}

console.log("project-file route behaviour: ok");
