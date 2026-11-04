// @ts-nocheck
import assert from "node:assert/strict";
import {
  bindingReadinessStep,
  covenCliReadinessStep,
  classifyCommandPathFailure,
  environmentDiscoveryState,
  isConfirmedCommandMissing,
  isConfirmedMissingPath,
  onboardingStatusPayload,
  withinDeadline,
} from "./onboarding-status-probes.ts";

function controlledTimer() {
  let callback: (() => void) | null = null;
  let scheduled = 0;
  let cancelled = 0;
  const handle = {};
  return {
    options: {
      now: () => 0,
      schedule: (next: () => void) => {
        scheduled += 1;
        callback = next;
        return handle;
      },
      cancel: (value: unknown) => {
        assert.equal(value, handle);
        cancelled += 1;
      },
    },
    expire: () => {
      assert.ok(callback, "deadline timer was installed");
      callback();
    },
    scheduled: () => scheduled,
    cancelled: () => cancelled,
  };
}

{
  const timer = controlledTimer();
  const result = await withinDeadline(
    () => Promise.resolve("found"),
    100,
    timer.options,
  );
  assert.deepEqual(result, { state: "ready", value: "found" });
  assert.equal(timer.cancelled(), 1, "successful probes clear their deadline timer");
}

{
  const timer = controlledTimer();
  const result = await withinDeadline(
    () => Promise.reject(new Error("probe exploded")),
    100,
    timer.options,
  );
  assert.deepEqual(result, { state: "unavailable", value: null });
  assert.equal(timer.cancelled(), 1, "rejected probes clear their deadline timer");
}

{
  const timer = controlledTimer();
  let invoked = false;
  const result = await withinDeadline(
    () => {
      invoked = true;
      return Promise.resolve("too late");
    },
    0,
    timer.options,
  );
  assert.deepEqual(result, { state: "unavailable", value: null });
  assert.equal(invoked, false, "expired work is never started");
  assert.equal(timer.scheduled(), 0, "expired work does not install a timer");
}

{
  const timer = controlledTimer();
  const resultPromise = withinDeadline(
    () => new Promise<string>(() => {}),
    100,
    timer.options,
  );
  timer.expire();
  assert.deepEqual(await resultPromise, { state: "unavailable", value: null });
  assert.equal(timer.cancelled(), 1, "timed-out probes clear their timer");
}

