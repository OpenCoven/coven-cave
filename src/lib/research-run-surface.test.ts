import assert from "node:assert/strict";
import test from "node:test";
import {
  extractResearchRunMarkers,
  researchMissionToRunSurface,
} from "./research-run-surface.ts";
import type { ResearchMission } from "./research-missions.ts";

function mission(): ResearchMission {
  return {
    version: 1,
    id: "run-1",
    familiarId: "sage",
    title: "Dependency risk research",
    intent: "Compare dependency risk across the selected systems.",
    mode: "paper",
    modeSource: "user",
    deliverable: "Decision memo",
    constraints: [],
    bounds: {
      wallClockMinutes: 30,
      maxIterations: 2,
      sourceTarget: 10,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    },
    harness: "codex",
    model: "gpt-5",
    status: "running",
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:05:00.000Z",
    startedAt: "2026-08-22T10:01:00.000Z",
    iterations: [{
      number: 1,
      status: "running",
      steps: [
        { id: "scope", type: "scope", status: "succeeded", detail: "Scope fixed" },
        { id: "gather", type: "gather", status: "running", detail: "Reviewing incidents" },
        { id: "synthesize", type: "synthesize", status: "pending" },
      ],
    }],
    artifacts: [{
      key: "primary",
      kind: "paper",
      title: "Primary",
      relativePath: "artifacts/primary.md",
      iteration: 1,
      state: "working",
      updatedAt: "2026-08-22T10:05:00.000Z",
    }],
    sources: [
      { id: "s1", title: "One", sourceType: "web", status: "used" },
      { id: "s2", title: "Two", sourceType: "web", status: "rejected" },
    ],
  };
}

test("mission adapter produces one canonical surface model", () => {
  const run = researchMissionToRunSurface(mission());

  assert.equal(run.runId, "run-1");
  assert.equal(run.status, "running");
  assert.equal(run.activity, "Reviewing incidents");
  assert.equal(run.runtime, "codex · gpt-5");
  assert.deepEqual(run.steps.map((step) => step.status), ["completed", "active", "pending"]);
  assert.deepEqual(run.evidence, {
    reviewed: 2,
    retained: 1,
    rejected: 1,
    artifacts: 1,
  });
});

test("chat research markers are removed from prose and projected as snapshots", () => {
  const parsed = extractResearchRunMarkers([
    "I started the research.",
    '<coven:research run-id="run-1" title="Dependency risk" status="running" familiar="sage" skill="research:paper" activity="Reviewing incidents" step="2" total="5" reviewed="12" retained="7" cited="3" artifacts="1" />',
  ].join("\n"));

  assert.equal(parsed.visible.trim(), "I started the research.");
  assert.equal(parsed.runs.length, 1);
  assert.equal(parsed.runs[0]?.runId, "run-1");
  assert.equal(parsed.runs[0]?.steps.length, 5);
  assert.equal(parsed.runs[0]?.steps[0]?.status, "completed");
  assert.equal(parsed.runs[0]?.steps[1]?.status, "active");
  assert.equal(parsed.runs[0]?.evidence.reviewed, 12);
  assert.equal(parsed.runs[0]?.evidence.cited, 3);
});

test("the final marker for a run wins and fenced examples stay literal", () => {
  const parsed = extractResearchRunMarkers([
    '<coven:research run-id="run-1" title="Risk" status="planning" />',
    '<coven:research run-id="run-1" title="Risk" status="running" activity="Gathering" />',
    "```xml",
    '<coven:research run-id="example" title="Example" status="running" />',
    "```",
  ].join("\n"));

  assert.equal(parsed.runs.length, 1);
  assert.equal(parsed.runs[0]?.status, "running");
  assert.equal(parsed.runs[0]?.activity, "Gathering");
  assert.match(parsed.visible, /run-id="example"/);
});
