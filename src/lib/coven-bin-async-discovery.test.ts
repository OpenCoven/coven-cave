// @ts-nocheck
// Async PATH discovery for request paths (issue #5448). On a fresh profile the
// onboarding preflight asked covenSpawnEnv() for a spawn environment, which
// ran `$SHELL -ilc "echo $PATH"` synchronously and blocked the event loop for
// the whole login-shell startup (3.2 s measured). The async variant must
// compose the identical PATH, prime the same cache, share one subprocess
// between concurrent callers, and leave the event loop free while it runs.
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  covenSpawnEnv,
  covenSpawnEnvAsync,
  refreshCovenSpawnEnv,
  refreshCovenSpawnEnvAsync,
} from "./coven-bin.ts";

const probesSource = await readFile(
  new URL("./server/onboarding-prerequisite-probes.ts", import.meta.url),
  "utf8",
);
const statusSource = await readFile(new URL("./opencoven-tools-status.ts", import.meta.url), "utf8");
const covenBinSource = await readFile(new URL("./coven-bin.ts", import.meta.url), "utf8");

// The preflight call sites use the async discovery so a slow login shell never
// blocks the first document.
assert.match(
  probesSource,
  /env: await covenSpawnEnvAsync\(\)/,
  "prerequisite probes acquire their spawn env asynchronously",
);
assert.doesNotMatch(
  probesSource,
  /\bcovenSpawnEnv\(\)/,
  "prerequisite probes no longer call the synchronous covenSpawnEnv()",
);
assert.match(
  statusSource,
  /export async function openCovenToolReadinessStatuses[\s\S]*?const env = options\.env \?\? await refreshCovenSpawnEnvAsync\(\);/,
  "readiness statuses refresh their spawn env asynchronously",
);
assert.doesNotMatch(
  statusSource,
  /refreshCovenSpawnEnv\(\)|covenSpawnEnv\(\)/,
  "no remaining synchronous discovery call on the tools-status request path",
);
// Both discovery paths share one composition so priority rules cannot drift.
assert.match(
  covenBinSource,
  /function augmentedSpawnPath\([\s\S]*?return composeSpawnPath\(fromSystem, candidateDirs\(discovery\), preferLaunchPath, discovery\);/,
  "sync discovery composes through composeSpawnPath",
);
assert.match(
  covenBinSource,
  /async function augmentedSpawnPathAsync\([\s\S]*?loginShellPathAsync\(discovery\),[\s\S]*?candidateDirsAsync\(discovery\),[\s\S]*?return composeSpawnPath\(fromSystem, candidates, preferLaunchPath, discovery\);/,
  "async discovery composes through the same composeSpawnPath, with the shell probe and toolchain checks concurrent",
);
// The sync and async toolchain health checks admit directories from one
// shared per-directory context, so their launcher and env rules cannot drift.
assert.match(
  covenBinSource,
  /export function runnableNodeToolchainDirs\([\s\S]*?toolchainProbeContext\(directory, \{ platform, exists, sourceEnv \}\)/,
  "sync toolchain checks use the shared probe context",
);
assert.match(
  covenBinSource,
  /export async function runnableNodeToolchainDirsAsync\([\s\S]*?toolchainProbeContext\(directory, \{ platform, exists, sourceEnv \}\)/,
  "async toolchain checks use the shared probe context",
);

if (process.platform === "win32") {
  console.log("coven-bin-async-discovery.test.ts: skipped behavioral cases (no POSIX login shell)");
} else {
  const dir = await mkdtemp(path.join(os.tmpdir(), "coven-async-discovery-"));
  const calls = path.join(dir, "calls");
  const shell = path.join(dir, "slow-shell");
  const shellBin = path.join(dir, "shell-bin");
  // Stub login shell: records each invocation, sleeps like a slow rc file,
  // then prints a PATH the way `zsh -ilc "echo $PATH"` would.
  await writeFile(
    shell,
    `#!/bin/sh\nprintf x >> "${calls}"\n/bin/sleep 0.3\necho "${shellBin}:/usr/bin"\n`,
  );
  await chmod(shell, 0o755);
  const launchBin = path.join(dir, "launch-bin");
  const originalEnv = { ...process.env };
  const invocations = async () => {
    try {
      return (await readFile(calls, "utf8")).length;
    } catch {
      return 0;
    }
  };
  try {
    process.env.SHELL = shell;
    process.env.PATH = launchBin;

    // 1. Same PATH as the synchronous path, from a cold cache each time.
    const sync = refreshCovenSpawnEnv();
    const fromAsync = await refreshCovenSpawnEnvAsync();
    assert.equal(fromAsync.PATH, sync.PATH, "async discovery composes the identical PATH");
    assert.ok(fromAsync.PATH.split(path.delimiter).includes(shellBin), "login-shell PATH is included");
    assert.ok(fromAsync.PATH.split(path.delimiter).includes(launchBin), "launch PATH is included");
    assert.equal(await invocations(), 2, "one shell per cold discovery so far (sync + async)");

    // 2. The async result primes the shared cache: the sync reader hits it
    //    without another subprocess.
    assert.equal(covenSpawnEnv().PATH, fromAsync.PATH);
    assert.equal(await invocations(), 2, "cached PATH served without a new login shell");

    // 3. Concurrent cold callers share one subprocess, and the event loop
    //    stays free while the shell runs.
    refreshCovenSpawnEnv({ discoveryDeadline: 0, now: () => 1 }); // drop caches without spawning
    assert.equal(await invocations(), 2, "an expired deadline never spawns");
    const order: string[] = [];
    const timer = new Promise<void>((resolve) =>
      setTimeout(() => {
        order.push("timer");
        resolve();
      }, 50),
    );
    const fanOut = Promise.all(
      Array.from({ length: 5 }, () => covenSpawnEnvAsync().then((env) => env.PATH)),
    ).then((paths) => {
      order.push("discovery");
      return paths;
    });
    const [paths] = await Promise.all([fanOut, timer]);
    assert.deepEqual(order, ["timer", "discovery"], "a 50 ms timer fires while the 300 ms shell runs");
    assert.equal(new Set(paths).size, 1, "all concurrent callers receive the same PATH");
    assert.equal(paths[0], fromAsync.PATH);
    assert.equal(await invocations(), 3, "five concurrent cold callers spawned exactly one shell");

    // 4. A refresh joins an in-flight discovery instead of spawning again.
    refreshCovenSpawnEnv({ discoveryDeadline: 0, now: () => 1 });
    const first = covenSpawnEnvAsync();
    const refreshed = refreshCovenSpawnEnvAsync();
    const [a, b] = await Promise.all([first, refreshed]);
    assert.equal(a.PATH, b.PATH);
    assert.equal(await invocations(), 4, "refresh during an in-flight discovery joins it");

    // 5. A warm cache is served before any option is consulted (same contract
    //    as covenSpawnEnv). From a cold cache, custom discovery options never
    //    share the default in-flight probe and honour an expired deadline
    //    without spawning.
    const warm = await covenSpawnEnvAsync({ discoveryDeadline: 0, now: () => 1 });
    assert.equal(warm.PATH, a.PATH, "a warm cache is served regardless of options");
    refreshCovenSpawnEnv({ discoveryDeadline: 0, now: () => 1 });
    const expired = await covenSpawnEnvAsync({
      discoveryEnv: { ...process.env },
      discoveryDeadline: 0,
      now: () => 1,
    });
    assert.ok(!expired.PATH.split(path.delimiter).includes(shellBin), "expired deadline skips the shell");
    assert.equal(await invocations(), 4, "expired custom discovery spawned nothing");
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    refreshCovenSpawnEnv({ discoveryDeadline: 0, now: () => 1 });
    await rm(dir, { recursive: true, force: true });
  }
}

console.log("coven-bin-async-discovery.test.ts: ok");
