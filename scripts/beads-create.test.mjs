import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "beads-create.ts");
const SCRATCH_ROOT = join(HERE, ".scratch-beads-create-test");

function makeFixture(name) {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const root = join(SCRATCH_ROOT, `${name}-${process.pid}-${Date.now()}`);
  const bin = join(root, "bin");
  const log = join(root, "bd-log.jsonl");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "bd"),
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

appendFileSync(
  process.env.BD_FAKE_LOG,
  JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n",
);
process.exit(Number(process.env.BD_FAKE_EXIT_STATUS ?? "0"));
`,
    "utf8",
  );
  chmodSync(join(bin, "bd"), 0o755);
  return { root, bin, log };
}

function run(args, fixture, extraEnv = {}) {
  return spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
    cwd: HERE,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}${process.env.PATH ? `${delimiter}${process.env.PATH}` : ""}`,
      BD_FAKE_LOG: fixture.log,
      ...extraEnv,
    },
  });
}

function readLog(log) {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

try {
  {
    const fixture = makeFixture("merge");
    try {
      const result = run(
        [
          "Canonical bead",
          "--surface=shared",
          "--labels=from-pr,from-pr",
          "-l",
          "triage,,backend",
          "--priority",
          "2",
        ],
        fixture,
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.signal, null);
      const entries = readLog(fixture.log);
      assert.equal(entries.length, 1, "wrapper should invoke bd exactly once");
      assert.deepEqual(entries[0].argv, [
        "create",
        "Canonical bead",
        "--priority",
        "2",
        "--labels",
        "from-pr,triage,backend,surface:shared",
      ]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  {
    const fixture = makeFixture("missing-surface");
    try {
      const result = run(["Missing surface"], fixture);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /--surface ios\|desktop\|shared is required/);
      assert.deepEqual(readLog(fixture.log), [], "validation should block bd invocation");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  {
    const fixture = makeFixture("invalid-surface");
    try {
      const result = run(["Invalid surface", "--surface", "daemon"], fixture);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /invalid --surface "daemon"/);
      assert.deepEqual(readLog(fixture.log), [], "invalid surfaces should not reach bd");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  {
    const fixture = makeFixture("duplicate-surface");
    try {
      const result = run(["Duplicate surface", "--surface", "ios", "--surface=shared"], fixture);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /--surface may be passed exactly once/);
      assert.deepEqual(readLog(fixture.log), [], "duplicate surfaces should not reach bd");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  {
    const fixture = makeFixture("conflicting-label");
    try {
      const result = run(["Conflicting label", "--surface", "shared", "--labels", "ops,surface:ios"], fixture);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Use --surface instead of passing surface ownership labels in --labels/);
      assert.deepEqual(readLog(fixture.log), [], "platform labels in --labels should be rejected");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  {
    const fixture = makeFixture("passthrough");
    try {
      const result = run(["Child exit", "--surface", "desktop"], fixture, { BD_FAKE_EXIT_STATUS: "7" });
      assert.equal(result.status, 7, "wrapper should pass through bd's exit status");
      const entries = readLog(fixture.log);
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0].argv, ["create", "Child exit", "--labels", "surface:desktop"]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
} finally {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
}

console.log("beads-create.test.mjs: ok");
