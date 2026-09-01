import type { ResearchMission } from "./research-missions.ts";
import type { ResearchRunStatusV1 } from "./research-protocol/research-run.ts";

const PHASES = [
  "scope",
  "gather",
  "challenge",
  "synthesize",
  "control",
  "publish",
] as const;
type ResearchRunPhase = (typeof PHASES)[number];

function activePhase(
  mission: Pick<ResearchMission, "iterations">,
): ResearchRunPhase | undefined {
  const steps = mission.iterations.at(-1)?.steps ?? [];
  const active = steps.find((step) => step.status === "running");
  const candidate = `${active?.type ?? ""} ${active?.id ?? ""}`.toLowerCase();
  return PHASES.find((phase) => candidate.includes(phase));
}

export function canonicalResearchRunStatusForMission(
  mission: Pick<ResearchMission, "status" | "archivedFrom" | "iterations">,
): ResearchRunStatusV1 {
  switch (mission.status) {
    case "queued":
      return "queued";
    case "planning":
      return "scoping";
    case "running": {
      const phase = activePhase(mission);
      if (phase === "scope") return "scoping";
      if (phase === "gather") return "gathering_public_sources";
      if (phase === "challenge") return "challenging";
      if (phase === "control") return "controlling";
      if (phase === "publish") return "publishing";
      return "synthesizing";
    }
    case "checkpoint":
    case "paused":
      return "awaiting_checkpoint";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "archived":
      if (mission.archivedFrom === "completed") return "completed";
      if (mission.archivedFrom === "failed") return "failed";
      return "cancelled";
  }
}

function archivedMissionMapsToCancelled(
  mission: Pick<ResearchMission, "status" | "archivedFrom">,
): boolean {
  return mission.status === "archived"
    && mission.archivedFrom !== "completed"
    && mission.archivedFrom !== "failed";
}

export function researchMissionLifecycleMatchesRun(
  mission: Pick<ResearchMission, "status" | "archivedFrom">,
  runStatus: ResearchRunStatusV1,
): boolean {
  switch (runStatus) {
    case "queued":
      return mission.status === "queued";
    case "scoping":
      return mission.status === "planning" || mission.status === "running";
    case "gathering_public_sources":
    case "waiting_for_executor":
    case "challenging":
    case "synthesizing":
    case "controlling":
    case "publishing":
      return mission.status === "running";
    case "awaiting_checkpoint":
      return mission.status === "checkpoint" || mission.status === "paused";
    case "completed":
      return mission.status === "completed"
        || (mission.status === "archived" && mission.archivedFrom === "completed");
    case "failed":
      return mission.status === "failed"
        || (mission.status === "archived" && mission.archivedFrom === "failed");
    case "cancelled":
    case "expired":
      return mission.status === "cancelled" || archivedMissionMapsToCancelled(mission);
    default:
      return false;
  }
}
