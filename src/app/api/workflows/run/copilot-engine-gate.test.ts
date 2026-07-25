import assert from "node:assert/strict";
import { runWorkflowEngineAfterCopilotGate } from "./copilot-engine-gate.ts";

let daemonCalls = 0;
const engine = async () => ({ ok: true, call: ++daemonCalls });
const unavailable = async () => ({ version: null });
const supported = async () => ({ version: "1.0.70" });
const registry = async () => ({ eventProtocols: [{ id: "v1" }] });

const blocked = await runWorkflowEngineAfterCopilotGate({
  localCopilot: true,
  probe: unavailable,
  resolveCompatibility: registry,
  selectSpec: () => null,
  runEngine: engine,
});
assert.deepEqual(blocked, { blocked: true });
assert.equal(daemonCalls, 0, "unsupported local Copilot never calls the native workflow engine");

const direct = await runWorkflowEngineAfterCopilotGate({
  localCopilot: true,
  probe: supported,
  resolveCompatibility: registry,
  selectSpec: (version) => version === "1.0.70" ? { id: "v1" } : null,
  runEngine: engine,
});
assert.equal(direct.blocked, false);
assert.equal(daemonCalls, 1, "a supported local Copilot may call the native engine");

for (const label of ["ssh", "hub"]) {
  const remote = await runWorkflowEngineAfterCopilotGate({
    localCopilot: false,
    probe: async () => { throw new Error(`${label} must not probe the local CLI`); },
    resolveCompatibility: async () => { throw new Error(`${label} must not read local compatibility`); },
    selectSpec: () => null,
    runEngine: engine,
  });
  assert.equal(remote.blocked, false, `${label} execution remains remote-authoritative`);
}
assert.equal(daemonCalls, 3, "SSH and hub cases still call the native engine");

console.log("workflow copilot engine gate: ok");
