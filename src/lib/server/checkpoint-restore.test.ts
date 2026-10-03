// @ts-nocheck
/**
 * Checkpoint restore against real repositories (#5756).
 *
 * Restoring used to run `git apply --3way`, which implies `--index` and
 * refused every path whose index and working tree differ, the normal state of
 * an agent's worktree. So undoing a revert failed and the file stayed
 * reverted. These cases run the real checkpoint and restore code on real
 * repositories.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCheckpointPatch, checkpointBaseOf, pathChunks, restoreCheckpointPatch } from "./checkpoint-restore.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "checkpoint-restore-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

let repoCount = 0;
function makeRepo(files) {
  const repo = path.join(scratch, `repo-${repoCount++}`);
  mkdirSync(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  for (const [rel, content] of Object.entries(files)) write(repo, rel, content);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return { repo, git };
}
function write(repo, rel, content) {
  const abs = path.join(repo, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
const read = (repo, rel) => (existsSync(path.join(repo, rel)) ? readFileSync(path.join(repo, rel), "utf8") : null);
const contain = (repo) => (rel) => {
  const abs = path.resolve(repo, rel);
  return abs.startsWith(repo + path.sep) ? abs : null;
};
async function checkpoint(repo) {
  const file = path.join(scratch, `checkpoint-${repoCount}-${Date.now()}-${Math.random()}.patch`);
  writeFileSync(file, await buildCheckpointPatch(repo, contain(repo)));
  return file;
}
async function restore(repo, file, beforeWrite = async () => "safety.patch") {
  return restoreCheckpointPatch(repo, file, { contain: contain(repo), beforeWrite });
}

// ── 1. Undoing a revert: the case that used to fail ─────────────────────────
{
  const { repo, git } = makeRepo({ "a.txt": "a1\n", "b.txt": "b1\n" });
  write(repo, "a.txt", "a2\n");
  write(repo, "b.txt", "b2\n");
  write(repo, "c.txt", "new\n"); // untracked
  const file = await checkpoint(repo);
  assert.ok(checkpointBaseOf(readFileSync(file, "utf8")), "a checkpoint records the commit it is against");
  git("checkout", "HEAD", "--", "a.txt"); // the rail's revert
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["a.txt"], "the reverted file comes back");
  assert.deepEqual(outcome.unchanged.sort(), ["b.txt", "c.txt"], "files already as the checkpoint has them are left");
  assert.deepEqual(outcome.kept, []);
  assert.equal(read(repo, "a.txt"), "a2\n");
  assert.equal(read(repo, "b.txt"), "b2\n");
  assert.equal(read(repo, "c.txt"), "new\n");
  assert.equal(git("diff", "--cached", "--name-only"), "", "the real index is never touched");
  assert.equal(outcome.safetyCheckpointPath, "safety.patch", "a restore that writes saves the state before it");
}

// ── 2. A file changed after the checkpoint is kept, never overwritten ───────
{
  const { repo, git } = makeRepo({ "a.txt": "a1\n", "b.txt": "b1\n" });
  write(repo, "a.txt", "a2\n");
  write(repo, "b.txt", "b2\n");
  const file = await checkpoint(repo);
  git("checkout", "HEAD", "--", "a.txt");
  write(repo, "b.txt", "b3, the agent's newer edit\n");
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["a.txt"]);
  assert.deepEqual(outcome.kept, ["b.txt"]);
  assert.equal(read(repo, "b.txt"), "b3, the agent's newer edit\n", "newer work survives a restore");
}

// ── 3. A deleted untracked file comes back; a snapshot deletion is redone ───
{
  const { repo } = makeRepo({ "keep.txt": "k\n", "gone.txt": "g\n" });
  write(repo, "notes/new.md", "draft\n");
  rmSync(path.join(repo, "gone.txt")); // deleted in the snapshot
  const file = await checkpoint(repo);
  rmSync(path.join(repo, "notes/new.md")); // the rail's revert of an untracked file
  execFileSync("git", ["checkout", "HEAD", "--", "gone.txt"], { cwd: repo }); // and of a deletion
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["gone.txt", "notes/new.md"]);
  assert.equal(read(repo, "notes/new.md"), "draft\n", "the untracked file is recreated, directory and all");
  assert.equal(read(repo, "gone.txt"), null, "the snapshot's deletion is redone");
}

// ── 4. HEAD moved after the checkpoint: rebuilt on the recorded base ────────
// The later commit changes the same file, so the patch no longer applies to
// the new HEAD; only the commit the checkpoint recorded can rebuild it.
{
  const { repo, git } = makeRepo({ "a.txt": "a1\n" });
  write(repo, "a.txt", "a2\n");
  const file = await checkpoint(repo);
  git("checkout", "HEAD", "--", "a.txt");
  write(repo, "a.txt", "a1, then committed\n");
  git("commit", "-q", "-am", "later");
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["a.txt"], "a file at the new HEAD's version is restored");
  assert.equal(read(repo, "a.txt"), "a2\n");
  assert.equal(git("log", "-1", "--format=%s").trim(), "later", "the commit itself is untouched");
}

// ── 5. Bracketed paths are paths, not patterns ──────────────────────────────
{
  const { repo, git } = makeRepo({ "app/[id]/page.tsx": "one\n", "app/i/page.tsx": "one\n" });
  write(repo, "app/[id]/page.tsx", "two\n");
  write(repo, "app/i/page.tsx", "two\n");
  const file = await checkpoint(repo);
  git("--literal-pathspecs", "checkout", "HEAD", "--", "app/[id]/page.tsx");
  write(repo, "app/i/page.tsx", "three\n");
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["app/[id]/page.tsx"]);
  assert.deepEqual(outcome.kept, ["app/i/page.tsx"]);
  assert.equal(read(repo, "app/[id]/page.tsx"), "two\n");
  assert.equal(read(repo, "app/i/page.tsx"), "three\n");
}

// ── 6. An older checkpoint without the header still restores ────────────────
{
  const { repo, git } = makeRepo({ "a.txt": "a1\n" });
  write(repo, "a.txt", "a2\n");
  const file = await checkpoint(repo);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^coven-cave checkpoint base [0-9a-f]+\n\n/, ""));
  assert.equal(checkpointBaseOf(readFileSync(file, "utf8")), null);
  git("checkout", "HEAD", "--", "a.txt");
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["a.txt"]);
  assert.equal(read(repo, "a.txt"), "a2\n");
}

// ── 7. Binary content round-trips ───────────────────────────────────────────
{
  const bytes = (seed) => Buffer.from(Array.from({ length: 256 }, (_, i) => (i * seed) % 256));
  const { repo, git } = makeRepo({ "logo.bin": bytes(3) });
  writeFileSync(path.join(repo, "logo.bin"), bytes(7));
  const file = await checkpoint(repo);
  git("checkout", "HEAD", "--", "logo.bin");
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["logo.bin"]);
  assert.ok(readFileSync(path.join(repo, "logo.bin")).equals(bytes(7)));
}

// ── 8. A mode-only change comes back (#5760 review) ─────────────────────────
if (process.platform !== "win32") {
  const { repo, git } = makeRepo({ "run.sh": "echo hi\n" });
  chmodSync(path.join(repo, "run.sh"), 0o755);
  const file = await checkpoint(repo);
  assert.match(readFileSync(file, "utf8"), /new mode 100755/, "the checkpoint records the chmod alone");
  git("checkout", "HEAD", "--", "run.sh");
  assert.equal(statSync(path.join(repo, "run.sh")).mode & 0o100, 0);
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["run.sh"]);
  assert.notEqual(statSync(path.join(repo, "run.sh")).mode & 0o100, 0, "the executable bit is back");
}

// ── 9. Nothing to do: no safety checkpoint, nothing written ─────────────────
{
  const { repo } = makeRepo({ "a.txt": "a1\n" });
  write(repo, "a.txt", "a2\n");
  const file = await checkpoint(repo);
  let calls = 0;
  const outcome = await restore(repo, file, async () => { calls += 1; return "unused"; });
  assert.deepEqual(outcome, { restored: [], unchanged: ["a.txt"], kept: [], safetyCheckpointPath: null });
  assert.equal(calls, 0, "a restore that writes nothing takes no safety checkpoint");

  const clean = makeRepo({ "a.txt": "a1\n" });
  const empty = await checkpoint(clean.repo);
  assert.deepEqual(await restore(clean.repo, empty), { restored: [], unchanged: [], kept: [], safetyCheckpointPath: null });
}

// ── 10. Before the first commit: staged files are in the checkpoint (#5781) ─
// It used to diff the working tree against the index, which left a staged new
// file out entirely (so reverting it deleted it for good) and stored a staged
// file's later edit against the index, which a restore can't rebuild.
function makeUnborn(files) {
  const repo = path.join(scratch, `repo-${repoCount++}`);
  mkdirSync(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  for (const [rel, content] of Object.entries(files)) write(repo, rel, content);
  git("add", "-A");
  return { repo, git };
}
const EMPTY_TREE = /^coven-cave checkpoint base [0-9a-f]+\n/;
{
  const { repo, git } = makeUnborn({ "src/app.ts": "app\n", "notes.md": "n1\n" });
  write(repo, "notes.md", "n2\n"); // staged, then edited
  const file = await checkpoint(repo);
  const text = readFileSync(file, "utf8");
  const emptyTree = execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], { cwd: repo, encoding: "utf8", input: "" }).trim();
  assert.match(text, EMPTY_TREE);
  assert.equal(checkpointBaseOf(text), emptyTree, "an unborn branch records the empty tree as its base");
  assert.match(text, /\+\+\+ b\/src\/app\.ts/, "the staged new file is in the checkpoint");
  // The desk's revert: with no commit, every listed file is new, and goes.
  git("rm", "-q", "-f", "--", "src/app.ts");
  git("rm", "-q", "-f", "--", "notes.md");
  assert.equal(read(repo, "src/app.ts"), null);
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["notes.md", "src/app.ts"]);
  assert.equal(read(repo, "src/app.ts"), "app\n", "the reverted new file comes back");
  assert.equal(read(repo, "notes.md"), "n2\n", "and the staged file's later edit");
}

// ── 11. A checkpoint from before the first commit still restores after it ──
{
  const { repo, git } = makeUnborn({ "a.txt": "a1\n" });
  write(repo, "a.txt", "a2\n");
  const file = await checkpoint(repo);
  git("checkout", "--", "a.txt");
  git("commit", "-q", "-m", "first");
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["a.txt"]);
  assert.equal(read(repo, "a.txt"), "a2\n");
}

// ── 12. The user's diff config doesn't reach the patch (#5781) ──────────────
// `color.ui=always` filled checkpoints with escape codes, so a restore found
// no `diff --git` line and reported nothing to restore; `diff.noprefix` left
// nothing for `git apply` to strip.
for (const [key, value] of [
  ["color.ui", "always"],
  ["color.diff", "always"],
  ["diff.noprefix", "true"],
  ["diff.mnemonicPrefix", "true"],
  ["diff.submodule", "diff"],
]) {
  const { repo, git } = makeRepo({ "a.txt": "a1\n" });
  git("config", key, value);
  write(repo, "a.txt", "a2\n");
  write(repo, "new.txt", "new\n");
  const file = await checkpoint(repo);
  const text = readFileSync(file, "utf8");
  assert.ok(!text.includes("\u001b["), `${key}=${value}: no escape codes`);
  assert.match(text, /^diff --git a\/a\.txt b\/a\.txt$/m, `${key}=${value}: standard headers`);
  git("checkout", "HEAD", "--", "a.txt");
  rmSync(path.join(repo, "new.txt"));
  const outcome = await restore(repo, file);
  assert.deepEqual(outcome.restored, ["a.txt", "new.txt"], `${key}=${value}: both come back`);
  assert.equal(read(repo, "a.txt"), "a2\n");
  assert.equal(read(repo, "new.txt"), "new\n");
}

// ── 13. A same-size edit from the second of the last index write (#5781) ───
// The checkpoint diffs over a copy of the index. A fresh copy's newer time
// made git trust the cached stat of a file rewritten, at the same size, in
// the same second as the index was last written, so the edit was missed.
{
  const { repo, git } = makeRepo({ "a.txt": "one\n" });
  git("update-index", "--refresh");
  write(repo, "a.txt", "two\n");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const text = readFileSync(await checkpoint(repo), "utf8");
  assert.match(text, /^-one$/m, "the checkpoint holds the edit");
  assert.match(text, /^\+two$/m);
}

// ── 14. Thousands of long paths restore, past the argument limit (#5781) ───
// Restore put every path on argv: about 10,000 files failed with E2BIG.
{
  const deep = ["a", "b", "c"].map((letter) => letter.repeat(200)).join("/");
  const files = {};
  for (let i = 0; i < 3000; i++) files[`${deep}/f-${i}-${"x".repeat(150)}.txt`] = `${i}\n`;
  const { repo, git } = makeRepo(files);
  for (const rel of Object.keys(files)) write(repo, rel, "edited\n");
  const file = await checkpoint(repo);
  git("checkout", "HEAD", "--", ".");
  const outcome = await restore(repo, file);
  assert.equal(outcome.restored.length, 3000, "every one comes back");
  assert.equal(read(repo, Object.keys(files)[2999]), "edited\n");
}
{
  const chunks = pathChunks(["a".repeat(60), "b".repeat(60), "c".repeat(60)], 130);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [2, 1], "chunks stay under their byte budget");
  assert.deepEqual(pathChunks(["x".repeat(500)], 100), [["x".repeat(500)]], "a path longer than the budget still goes, alone");
  assert.deepEqual(pathChunks([]), []);
}

console.log("checkpoint-restore: ok");
