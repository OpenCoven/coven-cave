// cave-7g7py: the hook installer must not disable hooks it does not own.
//
// core.hooksPath is a SINGLE directory, so pointing it somewhere new silently
// disables every hook in the old place. The installer keeps an existing
// directory and only warns about guards missing from it, but replaces a
// configured directory that no longer exists (the removed .beads/hooks).
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  cpSync(installer, join(dir, "scripts", "install-git-hooks.sh"));
  for (const hook of ["pre-commit", "commit-msg"]) {
    writeFileSync(join(dir, "scripts", "git-hooks", hook), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  }
  return dir;
}

function runInstaller(dir, ...args) {
  return execFileSync("bash", [join(dir, "scripts", "install-git-hooks.sh"), ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** stdout and stderr together, for warnings the installer prints on success. */
function runInstallerCombined(dir) {
  return execFileSync("bash", ["-c", `bash "${dir}/scripts/install-git-hooks.sh" 2>&1`], {
    cwd: dir, encoding: "utf8",
  });
}

function customHooks(dir, name, hooks, mode = 0o755) {
  mkdirSync(join(dir, name), { recursive: true });
  for (const hook of hooks) {
    writeFileSync(join(dir, name, hook), "#!/usr/bin/env bash\nexit 0\n", { mode });
  }
}

test("an existing hooksPath is PRESERVED, not overwritten", () => {
  const dir = scaffold();
  try {
    customHooks(dir, "custom-hooks", ["pre-commit", "commit-msg", "post-merge", "pre-push"]);
    git(dir, "config", "core.hooksPath", "custom-hooks");

    const out = runInstaller(dir);
    assert.equal(
      git(dir, "config", "--get", "core.hooksPath"),
      "custom-hooks",
      "the installer must not hijack a hooksPath that already points somewhere",
    );
    assert.match(out, /KEEP core\.hooksPath/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an ABSOLUTE hooksPath is recognised, not clobbered", () => {
  const dir = scaffold();
  try {
    customHooks(dir, "custom-hooks", ["pre-commit", "commit-msg"]);
    const absolute = join(dir, "custom-hooks");
    git(dir, "config", "core.hooksPath", absolute);

    runInstaller(dir);
    assert.equal(git(dir, "config", "--get", "core.hooksPath"), absolute);
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

test("a configured hook directory that no longer exists is replaced", () => {
  // Clones configured by Beads point at .beads/hooks, which left the tree.
  // A missing directory runs no hooks, so there is nothing to preserve.
  for (const configured of [".beads/hooks", "ABSOLUTE"]) {
    const dir = scaffold();
    try {
      const value = configured === "ABSOLUTE" ? join(dir, ".beads", "hooks") : configured;
      git(dir, "config", "core.hooksPath", value);
      assert.match(runInstaller(dir), /OK core\.hooksPath -> scripts\/git-hooks/);
      assert.equal(git(dir, "config", "--get", "core.hooksPath"), "scripts/git-hooks");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("a stale Beads merge-driver section is removed, and nothing else", () => {
  const dir = scaffold();
  try {
    git(dir, "config", "merge.beads-jsonl.name", "union .beads/interactions.jsonl by record id");
    git(dir, "config", "merge.beads-jsonl.driver", "node scripts/beads-jsonl-merge-driver.mjs %O %A %B");
    git(dir, "config", "merge.other.driver", "true");

    assert.match(runInstaller(dir), /REMOVED stale merge\.beads-jsonl/);
    assert.throws(() => git(dir, "config", "--get-regexp", "^merge\\.beads-jsonl\\."));
    assert.equal(git(dir, "config", "--get", "merge.other.driver"), "true");
    assert.doesNotMatch(runInstaller(dir), /REMOVED/, "a second run has nothing to remove");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("arguments are refused before any config change", () => {
  const dir = scaffold();
  try {
    for (const arg of ["--retire-beads", "--anything"]) {
      assert.throws(() => runInstaller(dir, arg), /usage/);
    }
    assert.throws(() => git(dir, "config", "--get", "core.hooksPath"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a preserved hook directory missing a guard WARNS rather than passing silently", () => {
  const dir = scaffold();
  try {
    customHooks(dir, "custom-hooks", ["pre-commit"]);
    git(dir, "config", "core.hooksPath", "custom-hooks");
    assert.match(runInstallerCombined(dir), /WARNING missing hook\(s\): commit-msg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a PRESENT but NON-EXECUTABLE hook warns — git will not run it", () => {
  // git only runs an executable hook, so an existence check alone would call
  // this fine while the guard stays dead. The installer does not own this
  // directory, so it must warn rather than chmod it.
  const dir = scaffold();
  try {
    customHooks(dir, "custom-hooks", ["pre-commit", "commit-msg"], 0o644);
    git(dir, "config", "core.hooksPath", "custom-hooks");
    const combined = runInstallerCombined(dir);
    assert.match(combined, /WARNING non-executable hook\(s\):/);
    assert.doesNotMatch(combined, /WARNING missing hook/, "it is present — not missing");
    assert.equal(git(dir, "config", "--get", "core.hooksPath"), "custom-hooks", "and still preserved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
