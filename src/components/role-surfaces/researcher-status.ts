import type { ResearchMission, ResearchMissionStatus } from "@/lib/research-missions";

const LIVE_RESEARCH_STATUSES: ReadonlySet<ResearchMissionStatus> = new Set([
  "queued",
  "planning",
  "running",
]);

/** Missions the research engine is actively working or waiting to start. */
export function researchLiveRunCount(
  missions: readonly Pick<ResearchMission, "status">[],
): number {
  return missions.filter((mission) => LIVE_RESEARCH_STATUSES.has(mission.status)).length;
}

/** Compose the single shared-host status without dropping either live signal. */
export function researchEngineStatus(
  daemonRunning: boolean,
  liveRunCount: number | null,
): { label: string; tone: "ok" | "warn" } {
  const readiness = daemonRunning ? "research engine ready" : "research engine offline";
  const runStatus = liveRunCount == null
    ? ""
    : ` · ${liveRunCount} run${liveRunCount === 1 ? "" : "s"} live`;
  return {
    label: `${readiness}${runStatus}`,
    tone: daemonRunning ? "ok" : "warn",
  };
}
