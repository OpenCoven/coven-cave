import type {
  CreateResearchMissionInput,
  ResearchArtifactKind,
  ResearchMission,
  ResearchMissionActionInput,
  ResearchSourceLedgerSnapshot,
} from "./research-missions.ts";
import {
  parseResearchMission,
  parseResearchSources,
  RESEARCH_ARTIFACT_KINDS,
} from "./research-missions.ts";
import type { AutomationStatus } from "./codex-automations-types.ts";
import type { ResearchAutomationScheduleInput } from "./research-automation-contract.ts";
import { parseLifecycleCommandResult } from "./automations/lifecycle.ts";
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
  sourceLedger: ResearchSourceLedgerSnapshot;
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

function failedSourceLedger(): ResearchSourceLedgerSnapshot {
  return { state: "failed", sources: [] };
}

function parseSourceLedgerSnapshot(
  value: unknown,
): ResearchSourceLedgerSnapshot {
  if (!isRecord(value)) return failedSourceLedger();
  if (value.state === "failed") return failedSourceLedger();
  if (value.state !== "available" && value.state !== "empty") {
    return failedSourceLedger();
  }
  const sources = parseResearchSources(value.sources);
  if (!sources) return failedSourceLedger();
  const expectedState = sources.length > 0 ? "available" : "empty";
  if (value.state !== expectedState) return failedSourceLedger();
  return expectedState === "available"
    ? { state: "available", sources }
    : { state: "empty", sources: [] };
}

function parseMissionFileResponse(value: unknown): ResearchMissionFileResponse {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.file)) {
    if (isRecord(value) && value.ok === false) {
      return {
        ok: false,
        ...(typeof value.error === "string" ? { error: value.error } : {}),
      };
    }
    return { ok: false, error: "Research file returned an invalid response" };
  }
  const file = value.file;
  if (
    typeof file.key !== "string" ||
    typeof file.kind !== "string" ||
    !RESEARCH_ARTIFACT_KINDS.includes(file.kind as ResearchArtifactKind) ||
    typeof file.title !== "string" ||
    typeof file.fileName !== "string" ||
    typeof file.relativePath !== "string" ||
    (file.content !== null && typeof file.content !== "string") ||
    typeof file.workspacePath !== "string" ||
    typeof file.updatedAt !== "string"
  ) {
    return { ok: false, error: "Research file returned an invalid response" };
  }
  return {
    ok: true,
    file: {
      key: file.key,
      kind: file.kind as ResearchArtifactKind,
      title: file.title,
      fileName: file.fileName,
      relativePath: file.relativePath,
      content: file.content as string | null,
      workspacePath: file.workspacePath,
      updatedAt: file.updatedAt,
      sourceLedger: parseSourceLedgerSnapshot(file.sourceLedger),
    },
  };
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
  const data = parseMissionFileResponse(await readJson(response));
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
  expectedRevision?: number,
): Promise<{ ok: boolean; error?: string; revision?: number }> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision! < 1) {
    return { ok: false, error: "Refresh the scheduled job before changing it." };
  }
  const command = status === "ACTIVE" ? "activate" : "pause";
  // Deterministic per reviewed revision: transport retries, including after a
  // browser reload, must reuse the exact lifecycle command's adoption key.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([id, command, expectedRevision])));
  const adoptionKey = `cave-research-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const response = await fetch(`/api/coven-automations/${encodeURIComponent(id)}/lifecycle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, expectedRevision, adoptionKey }),
  });
  const result = parseLifecycleCommandResult(await readJson(response));
  if (result.kind === "committed") {
    publishSchedulesChanged();
    return { ok: true, revision: result.revision };
  }
  return { ok: false, error: result.kind === "conflict"
    ? "The scheduled job changed. Refresh it before retrying."
    : result.kind === "unknown" ? "The scheduled job may have changed. Retry to confirm the same request."
    : "The scheduled job could not be changed. Refresh it and try again." };
}

export async function runResearchAutomationNow(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`/api/codex-automations/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
  return readJson(response) as Promise<{ ok: boolean; error?: string }>;
}
