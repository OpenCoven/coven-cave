// @ts-nocheck
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const runtimeLaunchModule = await import("./copilot-runtime-launch.ts").catch(() => ({}));
assert.equal(
  typeof runtimeLaunchModule.resolveCopilotRuntimeLaunch,
  "function",
  "Copilot exposes one shared passive runtime-launch resolver",
);
const resolveCopilotRuntimeLaunch = runtimeLaunchModule.resolveCopilotRuntimeLaunch;

const scratch = mkdtempSync(path.join(tmpdir(), "cave-copilot-runtime-launch-"));
try {
  let capturedDeadline: number | undefined;
  let capturedResolveOptions: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } | undefined;
  const exactEnv = { PATH: "" };
  const ready = await resolveCopilotRuntimeLaunch(process.execPath, {
    platform: "linux",
    now: () => 1_000,
    spawnEnv: (deadline: number) => {
      capturedDeadline = deadline;
      return exactEnv;
    },
    resolveLaunchCommand: async (_executable: string, options: typeof capturedResolveOptions) => {
      capturedResolveOptions = options;
      return { command: process.execPath, fixedArgs: [] };
    },
  });
  assert.equal(capturedDeadline, 3_500, "environment discovery receives one absolute deadline");
  assert.equal(ready.deadline, capturedDeadline, "the launch plan owns that same absolute deadline");
  assert.equal(capturedResolveOptions?.env, exactEnv, "launcher resolution uses the plan's exact env");
  assert.equal(capturedResolveOptions?.timeoutMs, 2_500, "launcher resolution receives only remaining time");
  assert.equal(ready.availability.state, "ready");

  let timeAfterAvailability = 1_000;
  const exhaustedDuringAvailability = await resolveCopilotRuntimeLaunch(process.execPath, {
    platform: "linux",
    now: () => timeAfterAvailability,
    spawnEnv: () => ({ PATH: "" }),
    resolveLaunchCommand: async () => ({
      command: process.execPath,
      fixedArgs: ["copilot-entry.js"],
    }),
    evaluateAvailability: (probe: { command: string }) => {
      timeAfterAvailability = 4_000;
      return {
        state: "ready",
        runner: "copilot",
        resolvedPath: probe.command,
      };
    },
  });
  assert.equal(
    exhaustedDuringAvailability.availability.state,
    "probe_failed",
    "availability work that exhausts the shared deadline fails closed",
  );
  assert.equal(
    exhaustedDuringAvailability.resolutionTimedOut,
    true,
    "post-availability deadline exhaustion retains the safe timeout marker",
  );
  assert.equal(
    exhaustedDuringAvailability.command,
    process.execPath,
    "a timed-out plan retains the exact resolved command for diagnostics-free reuse",
  );
  assert.deepEqual(
    exhaustedDuringAvailability.fixedArgs,
    ["copilot-entry.js"],
    "a timed-out plan retains the exact resolved fixed arguments",
  );

  const deadlineSamples = [1_000, 3_499, 3_501];
  let exhaustedResolutionCalls = 0;
  let nonPositiveTimeout: number | undefined;
  const exhaustedBeforeResolution = await resolveCopilotRuntimeLaunch("copilot", {
    platform: "linux",
    now: () => deadlineSamples.shift() ?? 3_501,
    spawnEnv: () => ({ PATH: "" }),
    resolveLaunchCommand: async (executable: string, options: { timeoutMs?: number }) => {
      exhaustedResolutionCalls += 1;
      nonPositiveTimeout = options.timeoutMs;
      return { command: executable, fixedArgs: [] };
    },
  });
  assert.equal(
    exhaustedResolutionCalls,
    0,
    "launcher resolution never starts when the sampled remaining budget is non-positive",
  );
  assert.equal(nonPositiveTimeout, undefined, "no non-positive timeout reaches launcher resolution");
  assert.equal(exhaustedBeforeResolution.availability.state, "probe_failed");
  assert.equal(exhaustedBeforeResolution.resolutionTimedOut, true);

  const missing = await resolveCopilotRuntimeLaunch("definitely-not-a-cave-runtime", {
    platform: "linux",
    now: () => 1_000,
    spawnEnv: () => ({ PATH: "" }),
    resolveLaunchCommand: async (executable: string) => ({ command: executable, fixedArgs: [] }),
  });
  assert.equal(missing.availability.state, "missing", "a missing launch plan is returned passively");
  assert.equal(missing.command, "definitely-not-a-cave-runtime");
  assert.deepEqual(missing.fixedArgs, []);

  const nonExecutable = path.join(scratch, "copilot-no-exec");
  writeFileSync(nonExecutable, "#!/bin/sh\n", { mode: 0o644 });
  chmodSync(nonExecutable, 0o644);
  const unlaunchable = await resolveCopilotRuntimeLaunch(nonExecutable, {
    platform: "linux",
    now: () => 1_000,
    spawnEnv: () => ({ PATH: "" }),
    resolveLaunchCommand: async (executable: string) => ({ command: executable, fixedArgs: [] }),
  });
  assert.equal(
    unlaunchable.availability.state,
    "unlaunchable",
    "a present non-executable launch plan is returned passively",
  );

  const shimEntry = path.join(
    scratch,
    "node_modules",
    "@github",
    "copilot",
    "index.js",
  );
  const shim = path.join(scratch, "copilot.cmd");
  mkdirSync(path.dirname(shimEntry), { recursive: true });
  writeFileSync(shimEntry, "console.log('fixture')\n");
  writeFileSync(
    shim,
    `@echo off\r\n"%~dp0\\node_modules\\@github\\copilot\\index.js" %*\r\n`,
  );
  let evaluatedWindowsCommand: string | undefined;
  const windowsPlan = await resolveCopilotRuntimeLaunch(shim, {
    platform: "win32",
    now: () => 1_000,
    spawnEnv: () => ({ PATH: "" }),
    evaluateAvailability: (probe: { command: string }) => {
      evaluatedWindowsCommand = probe.command;
      return {
        state: "ready",
        runner: "copilot",
        resolvedPath: probe.command,
      };
    },
  });
  assert.equal(
    windowsPlan.command,
    process.execPath,
    "a Windows npm shim keeps the spawn-safe transformed command",
  );
  assert.deepEqual(
    windowsPlan.fixedArgs,
    [shimEntry],
    "a Windows npm shim keeps the exact transformed fixed args",
  );
  assert.deepEqual(
    windowsPlan.requiredFiles,
    [shimEntry],
    "a converted Windows npm shim preflights its fixed JavaScript entry",
  );
  assert.equal(
    evaluatedWindowsCommand,
    windowsPlan.command,
    "availability evaluates the transformed command, not the raw .cmd shim",
  );
  assert.equal(
    windowsPlan.availability.state,
    "ready",
    "availability evaluates the transformed command rather than the raw .cmd shim",
  );
  assert.equal(
    windowsPlan.availability.resolvedPath,
    process.execPath,
    "ready availability identifies the exact transformed command",
  );

  const timedOut = await resolveCopilotRuntimeLaunch("copilot", {
    platform: "linux",
    now: () => 1_000,
    spawnEnv: () => ({ PATH: "" }),
    resolveLaunchCommand: async (executable: string) => ({
      command: executable,
      fixedArgs: [],
      resolutionTimedOut: true,
    }),
  });
  assert.equal(timedOut.availability.state, "probe_failed");
  assert.equal(timedOut.resolutionTimedOut, true);
  assert.match(
    timedOut.availability.message,
    /timed out/i,
    "launcher resolution timeout stays distinct from a version-process failure",
  );

  const source = readFileSync(
    new URL("./copilot-runtime-launch.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /canonicalProbeSpawnEnv\(\{ discoveryDeadline, now \}\)/,
    "the default launch plan uses Task 2's credential-free canonical env",
  );
  assert.doesNotMatch(
    source,
    /["']--version["']/,
    "the passive launch resolver never starts a version process",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log("copilot-runtime-launch: ok");
