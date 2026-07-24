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

console.log("copilot-capability-probe: ok");
