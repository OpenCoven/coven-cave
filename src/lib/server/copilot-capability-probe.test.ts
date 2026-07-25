import assert from "node:assert/strict";
import {
  clearCopilotCapabilityProbeCache,
  probeCopilotCapability,
} from "./copilot-capability-probe.ts";

clearCopilotCapabilityProbeCache();
const nodeProbe = await probeCopilotCapability(process.execPath);
assert.match(nodeProbe.version ?? "", /^\d+\.\d+\.\d+$/, "normalizes a safe local --version probe");
assert.equal(nodeProbe.diagnostic, undefined);

const unavailable = await probeCopilotCapability("definitely-not-a-cave-runtime");
assert.equal(unavailable.version, null);
assert.equal(unavailable.diagnostic, "version-unavailable");

// The cache is keyed by the resolved binary identity, not merely its command
// name. An in-place CLI upgrade must be re-probed before Cave selects JSONL.
clearCopilotCapabilityProbeCache();
const identityA = async () => "copilot-shim:old";
const identityB = async () => "copilot-shim:new";
const cached = await probeCopilotCapability(process.execPath, { binaryIdentity: identityA });
assert.ok(cached.version, "the initial binary identity is probed");
const fromCache = await probeCopilotCapability(process.execPath, {
  binaryIdentity: identityA,
  spawnImpl: (() => { throw new Error("cache miss"); }) as typeof import("node:child_process").spawn,
});
assert.equal(fromCache.version, cached.version, "the unchanged binary may use the short-lived cache");
const afterUpgrade = await probeCopilotCapability(process.execPath, {
  binaryIdentity: identityB,
  spawnImpl: (() => { throw new Error("re-probed after binary change"); }) as typeof import("node:child_process").spawn,
});
assert.equal(afterUpgrade.version, null, "a changed binary identity never reuses the old supported capability");
assert.equal(afterUpgrade.diagnostic, "version-unavailable");

console.log("copilot-capability-probe: ok");
