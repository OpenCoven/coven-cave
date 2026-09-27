// @ts-nocheck
// #5643: a fresh process uses the last login-shell answer at once and
// re-checks it in the background, instead of every app launch waiting on the
// shell's rc startup. Each "launch" is its own node process.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform === "win32") {
  console.log("login-shell-persisted.test.ts: skipped on win32 (no login shell)");
  process.exit(0);
}

const dir = mkdtempSync(path.join(tmpdir(), "login-shell-persisted-"));
const counter = path.join(dir, "count");
const answer = path.join(dir, "answer");
const shell = path.join(dir, "slow-shell");
writeFileSync(counter, "");
writeFileSync(answer, "/opt/first/bin:/usr/bin:/bin");
// A shell whose rc takes a while, like a real one.
writeFileSync(shell, `#!/bin/sh\nprintf x >> "${counter}"\nsleep 1\ncat "${answer}"\n`);
chmodSync(shell, 0o755);
const probes = () => readFileSync(counter, "utf8").length;

const moduleUrl = new URL("./coven-bin.ts", import.meta.url).href;
const launch = (script) => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    env: {
      ...process.env,
      SHELL: shell,
      HOME: dir,
      COVEN_HOME: path.join(dir, ".coven"),
      COVEN_CAVE_HOME: path.join(dir, ".coven", "cave"),
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").pop());
};
// Cave puts its own directories first; which fake-shell answer is in effect?
const firstDir = (value) => (value ?? "").split(":").find((entry) => /^\/opt\/(first|second)\/bin$/.test(entry));

// Launch 1: nothing persisted, so the probe runs (and is remembered).
const first = launch(`
  const bin = await import(${JSON.stringify(moduleUrl)});
  const started = Date.now();
  const env = await bin.covenSpawnEnvAsync();
  console.log(JSON.stringify({ ms: Date.now() - started, path: env.PATH }));
`);
assert.ok(first.ms >= 900, "a first launch waits for the shell");
assert.equal(firstDir(first.path), "/opt/first/bin");
assert.equal(probes(), 1);
assert.ok(existsSync(path.join(dir, ".coven", "cave", "spawn-login-path.json")), "the answer is persisted");

// Launch 2: the persisted answer answers at once; one background re-check runs.
writeFileSync(answer, "/opt/second/bin:/usr/bin:/bin");
const second = launch(`
  const bin = await import(${JSON.stringify(moduleUrl)});
  const started = Date.now();
  const env = await bin.covenSpawnEnvAsync();
  const ms = Date.now() - started;
  const tool = bin.caveToolSpawnEnv().PATH;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const after = bin.covenSpawnEnv().PATH;
  console.log(JSON.stringify({ ms, path: env.PATH, tool, after }));
`);
assert.ok(second.ms < 800, `a later launch does not wait for the shell (took ${second.ms} ms)`);
assert.equal(firstDir(second.path), "/opt/first/bin", "it starts from the last known answer");
assert.equal(firstDir(second.tool), "/opt/first/bin", "sync callers use it too, without probing");
assert.equal(firstDir(second.after), "/opt/second/bin", "the background re-check replaces a changed answer");
assert.equal(probes(), 2, "exactly one background probe");

// Launch 3: a refresh (after an install) always probes live.
const third = launch(`
  const bin = await import(${JSON.stringify(moduleUrl)});
  const started = Date.now();
  const env = bin.refreshCovenSpawnEnv();
  console.log(JSON.stringify({ ms: Date.now() - started, path: env.PATH }));
`);
assert.ok(third.ms >= 900, "a refresh waits for the live probe");
assert.equal(firstDir(third.path), "/opt/second/bin");

console.log("login-shell-persisted.test.ts: ok");
