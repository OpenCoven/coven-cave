import assert from "node:assert/strict";
import { probeReadyLocalRuntimeCapability } from "./local-runtime-capability-gate.ts";

assert.equal(
  typeof probeReadyLocalRuntimeCapability,
  "function",
  "local capability probes have one behaviorally testable passive-plan gate",
);

const notReadyStates = [
  {
    state: "missing",
    code: "runtime_missing",
    message: "missing",
  },
  {
    state: "unlaunchable",
    code: "runtime_unlaunchable",
    message: "unlaunchable",
  },
  {
    state: "probe_failed",
    code: "runtime_probe_failed",
    message: "probe failed",
  },
] as const;

for (const runner of ["opencode", "hermes"] as const) {
  for (const state of notReadyStates) {
    let calls = 0;
    const result = await probeReadyLocalRuntimeCapability({
      plan: {
        runner,
        availability: { runner, ...state },
      },
      runner,
      probe: async () => {
        calls += 1;
        return "must-not-run";
      },
    });
    assert.equal(
      result,
      null,
      `${runner} ${state.state} plans return no capability result`,
    );
    assert.equal(
      calls,
      0,
      `${runner} ${state.state} plans never call the injected capability probe`,
    );
  }

  let readyCalls = 0;
  const readyResult = await probeReadyLocalRuntimeCapability({
    plan: {
      runner,
      availability: {
        state: "ready",
        runner,
        resolvedPath: "/private/ready-runner",
      },
    },
    runner,
    probe: async () => {
      readyCalls += 1;
      return `${runner}-ready`;
    },
  });
  assert.equal(readyResult, `${runner}-ready`);
  assert.equal(
    readyCalls,
    1,
    `${runner} ready exact-runner plans call the injected probe once`,
  );
}

let wrongRunnerCalls = 0;
const wrongRunnerResult = await probeReadyLocalRuntimeCapability({
  plan: {
    runner: "hermes",
    availability: {
      state: "ready",
      runner: "hermes",
      resolvedPath: "/private/wrong-runner",
    },
  },
  runner: "opencode",
  allowWithoutLocalPlan: true,
  probe: async () => {
    wrongRunnerCalls += 1;
    return true;
  },
});
assert.equal(wrongRunnerResult, null);
assert.equal(
  wrongRunnerCalls,
  0,
  "the no-plan SSH bypass never authorizes a present plan for the wrong runner",
);

let sshBypassCalls = 0;
const sshBypassResult = await probeReadyLocalRuntimeCapability({
  plan: null,
  runner: "coven",
  allowWithoutLocalPlan: true,
  probe: async () => {
    sshBypassCalls += 1;
    return true;
  },
});
assert.equal(sshBypassResult, true);
assert.equal(
  sshBypassCalls,
  1,
  "the explicit no-local-plan bypass preserves existing SSH capability routing",
);

console.log("local-runtime-capability-gate.test.ts: ok");
