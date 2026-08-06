import assert from "node:assert/strict";
import {
  probeReadyLocalRuntimeCapability,
  probeReadyLocalRuntimeCapabilityOutcome,
} from "./local-runtime-capability-gate.ts";

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

{
  let covenBackedCalls = 0;
  const covenBackedResult = await probeReadyLocalRuntimeCapability({
    plan: {
      runner: "coven",
      availabilityRunner: "claude",
      availability: {
        state: "ready",
        runner: "claude",
        resolvedPath: "/private/claude",
      },
    },
    runner: "coven",
    probe: async () => {
      covenBackedCalls += 1;
      return true;
    },
  });
  assert.equal(
    covenBackedResult,
    true,
    "a Coven-backed Claude plan probes `coven run` capabilities",
  );
  assert.equal(covenBackedCalls, 1, "the Coven-backed plan calls the probe exactly once");
}

{
  let driftCalls = 0;
  const drift = await probeReadyLocalRuntimeCapabilityOutcome({
    plan: {
      runner: "coven",
      availabilityRunner: "claude",
      availability: {
        state: "ready",
        runner: "opencode",
        resolvedPath: "/private/opencode",
      },
    },
    runner: "coven",
    probe: async () => {
      driftCalls += 1;
      return true;
    },
  });
  assert.equal(drift.ran, false, "an unrelated readiness record never authorizes a probe");
  assert.equal(driftCalls, 0, "a drifted plan never spawns the capability probe");
}

{
  const notReady = await probeReadyLocalRuntimeCapabilityOutcome({
    plan: {
      runner: "coven",
      availability: {
        state: "missing",
        runner: "coven",
        code: "runtime_coven_missing",
        message: "Coven is not installed.",
      },
    },
    runner: "coven",
    probe: async () => true,
  });
  assert.equal(notReady.ran, false);
  assert.equal(
    notReady.ran === false && notReady.reason,
    "Coven is not installed.",
    "a not-ready plan surfaces the underlying availability reason rather than a bare false",
  );

  const noPlan = await probeReadyLocalRuntimeCapabilityOutcome({
    plan: null,
    runner: "coven",
    probe: async () => true,
  });
  assert.equal(noPlan.ran, false);
  assert.match(
    noPlan.ran === false ? noPlan.reason : "",
    /never probed/,
    "a missing plan reports that the capability was never probed",
  );

  const answeredNo = await probeReadyLocalRuntimeCapabilityOutcome({
    plan: {
      runner: "coven",
      availability: { state: "ready", runner: "coven", resolvedPath: "/private/coven" },
    },
    runner: "coven",
    probe: async () => false,
  });
  assert.deepEqual(
    answeredNo,
    { ran: true, value: false },
    "a probe that ran and answered no is not confusable with one that never ran",
  );
}

console.log("local-runtime-capability-gate.test.ts: ok");
