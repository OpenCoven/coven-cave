import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "beads-surface-audit.ts");
const SCRATCH_ROOT = join(HERE, ".scratch-beads-surface-audit-test");

function makeFixture(name) {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const root = join(SCRATCH_ROOT, `${name}-${process.pid}-${Date.now()}`);
  const bin = join(root, "bin");
  const baseline = join(root, "baseline.json");
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
process.stdout.write(process.env.BD_FAKE_STDOUT ?? "[]");
process.stderr.write(process.env.BD_FAKE_STDERR ?? "");
process.exit(Number(process.env.BD_FAKE_EXIT_STATUS ?? "0"));
`,
    "utf8",
  );
  chmodSync(join(bin, "bd"), 0o755);
  return { root, bin, baseline, log };
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

function writeBaseline(file, grandfathered) {
  writeFileSync(file, JSON.stringify({ grandfathered }, null, 2) + "\n", "utf8");
}

try {
  {
    const fixture = makeFixture("baseline-ignore");
    try {
      writeBaseline(fixture.baseline, ["cave-old"]);
      const result = run(["--baseline", fixture.baseline], fixture, {
        BD_FAKE_STDOUT: JSON.stringify([
          { id: "cave-old", labels: [] },
          { id: "cave-good", labels: ["surface:shared"] },
        ]),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      const entries = readLog(fixture.log);
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0].argv, ["list", "--all", "--json"]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  {
    const fixture = makeFixture("conflicting");
    try {
      writeBaseline(fixture.baseline, []);
      const result = run(["--baseline", fixture.baseline], fixture, {
        BD_FAKE_STDOUT: JSON.stringify([
          { id: "cave-ok", labels: ["surface:desktop"] },
          { id: "cave-bad", labels: ["surface:ios", "surface:desktop"] },
        ]),
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /cave-bad: conflicting/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  {
    const fixture = makeFixture("write-baseline");
    try {
      writeBaseline(fixture.baseline, ["cave-old"]);
      const result = run(["--baseline", fixture.baseline, "--write-baseline"], fixture, {
        BD_FAKE_STDOUT: JSON.stringify([
          { id: "cave-z", labels: [] },
          { id: "cave-a", labels: ["surface:desktop", "surface:shared"] },
          { id: "cave-good", labels: ["surface:shared"] },
          { id: "cave-m", labels: [] },
        ]),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(fixture.baseline, "utf8")), {
        grandfathered: ["cave-a", "cave-m", "cave-z"],
      });
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  {
    const fixture = makeFixture("malformed-json");
    try {
      writeBaseline(fixture.baseline, []);
      const result = run(["--baseline", fixture.baseline], fixture, {
        BD_FAKE_STDOUT: "{not json}",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /failed to parse bd list JSON/i);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  {
    const fixture = makeFixture("bd-status");
    try {
      writeBaseline(fixture.baseline, []);
      const result = run(["--baseline", fixture.baseline], fixture, {
        BD_FAKE_EXIT_STATUS: "9",
        BD_FAKE_STDERR: "bd failed\n",
      });
      assert.equal(result.status, 9, "audit should pass through bd's exit status");
      assert.match(result.stderr, /bd failed/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
} finally {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
}

console.log("beads-surface-audit.test.mjs: ok");
