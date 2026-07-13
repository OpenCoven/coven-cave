import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultResearchPlan,
  inferResearchMissionMode,
} from "./research-mission-routing.ts";
import {
  allowedResearchActions,
  normalizeResearchBounds,
  validateCreateResearchMissionInput,
} from "./research-missions.ts";

test("Auto-routing is explainable and ambiguous work never loops", () => {
  assert.deepEqual(inferResearchMissionMode("Compare local-first note apps"), {
    mode: "brief",
    reason: "comparison or recommendation request",
  });
  assert.deepEqual(inferResearchMissionMode("Map the database landscape"), {
    mode: "sweep",
    reason: "broad landscape or exhaustive-source request",
  });
  assert.equal(inferResearchMissionMode("Write a literature review").mode, "paper");
  assert.equal(
    inferResearchMissionMode("Run experiments until accuracy plateaus").mode,
    "autoresearch",
  );
  assert.deepEqual(inferResearchMissionMode("Research mushrooms"), {
    mode: "brief",
    reason: "safe default for an ambiguous request",
  });
});

test("mode defaults are finite and match the approved review contract", () => {
  assert.deepEqual(defaultResearchPlan("brief"), {
    mode: "brief",
    deliverables: ["brief"],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 1,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
  });
  assert.equal(defaultResearchPlan("sweep").bounds.sourceTarget, 12);
  assert.equal(defaultResearchPlan("paper").bounds.sourceTarget, 8);
  assert.equal(defaultResearchPlan("autoresearch").bounds.maxIterations, 6);
  assert.equal(defaultResearchPlan("autoresearch").bounds.wallClockMinutes, 240);
  assert.equal(defaultResearchPlan("autoresearch").bounds.stopWhenCostUnavailable, true);
});

test("active work cannot be double-started and checkpoints expose refinement", () => {
  assert.deepEqual(allowedResearchActions({ status: "running" }), ["cancel"]);
  assert.deepEqual(allowedResearchActions({ status: "checkpoint" }), [
    "continue",
    "refine",
    "finish",
    "cancel",
    "archive",
  ]);
  assert.deepEqual(allowedResearchActions({ status: "archived" }), []);
});

test("invalid and out-of-product bounds are rejected", () => {
  assert.equal(normalizeResearchBounds({ wallClockMinutes: Infinity }).ok, false);
  assert.equal(normalizeResearchBounds({ maxIterations: 0 }).ok, false);
  assert.equal(normalizeResearchBounds({ wallClockMinutes: 24 * 60 + 1 }).ok, false);
  assert.equal(normalizeResearchBounds({ maxIterations: 101 }).ok, false);
  assert.deepEqual(
    normalizeResearchBounds({
      wallClockMinutes: 30,
      maxIterations: 2,
      sourceTarget: 10,
      maxSpendUsd: 4.5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    }),
    {
      ok: true,
      value: {
        wallClockMinutes: 30,
        maxIterations: 2,
        sourceTarget: 10,
        maxSpendUsd: 4.5,
        checkpointEvery: 1,
        stopWhenCostUnavailable: true,
      },
    },
  );
});

test("mission creation validates familiar, intent, mode, and bounded input", () => {
  const bounds = {
    wallClockMinutes: 20,
    maxIterations: 1,
    sourceTarget: 6,
    checkpointEvery: 1,
    stopWhenCostUnavailable: false,
  };
  assert.equal(validateCreateResearchMissionInput({ intent: "x", bounds }).ok, false);
  assert.equal(
    validateCreateResearchMissionInput({
      familiarId: "sage",
      intent: "Compare two databases",
      mode: "brief",
      modeSource: "auto",
      deliverable: "brief",
      bounds,
    }).ok,
    true,
  );
  assert.equal(
    validateCreateResearchMissionInput({
      familiarId: "../sage",
      intent: "Compare two databases",
      mode: "brief",
      modeSource: "auto",
      deliverable: "brief",
      bounds,
    }).ok,
    false,
  );
});
