import type { FlowDoc, FlowEdge, FlowNode } from "./flow/flow-doc.ts";
import type { ResearchMission } from "./research-missions.ts";
import { researchMissionWorkspacePath } from "./server/research-mission-store.ts";

const STEP_IDS = [
  "trigger",
  "scope",
  "gather",
  "challenge",
  "synthesize",
  "control",
  "publish",
] as const;

/**
 * Recognize the durable flow snapshots emitted by Research. The complete
 * ordered seven-node shape keeps this conservative: a user flow that merely
 * starts its id with `research-` is not reclassified. Travel replay uses this
 * to refuse legacy queue entries created before Research became online-only.
 */
export function isResearchMissionFlowSnapshot(
  flow: Pick<FlowDoc, "id" | "nodes">,
): boolean {
  if (!/^research-.+-iteration-[1-9]\d*$/u.test(flow.id)) return false;
  if (flow.nodes.length !== STEP_IDS.length) return false;
  return STEP_IDS.every((id, index) => (
    flow.nodes[index]?.id === id
    && flow.nodes[index]?.type === (index === 0 ? "trigger.manual" : "familiar")
  ));
}

function chainEdges(ids: readonly string[]): FlowEdge[] {
  return ids.slice(0, -1).map((source, index) => {
    const target = ids[index + 1];
    return {
      id: `${source}:main->${target}:in`,
      source,
      sourceHandle: "main",
      target,
      targetHandle: "in",
    };
  });
}

function agentNode(
  mission: ResearchMission,
  id: string,
  name: string,
  prompt: string,
  index: number,
): FlowNode {
  return {
    id,
    type: "familiar",
    name,
    position: { x: 120 + index * 260, y: 160 },
    params: { familiar: mission.familiarId, prompt },
  };
}

function sourceRequirement(mission: ResearchMission): string {
  if (mission.mode === "paper") {
    return `Use at least ${mission.bounds.sourceTarget} distinct source materials; prefer primary sources and preserve a bibliography.`;
  }
  return `Target ${mission.bounds.sourceTarget} useful sources and record every candidate, used, conflicting, or rejected source in sources.json.`;
}

function boundedContext(mission: ResearchMission, iteration: number, workspace: string): string {
  return [
    `Mission: ${mission.id}`,
    `Mode: ${mission.mode}`,
    `Iteration ${iteration} of ${mission.bounds.maxIterations}.`,
    `Intent: ${mission.intent}`,
    `Deliverable: ${mission.deliverable}`,
    mission.audience ? `Audience: ${mission.audience}` : "Audience: not specified.",
    mission.direction ? `Refined direction: ${mission.direction}` : "",
    `Workspace: ${workspace}`,
    `Read existing mission state before acting. Write only under ${workspace}.`,
    sourceRequirement(mission),
    `Wall-clock bound: ${mission.bounds.wallClockMinutes} minutes total.`,
    mission.bounds.maxSpendUsd === undefined
      ? "No reported spend ceiling is configured."
      : `Reported spend ceiling: $${mission.bounds.maxSpendUsd}.`,
    "Do not start another iteration. This Flow performs exactly one bounded iteration and then stops.",
    "Never claim a source, file, artifact, or completed step that you did not inspect or produce.",
    mission.constraints.length > 0
      ? `Constraints: ${mission.constraints.join("; ")}`
      : "Constraints: none beyond the explicit bounds and evidence standard.",
  ].filter(Boolean).join("\n");
}

function publishPrompt(): string {
  return [
    "Using the shared Research mission context above, publish the working files.",
    "Atomically finish the working files: research-state.yaml, findings.md, research-log.md, sources.json, and artifacts/primary.md.",
    "All durable narrative artifacts except an optional self-contained presentation must be Markdown.",
    "After every file is valid, end this step by printing these three bare-line records exactly; replace only the JSON placeholders:",
    "",
    "@@research-control",
    '{"decision":"<continue|checkpoint|complete>","reason":"<one line>","confidence":<0 to 1>}',
    "@@research-artifacts-written",
    "",
    "Nothing else may appear on any marker line. Do not wrap the markers or JSON in backticks or a code block.",
  ].join("\n");
}

export function buildResearchMissionFlow(
  mission: ResearchMission,
  iteration: number,
): FlowDoc {
  if (!Number.isInteger(iteration) || iteration < 1 || iteration > mission.bounds.maxIterations) {
    throw new Error("invalid research iteration");
  }
  const workspace = researchMissionWorkspacePath(mission.id);
  const context = boundedContext(mission, iteration, workspace);
  const now = mission.updatedAt || mission.createdAt;
  const nodes: FlowNode[] = [
    {
      id: "trigger",
      type: "trigger.manual",
      name: "Start bounded iteration",
      position: { x: 120, y: 160 },
      params: {},
    },
    agentNode(
      mission,
      "scope",
      "Scope question",
      [
        "SHARED RESEARCH MISSION CONTEXT — applies to every Research phase in this Flow:",
        context,
        "Define research questions, inclusion rules, exclusions, and the evidence standard.",
      ].join("\n"),
      1,
    ),
    agentNode(
      mission,
      "gather",
      "Gather sources",
      "Using the shared Research mission context above, gather primary, local, and approved project sources. Normalize and update sources.json as evidence changes.",
      2,
    ),
    agentNode(
      mission,
      "challenge",
      "Challenge claims",
      "Using the shared Research mission context above, try to refute weak claims. Record contradictions, missing evidence, duplication, and unresolved questions.",
      3,
    ),
    agentNode(
      mission,
      "synthesize",
      "Synthesize artifacts",
      "Using the shared Research mission context above, update findings.md and artifacts/primary.md with citations to the structured source ledger.",
      4,
    ),
    agentNode(
      mission,
      "control",
      "Choose next state",
      "Using the shared Research mission context above, choose continue, checkpoint, or complete against evidence quality and explicit bounds. Continue is only a recommendation for a later user or automation action; do not execute it now.",
      5,
    ),
    agentNode(mission, "publish", "Publish working files", publishPrompt(), 6),
  ];

  return {
    id: `research-${mission.id}-iteration-${iteration}`,
    name: `${mission.title} · iteration ${iteration}`,
    active: false,
    nodes,
    edges: chainEdges(STEP_IDS),
    createdAt: now,
    updatedAt: now,
    schema: 1,
  };
}
