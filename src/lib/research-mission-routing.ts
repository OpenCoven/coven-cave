import type {
  CreateResearchMissionInput,
  ResearchArtifactKind,
  ResearchBounds,
  ResearchMissionMode,
  ResearchRunOrigin,
} from "./research-missions.ts";
import { RESEARCH_RUNTIME_DEFAULT_HARNESS } from "./research-missions.ts";

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

/**
 * Build the create-input for a run described by nothing but a plain-language
 * intent, auto-routing the mode and taking the plan's own bounds. No inferred
 * title is persisted, and the create route still owns final validation.
 *
 * This is the single intent→run entry point for every surface that starts a
 * run from a sentence (#4808): the Research Desk's recommendation cards and
 * the chat `/research` command both build the same request here, so the two
 * surfaces cannot drift into routing the same sentence differently. Callers
 * pass their own `origin` so the run records which one asked for it.
 */
export function createResearchMissionInputFromIntent(
  familiarId: string,
  intent: string,
  origin?: ResearchRunOrigin,
): CreateResearchMissionInput {
  const trimmed = intent.trim();
  const inferred = inferResearchMissionMode(trimmed);
  const plan = defaultResearchPlan(inferred.mode);
  return {
    familiarId,
    intent: trimmed,
    mode: inferred.mode,
    modeSource: "auto",
    deliverable: plan.deliverables.join(" + "),
    bounds: { ...plan.bounds },
    harness: RESEARCH_RUNTIME_DEFAULT_HARNESS,
    ...(origin ? { origin } : {}),
  };
}

export function defaultResearchPlan(mode: ResearchMissionMode): ResearchPlanDefaults {
  const plan = DEFAULT_PLANS[mode];
  return {
    mode: plan.mode,
    deliverables: [...plan.deliverables],
    bounds: { ...plan.bounds },
  };
}
