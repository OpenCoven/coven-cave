import assert from "node:assert/strict";
import test from "node:test";
import { compileFlowPrompt, flowExecutionOrder } from "./flow/flow-compile.ts";
import type { ResearchMission } from "./research-missions.ts";
import { buildResearchMissionFlow } from "./research-mission-flow.ts";

function mission(mode: ResearchMission["mode"] = "brief"): ResearchMission {
  return {
    version: 1,
    id: "mission-flow",
    familiarId: "sage",
    title: "Compare storage engines",
    intent: "Compare SQLite and Postgres for a local-first desktop app",
    mode,
    modeSource: "user",
    deliverable: mode,
    constraints: ["Prefer primary sources"],
    bounds: {
      wallClockMinutes: mode === "autoresearch" ? 240 : 90,
      maxIterations: mode === "autoresearch" ? 6 : 1,
      sourceTarget: mode === "paper" ? 8 : 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: mode === "autoresearch",
    },
    status: "planning",
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    iterations: [],
    artifacts: [],
    sources: [],
  };
}

test("Flow order is scope, gather, challenge, synthesize, control, publish", () => {
  const flow = buildResearchMissionFlow(mission(), 1);
  assert.deepEqual(flowExecutionOrder(flow), [
    "trigger",
    "scope",
    "gather",
    "challenge",
    "synthesize",
    "control",
    "publish",
  ]);
  assert.ok(flow.nodes.slice(1).every((node) => node.params.familiar === "sage"));
});

test("paper mode requires eight distinct sources and Markdown", () => {
  const flow = buildResearchMissionFlow(mission("paper"), 1);
  const prompt = compileFlowPrompt(flow);
  assert.match(prompt, /at least 8 distinct source materials/i);
  assert.match(prompt, /artifacts\/primary\.md/);
});

test("every agent step repeats workspace and bounded stop rules", () => {
  const flow = buildResearchMissionFlow(mission("autoresearch"), 2);
  for (const node of flow.nodes.slice(1)) {
    assert.match(String(node.params.prompt), /mission-flow/);
    assert.match(String(node.params.prompt), /iteration 2 of 6/i);
    assert.match(String(node.params.prompt), /Do not start another iteration/i);
  }
});

test("publish step preserves the exact bare-line research marker contract", () => {
  const flow = buildResearchMissionFlow(mission(), 1);
  const prompt = String(flow.nodes.find((node) => node.id === "publish")?.params.prompt);
  assert.match(
    prompt,
    /\n@@research-control\n\{"decision":"<continue\|checkpoint\|complete>","reason":"<one line>","confidence":<0 to 1>\}\n@@research-artifacts-written\n/,
  );
  assert.doesNotMatch(prompt, /```[^]*@@research-control/);
});
