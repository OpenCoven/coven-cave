import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createOnboardingBootstrapState,
  runOnboardingBootstrapStages,
  type OnboardingSetupDiagnostics,
} from "../onboarding-bootstrap.ts";
import {
  bootstrapRunFailureState,
  ensureDaemon,
  persistOnboardingBootstrapState,
  safePersistedState,
} from "./onboarding-bootstrap.ts";

function failedDownloadState() {
  const state = createOnboardingBootstrapState(true);
  const diagnostics: OnboardingSetupDiagnostics = {
    version: 1,
    capturedAt: "2026-08-10T12:34:56.000Z",
    stage: "core-tools",
    code: "download_failed",
    summary: "ignored persisted summary",
    nextStep: "ignored persisted recovery",
    environment: {
      appVersion: "ignored persisted version",
      platform: "linux",
      architecture: "x64",
    },
    applicationData: {
      displayLocation: "Cave application data",
      exists: true,
      writeProbe: "not_run",
    },
    components: {
      managedNode: "missing",
      covenCli: "missing",
      localService: "not_checked",
    },
    installer: {
      target: "managed-node",
      status: "done",
      elapsedMs: 50,
      exitCode: 1,
      outputTail: [
        "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456",
        "/home/sage/private/archive EAI_AGAIN",
      ],
    },
  };
  state.status = "failed";
  state.activeStage = "core-tools";
  state.stages[0]!.status = "failed";
  state.failure = {
    stage: "core-tools",
    stageLabel: "Prepare local components",
    message: "raw token=super-secret",
    recoveryLabel: "Retry setup",
    code: "download_failed",
    diagnostics,
  };
  return state;
}

test("bootstrap persistence writes only the sanitized allowlisted state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-bootstrap-state-"));
  try {
    await persistOnboardingBootstrapState(failedDownloadState(), {
      directory: root,
    });
    const serialized = await readFile(
      path.join(root, "onboarding-bootstrap.json"),
      "utf8",
    );
    assert.doesNotMatch(
      serialized,
      /super-secret|ghp_|Authorization|\/home\/sage|ignored persisted/,
    );
    assert.match(serialized, /download_failed/);
    assert.match(serialized, /EAI_AGAIN/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mismatched persisted diagnostic metadata is rejected", () => {
  const state = failedDownloadState();
  state.failure!.diagnostics = {
    ...state.failure!.diagnostics!,
    stage: "workspace",
    code: "archive_failed",
  };
  const safe = safePersistedState(state);

  assert.equal(safe.failure?.code, "download_failed");
  assert.equal(safe.failure?.diagnostics, undefined);
});

test("legacy permission prose without a failed probe is replaced with neutral recovery copy", () => {
  const state = failedDownloadState();
  state.failure!.code = "application_data_not_writable";
  delete state.failure!.diagnostics;
  state.failure!.message =
    "Setup stopped at Prepare local components. Check that your user application-data folder is writable, then retry setup.";
  state.stages[0]!.detail = state.failure!.message;

  const safe = safePersistedState(state);

  assert.equal(safe.failure?.code, "filesystem_failed");
  assert.doesNotMatch(safe.failure?.message ?? "", /application-data folder|writable/i);
  assert.doesNotMatch(safe.stages[0]?.detail ?? "", /application-data folder|writable/i);
  assert.match(safe.stages[0]?.detail ?? "", /files needed for setup/i);
});

test("a contradictory persisted failure normalizes to a resumable setup run", async () => {
  const state = failedDownloadState();
  state.complete = true;
  state.needsSetup = false;
  state.status = "complete";

  const safe = safePersistedState(state);
  assert.equal(safe.complete, false);
  assert.equal(safe.needsSetup, true);
  assert.equal(safe.status, "failed");

  let coreToolsRuns = 0;
  const published = [] as string[];
  const resumed = await runOnboardingBootstrapStages(
    safe,
    {
      "core-tools": async () => {
        coreToolsRuns += 1;
        return { ok: true, skipped: false, detail: "Local components are ready." };
      },
      workspace: async () => ({ ok: true, skipped: false, detail: "Workspace is ready." }),
      daemon: async () => ({ ok: true, skipped: false, detail: "Local service is ready." }),
    },
    async (next) => {
      published.push(next.status);
    },
  );

  assert.equal(coreToolsRuns, 1, "retry runs the reconstructed failed stage");
  assert.equal(published[0], "running", "resume no longer returns the contradictory complete state");
  assert.equal(resumed.complete, true);
  assert.equal(resumed.failure, null);
});

