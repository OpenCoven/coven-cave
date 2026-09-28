// @ts-nocheck
// #5621: one login-shell probe per process. Every composed spawn PATH — the
// warmed coven path, the git/gh tool path, deadline-bounded discovery — starts
// from the same `$SHELL -ilc 'echo $PATH'` answer, and each run blocks for the
// shell's rc startup. A fake shell counts its own invocations here.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform === "win32") {
  console.log("login-shell-probe-cache.test.ts: skipped on win32 (no login shell)");
  process.exit(0);
}

const dir = mkdtempSync(path.join(tmpdir(), "login-shell-probe-"));
const counter = path.join(dir, "count");
const shell = path.join(dir, "fake-shell");
writeFileSync(counter, "");
writeFileSync(shell, `#!/bin/sh\nprintf x >> "${counter}"\necho /opt/fake-login/bin:/usr/bin:/bin\n`);
chmodSync(shell, 0o755);
const probes = () => readFileSync(counter, "utf8").length;

process.env.SHELL = shell;
process.env.HOME = dir;
const bin = await import("./coven-bin.ts");
const env = { ...process.env };

bin.refreshCovenSpawnEnv({ discoveryEnv: env });
assert.equal(probes(), 1, "the first discovery runs the login shell once");

// The same inputs asked again through other consumers: no new probe.
await bin.covenSpawnEnvAsync({ discoveryEnv: env });
bin.covenSpawnEnv({ discoveryEnv: env, discoveryDeadline: Date.now() + 10_000 });
const toolPath = bin.caveToolSpawnEnv().PATH ?? "";
assert.ok(toolPath.split(":").includes("/opt/fake-login/bin"), "the tool path is composed from the shared answer");
assert.equal(probes(), 1, "the tool path and deadline-bounded discovery reuse the one probe");

// A refresh (after an install) must see a changed login shell.
bin.refreshCovenSpawnEnv({ discoveryEnv: env });
assert.equal(probes(), 2, "a refresh probes again");

// Different shell inputs are a different answer: probed, not reused.
bin.refreshCovenSpawnEnv({ discoveryEnv: { ...env, HOME: path.join(dir, "other") } });
assert.equal(probes(), 3, "a different HOME is probed on its own");

console.log("login-shell-probe-cache.test.ts: ok");