{
  const timer = controlledTimer();
  let rejectLate!: (error: Error) => void;
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    const resultPromise = withinDeadline(
      () => new Promise<string>((_resolve, reject) => {
        rejectLate = reject;
      }),
      100,
      timer.options,
    );
    timer.expire();
    assert.deepEqual(await resultPromise, { state: "unavailable", value: null });
    rejectLate(new Error("late rejection"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, [], "late probe rejection remains observed after timeout");
    assert.equal(timer.cancelled(), 1);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
}

assert.equal(isConfirmedCommandMissing({ code: 1 }), true);
assert.equal(isConfirmedCommandMissing({ code: "EACCES" }), false);
assert.equal(isConfirmedCommandMissing({ code: "ETIMEDOUT" }), false);
assert.equal(isConfirmedMissingPath({ code: "ENOENT" }), true);
assert.equal(isConfirmedMissingPath({ code: "EACCES" }), false);

const exhaustedDiscovery = environmentDiscoveryState(2_000, 2_000);
assert.equal(exhaustedDiscovery, "unavailable");
const incompletePathMiss = classifyCommandPathFailure(
  { code: 1 },
  exhaustedDiscovery,
);
assert.equal(
  incompletePathMiss,
  "unavailable",
  "which exit 1 cannot prove absence after environment discovery exhausts its budget",
);
const incompletePathStep = {
  ok: false,
  state: incompletePathMiss,
  hint: "Try again later.",
};
assert.equal(
  onboardingStatusPayload({ covenCli: incompletePathStep }, null).mayContinue,
  true,
  "incomplete environment evidence remains fail-open",
);

const bindingInput = {
  defaults: { harness: "openclaw", model: "gpt-5" },
  familiarsAvailable: true,
  daemonState: "ready" as const,
  reports: [],
  openClawAgentCount: 0,
};

assert.deepEqual(
  bindingReadinessStep({
    ...bindingInput,
    runtimeEvidenceState: "unavailable",
  }),
  {
    ok: false,
    state: "unavailable",
    hint: "Couldn’t verify the runtime for your default binding. You can continue and retry later.",
  },
  "missing runtime evidence is advisory uncertainty, not a missing-runtime claim",
);

const confirmedMissingBinding = bindingReadinessStep({
  ...bindingInput,
  runtimeEvidenceState: "ready",
});
assert.equal(confirmedMissingBinding.state, "action-required");
assert.match(
  confirmedMissingBinding.hint ?? "",
  /has no installed runtime or OpenClaw agent/,
  "completed probes retain the honest missing-runtime action",
);

const unavailableStep = {
  ok: false,
  state: "unavailable" as const,
  hint: "Try again later.",
};
assert.deepEqual(
  onboardingStatusPayload({ covenCli: unavailableStep }, null),
  {
    ok: true,
    complete: false,
    mayContinue: true,
    steps: { covenCli: unavailableStep },
    tools: null,
  },
  "required uncertainty fails open while preserving null tool evidence",
);

console.log("onboarding-status-probes.test.ts: ok");

// Exercise actual local fact composition through the readiness consumer.
const { composeOpenCovenToolReadinessStatus, OPEN_COVEN_TOOLS } = await import("./opencoven-tools-status.ts");
const cliProbe = {
  path: "/synthetic/bin/coven", executablePath: "/synthetic/node_modules/@opencoven/cli/bin/coven.js",
  executableVerified: true, packageName: "@opencoven/cli", packagePath: "/synthetic/node_modules/@opencoven/cli",
  version: "0.4.10-110-ga95aa9ed",
};
const cliStatus = (patch = {}) => composeOpenCovenToolReadinessStatus(OPEN_COVEN_TOOLS[0], { ...cliProbe, ...patch });
const unverifiedStep = covenCliReadinessStep(cliStatus({ packageName: null, packagePath: null, executableVerified: false }), { state: "ready" });
assert.equal(unverifiedStep.ok, false);
assert.match(unverifiedStep.detail, /unverified/i);
assert.doesNotMatch(unverifiedStep.detail, /below|minimum/i);
assert.match(unverifiedStep.hint, /Repair Coven CLI/);
assert.match(unverifiedStep.hint, /reviewed/);
const unreadableStep = covenCliReadinessStep(cliStatus({ version: null, error: "version-probe-failed" }), { state: "ready" });
assert.equal(unreadableStep.ok, false);
assert.match(unreadableStep.detail, /unreadable/i);
assert.match(unreadableStep.hint, /Repair Coven CLI/);
const oldStep = covenCliReadinessStep(cliStatus({ version: "0.3.9" }), { state: "ready" });
assert.equal(oldStep.ok, false);
assert.match(oldStep.detail, /minimum.*0\.4\.0/i);
assert.match(oldStep.hint, /Update Coven CLI/);
const repairedStep = covenCliReadinessStep(cliStatus(), { state: "ready" });
assert.equal(repairedStep.ok, true);
assert.match(repairedStep.detail, /0\.4\.10-110-ga95aa9ed/);
assert.equal(repairedStep.hint, undefined);
const missingCli = cliStatus({ path: null, executablePath: null, executableVerified: false, packageName: null, packagePath: null, version: null });
const missingStep = covenCliReadinessStep(missingCli, { state: "absent" });
assert.equal(missingStep.ok, false);
assert.match(missingStep.hint, /Install.*reviewed/);
for (const [tool, pathProbe] of [
  [undefined, { state: "unavailable" }],
  [missingCli, { state: "unavailable" }],
  [missingCli, { state: "ready" }],
  [{ ...missingCli, discoveryError: "lookup-failed" }, { state: "absent" }],
]) {
  const step = covenCliReadinessStep(tool, pathProbe);
  assert.equal(step.state, "unavailable");
  assert.equal(step.ok, false);
  assert.equal(onboardingStatusPayload({ covenCli: step }, [tool]).tools, null);
}

const brokenLauncher = covenCliReadinessStep(cliStatus({ version: null, executablePath: null, executableVerified: false, error: "launcher-unreadable" }), { state: "ready" });
assert.equal(brokenLauncher.ok, false);
assert.match(brokenLauncher.hint, /Repair Coven CLI/);
assert.notEqual(onboardingStatusPayload({ covenCli: brokenLauncher }, [missingCli]).tools, null);
