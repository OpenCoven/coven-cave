import assert from "node:assert/strict";
import test from "node:test";
import {
  createOnboardingBootstrapState,
  normalizeResumableBootstrapState,
  onboardingBootstrapPlatformPolicy,
  runOnboardingBootstrapStages,
  startSerializedOnboardingBootstrapRun,
  type OnboardingBootstrapRunners,
  type OnboardingBootstrapState,
  type OnboardingBootstrapStageId,
} from "./onboarding-bootstrap.ts";

for (const platform of ["darwin", "linux", "win32"] as const) {
  const policy = onboardingBootstrapPlatformPolicy(platform);
  assert.deepEqual(
    policy,
    {
      supported: true,
      requiresElevation: false,
      gitRequired: false,
      providerAuthentication: "deferred",
    },
    `${platform} uses the same no-elevation, Git-optional, deferred-auth contract`,
  );
}

test("bootstrap runs one serialized stage sequence and preserves skip outcomes", async () => {
  const calls: OnboardingBootstrapStageId[] = [];
  const runners: OnboardingBootstrapRunners = {
    "core-tools": async () => {
      calls.push("core-tools");
      return { ok: true, skipped: true, detail: "Existing components kept." };
    },
    workspace: async () => {
      calls.push("workspace");
      return { ok: true, skipped: false, detail: "Defaults created." };
    },
    daemon: async () => {
      calls.push("daemon");
      return { ok: true, skipped: false, detail: "Service started." };
    },
  };
  const states: OnboardingBootstrapState[] = [];
  const result = await runOnboardingBootstrapStages(
    createOnboardingBootstrapState(),
    runners,
    async (state) => {
      states.push(structuredClone(state));
    },
  );

  assert.deepEqual(calls, ["core-tools", "workspace", "daemon"]);
  assert.equal(result.complete, true);
  assert.equal(result.status, "complete");
  assert.equal(result.stages[0]?.status, "skipped");
  assert.equal(result.stages[1]?.status, "complete");
  assert.ok(
    states.every(
      (state) =>
        state.stages.filter((stage) => stage.status === "running").length <= 1,
    ),
    "only one visible stage runs at a time",
  );
});

test("bootstrap stops on the blocked stage with one retry action", async () => {
  const calls: OnboardingBootstrapStageId[] = [];
  const result = await runOnboardingBootstrapStages(
    createOnboardingBootstrapState(true),
    {
      "core-tools": async () => {
        calls.push("core-tools");
        return { ok: true, skipped: false, detail: "Components ready." };
      },
      workspace: async () => {
        calls.push("workspace");
        return {
          ok: false,
          message:
            "Setup stopped at Create Cave defaults. Check that ~/.coven is writable, then retry setup.",
        };
      },
      daemon: async () => {
        calls.push("daemon");
        return { ok: true, skipped: false, detail: "Service started." };
      },
    },
    async () => undefined,
  );

  assert.deepEqual(calls, ["core-tools", "workspace"]);
  assert.equal(result.status, "failed");
  assert.equal(result.failure?.stage, "workspace");
  assert.equal(result.failure?.recoveryLabel, "Retry setup");
  assert.equal(
    result.stages.filter((stage) => stage.status === "failed").length,
    1,
  );
});

test("bootstrap preserves the stable code and safe diagnostic snapshot on failure", async () => {
  const diagnostics = {
    version: 1 as const,
    capturedAt: "2026-08-10T12:34:56.000Z",
    stage: "core-tools" as const,
    code: "download_failed" as const,
    summary: "Cave couldn’t download its local components.",
    nextStep: "Check your connection, then retry setup.",
    environment: {
      appVersion: "1.2.3",
      platform: "linux" as const,
      architecture: "x64" as const,
    },
    applicationData: {
      displayLocation: "Cave application data" as const,
      exists: true,
      writeProbe: "passed" as const,
    },
    components: {
      managedNode: "missing" as const,
      covenCli: "missing" as const,
      localService: "not_checked" as const,
    },
  };
  const result = await runOnboardingBootstrapStages(
    createOnboardingBootstrapState(true),
    {
      "core-tools": async () => ({
        ok: false,
        code: "download_failed",
        nextStep: diagnostics.nextStep,
        diagnostics,
        message: `Setup stopped at Prepare local components. ${diagnostics.summary} ${diagnostics.nextStep}`,
      }),
      workspace: async () => ({ ok: true, skipped: false, detail: "unused" }),
      daemon: async () => ({ ok: true, skipped: false, detail: "unused" }),
    },
    async () => undefined,
  );

  assert.equal(result.failure?.code, "download_failed");
  assert.equal(result.failure?.nextStep, diagnostics.nextStep);
  assert.deepEqual(result.failure?.diagnostics, diagnostics);
});

test("retry clears the prior failure and resumes at the first incomplete stage", async () => {
  const state = createOnboardingBootstrapState(true);
  state.status = "failed";
  state.activeStage = "workspace";
  state.stages[0]!.status = "complete";
  state.stages[1]!.status = "failed";
  state.failure = {
    stage: "workspace",
    stageLabel: "Create Cave defaults",
    message: "Previous safe failure.",
    recoveryLabel: "Retry setup",
    code: "filesystem_failed",
  };
  const calls: OnboardingBootstrapStageId[] = [];
  const result = await runOnboardingBootstrapStages(
    state,
    {
      "core-tools": async () => {
        calls.push("core-tools");
        return { ok: true, skipped: false, detail: "unused" };
      },
      workspace: async () => {
        calls.push("workspace");
        return { ok: true, skipped: false, detail: "Defaults ready." };
      },
      daemon: async () => {
        calls.push("daemon");
        return { ok: true, skipped: false, detail: "Service ready." };
      },
    },
    async () => undefined,
  );

  assert.deepEqual(calls, ["workspace", "daemon"]);
  assert.equal(result.failure, null);
  assert.equal(result.complete, true);
  assert.equal(result.stages[0]?.status, "complete");
});

test("a persisted running stage becomes resumable without losing completed work", () => {
  const state = createOnboardingBootstrapState(true);
  state.status = "running";
  state.activeStage = "workspace";
  state.stages[0]!.status = "complete";
  state.stages[1]!.status = "running";

  const resumed = normalizeResumableBootstrapState(state);
  assert.equal(resumed.status, "idle");
  assert.equal(resumed.activeStage, null);
  assert.equal(resumed.stages[0]?.status, "complete");
  assert.equal(resumed.stages[1]?.status, "pending");
});

test("concurrent bootstrap starts share one process-wide run", async () => {
  const slot = { run: null as Promise<OnboardingBootstrapState> | null };
  let starts = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const factory = async () => {
    starts += 1;
    await gate;
    return createOnboardingBootstrapState(true);
  };

  const first = startSerializedOnboardingBootstrapRun(slot, factory);
  const second = startSerializedOnboardingBootstrapRun(slot, factory);

  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(first.run, second.run);
  assert.equal(starts, 1);

  release?.();
  await first.run;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(slot.run, null);
});

console.log("onboarding-bootstrap.test.ts: ok");
