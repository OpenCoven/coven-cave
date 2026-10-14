import assert from "node:assert/strict";
import { test } from "node:test";
import { createOnboardingBootstrapState, type OnboardingBootstrapState } from "./onboarding-bootstrap.ts";
import {
  getOnboardingBootstrapStatusSnapshot,
  publishOnboardingBootstrapState,
  resetOnboardingBootstrapStatus,
  setOnboardingDialogOpen,
  subscribeOnboardingBootstrapStatus,
  summarizeOnboardingBootstrap,
} from "./onboarding-bootstrap-status.ts";

function running(stage: "core-tools" | "workspace" | "daemon", detail: string): OnboardingBootstrapState {
  const base = createOnboardingBootstrapState(true);
  return {
    ...base,
    status: "running",
    activeStage: stage,
    stages: base.stages.map((entry) =>
      entry.id === stage ? { ...entry, status: "running", detail } : entry,
    ),
  };
}

test("summary matrix: unconfirmed or missing state has not run", () => {
  for (const state of [null, createOnboardingBootstrapState(false)]) {
    const summary = summarizeOnboardingBootstrap(state);
    assert.equal(summary.tone, "muted");
    assert.equal(summary.label, "Not run yet");
    assert.equal(summary.actionLabel, "Open setup");
    assert.match(summary.detail, /local components/);
  }
});

test("summary matrix: a running stage is named with its live detail", () => {
  const summary = summarizeOnboardingBootstrap(running("workspace", "Creating user-scoped folders…"));
  assert.deepEqual(summary, {
    tone: "info",
    label: "Setting up — Create Cave defaults…",
    detail: "Creating user-scoped folders…",
    actionLabel: "View setup",
  });
});

test("summary matrix: a failure names the blocked stage and offers Retry setup", () => {
  const base = createOnboardingBootstrapState(true);
  const summary = summarizeOnboardingBootstrap({
    ...base,
    status: "failed",
    activeStage: "daemon",
    failure: {
      stage: "daemon",
      stageLabel: "Start local services",
      message: "The local service did not answer.",
      recoveryLabel: "Retry setup",
    },
  });
  assert.deepEqual(summary, {
    tone: "warning",
    label: "Stopped at Start local services",
    detail: "The local service did not answer.",
    actionLabel: "Retry setup",
  });
});

test("summary matrix: completion is green and only viewable", () => {
  const base = createOnboardingBootstrapState(true);
  const summary = summarizeOnboardingBootstrap({
    ...base,
    status: "complete",
    complete: true,
    needsSetup: false,
  });
  assert.equal(summary.tone, "success");
  assert.equal(summary.label, "Complete");
  assert.equal(summary.actionLabel, "View setup");
});

test("summary matrix: a confirmed but idle run is paused and resumable", () => {
  const summary = summarizeOnboardingBootstrap(createOnboardingBootstrapState(true));
  assert.equal(summary.tone, "info");
  assert.equal(summary.label, "Paused");
  assert.equal(summary.actionLabel, "Open setup");
});

test("summary copy stays free of provider names", () => {
  const samples = [
    summarizeOnboardingBootstrap(null),
    summarizeOnboardingBootstrap(running("core-tools", "Checking…")),
    summarizeOnboardingBootstrap(createOnboardingBootstrapState(true)),
  ];
  for (const summary of samples) {
    assert.doesNotMatch(`${summary.label} ${summary.detail}`, /Codex|Claude|Copilot|OpenClaw/i);
  }
});

test("the store publishes state and dialog visibility to subscribers", () => {
  resetOnboardingBootstrapStatus();
  const seen: Array<ReturnType<typeof getOnboardingBootstrapStatusSnapshot>> = [];
  const unsubscribe = subscribeOnboardingBootstrapStatus(() => {
    seen.push(getOnboardingBootstrapStatusSnapshot());
  });
  const state = running("core-tools", "Preparing…");
  publishOnboardingBootstrapState(state);
  publishOnboardingBootstrapState(state);
  setOnboardingDialogOpen(true);
  setOnboardingDialogOpen(true);
  setOnboardingDialogOpen(false);
  unsubscribe();
  publishOnboardingBootstrapState(null);
  assert.deepEqual(
    seen.map((snapshot) => [snapshot.state?.status ?? null, snapshot.dialogOpen]),
    [["running", false], ["running", true], ["running", false]],
    "identical publishes do not re-notify and unsubscribed listeners stay quiet",
  );
  assert.equal(getOnboardingBootstrapStatusSnapshot().state, null);
  resetOnboardingBootstrapStatus();
});
