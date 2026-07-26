import type {
  ResearchArtifactKind,
  ResearchBounds,
  ResearchMissionMode,
} from "./research-missions.ts";

export type ResearchModeInference = {
  mode: ResearchMissionMode;
  reason: string;
};

export type ResearchPlanDefaults = {
  mode: ResearchMissionMode;
  deliverables: ResearchArtifactKind[];
  bounds: ResearchBounds;
};

const ROUTES: ReadonlyArray<ResearchModeInference & { pattern: RegExp }> = [
  {
    mode: "autoresearch",
    reason: "iterative experiment or continuation request",
    pattern: /\b(autoresearch|experiment|optimi[sz]e|until|keep researching|loop)\b/i,
  },
  {
    mode: "paper",
    reason: "formal paper or literature-review request",
    pattern: /\b(paper|whitepaper|literature review|systematic review)\b/i,
  },
  {
    mode: "sweep",
    reason: "broad landscape or exhaustive-source request",
    pattern: /\b(landscape|exhaustive|market map|survey|trend map|all alternatives)\b/i,
  },
  {
    mode: "brief",
    reason: "comparison or recommendation request",
    pattern: /\b(compare|comparison|recommend|summary|brief|question)\b/i,
  },
];

const DEFAULT_PLANS: Record<ResearchMissionMode, ResearchPlanDefaults> = {
  brief: {
    mode: "brief",
    deliverables: ["brief"],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 1,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
  },
  sweep: {
    mode: "sweep",
    deliverables: ["report", "source-ledger"],
    bounds: {
      wallClockMinutes: 45,
      maxIterations: 1,
      sourceTarget: 12,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
  },
  paper: {
    mode: "paper",
    deliverables: ["paper", "source-ledger"],
    bounds: {
      wallClockMinutes: 90,
      maxIterations: 1,
      sourceTarget: 8,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
  },
  autoresearch: {
    mode: "autoresearch",
    deliverables: ["findings", "research-log", "source-ledger"],
    bounds: {
      wallClockMinutes: 240,
      maxIterations: 6,
      sourceTarget: 12,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    },
  },
};

export function inferResearchMissionMode(intent: string): ResearchModeInference {
  const route = ROUTES.find((candidate) => candidate.pattern.test(intent));
  if (!route) return { mode: "brief", reason: "safe default for an ambiguous request" };
  return { mode: route.mode, reason: route.reason };
}

export function defaultResearchPlan(mode: ResearchMissionMode): ResearchPlanDefaults {
  const plan = DEFAULT_PLANS[mode];
  return {
    mode: plan.mode,
    deliverables: [...plan.deliverables],
    bounds: { ...plan.bounds },
  };
}
