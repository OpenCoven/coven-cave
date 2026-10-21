import assert from "node:assert/strict";
import { test } from "node:test";
import { createOnboardingBootstrapState, type OnboardingBootstrapState } from "./onboarding-bootstrap.ts";
import {
  getOnboardingBootstrapStatusSnapshot,
  fetchOnboardingBootstrapStatus,
  publishOnboardingBootstrapState,
  resetOnboardingBootstrapStatus,
  setOnboardingDialogOpen,
  subscribeOnboardingBootstrapStatus,
  subscribeOnboardingBootstrapCompletion,
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


test("setup completion notifies once per successful run and never treats failure as readiness", () => {
  resetOnboardingBootstrapStatus();
  let completions = 0;
  const unsubscribe = subscribeOnboardingBootstrapCompletion(() => { completions += 1; });
  const complete = { ...createOnboardingBootstrapState(true), status: "complete" as const, complete: true, needsSetup: false };
  publishOnboardingBootstrapState(running("daemon", "Starting…"));
  publishOnboardingBootstrapState({ ...complete, status: "failed" });
  publishOnboardingBootstrapState({ ...complete, complete: false });
  assert.equal(completions, 0, "only successful complete state can request verification");
  publishOnboardingBootstrapState(complete);
  publishOnboardingBootstrapState({ ...complete, updatedAt: "2026-10-21T05:00:01Z" });
  setOnboardingDialogOpen(true);
  setOnboardingDialogOpen(false);
  assert.equal(completions, 1, "snapshot copies and dialog changes cannot repeat verification");
  publishOnboardingBootstrapState(running("daemon", "Starting again…"));
  publishOnboardingBootstrapState({ ...complete, updatedAt: "2026-10-21T05:00:02Z" });
  assert.equal(completions, 2, "a subsequent explicit run can reconcile again");
  unsubscribe();
  publishOnboardingBootstrapState(running("daemon", "Starting after unmount…"));
  publishOnboardingBootstrapState(complete);
  assert.equal(completions, 2, "an unmounted owner cannot issue more verification");
  resetOnboardingBootstrapStatus();
});

test("a completion subscriber ignores retained history and consumes the edge before calling back", () => {
  resetOnboardingBootstrapStatus();
  const complete = { ...createOnboardingBootstrapState(true), status: "complete" as const, complete: true, needsSetup: false };
  const finishedAgain = { ...complete, updatedAt: new Date(Date.parse(complete.updatedAt) + 1).toISOString() };
  publishOnboardingBootstrapState(complete);
  let completions = 0;
  const unsubscribe = subscribeOnboardingBootstrapCompletion(() => {
    completions += 1;
    if (completions === 1) publishOnboardingBootstrapState({ ...finishedAgain });
  });
  publishOnboardingBootstrapState({ ...complete });
  assert.equal(completions, 0, "mounting beside a finished setup does not replay its completion");
  publishOnboardingBootstrapState(running("daemon", "Starting…"));
  publishOnboardingBootstrapState(finishedAgain);
  assert.equal(completions, 1, "re-entrant publication does not create another completion edge");
  unsubscribe();
  resetOnboardingBootstrapStatus();
});

test("a late running response cannot replay a completion already observed by another reader", async (context) => {
  resetOnboardingBootstrapStatus();
  const active = { ...running("daemon", "Starting…"), updatedAt: "2026-10-21T05:00:00Z" };
  const complete = { ...active, status: "complete" as const, complete: true, needsSetup: false, updatedAt: "2026-10-21T05:00:01Z" };
  let releaseOldRead!: (response: Response) => void;
  let read = 0;
  context.mock.method(globalThis, "fetch", async () => {
    read += 1;
    if (read === 1) return new Promise<Response>((resolve) => { releaseOldRead = resolve; });
    return Response.json({ ok: true, ...complete });
  });
  let completions = 0;
  const unsubscribe = subscribeOnboardingBootstrapCompletion(() => { completions += 1; });
  try {
    publishOnboardingBootstrapState(active);
    const oldDialogRead = fetchOnboardingBootstrapStatus();
    await fetchOnboardingBootstrapStatus();
    assert.equal(completions, 1);
    releaseOldRead(Response.json({ ok: true, ...active }));
    await oldDialogRead;
    await fetchOnboardingBootstrapStatus();
    assert.equal(completions, 1, "one completed run still owns only one health recheck after reordered responses");
    publishOnboardingBootstrapState({ ...active, updatedAt: "2026-10-21T05:00:02Z" });
    publishOnboardingBootstrapState({ ...complete, updatedAt: "2026-10-21T05:00:03Z" });
    assert.equal(completions, 2, "a distinct later completion still reconciles");
  } finally {
    unsubscribe();
    resetOnboardingBootstrapStatus();
  }
});
