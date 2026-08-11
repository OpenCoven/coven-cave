import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "worktree-session-exit-retirement.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), "wt-exit-retire-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "seed");
  return dir;
}

function run(dir) {
  return execFileSync("node", [script], { cwd: dir, encoding: "utf8" });
}

test("retires a clean worktree already merged into main and its local branch", () => {
  const dir = scaffold();
  try {
    const worktree = join(dir, "wt-safe");
    git(dir, "worktree", "add", "-q", "-b", "feat/safe", worktree, "main");

    assert.match(run(dir), /Retired: 1/);
    assert.equal(existsSync(worktree), false);
    assert.throws(() => git(dir, "rev-parse", "--verify", "feat/safe"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retains dirty, unmerged, and primary worktrees", () => {
  const dir = scaffold();
  try {
    const dirty = join(dir, "wt-dirty");
    const live = join(dir, "wt-live");
    git(dir, "worktree", "add", "-q", "-b", "feat/dirty", dirty, "main");
    writeFileSync(join(dirty, "draft.txt"), "keep\n");
    git(dir, "worktree", "add", "-q", "-b", "feat/live", live, "main");
    git(live, "commit", "-qm", "ahead", "--allow-empty");

    assert.match(run(dir), /Retired: 0/);
    assert.equal(existsSync(dir), true);
    assert.equal(existsSync(dirty), true);
    assert.equal(existsSync(live), true);
    assert.equal(git(dir, "branch", "--show-current"), "main");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unlocks and retires a safe locked worktree", () => {
  const dir = scaffold();
  try {
    const worktree = join(dir, "wt-locked");
    git(dir, "worktree", "add", "-q", "-b", "feat/locked", worktree, "main");
    git(dir, "worktree", "lock", "--reason", "autolock", worktree);

    assert.match(run(dir), /Retired: 1/);
    assert.equal(existsSync(worktree), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps a candidate when removal fails and continues to later candidates", async () => {
  const { main } = await import("./worktree-session-exit-retirement.mjs");
  const calls = [];
  const output = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (line) => output.push(line);
  console.error = (line) => output.push(line);
  try {
    const status = {
      rows: [
        { path: "/first", branch: "feat/first", locked: false, verdict: "SAFE-RETIRE" },
        { path: "/second", branch: "feat/second", locked: false, verdict: "SAFE-RETIRE" },
      ],
    };
    const runCommand = (args) => {
      calls.push(args);
      if (args[0] === "node") return { ok: true, output: JSON.stringify(status) };
      if (args[3] === "/first") return { ok: false, output: "simulated failure" };
      return { ok: true, output: "" };
    };

    assert.equal(main({ run: runCommand }), 0);
    assert.deepEqual(calls, [
      ["node", join(root, "scripts", "worktree-status.mjs"), "--json"],
      ["git", "worktree", "remove", "/first"],
      ["git", "worktree", "remove", "/second"],
      ["git", "branch", "-d", "feat/second"],
    ]);
    assert.match(output.join("\n"), /Retained \/first: could not remove: simulated failure/);
    assert.match(output.join("\n"), /Retired: 1/);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test("fails safe when the status report has no rows", async () => {
  const { main } = await import("./worktree-session-exit-retirement.mjs");
  const output = [];
  const originalError = console.error;
  console.error = (line) => output.push(line);
  try {
    assert.equal(
      main({ run: () => ({ ok: true, output: JSON.stringify({ ok: true }) }) }),
      0,
    );
    assert.match(output.join("\n"), /status report has no rows/);
  } finally {
    console.error = originalError;
  }
});

test("registers the retirement command as a SessionEnd hook", () => {
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  assert.ok(settings.hooks.SessionEnd);
  assert.match(
    JSON.stringify(settings.hooks.SessionEnd),
    /worktree-session-exit-retirement\.mjs/,
  );
});
