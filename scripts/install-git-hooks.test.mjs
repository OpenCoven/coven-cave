// cave-7g7py: the hook installer must not disable hooks it does not own.
//
// The failure it guards against: core.hooksPath is a SINGLE directory, so
// pointing it somewhere new silently disables every hook in the old place.
// Clones point it at .beads/hooks, which holds strictly more than
// scripts/git-hooks — beads' lifecycle hooks plus the duplicate-id guard from
// #4231. The installer overwrote it unconditionally, so the script documented
// as the way to activate the duplicate-prevention merge driver removed the
// duplicate-detection hook at the same time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const installer = join(repoRoot, "scripts", "install-git-hooks.sh");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A throwaway clone carrying just the files the installer touches. */
function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), "hook-install-"));
  git(dir, "init", "-q", "-b", "main");
  mkdirSync(join(dir, "scripts", "git-hooks"), { recursive: true });
  mkdirSync(join(dir, ".beads", "hooks"), { recursive: true });
  cpSync(installer, join(dir, "scripts", "install-git-hooks.sh"));
  for (const hook of ["pre-commit", "commit-msg"]) {
    writeFileSync(join(dir, "scripts", "git-hooks", hook), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  }
  return dir;
}

function runInstaller(dir) {
  return execFileSync("bash", [join(dir, "scripts", "install-git-hooks.sh")], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("an existing hooksPath is PRESERVED, not overwritten", () => {
  const dir = scaffold();
  try {
    // Mirror the real clone: bd points hooksPath at .beads/hooks and puts its
    // own hooks there, including ones scripts/git-hooks has no copy of.
    for (const hook of ["pre-commit", "commit-msg", "post-merge", "pre-push"]) {
      writeFileSync(join(dir, ".beads", "hooks", hook), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    }
    git(dir, "config", "core.hooksPath", ".beads/hooks");

    const out = runInstaller(dir);
    assert.equal(
      git(dir, "config", "--get", "core.hooksPath"),
      ".beads/hooks",
      "the installer must not hijack a hooksPath that already points somewhere",
    );
    assert.match(out, /KEEP core\.hooksPath/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bd's ABSOLUTE hooksPath is recognised, not clobbered", () => {
  // The real clone stores an absolute path. A naive string compare against
  // ".beads/hooks" would miss it and overwrite the very thing being protected.
  const dir = scaffold();
  try {
    for (const hook of ["pre-commit", "commit-msg"]) {
      writeFileSync(join(dir, ".beads", "hooks", hook), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    }
    const absolute = join(dir, ".beads", "hooks");
    git(dir, "config", "core.hooksPath", absolute);

    runInstaller(dir);
    assert.equal(
      git(dir, "config", "--get", "core.hooksPath"),
      absolute,
      "an absolute hooksPath must be preserved too",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unset hooksPath is still installed", () => {
  const dir = scaffold();
  try {
    const out = runInstaller(dir);
    assert.equal(git(dir, "config", "--get", "core.hooksPath"), "scripts/git-hooks");
    assert.match(out, /OK core\.hooksPath/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a preserved hook directory missing a guard WARNS rather than passing silently", () => {
  // The live gap this bead found: .beads/hooks had no commit-msg, so the
  // contributor-attribution guard was not running and nothing said so.
  const dir = scaffold();
  try {
    writeFileSync(join(dir, ".beads", "hooks", "pre-commit"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    git(dir, "config", "core.hooksPath", ".beads/hooks");
    const proc = execFileSync("bash", [join(dir, "scripts", "install-git-hooks.sh")], {
      cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    // stderr is merged into the thrown output only on failure; capture both by
    // re-running with 2>&1 semantics via the shell.
    const combined = execFileSync("bash", ["-c", `bash "${dir}/scripts/install-git-hooks.sh" 2>&1`], {
      cwd: dir, encoding: "utf8",
    });
    assert.match(combined, /WARNING missing hook\(s\): commit-msg/, "a missing guard must be reported");
    assert.ok(proc.length >= 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the merge driver is registered regardless of the hook decision", () => {
  // The driver must never be collateral damage of the hooks branch — that
  // coupling is what made the original script unsafe to run at all.
  for (const preset of ["unset", "preserved"]) {
    const dir = scaffold();
    try {
      if (preset === "preserved") {
        for (const hook of ["pre-commit", "commit-msg"]) {
          writeFileSync(join(dir, ".beads", "hooks", hook), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
        }
        git(dir, "config", "core.hooksPath", ".beads/hooks");
      }
      runInstaller(dir);
      assert.equal(
        git(dir, "config", "--get", "merge.beads-jsonl.driver"),
        'node scripts/beads-jsonl-merge-driver.mjs "%O" "%A" "%B"',
        `driver must be registered when hooksPath is ${preset}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test(".beads/hooks carries a commit-msg shim so the attribution guard runs", () => {
  // core.hooksPath is one directory: without this file, scripts/git-hooks/
  // commit-msg never executes on a clone using the beads hook path.
  const shim = readFileSync(join(repoRoot, ".beads", "hooks", "commit-msg"), "utf8");
  assert.match(shim, /scripts\/git-hooks\/commit-msg/, "the shim must delegate rather than duplicate");
  assert.match(shim, /exit 1/, "a missing implementation must fail, not pass silently");
});
