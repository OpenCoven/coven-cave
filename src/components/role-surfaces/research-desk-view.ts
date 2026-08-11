import type { ResearchMission } from "@/lib/research-missions";

export type ResearchMissionScope =
  | "all"
  | "active"
  | "needs-review"
  | "finished";

export type ResearchMissionGroupId =
  | "needs-review"
  | "in-progress"
  | "recent"
  | "archived";

export type ResearchMissionGroup = {
  id: ResearchMissionGroupId;
  label: string;
  missions: ResearchMission[];
};

const ACTIVE_STATUSES = new Set<ResearchMission["status"]>([
  "queued",
  "planning",
  "running",
  "checkpoint",
  "paused",
]);

const NEEDS_REVIEW_STATUSES = new Set<ResearchMission["status"]>([
  "checkpoint",
  "paused",
  "failed",
]);

const FINISHED_STATUSES = new Set<ResearchMission["status"]>([
  "completed",
  "cancelled",
]);

const IN_PROGRESS_STATUSES = new Set<ResearchMission["status"]>([
  "queued",
  "planning",
  "running",
]);

export function filterResearchMissionsByText(
  missions: ResearchMission[],
  filter = "",
): ResearchMission[] {
  const query = filter.trim().toLowerCase();
  if (!query) return missions;
  return missions.filter((mission) =>
    `${mission.title} ${mission.intent}`.toLowerCase().includes(query));
}

export function matchesResearchMissionScope(
  mission: ResearchMission,
  scope: ResearchMissionScope,
): boolean {
  if (scope === "active") return ACTIVE_STATUSES.has(mission.status);
  if (scope === "needs-review") {
    return NEEDS_REVIEW_STATUSES.has(mission.status);
  }
  if (scope === "finished") return FINISHED_STATUSES.has(mission.status);
  return true;
}

export function researchMissionScopeCounts(
  missions: ResearchMission[],
): Record<ResearchMissionScope, number> {
  return {
    all: missions.length,
    active: missions.filter((mission) =>
      matchesResearchMissionScope(mission, "active")).length,
    "needs-review": missions.filter((mission) =>
      matchesResearchMissionScope(mission, "needs-review")).length,
    finished: missions.filter((mission) =>
      matchesResearchMissionScope(mission, "finished")).length,
  };
}

export function groupResearchMissions(
  missions: ResearchMission[],
): ResearchMissionGroup[] {
  const review = missions.filter((mission) =>
    NEEDS_REVIEW_STATUSES.has(mission.status));
  const progress = missions.filter((mission) =>
    IN_PROGRESS_STATUSES.has(mission.status));
  const archived = missions.filter((mission) =>
    mission.status === "archived");
  const assignedIds = new Set(
    [...review, ...progress, ...archived].map(({ id }) => id),
  );
  const recent = missions.filter((mission) => !assignedIds.has(mission.id));

  const groups: ResearchMissionGroup[] = [
    { id: "needs-review", label: "Needs review", missions: review },
    { id: "in-progress", label: "In progress", missions: progress },
    { id: "recent", label: "Recent", missions: recent },
    { id: "archived", label: "Archived", missions: archived },
  ];

  return groups.filter((group) => group.missions.length > 0);
}