test("a persistence error never replaces an existing structured stage failure", async () => {
  const current = failedDownloadState();
  const failed = await bootstrapRunFailureState(current, {
    persistenceFailed: true,
    probePersistenceDirectory: async () => ({
      exists: true,
      writeProbe: "failed",
    }),
  });

  assert.equal(failed, current);
  assert.equal(failed.failure?.code, "download_failed");
});

test("a state-file write failure uses the exact persistence-directory probe", async () => {
  const current = createOnboardingBootstrapState(true);
  current.status = "complete";
  current.complete = true;
  current.needsSetup = false;
  current.activeStage = "workspace";
  current.stages[1]!.status = "running";
  let probes = 0;
  const failed = await bootstrapRunFailureState(current, {
    persistenceFailed: true,
    probePersistenceDirectory: async () => {
      probes += 1;
      return { exists: true, writeProbe: "failed" };
    },
  });

  assert.equal(probes, 1);
  assert.equal(failed.complete, false);
  assert.equal(failed.needsSetup, true);
  assert.equal(failed.status, "failed");
  assert.equal(failed.failure?.code, "application_data_not_writable");
  assert.equal(failed.failure?.diagnostics?.applicationData.writeProbe, "failed");
});

test("daemon failure keeps checked readiness and startup facts through saved state", async () => {
  const result = await ensureDaemon(async () => {}, {
    inspectReady: async () => false,
    start: async () => ({ ok: false, code: "readiness_timeout", error: "RAW_PRIVATE_SECRET", stdout: "RAW_PRIVATE_SECRET", stderr: "RAW_PRIVATE_SECRET", status: 504, readinessAttempts: 20, elapsedMs: 15000, launchMode: "service" }),
    inspectTools: async () => ({ runtimeReady: true, coreToolsReady: true, components: { managedNode: "ready", covenCli: "ready" } }),
    inspectDirectory: async () => true,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.diagnostics?.components.managedNode, "ready");
  assert.equal(result.diagnostics?.components.covenCli, "ready");
  assert.equal(result.diagnostics?.applicationData.exists, true);
  assert.equal(result.diagnostics?.applicationData.writeProbe, "not_run");
  assert.equal(result.diagnostics?.service?.code, "readiness_timeout");
  const state = createOnboardingBootstrapState(true);
  state.failure = { stage: "daemon", stageLabel: "Start local services", recoveryLabel: "Retry setup", ...result };
  const restored = safePersistedState(state);
  assert.equal(restored.failure?.nextStep, result.nextStep);
  assert.match(restored.failure!.message, /did not become ready in time/);
  assert.doesNotMatch(JSON.stringify(restored), /RAW_PRIVATE_SECRET/);
});

test("diagnostic probe failures do not erase the daemon failure", async () => {
  const result = await ensureDaemon(async () => {}, {
    inspectReady: async () => false,
    start: async () => ({ ok: false, code: "spawn_failed", error: "RAW_PRIVATE_SECRET", stdout: "", stderr: "", status: 500, readinessAttempts: 1, elapsedMs: 2, launchMode: "direct" }),
    inspectTools: async () => { throw new Error("probe failed"); },
    inspectDirectory: async () => { throw new Error("probe failed"); },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.diagnostics?.service?.code, "spawn_failed");
  assert.equal(result.diagnostics?.applicationData.exists, null);
});

console.log("server onboarding-bootstrap.test.ts: ok");
