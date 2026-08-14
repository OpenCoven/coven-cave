import assert from "node:assert/strict";
import test from "node:test";
import { compileFlowPrompt, flowExecutionOrder } from "./flow/flow-compile.ts";
import type { ResearchMission } from "./research-missions.ts";
import {
  buildResearchMissionFlow,
  isResearchMissionFlowSnapshot,
} from "./research-mission-flow.ts";

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
    audience: "storage architects",
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

test("legacy queue recognition requires the exact Research snapshot shape", () => {
  const flow = buildResearchMissionFlow(mission(), 1);
  assert.equal(isResearchMissionFlowSnapshot(flow), true);
  assert.equal(isResearchMissionFlowSnapshot({ ...flow, id: "research-themed-user-flow" }), false);
  assert.equal(isResearchMissionFlowSnapshot({
    ...flow,
    nodes: flow.nodes.map((node, index) => index === 3 ? { ...node, id: "user-step" } : node),
  }), false);
});

test("paper mode requires eight distinct sources and Markdown", () => {
  const flow = buildResearchMissionFlow(mission("paper"), 1);
  const prompt = compileFlowPrompt(flow);
  assert.match(prompt, /at least 8 distinct source materials/i);
  assert.match(prompt, /artifacts\/primary\.md/);
});

test("the compiled flow carries one shared context while preserving every phase instruction", () => {
  const flow = buildResearchMissionFlow(mission("autoresearch"), 2);
  const prompt = compileFlowPrompt(flow);
  assert.equal(prompt.match(/Intent: Compare SQLite and Postgres/g)?.length, 1);
  assert.equal(prompt.match(/Deliverable: autoresearch/g)?.length, 1);
  assert.equal(prompt.match(/Audience: storage architects/g)?.length, 1);
  assert.equal(prompt.match(/Do not start another iteration/g)?.length, 1);
  assert.match(prompt, /SHARED RESEARCH MISSION CONTEXT/);
  assert.match(prompt, /iteration 2 of 6/i);
  assert.match(prompt, /Define research questions, inclusion rules, exclusions/);
  assert.match(prompt, /gather primary, local, and approved project sources/i);
  assert.match(prompt, /try to refute weak claims/i);
  assert.match(prompt, /update findings\.md and artifacts\/primary\.md/i);
  assert.match(prompt, /choose continue, checkpoint, or complete/i);
  assert.match(prompt, /Atomically finish the working files/i);
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
