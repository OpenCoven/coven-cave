// cave-k9hom: .beads/hooks/pre-commit delegates instead of duplicating.
//
// The secret scanner used to exist twice — 128 duplicated lines shared with
// scripts/git-hooks/pre-commit, kept in step by nothing. Only one hook
// directory runs (core.hooksPath is a single directory), so the copy not on
// the path silently does nothing and a fix applied to it looks installed while
// being dead. The same shape already produced a live gap: .beads/hooks had no
// commit-msg, so the attribution guard never ran until #4243.
//
// These drive a real repository and real commits, because the only property
// that matters is whether git actually blocks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Returns {ok, output} for a commit attempt — never throws. */
function commit(dir, message) {
  try {
    const out = execFileSync("git", ["-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "-m", message],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output: out };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), "beads-shim-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "commit.gpgsign", "false");
  mkdirSync(join(dir, ".beads", "hooks"), { recursive: true });
  mkdirSync(join(dir, "scripts", "git-hooks"), { recursive: true });
  // NB: cpSync's `mode` option is copy FLAGS (0-7), not file permissions —
  // passing 0o755 there throws ERR_OUT_OF_RANGE. chmod after copying instead,
  // and it must be 0o755: git silently skips a hook that is not executable.
  cpSync(join(repoRoot, ".beads/hooks/pre-commit"), join(dir, ".beads/hooks/pre-commit"));
  cpSync(join(repoRoot, "scripts/git-hooks/pre-commit"), join(dir, "scripts/git-hooks/pre-commit"));
  chmodSync(join(dir, ".beads/hooks/pre-commit"), 0o755);
  chmodSync(join(dir, "scripts/git-hooks/pre-commit"), 0o755);
  cpSync(join(repoRoot, "scripts/check-beads-jsonl-duplicates.mjs"),
         join(dir, "scripts/check-beads-jsonl-duplicates.mjs"));
  git(dir, "config", "core.hooksPath", ".beads/hooks");
  return dir;
}

test("the shim does not duplicate the scanner — it delegates", () => {
  const shim = readFileSync(join(repoRoot, ".beads/hooks/pre-commit"), "utf8");
  const canonical = readFileSync(join(repoRoot, "scripts/git-hooks/pre-commit"), "utf8");
  assert.match(shim, /scripts\/git-hooks\/pre-commit/, "must reference the canonical scanner");
  // The scanner's own machinery must NOT be copied back in.
  for (const marker of ["BLOCK_PATH_RE", "Inline secret scan over the staged diff"]) {
    assert.ok(canonical.includes(marker), `sanity: canonical owns ${marker}`);
    assert.ok(!shim.includes(marker), `${marker} must live in ONE place, not be duplicated`);
  }
});

test("the bd-managed block survives untouched", () => {
  // bd regenerates between its markers; anything hand-added must sit outside.
  const shim = readFileSync(join(repoRoot, ".beads/hooks/pre-commit"), "utf8");
  assert.match(shim, /# --- BEGIN BEADS INTEGRATION/, "bd's markers must remain");
  assert.match(shim, /# --- END BEADS INTEGRATION/);
  const guardAt = shim.indexOf("cave-1poit");
  const beadsAt = shim.indexOf("BEGIN BEADS INTEGRATION");
  assert.ok(guardAt >= 0 && guardAt < beadsAt,
    "the duplicate-id guard must sit BEFORE bd's block, or a bd regen can drop it");
});

test("a clean commit is allowed", () => {
  const dir = scaffold();
  try {
    writeFileSync(join(dir, "ok.txt"), "hello\n");
    git(dir, "add", "-A");
    assert.equal(commit(dir, "clean").ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("delegation is real: secret-shaped content is still blocked", () => {
  // If the shim stopped reaching the canonical scanner this passes silently,
  // which is exactly the failure being designed out.
  const dir = scaffold();
  try {
    // Assembled at RUNTIME, never written as a literal here: the repo's own
    // pre-commit scanner refuses a staged diff containing a secret-shaped
    // string, so spelling it out would make this very file uncommittable. It
    // blocked exactly that on the first attempt.
    const shaped = ["aws_secret_access_key = \"wJalrXUtnFEMI",
                    "K7MDENG", "bPxRfiCYEXAMPLEKEY\""].join("/");
    writeFileSync(join(dir, "leak.txt"), `${shaped}\n`);
    git(dir, "add", "-A");
    assert.equal(commit(dir, "leak").ok, false, "the secret scanner must still run through the shim");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the duplicate-id guard still blocks, and names the bead", () => {
  const dir = scaffold();
  try {
    writeFileSync(join(dir, ".beads/interactions.jsonl"), '{"id":"a"}\n{"id":"a"}\n');
    git(dir, "add", "-A");
    const res = commit(dir, "dupes");
    assert.equal(res.ok, false, "duplicate ids must block");
    assert.match(res.output, /cave-1poit/, "and point at the bead explaining why");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the duplicate-id guard works when invoked with a FOREIGN cwd", () => {
  // The checker resolves .beads/ from process.cwd(), so a hook inherited with
  // a different cwd would scan the wrong directory — and finding no files
  // looks identical to finding no duplicates.
  //
  // git itself always hands pre-commit the worktree toplevel (measured), so
  // this is not reachable via `git commit`. It IS reachable by any other
  // caller that invokes the hook directly, which is why the hook pins its own
  // cwd rather than trusting the one it is given.
  const dir = scaffold();
  try {
    mkdirSync(join(dir, "sub", "deeper"), { recursive: true });
    writeFileSync(join(dir, ".beads/interactions.jsonl"), '{"id":"a"}\n{"id":"a"}\n');
    git(dir, "add", "-A");
    let blocked = false;
    let output = "";
    try {
      output = execFileSync("bash", [join(dir, ".beads/hooks/pre-commit")], {
        cwd: join(dir, "sub", "deeper"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      blocked = true;
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
    assert.equal(blocked, true, "duplicates must still be caught from a foreign cwd");
    assert.match(output, /cave-1poit/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a missing canonical scanner BLOCKS rather than passing silently", () => {
  const dir = scaffold();
  try {
    rmSync(join(dir, "scripts/git-hooks/pre-commit"));
    writeFileSync(join(dir, "y.txt"), "x\n");
    git(dir, "add", "-A");
    const res = commit(dir, "no scanner");
    assert.equal(res.ok, false, "a scanner that cannot run must not be treated as finding nothing");
    assert.match(res.output, /missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
