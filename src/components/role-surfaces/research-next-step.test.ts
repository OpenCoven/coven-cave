import assert from "node:assert/strict";
import test from "node:test";
import {
  researchAutomationHealth,
  researchNextStep,
} from "./research-next-step.ts";
import { allowedResearchActions, type ResearchMission } from "@/lib/research-missions.ts";

function mission(overrides: Partial<ResearchMission> = {}): ResearchMission {
  return {
    version: 1,
    id: "research-11111111-2222-3333-4444-555555555555",
    familiarId: "sage",
    title: "Probe",
    intent: "Probe intent long enough to be valid.",
    mode: "brief",
    modeSource: "user",
    deliverable: "One sentence.",
    constraints: [],
    bounds: {
      wallClockMinutes: 10,
      maxIterations: 3,
      sourceTarget: 5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "running",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    iterations: [{ number: 2, status: "running" }],
    artifacts: [],
    sources: [],
    ...overrides,
  };
}

test("the described actions never disagree with the real ones", () => {
  // The whole point of deriving this: a state that gains or loses an action
  // cannot end up with a stale sentence describing it.
  for (const status of [
    "queued", "planning", "running", "checkpoint",
    "paused", "failed", "completed", "cancelled", "archived",
  ] as const) {
    const m = mission({ status });
    assert.deepEqual(
      researchNextStep(m).actions,
      allowedResearchActions(m),
      `${status} must report exactly the actions the buttons offer`,
    );
  }
});

test("a running mission waits on the familiar and says so", () => {
  const step = researchNextStep(mission({ status: "running" }));
  assert.equal(step.waitingOn, "familiar");
  assert.match(step.headline, /Pass 2 of 3 is running/);
});

test("a checkpoint states that it will NOT resume on its own", () => {
  const step = researchNextStep(mission({ status: "checkpoint" }));
  assert.equal(step.waitingOn, "you");
  // The single most misread state: it looks stalled but is waiting on a person.
  assert.match(step.detail, /will not continue on its own/i);
  assert.equal(step.primaryAction, "continue");
});

test("a failure surfaces its recorded cause rather than hiding it", () => {
  const step = researchNextStep(mission({ status: "failed", lastError: "Copilot exited with code 3." }));
  assert.equal(step.waitingOn, "you");
  assert.match(step.detail, /Copilot exited with code 3\./);
  assert.equal(step.primaryAction, "retry");
});

test("a finished mission asks nothing of anyone", () => {
  const step = researchNextStep(mission({
    status: "completed",
    sources: [{ id: "s1", title: "One", sourceType: "web", status: "used" }],
  }));
  assert.equal(step.waitingOn, "nobody");
  assert.match(step.detail, /1 source gathered/);
});

test("an ACTIVE schedule whose last run failed is reported as failing, not healthy", () => {
  // This is the "are automations working?" question: printing ACTIVE alone
  // says yes when the answer is no.
  const health = researchAutomationHealth(mission({
    automation: {
      id: "a1",
      rrule: "FREQ=DAILY",
      status: "ACTIVE",
      checkpointFingerprint: "f",
      lastRunStatus: "failed",
    },
  }));
  assert.equal(health.state, "failing");
  assert.match(health.detail, /still on and will try again/i);
});

test("a stop reason outranks the on/off switch", () => {
  const health = researchAutomationHealth(mission({
    automation: {
      id: "a1",
      rrule: "FREQ=DAILY",
      status: "ACTIVE",
      checkpointFingerprint: "f",
      stopReason: "Budget exhausted.",
    },
  }));
  assert.equal(health.state, "stopped");
  assert.match(health.detail, /Budget exhausted\./);
});

test("an on schedule with no history does not claim a successful past", () => {
  const health = researchAutomationHealth(mission({
    automation: { id: "a1", rrule: "FREQ=DAILY", status: "ACTIVE", checkpointFingerprint: "f" },
  }));
  assert.equal(health.state, "healthy");
  assert.match(health.detail, /No scheduled pass has run yet/);
});

test("no automation reads as unscheduled rather than broken", () => {
  const health = researchAutomationHealth(mission());
  assert.equal(health.state, "none");
  assert.match(health.detail, /only when you start a pass/);
});
