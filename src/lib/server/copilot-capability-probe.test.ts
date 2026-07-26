import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import {
  clearCopilotCapabilityProbeCache,
  probeCopilotCapability,
} from "./copilot-capability-probe.ts";

const probeSource = await readFile(
  new URL("./copilot-capability-probe.ts", import.meta.url),
  "utf8",
);
assert.match(
  probeSource,
  /resolveCopilotRuntimeLaunch/,
  "the capability probe consumes the shared exact runtime-launch plan",
);
assert.doesNotMatch(
  probeSource,
  /\bharnessSpawnEnv\b/,
  "Copilot probes never call the familiar/shared credential restoration path",
);

function delayedVersionSpawn(
  delayMs: number,
  onSpawn?: (
    args: readonly string[],
    options: import("node:child_process").SpawnOptions | undefined,
  ) => void,
): typeof import("node:child_process").spawn {
  return ((
    _command: string,
    args: readonly string[] = [],
    options?: import("node:child_process").SpawnOptions,
  ) => {
    onSpawn?.(args, options);
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let killed = false;
    child.kill = () => {
      killed = true;
      return true;
    };
    setTimeout(() => {
      if (killed) return;
      child.stdout.end(
        "GitHub Copilot CLI 1.0.75.\nRun 'copilot update' to check for updates.\n",
      );
      child.stderr.end();
      child.emit("close", 0);
    }, delayMs);
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

function sequencedVersionSpawn(
  results: Array<{ code: number; stdout?: string }>,
  onSpawn?: () => void,
): typeof import("node:child_process").spawn {
  let index = 0;
  return ((
    _command: string,
    _args: readonly string[] = [],
  ) => {
    onSpawn?.();
    const result = results[Math.min(index, results.length - 1)]!;
    index += 1;
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let killed = false;
    child.kill = () => {
      killed = true;
      return true;
    };
    setTimeout(() => {
      if (killed) return;
      child.stdout.end(result.stdout ?? "");
      child.stderr.end();
      child.emit("close", result.code);
    }, 0);
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

const immediateSpawnEnv = () => ({ ...process.env });
const resolveLocalLaunchCommand = async () => ({
  command: process.execPath,
  fixedArgs: [],
});

clearCopilotCapabilityProbeCache();
const supportedProbe = await probeCopilotCapability("copilot", {
  binaryIdentity: async () => "copilot-supported-fixture",
  spawnEnv: immediateSpawnEnv,
  resolveLaunchCommand: resolveLocalLaunchCommand,
  spawnImpl: delayedVersionSpawn(0),
});
assert.equal(supportedProbe.version, "1.0.75", "normalizes a safe local --version probe");
assert.equal(supportedProbe.diagnostic, undefined);

const unavailable = await probeCopilotCapability("definitely-not-a-cave-runtime", {
  spawnEnv: immediateSpawnEnv,
});
assert.equal(unavailable.version, null);
assert.equal(unavailable.availability.state, "missing");
assert.equal(
  unavailable.diagnostic,
  undefined,
  "a missing runtime is not collapsed into version-unavailable",
);

// A bounded launch-identity check can time out before the version process is
// started. The failed probe must still return its exact resolved plan so chat
// preflights that plan rather than falling back to a different bare command.
clearCopilotCapabilityProbeCache();
const identityTimedOut = await probeCopilotCapability("copilot-identity-timeout-fixture", {
  binaryIdentity: async () => "",
  resolveRuntimeLaunch: async () => ({
    env: { NODE_ENV: "test", PATH: "" },
    command: "copilot-identity-timeout-fixture",
    fixedArgs: [],
    requiredFiles: [],
    deadline: Date.now() + 1_500,
    availability: {
      state: "ready",
      runner: "copilot",
      resolvedPath: "copilot-identity-timeout-fixture",
    },
  }),
  spawnImpl: (() => {
    throw new Error("the version probe must not run after identity timeout");
  }) as typeof import("node:child_process").spawn,
});
assert.equal(identityTimedOut.version, null);
assert.equal(identityTimedOut.diagnostic, "probe-timeout");
assert.deepEqual(
  identityTimedOut.launchCommand,
  { command: "copilot-identity-timeout-fixture", fixedArgs: [], requiredFiles: [] },
  "a timed-out identity check retains the resolved direct launch plan",
);

// The cache is keyed by the resolved binary identity, not merely its command
// name. An in-place CLI upgrade must be re-probed before Cave selects JSONL.
clearCopilotCapabilityProbeCache();
const identityA = async () => "copilot-shim:old";
const identityB = async () => "copilot-shim:new";
const cached = await probeCopilotCapability("copilot", {
  binaryIdentity: identityA,
  spawnEnv: immediateSpawnEnv,
  resolveLaunchCommand: resolveLocalLaunchCommand,
  spawnImpl: delayedVersionSpawn(0),
});
assert.ok(cached.version, "the initial binary identity is probed");
const fromCache = await probeCopilotCapability("copilot", {
  binaryIdentity: identityA,
  spawnEnv: immediateSpawnEnv,
  resolveLaunchCommand: resolveLocalLaunchCommand,
  spawnImpl: (() => { throw new Error("cache miss"); }) as typeof import("node:child_process").spawn,
});
assert.equal(fromCache.version, cached.version, "the unchanged binary may use the short-lived cache");
const afterUpgrade = await probeCopilotCapability("copilot", {
  binaryIdentity: identityB,
  spawnEnv: immediateSpawnEnv,
  resolveLaunchCommand: resolveLocalLaunchCommand,
  spawnImpl: (() => { throw new Error("re-probed after binary change"); }) as typeof import("node:child_process").spawn,
});
assert.equal(afterUpgrade.version, null, "a changed binary identity never reuses the old supported capability");
assert.equal(afterUpgrade.diagnostic, "version-unavailable");

clearCopilotCapabilityProbeCache();
let transientVersionSpawns = 0;
const transientThenReadySpawn = sequencedVersionSpawn(
  [
    { code: 1 },
    {
      code: 0,
      stdout:
        "GitHub Copilot CLI 1.0.75.\nRun 'copilot update' to check for updates.\n",
    },
  ],
  () => {
    transientVersionSpawns += 1;
  },
);
const transientFailure = await probeCopilotCapability("copilot", {
  binaryIdentity: async () => "copilot-transient-version-fixture",
  spawnEnv: immediateSpawnEnv,
  resolveLaunchCommand: resolveLocalLaunchCommand,
  spawnImpl: transientThenReadySpawn,
});
assert.equal(transientFailure.version, null);
assert.equal(transientFailure.diagnostic, "version-unavailable");
const recoveredAfterTransientFailure = await probeCopilotCapability("copilot", {
  binaryIdentity: async () => "copilot-transient-version-fixture",
  spawnEnv: immediateSpawnEnv,
  resolveLaunchCommand: resolveLocalLaunchCommand,
  spawnImpl: transientThenReadySpawn,
});
assert.equal(
  recoveredAfterTransientFailure.version,
  "1.0.75",
  "a same-identity runtime retries and recovers after a transient version failure",
);
assert.equal(
  transientVersionSpawns,
  2,
  "transient version failures are not cached",
);

clearCopilotCapabilityProbeCache();
let coldStartArgs: readonly string[] = [];
const coldStart = await probeCopilotCapability("copilot", {
  binaryIdentity: async () => "copilot-cold-start-fixture",
  spawnEnv: immediateSpawnEnv,
  resolveLaunchCommand: resolveLocalLaunchCommand,
  spawnImpl: delayedVersionSpawn(2_750, (args) => {
    coldStartArgs = args;
  }),
});
assert.equal(
  coldStart.version,
  "1.0.75",
  "a valid cold-starting CLI gets a version-process budget independent of launcher resolution",
);
assert.equal(coldStart.diagnostic, undefined);
assert.deepEqual(
  coldStartArgs.slice(-2),
  ["--no-auto-update", "--version"],
  "the compatibility probe must not update the runtime between version selection and launch",
);

clearCopilotCapabilityProbeCache();
let canonicalProbePath: string | undefined;
const canonicalEnv: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: "/cave/canonical-harness-path",
};
const canonicalEnvProbe = await probeCopilotCapability("copilot", {
  binaryIdentity: async () => "copilot-canonical-env-fixture",
  spawnEnv: () => canonicalEnv,
  resolveLaunchCommand: resolveLocalLaunchCommand,
  spawnImpl: delayedVersionSpawn(0, (_args, options) => {
    canonicalProbePath = options?.env?.PATH;
  }),
});
assert.equal(canonicalEnvProbe.version, "1.0.75");
assert.equal(
  canonicalProbePath,
  canonicalEnv.PATH,
  "the capability probe resolves and launches with Cave's canonical harness environment",
);

clearCopilotCapabilityProbeCache();
let deadlineClock = 9_000;
let receivedDiscoveryDeadline: number | undefined;
let launchResolutionCalls = 0;
let identityCalls = 0;
let versionSpawnCalls = 0;
const discoveryTimeout = await probeCopilotCapability("copilot", {
  now: () => deadlineClock,
  spawnEnv: (discoveryDeadline) => {
    receivedDiscoveryDeadline = discoveryDeadline;
    if (discoveryDeadline !== undefined) deadlineClock = discoveryDeadline;
    return { ...process.env, PATH: "/deadline-exhausted-discovery" };
  },
  resolveLaunchCommand: async () => {
    launchResolutionCalls += 1;
    return { command: "copilot", fixedArgs: [] };
  },
  binaryIdentity: async () => {
    identityCalls += 1;
    return "must-not-run";
  },
  spawnImpl: (() => {
    versionSpawnCalls += 1;
    throw new Error("must not spawn after discovery exhausts the deadline");
  }) as typeof import("node:child_process").spawn,
});
assert.equal(discoveryTimeout.version, null);
assert.equal(discoveryTimeout.diagnostic, "probe-timeout");
assert.equal(
  discoveryTimeout.availability.state,
  "probe_failed",
  "environment discovery that consumes the resolution budget fails closed",
);
assert.match(
  discoveryTimeout.availability.state === "probe_failed"
    ? discoveryTimeout.availability.message
    : "",
  /timed out/i,
  "discovery timeout remains a launch-probe cause instead of schema incompatibility",
);
assert.equal(receivedDiscoveryDeadline, 11_500, "spawnEnv receives the absolute deadline");
assert.equal(launchResolutionCalls, 0, "launch resolution does not start after discovery times out");
assert.equal(identityCalls, 0, "binary identity work does not start after discovery times out");
assert.equal(versionSpawnCalls, 0, "the version process does not start after discovery times out");

for (const state of ["missing", "unlaunchable"] as const) {
  clearCopilotCapabilityProbeCache();
  let blockedIdentityCalls = 0;
  let blockedVersionSpawnCalls = 0;
  const blocked = await probeCopilotCapability("copilot", {
    resolveRuntimeLaunch: async () => ({
      env: { NODE_ENV: "test", PATH: "/blocked-copilot" },
      command: "copilot",
      fixedArgs: [],
      deadline: Date.now() + 2_500,
      availability: {
        state,
        runner: "copilot",
        code: state === "missing" ? "runtime_missing" : "runtime_unlaunchable",
        message: `${state} fixture`,
      },
    }),
    binaryIdentity: async () => {
      blockedIdentityCalls += 1;
      return "must-not-run";
    },
    spawnImpl: (() => {
      blockedVersionSpawnCalls += 1;
      throw new Error("must not start --version for a blocked launch plan");
    }) as typeof import("node:child_process").spawn,
  });
  assert.equal(blocked.version, null);
  assert.equal(blocked.availability?.state, state);
  assert.equal(
    blockedIdentityCalls,
    0,
    `${state} launch plans do not start binary identity work`,
  );
  assert.equal(
    blockedVersionSpawnCalls,
    0,
    `${state} launch plans do not start a version process`,
  );
}

console.log("copilot-capability-probe: ok");
