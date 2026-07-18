import type {
  CreateResearchMissionInput,
  ResearchMission,
  ResearchMissionActionInput,
} from "./research-missions.ts";
import type { AutomationStatus } from "./codex-automations-types.ts";
import type { ResearchAutomationScheduleInput } from "./server/research-mission-runner.ts";

export type ResearchMissionListResponse = {
  ok: boolean;
  missions?: ResearchMission[];
  error?: string;
};

export type ResearchMissionResponse = {
  ok: boolean;
  mission?: ResearchMission;
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function isActiveResearchMission(mission: ResearchMission): boolean {
  return ["queued", "planning", "running"].includes(mission.status);
}

export function selectStableMission(
  selectedId: string | null,
  missions: ResearchMission[],
): string | null {
  if (selectedId && missions.some((mission) => mission.id === selectedId)) return selectedId;
  return missions[0]?.id ?? null;
}

export async function listResearchMissions(
  familiarId: string,
  signal?: AbortSignal,
): Promise<ResearchMissionListResponse> {
  const response = await fetch(
    `/api/research/missions?familiarId=${encodeURIComponent(familiarId)}`,
    { cache: "no-store", signal },
  );
  return readJson<ResearchMissionListResponse>(response);
}

export async function getResearchMission(
  id: string,
  signal?: AbortSignal,
): Promise<ResearchMissionResponse> {
  const response = await fetch(`/api/research/missions/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal,
  });
  return readJson<ResearchMissionResponse>(response);
}

export async function createResearchMission(
  input: CreateResearchMissionInput,
): Promise<ResearchMissionResponse> {
  const response = await fetch("/api/research/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<ResearchMissionResponse>(response);
}

export async function actOnResearchMission(
  id: string,
  input: ResearchMissionActionInput,
): Promise<ResearchMissionResponse> {
  const response = await fetch(`/api/research/missions/${encodeURIComponent(id)}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<ResearchMissionResponse>(response);
}

export async function scheduleResearchMission(
  id: string,
  input: ResearchAutomationScheduleInput,
): Promise<ResearchMissionResponse> {
  const response = await fetch(`/api/research/missions/${encodeURIComponent(id)}/schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<ResearchMissionResponse>(response);
}

export async function setResearchAutomationStatus(
  id: string,
  status: AutomationStatus,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`/api/codex-automations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return readJson<{ ok: boolean; error?: string }>(response);
}

export async function runResearchAutomationNow(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`/api/codex-automations/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
  return readJson<{ ok: boolean; error?: string }>(response);
}
