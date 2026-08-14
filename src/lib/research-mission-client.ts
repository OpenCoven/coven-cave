import type {
  CreateResearchMissionInput,
  ResearchArtifactKind,
  ResearchMission,
  ResearchMissionActionInput,
} from "./research-missions.ts";
import { parseResearchMission } from "./research-missions.ts";
import type { AutomationStatus } from "./codex-automations-types.ts";
import type { ResearchAutomationScheduleInput } from "./server/research-mission-runner.ts";
import { publishSchedulesChanged } from "./board-cache-events.ts";

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

export type ResearchMissionFile = {
  key: string;
  kind: ResearchArtifactKind;
  title: string;
  fileName: string;
  relativePath: string;
  content: string | null;
  workspacePath: string;
  updatedAt: string;
};

export type ResearchMissionFileResponse =
  | { ok: true; file: ResearchMissionFile }
  | { ok: false; error?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

function parseMissionResponse(value: unknown): ResearchMissionResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return { ok: false, error: "Research mission returned an invalid response" };
  }
  if (!value.ok) {
    return {
      ok: false,
      ...(typeof value.error === "string" ? { error: value.error } : {}),
    };
  }
  const mission = parseResearchMission(value.mission);
  return mission
    ? { ok: true, mission }
    : { ok: false, error: "Research mission returned an invalid response" };
}

function parseMissionListResponse(value: unknown): ResearchMissionListResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return { ok: false, error: "Research missions returned an invalid response" };
  }
  if (!value.ok) {
    return {
      ok: false,
      ...(typeof value.error === "string" ? { error: value.error } : {}),
    };
  }
  if (!Array.isArray(value.missions)) {
    return { ok: false, error: "Research missions returned an invalid response" };
  }
  const missions = value.missions.map(parseResearchMission);
  return missions.some((mission) => mission === null)
    ? { ok: false, error: "Research missions returned an invalid response" }
    : { ok: true, missions: missions as ResearchMission[] };
}

export function isActiveResearchMission(mission: ResearchMission): boolean {
  return ["queued", "planning", "running"].includes(mission.status);
}

export function selectStableMission(
  selectedId: string | null,
  missions: ResearchMission[],
): string | null {
  if (selectedId && missions.some((mission) => mission.id === selectedId)) return selectedId;
  // Never auto-select into the collapsed archived group; archived rows are
  // only selected deliberately.
  const firstUnarchived = missions.find((mission) => mission.status !== "archived");
  return firstUnarchived?.id ?? missions[0]?.id ?? null;
}

export async function listResearchMissions(
  familiarId: string,
  signal?: AbortSignal,
): Promise<ResearchMissionListResponse> {
  const response = await fetch(
    `/api/research/missions?familiarId=${encodeURIComponent(familiarId)}`,
    { cache: "no-store", signal },
  );
  return parseMissionListResponse(await readJson(response));
}

export async function getResearchMission(
  id: string,
  signal?: AbortSignal,
): Promise<ResearchMissionResponse> {
  const response = await fetch(`/api/research/missions/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal,
  });
  return parseMissionResponse(await readJson(response));
}

export async function getResearchMissionFile(
  missionId: string,
  artifactKey: string,
  signal?: AbortSignal,
): Promise<ResearchMissionFile> {
  const response = await fetch(
    `/api/research/missions/${encodeURIComponent(missionId)}/files/${encodeURIComponent(artifactKey)}`,
    { cache: "no-store", signal },
  );
  const data = await readJson(response) as ResearchMissionFileResponse;
  if (!data.ok) throw new Error(data.error ?? "request failed");
  return data.file;
}

export async function createResearchMission(
  input: CreateResearchMissionInput,
): Promise<ResearchMissionResponse> {
  const response = await fetch("/api/research/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseMissionResponse(await readJson(response));
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
  return parseMissionResponse(await readJson(response));
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
  const result = parseMissionResponse(await readJson(response));
  if (result.ok) publishSchedulesChanged();
  return result;
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
  const result = await readJson(response) as { ok: boolean; error?: string };
  if (result.ok) publishSchedulesChanged();
  return result;
}

export async function runResearchAutomationNow(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`/api/codex-automations/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
  return readJson(response) as Promise<{ ok: boolean; error?: string }>;
}
