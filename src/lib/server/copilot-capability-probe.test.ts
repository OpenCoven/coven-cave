import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  clearCopilotCapabilityProbeCache,
  probeCopilotCapability,
} from "./copilot-capability-probe.ts";

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

clearCopilotCapabilityProbeCache();
const supportedProbe = await probeCopilotCapability("copilot", {
  binaryIdentity: async () => "copilot-supported-fixture",
  spawnImpl: delayedVersionSpawn(0),
});
assert.equal(supportedProbe.version, "1.0.75", "normalizes a safe local --version probe");
assert.equal(supportedProbe.diagnostic, undefined);

const unavailable = await probeCopilotCapability("definitely-not-a-cave-runtime");
assert.equal(unavailable.version, null);
assert.equal(unavailable.diagnostic, "version-unavailable");

// The cache is keyed by the resolved binary identity, not merely its command
// name. An in-place CLI upgrade must be re-probed before Cave selects JSONL.
clearCopilotCapabilityProbeCache();
const identityA = async () => "copilot-shim:old";
const identityB = async () => "copilot-shim:new";
const cached = await probeCopilotCapability("copilot", {
  binaryIdentity: identityA,
  spawnImpl: delayedVersionSpawn(0),
});
assert.ok(cached.version, "the initial binary identity is probed");
const fromCache = await probeCopilotCapability("copilot", {
  binaryIdentity: identityA,
  spawnImpl: (() => { throw new Error("cache miss"); }) as typeof import("node:child_process").spawn,
});
assert.equal(fromCache.version, cached.version, "the unchanged binary may use the short-lived cache");
const afterUpgrade = await probeCopilotCapability("copilot", {
  binaryIdentity: identityB,
  spawnImpl: (() => { throw new Error("re-probed after binary change"); }) as typeof import("node:child_process").spawn,
});
assert.equal(afterUpgrade.version, null, "a changed binary identity never reuses the old supported capability");
assert.equal(afterUpgrade.diagnostic, "version-unavailable");

clearCopilotCapabilityProbeCache();
let coldStartArgs: readonly string[] = [];
const coldStart = await probeCopilotCapability("copilot", {
  binaryIdentity: async () => "copilot-cold-start-fixture",
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

console.log("copilot-capability-probe: ok");
